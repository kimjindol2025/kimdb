/**
 * 🔥 Custom Firestore DB - Storage Engine
 * 완전 자체 구현 문서 저장소
 *
 * 핵심 기능:
 * - 문서 CRUD + 버전 관리 (옵티미스틱 락)
 * - 멀티테넌트 파티셔닝 (dealerId 기반)
 * - 변경 로그 + 트랜잭션 안전성
 * - 멱등성 보장
 */
import { EventEmitter } from 'events';
export interface Document {
    id: string;
    path: string;
    collection: string;
    data: any;
    version: number;
    createdAt: Date;
    updatedAt: Date;
    dealerId: string;
}
export interface WriteOptions {
    ifVersion?: number;
    idempotencyKey?: string;
    merge?: boolean;
}
export interface TransactionContext {
    id: string;
    dealerId: string;
    operations: TransactionOperation[];
    readVersions: Map<string, number>;
    startTime: Date;
}
export interface TransactionOperation {
    type: 'create' | 'update' | 'delete';
    path: string;
    data?: any;
    ifVersion?: number;
}
export interface ChangeLogEntry {
    id: string;
    timestamp: Date;
    dealerId: string;
    userId?: string;
    operation: 'create' | 'update' | 'delete';
    path: string;
    before?: any;
    after?: any;
    version: number;
    transactionId?: string;
    idempotencyKey?: string;
}
/**
 * 스토리지 엔진 - 모든 데이터 작업의 핵심
 *
 * 설계 원칙:
 * 1. 모든 문서는 dealerId로 파티셔닝
 * 2. 버전 충돌 시 명시적 에러 (자동 머지 없음)
 * 3. 모든 변경사항을 change_log에 기록
 * 4. 트랜잭션은 최대 500개 작업으로 제한
 * 5. 멱등성 키로 중복 작업 방지
 */
export declare class StorageEngine extends EventEmitter {
    private documents;
    private changeLog;
    private idempotencyCache;
    private transactions;
    private stats;
    constructor();
    /**
     * 문서 읽기 (단일)
     */
    getDocument(path: string, dealerId: string): Promise<Document | null>;
    /**
     * 문서 생성
     */
    createDocument(path: string, data: any, dealerId: string, userId?: string, options?: WriteOptions): Promise<Document>;
    /**
     * 문서 업데이트
     */
    updateDocument(path: string, data: any, dealerId: string, userId?: string, options?: WriteOptions): Promise<Document>;
    /**
     * 문서 삭제
     */
    deleteDocument(path: string, dealerId: string, userId?: string, options?: WriteOptions): Promise<void>;
    /**
     * 트랜잭션 시작
     */
    beginTransaction(dealerId: string): Promise<string>;
    /**
     * 트랜잭션에 작업 추가
     */
    addToTransaction(transactionId: string, operation: TransactionOperation): Promise<void>;
    /**
     * 트랜잭션 커밋
     */
    commitTransaction(transactionId: string, userId?: string): Promise<void>;
    /**
     * 컬렉션의 모든 문서 조회 (기본 - 인덱스 없이)
     */
    getDocuments(collection: string, dealerId: string): Promise<Document[]>;
    /**
     * 변경 로그 조회
     */
    getChangeLog(dealerId: string, since?: Date): ChangeLogEntry[];
    /**
     * 통계 정보
     */
    getStats(): {
        documentsCount: number;
        changeLogCount: number;
        activeTransactions: number;
        reads: number;
        writes: number;
        conflicts: number;
        transactions: number;
    };
    private makeKey;
    private extractIdFromPath;
    private extractCollectionFromPath;
    private checkIdempotency;
    private cacheIdempotency;
    private cleanIdempotencyCache;
}
export declare const storage: StorageEngine;
//# sourceMappingURL=storage.d.ts.map