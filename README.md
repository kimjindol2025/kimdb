# KimDB

[![Build](https://github.com/kim/kimdb/actions/workflows/test.yml/badge.svg)](https://github.com/kim/kimdb/actions)
[![npm version](https://img.shields.io/npm/v/kimdb.svg)](https://www.npmjs.com/package/kimdb)
[![npm downloads](https://img.shields.io/npm/dw/kimdb.svg)](https://www.npmjs.com/package/kimdb)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

> 고성능 실시간 협업 문서 데이터베이스 (SQLite + WebSocket + CRDT)

**909,000 INSERTs/sec** - Citus PostgreSQL보다 24배 빠름

## 왜 KimDB인가?

| 데이터베이스 | 배치 INSERT | 지연시간 | 비고 |
|-------------|-------------|----------|------|
| **KimDB** | **909K/sec** | **~1ms** | 버퍼링 + 8샤드 병렬 |
| Citus PostgreSQL | 37K/sec | 2,700ms | 2PC 오버헤드 |
| 단일 SQLite | 50K/sec | 153ms | 단일 쓰기 락 |

## 핵심 기능

- **HyperScale**: 10,000+ 동시 접속, 버퍼링 쓰기, WAL 이중화
- **8-Shard Parallel**: MD5 해시 기반 자동 분산, 병렬 배치 INSERT
- **CRDT Engine**: VectorClock, LWW-Set/Map, RGA, RichText (Google Docs급)
- **Real-time Sync**: WebSocket 실시간 동기화, 오프라인 지원
- **Transaction Manager**: 큐 기반 직렬화, SQLITE_BUSY 자동 재시도
- **Monitor Dashboard**: 8샤드 상태, 실시간 메트릭

## 설치

```bash
npm install kimdb
```

## 빠른 시작

### 1. 서버

```typescript
import { KimDBServer } from 'kimdb/server';

const server = new KimDBServer({
  port: 40000,
  storage: 'sqlite:./data/kimdb.sqlite',
  redis: { host: 'localhost', port: 6379 }  // 옵션
});

server.start();
```

### 2. 클라이언트

```typescript
import { KimDBClient } from 'kimdb/client';

const client = new KimDBClient({ url: 'ws://localhost:40000' });
await client.connect();

// 문서 생성 및 실시간 편집
const doc = await client.createDocument('my-doc');
doc.update({ title: 'Hello KimDB' });
```

### 3. HyperScale (고성능 쓰기)

```javascript
import SimpleDB from 'kimdb/hyperscale';

const db = new SimpleDB({
  dbPath: './data/hyperscale.db',
  shardCount: 8,
  bufferSize: 10000,
  flushInterval: 100
});

// 자동 버퍼링 (909K/sec)
await db.set('users', 'user123', { name: 'Kim', age: 30 });

// 즉시 동기화 (중요 데이터)
await db.setSync('transactions', 'tx001', { amount: 1000 });

// 조회
const user = await db.get('users', 'user123');
```

### 4. CRDT 실시간 협업

```javascript
import { CRDTDocument } from 'kimdb/crdt';

// 클라이언트 A
const docA = new CRDTDocument('client-a', 'shared-doc');
const op1 = docA.set('title', 'Hello');

// 클라이언트 B (동시 편집)
const docB = new CRDTDocument('client-b', 'shared-doc');
const op2 = docB.set('title', 'World');

// 충돌 없는 자동 병합
docA.applyRemote(op2);
docB.applyRemote(op1);
// 결과: 둘 다 동일한 상태 (LWW)
```

## 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                     KimDB v7.6.1                        │
├─────────────┬─────────────┬─────────────┬──────────────┤
│ HyperScale  │   Sharding  │ Transaction │   CRDT v2    │
│ (버퍼+WAL)  │  (8샤드)    │  (큐+재시도) │ (실시간협업)  │
├─────────────┴─────────────┴─────────────┴──────────────┤
│              SQLite WAL Mode (each shard)               │
└─────────────────────────────────────────────────────────┘
```

## 모듈 구조

| Import | 용도 |
|--------|------|
| `kimdb` | 메인 (서버+클라이언트) |
| `kimdb/server` | 서버 전용 |
| `kimdb/client` | 클라이언트 전용 |
| `kimdb/crdt` | CRDT 엔진 |
| `kimdb/hyperscale` | HyperScale 고성능 쓰기 |
| `kimdb/sharding` | 샤드 매니저 |
| `kimdb/monitor` | 모니터링 대시보드 |

## CRDT 타입

| 타입 | 설명 | 용도 |
|------|------|------|
| `VectorClock` | 인과적 순서 | 동시성 감지 |
| `LWWSet` | Last-Writer-Wins Set | 태그, 카테고리 |
| `LWWMap` | 3-way 자동 병합 | JSON 문서 |
| `RGA` | Replicated Growable Array | 리스트, 텍스트 |
| `RichText` | 서식 + 임베드 | 에디터 (Quill 호환) |
| `CursorManager` | 협업 커서 | 실시간 커서 공유 |
| `PresenceManager` | 온라인 유저 | 접속자 표시 |
| `UndoManager` | Ctrl+Z 지원 | 편집 취소 |

## 성능 벤치마크

| 작업 | 처리량 | 지연시간 |
|-----|--------|----------|
| 버퍼 쓰기 | 909,000/s | ~1ms |
| 동기 쓰기 | 50,000/s | ~10ms |
| 읽기 (캐시) | 500,000/s | <1ms |
| 읽기 (DB) | 100,000/s | ~5ms |
| CRDT 병합 | 10,000 ops/s | ~0.1ms |
| WebSocket 동기화 | 1,000 동시 | <50ms |

## vs Citus PostgreSQL

| 항목 | KimDB | Citus |
|------|-------|-------|
| 배치 INSERT | 909K/sec | 37K/sec |
| 지연시간 | ~1ms | 2,700ms |
| 2PC 오버헤드 | 없음 | 1,000ms+ |
| 실시간 동기화 | CRDT 내장 | 별도 구현 필요 |
| 오프라인 지원 | O | X |
| 설정 복잡도 | npm install | 클러스터 구성 |

**결론**: 쓰기 집중 워크로드에서 KimDB가 **24배 빠름**

## 사용 사례

### 협업 에디터 (Google Docs 스타일)

```javascript
const doc = new CRDTDocument('user-1', 'document-1');

// RichText 편집
doc.richInsert('content', 0, 'H', { bold: true });
doc.richInsert('content', 1, 'e');
doc.richInsert('content', 2, 'l');
doc.richInsert('content', 3, 'l');
doc.richInsert('content', 4, 'o');

// 서식 적용
doc.richFormat('content', 0, 5, { bold: true, color: '#ff0000' });

// Delta 포맷 (Quill 호환)
const delta = doc.richGetDelta('content');
```

### 실시간 대시보드

```javascript
const dashboard = await client.getDocument('dashboard');

dashboard.watch((changes) => {
  updateCharts(changes);
});
```

### 오프라인 앱

```javascript
const doc = await client.getDocument('offline-doc');
doc.update({ status: 'offline' }); // 로컬 저장

// 네트워크 복구 시 자동 동기화
client.on('reconnect', () => {
  doc.sync(); // CRDT 자동 병합
});
```

### 멀티플레이어 게임

```javascript
const gameState = new CRDTDocument('player-1', 'game-room');

// 모든 플레이어가 동시에 수정해도 충돌 없음
gameState.set('players.player1.position', { x: 100, y: 200 });
gameState.setAdd('items', { type: 'sword', id: 'item-001' });
```

## 모니터링

```javascript
import { monitorPlugin } from 'kimdb/monitor';

// Fastify에 등록
fastify.register(monitorPlugin, { db: hyperscaleDb });

// 대시보드 접속
// http://localhost:3000/kimdb/dashboard
```

**대시보드 기능:**
- 8샤드 상태 (온라인/오프라인)
- 버퍼 크기 추이 (차트)
- 초당 쓰기 수
- WAL 상태
- 최근 에러

## 기술 스택

- **언어**: TypeScript + Node.js 18+
- **데이터베이스**: SQLite (better-sqlite3)
- **실시간**: WebSocket (@fastify/websocket)
- **동기화**: CRDT (자체 구현, 외부 의존성 없음)
- **캐시**: Redis (선택)
- **API**: Fastify

## 요구사항

- Node.js >= 18.0.0
- better-sqlite3 (네이티브 모듈)

## 링크

- **NPM**: https://www.npmjs.com/package/kimdb
- **저장소**: https://gogs.dclub.kr/kim/kimdb
- **문서**: [docs/](./docs/)

## 라이선스

MIT License

## 릴리스 현황

- **현재 버전**: v7.6.1
- **릴리스**: 4개 (v7.0.0 ~ v7.6.1)
- **npm 다운로드**: 403+/week
