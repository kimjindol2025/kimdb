# 배포 가이드

> PM2, Docker로 KimDB 배포하기

## PM2 배포

### 1. 설치

```bash
npm install -g pm2
```

### 2. ecosystem 설정

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'kimdb-server',
    script: './server.js',
    instances: 1,  // 단일 인스턴스 권장 (SQLite)
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 40000
    },
    max_memory_restart: '1G',
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    watch: false,
    autorestart: true,
    restart_delay: 1000
  }]
};
```

### 3. 시작/관리

```bash
# 시작
pm2 start ecosystem.config.js

# 상태 확인
pm2 status

# 로그 보기
pm2 logs kimdb-server

# 재시작
pm2 restart kimdb-server

# 중지
pm2 stop kimdb-server

# 부팅 시 자동 시작
pm2 startup
pm2 save
```

---

## Docker 배포

### 1. Dockerfile

```dockerfile
FROM node:20-alpine

# better-sqlite3 빌드 의존성
RUN apk add --no-cache python3 make g++

WORKDIR /app

# 패키지 설치
COPY package*.json ./
RUN npm ci --only=production

# 소스 복사
COPY . .

# 데이터 디렉토리
RUN mkdir -p /app/data

# 포트
EXPOSE 40000

# 헬스체크
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:40000/health || exit 1

# 실행
CMD ["node", "server.js"]
```

### 2. docker-compose.yml

```yaml
version: '3.8'

services:
  kimdb:
    build: .
    ports:
      - "40000:40000"
    volumes:
      - ./data:/app/data
    environment:
      - NODE_ENV=production
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--spider", "http://localhost:40000/health"]
      interval: 30s
      timeout: 3s
      retries: 3

  # Redis (선택)
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes

volumes:
  redis_data:
```

### 3. 빌드 및 실행

```bash
# 빌드
docker compose build

# 실행
docker compose up -d

# 로그
docker compose logs -f kimdb

# 중지
docker compose down
```

---

## 서버 코드 예시

```javascript
// server.js
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import SimpleDB from 'kimdb/hyperscale';
import { monitorPlugin } from 'kimdb/monitor';

const PORT = process.env.PORT || 40000;

async function main() {
  const fastify = Fastify({
    logger: true
  });

  // CORS
  await fastify.register(cors, {
    origin: true
  });

  // WebSocket
  await fastify.register(websocket);

  // DB 초기화
  const db = new SimpleDB({
    dbPath: './data/app.db',
    shardCount: 8,
    safeMode: true
  });

  // 모니터링
  await fastify.register(monitorPlugin, { db: db.db });

  // Health Check
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // API 예시
  fastify.post('/api/users', async (req) => {
    const result = await db.set('users', null, req.body);
    return result;
  });

  fastify.get('/api/users/:id', async (req) => {
    const user = await db.get('users', req.params.id);
    if (!user) {
      return { error: 'Not found' };
    }
    return user;
  });

  // Graceful shutdown
  const shutdown = async () => {
    fastify.log.info('Shutting down...');
    db.close();
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // 시작
  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  fastify.log.info(`Server running on :${PORT}`);
  fastify.log.info(`Dashboard: http://localhost:${PORT}/kimdb/dashboard`);
}

main().catch(console.error);
```

---

## Nginx 프록시

```nginx
upstream kimdb {
    server 127.0.0.1:40000;
}

server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://kimdb;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }
}
```

---

## 데이터 백업

### 자동 백업 스크립트

```bash
#!/bin/bash
# backup.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR=/backup/kimdb
DATA_DIR=/app/data

mkdir -p $BACKUP_DIR

# SQLite 백업 (WAL 체크포인트 후)
for f in $DATA_DIR/*.db; do
  sqlite3 $f "PRAGMA wal_checkpoint(TRUNCATE);"
  cp $f $BACKUP_DIR/$(basename $f).$DATE
done

# 오래된 백업 삭제 (7일)
find $BACKUP_DIR -mtime +7 -delete

echo "Backup completed: $DATE"
```

### Cron 설정

```bash
# 매일 새벽 2시 백업
0 2 * * * /app/backup.sh >> /var/log/backup.log 2>&1
```

---

## 모니터링

### Prometheus 메트릭

```javascript
// metrics.js
import client from 'prom-client';

const register = new client.Registry();

const writeCounter = new client.Counter({
  name: 'kimdb_writes_total',
  help: 'Total writes'
});

const bufferGauge = new client.Gauge({
  name: 'kimdb_buffer_size',
  help: 'Current buffer size'
});

register.registerMetric(writeCounter);
register.registerMetric(bufferGauge);

// 주기적 업데이트
setInterval(() => {
  const stats = db.stats();
  bufferGauge.set(stats.bufferSize);
}, 5000);

// 엔드포인트
fastify.get('/metrics', async () => {
  return register.metrics();
});
```

### 알림 설정

```javascript
// alerts.js
const monitor = new KimDBMonitor(db.db).start();

monitor.on('stats', (stats) => {
  // 버퍼 오버플로우 경고
  if (stats.bufferSize > 50000) {
    sendAlert('Buffer overflow warning', {
      bufferSize: stats.bufferSize,
      threshold: 50000
    });
  }

  // 캐시 히트율 저하
  const hitRate = stats.cacheHits / (stats.cacheHits + stats.cacheMisses);
  if (hitRate < 0.8) {
    sendAlert('Cache hit rate low', { hitRate });
  }
});
```

---

## 체크리스트

### 배포 전

- [ ] `NODE_ENV=production` 설정
- [ ] 데이터 디렉토리 권한 확인
- [ ] 로그 디렉토리 생성
- [ ] WAL 이중화 활성화 (`safeMode: true`)
- [ ] 헬스체크 엔드포인트 구현

### 배포 후

- [ ] 헬스체크 응답 확인
- [ ] 모니터링 대시보드 접속
- [ ] 로그 정상 출력 확인
- [ ] 백업 스크립트 동작 확인
- [ ] Graceful shutdown 테스트
