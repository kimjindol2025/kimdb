# 빠른 시작

> 5분 만에 KimDB 시작하기

## 설치

```bash
npm install kimdb
```

## 방법 1: SimpleDB (가장 쉬움)

고성능 쓰기가 필요할 때

```javascript
import SimpleDB from 'kimdb/hyperscale';

// 초기화
const db = new SimpleDB({
  dbPath: './data/myapp.db',
  shardCount: 8
});

// 저장
await db.set('users', 'user001', {
  name: 'Kim',
  email: 'kim@example.com'
});

// 조회
const user = await db.get('users', 'user001');
console.log(user.data.name); // 'Kim'

// 삭제
await db.delete('users', 'user001');

// 종료
db.close();
```

## 방법 2: 클라이언트-서버

실시간 동기화가 필요할 때

### 서버 (server.js)

```javascript
import { KimDBServer } from 'kimdb/server';

const server = new KimDBServer({
  port: 40000,
  storage: 'sqlite:./data/kimdb.sqlite'
});

server.start();
console.log('KimDB server running on :40000');
```

```bash
node server.js
```

### 클라이언트 (client.js)

```javascript
import { KimDBClient } from 'kimdb/client';

const client = new KimDBClient({
  url: 'ws://localhost:40000'
});

await client.connect();

// 문서 생성
const doc = await client.createDocument('my-doc');

// 편집 (자동 동기화)
doc.update({ title: 'Hello KimDB' });

// 변경 감지
doc.watch((changes) => {
  console.log('Document changed:', changes);
});
```

## 방법 3: CRDT 직접 사용

오프라인 우선 앱

```javascript
import { CRDTDocument } from 'kimdb/crdt';

// 문서 생성
const doc = new CRDTDocument('device-001', 'shared-doc');

// 편집
doc.set('title', 'My Document');
doc.listInsert('items', 0, 'Item 1');
doc.listInsert('items', 1, 'Item 2');

// 일반 객체로 변환
const obj = doc.toObject();
// { title: 'My Document', items: ['Item 1', 'Item 2'] }

// 저장
localStorage.setItem('doc', JSON.stringify(doc.toJSON()));

// 복원
const saved = CRDTDocument.fromJSON(JSON.parse(localStorage.getItem('doc')));
```

## 다음 단계

- [핵심 개념](./concepts.md) - 버퍼링, 샤딩, CRDT 이해
- [성능 가이드](./performance.md) - 909K/sec 달성하기
- [실시간 협업](./real-time.md) - Google Docs 스타일 구현
- [배포](./deployment.md) - PM2, Docker 배포

## 선택 가이드

| 상황 | 추천 |
|------|------|
| 고성능 쓰기 (로그, 센서) | SimpleDB |
| 실시간 협업 (에디터, 채팅) | KimDBServer + Client |
| 오프라인 우선 (모바일) | CRDT 직접 |
| 읽기 위주 | SimpleDB + Read Pool |
