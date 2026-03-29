# Monitor API

> HyperScale 실시간 모니터링 및 대시보드

## 개요

KimDBMonitor는 HyperScale DB의 상태를 실시간 모니터링:
- **8샤드 상태**: 온라인/오프라인, 행 수
- **버퍼 메트릭**: 크기, 플러시 시간
- **성능 통계**: 쓰기/초, 캐시 히트율
- **대시보드 UI**: 웹 기반 실시간 UI

## 설치

```javascript
import { KimDBMonitor, monitorPlugin } from 'kimdb/monitor';
```

---

## KimDBMonitor 클래스

### 생성자

```javascript
const monitor = new KimDBMonitor(db);
```

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `db` | HyperScaleDB | 모니터링할 DB 인스턴스 |

### 메서드

#### `start(intervalMs)`

모니터링 시작

```javascript
monitor.start(1000); // 1초마다 수집
```

---

#### `stop()`

모니터링 중지

```javascript
monitor.stop();
```

---

#### `getStatus()`

전체 상태 조회

```javascript
const status = monitor.getStatus();
// {
//   status: 'healthy',
//   version: '7.6.1',
//   uptime: 3600,
//   timestamp: '2024-01-15T10:30:00.000Z',
//
//   overview: {
//     totalWrites: 500000,
//     bufferedWrites: 1500,
//     bufferSize: 200,
//     cacheHits: 100000,
//     cacheMisses: 5000,
//     cacheHitRate: '95.2%'
//   },
//
//   shards: [
//     { index: 0, status: 'online', tables: 3, rows: 62500 },
//     { index: 1, status: 'online', tables: 3, rows: 63200 },
//     ...
//   ],
//
//   wal: {
//     enabled: true,
//     writes: 1500,
//     recovered: 0
//   },
//
//   performance: {
//     avgFlushTime: 15,
//     writesPerSecond: 5000,
//     peakBufferSize: 10000
//   },
//
//   recentErrors: []
// }
```

---

#### `getShardStats()`

샤드별 상세 상태

```javascript
const shards = monitor.getShardStats();
// [
//   { index: 0, status: 'online', tables: 3, rows: 62500, path: './data/shard0.db' },
//   { index: 1, status: 'online', tables: 3, rows: 63200, path: './data/shard1.db' },
//   ...
// ]
```

---

#### `healthCheck()`

헬스 체크 (간단)

```javascript
const health = monitor.healthCheck();
// { status: 'ok', timestamp: '2024-01-15T10:30:00.000Z' }
// 또는
// { status: 'error', error: 'Shard 3 unavailable' }
```

---

### 이벤트

```javascript
monitor.on('stats', (stats) => {
  console.log('Current stats:', stats);
});
```

---

## Fastify 플러그인

### `monitorPlugin`

Fastify에 모니터링 라우트 자동 등록

```javascript
import Fastify from 'fastify';
import { monitorPlugin } from 'kimdb/monitor';
import SimpleDB from 'kimdb/hyperscale';

const fastify = Fastify();
const db = new SimpleDB();

await fastify.register(monitorPlugin, {
  db: db.db,        // HyperScaleDB 인스턴스
  prefix: '/kimdb'  // 라우트 접두사 (기본: '/kimdb')
});

await fastify.listen({ port: 3000 });
```

### 등록되는 라우트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/kimdb/health` | 헬스 체크 |
| GET | `/kimdb/status` | 전체 상태 |
| GET | `/kimdb/shards` | 샤드 상태 |
| GET | `/kimdb/history` | 히스토리 (차트용) |
| GET | `/kimdb/dashboard` | 대시보드 UI |

---

## 대시보드 UI

### 접속

```
http://localhost:3000/kimdb/dashboard
```

### 기능

1. **상태 뱃지**: HEALTHY / ERROR
2. **전체 통계**: 총 쓰기, 버퍼 크기, 캐시 히트율, 플러시 시간
3. **샤드 그리드**: 8개 샤드 상태 + 행 수
4. **버퍼 차트**: 최근 30초 버퍼 크기 추이
5. **WAL 상태**: 활성화 여부, 쓰기 수, 복구 수
6. **에러 로그**: 최근 5개 에러

### 자동 갱신

- 상태: 2초마다
- 히스토리: 5초마다

---

## 히스토리 데이터

### 구조

```javascript
const history = monitor.history;
// {
//   writes: [
//     { time: 1705312200000, value: 1000 },
//     { time: 1705312201000, value: 1500 },
//     ...
//   ],
//   flushTimes: [
//     { time: 1705312200000, count: 1000, duration: 15 },
//     ...
//   ],
//   bufferSizes: [
//     { time: 1705312200000, value: 200 },
//     ...
//   ],
//   errors: [
//     { time: 1705312200000, message: 'SQLITE_BUSY' },
//     ...
//   ]
// }
```

### 보관 기간

- 기본: 60초 (60개 샘플)
- 설정: `monitor.maxHistory = 300` (5분)

---

## 예제

### 기본 사용

```javascript
import SimpleDB from 'kimdb/hyperscale';
import { KimDBMonitor } from 'kimdb/monitor';

const db = new SimpleDB();
const monitor = new KimDBMonitor(db.db).start();

// 주기적 상태 출력
setInterval(() => {
  const status = monitor.getStatus();
  console.log(`Writes: ${status.overview.totalWrites}, Buffer: ${status.overview.bufferSize}`);
}, 5000);
```

### Fastify 통합

```javascript
import Fastify from 'fastify';
import SimpleDB from 'kimdb/hyperscale';
import { monitorPlugin } from 'kimdb/monitor';

async function main() {
  const fastify = Fastify({ logger: true });
  const db = new SimpleDB();

  await fastify.register(monitorPlugin, { db: db.db });

  // 비즈니스 로직
  fastify.post('/users', async (req) => {
    await db.set('users', null, req.body);
    return { success: true };
  });

  await fastify.listen({ port: 3000 });
  console.log('Dashboard: http://localhost:3000/kimdb/dashboard');
}

main();
```

### 알림 설정

```javascript
const monitor = new KimDBMonitor(db).start();

// 에러 발생 시 알림
monitor.on('stats', (stats) => {
  if (stats.bufferSize > 50000) {
    sendAlert('Buffer overflow warning!');
  }
});

// 또는 recentErrors 감시
setInterval(() => {
  const status = monitor.getStatus();
  if (status.recentErrors.length > 0) {
    sendAlert(`Errors detected: ${status.recentErrors.length}`);
  }
}, 60000);
```
