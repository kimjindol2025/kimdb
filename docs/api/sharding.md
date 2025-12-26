# Sharding API

> SQLite 다중 인스턴스로 동시 쓰기 한계 극복

## 개요

SQLite는 단일 쓰기 락으로 동시성이 제한됩니다. Sharding 모듈은:
- **4~N개 샤드**: 독립 SQLite 인스턴스
- **MD5 해시**: 키 기반 자동 분산
- **병렬 처리**: 샤드별 독립 쓰기 큐
- **배치 삽입**: 트랜잭션 묶음 처리

## 설치

```javascript
import { ShardManager, ShardedCollection } from 'kimdb/sharding';
```

---

## ShardManager 클래스

샤드 관리자

### 생성자

```javascript
const sm = new ShardManager(options).init();
```

| 옵션 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `shardCount` | number | `4` | 샤드 개수 |
| `dbDir` | string | `'./shards'` | 샤드 디렉토리 |

### 메서드

#### `getShard(key)`

키에 해당하는 샤드 반환

```javascript
const { db, index } = sm.getShard('user123');
// db: better-sqlite3 인스턴스
// index: 샤드 인덱스 (0~3)
```

---

#### `getShardIndex(key)`

키의 샤드 인덱스 계산

```javascript
const index = sm.getShardIndex('user123'); // 0~3
```

---

#### `write(key, operation)`

샤드별 큐 기반 쓰기

```javascript
await sm.write('user123', (db) => {
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)')
    .run('user123', 'Kim');
});
```

---

#### `read(key, operation)`

직접 읽기 (병렬 가능)

```javascript
const user = sm.read('user123', (db) => {
  return db.prepare('SELECT * FROM users WHERE id = ?').get('user123');
});
```

---

#### `createTable(sql)`

모든 샤드에 테이블 생성

```javascript
sm.createTable(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);
```

---

#### `queryAll(operation)`

모든 샤드에서 조회 후 병합

```javascript
const allUsers = sm.queryAll((db) => {
  return db.prepare('SELECT * FROM users LIMIT 100').all();
});
```

---

#### `transaction(key, operations)`

단일 샤드 내 트랜잭션

```javascript
await sm.transaction('user123', [
  (db) => db.prepare('UPDATE users SET balance = balance - 100 WHERE id = ?').run('user123'),
  (db) => db.prepare('UPDATE users SET balance = balance + 100 WHERE id = ?').run('user456')
]);
```

---

#### `getStats()`

샤드별 통계

```javascript
const stats = sm.getStats();
// {
//   shardCount: 4,
//   writes: [1000, 1200, 980, 1100],  // 샤드별
//   reads: [5000, 4800, 5200, 4900],
//   totalWrites: 4280,
//   totalReads: 19900,
//   queueLengths: [0, 2, 0, 1]
// }
```

---

#### `close()`

모든 샤드 종료

```javascript
sm.close();
```

---

## ShardedCollection 클래스

샤딩된 컬렉션 (테이블)

### 생성자

```javascript
const users = new ShardedCollection(shardManager, 'users');
```

### 메서드

#### `insert(id, data)`

문서 삽입

```javascript
const result = await users.insert('u001', { name: 'Kim', age: 30 });
// { id: 'u001', _version: 1 }
```

---

#### `update(id, data)`

문서 업데이트 (병합)

```javascript
const result = await users.update('u001', { age: 31 });
// { id: 'u001', _version: 2 }
```

---

#### `get(id)`

문서 조회

```javascript
const user = users.get('u001');
// { id: 'u001', data: { name: 'Kim', age: 31 }, _version: 2 }
```

---

#### `getAll(limit)`

전체 조회

```javascript
const allUsers = users.getAll(100);
```

---

#### `delete(id)`

문서 삭제

```javascript
await users.delete('u001');
```

---

#### `batchInsert(documents)`

대량 삽입 (샤드별 병렬)

```javascript
const docs = [
  { id: 'u001', data: { name: 'Kim' } },
  { id: 'u002', data: { name: 'Lee' } },
  { id: 'u003', data: { name: 'Park' } }
];

const results = await users.batchInsert(docs);
// [{ id: 'u001', _version: 1 }, { id: 'u002', _version: 1 }, ...]
```

---

#### `count()`

전체 문서 수

```javascript
const total = users.count(); // 3
```

---

## 샤드 분산 알고리즘

```javascript
// MD5 해시 앞 8자리 → parseInt → % shardCount
const hash = crypto.createHash('md5').update(key).digest('hex');
const index = parseInt(hash.slice(0, 8), 16) % shardCount;
```

### 분산 예시

```
key='user_001' → hash='a1b2c3...' → index=2
key='user_002' → hash='d4e5f6...' → index=0
key='user_003' → hash='789abc...' → index=3
key='user_004' → hash='def012...' → index=1
```

---

## 파일 구조

```
shards/
├── shard_0.db
├── shard_0.db-shm
├── shard_0.db-wal
├── shard_1.db
├── shard_1.db-shm
├── shard_1.db-wal
├── shard_2.db
└── shard_3.db
```

---

## 예제

### 기본 사용

```javascript
import { ShardManager, ShardedCollection } from 'kimdb/sharding';

// 샤드 매니저 초기화
const sm = new ShardManager({ shardCount: 4 }).init();

// 컬렉션 생성
const users = new ShardedCollection(sm, 'users');

// CRUD
await users.insert('u001', { name: 'Kim', email: 'kim@test.com' });
const user = users.get('u001');
await users.update('u001', { email: 'kim@new.com' });
await users.delete('u001');

// 종료
sm.close();
```

### 대량 삽입

```javascript
const docs = [];
for (let i = 0; i < 10000; i++) {
  docs.push({ data: { value: i } });
}

const start = Date.now();
const results = await users.batchInsert(docs);
console.log(`10K inserts in ${Date.now() - start}ms`);
```

### 직접 SQL 사용

```javascript
// 테이블 생성
sm.createTable(`
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT,
    level TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// 쓰기
await sm.write('log_001', (db) => {
  db.prepare('INSERT INTO logs (message, level) VALUES (?, ?)')
    .run('Server started', 'INFO');
});

// 전체 조회
const logs = sm.queryAll((db) => {
  return db.prepare('SELECT * FROM logs ORDER BY created_at DESC LIMIT 10').all();
});
```
