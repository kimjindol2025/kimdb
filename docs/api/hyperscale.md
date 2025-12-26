# HyperScale API

> 10,000+ 동시 접속 처리를 위한 고성능 버퍼링 쓰기 엔진

## 개요

HyperScale은 SQLite의 단일 쓰기 락 문제를 해결합니다:
- **버퍼링**: 메모리에 쓰기 모아서 배치 플러시
- **WAL 이중화**: 크래시 복구 보장
- **8샤드 병렬**: MD5 해시 기반 자동 분산
- **Read-After-Write**: 버퍼 데이터도 즉시 읽기 가능

## 설치

```javascript
import SimpleDB from 'kimdb/hyperscale';
// 또는
import { HyperScaleDB, SimpleDB } from 'kimdb/hyperscale';
```

---

## SimpleDB 클래스

간편한 고수준 API

### 생성자

```javascript
const db = new SimpleDB(options);
```

| 옵션 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `dbPath` | string | `'./data/hyperscale.db'` | DB 파일 경로 |
| `shardCount` | number | `8` | 샤드 개수 |
| `bufferSize` | number | `10000` | 버퍼 최대 크기 |
| `flushInterval` | number | `100` | 플러시 주기 (ms) |
| `batchSize` | number | `1000` | 배치당 쓰기 수 |
| `safeMode` | boolean | `true` | WAL 이중화 활성화 |
| `walPath` | string | `'./data/buffer.wal'` | 버퍼 WAL 경로 |
| `syncReads` | boolean | `false` | 읽기 시 버퍼 강제 확인 |

### 메서드

#### `set(collection, id, data)`

자동 버퍼링 쓰기 (909K/sec)

```javascript
await db.set('users', 'user123', { name: 'Kim', age: 30 });
```

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `collection` | string | 컬렉션(테이블) 이름 |
| `id` | string | 문서 ID (null이면 자동 생성) |
| `data` | object | 저장할 데이터 |

**반환값**: `{ id: string, buffered: true }`

---

#### `setSync(collection, id, data)`

즉시 동기화 쓰기 (중요 데이터용)

```javascript
await db.setSync('transactions', 'tx001', { amount: 1000 });
```

**반환값**: `{ id: string, synced: true }`

---

#### `get(collection, id)`

데이터 조회 (캐시 → 버퍼 → DB 순서)

```javascript
const user = await db.get('users', 'user123');
// { id: 'user123', data: { name: 'Kim', age: 30 }, _version: 1 }
```

---

#### `getSync(collection, id)`

강제 동기화 후 조회 (버퍼 플러시 후 읽기)

```javascript
const user = await db.getSync('users', 'user123');
```

---

#### `delete(collection, id)`

삭제 (버퍼링)

```javascript
await db.delete('users', 'user123');
```

---

#### `getAll(collection, limit)`

전체 조회 (버퍼 플러시 후)

```javascript
const users = await db.getAll('users', 100);
```

---

#### `stats()`

통계 조회

```javascript
const stats = db.stats();
// {
//   bufferedWrites: 1500,
//   flushedWrites: 50000,
//   bufferSize: 500,
//   cacheHits: 10000,
//   cacheMisses: 1000,
//   walWrites: 1500,
//   recoveredWrites: 0,
//   shardCount: 8,
//   safeMode: true,
//   cacheSize: 200
// }
```

---

#### `close()`

안전한 종료 (버퍼 플러시 + WAL 체크포인트)

```javascript
db.close();
```

---

## HyperScaleDB 클래스

저수준 API (고급 사용자용)

### 생성자

```javascript
const db = new HyperScaleDB(options).init();
```

### 메서드

#### `write(collection, id, data, operation)`

저수준 쓰기

```javascript
db.write('users', 'user123', { name: 'Kim' }, 'upsert');
db.write('users', 'user123', null, 'delete');
```

| operation | 설명 |
|-----------|------|
| `'upsert'` | 삽입 또는 업데이트 (기본값) |
| `'delete'` | 삭제 |

---

#### `writeSync(collection, id, data)`

즉시 동기화 쓰기

---

#### `read(collection, id, options)`

저수준 읽기

```javascript
const data = db.read('users', 'user123', { sync: true });
```

---

#### `flush()`

수동 버퍼 플러시

```javascript
await db.flush();
```

---

#### `flushSync()`

동기 플러시 (모든 버퍼 비움)

```javascript
db.flushSync();
```

---

### 이벤트

```javascript
db.on('flush', ({ count }) => {
  console.log(`Flushed ${count} writes`);
});

db.on('error', (err) => {
  console.error('DB error:', err);
});
```

| 이벤트 | 데이터 | 설명 |
|--------|--------|------|
| `flush` | `{ count: number }` | 플러시 완료 시 |
| `error` | `Error` | 에러 발생 시 |

---

## 샤드 동작

### 샤드 결정 알고리즘

```javascript
// MD5 해시 앞 4바이트 → % shardCount
const hash = crypto.createHash('md5').update(key).digest();
const shardIndex = hash.readUInt32BE(0) % shardCount;
```

### 샤드별 파일

```
data/
├── hyperscale_shard0.db
├── hyperscale_shard1.db
├── hyperscale_shard2.db
├── hyperscale_shard3.db
├── hyperscale_shard4.db
├── hyperscale_shard5.db
├── hyperscale_shard6.db
└── hyperscale_shard7.db
```

---

## WAL 이중화

### 동작 원리

1. `write()` 호출
2. `buffer.wal`에 먼저 기록 (영속성)
3. 메모리 버퍼에 추가
4. 주기적 플러시 → SQLite 배치 INSERT
5. 성공 시 WAL 클리어

### 크래시 복구

```javascript
// 서버 재시작 시 자동 복구
const db = new SimpleDB({ safeMode: true });
// [kimdb] Recovering 150 buffered writes from WAL...
// [kimdb] Recovered 150 writes
```

---

## 성능 팁

### 1. 버퍼 크기 조정

```javascript
// 메모리 여유 있으면 버퍼 크게
const db = new SimpleDB({
  bufferSize: 50000,  // 5만개 버퍼
  batchSize: 5000     // 5천개씩 배치
});
```

### 2. 플러시 주기 조정

```javascript
// 지연시간 중요하면 짧게
const db = new SimpleDB({
  flushInterval: 50  // 50ms마다 플러시
});

// 처리량 중요하면 길게
const db = new SimpleDB({
  flushInterval: 500  // 500ms마다 플러시
});
```

### 3. 샤드 수 조정

```javascript
// CPU 코어 수에 맞춰서
const db = new SimpleDB({
  shardCount: 16  // 16코어 서버
});
```

---

## 예제

### 기본 사용

```javascript
import SimpleDB from 'kimdb/hyperscale';

const db = new SimpleDB({
  dbPath: './data/myapp.db',
  shardCount: 8
});

// 쓰기
await db.set('users', 'u001', { name: 'Kim', email: 'kim@test.com' });
await db.set('users', 'u002', { name: 'Lee', email: 'lee@test.com' });

// 읽기
const user = await db.get('users', 'u001');
console.log(user.data.name); // 'Kim'

// 통계
console.log(db.stats());

// 종료
db.close();
```

### 대량 쓰기 벤치마크

```javascript
const db = new SimpleDB({ bufferSize: 100000 });

const start = Date.now();
for (let i = 0; i < 1000000; i++) {
  await db.set('bench', `id_${i}`, { value: i });
}
db.flushSync();

const elapsed = Date.now() - start;
console.log(`1M writes in ${elapsed}ms`);
console.log(`${(1000000 / elapsed * 1000).toFixed(0)} writes/sec`);
```
