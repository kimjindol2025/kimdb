# kimdb v6.0.0

실시간 WebSocket 기반 JSON 문서 데이터베이스

## 특징

- **실시간 동기화**: WebSocket 기반 양방향 통신
- **Redis Pub/Sub**: 다중 서버 클러스터링 지원
- **CRDT**: 충돌 없는 복제 데이터 타입
- **LRU 캐시**: 메모리 효율적 캐싱
- **Graceful Shutdown**: 안전한 종료
- **Prometheus 메트릭**: 모니터링 지원
- **MariaDB 로깅**: 중앙 집중식 로그 저장

## 설치

```bash
git clone git@gogs.dclub.kr:kim/kimdb.git
cd kimdb
npm install
```

## 실행

```bash
# 단일 서버
npm start

# PM2로 실행
pm2 start ecosystem.config.cjs
```

## 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| PORT | 40000 | API 서버 포트 |
| REDIS_HOST | 127.0.0.1 | Redis 호스트 |
| REDIS_PORT | 6379 | Redis 포트 |
| MARIADB_HOST | 192.168.45.73 | MariaDB 호스트 |
| SERVER_ID | hostname | 서버 식별자 |

## API 엔드포인트

### REST API

| Method | Path | 설명 |
|--------|------|------|
| GET | /health | 서버 상태 |
| GET | /metrics | Prometheus 메트릭 |
| GET | /api/collections | 컬렉션 목록 |
| POST | /api/:collection | 문서 생성 |
| GET | /api/:collection/:id | 문서 조회 |
| PUT | /api/:collection/:id | 문서 수정 |
| DELETE | /api/:collection/:id | 문서 삭제 |

### WebSocket

```javascript
const ws = new WebSocket('ws://localhost:40000');

// 컬렉션 구독
ws.send(JSON.stringify({ type: 'subscribe', collection: 'users' }));

// 문서 생성
ws.send(JSON.stringify({
  type: 'create',
  collection: 'users',
  data: { name: 'kim' }
}));
```

## 클러스터 구성

Redis Pub/Sub을 통한 다중 서버 동기화:

```
┌─────────────┐     ┌─────────────┐     ┌────────────┐
│  Server 73  │────▶│    Redis    │◀────│ Server 253 │
│  :40000     │◀────│   Pub/Sub   │────▶│   :40001   │
└─────────────┘     └─────────────┘     └────────────┘
```

## 모니터링

24시간 대시보드: `http://192.168.45.73:40010`

- 서버 상태 실시간 체크
- MariaDB 로그 저장
- Gogs 웹훅 연동

## 테스트 결과

| 테스트 | 결과 |
|--------|------|
| 기능 테스트 | 13/13 통과 |
| 부하 테스트 (100 클라이언트) | 32K msg/sec |
| 부하 테스트 (10,000 클라이언트) | 57K msg/sec, 100% 성공 |
| 클러스터 테스트 (2서버) | 210만 동기화 이벤트, 0 에러 |
| 무결성 테스트 | 1,000 문서, 30분 검증 |

## 프로젝트 구조

```
kimdb/
├── src/
│   ├── api-server.js      # 메인 API 서버
│   ├── kimdb-core.js      # 코어 데이터베이스
│   └── ...
├── scripts/
│   ├── monitor-server.js  # 24시간 모니터링 대시보드
│   └── cross-check.js     # 크로스 체크 스크립트
├── test/
│   ├── feature-test.js    # 기능 테스트
│   ├── load-test.js       # 부하 테스트
│   ├── cluster-test.js    # 클러스터 테스트
│   └── integrity-test.js  # 무결성 테스트
└── ecosystem.config.cjs   # PM2 설정
```

## 라이선스

MIT License
