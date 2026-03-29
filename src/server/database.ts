/**
 * kimdb Database Layer
 *
 * SQLite 래퍼 + 컬렉션 관리
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import type { Config } from './config.js';
import type { DocumentRow, Collection } from '../shared/types.js';

export class KimDatabase {
  private db: Database.Database;
  private config: Config;

  constructor(config: Config) {
    this.config = config;

    // 데이터 디렉토리 생성
    const dbDir = config.dataDir;
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    const dbPath = join(dbDir, 'kimdb.sqlite');
    this.db = new Database(dbPath);

    // SQLite 최적화 설정
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = 10000');
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma('mmap_size = 268435456');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('wal_autocheckpoint = 1000');

    this.ensureSchema();
  }

  /**
   * 기본 스키마 생성
   */
  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _collections (
        name TEXT PRIMARY KEY,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS _sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection TEXT NOT NULL,
        doc_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        data TEXT,
        client_id TEXT,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sync_log_ts ON _sync_log(collection, ts);
    `);

    console.log('[kimdb] Database schema initialized');
  }

  /**
   * 컬렉션 존재 확인 및 생성
   */
  ensureCollection(name: string): string {
    const safeName = name.replace(/[^a-zA-Z0-9_]/g, '');
    if (safeName !== name || safeName.startsWith('_') || safeName.startsWith('sqlite')) {
      throw new Error(`Invalid collection name: ${name}`);
    }

    const exists = this.db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    ).get(safeName);

    if (!exists) {
      this.db.exec(`
        CREATE TABLE ${safeName} (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          crdt_state TEXT,
          _version INTEGER DEFAULT 1,
          _deleted INTEGER DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      this.db.prepare(`INSERT OR IGNORE INTO _collections (name) VALUES (?)`).run(safeName);
      console.log(`[kimdb] Collection created: ${safeName}`);
    } else {
      // crdt_state 컬럼 추가 (이전 버전 호환)
      try {
        this.db.exec(`ALTER TABLE ${safeName} ADD COLUMN crdt_state TEXT`);
      } catch {
        // 이미 존재하면 무시
      }
    }

    return safeName;
  }

  /**
   * 모든 컬렉션 목록
   */
  getCollections(): Collection[] {
    return this.db.prepare(`SELECT name, created_at FROM _collections ORDER BY name`).all() as Collection[];
  }

  /**
   * 문서 조회
   */
  getDocument(collection: string, id: string): DocumentRow | null {
    const col = this.ensureCollection(collection);
    return this.db.prepare(
      `SELECT * FROM ${col} WHERE id = ? AND _deleted = 0`
    ).get(id) as DocumentRow | null;
  }

  /**
   * 문서 목록 조회
   */
  getDocuments(collection: string, limit = 1000): DocumentRow[] {
    const col = this.ensureCollection(collection);
    return this.db.prepare(
      `SELECT id, data, crdt_state, _version FROM ${col} WHERE _deleted = 0 AND id != '_index' LIMIT ?`
    ).all(limit) as DocumentRow[];
  }

  /**
   * 문서 저장 (upsert)
   */
  saveDocument(collection: string, id: string, data: string, crdtState?: string): void {
    const col = this.ensureCollection(collection);
    this.db.prepare(`
      INSERT INTO ${col} (id, data, crdt_state, _version, _deleted, created_at, updated_at)
      VALUES (?, ?, ?, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        data = excluded.data,
        crdt_state = excluded.crdt_state,
        _version = _version + 1,
        updated_at = CURRENT_TIMESTAMP
    `).run(id, data, crdtState || null);
  }

  /**
   * 문서 삭제 (soft delete)
   */
  deleteDocument(collection: string, id: string): boolean {
    const col = this.ensureCollection(collection);
    const result = this.db.prepare(
      `UPDATE ${col} SET _deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(id);
    return result.changes > 0;
  }

  /**
   * 동기화 로그 추가
   */
  addSyncLog(collection: string, docId: string, operation: string, data: string | null, clientId: string | null): void {
    this.db.prepare(
      `INSERT INTO _sync_log (collection, doc_id, operation, data, client_id, ts) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(collection, docId, operation, data, clientId, Date.now());
  }

  /**
   * 동기화 로그 조회
   */
  getSyncLogs(collection: string, since: number, limit = 1000): unknown[] {
    return this.db.prepare(
      `SELECT * FROM _sync_log WHERE collection = ? AND ts > ? ORDER BY ts ASC LIMIT ?`
    ).all(collection, since, limit);
  }

  /**
   * 최신 동기화 타임스탬프
   */
  getLatestSyncTs(collection: string): number {
    const result = this.db.prepare(
      `SELECT MAX(ts) as ts FROM _sync_log WHERE collection = ?`
    ).get(collection) as { ts: number | null };
    return result?.ts || 0;
  }

  /**
   * 원시 쿼리 실행 (읽기)
   */
  query<T>(sql: string, params: unknown[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  /**
   * 원시 쿼리 실행 (쓰기)
   */
  execute(sql: string, params: unknown[] = []): Database.RunResult {
    return this.db.prepare(sql).run(...params);
  }

  /**
   * WAL 체크포인트
   */
  checkpoint(): void {
    this.db.pragma('wal_checkpoint(PASSIVE)');
  }

  /**
   * 데이터베이스 닫기
   */
  close(): void {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
    this.db.close();
  }

  /**
   * 내부 DB 접근 (고급 사용)
   */
  get raw(): Database.Database {
    return this.db;
  }
}
