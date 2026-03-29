# 🔥 KIMDB Dockerfile
FROM node:18-alpine

# 메타데이터
LABEL maintainer="KIM"
LABEL description="KIMDB - 완전 자체 구현 Firestore 대체 데이터베이스"
LABEL version="1.0.0"

# 작업 디렉토리
WORKDIR /app

# 의존성 파일 복사 (캐시 최적화)
COPY package*.json ./
COPY tsconfig.json ./

# 의존성 설치
RUN npm ci --only=production && \
    npm cache clean --force

# 소스 코드 복사
COPY src/ ./src/
COPY test/ ./test/

# TypeScript 빌드 의존성 설치 (빌드만을 위해)
RUN npm install -D typescript tsx && \
    npm run build && \
    npm uninstall typescript tsx

# 불필요한 파일 제거
RUN rm -rf src test tsconfig.json

# 비-루트 사용자 생성
RUN addgroup -g 1001 -S kimdb && \
    adduser -S kimdb -u 1001 -G kimdb

# 권한 변경
RUN chown -R kimdb:kimdb /app
USER kimdb

# 포트 노출
EXPOSE 3000 8080

# 헬스체크
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# 시작 명령
CMD ["npm", "start"]