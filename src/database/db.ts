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
  'PRAGMA mmap_size = 268435456',  // 256MB 메모리 맵
  'PRAGMA page_size = 4096',
  'PRAGMA auto_vacuum = INCREMENTAL',
  'PRAGMA busy_timeout = 5000',    // 5초 대기
];

class DatabasePool {
  private pool: Database.Database[] = [];
  private inUse: Set<Database.Database> = new Set();
  private dbPath: string;
  private maxConnections: number;
  
  constructor(dbPath: string, maxConnections: number = 10) {
    this.dbPath = dbPath;
    this.maxConnections = maxConnections;
    this.initPool();
  }
  
  private initPool(): void {
    for (let i = 0; i < this.maxConnections; i++) {
      const db = this.createConnection();
      this.pool.push(db);
    }
    console.log(`📊 DB Pool initialized: ${this.maxConnections} connections`);
  }
  
  private createConnection(): Database.Database {
    const db = new Database(this.dbPath);
    
    // 성능 PRAGMA 적용
    PRAGMAS.forEach(pragma => {
      try {
        db.pragma(pragma.replace('PRAGMA ', ''));
      } catch (e) {
        // 일부 PRAGMA는 무시
      }
    });
    
    return db;
  }
  
  acquire(): Database.Database {
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
  
  release(db: Database.Database): void {
    this.inUse.delete(db);
  }
  
  // 트랜잭션 래퍼
  async transaction<T>(fn: (db: Database.Database) => T): Promise<T> {
    const db = this.acquire();
    try {
      return db.transaction(fn)(db);
    } finally {
      this.release(db);
    }
  }
  
  // 쿼리 실행
  query<T>(sql: string, params: any[] = []): T[] {
    const db = this.acquire();
    try {
      const stmt = db.prepare(sql);
      return stmt.all(...params) as T[];
    } finally {
      this.release(db);
    }
  }
  
  // 단일 결과
  get<T>(sql: string, params: any[] = []): T | undefined {
    const db = this.acquire();
    try {
      const stmt = db.prepare(sql);
      return stmt.get(...params) as T | undefined;
    } finally {
      this.release(db);
    }
  }
  
  // 실행 (INSERT, UPDATE, DELETE)
  run(sql: string, params: any[] = []): Database.RunResult {
    const db = this.acquire();
    try {
      const stmt = db.prepare(sql);
      return stmt.run(...params);
    } finally {
      this.release(db);
    }
  }
  
  // 전문검색
  search(query: string, limit: number = 20): any[] {
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
    } finally {
      this.release(db);
    }
  }
  
  // 통계
  stats(): { poolSize: number; inUse: number; available: number } {
    return {
      poolSize: this.pool.length,
      inUse: this.inUse.size,
      available: this.pool.length - this.inUse.size
    };
  }
  
  // 정리
  close(): void {
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
