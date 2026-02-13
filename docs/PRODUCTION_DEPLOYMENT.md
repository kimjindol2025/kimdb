# KimDB Production Deployment Guide

엔터프라이즈 수준의 KimDB 배포 및 운영 가이드입니다.

## 📋 목차

1. [사전 요구사항](#사전-요구사항)
2. [Docker Compose 배포](#docker-compose-배포)
3. [Kubernetes 배포](#kubernetes-배포)
4. [성능 튜닝](#성능-튜닝)
5. [모니터링 & 경보](#모니터링--경보)
6. [백업 & 복구](#백업--복구)
7. [보안 설정](#보안-설정)
8. [트러블슈팅](#트러블슈팅)

---

## 사전 요구사항

### 최소 사양
- **CPU**: 4 코어 이상
- **메모리**: 8GB 이상
- **스토리지**: 200GB 이상 (SSD 권장)
- **OS**: Linux (Ubuntu 20.04 LTS 이상) 또는 macOS
- **네트워크**: 1Gbps 이상

### 필수 소프트웨어
```bash
# Docker & Docker Compose
docker --version      # 20.10+
docker-compose --version  # 2.0+

# Kubernetes (K8s 배포시)
kubectl version --client  # 1.24+
helm version              # 3.0+

# 모니터링 스택
# Prometheus, Grafana, AlertManager
```

### 보안 준비
```bash
# SSL/TLS 인증서
- Let's Encrypt (무료)
- 또는 자체 CA 인증서

# 보안 키 생성
openssl rand -base64 64 > jwt-secret.txt
openssl rand -base64 64 > api-key.txt
```

---

## Docker Compose 배포

### 1. 환경 설정

```bash
# 프로덕션 환경 파일 생성
cp .env.production.example .env.production

# 민감한 정보 설정 (필수!)
vim .env.production
```

**필수 변경 항목:**
```env
JWT_SECRET=<generate-strong-random-64-char-string>
REFRESH_SECRET=<generate-strong-random-64-char-string>
API_KEY=<generate-strong-random-32-char-string>
REDIS_PASSWORD=<generate-strong-random-password>
GRAFANA_PASSWORD=<generate-strong-password>
CORS_ORIGIN=https://yourdomain.com
```

### 2. 배포 시작

```bash
# 프로덕션 Docker Compose 실행
docker-compose -f docker-compose.prod.yml up -d

# 상태 확인
docker-compose -f docker-compose.prod.yml ps

# 로그 확인
docker-compose -f docker-compose.prod.yml logs -f kimdb
```

### 3. 헬스 체크

```bash
# API 헬스 확인
curl http://localhost:40000/health

# WebSocket 연결 확인
curl -i -N -H "Connection: Upgrade" \
     -H "Upgrade: websocket" \
     http://localhost:8080/ws

# 메트릭 확인
curl http://localhost:9090/metrics
```

### 4. Nginx 리버스 프록시 설정

```nginx
upstream kimdb_backend {
    server kimdb-server:40000;
    keepalive 32;
}

upstream kimdb_websocket {
    server kimdb-server:8080;
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    # 보안 헤더
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;

    # API
    location /api {
        proxy_pass http://kimdb_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket
    location /ws {
        proxy_pass http://kimdb_websocket;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;
    }

    # 레이트 리미팅
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=100r/m;
    limit_req zone=api_limit burst=20 nodelay;
}

server {
    listen 80;
    server_name api.example.com;
    return 301 https://$server_name$request_uri;
}
```

---

## Kubernetes 배포

### 1. 사전 준비

```bash
# 스토리지 클래스 생성
kubectl apply -f k8s/storage-class.yaml

# 네임스페이스 생성
kubectl apply -f k8s/namespace.yaml

# ConfigMap, Secret 생성
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml
```

### 2. 배포

```bash
# StatefulSet 배포
kubectl apply -f k8s/statefulset.yaml

# Service 배포
kubectl apply -f k8s/service.yaml

# Ingress 배포 (cert-manager 필요)
kubectl apply -f k8s/ingress.yaml

# HPA 배포
kubectl apply -f k8s/hpa.yaml
```

### 3. 배포 상태 확인

```bash
# Pod 상태
kubectl get pods -n kimdb

# Service 상태
kubectl get svc -n kimdb

# Ingress 상태
kubectl get ingress -n kimdb

# 로그 확인
kubectl logs -n kimdb -f statefulset/kimdb
```

### 4. Helm으로 배포 (권장)

```bash
# Helm Chart 설치
helm install kimdb ./helm/kimdb \
  --namespace kimdb \
  --create-namespace \
  --values helm/values-prod.yaml

# 업그레이드
helm upgrade kimdb ./helm/kimdb \
  --namespace kimdb \
  --values helm/values-prod.yaml

# 상태 확인
helm status kimdb -n kimdb
helm history kimdb -n kimdb
```

---

## 성능 튜닝

### 1. 데이터베이스 튜닝

```javascript
// HyperScale 설정
const config = {
  bufferSize: 50000,      // 버퍼 크기 증가
  flushInterval: 50,      // 플러시 간격 단축
  shardCount: 16,         // 샤드 수 증가
  walEnabled: true,       // WAL 활성화
};
```

### 2. 메모리 최적화

```bash
# Node.js 메모리 설정
export NODE_OPTIONS="--max-old-space-size=4096"

# 가비지 컬렉션 최적화
export NODE_OPTIONS="--max-old-space-size=4096 --expose-gc"
```

### 3. Redis 캐싱

```bash
# Redis 메모리 설정
redis-server --maxmemory 2gb --maxmemory-policy allkeys-lru
```

### 4. 커넥션 풀

```javascript
const pool = {
  min: 50,
  max: 100,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};
```

---

## 모니터링 & 경보

### 1. Prometheus 메트릭

```yaml
# prometheus.prod.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'kimdb'
    static_configs:
      - targets: ['localhost:9100']

  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']
```

### 2. Grafana 대시보드

```bash
# 대시보드 임포트
curl -X POST http://localhost:3001/api/dashboards/db \
  -H "Content-Type: application/json" \
  -d @grafana-dashboard.json
```

### 3. 경보 규칙

```yaml
# alertmanager.yml
groups:
  - name: kimdb
    rules:
    - alert: HighCPU
      expr: rate(cpu_usage[5m]) > 0.8
      for: 5m
      annotations:
        summary: "High CPU usage detected"

    - alert: HighMemory
      expr: memory_usage_bytes / memory_limit_bytes > 0.9
      for: 5m
      annotations:
        summary: "High memory usage detected"

    - alert: DatabaseDown
      expr: up{job="kimdb"} == 0
      for: 1m
      annotations:
        summary: "KimDB is down"
```

---

## 백업 & 복구

### 1. 자동 백업

```bash
# 백업 스크립트
#!/bin/bash
BACKUP_DIR="/app/backups"
DB_PATH="/app/data/kimdb.sqlite"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# SQLite 백업
sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/kimdb_$TIMESTAMP.db'"

# 타르볼 압축
tar -czf "$BACKUP_DIR/kimdb_$TIMESTAMP.tar.gz" "$DB_PATH" /app/logs

# 오래된 백업 삭제 (30일 이상)
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +30 -delete

echo "Backup completed: $BACKUP_DIR/kimdb_$TIMESTAMP.tar.gz"
```

### 2. WAL (Write-Ahead Logging)

```bash
# WAL 모드 확인
sqlite3 /app/data/kimdb.sqlite "PRAGMA journal_mode;"

# WAL 체크포인트
sqlite3 /app/data/kimdb.sqlite "PRAGMA wal_checkpoint(PASSIVE);"
```

### 3. 복구 절차

```bash
# 1. 서비스 정지
docker-compose -f docker-compose.prod.yml down

# 2. 현재 데이터 백업
cp /app/data/kimdb.sqlite /app/backups/kimdb_corrupted.db

# 3. 백업에서 복구
cp /app/backups/kimdb_YYYYMMDD_HHMMSS.db /app/data/kimdb.sqlite

# 4. 서비스 재시작
docker-compose -f docker-compose.prod.yml up -d

# 5. 헬스 체크
curl http://localhost:40000/health
```

---

## 보안 설정

### 1. 방화벽 규칙

```bash
# UFW 방화벽
ufw allow 22/tcp      # SSH
ufw allow 80/tcp      # HTTP
ufw allow 443/tcp     # HTTPS
ufw allow 40000/tcp   # KimDB API
ufw allow 8080/tcp    # WebSocket
ufw default deny incoming
ufw enable
```

### 2. SSL/TLS 설정

```bash
# Let's Encrypt 인증서 자동 갱신
sudo certbot renew --quiet --post-hook "systemctl reload nginx"

# crontab에 등록
0 3 * * * certbot renew --quiet --post-hook "systemctl reload nginx"
```

### 3. API 인증

```javascript
// JWT 기반 인증
const token = jwt.sign({ userId: 123 }, JWT_SECRET, { expiresIn: '24h' });

// API 요청
curl -H "Authorization: Bearer $token" \
     http://localhost:40000/api/documents
```

### 4. 데이터 암호화

```bash
# 전송 중 암호화 (TLS)
# 저장 중 암호화 (디스크 레벨 또는 애플리케이션 레벨)

# 예: LUKS 볼륨 암호화
sudo cryptsetup luksFormat /dev/sdX
sudo cryptsetup luksOpen /dev/sdX kimdb-crypt
sudo mkfs.ext4 /dev/mapper/kimdb-crypt
```

---

## 트러블슈팅

### 문제: 높은 메모리 사용량

```bash
# 메모리 분석
docker stats

# 가비지 컬렉션 강제 실행
curl -X POST http://localhost:40000/admin/gc

# 캐시 정리
redis-cli FLUSHDB
```

### 문제: 느린 응답 시간

```bash
# 성능 프로파일링
kubectl exec -it kimdb-0 -n kimdb -- \
  node --prof dist/server/index.js

# 로그 분석
grep "slow" /app/logs/*.log | tail -20
```

### 문제: 디스크 공간 부족

```bash
# 디스크 사용량 확인
df -h

# 오래된 WAL 로그 정리
rm /app/wal-logs/*.wal

# 백업 정리
find /app/backups -mtime +30 -delete
```

---

## 체크리스트

배포 전 확인사항:

- [ ] 환경 파일 설정 완료
- [ ] SSL/TLS 인증서 설정
- [ ] 백업 전략 수립
- [ ] 모니터링 도구 설치
- [ ] 로그 수집 설정
- [ ] 알람 규칙 설정
- [ ] 재해 복구 테스트
- [ ] 부하 테스트 완료
- [ ] 보안 감사 완료
- [ ] 팀 교육 완료

---

## 지원

문제가 발생하면:

1. [GitHub Issues](https://github.com/kim/kimdb/issues)에서 검색
2. [로그](#트러블슈팅) 확인
3. [보안 정책](../SECURITY.md)에 따라 신고

더 자세한 정보: https://github.com/kim/kimdb/docs
