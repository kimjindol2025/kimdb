/**
 * 🔥 Custom Firestore DB - Rules Parser
 * 보안 규칙 DSL 파서 (Firestore 규칙과 호환)
 *
 * 핵심 기능:
 * - DSL → AST 파싱
 * - 경로 패턴 매칭 (트라이 구조)
 * - 조건식 평가
 * - 컨텍스트 바인딩 (request, resource)
 */
export interface Rule {
    id: string;
    pathPattern: string;
    operations: Operation[];
    condition: ConditionAST;
    priority: number;
}
export type Operation = 'read' | 'write' | 'create' | 'update' | 'delete';
export interface ConditionAST {
    type: 'and' | 'or' | 'not' | 'comparison' | 'function_call' | 'literal' | 'variable';
    value?: any;
    left?: ConditionAST;
    right?: ConditionAST;
    condition?: ConditionAST;
    function?: string;
    args?: ConditionAST[];
    variable?: string;
}
export interface PathSegment {
    type: 'literal' | 'variable';
    value: string;
    variable?: string;
}
export interface RuleMatch {
    rule: Rule;
    pathVariables: Map<string, string>;
    segments: PathSegment[];
}
/**
 * 규칙 DSL 파서
 *
 * 지원하는 문법:
 * ```
 * match /dealers/{dealerId}/bookings/{bookingId} {
 *   allow read, write: if request.auth != null
 *                      && request.auth.token.dealerId == dealerId
 *                      && hasRole('manager');
 * }
 * ```
 */
export declare class RulesParser {
    private builtinFunctions;
    /**
     * 규칙 텍스트를 파싱해서 Rule 객체들로 변환
     */
    parseRules(rulesText: string): Rule[];
    /**
     * 경로 패턴 추출
     */
    private extractPathPattern;
    /**
     * allow 문 파싱
     */
    private parseAllowStatement;
    /**
     * 조건식 파싱 (간단한 구현)
     */
    parseCondition(conditionText: string): ConditionAST;
    /**
     * OR 표현식 파싱 (최상위)
     */
    private parseOrExpression;
    /**
     * AND 표현식 파싱
     */
    private parseAndExpression;
    /**
     * 비교 표현식 파싱
     */
    private parseComparisonExpression;
    /**
     * 기본 표현식 파싱 (변수, 리터럴, 함수 호출)
     */
    private parsePrimaryExpression;
    /**
     * 연산자로 텍스트 분할 (괄호 고려)
     */
    private splitByOperator;
    /**
     * 경로 패턴을 세그먼트로 분해
     */
    parsePathPattern(pathPattern: string): PathSegment[];
    /**
     * 내장 함수 확인
     */
    isBuiltinFunction(name: string): boolean;
}
export declare const rulesParser: RulesParser;
//# sourceMappingURL=parser.d.ts.map