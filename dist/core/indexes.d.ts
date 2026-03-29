/**
 * 🔥 Custom Firestore DB - Index System
 * 완전 자체 구현 인덱스 시스템
 *
 * 핵심 기능:
 * - 복합 인덱스 자동 생성/관리
 * - 쿼리 → 인덱스 매칭 (정확히 일치해야 함)
 * - dealerId 파티셔닝 지원
 * - 인덱스 제안 시스템 (개발자 가이드)
 */
import { Document } from './storage.js';
import { EventEmitter } from 'events';
export interface IndexDefinition {
    name: string;
    collection: string;
    fields: IndexField[];
    isUnique?: boolean;
    dealerId?: string;
}
export interface IndexField {
    field: string;
    direction: 'asc' | 'desc';
}
export interface QuerySpec {
    collection: string;
    where: WhereClause[];
    orderBy: OrderByClause[];
    dealerId: string;
}
export interface WhereClause {
    field: string;
    operator: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'array-contains';
    value: any;
}
export interface OrderByClause {
    field: string;
    direction: 'asc' | 'desc';
}
export interface IndexEntry {
    indexName: string;
    key: any[];
    documentPath: string;
    dealerId: string;
}
export interface QueryPlan {
    indexName: string;
    indexUsed: boolean;
    scanType: 'index' | 'collection';
    estimatedCost: number;
    suggestions?: string[];
}
/**
 * 인덱스 시스템 - 쿼리 성능의 핵심
 *
 * 설계 원칙:
 * 1. 쿼리와 인덱스가 정확히 매칭되어야 함 (where 순서 + orderBy)
 * 2. dealerId는 모든 인덱스의 첫 번째 필드 (파티셔닝)
 * 3. 인덱스 없는 쿼리는 거부 + 제안 제공
 * 4. 복합 인덱스만 지원 (단일 필드도 복합으로 처리)
 * 5. 인덱스 생성은 동기적 (작은 규모이므로)
 */
export declare class IndexSystem extends EventEmitter {
    private indexes;
    private indexEntries;
    private stats;
    constructor();
    /**
     * 인덱스 정의 등록
     */
    createIndex(definition: IndexDefinition): Promise<void>;
    /**
     * 쿼리 실행 (인덱스 사용)
     */
    executeQuery(querySpec: QuerySpec): Promise<Document[]>;
    /**
     * 쿼리 계획 수립
     */
    planQuery(querySpec: QuerySpec): QueryPlan;
    /**
     * 인덱스 제안 생성
     */
    suggestIndexes(querySpec: QuerySpec): string[];
    /**
     * 인덱스와 매칭되는지 확인
     */
    private findMatchingIndexes;
    /**
     * 인덱스가 쿼리와 매칭되는지 확인
     */
    private isIndexMatching;
    /**
     * 인덱스 매칭 점수 계산
     */
    private calculateMatchScore;
    /**
     * 인덱스를 사용한 쿼리 실행
     */
    private executeIndexQuery;
    /**
     * 인덱스 엔트리가 쿼리와 매칭되는지 확인
     */
    private entryMatchesQuery;
    /**
     * 문서 변경 시 인덱스 업데이트
     */
    private updateIndexesForDocument;
    /**
     * 인덱스 재구축 (기존 문서들에 대해)
     */
    private rebuildIndex;
    /**
     * 컬렉션의 모든 문서 조회 (인덱스 구축용)
     */
    private getAllDocumentsInCollection;
    /**
     * 문서에서 인덱스 키 추출
     */
    private extractIndexKey;
    /**
     * 중첩된 필드 값 가져오기 (schedule.date 등)
     */
    private getNestedValue;
    /**
     * 인덱스 비용 추정
     */
    private estimateIndexCost;
    private makeIndexKey;
    private makeEntryKey;
    /**
     * 통계 정보
     */
    getStats(): {
        entriesCount: number;
        indexHits: number;
        collectionScans: number;
        indexesCount: number;
    };
    /**
     * 모든 인덱스 정보
     */
    getAllIndexes(): IndexDefinition[];
}
export declare const indexSystem: IndexSystem;
//# sourceMappingURL=indexes.d.ts.map