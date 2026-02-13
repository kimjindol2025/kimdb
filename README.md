🚀 KimDB

HyperScale Real-Time Collaborative Database
SQLite + CRDT + WebSocket 기반 초고성능 실시간 데이터베이스

909,000 INSERTs/sec
→ 쓰기 집중 워크로드에서 기존 분산 DB 대비 최대 24배 성능

✨ Why KimDB?
Database	Batch Insert	Latency	Note
KimDB	909K/sec	~1ms	8-Shard Parallel + Buffer
Citus PostgreSQL	37K/sec	2700ms	2PC overhead
Single SQLite	50K/sec	153ms	write lock

핵심 차별점

병렬 샤딩 구조

WAL 이중화

버퍼링 쓰기 엔진

CRDT 충돌 없는 병합

실시간 동기화

🧠 Core Features
⚡ HyperScale Engine

10,000+ 동시 접속

버퍼링 쓰기

자동 flush 최적화

🧩 8-Shard Parallel System

MD5 기반 자동 분산

병렬 INSERT 처리

shard별 WAL

🔄 Real-Time Sync

WebSocket 기반 실시간 동기화

오프라인 지원

reconnect 자동 병합

🤝 CRDT Collaboration Engine

Google Docs 수준 협업 엔진 내장

지원 타입:

VectorClock

LWW-Set / Map

RGA

RichText

Cursor Manager

Presence Manager

Undo Manager

📦 Installation
npm install kimdb

🚀 Quick Start
Server
import { KimDBServer } from 'kimdb/server';

const server = new KimDBServer({
  port: 40000,
  storage: 'sqlite:./data/kimdb.sqlite',
  redis: { host: 'localhost', port: 6379 }
});

server.start();

Client
import { KimDBClient } from 'kimdb/client';

const client = new KimDBClient({
  url: 'ws://localhost:40000'
});

await client.connect();

const doc = await client.createDocument('my-doc');
doc.update({ title: 'Hello KimDB' });

HyperScale Write Engine
import SimpleDB from 'kimdb/hyperscale';

const db = new SimpleDB({
  dbPath: './data/hyper.db',
  shardCount: 8,
  bufferSize: 10000,
  flushInterval: 100
});

await db.set('users', 'user1', { name: 'Kim' });

🧱 Architecture
                KimDB Core
 ┌──────────────────────────────────┐
 │ HyperScale Write Engine          │
 │ Sharding Manager (8 shards)      │
 │ Transaction Queue + Retry        │
 │ CRDT Sync Engine                 │
 └───────────────┬──────────────────┘
                 ↓
       SQLite WAL per shard

📊 Performance Benchmarks
Operation	Throughput	Latency
Buffered Write	909K/s	~1ms
Sync Write	50K/s	~10ms
Read (Cache)	500K/s	<1ms
Read (DB)	100K/s	~5ms
CRDT Merge	10K ops	~0.1ms
🧩 Module System
Import	Purpose
kimdb	main entry
kimdb/server	server runtime
kimdb/client	client SDK
kimdb/crdt	CRDT engine
kimdb/hyperscale	write engine
kimdb/sharding	shard manager
kimdb/monitor	dashboard
📊 Monitoring Dashboard

접속:

http://localhost:3000/kimdb/dashboard


기능:

shard 상태

WAL 상태

write/sec

buffer usage

error logs

🎯 Use Cases

✔ 협업 문서 에디터
✔ 실시간 대시보드
✔ 멀티플레이어 게임 상태 동기화
✔ 오프라인 앱 동기화
✔ 이벤트 스트림 저장소

⚙️ Tech Stack

TypeScript

Node.js ≥ 18

SQLite (better-sqlite3)

Fastify

WebSocket

Redis (optional)

Custom CRDT engine

📂 Project Structure
kimdb/
 ├ src/
 ├ packages/
 ├ tests/
 ├ k8s/
 ├ docs/
 ├ dist/
 ├ openapi.yaml
 └ docker-compose.yml

🔐 Security

input validation

WAL durability

retry transaction queue

Planned:

role permissions

encryption layer

distributed auth

🗺 Roadmap

distributed cluster mode

multi-region replication

snapshot engine

time-travel queries

AI query optimizer

📜 License

MIT License

⭐ Summary

KimDB = Local DB 속도 + Distributed DB 확장성 + CRDT 협업

즉

"단일 DB처럼 빠르고, 분산 DB처럼 확장되고, 협업툴처럼 동기화된다"
