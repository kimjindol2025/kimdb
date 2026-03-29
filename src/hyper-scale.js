/**
 * kimdb HyperScale Module
 * 10,000명+ 동시 처리
 *
 * 전략:
 * 1. 메모리 버퍼: 즉시 응답 (1ms)
 * 2. 배치 플러시: 100ms마다 디스크에 일괄 기록
 * 3. WAL 최적화: 쓰기 지연 최소화
 * 4. 샤딩 + 버퍼 조합
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { EventEmitter } from 'events';

class HyperScaleDB extends EventEmitter {
  constructor(options = {}) {
    super();

    this.config = {
      dbPath: options.dbPath || './hyperscale.db',
      shardCount: options.shardCount || 8,
      bufferSize: options.bufferSize || 10000,      // 버퍼 최대 크기
      flushInterval: options.flushInterval || 100,   // 플러시 간격 (ms)
      batchSize: options.batchSize || 1000,          // 배치당 최대 쓰기
      ...options
    };

    // 메모리 버퍼 (초고속 쓰기)
    this.writeBuffer = new Map();  // collection -> [{id, data, op, timestamp}]
    this.readCache = new Map();    // key -> {data, expiry}

    // 샤드 DB들
    this.shards = new Map();

    // 통계
    this.stats = {
      bufferedWrites: 0,
      flushedWrites: 0,
      cacheHits: 0,
      cacheMisses: 0,
      avgFlushTime: 0,
      peakBufferSize: 0
    };

    // 플러시 타이머
    this.flushTimer = null;
    this.flushing = false;
  }

  // 초기화
  init() {
    const dir = join(this.config.dbPath, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    // 샤드 초기화
    for (let i = 0; i < this.config.shardCount; i++) {
      const dbPath = this.config.dbPath.replace('.db', `_shard${i}.db`);
      const db = new Database(dbPath);

      // 극한 최적화
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = OFF');        // 최대 속도 (약간의 위험)
      db.pragma('cache_size = 50000');       // 200MB 캐시
      db.pragma('temp_store = MEMORY');
      db.pragma('mmap_size = 1073741824');   // 1GB mmap
      db.pragma('busy_timeout = 60000');
      db.pragma('wal_autocheckpoint = 10000');
      db.pragma('locking_mode = NORMAL');

      this.shards.set(i, db);
    }

    // 플러시 시작
    this.startFlushing();

    console.log(`[kimdb] HyperScale initialized: ${this.config.shardCount} shards, ${this.config.bufferSize} buffer`);
    return this;
  }

  // 샤드 인덱스 계산
  getShardIndex(key) {
    const hash = crypto.createHash('md5').update(String(key)).digest();
    return hash.readUInt32BE(0) % this.config.shardCount;
  }

  getShard(key) {
    return this.shards.get(this.getShardIndex(key));
  }

  // ===== 초고속 쓰기 (메모리 버퍼) =====

  write(collection, id, data, operation = 'upsert') {
    const docId = id || crypto.randomUUID();
    const key = `${collection}:${docId}`;

    // 버퍼에 추가
    if (!this.writeBuffer.has(collection)) {
      this.writeBuffer.set(collection, []);
    }

    this.writeBuffer.get(collection).push({
      id: docId,
      data,
      operation,
      timestamp: Date.now()
    });

    // 읽기 캐시 업데이트 (즉시 반영)
    this.readCache.set(key, {
      data: { id: docId, data, _version: 1 },
      expiry: Date.now() + 60000  // 1분 TTL
    });

    this.stats.bufferedWrites++;
    this.stats.peakBufferSize = Math.max(
      this.stats.peakBufferSize,
      this.getBufferSize()
    );

    // 버퍼 오버플로우 시 즉시 플러시
    if (this.getBufferSize() >= this.config.bufferSize) {
      this.flush();
    }

    return { id: docId, buffered: true };
  }

  // 배치 쓰기 (초고속)
  writeBatch(collection, documents) {
    const results = [];
    for (const doc of documents) {
      const result = this.write(collection, doc.id, doc.data || doc);
      results.push(result);
    }
    return results;
  }

  // ===== 읽기 (캐시 우선) =====

  read(collection, id) {
    const key = `${collection}:${id}`;

    // 캐시 체크
    const cached = this.readCache.get(key);
    if (cached && cached.expiry > Date.now()) {
      this.stats.cacheHits++;
      return cached.data;
    }

    this.stats.cacheMisses++;

    // DB에서 읽기
    const db = this.getShard(id);
    const tableName = this.sanitizeTableName(collection);

    try {
      const row = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(id);
      if (!row) return null;

      const data = { id: row.id, data: JSON.parse(row.data), _version: row._version };

      // 캐시 저장
      this.readCache.set(key, { data, expiry: Date.now() + 60000 });

      return data;
    } catch (e) {
      return null;
    }
  }

  // ===== 플러시 (배치 디스크 쓰기) =====

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
    const startTime = Date.now();
    let totalFlushed = 0;

    try {
      for (const [collection, items] of this.writeBuffer) {
        if (items.length === 0) continue;

        // 배치 크기만큼 가져오기
        const batch = items.splice(0, this.config.batchSize);
        const tableName = this.sanitizeTableName(collection);

        // 샤드별로 그룹화
        const byShardIndex = new Map();
        for (const item of batch) {
          const shardIndex = this.getShardIndex(item.id);
          if (!byShardIndex.has(shardIndex)) byShardIndex.set(shardIndex, []);
          byShardIndex.get(shardIndex).push(item);
        }

        // 샤드별 배치 삽입
        for (const [shardIndex, shardItems] of byShardIndex) {
          const db = this.shards.get(shardIndex);

          // 테이블 확인/생성
          this.ensureTable(db, tableName);

          // 트랜잭션으로 일괄 삽입
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
      this.stats.avgFlushTime = (this.stats.avgFlushTime + (Date.now() - startTime)) / 2;

      this.emit('flush', { count: totalFlushed, time: Date.now() - startTime });

    } catch (e) {
      console.error('[kimdb] Flush error:', e.message);
      this.emit('error', e);
    } finally {
      this.flushing = false;
    }
  }

  // 강제 플러시 (동기)
  flushSync() {
    this.flush();
    // 모든 버퍼가 빌 때까지 대기
    while (this.getBufferSize() > 0) {
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

  // 전체 조회
  queryAll(collection, limit = 100) {
    const tableName = this.sanitizeTableName(collection);
    const results = [];
    const perShard = Math.ceil(limit / this.config.shardCount);

    for (const [index, db] of this.shards) {
      try {
        const rows = db.prepare(`SELECT * FROM ${tableName} ORDER BY updated_at DESC LIMIT ?`).all(perShard);
        results.push(...rows.map(r => ({
          id: r.id,
          data: JSON.parse(r.data),
          _version: r._version
        })));
      } catch (e) {
        // 테이블 없으면 스킵
      }
    }

    return results.slice(0, limit);
  }

  // 통계
  getStats() {
    return {
      ...this.stats,
      bufferSize: this.getBufferSize(),
      shardCount: this.config.shardCount,
      cacheSize: this.readCache.size,
      flushing: this.flushing
    };
  }

  // 캐시 정리
  cleanCache() {
    const now = Date.now();
    for (const [key, value] of this.readCache) {
      if (value.expiry < now) {
        this.readCache.delete(key);
      }
    }
  }

  // 종료
  close() {
    clearInterval(this.flushTimer);
    this.flushSync();

    for (const [index, db] of this.shards) {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    }

    console.log('[kimdb] HyperScale closed');
  }
}

// ===== 10000명 동시 처리 테스트 헬퍼 =====

async function benchmarkHyperScale(db, count = 10000) {
  console.log(`[benchmark] Starting ${count} concurrent writes...`);

  const start = Date.now();
  const promises = [];

  for (let i = 0; i < count; i++) {
    promises.push(
      Promise.resolve(db.write('benchmark', `user_${i}`, {
        name: `User ${i}`,
        timestamp: Date.now()
      }))
    );
  }

  await Promise.all(promises);
  const writeTime = Date.now() - start;

  console.log(`[benchmark] ${count} writes buffered in ${writeTime}ms`);
  console.log(`[benchmark] Throughput: ${Math.round(count / writeTime * 1000)} writes/sec`);

  // 플러시 대기
  const flushStart = Date.now();
  db.flushSync();
  const flushTime = Date.now() - flushStart;

  console.log(`[benchmark] Flush completed in ${flushTime}ms`);
  console.log(`[benchmark] Total time: ${writeTime + flushTime}ms`);

  return {
    count,
    writeTime,
    flushTime,
    totalTime: writeTime + flushTime,
    throughput: Math.round(count / (writeTime + flushTime) * 1000)
  };
}

export { HyperScaleDB, benchmarkHyperScale };
export default HyperScaleDB;

console.log('[kimdb] HyperScale module loaded');
