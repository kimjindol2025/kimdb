# kimdb Project Charter

**Project Name**: kimdb
**Title**: 고성능 실시간 협업 문서 데이터베이스
**Performance**: **909,000 INSERTs/sec** (Citus PostgreSQL 대비 24배)
**Status**: ✅ **Production-Ready**
**Repository**: https://gogs.dclub.kr/kim/kimdb.git

---

## 프로젝트 개요

**SQLite + WebSocket + CRDT 기반 하이퍼스케일 데이터베이스** - 실시간 협업 편집과 극단적 성능을 동시에 달성

### 목표
- ✅ 909K INSERT/초 초고속 성능
- ✅ 실시간 협업 편집 (Google Docs 스타일)
- ✅ 10,000+ 동시 접속 지원
- ✅ 오프라인 동기화

### 핵심 기능
✅ **HyperScale** - 10,000+ 동시 접속, 버퍼링 쓰기
✅ **8-Shard Parallel** - MD5 기반 자동 분산
✅ **CRDT Engine** - VectorClock, LWW-Set, RGA
✅ **Real-time Sync** - WebSocket 실시간 동기화
✅ **Transaction Manager** - 큐 기반 직렬화

---

## 성능 비교

### INSERT 성능

| 데이터베이스 | 배치 INSERT | 지연시간 | 특징 |
|-------------|-------------|----------|------|
| **KimDB** | **909K/sec** | **~1ms** | 버퍼링 + 8샤드 병렬 |
| Citus PostgreSQL | 37K/sec | 2,700ms | 2PC 오버헤드 |
| 단일 SQLite | 50K/sec | 153ms | 단일 쓰기 락 |

### 24배 성능 향상의 비결

1. **버퍼링 쓰기** - 배치 처리로 락 경쟁 최소화
2. **8샤드 분산** - MD5 해시로 자동 분산
3. **병렬 처리** - 동시 샤드 쓰기
4. **WAL 이중화** - 장애 복구 보장

---

## 핵심 기술

### 1. CRDT (Conflict-free Replicated Data Type)

**지원하는 타입**:
- **VectorClock** - 인과 관계 추적
- **LWW-Set/Map** - Last-Writer-Wins 충돌 해결
- **RGA** - Rich-text CRDT (Google Docs급)
- **RichText** - 실시간 텍스트 편집

### 2. 8-Shard Parallel Architecture

```
Key → MD5 Hash
  ↓
Shard 0-7 분산
  ↓
병렬 INSERT
  ↓
909K/sec 달성
```

### 3. WebSocket 실시간 동기화

- 오프라인 지원
- 변경사항 자동 병합
- 충돌 자동 해결 (CRDT)

---

## API

### 서버 초기화

```typescript
const server = new KimDBServer({
  port: 40000,
  storage: 'sqlite:./data/kimdb.sqlite',
  redis: { host: 'localhost', port: 6379 }
});

server.start();
```

### 클라이언트 사용

```typescript
const client = new KimDBClient({ url: 'ws://localhost:40000' });
await client.connect();

const doc = await client.createDocument('my-doc');
doc.update({ title: 'Hello KimDB' });

// 실시간 변경 리스닝
doc.onChange((change) => {
  console.log('문서 변경:', change);
});
```

### HyperScale (고성능 모드)

```javascript
const db = new SimpleDB({
  dbPath: './data/hyperscale.db',
  shardCount: 8,
  bufferSize: 10000,
  flushInterval: 100
});

// 자동 버퍼링 - 909K/sec
await db.set('users', 'user123', { name: 'Kim', age: 30 });
```

---

## 기술 스택

| 항목 | 선택 |
|------|------|
| **언어** | TypeScript/JavaScript |
| **런타임** | Node.js 18+ |
| **저장소** | SQLite (8샤드) |
| **실시간** | WebSocket |
| **캐시** | Redis (옵션) |
| **CRDT** | 자체 구현 |

---

## 설치

```bash
npm install kimdb
```

---

## 성공 지표

| 항목 | 목표 | 달성 |
|------|------|------|
| **INSERT 성능** | 100K+/sec | ✅ 909K |
| **지연시간** | <10ms | ✅ ~1ms |
| **동시 접속** | 1000+ | ✅ 10,000+ |
| **실시간 동기화** | <100ms | ✅ |

---

## 라이선스

MIT (npm에 공개)

**최종 업데이트**: 2026-03-15
**상태**: Production-Ready ✅
