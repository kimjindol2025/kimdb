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
import { storage } from './storage.js';
import { EventEmitter } from 'events';
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
export class IndexSystem extends EventEmitter {
    indexes = new Map();
    indexEntries = new Map();
    // 성능 통계
    stats = {
        indexHits: 0,
        collectionScans: 0,
        indexesCount: 0,
        entriesCount: 0
    };
    constructor() {
        super();
        // 스토리지 변경 이벤트 구독 (인덱스 업데이트)
        storage.on('documentChange', (event) => {
            this.updateIndexesForDocument(event);
        });
    }
    /**
     * 인덱스 정의 등록
     */
    async createIndex(definition) {
        // dealerId 필드가 첫 번째에 없으면 자동 추가
        if (!definition.fields.find(f => f.field === '__dealerId')) {
            definition.fields.unshift({
                field: '__dealerId',
                direction: 'asc'
            });
        }
        const indexKey = this.makeIndexKey(definition);
        this.indexes.set(indexKey, definition);
        this.indexEntries.set(indexKey, new Map());
        // 기존 문서들에 대해 인덱스 구축
        await this.rebuildIndex(definition);
        this.stats.indexesCount++;
        console.log(`✅ Index created: ${definition.name} on ${definition.collection}`);
        console.log(`   Fields: ${definition.fields.map(f => `${f.field} ${f.direction}`).join(', ')}`);
    }
    /**
     * 쿼리 실행 (인덱스 사용)
     */
    async executeQuery(querySpec) {
        const queryPlan = this.planQuery(querySpec);
        if (!queryPlan.indexUsed) {
            // 인덱스 없는 쿼리는 거부
            const suggestions = this.suggestIndexes(querySpec);
            throw new Error(`Query requires an index. Missing index:\n` +
                `Collection: ${querySpec.collection}\n` +
                `Fields: ${suggestions.join(', ')}\n\n` +
                `Add this index to your schema:\n` +
                `{\n` +
                `  "name": "${querySpec.collection}_${suggestions.join('_')}",\n` +
                `  "collection": "${querySpec.collection}",\n` +
                `  "fields": [\n` +
                suggestions.map(f => `    { "field": "${f}", "direction": "asc" }`).join(',\n') + '\n' +
                `  ]\n` +
                `}`);
        }
        return this.executeIndexQuery(queryPlan.indexName, querySpec);
    }
    /**
     * 쿼리 계획 수립
     */
    planQuery(querySpec) {
        const candidateIndexes = this.findMatchingIndexes(querySpec);
        if (candidateIndexes.length === 0) {
            return {
                indexName: '',
                indexUsed: false,
                scanType: 'collection',
                estimatedCost: 999999,
                suggestions: this.suggestIndexes(querySpec)
            };
        }
        // 가장 적합한 인덱스 선택 (완전 매치 우선)
        const bestIndex = candidateIndexes[0];
        return {
            indexName: this.makeIndexKey(bestIndex),
            indexUsed: true,
            scanType: 'index',
            estimatedCost: this.estimateIndexCost(bestIndex, querySpec)
        };
    }
    /**
     * 인덱스 제안 생성
     */
    suggestIndexes(querySpec) {
        const fields = ['__dealerId']; // 항상 첫 번째
        // where 절 필드들 추가 (순서 중요)
        querySpec.where
            .filter(w => w.operator === '==') // 등호 조건 먼저
            .forEach(w => {
            if (!fields.includes(w.field)) {
                fields.push(w.field);
            }
        });
        // 범위 조건 필드들
        querySpec.where
            .filter(w => ['<', '<=', '>', '>='].includes(w.operator))
            .forEach(w => {
            if (!fields.includes(w.field)) {
                fields.push(w.field);
            }
        });
        // orderBy 필드들
        querySpec.orderBy.forEach(o => {
            if (!fields.includes(o.field)) {
                fields.push(o.field);
            }
        });
        return fields;
    }
    /**
     * 인덱스와 매칭되는지 확인
     */
    findMatchingIndexes(querySpec) {
        const matches = [];
        for (const [, indexDef] of this.indexes) {
            if (indexDef.collection !== querySpec.collection) {
                continue;
            }
            if (this.isIndexMatching(indexDef, querySpec)) {
                matches.push(indexDef);
            }
        }
        // 완전 매치 우선, 부분 매치는 뒤로
        return matches.sort((a, b) => {
            const aScore = this.calculateMatchScore(a, querySpec);
            const bScore = this.calculateMatchScore(b, querySpec);
            return bScore - aScore;
        });
    }
    /**
     * 인덱스가 쿼리와 매칭되는지 확인
     */
    isIndexMatching(indexDef, querySpec) {
        const indexFields = indexDef.fields.slice(); // 복사
        let fieldIdx = 0;
        // dealerId는 자동 매칭 (항상 첫 번째)
        if (indexFields[fieldIdx].field === '__dealerId') {
            fieldIdx++;
        }
        // where 절 등호 조건들 매칭
        const equalityConditions = querySpec.where.filter(w => w.operator === '==');
        for (const condition of equalityConditions) {
            if (fieldIdx >= indexFields.length || indexFields[fieldIdx].field !== condition.field) {
                return false;
            }
            fieldIdx++;
        }
        // where 절 범위 조건 매칭 (최대 1개)
        const rangeConditions = querySpec.where.filter(w => ['<', '<=', '>', '>='].includes(w.operator));
        if (rangeConditions.length > 1) {
            return false; // 복수 범위 조건은 지원 안함
        }
        if (rangeConditions.length === 1) {
            const rangeCondition = rangeConditions[0];
            if (fieldIdx >= indexFields.length || indexFields[fieldIdx].field !== rangeCondition.field) {
                return false;
            }
            fieldIdx++;
        }
        // orderBy 조건들 매칭
        for (const orderBy of querySpec.orderBy) {
            if (fieldIdx >= indexFields.length ||
                indexFields[fieldIdx].field !== orderBy.field ||
                indexFields[fieldIdx].direction !== orderBy.direction) {
                return false;
            }
            fieldIdx++;
        }
        return true;
    }
    /**
     * 인덱스 매칭 점수 계산
     */
    calculateMatchScore(indexDef, querySpec) {
        let score = 0;
        // where 절 매칭 점수
        querySpec.where.forEach(condition => {
            if (indexDef.fields.find(f => f.field === condition.field)) {
                score += condition.operator === '==' ? 10 : 5;
            }
        });
        // orderBy 매칭 점수
        querySpec.orderBy.forEach(orderBy => {
            const indexField = indexDef.fields.find(f => f.field === orderBy.field);
            if (indexField && indexField.direction === orderBy.direction) {
                score += 3;
            }
        });
        return score;
    }
    /**
     * 인덱스를 사용한 쿼리 실행
     */
    async executeIndexQuery(indexKey, querySpec) {
        const indexEntries = this.indexEntries.get(indexKey);
        if (!indexEntries) {
            throw new Error(`Index not found: ${indexKey}`);
        }
        this.stats.indexHits++;
        // 인덱스 범위 스캔 (간단한 구현)
        const matchingEntries = [];
        for (const [, entry] of indexEntries) {
            if (this.entryMatchesQuery(entry, querySpec)) {
                matchingEntries.push(entry);
            }
        }
        // 문서 가져오기
        const documents = [];
        for (const entry of matchingEntries) {
            const doc = await storage.getDocument(entry.documentPath, entry.dealerId);
            if (doc) {
                documents.push(doc);
            }
        }
        return documents;
    }
    /**
     * 인덱스 엔트리가 쿼리와 매칭되는지 확인
     */
    entryMatchesQuery(entry, querySpec) {
        // 실제로는 인덱스 키를 사용해서 범위 스캔을 해야 하지만
        // 여기서는 간단히 문서를 가져와서 조건 확인
        // TODO: 실제 인덱스 키 기반 범위 스캔 구현
        return entry.dealerId === querySpec.dealerId;
    }
    /**
     * 문서 변경 시 인덱스 업데이트
     */
    async updateIndexesForDocument(event) {
        const { type, document, oldDocument, dealerId } = event;
        for (const [indexKey, indexDef] of this.indexes) {
            if (indexDef.collection !== document.collection) {
                continue;
            }
            const indexEntries = this.indexEntries.get(indexKey);
            // 기존 엔트리 제거
            if (type === 'modified' || type === 'removed') {
                const oldEntryKey = this.makeEntryKey(oldDocument || document, indexDef);
                indexEntries.delete(oldEntryKey);
            }
            // 새 엔트리 추가
            if (type === 'created' || type === 'modified') {
                const newEntry = {
                    indexName: indexDef.name,
                    key: this.extractIndexKey(document, indexDef),
                    documentPath: document.path,
                    dealerId: document.dealerId
                };
                const entryKey = this.makeEntryKey(document, indexDef);
                indexEntries.set(entryKey, newEntry);
            }
        }
    }
    /**
     * 인덱스 재구축 (기존 문서들에 대해)
     */
    async rebuildIndex(indexDef) {
        const indexKey = this.makeIndexKey(indexDef);
        const indexEntries = this.indexEntries.get(indexKey);
        // 컬렉션의 모든 문서 조회 (모든 테넌트)
        const allDocuments = await this.getAllDocumentsInCollection(indexDef.collection);
        for (const doc of allDocuments) {
            const entry = {
                indexName: indexDef.name,
                key: this.extractIndexKey(doc, indexDef),
                documentPath: doc.path,
                dealerId: doc.dealerId
            };
            const entryKey = this.makeEntryKey(doc, indexDef);
            indexEntries.set(entryKey, entry);
        }
        console.log(`   Indexed ${allDocuments.length} documents`);
    }
    /**
     * 컬렉션의 모든 문서 조회 (인덱스 구축용)
     */
    async getAllDocumentsInCollection(collection) {
        // storage에서 직접 가져오는 방법이 필요
        // 실제로는 스토리지 엔진에 이런 메서드가 있어야 함
        const allDocs = [];
        // 임시로 storage의 private 데이터에 접근
        // 실제로는 공개 메서드로 만들어야 함
        for (const [, doc] of storage.documents) {
            if (doc.collection === collection) {
                allDocs.push(doc);
            }
        }
        return allDocs;
    }
    /**
     * 문서에서 인덱스 키 추출
     */
    extractIndexKey(document, indexDef) {
        const key = [];
        for (const field of indexDef.fields) {
            let value;
            if (field.field === '__dealerId') {
                value = document.dealerId;
            }
            else {
                value = this.getNestedValue(document.data, field.field);
            }
            key.push(value);
        }
        return key;
    }
    /**
     * 중첩된 필드 값 가져오기 (schedule.date 등)
     */
    getNestedValue(obj, path) {
        return path.split('.').reduce((current, key) => {
            return current && current[key] !== undefined ? current[key] : null;
        }, obj);
    }
    /**
     * 인덱스 비용 추정
     */
    estimateIndexCost(indexDef, querySpec) {
        // 간단한 비용 모델
        let cost = 1; // 기본 인덱스 접근 비용
        // 범위 스캔 비용
        const rangeConditions = querySpec.where.filter(w => ['<', '<=', '>', '>=', 'in'].includes(w.operator));
        cost += rangeConditions.length * 2;
        return cost;
    }
    // === 유틸리티 메서드들 ===
    makeIndexKey(indexDef) {
        return `${indexDef.collection}:${indexDef.name}`;
    }
    makeEntryKey(document, indexDef) {
        const keyValues = this.extractIndexKey(document, indexDef);
        return `${document.dealerId}:${keyValues.join(':')}:${document.path}`;
    }
    /**
     * 통계 정보
     */
    getStats() {
        return {
            ...this.stats,
            entriesCount: Array.from(this.indexEntries.values())
                .reduce((sum, entries) => sum + entries.size, 0)
        };
    }
    /**
     * 모든 인덱스 정보
     */
    getAllIndexes() {
        return Array.from(this.indexes.values());
    }
}
// 싱글톤 인스턴스  
export const indexSystem = new IndexSystem();
//# sourceMappingURL=indexes.js.map