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
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
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
export class StorageEngine extends EventEmitter {
    documents = new Map();
    changeLog = [];
    idempotencyCache = new Map();
    transactions = new Map();
    // 성능 통계
    stats = {
        reads: 0,
        writes: 0,
        conflicts: 0,
        transactions: 0
    };
    constructor() {
        super();
        // 멱등성 캐시 정리 (10분마다)
        setInterval(() => this.cleanIdempotencyCache(), 10 * 60 * 1000);
    }
    /**
     * 문서 읽기 (단일)
     */
    async getDocument(path, dealerId) {
        this.stats.reads++;
        const key = this.makeKey(path, dealerId);
        const doc = this.documents.get(key);
        if (!doc || doc.dealerId !== dealerId) {
            return null;
        }
        return { ...doc }; // 복사본 반환 (불변성)
    }
    /**
     * 문서 생성
     */
    async createDocument(path, data, dealerId, userId, options = {}) {
        // 멱등성 체크
        if (options.idempotencyKey) {
            const cached = this.checkIdempotency(options.idempotencyKey);
            if (cached)
                return cached.result;
        }
        const key = this.makeKey(path, dealerId);
        // 이미 존재하는 문서인지 확인
        if (this.documents.has(key)) {
            throw new Error(`Document already exists: ${path}`);
        }
        const doc = {
            id: this.extractIdFromPath(path),
            path,
            collection: this.extractCollectionFromPath(path),
            data: JSON.parse(JSON.stringify(data)), // 깊은 복사
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
            dealerId
        };
        // 저장
        this.documents.set(key, doc);
        this.stats.writes++;
        // 변경 로그
        const logEntry = {
            id: randomUUID(),
            timestamp: new Date(),
            dealerId,
            userId,
            operation: 'create',
            path,
            after: doc.data,
            version: doc.version,
            idempotencyKey: options.idempotencyKey
        };
        this.changeLog.push(logEntry);
        // 멱등성 캐시
        if (options.idempotencyKey) {
            this.cacheIdempotency(options.idempotencyKey, doc);
        }
        // 이벤트 발생 (실시간 구독용)
        this.emit('documentChange', {
            type: 'created',
            document: doc,
            dealerId
        });
        return { ...doc };
    }
    /**
     * 문서 업데이트
     */
    async updateDocument(path, data, dealerId, userId, options = {}) {
        // 멱등성 체크
        if (options.idempotencyKey) {
            const cached = this.checkIdempotency(options.idempotencyKey);
            if (cached)
                return cached.result;
        }
        const key = this.makeKey(path, dealerId);
        const existingDoc = this.documents.get(key);
        if (!existingDoc || existingDoc.dealerId !== dealerId) {
            throw new Error(`Document not found: ${path}`);
        }
        // 옵티미스틱 락 체크
        if (options.ifVersion && existingDoc.version !== options.ifVersion) {
            this.stats.conflicts++;
            throw new Error(`Version conflict: expected ${options.ifVersion}, got ${existingDoc.version}`);
        }
        const updatedDoc = {
            ...existingDoc,
            data: options.merge
                ? { ...existingDoc.data, ...data }
                : JSON.parse(JSON.stringify(data)),
            version: existingDoc.version + 1,
            updatedAt: new Date()
        };
        // 저장
        this.documents.set(key, updatedDoc);
        this.stats.writes++;
        // 변경 로그
        const logEntry = {
            id: randomUUID(),
            timestamp: new Date(),
            dealerId,
            userId,
            operation: 'update',
            path,
            before: existingDoc.data,
            after: updatedDoc.data,
            version: updatedDoc.version,
            idempotencyKey: options.idempotencyKey
        };
        this.changeLog.push(logEntry);
        // 멱등성 캐시
        if (options.idempotencyKey) {
            this.cacheIdempotency(options.idempotencyKey, updatedDoc);
        }
        // 이벤트 발생
        this.emit('documentChange', {
            type: 'modified',
            document: updatedDoc,
            oldDocument: existingDoc,
            dealerId
        });
        return { ...updatedDoc };
    }
    /**
     * 문서 삭제
     */
    async deleteDocument(path, dealerId, userId, options = {}) {
        // 멱등성 체크
        if (options.idempotencyKey) {
            const cached = this.checkIdempotency(options.idempotencyKey);
            if (cached)
                return;
        }
        const key = this.makeKey(path, dealerId);
        const existingDoc = this.documents.get(key);
        if (!existingDoc || existingDoc.dealerId !== dealerId) {
            // 삭제는 멱등 - 없는 문서 삭제해도 에러 안남
            return;
        }
        // 옵티미스틱 락 체크
        if (options.ifVersion && existingDoc.version !== options.ifVersion) {
            this.stats.conflicts++;
            throw new Error(`Version conflict: expected ${options.ifVersion}, got ${existingDoc.version}`);
        }
        // 삭제
        this.documents.delete(key);
        this.stats.writes++;
        // 변경 로그
        const logEntry = {
            id: randomUUID(),
            timestamp: new Date(),
            dealerId,
            userId,
            operation: 'delete',
            path,
            before: existingDoc.data,
            version: existingDoc.version,
            idempotencyKey: options.idempotencyKey
        };
        this.changeLog.push(logEntry);
        // 멱등성 캐시
        if (options.idempotencyKey) {
            this.cacheIdempotency(options.idempotencyKey, null);
        }
        // 이벤트 발생
        this.emit('documentChange', {
            type: 'removed',
            document: existingDoc,
            dealerId
        });
    }
    /**
     * 트랜잭션 시작
     */
    async beginTransaction(dealerId) {
        const transactionId = randomUUID();
        this.transactions.set(transactionId, {
            id: transactionId,
            dealerId,
            operations: [],
            readVersions: new Map(),
            startTime: new Date()
        });
        return transactionId;
    }
    /**
     * 트랜잭션에 작업 추가
     */
    async addToTransaction(transactionId, operation) {
        const tx = this.transactions.get(transactionId);
        if (!tx) {
            throw new Error(`Transaction not found: ${transactionId}`);
        }
        // 최대 500개 작업 제한
        if (tx.operations.length >= 500) {
            throw new Error('Transaction too large (max 500 operations)');
        }
        tx.operations.push(operation);
    }
    /**
     * 트랜잭션 커밋
     */
    async commitTransaction(transactionId, userId) {
        const tx = this.transactions.get(transactionId);
        if (!tx) {
            throw new Error(`Transaction not found: ${transactionId}`);
        }
        try {
            // 모든 읽기 버전 검증
            for (const [path, expectedVersion] of tx.readVersions) {
                const key = this.makeKey(path, tx.dealerId);
                const doc = this.documents.get(key);
                if (doc && doc.version !== expectedVersion) {
                    throw new Error(`Transaction conflict: ${path} version changed`);
                }
            }
            // 모든 작업 실행
            for (const op of tx.operations) {
                switch (op.type) {
                    case 'create':
                        await this.createDocument(op.path, op.data, tx.dealerId, userId, {
                            idempotencyKey: `tx:${transactionId}:${op.path}`
                        });
                        break;
                    case 'update':
                        await this.updateDocument(op.path, op.data, tx.dealerId, userId, {
                            ifVersion: op.ifVersion,
                            idempotencyKey: `tx:${transactionId}:${op.path}`
                        });
                        break;
                    case 'delete':
                        await this.deleteDocument(op.path, tx.dealerId, userId, {
                            ifVersion: op.ifVersion,
                            idempotencyKey: `tx:${transactionId}:${op.path}`
                        });
                        break;
                }
            }
            this.stats.transactions++;
        }
        finally {
            // 트랜잭션 정리
            this.transactions.delete(transactionId);
        }
    }
    /**
     * 컬렉션의 모든 문서 조회 (기본 - 인덱스 없이)
     */
    async getDocuments(collection, dealerId) {
        const results = [];
        for (const [key, doc] of this.documents) {
            if (doc.collection === collection && doc.dealerId === dealerId) {
                results.push({ ...doc });
            }
        }
        this.stats.reads++;
        return results;
    }
    /**
     * 변경 로그 조회
     */
    getChangeLog(dealerId, since) {
        return this.changeLog.filter(entry => entry.dealerId === dealerId &&
            (!since || entry.timestamp > since));
    }
    /**
     * 통계 정보
     */
    getStats() {
        return {
            ...this.stats,
            documentsCount: this.documents.size,
            changeLogCount: this.changeLog.length,
            activeTransactions: this.transactions.size
        };
    }
    // === 유틸리티 메서드들 ===
    makeKey(path, dealerId) {
        return `${dealerId}:${path}`;
    }
    extractIdFromPath(path) {
        const parts = path.split('/');
        return parts[parts.length - 1];
    }
    extractCollectionFromPath(path) {
        const parts = path.split('/');
        return parts[parts.length - 2];
    }
    checkIdempotency(key) {
        return this.idempotencyCache.get(key) || null;
    }
    cacheIdempotency(key, result) {
        this.idempotencyCache.set(key, {
            result,
            timestamp: new Date()
        });
    }
    cleanIdempotencyCache() {
        const cutoff = new Date(Date.now() - 10 * 60 * 1000); // 10분 전
        for (const [key, entry] of this.idempotencyCache) {
            if (entry.timestamp < cutoff) {
                this.idempotencyCache.delete(key);
            }
        }
    }
}
// 싱글톤 인스턴스
export const storage = new StorageEngine();
//# sourceMappingURL=storage.js.map