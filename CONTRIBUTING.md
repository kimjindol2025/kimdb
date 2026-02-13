# KimDB에 기여하기

KimDB에 기여해주셔서 감사합니다! 이 문서는 프로젝트에 기여하는 방법을 설명합니다.

## 📋 목차

- [행동 강령](#행동-강령)
- [시작하기](#시작하기)
- [개발 설정](#개발-설정)
- [기여 프로세스](#기여-프로세스)
- [스타일 가이드](#스타일-가이드)
- [커밋 메시지](#커밋-메시지)
- [풀 리퀘스트](#풀-리퀘스트)
- [질문 및 토론](#질문-및-토론)

---

## 행동 강령

### 우리의 약속

모든 기여자는 존경과 포용성 있는 환경을 만드는 데 참여합니다.

우리는 다음을 약속합니다:

- 연령, 신체 크기, 장애, 민족성, 성 정체성, 성적 지향과 무관하게 모든 사람을 존중합니다.
- 명확하고 건설적인 피드백을 제공합니다.
- 악의적인 언어나 불쾌한 행동을 하지 않습니다.

### 부적절한 행동

다음 행동은 허용되지 않습니다:

- 성적 또는 폭력적인 내용
- 괴롭힘, 모욕 또는 차별
- 스팸 또는 광고

---

## 시작하기

### 1. 저장소 포크

```bash
git clone https://github.com/kim/kimdb.git
cd kimdb
git remote add upstream https://github.com/kim/kimdb.git
```

### 2. 브랜치 생성

```bash
git checkout -b feature/my-feature
# 또는
git checkout -b fix/issue-123
```

### 3. 작업 수행

```bash
# 코드 작성
vim src/my-feature.ts

# 테스트 작성
vim tests/my-feature.test.ts

# 테스트 실행
npm test

# 빌드 확인
npm run build
```

---

## 개발 설정

### 환경 요구사항

```bash
# Node.js 18+ 필요
node --version

# npm 설치
npm install

# 의존성 확인
npm ls
```

### 개발 명령어

```bash
# 개발 서버 실행 (hot reload)
npm run dev

# 테스트 실행
npm test

# 테스트 커버리지
npm run test:coverage

# 린트 실행
npm run lint

# 빌드 실행
npm run build

# 타입 체크
npm run type-check
```

---

## 기여 프로세스

### 1. Issue 확인/생성

기여하기 전에:

```bash
# 기존 Issue 검색
https://github.com/kim/kimdb/issues

# 새로운 Issue 생성 (필요시)
# 제목: "feat: 기능 설명" 또는 "fix: 버그 설명"
```

### 2. 작업 시작

```bash
# upstream에서 최신 코드 받기
git fetch upstream
git rebase upstream/master

# 기능 브랜치 생성
git checkout -b feature/GH-123-description
```

### 3. 코드 작성

```typescript
// 좋은 예시
export function parseIntent(input: string): Intent {
  if (!input) {
    throw new Error('Input cannot be empty');
  }

  const intent = {
    type: 'create',
    entity: 'document',
    fields: extractFields(input),
  };

  return intent;
}

// 나쁜 예시
export function parse(s) {
  return JSON.parse(s); // 검증 없음
}
```

### 4. 테스트 작성

```typescript
describe('parseIntent', () => {
  it('should parse valid intent', () => {
    const result = parseIntent('create document with title "Hello"');
    expect(result.type).toBe('create');
    expect(result.entity).toBe('document');
  });

  it('should throw error for empty input', () => {
    expect(() => parseIntent('')).toThrow();
  });
});
```

### 5. 변경사항 커밋

```bash
git add src/my-feature.ts tests/my-feature.test.ts

git commit -m "feat: Add my feature

- Description of what was added
- Why this change is needed
- Any breaking changes"

git push origin feature/my-feature
```

### 6. 풀 리퀘스트 생성

- 제목: 명확하고 짧게 (50자 이내)
- 설명: What, Why, How 포함
- Issue 링크: `Closes #123`

---

## 스타일 가이드

### TypeScript

```typescript
// ✅ 좋은 예시
interface DocumentOptions {
  title: string;
  content: string;
  isPublic?: boolean;
}

export class Document {
  private id: string;
  private options: DocumentOptions;

  constructor(id: string, options: DocumentOptions) {
    this.id = id;
    this.options = options;
    this.validate();
  }

  private validate(): void {
    if (!this.options.title) {
      throw new Error('Title is required');
    }
  }

  public getTitle(): string {
    return this.options.title;
  }
}

// ❌ 나쁜 예시
export const doc = {
  id: "123",
  title: "My Doc",
  content: null,
  getTitle: function() {
    return this.title;
  }
};
```

### 네이밍 컨벤션

```typescript
// Classes: PascalCase
class DocumentManager { }

// Functions: camelCase
function parseDocument() { }

// Constants: UPPER_SNAKE_CASE
const MAX_DOCUMENTS = 1000;

// Private members: _camelCase or private keyword
private _cache: Map<string, any>;
private internalValue: string;

// Interfaces: PascalCase (I 접두사 없음)
interface Document {
  id: string;
  title: string;
}
```

### 파일 구조

```
src/
├── core/           # 핵심 로직
├── crdt/           # CRDT 구현
├── database/       # DB 레이어
├── server/         # Express 서버
├── client/         # 클라이언트
└── utils/          # 유틸리티

tests/
├── unit/           # 단위 테스트
├── integration/    # 통합 테스트
└── e2e/           # E2E 테스트
```

---

## 커밋 메시지

Conventional Commits를 따릅니다:

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type

- **feat**: 새로운 기능
- **fix**: 버그 수정
- **docs**: 문서만 변경
- **style**: 코드 포맷팅 (로직 변경 없음)
- **refactor**: 코드 리팩토링
- **perf**: 성능 개선
- **test**: 테스트 추가/수정
- **chore**: 빌드, 의존성 등 (로직 변경 없음)

### 예시

```
feat(crdt): Add support for conflict-free list operations

- Implement RGA (Replicated Growable Array)
- Add tests for concurrent inserts
- Update documentation

Closes #234
```

---

## 풀 리퀘스트

### 체크리스트

PR을 제출하기 전에:

- [ ] 코드가 로컬에서 테스트됨
- [ ] 모든 테스트 통과 (`npm test`)
- [ ] 린트 오류 없음 (`npm run lint`)
- [ ] 빌드 성공 (`npm run build`)
- [ ] 커밋 메시지가 Conventional Commits를 따름
- [ ] CHANGELOG.md 업데이트됨
- [ ] 문서가 업데이트됨
- [ ] 개인 정보가 포함되지 않음

### 리뷰 프로세스

1. 최소 1명의 메인테이너 검토 필요
2. CI/CD 모든 체크 통과 필요
3. 사실상 승인되면 merge 가능

---

## 질문 및 토론

### 문제 신고

```
## 설명
버그에 대한 명확하고 간결한 설명.

## 재현 단계
1. ...
2. ...
3. ...

## 예상 동작
...

## 실제 동작
...

## 환경
- OS: [예: Ubuntu 20.04]
- Node: [예: 18.12.0]
- KimDB: [예: 7.6.1]
```

### 기능 제안

```
## 설명
기능에 대한 설명.

## 동기
왜 이 기능이 필요한가?

## 제안된 솔루션
어떻게 구현할 것인가?

## 대안
다른 방법은?
```

---

## 코드 리뷰 기준

리뷰에서 확인하는 사항:

1. **정확성**: 코드가 의도대로 작동하는가?
2. **성능**: 성능 문제는 없는가?
3. **보안**: 보안 취약점은 없는가?
4. **가독성**: 코드가 이해하기 쉬운가?
5. **테스트**: 테스트 커버리지는 충분한가?
6. **문서**: 문서가 업데이트되었는가?

---

## 라이선스

KimDB에 기여함으로써, 귀하는 기여분이 MIT 라이선스 하에 라이선스됨에 동의합니다.

---

## 감사합니다! 🎉

KimDB에 기여해주셔서 감사합니다!

더 자세한 정보:
- [README.md](README.md)
- [보안 정책](SECURITY.md)
- [제품 로드맵](docs/ROADMAP.md)
