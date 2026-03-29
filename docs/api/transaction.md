# Transaction API

> SQLite 동시 쓰기 직렬화 및 재시도 로직

## 개요

SQLite의 `SQLITE_BUSY` 에러를 자동 처리:
- **Write Queue**: 쓰기 요청 직렬화
- **Retry Logic**: BUSY 시 자동 재시도
- **Read Pool**: 읽기 전용 연결 풀
- **Transaction Manager**: 복합 트랜잭션 관리

## 설치

```javascript
import {
  enqueueWrite,
  runBatch,
  createReadPool,
  TransactionManager
} from 'kimdb/concurrent';
```

---

## Write Queue

### `enqueueWrite(db, operation)`

쓰기 큐에 추가 (자동 직렬화)

```javascript
import { enqueueWrite } from 'kimdb/concurrent';

await enqueueWrite(db, (db) => {
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)')
    .run('u001', 'Kim');
});
```

---

### `getQueueStatus()`

큐 상태 확인

```javascript
import { getQueueStatus } from 'kimdb/concurrent';

const status = getQueueStatus();
// { pending: 5, processing: true }
```

---

## Retry Logic

### 동작 원리

```javascript
// 내부 구현
const MAX_RETRIES = 3;
const RETRY_DELAY = 50; // ms

async function executeWithRetry(db, operation, retries = 0) {
  try {
    return operation(db);
  } catch (e) {
    if (e.code === 'SQLITE_BUSY' && retries < MAX_RETRIES) {
      await delay(RETRY_DELAY * (retries + 1)); // 50, 100, 150ms
      return executeWithRetry(db, operation, retries + 1);
    }
    throw e;
  }
}
```

---

## Read Pool

### `createReadPool(Database, dbPath, size)`

읽기 전용 연결 풀 생성

```javascript
import Database from 'better-sqlite3';
import { createReadPool, acquireReader, releaseReader } from 'kimdb/concurrent';

const pool = createReadPool(Database, './data/mydb.db', 4);

// 사용
const conn = acquireReader(pool);
try {
  const rows = conn.db.prepare('SELECT * FROM users').all();
} finally {
  releaseReader(conn);
}
```

---

## Batch Operations

### `runBatch(db, operations)`

여러 작업을 하나의 트랜잭션으로

```javascript
import { runBatch } from 'kimdb/concurrent';

const results = await runBatch(db, [
  (db) => db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('u001', 'Kim'),
  (db) => db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('u002', 'Lee'),
  (db) => db.prepare('UPDATE stats SET count = count + 2').run()
]);
```

---

## TransactionManager 클래스

고급 트랜잭션 관리

### 생성자

```javascript
import { TransactionManager } from 'kimdb/concurrent';

const tm = new TransactionManager(db);
```

### 메서드

#### `execute(operations, options)`

트랜잭션 실행 (자동 큐잉)

```javascript
const results = await tm.execute([
  (db) => db.prepare('UPDATE accounts SET balance = balance - 100 WHERE id = ?').run('acc1'),
  (db) => db.prepare('UPDATE accounts SET balance = balance + 100 WHERE id = ?').run('acc2')
], {
  timeout: 30000,  // 30초 타임아웃
  retries: 3       // 3회 재시도
});
```

---

#### `executeWithSavepoint(name, operations)`

Savepoint로 중첩 트랜잭션

```javascript
await tm.executeWithSavepoint('transfer', [
  (db) => db.prepare('UPDATE accounts SET balance = balance - 100 WHERE id = ?').run('acc1'),
  (db) => {
    const balance = db.prepare('SELECT balance FROM accounts WHERE id = ?').get('acc1');
    if (balance.balance < 0) throw new Error('Insufficient funds');
  },
  (db) => db.prepare('UPDATE accounts SET balance = balance + 100 WHERE id = ?').run('acc2')
]);
```

---

#### `rollbackTo(name)`

수동 롤백

```javascript
try {
  await tm.executeWithSavepoint('risky_op', operations);
} catch (e) {
  tm.rollbackTo('risky_op');
}
```

---

#### `getStats()`

트랜잭션 통계

```javascript
const stats = tm.getStats();
// {
//   total: 1000,
//   success: 990,
//   failed: 10,
//   retries: 50,
//   queueLength: 2,
//   processing: true
// }
```

---

## 전역 TransactionManager

### `initTransactionManager(db)`

전역 매니저 초기화

```javascript
import { initTransactionManager, runAtomicOperations } from 'kimdb/concurrent';

initTransactionManager(db);

// 이후 전역으로 사용
await runAtomicOperations(db, [
  (db) => db.prepare('...').run(),
  (db) => db.prepare('...').run()
]);
```

---

## 예제

### 송금 트랜잭션

```javascript
import { TransactionManager } from 'kimdb/concurrent';
import Database from 'better-sqlite3';

const db = new Database('./bank.db');
const tm = new TransactionManager(db);

async function transfer(fromId, toId, amount) {
  return tm.execute([
    // 1. 출금
    (db) => {
      const from = db.prepare('SELECT balance FROM accounts WHERE id = ?').get(fromId);
      if (!from || from.balance < amount) {
        throw new Error('Insufficient funds');
      }
      db.prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?').run(amount, fromId);
    },
    // 2. 입금
    (db) => {
      db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?').run(amount, toId);
    },
    // 3. 기록
    (db) => {
      db.prepare('INSERT INTO transactions (from_id, to_id, amount) VALUES (?, ?, ?)')
        .run(fromId, toId, amount);
    }
  ], { timeout: 5000 });
}

// 사용
await transfer('acc001', 'acc002', 1000);
```

### 동시 쓰기 처리

```javascript
import { enqueueWrite } from 'kimdb/concurrent';

// 100개 동시 요청도 안전하게 직렬화
const promises = [];
for (let i = 0; i < 100; i++) {
  promises.push(
    enqueueWrite(db, (db) => {
      db.prepare('INSERT INTO logs (message) VALUES (?)').run(`Log ${i}`);
    })
  );
}

await Promise.all(promises);
console.log('All 100 writes completed');
```

### 읽기/쓰기 분리

```javascript
import Database from 'better-sqlite3';
import { createReadPool, acquireReader, releaseReader, enqueueWrite } from 'kimdb/concurrent';

const writeDb = new Database('./data.db');
const readPool = createReadPool(Database, './data.db', 4);

// 쓰기 (직렬화)
await enqueueWrite(writeDb, (db) => {
  db.prepare('INSERT INTO items (name) VALUES (?)').run('Item 1');
});

// 읽기 (병렬)
const conn = acquireReader(readPool);
const items = conn.db.prepare('SELECT * FROM items').all();
releaseReader(conn);
```
