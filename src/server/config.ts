/**
 * kimdb Server Configuration
 *
 * 환경변수 기반 설정 - 보안 강화
 */

import { z } from 'zod';
import crypto from 'crypto';

// 설정 스키마 정의 (zod)
const ConfigSchema = z.object({
  port: z.number().min(1).max(65535).default(40000),
  host: z.string().default('0.0.0.0'),
  apiKey: z.string().min(16, 'KIMDB_API_KEY must be at least 16 characters'),
  dataDir: z.string().default('./data'),

  redis: z.object({
    enabled: z.boolean().default(false),
    host: z.string().default('127.0.0.1'),
    port: z.number().default(6379),
    password: z.string().optional(),
  }).default({}),

  mariadb: z.object({
    enabled: z.boolean().default(false),
    host: z.string().default('127.0.0.1'),
    port: z.number().default(3306),
    user: z.string().default('kimdb'),
    password: z.string().optional(),
    database: z.string().default('kimdb_logs'),
  }).default({}),

  cache: z.object({
    maxDocs: z.number().default(1000),
    docTTL: z.number().default(30 * 60 * 1000), // 30분
    presenceTTL: z.number().default(30 * 1000), // 30초
    undoTTL: z.number().default(10 * 60 * 1000), // 10분
    cleanupInterval: z.number().default(60 * 1000), // 1분
  }).default({}),

  cors: z.object({
    origins: z.array(z.string()).default(['*']),
    credentials: z.boolean().default(true),
  }).default({}),

  serverId: z.string().default(`srv_${crypto.randomBytes(4).toString('hex')}`),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * 환경변수에서 설정 로드
 */
export function loadConfig(): Config {
  const env = process.env;

  // 개발 모드 체크
  const isDev = env.NODE_ENV !== 'production';

  // API 키 필수 체크 (프로덕션에서는 반드시 필요)
  let apiKey = env.KIMDB_API_KEY;
  if (!apiKey) {
    if (isDev) {
      // 개발 모드에서는 자동 생성
      apiKey = `dev_${crypto.randomBytes(16).toString('hex')}`;
      console.warn('[kimdb] WARNING: KIMDB_API_KEY not set. Using auto-generated key for development.');
      console.warn(`[kimdb] Generated API Key: ${apiKey}`);
    } else {
      throw new Error('KIMDB_API_KEY environment variable is required in production mode');
    }
  }

  const rawConfig = {
    port: parseInt(env.KIMDB_PORT || env.PORT || '40000'),
    host: env.KIMDB_HOST || env.HOST || '0.0.0.0',
    apiKey,
    dataDir: env.KIMDB_DATA_DIR || './data',

    redis: {
      enabled: env.REDIS_ENABLED === 'true',
      host: env.REDIS_HOST || '127.0.0.1',
      port: parseInt(env.REDIS_PORT || '6379'),
      password: env.REDIS_PASSWORD,
    },

    mariadb: {
      enabled: env.MARIADB_ENABLED === 'true',
      host: env.MARIADB_HOST || '127.0.0.1',
      port: parseInt(env.MARIADB_PORT || '3306'),
      user: env.MARIADB_USER || 'kimdb',
      password: env.MARIADB_PASSWORD,
      database: env.MARIADB_DATABASE || 'kimdb_logs',
    },

    cache: {
      maxDocs: parseInt(env.MAX_CACHED_DOCS || '1000'),
      docTTL: parseInt(env.DOC_TTL || String(30 * 60 * 1000)),
      presenceTTL: parseInt(env.PRESENCE_TTL || '30000'),
      undoTTL: parseInt(env.UNDO_TTL || String(10 * 60 * 1000)),
      cleanupInterval: parseInt(env.CLEANUP_INTERVAL || '60000'),
    },

    cors: {
      origins: env.CORS_ORIGINS ? env.CORS_ORIGINS.split(',') : ['*'],
      credentials: env.CORS_CREDENTIALS !== 'false',
    },

    serverId: env.SERVER_ID || `srv_${crypto.randomBytes(4).toString('hex')}`,
  };

  // zod로 검증
  const result = ConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    const errors = result.error.errors.map(e => `  - ${e.path.join('.')}: ${e.message}`).join('\n');
    throw new Error(`Configuration validation failed:\n${errors}`);
  }

  return result.data;
}

/**
 * 설정 로그 출력 (민감 정보 마스킹)
 */
export function logConfig(config: Config): void {
  console.log('[kimdb] Configuration:');
  console.log(`  - Port: ${config.port}`);
  console.log(`  - Host: ${config.host}`);
  console.log(`  - API Key: ${config.apiKey.slice(0, 8)}...`);
  console.log(`  - Data Dir: ${config.dataDir}`);
  console.log(`  - Server ID: ${config.serverId}`);
  console.log(`  - Redis: ${config.redis.enabled ? `${config.redis.host}:${config.redis.port}` : 'disabled'}`);
  console.log(`  - MariaDB: ${config.mariadb.enabled ? `${config.mariadb.host}:${config.mariadb.port}` : 'disabled'}`);
  console.log(`  - CORS Origins: ${config.cors.origins.join(', ')}`);
}

/**
 * .env.example 생성
 */
export function generateEnvExample(): string {
  return `# kimdb Configuration
# Required in production mode
KIMDB_API_KEY=your-secure-api-key-here

# Server
KIMDB_PORT=40000
KIMDB_HOST=0.0.0.0
KIMDB_DATA_DIR=./data

# Redis (optional - for multi-server clustering)
REDIS_ENABLED=false
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=

# MariaDB (optional - for logging)
MARIADB_ENABLED=false
MARIADB_HOST=127.0.0.1
MARIADB_PORT=3306
MARIADB_USER=kimdb
MARIADB_PASSWORD=
MARIADB_DATABASE=kimdb_logs

# Cache settings
MAX_CACHED_DOCS=1000
DOC_TTL=1800000
PRESENCE_TTL=30000
UNDO_TTL=600000
CLEANUP_INTERVAL=60000

# CORS
CORS_ORIGINS=*
CORS_CREDENTIALS=true

# Server ID (auto-generated if not set)
# SERVER_ID=srv_custom
`;
}
