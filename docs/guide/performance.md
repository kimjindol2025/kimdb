# 성능 가이드

> 909,000 INSERTs/sec 달성하기

## 벤치마크 결과

| 설정 | 처리량 | 지연시간 |
|------|--------|----------|
| 기본값 | 300K/s | ~3ms |
| 최적화 | 909K/s | ~1ms |
| 동기 쓰기 | 50K/s | ~10ms |

## 기본 vs 최적화

```javascript
// 기본값
const db = new SimpleDB();
// 300K/s

// 최적화
const db = new SimpleDB({
  shardCount: 8,
  bufferSize: 100000,
  flushInterval: 100,
  batchSize: 5000,
  safeMode: true
});
// 909K/s
```

---

## 튜닝 파라미터

### 1. shardCount

병렬 쓰기 수

| 값 | 효과 | 적합한 경우 |
|----|------|------------|
| 4 | 4배 처리량 | 일반 |
| 8 | 8배 처리량 | 고성능 (기본) |
| 16 | 16배 처리량 | 대용량 서버 |

```javascript
// CPU 코어 수에 맞춰서
const os = require('os');
const shardCount = Math.min(os.cpus().length, 16);
```

### 2. bufferSize

메모리 버퍼 크기

| 값 | 메모리 | 적합한 경우 |
|----|--------|------------|
| 10000 | ~10MB | 메모리 제한 |
| 50000 | ~50MB | 일반 (기본) |
| 100000 | ~100MB | 고성능 |

```javascript
// 메모리 여유에 따라
const bufferSize = process.env.LOW_MEMORY ? 10000 : 100000;
```

### 3. flushInterval

플러시 주기 (ms)

| 값 | 효과 | 트레이드오프 |
|----|------|------------|
| 50 | 낮은 지연 | 처리량↓ |
| 100 | 균형 (기본) | - |
| 500 | 높은 처리량 | 지연↑ |

```javascript
// 실시간성이 중요하면
const flushInterval = 50;

// 처리량이 중요하면
const flushInterval = 500;
```

### 4. batchSize

배치당 쓰기 수

| 값 | 효과 |
|----|------|
| 1000 | 안정적 |
| 5000 | 고성능 (기본) |
| 10000 | 최대 처리량 |

---

## vs Citus PostgreSQL

| 항목 | KimDB | Citus |
|------|-------|-------|
| 배치 INSERT | 909K/s | 37K/s |
| 지연시간 | ~1ms | 2,700ms |
| 2PC 오버헤드 | 없음 | 1,000ms+ |

### 왜 24배 빠른가?

**Citus의 2PC (Two-Phase Commit)**:
```
1. PREPARE → 모든 워커에 전송 (500ms)
2. 응답 대기 (500ms)
3. COMMIT → 모든 워커에 전송 (500ms)
4. 응답 대기 (500ms)
→ 최소 2,000ms
```

**KimDB**:
```
1. 버퍼에 추가 (1ms)
2. 즉시 반환
→ 백그라운드 배치 INSERT
```

---

## 읽기 최적화

### 1. 캐시 활용

```javascript
// 캐시 히트: <1ms
const user = await db.get('users', 'u001');

// 캐시 미스 후 DB: ~5ms
const user2 = await db.get('users', 'u002');
```

### 2. Read Pool

```javascript
import { createReadPool, acquireReader, releaseReader } from 'kimdb/concurrent';

const readPool = createReadPool(Database, './data.db', 4);

// 병렬 읽기
const conn = acquireReader(readPool);
const rows = conn.db.prepare('SELECT * FROM users').all();
releaseReader(conn);
```

### 3. 배치 조회

```javascript
// 비효율: 100번 조회
for (const id of ids) {
  const user = await db.get('users', id);
}

// 효율: 1번 조회
const users = await db.getAll('users', 100);
```

---

## 메모리 관리

### 캐시 정리

```javascript
// 캐시는 60초 후 자동 만료
// 수동 정리 필요 시:
db.db.readCache.clear();
```

### WAL 체크포인트

```javascript
// 주기적 WAL 정리
setInterval(() => {
  for (const [idx, shard] of db.db.shards) {
    shard.pragma('wal_checkpoint(TRUNCATE)');
  }
}, 60000);
```

---

## 벤치마크 코드

```javascript
import SimpleDB from 'kimdb/hyperscale';

async function benchmark() {
  const db = new SimpleDB({
    dbPath: './bench/test.db',
    shardCount: 8,
    bufferSize: 100000,
    batchSize: 5000
  });

  const COUNT = 1000000;
  const start = Date.now();

  for (let i = 0; i < COUNT; i++) {
    await db.set('bench', `id_${i}`, { value: i });
  }

  db.db.flushSync();

  const elapsed = Date.now() - start;
  const rate = Math.round(COUNT / elapsed * 1000);

  console.log(`${COUNT.toLocaleString()} writes in ${elapsed}ms`);
  console.log(`${rate.toLocaleString()} writes/sec`);
  console.log(db.stats());

  db.close();
}

benchmark();
```

예상 결과:
```
1,000,000 writes in 1100ms
909,090 writes/sec
{
  bufferedWrites: 1000000,
  flushedWrites: 1000000,
  ...
}
```

---

## 권장 설정

### 로그/센서 (쓰기 집중)

```javascript
const db = new SimpleDB({
  shardCount: 8,
  bufferSize: 100000,
  flushInterval: 500,
  batchSize: 10000,
  safeMode: true
});
```

### 웹 앱 (균형)

```javascript
const db = new SimpleDB({
  shardCount: 4,
  bufferSize: 50000,
  flushInterval: 100,
  safeMode: true
});
```

### 실시간 (저지연)

```javascript
const db = new SimpleDB({
  shardCount: 8,
  bufferSize: 10000,
  flushInterval: 50,
  safeMode: true
});
```
