# KimDB

> 고성능 실시간 협업 문서 데이터베이스 (SQLite + WebSocket + CRDT)

## 📋 현재 상태

### 구현 완료
- ✅ **로컬 우선 아키텍처**: 오프라인 지원
- ✅ **CRDT 동기화**: 충돌 없는 병합
- ✅ **WebSocket 실시간**: 즉시 동기화
- ✅ **TypeScript SDK**: 타입 안전성
- ✅ **Redis Cluster**: 멀티 서버 확장
- ✅ **MariaDB 로깅**: 선택적 통합

### 릴리스 현황
- **최신 버전**: v7.5.3
- **릴리스**: 7개 (v7.0.0 ~ v7.5.3)
- **커밋**: 40개

### 파일 구조
```
kimdb/
├── src/                  # TypeScript 소스
│   ├── server/          # 서버 코드
│   ├── client/          # 클라이언트 SDK
│   └── crdt/            # CRDT 구현
├── dist/                # 컴파일된 코드
├── tests/               # 테스트
├── docker/              # Docker 설정
└── docs/                # 문서
```

## 🏗️ 기술 스택

- **언어**: TypeScript + Node.js
- **데이터베이스**: SQLite (로컬), PostgreSQL (선택)
- **캐시**: Redis Cluster
- **실시간**: WebSocket
- **동기화**: CRDT (VectorClock, LWWSet, RGA, RichText)
- **로깅**: MariaDB (선택)
- **배포**: Docker, PM2

## 📊 개발 현황

- **커밋**: 40개
- **브랜치**: master
- **릴리스**: 7개
- **크기**: 40.5MB
- **최근 작업**: v7.5.3 릴리스 (1주 전)

## 🔧 TODO (추가 개선)

### Phase 1: 성능 최적화
- [ ] 인덱싱 전략 개선
- [ ] 쿼리 최적화
- [ ] 메모리 사용량 감소
- [ ] 네트워크 압축

### Phase 2: 고급 CRDT
- [ ] JSON CRDT
- [ ] Tree CRDT
- [ ] Map CRDT
- [ ] Set CRDT

### Phase 3: 확장성
- [ ] 샤딩 지원
- [ ] 멀티 리전 복제
- [ ] P2P 동기화
- [ ] 충돌 해결 UI

### Phase 4: 개발자 도구
- [ ] 비주얼 디버거
- [ ] 성능 프로파일러
- [ ] 마이그레이션 도구
- [ ] CLI 툴

## 🎯 개발 로드맵

| Phase | 기능 | 우선순위 | 예상 기간 |
|-------|------|----------|-----------|
| 1 | 성능 최적화 | 🔴 높음 | 2주 |
| 2 | 고급 CRDT | 🟡 중간 | 3주 |
| 3 | 확장성 | 🟡 중간 | 4주 |
| 4 | 개발자 도구 | 🟢 낮음 | 2주 |

## 🐛 알려진 이슈

1. **대용량 문서** - 100MB+ 문서 성능 저하
2. **네트워크 지연** - 느린 네트워크에서 동기화 지연
3. **메모리 사용** - 많은 동시 접속 시 메모리 증가

## 🚀 빠른 시작

### 1. 설치
```bash
# NPM 설치
npm install kimdb

# 또는 Yarn
yarn add kimdb
```

### 2. 서버 시작
```typescript
import { KimDBServer } from 'kimdb/server';

const server = new KimDBServer({
  port: 40000,
  storage: 'sqlite:./data/kimdb.sqlite',
  redis: {
    host: 'localhost',
    port: 6379
  }
});

server.start();
```

### 3. 클라이언트 연결
```typescript
import { KimDBClient } from 'kimdb/client';

const client = new KimDBClient({
  url: 'ws://localhost:40000'
});

await client.connect();

// 문서 생성
const doc = await client.createDocument('my-doc');

// 실시간 편집
doc.update({ title: 'Hello KimDB' });
```

## ⚙️ CRDT 기본 개념

### VectorClock (버전 관리)
```typescript
const clock = new VectorClock();
clock.tick('client1'); // {client1: 1}
clock.tick('client2'); // {client1: 1, client2: 1}
```

### LWWSet (Last-Write-Wins Set)
```typescript
const set = new LWWSet();
set.add('item1', timestamp1);
set.add('item2', timestamp2);
set.remove('item1', timestamp3);
```

### RGA (Replicated Growable Array)
```typescript
const array = new RGA();
array.insert(0, 'a');
array.insert(1, 'b');
array.delete(0); // ['b']
```

### RichText (텍스트 편집)
```typescript
const text = new RichText();
text.insert(0, 'Hello');
text.insert(5, ' World');
text.delete(0, 5); // " World"
```

## 📈 성능 벤치마크

| 작업 | 처리량 | 지연시간 |
|-----|--------|----------|
| 문서 읽기 | 10,000/s | < 5ms |
| 문서 쓰기 | 5,000/s | < 10ms |
| 실시간 동기화 | 1,000 동시 | < 50ms |
| 메모리 사용 | ~100MB | (1,000 문서) |

## 💡 사용 사례

### 1. 협업 에디터
```typescript
// Google Docs 스타일
const editor = new CollaborativeEditor({
  db: client,
  docId: 'shared-doc'
});

editor.onCursorMove((userId, position) => {
  showCursor(userId, position);
});
```

### 2. 실시간 대시보드
```typescript
// 여러 사용자가 동시에 차트 편집
const dashboard = await client.getDocument('dashboard');
dashboard.watch((changes) => {
  updateCharts(changes);
});
```

### 3. 오프라인 앱
```typescript
// 네트워크 없어도 작동
const doc = await client.getDocument('offline-doc');
doc.update({ status: 'offline' }); // 로컬 저장
// 네트워크 복구 시 자동 동기화
```

### 4. 멀티플레이어 게임
```typescript
// 게임 상태 동기화
const gameState = await client.getDocument('game-state');
gameState.update({
  players: [player1, player2],
  score: 100
});
```

## 🔒 보안 기능

- **인증**: JWT 기반
- **암호화**: TLS/SSL 전송
- **접근 제어**: 문서별 권한
- **감사 로그**: 모든 변경 추적

## 🔗 관련 링크

- 저장소: https://gogs.ai-empire.kr/kim/kimdb
- NPM: https://www.npmjs.com/package/kimdb (예정)
- 문서: https://kimdb.dclub.kr (예정)
