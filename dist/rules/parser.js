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
export class RulesParser {
    builtinFunctions = new Set([
        'isSignedIn',
        'hasRole',
        'userDealer',
        'exists',
        'get',
        'size',
        'keys'
    ]);
    /**
     * 규칙 텍스트를 파싱해서 Rule 객체들로 변환
     */
    parseRules(rulesText) {
        const rules = [];
        // 간단한 파서 구현 (실제로는 ANTLR 등 사용 권장)
        const lines = rulesText.split('\n').map(line => line.trim()).filter(line => line);
        let currentRule = null;
        let conditionBuffer = '';
        let inCondition = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // match 블록 시작
            if (line.startsWith('match ')) {
                if (currentRule) {
                    // 이전 규칙 완료
                    if (conditionBuffer.trim()) {
                        currentRule.condition = this.parseCondition(conditionBuffer.trim());
                    }
                    rules.push(currentRule);
                }
                currentRule = {
                    id: `rule_${rules.length + 1}`,
                    pathPattern: this.extractPathPattern(line),
                    operations: [],
                    priority: rules.length
                };
                conditionBuffer = '';
                inCondition = false;
            }
            // allow 문
            else if (line.startsWith('allow ') && currentRule) {
                const { operations, condition } = this.parseAllowStatement(line);
                currentRule.operations.push(...operations);
                if (condition) {
                    conditionBuffer = condition;
                    inCondition = true;
                }
            }
            // 조건 계속
            else if (inCondition && line && !line.startsWith('}')) {
                conditionBuffer += ' ' + line;
            }
            // 블록 끝
            else if (line === '}' && currentRule) {
                if (conditionBuffer.trim()) {
                    currentRule.condition = this.parseCondition(conditionBuffer.trim());
                }
                rules.push(currentRule);
                currentRule = null;
                conditionBuffer = '';
                inCondition = false;
            }
        }
        // 마지막 규칙 처리
        if (currentRule) {
            if (conditionBuffer.trim()) {
                currentRule.condition = this.parseCondition(conditionBuffer.trim());
            }
            rules.push(currentRule);
        }
        return rules;
    }
    /**
     * 경로 패턴 추출
     */
    extractPathPattern(matchLine) {
        const match = matchLine.match(/match\s+(\/[^{]+(?:\{[^}]+\}[^{]*)*)\s*\{?/);
        if (!match) {
            throw new Error(`Invalid match pattern: ${matchLine}`);
        }
        return match[1];
    }
    /**
     * allow 문 파싱
     */
    parseAllowStatement(allowLine) {
        // allow read, write: if condition
        // allow create, update, delete: if condition
        const match = allowLine.match(/allow\s+([^:]+):?\s*(?:if\s+(.+))?/);
        if (!match) {
            throw new Error(`Invalid allow statement: ${allowLine}`);
        }
        const operationsText = match[1].trim();
        const condition = match[2];
        // 'read, write' -> ['read', 'write']
        const operations = operationsText.split(',')
            .map(op => op.trim())
            .filter(op => ['read', 'write', 'create', 'update', 'delete'].includes(op));
        return { operations, condition };
    }
    /**
     * 조건식 파싱 (간단한 구현)
     */
    parseCondition(conditionText) {
        // 공백 정리
        conditionText = conditionText.replace(/\s+/g, ' ').trim();
        // if로 시작하면 제거
        if (conditionText.startsWith('if ')) {
            conditionText = conditionText.substring(3);
        }
        return this.parseOrExpression(conditionText);
    }
    /**
     * OR 표현식 파싱 (최상위)
     */
    parseOrExpression(text) {
        const orParts = this.splitByOperator(text, '||');
        if (orParts.length === 1) {
            return this.parseAndExpression(orParts[0]);
        }
        let result = this.parseAndExpression(orParts[0]);
        for (let i = 1; i < orParts.length; i++) {
            result = {
                type: 'or',
                left: result,
                right: this.parseAndExpression(orParts[i])
            };
        }
        return result;
    }
    /**
     * AND 표현식 파싱
     */
    parseAndExpression(text) {
        const andParts = this.splitByOperator(text, '&&');
        if (andParts.length === 1) {
            return this.parseComparisonExpression(andParts[0]);
        }
        let result = this.parseComparisonExpression(andParts[0]);
        for (let i = 1; i < andParts.length; i++) {
            result = {
                type: 'and',
                left: result,
                right: this.parseComparisonExpression(andParts[i])
            };
        }
        return result;
    }
    /**
     * 비교 표현식 파싱
     */
    parseComparisonExpression(text) {
        const operators = ['==', '!=', '<=', '>=', '<', '>'];
        for (const op of operators) {
            const parts = this.splitByOperator(text, op);
            if (parts.length === 2) {
                return {
                    type: 'comparison',
                    value: op,
                    left: this.parsePrimaryExpression(parts[0]),
                    right: this.parsePrimaryExpression(parts[1])
                };
            }
        }
        return this.parsePrimaryExpression(text);
    }
    /**
     * 기본 표현식 파싱 (변수, 리터럴, 함수 호출)
     */
    parsePrimaryExpression(text) {
        text = text.trim();
        // 괄호 처리
        if (text.startsWith('(') && text.endsWith(')')) {
            return this.parseCondition(text.slice(1, -1));
        }
        // NOT 처리
        if (text.startsWith('!')) {
            return {
                type: 'not',
                condition: this.parsePrimaryExpression(text.slice(1))
            };
        }
        // 함수 호출
        const funcMatch = text.match(/^(\w+)\s*\(([^)]*)\)$/);
        if (funcMatch) {
            const funcName = funcMatch[1];
            const argsText = funcMatch[2].trim();
            const args = [];
            if (argsText) {
                // 간단한 인수 파싱 (문자열과 변수만)
                const argParts = argsText.split(',').map(arg => arg.trim());
                for (const arg of argParts) {
                    args.push(this.parsePrimaryExpression(arg));
                }
            }
            return {
                type: 'function_call',
                function: funcName,
                args
            };
        }
        // 문자열 리터럴
        if ((text.startsWith('"') && text.endsWith('"')) ||
            (text.startsWith("'") && text.endsWith("'"))) {
            return {
                type: 'literal',
                value: text.slice(1, -1)
            };
        }
        // 숫자 리터럴
        if (/^\d+(\.\d+)?$/.test(text)) {
            return {
                type: 'literal',
                value: parseFloat(text)
            };
        }
        // boolean 리터럴
        if (text === 'true' || text === 'false') {
            return {
                type: 'literal',
                value: text === 'true'
            };
        }
        // null 리터럴
        if (text === 'null') {
            return {
                type: 'literal',
                value: null
            };
        }
        // 변수 (request.auth, resource.data.field 등)
        return {
            type: 'variable',
            variable: text
        };
    }
    /**
     * 연산자로 텍스트 분할 (괄호 고려)
     */
    splitByOperator(text, operator) {
        const parts = [];
        let current = '';
        let parenDepth = 0;
        let i = 0;
        while (i < text.length) {
            if (text[i] === '(') {
                parenDepth++;
            }
            else if (text[i] === ')') {
                parenDepth--;
            }
            // 연산자 매칭
            if (parenDepth === 0 && text.substring(i, i + operator.length) === operator) {
                parts.push(current.trim());
                current = '';
                i += operator.length;
                continue;
            }
            current += text[i];
            i++;
        }
        if (current.trim()) {
            parts.push(current.trim());
        }
        return parts.length > 1 ? parts : [text];
    }
    /**
     * 경로 패턴을 세그먼트로 분해
     */
    parsePathPattern(pathPattern) {
        const segments = [];
        // /dealers/{dealerId}/bookings/{bookingId} -> ['dealers', '{dealerId}', 'bookings', '{bookingId}']
        const parts = pathPattern.split('/').filter(part => part);
        for (const part of parts) {
            if (part.startsWith('{') && part.endsWith('}')) {
                // 변수 세그먼트
                const variable = part.slice(1, -1);
                segments.push({
                    type: 'variable',
                    value: part,
                    variable
                });
            }
            else {
                // 리터럴 세그먼트
                segments.push({
                    type: 'literal',
                    value: part
                });
            }
        }
        return segments;
    }
    /**
     * 내장 함수 확인
     */
    isBuiltinFunction(name) {
        return this.builtinFunctions.has(name);
    }
}
// 싱글톤 인스턴스
export const rulesParser = new RulesParser();
//# sourceMappingURL=parser.js.map