/**
 * 🔥 Custom Firestore DB - Rules Evaluator
 * 보안 규칙 평가 엔진 (성능 핵심)
 *
 * 핵심 기능:
 * - 경로 매칭 (트라이 구조)
 * - 조건 평가 + 컨텍스트 주입
 * - 결과 캐싱 (p95 < 2ms 목표)
 * - 내장 함수 지원
 */
import { Rule } from './parser.js';
export interface RequestContext {
    auth?: {
        uid: string;
        token: {
            dealerId: string;
            roles: string[];
            email: string;
        };
    };
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    time: Date;
}
export interface ResourceContext {
    data?: any;
    id: string;
    path: string;
}
export interface EvaluationResult {
    allowed: boolean;
    rule?: Rule;
    reason?: string;
    cacheable: boolean;
    executionTime: number;
}
export interface EvaluationContext {
    request: RequestContext;
    resource: ResourceContext;
    pathVariables: Map<string, string>;
}
/**
 * 규칙 평가 엔진
 *
 * 성능 최적화:
 * 1. 트라이 구조로 경로 매칭 O(path_length)
 * 2. 규칙 결과 캐싱 (60초 TTL)
 * 3. 조건 평가 단축 (short-circuit)
 * 4. 함수 호출 최소화
 */
export declare class RulesEvaluator {
    private trie;
    private cache;
    private builtinFunctions;
    private stats;
    constructor();
    /**
     * 규칙들을 트라이에 등록
     */
    loadRules(rules: Rule[]): void;
    /**
     * 요청에 대한 권한 평가
     */
    evaluate(operation: string, path: string, context: EvaluationContext): Promise<EvaluationResult>;
    /**
     * 경로에 매칭되는 규칙들 찾기 (트라이 순회)
     */
    private findMatchingRules;
    /**
     * 트라이 순회 (재귀적 매칭)
     */
    private traverseTrie;
    /**
     * 조건식 평가
     */
    private evaluateCondition;
    /**
     * 표현식 평가 (변수 해석)
     */
    private evaluateExpression;
    /**
     * 변수 해석 (request.auth.uid, resource.data.field 등)
     */
    private resolveVariable;
    /**
     * 중첩된 객체에서 값 추출
     */
    private getNestedValue;
    /**
     * 값 비교
     */
    private compareValues;
    /**
     * 함수 호출 평가
     */
    private evaluateFunctionCall;
    /**
     * 규칙을 트라이에 삽입
     */
    private insertRuleIntoTrie;
    /**
     * 내장 함수들 초기화
     */
    private initializeBuiltinFunctions;
    private makeCacheKey;
    private getFromCache;
    private putInCache;
    private cleanCache;
    /**
     * 통계 정보
     */
    getStats(): {
        cacheSize: number;
        trieDepth: number;
        evaluations: number;
        cacheHits: number;
        cacheMisses: number;
        averageTime: number;
        rulesCount: number;
    };
    private calculateTrieDepth;
}
export declare const rulesEvaluator: RulesEvaluator;
//# sourceMappingURL=evaluator.d.ts.map