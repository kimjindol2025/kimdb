# KimDB 문서

> 고성능 실시간 협업 문서 데이터베이스

## 빠른 링크

- [빠른 시작](./guide/getting-started.md) - 5분 만에 시작하기
- [NPM 패키지](https://www.npmjs.com/package/kimdb)

---

## 가이드

| 문서 | 설명 |
|------|------|
| [빠른 시작](./guide/getting-started.md) | 설치 및 기본 사용법 |
| [핵심 개념](./guide/concepts.md) | 버퍼링, 샤딩, CRDT 원리 |
| [성능 가이드](./guide/performance.md) | 909K/sec 달성하기 |
| [실시간 협업](./guide/real-time.md) | Google Docs 스타일 구현 |
| [배포](./guide/deployment.md) | PM2, Docker 배포 |

---

## API 레퍼런스

| 모듈 | 설명 |
|------|------|
| [HyperScale](./api/hyperscale.md) | 고성능 버퍼링 쓰기 (909K/sec) |
| [Sharding](./api/sharding.md) | 8샤드 병렬 처리 |
| [Transaction](./api/transaction.md) | 트랜잭션 관리, 재시도 |
| [CRDT](./api/crdt.md) | 실시간 협업 (VectorClock, LWW, RGA, RichText) |
| [Monitor](./api/monitor.md) | 모니터링 대시보드 |

---

## 모듈 Import

```javascript
// 메인
import { KimDBServer, KimDBClient } from 'kimdb';

// 개별 모듈
import SimpleDB from 'kimdb/hyperscale';
import { ShardManager } from 'kimdb/sharding';
import { CRDTDocument } from 'kimdb/crdt';
import { monitorPlugin } from 'kimdb/monitor';
```

---

## 버전

- **현재**: v7.6.1
- **Node.js**: >= 18.0.0
- **라이선스**: MIT

---

## 지원

- **저장소**: https://gogs.dclub.kr/kim/kimdb
- **NPM**: https://www.npmjs.com/package/kimdb
