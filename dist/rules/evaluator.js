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
import { rulesParser } from './parser.js';
/**
 * 규칙 평가 엔진
 *
 * 성능 최적화:
 * 1. 트라이 구조로 경로 매칭 O(path_length)
 * 2. 규칙 결과 캐싱 (60초 TTL)
 * 3. 조건 평가 단축 (short-circuit)
 * 4. 함수 호출 최소화
 */
export class RulesEvaluator {
    trie = { children: new Map(), rules: [] };
    cache = new Map();
    // 내장 함수들
    builtinFunctions = new Map();
    // 성능 통계
    stats = {
        evaluations: 0,
        cacheHits: 0,
        cacheMisses: 0,
        averageTime: 0,
        rulesCount: 0
    };
    constructor() {
        this.initializeBuiltinFunctions();
        // 캐시 정리 (5분마다)
        setInterval(() => this.cleanCache(), 5 * 60 * 1000);
    }
    /**
     * 규칙들을 트라이에 등록
     */
    loadRules(rules) {
        // 트라이 초기화
        this.trie = { children: new Map(), rules: [] };
        for (const rule of rules) {
            this.insertRuleIntoTrie(rule);
        }
        this.stats.rulesCount = rules.length;
        console.log(`✅ Loaded ${rules.length} rules into trie`);
    }
    /**
     * 요청에 대한 권한 평가
     */
    async evaluate(operation, path, context) {
        const startTime = Date.now();
        this.stats.evaluations++;
        try {
            // 캐시 확인
            const cacheKey = this.makeCacheKey(operation, path, context);
            const cached = this.getFromCache(cacheKey);
            if (cached) {
                this.stats.cacheHits++;
                return cached;
            }
            this.stats.cacheMisses++;
            // 경로 매칭으로 해당 규칙들 찾기
            const matches = this.findMatchingRules(path);
            if (matches.length === 0) {
                const result = {
                    allowed: false,
                    reason: 'No matching rules found',
                    cacheable: true,
                    executionTime: Date.now() - startTime
                };
                this.putInCache(cacheKey, result, 60000); // 1분 캐시
                return result;
            }
            // 우선순위 순으로 규칙 평가
            for (const match of matches) {
                // 작업 유형 확인
                if (!match.rule.operations.includes(operation)) {
                    continue;
                }
                // 조건 평가
                const conditionResult = await this.evaluateCondition(match.rule.condition, {
                    ...context,
                    pathVariables: match.pathVariables
                });
                if (conditionResult) {
                    const result = {
                        allowed: true,
                        rule: match.rule,
                        reason: `Rule ${match.rule.id} allowed`,
                        cacheable: true,
                        executionTime: Date.now() - startTime
                    };
                    this.putInCache(cacheKey, result, 60000);
                    return result;
                }
            }
            // 모든 규칙에서 거부됨
            const result = {
                allowed: false,
                reason: 'All matching rules denied',
                cacheable: true,
                executionTime: Date.now() - startTime
            };
            this.putInCache(cacheKey, result, 60000);
            return result;
        }
        finally {
            // 성능 통계 업데이트
            const executionTime = Date.now() - startTime;
            this.stats.averageTime = (this.stats.averageTime * (this.stats.evaluations - 1) + executionTime) / this.stats.evaluations;
        }
    }
    /**
     * 경로에 매칭되는 규칙들 찾기 (트라이 순회)
     */
    findMatchingRules(path) {
        const segments = path.split('/').filter(seg => seg);
        const matches = [];
        this.traverseTrie(this.trie, segments, 0, new Map(), matches);
        // 우선순위로 정렬
        return matches.sort((a, b) => a.rule.priority - b.rule.priority);
    }
    /**
     * 트라이 순회 (재귀적 매칭)
     */
    traverseTrie(node, segments, segmentIndex, pathVariables, matches) {
        // 모든 세그먼트를 처리했으면 매칭 완료
        if (segmentIndex === segments.length) {
            for (const rule of node.rules) {
                matches.push({
                    rule,
                    pathVariables: new Map(pathVariables),
                    segments: rulesParser.parsePathPattern(rule.pathPattern)
                });
            }
            return;
        }
        const currentSegment = segments[segmentIndex];
        // 리터럴 매칭
        const literalChild = node.children.get(currentSegment);
        if (literalChild) {
            this.traverseTrie(literalChild, segments, segmentIndex + 1, pathVariables, matches);
        }
        // 변수 매칭
        if (node.variableChild && node.variableName) {
            const newPathVariables = new Map(pathVariables);
            newPathVariables.set(node.variableName, currentSegment);
            this.traverseTrie(node.variableChild, segments, segmentIndex + 1, newPathVariables, matches);
        }
    }
    /**
     * 조건식 평가
     */
    async evaluateCondition(condition, context) {
        switch (condition.type) {
            case 'and':
                return (await this.evaluateCondition(condition.left, context)) &&
                    (await this.evaluateCondition(condition.right, context));
            case 'or':
                return (await this.evaluateCondition(condition.left, context)) ||
                    (await this.evaluateCondition(condition.right, context));
            case 'not':
                return !(await this.evaluateCondition(condition.condition, context));
            case 'comparison':
                const leftValue = await this.evaluateExpression(condition.left, context);
                const rightValue = await this.evaluateExpression(condition.right, context);
                return this.compareValues(leftValue, rightValue, condition.value);
            case 'function_call':
                return await this.evaluateFunctionCall(condition, context);
            case 'literal':
                return Boolean(condition.value);
            case 'variable':
                const value = await this.evaluateExpression(condition, context);
                return Boolean(value);
            default:
                return false;
        }
    }
    /**
     * 표현식 평가 (변수 해석)
     */
    async evaluateExpression(expression, context) {
        switch (expression.type) {
            case 'literal':
                return expression.value;
            case 'variable':
                return this.resolveVariable(expression.variable, context);
            case 'function_call':
                return await this.evaluateFunctionCall(expression, context);
            default:
                return null;
        }
    }
    /**
     * 변수 해석 (request.auth.uid, resource.data.field 등)
     */
    resolveVariable(variablePath, context) {
        const parts = variablePath.split('.');
        if (parts[0] === 'request') {
            return this.getNestedValue(context.request, parts.slice(1));
        }
        if (parts[0] === 'resource') {
            return this.getNestedValue(context.resource, parts.slice(1));
        }
        // 경로 변수 (dealerId, bookingId 등)
        if (context.pathVariables.has(parts[0])) {
            return context.pathVariables.get(parts[0]);
        }
        return null;
    }
    /**
     * 중첩된 객체에서 값 추출
     */
    getNestedValue(obj, path) {
        let current = obj;
        for (const key of path) {
            if (current == null || typeof current !== 'object') {
                return null;
            }
            current = current[key];
        }
        return current;
    }
    /**
     * 값 비교
     */
    compareValues(left, right, operator) {
        switch (operator) {
            case '==': return left === right;
            case '!=': return left !== right;
            case '<': return left < right;
            case '<=': return left <= right;
            case '>': return left > right;
            case '>=': return left >= right;
            default: return false;
        }
    }
    /**
     * 함수 호출 평가
     */
    async evaluateFunctionCall(expression, context) {
        const funcName = expression.function;
        const builtin = this.builtinFunctions.get(funcName);
        if (!builtin) {
            throw new Error(`Unknown function: ${funcName}`);
        }
        // 인수 평가
        const args = [];
        if (expression.args) {
            for (const arg of expression.args) {
                args.push(await this.evaluateExpression(arg, context));
            }
        }
        return builtin.call(this, context, ...args);
    }
    /**
     * 규칙을 트라이에 삽입
     */
    insertRuleIntoTrie(rule) {
        const segments = rulesParser.parsePathPattern(rule.pathPattern);
        let currentNode = this.trie;
        for (const segment of segments) {
            if (segment.type === 'literal') {
                // 리터럴 세그먼트
                if (!currentNode.children.has(segment.value)) {
                    currentNode.children.set(segment.value, { children: new Map(), rules: [] });
                }
                currentNode = currentNode.children.get(segment.value);
            }
            else {
                // 변수 세그먼트
                if (!currentNode.variableChild) {
                    currentNode.variableChild = { children: new Map(), rules: [] };
                    currentNode.variableName = segment.variable;
                }
                currentNode = currentNode.variableChild;
            }
        }
        currentNode.rules.push(rule);
    }
    /**
     * 내장 함수들 초기화
     */
    initializeBuiltinFunctions() {
        // 인증 상태 확인
        this.builtinFunctions.set('isSignedIn', (context) => {
            return context.request.auth != null;
        });
        // 역할 확인
        this.builtinFunctions.set('hasRole', (context, role) => {
            return context.request.auth?.token.roles?.includes(role) || false;
        });
        // 사용자의 딜러 ID 확인
        this.builtinFunctions.set('userDealer', (context) => {
            return context.request.auth?.token.dealerId;
        });
        // 문서 존재 확인
        this.builtinFunctions.set('exists', (context, path) => {
            // 실제로는 스토리지에서 확인해야 함
            return context.resource.data != null;
        });
        // 배열 크기
        this.builtinFunctions.set('size', (context, array) => {
            return Array.isArray(array) ? array.length : 0;
        });
    }
    // === 캐시 관리 ===
    makeCacheKey(operation, path, context) {
        const authKey = context.request.auth ?
            `${context.request.auth.uid}:${context.request.auth.token.dealerId}:${context.request.auth.token.roles.join(',')}`
            : 'anonymous';
        return `${operation}:${path}:${authKey}`;
    }
    getFromCache(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return null;
        if (Date.now() - entry.timestamp.getTime() > entry.ttl) {
            this.cache.delete(key);
            return null;
        }
        return entry.result;
    }
    putInCache(key, result, ttl) {
        if (!result.cacheable)
            return;
        this.cache.set(key, {
            key,
            result,
            timestamp: new Date(),
            ttl
        });
    }
    cleanCache() {
        const now = Date.now();
        for (const [key, entry] of this.cache) {
            if (now - entry.timestamp.getTime() > entry.ttl) {
                this.cache.delete(key);
            }
        }
    }
    /**
     * 통계 정보
     */
    getStats() {
        return {
            ...this.stats,
            cacheSize: this.cache.size,
            trieDepth: this.calculateTrieDepth(this.trie, 0)
        };
    }
    calculateTrieDepth(node, currentDepth) {
        let maxDepth = currentDepth;
        for (const child of node.children.values()) {
            maxDepth = Math.max(maxDepth, this.calculateTrieDepth(child, currentDepth + 1));
        }
        if (node.variableChild) {
            maxDepth = Math.max(maxDepth, this.calculateTrieDepth(node.variableChild, currentDepth + 1));
        }
        return maxDepth;
    }
}
// 싱글톤 인스턴스
export const rulesEvaluator = new RulesEvaluator();
//# sourceMappingURL=evaluator.js.map