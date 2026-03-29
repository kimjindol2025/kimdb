/**
 * kimdb - 고성능 데이터베이스 설정
 * 커넥션 풀링 + 성능 최적화
 */
import Database from 'better-sqlite3';
import { join } from 'path';
// 성능 최적화 PRAGMA 설정
const PRAGMAS = [
    'PRAGMA journal_mode = WAL',
    'PRAGMA synchronous = NORMAL',
    'PRAGMA cache_size = 10000',
    'PRAGMA temp_store = MEMORY',
    'PRAGMA mmap_size = 268435456', // 256MB 메모리 맵
    'PRAGMA page_size = 4096',
    'PRAGMA auto_vacuum = INCREMENTAL',
    'PRAGMA busy_timeout = 5000', // 5초 대기
];
class DatabasePool {
    pool = [];
    inUse = new Set();
    dbPath;
    maxConnections;
    constructor(dbPath, maxConnections = 10) {
        this.dbPath = dbPath;
        this.maxConnections = maxConnections;
        this.initPool();
    }
    initPool() {
        for (let i = 0; i < this.maxConnections; i++) {
            const db = this.createConnection();
            this.pool.push(db);
        }
        console.log(`📊 DB Pool initialized: ${this.maxConnections} connections`);
    }
    createConnection() {
        const db = new Database(this.dbPath);
        // 성능 PRAGMA 적용
        PRAGMAS.forEach(pragma => {
            try {
                db.pragma(pragma.replace('PRAGMA ', ''));
            }
            catch (e) {
                // 일부 PRAGMA는 무시
            }
        });
        return db;
    }
    acquire() {
        const available = this.pool.find(db => !this.inUse.has(db));
        if (available) {
            this.inUse.add(available);
            return available;
        }
        // 풀이 꽉 찼으면 새 커넥션 (임시)
        if (this.pool.length < this.maxConnections * 2) {
            const db = this.createConnection();
            this.pool.push(db);
            this.inUse.add(db);
            return db;
        }
        throw new Error('Database pool exhausted');
    }
    release(db) {
        this.inUse.delete(db);
    }
    // 트랜잭션 래퍼
    async transaction(fn) {
        const db = this.acquire();
        try {
            return db.transaction(fn)(db);
        }
        finally {
            this.release(db);
        }
    }
    // 쿼리 실행
    query(sql, params = []) {
        const db = this.acquire();
        try {
            const stmt = db.prepare(sql);
            return stmt.all(...params);
        }
        finally {
            this.release(db);
        }
    }
    // 단일 결과
    get(sql, params = []) {
        const db = this.acquire();
        try {
            const stmt = db.prepare(sql);
            return stmt.get(...params);
        }
        finally {
            this.release(db);
        }
    }
    // 실행 (INSERT, UPDATE, DELETE)
    run(sql, params = []) {
        const db = this.acquire();
        try {
            const stmt = db.prepare(sql);
            return stmt.run(...params);
        }
        finally {
            this.release(db);
        }
    }
    // 전문검색
    search(query, limit = 20) {
        const db = this.acquire();
        const startTime = Date.now();
        try {
            const stmt = db.prepare(`
        SELECT doc_id, title, content, tags, category,
               bm25(fts_documents) as score
        FROM fts_documents
        WHERE fts_documents MATCH ?
        ORDER BY score
        LIMIT ?
      `);
            const results = stmt.all(query, limit);
            // 검색 로그 저장
            const elapsed = Date.now() - startTime;
            db.prepare(`
        INSERT INTO search_logs (query, results_count, search_time_ms)
        VALUES (?, ?, ?)
      `).run(query, results.length, elapsed);
            return results;
        }
        finally {
            this.release(db);
        }
    }
    // 통계
    stats() {
        return {
            poolSize: this.pool.length,
            inUse: this.inUse.size,
            available: this.pool.length - this.inUse.size
        };
    }
    // 정리
    close() {
        this.pool.forEach(db => db.close());
        this.pool = [];
        this.inUse.clear();
        console.log('📊 DB Pool closed');
    }
}
// 싱글톤 인스턴스
const DB_PATH = join(process.cwd(), 'shared_database', 'code_team_ai.db');
export const dbPool = new DatabasePool(DB_PATH, 10);
export default dbPool;
//# sourceMappingURL=db.js.map