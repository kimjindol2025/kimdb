/**
 * kimdb Database Layer
 *
 * SQLite 래퍼 + 컬렉션 관리
 */
import Database from 'better-sqlite3';
import type { Config } from './config.js';
import type { DocumentRow, Collection } from '../shared/types.js';
export declare class KimDatabase {
    private db;
    private config;
    constructor(config: Config);
    /**
     * 기본 스키마 생성
     */
    private ensureSchema;
    /**
     * 컬렉션 존재 확인 및 생성
     */
    ensureCollection(name: string): string;
    /**
     * 모든 컬렉션 목록
     */
    getCollections(): Collection[];
    /**
     * 문서 조회
     */
    getDocument(collection: string, id: string): DocumentRow | null;
    /**
     * 문서 목록 조회
     */
    getDocuments(collection: string, limit?: number): DocumentRow[];
    /**
     * 문서 저장 (upsert)
     */
    saveDocument(collection: string, id: string, data: string, crdtState?: string): void;
    /**
     * 문서 삭제 (soft delete)
     */
    deleteDocument(collection: string, id: string): boolean;
    /**
     * 동기화 로그 추가
     */
    addSyncLog(collection: string, docId: string, operation: string, data: string | null, clientId: string | null): void;
    /**
     * 동기화 로그 조회
     */
    getSyncLogs(collection: string, since: number, limit?: number): unknown[];
    /**
     * 최신 동기화 타임스탬프
     */
    getLatestSyncTs(collection: string): number;
    /**
     * 원시 쿼리 실행 (읽기)
     */
    query<T>(sql: string, params?: unknown[]): T[];
    /**
     * 원시 쿼리 실행 (쓰기)
     */
    execute(sql: string, params?: unknown[]): Database.RunResult;
    /**
     * WAL 체크포인트
     */
    checkpoint(): void;
    /**
     * 데이터베이스 닫기
     */
    close(): void;
    /**
     * 내부 DB 접근 (고급 사용)
     */
    get raw(): Database.Database;
}
//# sourceMappingURL=database.d.ts.map