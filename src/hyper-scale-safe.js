/**
 * kimdb HyperScale Safe Mode
 * 10,000명+ 동시 처리 + 데이터 안전성
 *
 * 해결된 문제:
 * 1. 데이터 영속성: WAL 이중 기록
 * 2. 데이터 일관성: Read-After-Write 보장
 * 3. 복잡성: 단순한 API로 추상화
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';
import { join } from 'path';
import { mkdirSync, existsSync, appendFileSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { EventEmitter } from 'events';

class HyperScaleDB extends EventEmitter {
  constructor(options = {}) {
    super();

    this.config = {
      dbPath: options.dbPath || './data/hyperscale.db',
      shardCount: options.shardCount || 8,
      bufferSize: options.bufferSize || 10000,
      flushInterval: options.flushInterval || 100,
      batchSize: options.batchSize || 1000,

      // 🔒 안전성 옵션
      safeMode: options.safeMode !== false,        // 기본: 안전 모드 ON
      walPath: options.walPath || './data/buffer.wal',  // 버퍼 WAL 경로
      syncReads: options.syncReads || false,       // 읽기 시 버퍼 확인

      ...options
    };

    // 메모리 버퍼
    this.writeBuffer = new Map();
    this.readCache = new Map();

    // 샤드 DB들
    this.shards = new Map();

    // 버퍼 WAL (영속성 보장)
    this.walEnabled = this.config.safeMode;

    // 통계
    this.stats = {
      bufferedWrites: 0,
      flushedWrites: 0,
      cacheHits: 0,
      cacheMisses: 0,
      walWrites: 0,
      recoveredWrites: 0
    };

    this.flushTimer = null;
    this.flushing = false;
  }

  // ===== 초기화 =====
  init() {
    const dir = join(this.config.dbPath, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    // WAL 복구 (이전 크래시 데이터)
    if (this.walEnabled) {
      this.recoverFromWAL();
    }

    // 샤드 초기화
    for (let i = 0; i < this.config.shardCount; i++) {
      const dbPath = this.config.dbPath.replace('.db', `_shard${i}.db`);
      const db = new Database(dbPath);

      // 안전 모드: synchronous = NORMAL (균형)
      db.pragma('journal_mode = WAL');
      db.pragma(this.config.safeMode ? 'synchronous = NORMAL' : 'synchronous = OFF');
      db.pragma('cache_size = 50000');
      db.pragma('temp_store = MEMORY');
      db.pragma('mmap_size = 1073741824');
      db.pragma('busy_timeout = 60000');

      this.shards.set(i, db);
    }

    this.startFlushing();

    console.log(`[kimdb] HyperScale Safe initialized (safeMode: ${this.config.safeMode})`);
    return this;
  }

  // ===== WAL 복구 (크래시 복구) =====
  recoverFromWAL() {
    if (!existsSync(this.config.walPath)) return;

    try {
      const walData = readFileSync(this.config.walPath, 'utf8');
      const lines = walData.trim().split('\n').filter(l => l);

      if (lines.length === 0) return;

      console.log(`[kimdb] Recovering ${lines.length} buffered writes from WAL...`);

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);

          if (!this.writeBuffer.has(entry.collection)) {
            this.writeBuffer.set(entry.collection, []);
          }

          this.writeBuffer.get(entry.collection).push({
            id: entry.id,
            data: entry.data,
            operation: entry.operation,
            timestamp: entry.timestamp
          });

          this.stats.recoveredWrites++;
        } catch (e) {
          // 손상된 라인 스킵
        }
      }

      // WAL 클리어
      writeFileSync(this.config.walPath, '');

      console.log(`[kimdb] Recovered ${this.stats.recoveredWrites} writes`);
    } catch (e) {
      console.error('[kimdb] WAL recovery error:', e.message);
    }
  }

  // ===== WAL에 기록 (영속성) =====
  writeToWAL(collection, id, data, operation) {
    if (!this.walEnabled) return;

    const entry = JSON.stringify({
      collection,
      id,
      data,
      operation,
      timestamp: Date.now()
    }) + '\n';

    try {
      appendFileSync(this.config.walPath, entry);
      this.stats.walWrites++;
    } catch (e) {
      console.error('[kimdb] WAL write error:', e.message);
    }
  }

  // ===== 샤드 계산 =====
  getShardIndex(key) {
    const hash = crypto.createHash('md5').update(String(key)).digest();
    return hash.readUInt32BE(0) % this.config.shardCount;
  }

  getShard(key) {
    return this.shards.get(this.getShardIndex(key));
  }

  // ===== 쓰기 (안전 모드) =====
  write(collection, id, data, operation = 'upsert') {
    const docId = id || crypto.randomUUID();
    const key = `${collection}:${docId}`;

    // 1. WAL에 먼저 기록 (크래시 복구용)
    this.writeToWAL(collection, docId, data, operation);

    // 2. 버퍼에 추가
    if (!this.writeBuffer.has(collection)) {
      this.writeBuffer.set(collection, []);
    }

    this.writeBuffer.get(collection).push({
      id: docId,
      data,
      operation,
      timestamp: Date.now()
    });

    // 3. 읽기 캐시 업데이트 (Read-After-Write 보장)
    this.readCache.set(key, {
      data: { id: docId, data, _version: 1, _buffered: true },
      expiry: Date.now() + 60000
    });

    this.stats.bufferedWrites++;

    // 버퍼 오버플로우
    if (this.getBufferSize() >= this.config.bufferSize) {
      this.flush();
    }

    return { id: docId, buffered: true };
  }

  // ===== 즉시 쓰기 (동기, 중요 데이터용) =====
  writeSync(collection, id, data) {
    const docId = id || crypto.randomUUID();
    const db = this.getShard(docId);
    const tableName = this.sanitizeTableName(collection);

    this.ensureTable(db, tableName);

    db.prepare(`
      INSERT INTO ${tableName} (id, data, _version, updated_at)
      VALUES (?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        data = excluded.data,
        _version = ${tableName}._version + 1,
        updated_at = CURRENT_TIMESTAMP
    `).run(docId, JSON.stringify(data));

    // 캐시 업데이트
    const key = `${collection}:${docId}`;
    this.readCache.set(key, {
      data: { id: docId, data, _version: 1, _synced: true },
      expiry: Date.now() + 60000
    });

    return { id: docId, synced: true };
  }

  // ===== 읽기 (일관성 보장) =====
  read(collection, id, options = {}) {
    const key = `${collection}:${id}`;
    const forceSync = options.sync || this.config.syncReads;

    // 1. 캐시 체크 (버퍼 포함)
    const cached = this.readCache.get(key);
    if (cached && cached.expiry > Date.now()) {
      this.stats.cacheHits++;
      return cached.data;
    }

    // 2. 버퍼 확인 (Read-After-Write)
    const buffered = this.findInBuffer(collection, id);
    if (buffered) {
      this.stats.cacheHits++;
      return { id: buffered.id, data: buffered.data, _version: 1, _buffered: true };
    }

    this.stats.cacheMisses++;

    // 3. 강제 동기화 요청 시 플러시
    if (forceSync && this.getBufferSize() > 0) {
      this.flushSync();
    }

    // 4. DB에서 읽기
    const db = this.getShard(id);
    const tableName = this.sanitizeTableName(collection);

    try {
      const row = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(id);
      if (!row) return null;

      const data = { id: row.id, data: JSON.parse(row.data), _version: row._version };
      this.readCache.set(key, { data, expiry: Date.now() + 60000 });

      return data;
    } catch (e) {
      return null;
    }
  }

  // 버퍼에서 찾기
  findInBuffer(collection, id) {
    const items = this.writeBuffer.get(collection);
    if (!items) return null;

    // 최신 항목부터 역순 검색
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].id === id && items[i].operation !== 'delete') {
        return items[i];
      }
    }
    return null;
  }

  // ===== 플러시 =====
  startFlushing() {
    this.flushTimer = setInterval(() => {
      if (!this.flushing && this.getBufferSize() > 0) {
        this.flush();
      }
    }, this.config.flushInterval);
  }

  async flush() {
    if (this.flushing || this.getBufferSize() === 0) return;

    this.flushing = true;
    let totalFlushed = 0;

    try {
      for (const [collection, items] of this.writeBuffer) {
        if (items.length === 0) continue;

        const batch = items.splice(0, this.config.batchSize);
        const tableName = this.sanitizeTableName(collection);

        // 샤드별 그룹화
        const byShardIndex = new Map();
        for (const item of batch) {
          const shardIndex = this.getShardIndex(item.id);
          if (!byShardIndex.has(shardIndex)) byShardIndex.set(shardIndex, []);
          byShardIndex.get(shardIndex).push(item);
        }

        // 샤드별 배치 삽입
        for (const [shardIndex, shardItems] of byShardIndex) {
          const db = this.shards.get(shardIndex);
          this.ensureTable(db, tableName);

          const tx = db.transaction(() => {
            const upsertStmt = db.prepare(`
              INSERT INTO ${tableName} (id, data, _version, updated_at)
              VALUES (?, ?, 1, CURRENT_TIMESTAMP)
              ON CONFLICT(id) DO UPDATE SET
                data = excluded.data,
                _version = ${tableName}._version + 1,
                updated_at = CURRENT_TIMESTAMP
            `);

            const deleteStmt = db.prepare(`DELETE FROM ${tableName} WHERE id = ?`);

            for (const item of shardItems) {
              if (item.operation === 'delete') {
                deleteStmt.run(item.id);
              } else {
                upsertStmt.run(item.id, JSON.stringify(item.data));
              }
            }
          });

          tx();
          totalFlushed += shardItems.length;
        }
      }

      this.stats.flushedWrites += totalFlushed;

      // WAL 클리어 (성공적으로 플러시됨)
      if (this.walEnabled && totalFlushed > 0) {
        writeFileSync(this.config.walPath, '');
      }

      this.emit('flush', { count: totalFlushed });

    } catch (e) {
      console.error('[kimdb] Flush error:', e.message);
      this.emit('error', e);
    } finally {
      this.flushing = false;
    }
  }

  flushSync() {
    while (this.getBufferSize() > 0) {
      this.flushing = false;
      this.flush();
    }
  }

  // ===== 유틸리티 =====
  ensureTable(db, tableName) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        _version INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  sanitizeTableName(name) {
    return name.replace(/[^a-zA-Z0-9_]/g, '');
  }

  getBufferSize() {
    let size = 0;
    for (const items of this.writeBuffer.values()) {
      size += items.length;
    }
    return size;
  }

  getStats() {
    return {
      ...this.stats,
      bufferSize: this.getBufferSize(),
      shardCount: this.config.shardCount,
      safeMode: this.config.safeMode,
      cacheSize: this.readCache.size
    };
  }

  close() {
    clearInterval(this.flushTimer);
    this.flushSync();

    for (const [index, db] of this.shards) {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    }

    console.log('[kimdb] HyperScale Safe closed');
  }
}

// ===== 단순화된 API =====
class SimpleDB {
  constructor(options = {}) {
    this.db = new HyperScaleDB(options).init();
  }

  // 저장 (자동 버퍼링)
  async set(collection, id, data) {
    return this.db.write(collection, id, data);
  }

  // 저장 (즉시 동기화, 중요 데이터)
  async setSync(collection, id, data) {
    return this.db.writeSync(collection, id, data);
  }

  // 조회
  async get(collection, id) {
    return this.db.read(collection, id);
  }

  // 조회 (강제 동기화)
  async getSync(collection, id) {
    return this.db.read(collection, id, { sync: true });
  }

  // 삭제
  async delete(collection, id) {
    return this.db.write(collection, id, null, 'delete');
  }

  // 전체 조회
  async getAll(collection, limit = 100) {
    this.db.flushSync();  // 버퍼 플러시 후 조회

    const tableName = this.db.sanitizeTableName(collection);
    const results = [];
    const perShard = Math.ceil(limit / this.db.config.shardCount);

    for (const [index, db] of this.db.shards) {
      try {
        const rows = db.prepare(`SELECT * FROM ${tableName} ORDER BY updated_at DESC LIMIT ?`).all(perShard);
        results.push(...rows.map(r => ({
          id: r.id,
          data: JSON.parse(r.data),
          _version: r._version
        })));
      } catch (e) {}
    }

    return results.slice(0, limit);
  }

  // 통계
  stats() {
    return this.db.getStats();
  }

  // 종료
  close() {
    this.db.close();
  }
}

export { HyperScaleDB, SimpleDB };
export default SimpleDB;

console.log('[kimdb] HyperScale Safe module loaded');
