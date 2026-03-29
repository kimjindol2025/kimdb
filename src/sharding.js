/**
 * kimdb Sharding Module
 * SQLite 다중 인스턴스로 동시 쓰기 한계 극복
 *
 * 목표: 동시 1000명+ 처리
 * 원리: 4개 샤드 = 4배 쓰기 처리량
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

class ShardManager {
  constructor(options = {}) {
    this.shardCount = options.shardCount || 4;
    this.dbDir = options.dbDir || './shards';
    this.shards = new Map();
    this.writeQueues = new Map();
    this.stats = {
      writes: Array(this.shardCount).fill(0),
      reads: Array(this.shardCount).fill(0),
      totalWrites: 0,
      totalReads: 0
    };
  }

  // 샤드 초기화
  init() {
    if (!existsSync(this.dbDir)) mkdirSync(this.dbDir, { recursive: true });

    for (let i = 0; i < this.shardCount; i++) {
      const dbPath = join(this.dbDir, `shard_${i}.db`);
      const db = new Database(dbPath);

      // WAL 모드 + 최적화
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.pragma('cache_size = 10000');
      db.pragma('busy_timeout = 30000');
      db.pragma('mmap_size = 268435456');

      this.shards.set(i, db);
      this.writeQueues.set(i, { queue: [], processing: false });
    }

    console.log(`[kimdb] Sharding initialized: ${this.shardCount} shards`);
    return this;
  }

  // 샤드 결정 (해시 기반)
  getShardIndex(key) {
    const hash = crypto.createHash('md5').update(String(key)).digest('hex');
    return parseInt(hash.slice(0, 8), 16) % this.shardCount;
  }

  // 샤드 DB 가져오기
  getShard(key) {
    const index = this.getShardIndex(key);
    return { db: this.shards.get(index), index };
  }

  // 쓰기 (큐 기반, 샤드별 병렬)
  async write(key, operation) {
    const index = this.getShardIndex(key);
    const db = this.shards.get(index);
    const queueObj = this.writeQueues.get(index);

    return new Promise((resolve, reject) => {
      queueObj.queue.push({ operation, db, resolve, reject });
      this.processQueue(index);
    });
  }

  async processQueue(shardIndex) {
    const queueObj = this.writeQueues.get(shardIndex);
    if (queueObj.processing || queueObj.queue.length === 0) return;

    queueObj.processing = true;

    while (queueObj.queue.length > 0) {
      const { operation, db, resolve, reject } = queueObj.queue.shift();
      try {
        const result = operation(db);
        this.stats.writes[shardIndex]++;
        this.stats.totalWrites++;
        resolve(result);
      } catch (e) {
        reject(e);
      }
    }

    queueObj.processing = false;
  }

  // 읽기 (직접 접근, 병렬 가능)
  read(key, operation) {
    const index = this.getShardIndex(key);
    const db = this.shards.get(index);
    this.stats.reads[index]++;
    this.stats.totalReads++;
    return operation(db);
  }

  // 테이블 생성 (모든 샤드에)
  createTable(sql) {
    for (const [index, db] of this.shards) {
      db.exec(sql);
    }
    console.log(`[kimdb] Table created on ${this.shardCount} shards`);
  }

  // 전체 조회 (모든 샤드에서 병렬)
  queryAll(operation) {
    const results = [];
    for (const [index, db] of this.shards) {
      const data = operation(db);
      if (Array.isArray(data)) results.push(...data);
      else results.push(data);
    }
    return results;
  }

  // 트랜잭션 (단일 샤드 내)
  async transaction(key, operations) {
    const index = this.getShardIndex(key);

    return this.write(key, (db) => {
      const tx = db.transaction(() => {
        const results = [];
        for (const op of operations) {
          results.push(op(db));
        }
        return results;
      });
      return tx();
    });
  }

  // 통계
  getStats() {
    return {
      shardCount: this.shardCount,
      ...this.stats,
      queueLengths: Array.from(this.writeQueues.values()).map(q => q.queue.length)
    };
  }

  // 리밸런싱 (샤드 추가 시)
  async rebalance(newShardCount) {
    // TODO: 데이터 마이그레이션
    console.log('[kimdb] Rebalancing not implemented yet');
  }

  // 종료
  close() {
    for (const [index, db] of this.shards) {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    }
    console.log('[kimdb] All shards closed');
  }
}

// ===== 샤딩된 컬렉션 =====
class ShardedCollection {
  constructor(shardManager, name) {
    this.sm = shardManager;
    this.name = name;
    this.init();
  }

  init() {
    const tableName = this.name;
    this.sm.createTable(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        _version INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  async insert(id, data) {
    const docId = id || crypto.randomUUID();
    const tableName = this.name;

    await this.sm.write(docId, (db) => {
      db.prepare(`INSERT INTO ${tableName} (id, data) VALUES (?, ?)`)
        .run(docId, JSON.stringify(data));
    });
    return { id: docId, _version: 1 };
  }

  async update(id, data) {
    const tableName = this.name;

    return this.sm.write(id, (db) => {
      const existing = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(id);
      if (!existing) throw new Error('Not found');

      const merged = { ...JSON.parse(existing.data), ...data };
      const newVersion = existing._version + 1;

      db.prepare(`UPDATE ${tableName} SET data = ?, _version = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(JSON.stringify(merged), newVersion, id);

      return { id, _version: newVersion };
    });
  }

  get(id) {
    const tableName = this.name;

    return this.sm.read(id, (db) => {
      const row = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(id);
      if (!row) return null;
      return { id: row.id, data: JSON.parse(row.data), _version: row._version };
    });
  }

  getAll(limit = 100) {
    const tableName = this.name;
    const perShard = Math.ceil(limit / this.sm.shardCount);

    return this.sm.queryAll((db) => {
      return db.prepare(`SELECT * FROM ${tableName} ORDER BY updated_at DESC LIMIT ?`).all(perShard);
    }).map(row => ({
      id: row.id,
      data: JSON.parse(row.data),
      _version: row._version
    })).slice(0, limit);
  }

  async delete(id) {
    const tableName = this.name;

    return this.sm.write(id, (db) => {
      db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(id);
      return { id, deleted: true };
    });
  }

  // 배치 삽입 (고성능)
  async batchInsert(documents) {
    const results = [];
    const byShardIndex = new Map();

    // 샤드별로 그룹화
    for (const doc of documents) {
      const docId = doc.id || crypto.randomUUID();
      const index = this.sm.getShardIndex(docId);

      if (!byShardIndex.has(index)) byShardIndex.set(index, []);
      byShardIndex.get(index).push({ id: docId, data: doc.data || doc });
    }

    // 샤드별 병렬 삽입
    const tableName = this.name;
    const promises = [];

    for (const [shardIndex, docs] of byShardIndex) {
      const promise = this.sm.write(docs[0].id, (db) => {
        const tx = db.transaction(() => {
          const stmt = db.prepare(`INSERT INTO ${tableName} (id, data) VALUES (?, ?)`);
          const inserted = [];
          for (const { id, data } of docs) {
            stmt.run(id, JSON.stringify(data));
            inserted.push({ id, _version: 1 });
          }
          return inserted;
        });
        return tx();
      });
      promises.push(promise);
    }

    const allResults = await Promise.all(promises);
    return allResults.flat();
  }

  // 카운트
  count() {
    const tableName = this.name;
    let total = 0;

    for (const [index, db] of this.sm.shards) {
      const row = db.prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`).get();
      total += row.cnt;
    }
    return total;
  }
}

export { ShardManager, ShardedCollection };
export default ShardManager;

console.log('[kimdb] Sharding module loaded');
