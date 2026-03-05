/**
 * kimdb v6.0.0 - Production-Grade Real-time Database
 *
 * 프로덕션 기능:
 * - Redis Pub/Sub (멀티 서버 클러스터링)
 * - LRU 캐시 + TTL 기반 메모리 관리
 * - Graceful Shutdown
 * - Prometheus 메트릭스
 * - 자동 정리 (GC)
 *
 * CRDT 기능:
 * - LWW-Set, RGA, Rich Text
 * - Op batching + Delta compression
 * - Snapshot 기반 초기 로드
 * - Undo/Redo, Presence
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Database from "better-sqlite3";
import crypto from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync, existsSync, readdirSync, statSync, unlinkSync, copyFileSync, writeFileSync, readFileSync } from "fs";
import { createHash } from "crypto";
import {
  VectorClock,
  CRDTDocument,
  OpBatcher,
  SnapshotManager,
  LWWMap,
  UndoManager,
  PresenceManager
} from "./crdt/v2/index.js";

// ===== Configuration =====
const __dirname = dirname(fileURLToPath(import.meta.url));
const config = {
  port: parseInt(process.env.PORT) || 40000,
  host: process.env.HOST || "0.0.0.0",
  apiKey: process.env.KIMDB_API_KEY || "kimdb-dev-key-2025",
  redis: {
    enabled: process.env.REDIS_ENABLED === "true",
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || null
  },
  mariadb: {
    enabled: process.env.MARIADB_ENABLED !== "false",
    host: process.env.MARIADB_HOST || "192.168.45.73",
    port: parseInt(process.env.MARIADB_PORT) || 3306,
    user: process.env.MARIADB_USER || "kim",
    password: process.env.MARIADB_PASSWORD || "kimdb2025",
    database: process.env.MARIADB_DATABASE || "kimdb_logs"
  },
  serverId: process.env.SERVER_ID || `srv_${crypto.randomBytes(4).toString("hex")}`,
  // 메모리 관리
  cache: {
    maxDocs: parseInt(process.env.MAX_CACHED_DOCS) || 1000,
    docTTL: parseInt(process.env.DOC_TTL) || 30 * 60 * 1000, // 30분
    presenceTTL: parseInt(process.env.PRESENCE_TTL) || 30 * 1000, // 30초
    undoTTL: parseInt(process.env.UNDO_TTL) || 10 * 60 * 1000, // 10분
    cleanupInterval: parseInt(process.env.CLEANUP_INTERVAL) || 60 * 1000 // 1분
  }
};

const VERSION = "7.6.0";
const DB_DIR = join(__dirname, "..", "shared_database");
const DB_PATH = join(DB_DIR, "code_team_ai.db");
const BACKUP_DIR = join(__dirname, "..", "backups");
const WAL_LOG_DIR = join(__dirname, "..", "wal-logs");

if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
if (!existsSync(WAL_LOG_DIR)) mkdirSync(WAL_LOG_DIR, { recursive: true });

// ===== Safety Configuration =====
const safetyConfig = {
  // 백업 설정
  backupIntervalMs: parseInt(process.env.BACKUP_INTERVAL) || 60 * 60 * 1000,  // 1시간
  maxBackups: parseInt(process.env.MAX_BACKUPS) || 24,  // 최대 24개 보관

  // 체크포인트 설정
  checkpointIntervalMs: parseInt(process.env.CHECKPOINT_INTERVAL) || 5 * 60 * 1000,  // 5분
  checkpointThreshold: parseInt(process.env.CHECKPOINT_THRESHOLD) || 1000,  // 1000 쓰기

  // 무결성 검사
  integrityCheckIntervalMs: parseInt(process.env.INTEGRITY_CHECK_INTERVAL) || 6 * 60 * 60 * 1000,  // 6시간

  // 안전 레벨 (1: 성능, 2: 균형, 3: 안전)
  safetyLevel: parseInt(process.env.SAFETY_LEVEL) || 2
};

// ===== Database Setup with Safety =====
// 크래시 복구 체크
const lockFile = DB_PATH + '.lock';
if (existsSync(lockFile)) {
  console.log('[kimdb] Previous crash detected, running recovery...');
  try {
    const tempDb = new Database(DB_PATH);
    tempDb.pragma('wal_checkpoint(TRUNCATE)');
    tempDb.close();
    console.log('[kimdb] WAL recovery completed');
  } catch (e) {
    console.error('[kimdb] WAL recovery failed:', e.message);
    // 백업에서 복구 시도
    restoreFromLatestBackup();
  }
  try { unlinkSync(lockFile); } catch (e) {}
}

// 락 파일 생성
writeFileSync(lockFile, JSON.stringify({
  pid: process.pid,
  startTime: new Date().toISOString()
}));

const db = new Database(DB_PATH);

// 안전 레벨에 따른 pragma 설정
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 30000");
db.pragma("cache_size = 10000");
db.pragma("temp_store = MEMORY");

switch (safetyConfig.safetyLevel) {
  case 1:  // 성능 우선
    db.pragma("synchronous = NORMAL");
    db.pragma("wal_autocheckpoint = 10000");
    break;
  case 2:  // 균형 (기본)
    db.pragma("synchronous = NORMAL");
    db.pragma("wal_autocheckpoint = 1000");
    db.pragma("mmap_size = 268435456");  // 256MB
    break;
  case 3:  // 안전 최우선
    db.pragma("synchronous = FULL");
    db.pragma("wal_autocheckpoint = 100");
    break;
}

console.log(`[kimdb] Safety level: ${safetyConfig.safetyLevel}`);

// ===== Safety Functions =====
let safetyStats = {
  backups: 0,
  checkpoints: 0,
  integrityChecks: 0,
  recoveries: 0,
  writesSinceCheckpoint: 0,
  lastBackup: null,
  lastCheckpoint: null,
  lastIntegrityCheck: null,
  errors: []
};

// 파일 체크섬 생성
function fileChecksum(filePath) {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

// 백업 목록 조회
function getBackupList() {
  if (!existsSync(BACKUP_DIR)) return [];

  return readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('backup_') && f.endsWith('.db'))
    .map(name => ({
      name,
      path: join(BACKUP_DIR, name),
      time: statSync(join(BACKUP_DIR, name)).mtime
    }))
    .sort((a, b) => b.time - a.time);
}

// 자동 백업
function createBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `backup_${timestamp}.db`;
  const backupPath = join(BACKUP_DIR, backupName);

  try {
    // 체크포인트 후 백업
    db.pragma('wal_checkpoint(TRUNCATE)');

    // 파일 복사
    copyFileSync(DB_PATH, backupPath);

    // 체크섬 저장
    const checksum = fileChecksum(backupPath);
    writeFileSync(backupPath + '.sha256', checksum);

    safetyStats.backups++;
    safetyStats.lastBackup = new Date().toISOString();

    console.log(`[kimdb] Backup created: ${backupName}`);

    // 오래된 백업 정리
    cleanupOldBackups();

    return { path: backupPath, checksum };
  } catch (e) {
    console.error('[kimdb] Backup failed:', e.message);
    logSafetyError('backup', e);
    return null;
  }
}

// 오래된 백업 정리
function cleanupOldBackups() {
  const backups = getBackupList();

  while (backups.length > safetyConfig.maxBackups) {
    const oldest = backups.pop();
    try {
      unlinkSync(oldest.path);
      if (existsSync(oldest.path + '.sha256')) {
        unlinkSync(oldest.path + '.sha256');
      }
      console.log(`[kimdb] Deleted old backup: ${oldest.name}`);
    } catch (e) {}
  }
}

// 최신 백업에서 복구
function restoreFromLatestBackup() {
  const backups = getBackupList();

  if (backups.length === 0) {
    console.error('[kimdb] No backups available for recovery!');
    return false;
  }

  const latest = backups[0];
  console.log(`[kimdb] Restoring from backup: ${latest.name}`);

  try {
    // 체크섬 검증
    const checksumFile = latest.path + '.sha256';
    if (existsSync(checksumFile)) {
      const savedChecksum = readFileSync(checksumFile, 'utf8').trim();
      const actualChecksum = fileChecksum(latest.path);
      if (savedChecksum !== actualChecksum) {
        console.error('[kimdb] Backup checksum mismatch!');
        return false;
      }
    }

    // 현재 DB 백업 (손상 파일 보관)
    if (existsSync(DB_PATH)) {
      const corruptPath = DB_PATH + '.corrupt.' + Date.now();
      copyFileSync(DB_PATH, corruptPath);
    }

    // 복구
    copyFileSync(latest.path, DB_PATH);
    safetyStats.recoveries++;
    console.log('[kimdb] Restore completed');
    return true;
  } catch (e) {
    console.error('[kimdb] Restore failed:', e.message);
    return false;
  }
}

// 무결성 검사
function checkIntegrity() {
  try {
    const result = db.pragma('integrity_check');
    safetyStats.integrityChecks++;
    safetyStats.lastIntegrityCheck = new Date().toISOString();

    const isOk = result[0].integrity_check === 'ok';

    if (!isOk) {
      console.error('[kimdb] INTEGRITY CHECK FAILED!', result);
      // VACUUM으로 복구 시도
      try {
        db.exec('VACUUM');
        const recheck = db.pragma('integrity_check');
        if (recheck[0].integrity_check === 'ok') {
          console.log('[kimdb] Integrity restored via VACUUM');
          return true;
        }
      } catch (e) {}
    } else {
      console.log('[kimdb] Integrity check passed');
    }

    return isOk;
  } catch (e) {
    console.error('[kimdb] Integrity check error:', e.message);
    logSafetyError('integrity_check', e);
    return false;
  }
}

// 강제 체크포인트
function forceCheckpoint(mode = 'PASSIVE') {
  try {
    const result = db.pragma(`wal_checkpoint(${mode})`);
    safetyStats.checkpoints++;
    safetyStats.lastCheckpoint = new Date().toISOString();
    safetyStats.writesSinceCheckpoint = 0;
    return result[0];
  } catch (e) {
    console.error('[kimdb] Checkpoint failed:', e.message);
    logSafetyError('checkpoint', e);
    return null;
  }
}

// 안전 에러 로깅
function logSafetyError(operation, error) {
  safetyStats.errors.push({
    time: new Date().toISOString(),
    operation,
    message: error.message
  });

  // 최근 50개만 유지
  if (safetyStats.errors.length > 50) {
    safetyStats.errors.shift();
  }
}

// ===== MariaDB Logger =====
let mariaPool = null;

async function initMariaDB() {
  if (!config.mariadb.enabled) {
    console.log("[kimdb] MariaDB logging disabled");
    return;
  }

  try {
    const mysql = await import("mysql2/promise");
    mariaPool = mysql.createPool({
      host: config.mariadb.host,
      port: config.mariadb.port,
      user: config.mariadb.user,
      password: config.mariadb.password,
      database: config.mariadb.database,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0
    });

    // 연결 테스트
    const conn = await mariaPool.getConnection();
    await conn.ping();
    conn.release();
    console.log("[kimdb] MariaDB connected:", config.mariadb.host);
  } catch (e) {
    console.error("[kimdb] MariaDB connection failed:", e.message);
    mariaPool = null;
  }
}

// 작업 로그 큐 (배치 처리)
const logQueue = [];
let logFlushTimer = null;

function logOperation(type, collection, docId, clientId, success = true, details = null) {
  if (!mariaPool) return;

  logQueue.push({
    timestamp: Date.now(),
    server_id: config.serverId,
    type,
    collection,
    doc_id: docId,
    client_id: clientId,
    success: success ? 1 : 0,
    details
  });

  // 100개 모이면 즉시 flush, 아니면 1초 후 flush
  if (logQueue.length >= 100) {
    flushLogs();
  } else if (!logFlushTimer) {
    logFlushTimer = setTimeout(flushLogs, 1000);
  }
}

async function flushLogs() {
  if (logFlushTimer) {
    clearTimeout(logFlushTimer);
    logFlushTimer = null;
  }

  if (!mariaPool || logQueue.length === 0) return;

  const batch = logQueue.splice(0, 100);
  try {
    const values = batch.map(l => [
      l.timestamp, l.server_id, l.type, l.collection,
      l.doc_id, l.client_id, l.success, l.details
    ]);
    await mariaPool.query(
      `INSERT INTO operation_logs (timestamp, server_id, type, collection, doc_id, client_id, success, details)
       VALUES ?`,
      [values]
    );
  } catch (e) {
    // 로그 실패는 무시
  }
}

// 헬스체크 로그 (3분마다)
async function logHealthCheck() {
  if (!mariaPool) return;

  try {
    const mem = process.memoryUsage();
    await mariaPool.query(
      `INSERT INTO health_checks (timestamp, server_id, server_ip, connections, memory_mb, uptime, redis_connected)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        Date.now(),
        config.serverId,
        config.host === "0.0.0.0" ? "local" : config.host,
        clients.size,
        Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10,
        Math.floor(process.uptime()),
        redisConnected ? 1 : 0
      ]
    );
  } catch (e) {
    // 무시
  }
}

// 3분마다 헬스체크
setInterval(logHealthCheck, 3 * 60 * 1000);

// ===== Redis Pub/Sub (Optional) =====
let redisPub = null;
let redisSub = null;
let redisConnected = false;

async function initRedis() {
  if (!config.redis.enabled) {
    console.log("[kimdb] Redis disabled, running in single-server mode");
    return;
  }

  try {
    const Redis = (await import("ioredis")).default;
    const redisConfig = {
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      retryStrategy: (times) => Math.min(times * 100, 3000),
      maxRetriesPerRequest: 3
    };

    redisPub = new Redis(redisConfig);
    redisSub = new Redis(redisConfig);

    redisPub.on("connect", () => {
      redisConnected = true;
      console.log("[kimdb] Redis publisher connected");
    });

    redisSub.on("connect", () => {
      console.log("[kimdb] Redis subscriber connected");
    });

    redisPub.on("error", (e) => {
      console.error("[kimdb] Redis pub error:", e.message);
      redisConnected = false;
    });

    redisSub.on("error", (e) => {
      console.error("[kimdb] Redis sub error:", e.message);
    });

    // 채널 구독
    await redisSub.subscribe("kimdb:broadcast", "kimdb:presence", "kimdb:sync");

    redisSub.on("message", (channel, message) => {
      try {
        const data = JSON.parse(message);
        // 자기 서버 메시지는 무시
        if (data.serverId === config.serverId) return;

        handleRedisMessage(channel, data);
      } catch (e) {
        console.error("[kimdb] Redis message parse error:", e.message);
      }
    });

    console.log("[kimdb] Redis Pub/Sub initialized");
  } catch (e) {
    console.error("[kimdb] Redis init failed:", e.message);
    console.log("[kimdb] Falling back to single-server mode");
  }
}

function handleRedisMessage(channel, data) {
  metrics.redis.received++;

  switch (channel) {
    case "kimdb:broadcast":
      // 다른 서버에서 온 브로드캐스트 → 로컬 클라이언트에 전달
      localBroadcast(data.collection, data.event, data.payload, null);
      break;

    case "kimdb:presence":
      // Presence 업데이트
      const presenceKey = `${data.collection}:${data.docId}`;
      const pm = presenceManagers.get(presenceKey);
      if (pm) {
        pm.applyRemote(data.msg);
        localBroadcastToDoc(data.collection, data.docId, data.msg, null);
      }
      break;

    case "kimdb:sync":
      // CRDT 동기화
      const doc = crdtDocs.get(`${data.collection}:${data.docId}`);
      if (doc) {
        doc.applyRemoteBatch(data.operations);
        localBroadcastToDoc(data.collection, data.docId, {
          type: "crdt_sync",
          collection: data.collection,
          docId: data.docId,
          operations: data.operations
        }, null);
      }
      break;
  }
}

function publishToRedis(channel, data) {
  if (!redisConnected || !redisPub) return false;

  try {
    redisPub.publish(channel, JSON.stringify({
      ...data,
      serverId: config.serverId,
      timestamp: Date.now()
    }));
    metrics.redis.published++;
    return true;
  } catch (e) {
    console.error("[kimdb] Redis publish error:", e.message);
    return false;
  }
}

// ===== LRU Cache for Documents =====
class LRUCache {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.cache = new Map();
    this.accessTime = new Map();
  }

  get(key) {
    if (this.cache.has(key)) {
      this.accessTime.set(key, Date.now());
      return this.cache.get(key);
    }
    return null;
  }

  set(key, value) {
    // 용량 초과 시 가장 오래된 것 제거
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this._evictOldest();
    }
    this.cache.set(key, value);
    this.accessTime.set(key, Date.now());
  }

  delete(key) {
    this.cache.delete(key);
    this.accessTime.delete(key);
  }

  has(key) {
    return this.cache.has(key);
  }

  _evictOldest() {
    let oldestKey = null;
    let oldestTime = Infinity;

    for (const [key, time] of this.accessTime) {
      if (time < oldestTime) {
        oldestTime = time;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      // DB에 저장 후 제거
      const doc = this.cache.get(oldestKey);
      if (doc) {
        const [collection, docId] = oldestKey.split(":");
        saveCRDTToDB(collection, docId, doc);
      }
      this.cache.delete(oldestKey);
      this.accessTime.delete(oldestKey);
      metrics.cache.evictions++;
    }
  }

  cleanup(ttl) {
    const now = Date.now();
    const toDelete = [];

    for (const [key, time] of this.accessTime) {
      if (now - time > ttl) {
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      const doc = this.cache.get(key);
      if (doc) {
        const [collection, docId] = key.split(":");
        saveCRDTToDB(collection, docId, doc);
      }
      this.cache.delete(key);
      this.accessTime.delete(key);
    }

    return toDelete.length;
  }

  get size() {
    return this.cache.size;
  }

  keys() {
    return this.cache.keys();
  }
}

// ===== Metrics (Prometheus 호환) =====
const metrics = {
  startTime: Date.now(),
  serverId: config.serverId,
  requests: { total: 0, success: 0, error: 0 },
  writes: { total: 0 },
  websocket: {
    connections: 0,
    peak: 0,
    messages: { sent: 0, received: 0 },
    broadcasts: 0
  },
  sync: { operations: 0, conflicts: 0 },
  redis: { published: 0, received: 0, errors: 0 },
  cache: { hits: 0, misses: 0, evictions: 0 },
  presence: { joins: 0, leaves: 0, updates: 0 },
  undo: { captures: 0, undos: 0, redos: 0 },
  backups: { total: 0, lastAt: null },
  checkpoints: { total: 0, lastAt: null },
  cleanup: { runs: 0, docsRemoved: 0, presenceRemoved: 0, undoRemoved: 0 }
};

// ===== Data Stores =====
const clients = new Map(); // clientId -> { socket, subscriptions, connectedAt }
const subscriptions = new Map(); // collection -> Set<clientId>
const docSubscriptions = new Map(); // collection:docId -> Set<clientId>

const crdtDocs = new LRUCache(config.cache.maxDocs);
const presenceManagers = new Map(); // collection:docId -> { pm, lastAccess }
const clientPresence = new Map(); // clientId -> { collection, docId, nodeId }
const clientUndoManagers = new Map(); // clientId:collection:docId -> { um, lastAccess }

// ===== Helper Functions =====
function generateClientId() {
  return crypto.randomBytes(8).toString("hex");
}

function getCRDTDoc(collection, docId) {
  const key = `${collection}:${docId}`;

  // 캐시에서 조회
  let doc = crdtDocs.get(key);
  if (doc) {
    metrics.cache.hits++;
    return doc;
  }

  metrics.cache.misses++;

  // DB에서 로드
  const col = ensureCollection(collection);
  const row = db.prepare(`SELECT crdt_state FROM ${col} WHERE id = ?`).get(docId);

  if (row && row.crdt_state) {
    try {
      doc = CRDTDocument.fromJSON(JSON.parse(row.crdt_state));
    } catch (e) {
      doc = new CRDTDocument(config.serverId, docId);
    }
  } else {
    doc = new CRDTDocument(config.serverId, docId);
  }

  crdtDocs.set(key, doc);
  return doc;
}

function saveCRDTToDB(collection, docId, doc) {
  try {
    const col = ensureCollection(collection);
    const state = JSON.stringify(doc.toJSON());
    const data = JSON.stringify(doc.toObject());

    db.prepare(`
      INSERT INTO ${col} (id, data, crdt_state, _version, created_at, updated_at)
      VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        data = excluded.data,
        crdt_state = excluded.crdt_state,
        _version = _version + 1,
        updated_at = CURRENT_TIMESTAMP
    `).run(docId, data, state);
  } catch (e) {
    console.error("[kimdb] Save CRDT error:", e.message);
  }
}

function getPresenceManager(collection, docId) {
  const key = `${collection}:${docId}`;
  let entry = presenceManagers.get(key);

  if (!entry) {
    entry = {
      pm: new PresenceManager(`server_${config.serverId}`, {
        heartbeatInterval: 10000,
        timeout: config.cache.presenceTTL
      }),
      lastAccess: Date.now()
    };
    presenceManagers.set(key, entry);
  } else {
    entry.lastAccess = Date.now();
  }

  return entry.pm;
}

function getClientUndoManager(clientId, collection, docId) {
  const key = `${clientId}:${collection}:${docId}`;
  let entry = clientUndoManagers.get(key);

  if (!entry) {
    entry = {
      um: new UndoManager({ maxHistory: 100, captureTimeout: 500 }),
      lastAccess: Date.now()
    };
    clientUndoManagers.set(key, entry);
  } else {
    entry.lastAccess = Date.now();
  }

  return entry.um;
}

// ===== Broadcast Functions =====
function localBroadcast(collection, event, data, excludeClientId) {
  const subs = subscriptions.get(collection);
  if (!subs) return 0;

  const msg = JSON.stringify({ type: "sync", event, ...data });
  let count = 0;

  for (const clientId of subs) {
    if (clientId === excludeClientId) continue;
    const client = clients.get(clientId);
    if (client && client.socket.readyState === 1) {
      client.socket.send(msg);
      count++;
    }
  }

  metrics.websocket.broadcasts++;
  return count;
}

function localBroadcastToDoc(collection, docId, msgObj, excludeClientId) {
  const key = `${collection}:${docId}`;
  const subs = docSubscriptions.get(key) || subscriptions.get(collection);
  if (!subs) return 0;

  const msg = JSON.stringify(msgObj);
  let count = 0;

  for (const clientId of subs) {
    if (clientId === excludeClientId) continue;
    const client = clients.get(clientId);
    if (client && client.socket.readyState === 1) {
      client.socket.send(msg);
      count++;
    }
  }

  return count;
}

function broadcast(collection, event, data, excludeClientId) {
  // 로컬 브로드캐스트
  localBroadcast(collection, event, data, excludeClientId);

  // Redis로 다른 서버에 전파
  publishToRedis("kimdb:broadcast", { collection, event, payload: data });
}

function broadcastOp(collection, docId, operations, excludeClientId) {
  const msg = {
    type: "crdt_sync",
    collection,
    docId,
    operations,
    serverTime: Date.now()
  };

  localBroadcastToDoc(collection, docId, msg, excludeClientId);
  publishToRedis("kimdb:sync", { collection, docId, operations });
}

// ===== Cleanup / GC =====
function runCleanup() {
  const now = Date.now();
  metrics.cleanup.runs++;

  // 1. 오래된 문서 캐시 정리
  const docsRemoved = crdtDocs.cleanup(config.cache.docTTL);
  metrics.cleanup.docsRemoved += docsRemoved;

  // 2. 비활성 Presence 정리
  let presenceRemoved = 0;
  for (const [key, entry] of presenceManagers) {
    // 30초 이상 접근 없으면 정리
    if (now - entry.lastAccess > config.cache.presenceTTL * 2) {
      presenceManagers.delete(key);
      presenceRemoved++;
    } else {
      // 타임아웃된 유저 정리
      const removed = entry.pm.cleanup();
      presenceRemoved += removed.length;
    }
  }
  metrics.cleanup.presenceRemoved += presenceRemoved;

  // 3. 비활성 Undo 매니저 정리
  let undoRemoved = 0;
  for (const [key, entry] of clientUndoManagers) {
    if (now - entry.lastAccess > config.cache.undoTTL) {
      clientUndoManagers.delete(key);
      undoRemoved++;
    }
  }
  metrics.cleanup.undoRemoved += undoRemoved;

  if (docsRemoved + presenceRemoved + undoRemoved > 0) {
    console.log(`[kimdb] Cleanup: docs=${docsRemoved}, presence=${presenceRemoved}, undo=${undoRemoved}`);
  }
}

// ===== Schema Setup =====
function ensureSchema() {
  // Core tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS _collections (
      name TEXT PRIMARY KEY,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS api_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      method TEXT, path TEXT, status INTEGER, duration_ms INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS operation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      type TEXT NOT NULL,
      collection TEXT,
      doc_id TEXT,
      client_id TEXT,
      server_id TEXT,
      success INTEGER DEFAULT 1,
      details TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_op_logs_ts ON operation_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_op_logs_type ON operation_logs(type);
  `);

  // Check if _sync_log exists and has ts column
  const syncLogExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='_sync_log'`).get();

  if (!syncLogExists) {
    // Create new table with ts column
    db.exec(`
      CREATE TABLE _sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection TEXT NOT NULL,
        doc_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        data TEXT,
        client_id TEXT,
        ts INTEGER NOT NULL
      );
      CREATE INDEX idx_sync_log_ts ON _sync_log(collection, ts);
    `);
  } else {
    // Check if ts column exists
    const columns = db.prepare(`PRAGMA table_info(_sync_log)`).all();
    const hasTsColumn = columns.some(c => c.name === 'ts');

    if (!hasTsColumn) {
      // Add ts column to existing table
      db.exec(`ALTER TABLE _sync_log ADD COLUMN ts INTEGER DEFAULT 0`);
      console.log("[kimdb] Migrated _sync_log: added ts column");
    }

    // Ensure index exists (safe to run if already exists)
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_sync_log_ts ON _sync_log(collection, ts)`);
    } catch (e) {
      // Index already exists or column doesn't exist yet
    }
  }

  console.log("[kimdb] Schema ensured");
}

function ensureCollection(name) {
  const safeName = name.replace(/[^a-zA-Z0-9_]/g, "");
  if (safeName !== name || safeName.startsWith("_") || safeName.startsWith("sqlite")) {
    throw new Error("Invalid collection name");
  }

  const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(safeName);
  if (!exists) {
    db.exec(`
      CREATE TABLE ${safeName} (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        crdt_state TEXT,
        _version INTEGER DEFAULT 1,
        _deleted INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.prepare(`INSERT OR IGNORE INTO _collections (name) VALUES (?)`).run(safeName);
    console.log("[kimdb] Collection created:", safeName);
  } else {
    try {
      db.exec(`ALTER TABLE ${safeName} ADD COLUMN crdt_state TEXT`);
    } catch (e) {}
  }
  return safeName;
}

// ===== Prepared Statements =====
ensureSchema();
const stmt = {
  insertSyncLog: db.prepare(`INSERT INTO _sync_log (collection, doc_id, operation, data, client_id, ts) VALUES (?, ?, ?, ?, ?, ?)`),
  getLatestSync: db.prepare(`SELECT MAX(ts) as ts FROM _sync_log WHERE collection = ?`),
  getSyncSince: db.prepare(`SELECT * FROM _sync_log WHERE collection = ? AND ts > ? ORDER BY ts ASC LIMIT 1000`),
  getCollections: db.prepare(`SELECT name FROM _collections ORDER BY name`)
};

// ===== Fastify Setup =====
const fastify = Fastify({
  logger: false,
  trustProxy: true,
  bodyLimit: 10 * 1024 * 1024
});

await fastify.register(cors, { origin: true, credentials: true });
await fastify.register(websocket, {
  options: {
    maxPayload: 1024 * 1024,
    perMessageDeflate: false
  }
});

// ===== Middleware =====
fastify.addHook("onRequest", async (req) => {
  metrics.requests.total++;
});

fastify.addHook("onResponse", async (req, reply) => {
  if (reply.statusCode < 400) {
    metrics.requests.success++;
  } else {
    metrics.requests.error++;
  }
});

// ===== Auth Middleware =====
function requireAuth(req, reply) {
  const key = req.headers["x-api-key"] || req.headers.authorization?.replace("Bearer ", "");
  if (key !== config.apiKey) {
    reply.code(401).send({ error: "Unauthorized" });
    return false;
  }
  return true;
}

// ===== WebSocket Handler =====
fastify.register(async function (fastify) {
  fastify.get("/ws", { websocket: true }, (socket, req) => {
    const clientId = generateClientId();
    clients.set(clientId, {
      socket,
      subscriptions: new Set(),
      docSubscriptions: new Set(),
      connectedAt: Date.now()
    });

    metrics.websocket.connections++;
    if (metrics.websocket.connections > metrics.websocket.peak) {
      metrics.websocket.peak = metrics.websocket.connections;
    }

    socket.send(JSON.stringify({ type: "connected", clientId, serverId: config.serverId }));

    socket.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        metrics.websocket.messages.received++;
        handleWebSocketMessage(clientId, socket, msg);
      } catch (e) {
        socket.send(JSON.stringify({ type: "error", message: e.message }));
      }
    });

    socket.on("close", () => {
      handleClientDisconnect(clientId);
    });

    socket.on("error", () => {
      handleClientDisconnect(clientId);
    });
  });
});

function handleWebSocketMessage(clientId, socket, msg) {
  const send = (data) => {
    if (socket.readyState === 1) {
      socket.send(JSON.stringify(data));
      metrics.websocket.messages.sent++;
    }
  };

  switch (msg.type) {
    // ===== Subscription =====
    case "subscribe": {
      const col = msg.collection;
      if (!subscriptions.has(col)) subscriptions.set(col, new Set());
      subscriptions.get(col).add(clientId);
      clients.get(clientId).subscriptions.add(col);
      send({ type: "subscribed", collection: col });
      break;
    }

    case "unsubscribe": {
      const col = msg.collection;
      if (subscriptions.has(col)) subscriptions.get(col).delete(clientId);
      clients.get(clientId)?.subscriptions.delete(col);
      send({ type: "unsubscribed", collection: col });
      break;
    }

    case "subscribe_doc": {
      const key = `${msg.collection}:${msg.docId}`;
      if (!docSubscriptions.has(key)) docSubscriptions.set(key, new Set());
      docSubscriptions.get(key).add(clientId);
      clients.get(clientId)?.docSubscriptions.add(key);
      send({ type: "subscribed_doc", collection: msg.collection, docId: msg.docId });
      break;
    }

    // ===== CRDT Operations =====
    case "crdt_get": {
      const doc = getCRDTDoc(msg.collection, msg.docId);
      send({
        type: "crdt_state",
        collection: msg.collection,
        docId: msg.docId,
        state: doc.toJSON(),
        data: doc.toObject()
      });
      break;
    }

    case "crdt_set": {
      const doc = getCRDTDoc(msg.collection, msg.docId);
      const path = typeof msg.path === "string" ? msg.path.split(".") : msg.path;
      const previousValue = doc.get(path);
      const op = doc.set(path, msg.value);

      saveCRDTToDB(msg.collection, msg.docId, doc);
      broadcastOp(msg.collection, msg.docId, [op], clientId);

      // Undo 캡처
      const um = getClientUndoManager(clientId, msg.collection, msg.docId);
      um.capture({ ...op, previousValue }, previousValue);

      metrics.sync.operations++;
      logOperation("crdt_set", msg.collection, msg.docId, clientId);
      send({ type: "crdt_set_ok", docId: msg.docId, op, version: doc.version });
      break;
    }

    case "crdt_ops": {
      const doc = getCRDTDoc(msg.collection, msg.docId);
      const applied = doc.applyRemoteBatch(msg.operations);
      saveCRDTToDB(msg.collection, msg.docId, doc);
      broadcastOp(msg.collection, msg.docId, msg.operations, clientId);
      metrics.sync.operations += applied;
      logOperation("crdt_ops", msg.collection, msg.docId, clientId, true, `applied:${applied}`);
      send({ type: "crdt_ops_ok", docId: msg.docId, applied, version: doc.version });
      break;
    }

    case "get_snapshot": {
      const doc = getCRDTDoc(msg.collection, msg.docId);
      send({
        type: "snapshot",
        collection: msg.collection,
        docId: msg.docId,
        snapshot: doc.toJSON(),
        version: doc.version,
        timestamp: Date.now()
      });
      break;
    }

    // ===== List Operations =====
    case "crdt_list_insert": {
      const doc = getCRDTDoc(msg.collection, msg.docId);
      const path = typeof msg.path === "string" ? msg.path.split(".") : msg.path;
      const op = doc.listInsert(path, msg.index, msg.value);
      saveCRDTToDB(msg.collection, msg.docId, doc);
      broadcastOp(msg.collection, msg.docId, [op], clientId);
      metrics.sync.operations++;
      send({ type: "crdt_list_insert_ok", docId: msg.docId, op });
      break;
    }

    case "crdt_list_delete": {
      const doc = getCRDTDoc(msg.collection, msg.docId);
      const path = typeof msg.path === "string" ? msg.path.split(".") : msg.path;
      const op = doc.listDelete(path, msg.index);
      if (op) {
        saveCRDTToDB(msg.collection, msg.docId, doc);
        broadcastOp(msg.collection, msg.docId, [op], clientId);
        metrics.sync.operations++;
      }
      send({ type: "crdt_list_delete_ok", docId: msg.docId, op });
      break;
    }

    // ===== Set Operations =====
    case "set_add": {
      const doc = getCRDTDoc(msg.collection, msg.docId);
      const op = doc.setAdd(msg.path, msg.value);
      saveCRDTToDB(msg.collection, msg.docId, doc);
      broadcastOp(msg.collection, msg.docId, [op], clientId);
      metrics.sync.operations++;
      send({ type: "set_add_ok", docId: msg.docId, op });
      break;
    }

    case "set_remove": {
      const doc = getCRDTDoc(msg.collection, msg.docId);
      const op = doc.setRemove(msg.path, msg.value);
      saveCRDTToDB(msg.collection, msg.docId, doc);
      broadcastOp(msg.collection, msg.docId, [op], clientId);
      metrics.sync.operations++;
      send({ type: "set_remove_ok", docId: msg.docId, op });
      break;
    }

    case "set_get": {
      const doc = getCRDTDoc(msg.collection, msg.docId);
      const values = doc.setGet(msg.path);
      send({ type: "set_data", docId: msg.docId, path: msg.path, values });
      break;
    }

    // ===== Rich Text =====
    case "rich_insert": {
      const doc = getCRDTDoc(msg.collection, msg.docId);
      const op = doc.richInsert(msg.path, msg.index, msg.char, msg.format || {});
      saveCRDTToDB(msg.collection, msg.docId, doc);
      broadcastOp(msg.collection, msg.docId, [op], clientId);
      metrics.sync.operations++;
      send({ type: "rich_insert_ok", docId: msg.docId, op });
      break;
    }

    case "rich_delete": {
      const doc = getCRDTDoc(msg.collection, msg.docId);
      const op = doc.richDelete(msg.path, msg.index);
      if (op) {
        saveCRDTToDB(msg.collection, msg.docId, doc);
        broadcastOp(msg.collection, msg.docId, [op], clientId);
        metrics.sync.operations++;
      }
      send({ type: "rich_delete_ok", docId: msg.docId, op });
      break;
    }

    case "rich_format": {
      const doc = getCRDTDoc(msg.collection, msg.docId);
      const ops = doc.richFormat(msg.path, msg.start, msg.end, msg.format);
      saveCRDTToDB(msg.collection, msg.docId, doc);
      broadcastOp(msg.collection, msg.docId, ops, clientId);
      metrics.sync.operations += ops.length;
      send({ type: "rich_format_ok", docId: msg.docId, ops });
      break;
    }

    case "rich_get": {
      const doc = getCRDTDoc(msg.collection, msg.docId);
      const delta = doc.richGetDelta(msg.path);
      const text = doc.richGetText(msg.path);
      send({ type: "rich_data", docId: msg.docId, path: msg.path, delta, text });
      break;
    }

    // ===== Cursor =====
    case "cursor_update": {
      const cursorMsg = {
        type: "cursor_sync",
        collection: msg.collection,
        docId: msg.docId,
        cursor: {
          nodeId: clientId,
          position: msg.position,
          selection: msg.selection,
          color: msg.color,
          name: msg.name
        }
      };
      localBroadcastToDoc(msg.collection, msg.docId, cursorMsg, clientId);
      break;
    }

    case "get_cursors": {
      const doc = getCRDTDoc(msg.collection, msg.docId);
      const cursors = doc.getRemoteCursors ? doc.getRemoteCursors() : [];
      send({ type: "cursors", collection: msg.collection, docId: msg.docId, cursors });
      break;
    }

    // ===== Undo/Redo =====
    case "undo_capture": {
      const um = getClientUndoManager(clientId, msg.collection, msg.docId);
      um.capture(msg.op, msg.previousValue);
      metrics.undo.captures++;
      send({ type: "undo_capture_ok", state: um.state });
      break;
    }

    case "undo": {
      const um = getClientUndoManager(clientId, msg.collection, msg.docId);
      const inverseOps = um.undo();

      if (!inverseOps || inverseOps.length === 0) {
        send({ type: "undo_empty" });
        break;
      }

      const doc = getCRDTDoc(msg.collection, msg.docId);
      for (const op of inverseOps) {
        if (!op.clock) op.clock = doc.clock.tick().toJSON();
        if (!op.opId) op.opId = `undo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        doc.applyRemote(op);
      }
      saveCRDTToDB(msg.collection, msg.docId, doc);
      broadcastOp(msg.collection, msg.docId, inverseOps, clientId);

      metrics.undo.undos++;
      send({
        type: "undo_ok",
        docId: msg.docId,
        operations: inverseOps,
        state: um.state,
        docVersion: doc.version
      });
      break;
    }

    case "redo": {
      const um = getClientUndoManager(clientId, msg.collection, msg.docId);
      const ops = um.redo();

      if (!ops || ops.length === 0) {
        send({ type: "redo_empty" });
        break;
      }

      const doc = getCRDTDoc(msg.collection, msg.docId);
      for (const op of ops) {
        if (!op.clock) op.clock = doc.clock.tick().toJSON();
        if (!op.opId) op.opId = `redo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        doc.applyRemote(op);
      }
      saveCRDTToDB(msg.collection, msg.docId, doc);
      broadcastOp(msg.collection, msg.docId, ops, clientId);

      metrics.undo.redos++;
      send({
        type: "redo_ok",
        docId: msg.docId,
        operations: ops,
        state: um.state,
        docVersion: doc.version
      });
      break;
    }

    case "undo_state": {
      const um = getClientUndoManager(clientId, msg.collection, msg.docId);
      send({
        type: "undo_state",
        docId: msg.docId,
        canUndo: um.canUndo(),
        canRedo: um.canRedo(),
        state: um.state
      });
      break;
    }

    case "undo_clear": {
      const um = getClientUndoManager(clientId, msg.collection, msg.docId);
      um.clear();
      send({ type: "undo_clear_ok" });
      break;
    }

    // ===== Presence =====
    case "presence_join": {
      const pm = getPresenceManager(msg.collection, msg.docId);
      const nodeId = `client_${clientId}`;

      clientPresence.set(clientId, {
        collection: msg.collection,
        docId: msg.docId,
        nodeId
      });

      pm.users.set(nodeId, {
        ...msg.user,
        nodeId,
        lastSeen: Date.now()
      });

      const onlineUsers = [...pm.users.values()];
      metrics.presence.joins++;

      // 다른 클라이언트에게 알림
      const joinMsg = {
        type: "presence_joined",
        collection: msg.collection,
        docId: msg.docId,
        user: { nodeId, ...msg.user },
        timestamp: Date.now()
      };
      localBroadcastToDoc(msg.collection, msg.docId, joinMsg, clientId);
      publishToRedis("kimdb:presence", { ...joinMsg, msg: joinMsg });

      logOperation("presence_join", msg.collection, msg.docId, clientId, true, msg.user?.name);
      send({ type: "presence_join_ok", nodeId, users: onlineUsers });
      break;
    }

    case "presence_update": {
      const presence = clientPresence.get(clientId);
      if (!presence) {
        send({ type: "error", message: "Not joined" });
        break;
      }

      const pm = getPresenceManager(presence.collection, presence.docId);
      const userInfo = pm.users.get(presence.nodeId);
      if (userInfo) {
        Object.assign(userInfo, msg.user, { cursor: msg.cursor, lastSeen: Date.now() });
      }

      metrics.presence.updates++;

      const updateMsg = {
        type: "presence_updated",
        collection: presence.collection,
        docId: presence.docId,
        nodeId: presence.nodeId,
        user: userInfo,
        timestamp: Date.now()
      };
      localBroadcastToDoc(presence.collection, presence.docId, updateMsg, clientId);
      publishToRedis("kimdb:presence", { ...updateMsg, msg: updateMsg });

      send({ type: "presence_update_ok" });
      break;
    }

    case "presence_cursor": {
      const presence = clientPresence.get(clientId);
      if (!presence) break;

      const pm = getPresenceManager(presence.collection, presence.docId);
      const userInfo = pm.users.get(presence.nodeId);
      if (userInfo) {
        userInfo.cursor = { position: msg.position, selection: msg.selection };
        userInfo.lastSeen = Date.now();
      }

      const cursorMsg = {
        type: "presence_cursor_moved",
        collection: presence.collection,
        docId: presence.docId,
        nodeId: presence.nodeId,
        cursor: { position: msg.position, selection: msg.selection },
        timestamp: Date.now()
      };
      localBroadcastToDoc(presence.collection, presence.docId, cursorMsg, clientId);
      // 커서는 고빈도라 Redis로 안 보냄
      break;
    }

    case "presence_leave": {
      handlePresenceLeave(clientId);
      send({ type: "presence_leave_ok" });
      break;
    }

    case "presence_get": {
      const pm = getPresenceManager(msg.collection, msg.docId);
      pm.cleanup();
      const users = [...pm.users.values()];
      send({
        type: "presence_users",
        collection: msg.collection,
        docId: msg.docId,
        users,
        count: users.length
      });
      break;
    }

    // ===== Ping =====
    case "ping": {
      send({ type: "pong", time: msg.time || Date.now() });
      break;
    }

    default:
      send({ type: "error", message: `Unknown message type: ${msg.type}` });
  }
}

function handlePresenceLeave(clientId) {
  const presence = clientPresence.get(clientId);
  if (!presence) return;

  const pm = presenceManagers.get(`${presence.collection}:${presence.docId}`);
  if (pm) {
    pm.pm.users.delete(presence.nodeId);
  }

  const leaveMsg = {
    type: "presence_left",
    collection: presence.collection,
    docId: presence.docId,
    nodeId: presence.nodeId,
    timestamp: Date.now()
  };
  localBroadcastToDoc(presence.collection, presence.docId, leaveMsg, clientId);
  publishToRedis("kimdb:presence", { ...leaveMsg, msg: leaveMsg });

  clientPresence.delete(clientId);
  metrics.presence.leaves++;
}

function handleClientDisconnect(clientId) {
  const client = clients.get(clientId);
  if (!client) return;

  // 구독 정리
  for (const col of client.subscriptions) {
    if (subscriptions.has(col)) {
      subscriptions.get(col).delete(clientId);
    }
  }

  for (const key of client.docSubscriptions || []) {
    if (docSubscriptions.has(key)) {
      docSubscriptions.get(key).delete(clientId);
    }
  }

  // Presence 정리
  handlePresenceLeave(clientId);

  // Undo 매니저는 TTL로 자동 정리되므로 여기서 안 함

  clients.delete(clientId);
  metrics.websocket.connections--;
}

// ===== HTTP API =====
fastify.get("/health", async () => ({
  status: "ok",
  version: VERSION,
  serverId: config.serverId,
  uptime: Math.floor((Date.now() - metrics.startTime) / 1000),
  connections: metrics.websocket.connections,
  redis: redisConnected
}));

fastify.get("/api/metrics", async () => ({
  success: true,
  version: VERSION,
  serverId: config.serverId,
  uptime_seconds: Math.floor((Date.now() - metrics.startTime) / 1000),
  ...metrics,
  memory: {
    cachedDocs: crdtDocs.size,
    presenceManagers: presenceManagers.size,
    undoManagers: clientUndoManagers.size,
    heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + "MB"
  }
}));

// Prometheus 형식 메트릭스
fastify.get("/metrics", async (req, reply) => {
  const lines = [];
  const prefix = "kimdb";

  lines.push(`# HELP ${prefix}_uptime_seconds Server uptime`);
  lines.push(`# TYPE ${prefix}_uptime_seconds gauge`);
  lines.push(`${prefix}_uptime_seconds{server="${config.serverId}"} ${Math.floor((Date.now() - metrics.startTime) / 1000)}`);

  lines.push(`# HELP ${prefix}_websocket_connections Current WebSocket connections`);
  lines.push(`# TYPE ${prefix}_websocket_connections gauge`);
  lines.push(`${prefix}_websocket_connections{server="${config.serverId}"} ${metrics.websocket.connections}`);

  lines.push(`# HELP ${prefix}_websocket_peak Peak WebSocket connections`);
  lines.push(`# TYPE ${prefix}_websocket_peak gauge`);
  lines.push(`${prefix}_websocket_peak{server="${config.serverId}"} ${metrics.websocket.peak}`);

  lines.push(`# HELP ${prefix}_messages_total Total messages`);
  lines.push(`# TYPE ${prefix}_messages_total counter`);
  lines.push(`${prefix}_messages_total{server="${config.serverId}",direction="sent"} ${metrics.websocket.messages.sent}`);
  lines.push(`${prefix}_messages_total{server="${config.serverId}",direction="received"} ${metrics.websocket.messages.received}`);

  lines.push(`# HELP ${prefix}_operations_total Total CRDT operations`);
  lines.push(`# TYPE ${prefix}_operations_total counter`);
  lines.push(`${prefix}_operations_total{server="${config.serverId}"} ${metrics.sync.operations}`);

  lines.push(`# HELP ${prefix}_cache_size Cached documents count`);
  lines.push(`# TYPE ${prefix}_cache_size gauge`);
  lines.push(`${prefix}_cache_size{server="${config.serverId}"} ${crdtDocs.size}`);

  lines.push(`# HELP ${prefix}_presence_users Current presence users`);
  lines.push(`# TYPE ${prefix}_presence_users gauge`);
  let presenceCount = 0;
  for (const [, entry] of presenceManagers) {
    presenceCount += entry.pm.users.size;
  }
  lines.push(`${prefix}_presence_users{server="${config.serverId}"} ${presenceCount}`);

  lines.push(`# HELP ${prefix}_memory_heap_bytes Heap memory used`);
  lines.push(`# TYPE ${prefix}_memory_heap_bytes gauge`);
  lines.push(`${prefix}_memory_heap_bytes{server="${config.serverId}"} ${process.memoryUsage().heapUsed}`);

  reply.type("text/plain").send(lines.join("\n"));
});

fastify.get("/api/collections", async () => {
  const collections = stmt.getCollections.all();
  return { success: true, collections: collections.map(c => c.name) };
});

fastify.get("/api/c/:collection", async (req) => {
  const col = ensureCollection(req.params.collection);
  const rows = db.prepare(`SELECT id, data, _version FROM ${col} WHERE _deleted = 0 LIMIT 1000`).all();
  return {
    success: true,
    collection: col,
    count: rows.length,
    data: rows.map(r => ({ id: r.id, ...JSON.parse(r.data), _version: r._version }))
  };
});

fastify.get("/api/c/:collection/:id", async (req, reply) => {
  const col = ensureCollection(req.params.collection);
  const row = db.prepare(`SELECT * FROM ${col} WHERE id = ? AND _deleted = 0`).get(req.params.id);
  if (!row) {
    return reply.code(404).send({ error: "Not found" });
  }
  return { success: true, id: row.id, data: JSON.parse(row.data), _version: row._version };
});

// PUT - 데이터 저장 (upsert)
fastify.put("/api/c/:collection/:id", async (req, reply) => {
  const col = ensureCollection(req.params.collection);
  const id = req.params.id;
  const { data } = req.body || {};

  if (!data) {
    return reply.code(400).send({ error: "data is required" });
  }

  const existing = db.prepare(`SELECT * FROM ${col} WHERE id = ? AND _deleted = 0`).get(id);

  if (existing) {
    // UPDATE
    const merged = { ...JSON.parse(existing.data), ...data };
    db.prepare(`UPDATE ${col} SET data = ?, _version = _version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(JSON.stringify(merged), id);
    metrics.writes.total++;
    return { success: true, id, _version: existing._version + 1 };
  } else {
    // INSERT
    db.prepare(`INSERT INTO ${col} (id, data, _version, _deleted, updated_at) VALUES (?, ?, 1, 0, CURRENT_TIMESTAMP)`)
      .run(id, JSON.stringify(data));
    metrics.writes.total++;
    return { success: true, id, _version: 1 };
  }
});

// POST - 새 문서 생성 (ID 자동 생성)
fastify.post("/api/c/:collection", async (req, reply) => {
  const col = ensureCollection(req.params.collection);
  const { data } = req.body || {};

  if (!data) {
    return reply.code(400).send({ error: "data is required" });
  }

  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  db.prepare(`INSERT INTO ${col} (id, data, _version, _deleted, updated_at) VALUES (?, ?, 1, 0, CURRENT_TIMESTAMP)`)
    .run(id, JSON.stringify(data));

  return { success: true, id, _version: 1 };
});

// PATCH - 부분 업데이트
fastify.patch("/api/c/:collection/:id", async (req, reply) => {
  const col = ensureCollection(req.params.collection);
  const id = req.params.id;
  const { data } = req.body || {};

  if (!data) {
    return reply.code(400).send({ error: "data is required" });
  }

  const existing = db.prepare(`SELECT * FROM ${col} WHERE id = ? AND _deleted = 0`).get(id);
  if (!existing) {
    return reply.code(404).send({ error: "Not found" });
  }

  const merged = { ...JSON.parse(existing.data), ...data };
  db.prepare(`UPDATE ${col} SET data = ?, _version = _version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(JSON.stringify(merged), id);

  return { success: true, id, _version: existing._version + 1 };
});

// DELETE - 소프트 삭제
fastify.delete("/api/c/:collection/:id", async (req, reply) => {
  const col = ensureCollection(req.params.collection);
  const id = req.params.id;

  const existing = db.prepare(`SELECT * FROM ${col} WHERE id = ? AND _deleted = 0`).get(id);
  if (!existing) {
    return reply.code(404).send({ error: "Not found" });
  }

  db.prepare(`UPDATE ${col} SET _deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);

  return { success: true, deleted: true };
});

// ===== SQL Engine =====
/**
 * SQL 엔진 - kimdb에서 SQL 쿼리 직접 실행
 *
 * 지원하는 쿼리:
 * - SELECT * FROM table WHERE ... ORDER BY ... LIMIT ...
 * - SELECT COUNT(*) FROM table WHERE ...
 * - INSERT INTO table (col1, col2) VALUES (?, ?)
 * - UPDATE table SET col1 = ? WHERE ...
 * - DELETE FROM table WHERE ...
 */

function parseSql(sql, params = []) {
  const sqlLower = sql.toLowerCase().trim();
  const result = { type: null, table: null, columns: '*', where: [], orderBy: null, orderDir: 'ASC', limit: null, offset: null, values: {}, paramIndex: 0 };

  // 쿼리 타입 판별
  if (sqlLower.startsWith('select')) {
    result.type = 'SELECT';
  } else if (sqlLower.startsWith('insert')) {
    result.type = 'INSERT';
  } else if (sqlLower.startsWith('update')) {
    result.type = 'UPDATE';
  } else if (sqlLower.startsWith('delete')) {
    result.type = 'DELETE';
  } else {
    throw new Error(`Unsupported SQL: ${sql}`);
  }

  // 테이블명 추출
  const tableMatch = sqlLower.match(/(?:from|into|update)\s+([a-z_][a-z0-9_]*)/i);
  if (tableMatch) {
    result.table = tableMatch[1];
  }

  // SELECT 컬럼 추출
  if (result.type === 'SELECT') {
    const colMatch = sql.match(/select\s+(.+?)\s+from/i);
    if (colMatch) {
      result.columns = colMatch[1].trim();
    }
  }

  // WHERE 절 파싱
  const whereMatch = sql.match(/where\s+(.+?)(?:\s+order\s+by|\s+limit|\s+offset|$)/i);
  if (whereMatch) {
    const wherePart = whereMatch[1].trim();

    // OR 조건도 파싱 (OR로 분리 후 각각 AND 조건 처리)
    const orGroups = wherePart.split(/\s+or\s+/i);
    result.orGroups = [];

    for (const orGroup of orGroups) {
      const conditions = orGroup.split(/\s+and\s+/i);
      const andConditions = [];

      for (const cond of conditions) {
        // GLOB 패턴: field GLOB 'pattern'
        const globParts = cond.match(/([a-z_][a-z0-9_]*)\s+glob\s+['"]?([^'"]+)['"]?/i);
        if (globParts) {
          andConditions.push({ field: globParts[1].trim(), op: 'GLOB', value: globParts[2].trim() });
          continue;
        }

        // 범위/비교 연산자 (>=, <= 먼저 체크!)
        const parts = cond.match(/([a-z_][a-z0-9_]*)\s*(>=|<=|!=|<>|>|<|=|like)\s*(.+)/i);
        if (parts) {
          const field = parts[1].trim();
          const op = parts[2].trim().toUpperCase();
          let value = parts[3].trim();

          if (value === '?') {
            value = params[result.paramIndex++];
          } else if (value.match(/^['"].*['"]$/)) {
            value = value.slice(1, -1);
          } else if (!isNaN(value)) {
            value = Number(value);
          }

          andConditions.push({ field, op, value });
        }
      }

      if (andConditions.length > 0) {
        result.orGroups.push(andConditions);
      }
    }

    // 단일 AND 조건만 있을 경우 기존 호환성 유지
    if (result.orGroups.length === 1) {
      result.where = result.orGroups[0];
    }
  }

  // ORDER BY
  const orderMatch = sql.match(/order\s+by\s+([a-z_][a-z0-9_]*)(?:\s+(asc|desc))?/i);
  if (orderMatch) {
    result.orderBy = orderMatch[1];
    result.orderDir = (orderMatch[2] || 'ASC').toUpperCase();
  }

  // LIMIT
  const limitMatch = sql.match(/limit\s+(\?|\d+)/i);
  if (limitMatch) {
    result.limit = limitMatch[1] === '?' ? params[result.paramIndex++] : parseInt(limitMatch[1]);
  }

  // OFFSET
  const offsetMatch = sql.match(/offset\s+(\?|\d+)/i);
  if (offsetMatch) {
    result.offset = offsetMatch[1] === '?' ? params[result.paramIndex++] : parseInt(offsetMatch[1]);
  }

  // INSERT VALUES
  if (result.type === 'INSERT') {
    const colsMatch = sql.match(/\(([^)]+)\)\s*values/i);
    const valsMatch = sql.match(/values\s*\(([^)]+)\)/i);
    if (colsMatch && valsMatch) {
      const cols = colsMatch[1].split(',').map(c => c.trim());
      const vals = valsMatch[1].split(',').map(v => v.trim());
      for (let i = 0; i < cols.length; i++) {
        let val = vals[i];
        if (val === '?') {
          val = params[result.paramIndex++];
        } else if (val.match(/^['"].*['"]$/)) {
          val = val.slice(1, -1);
        } else if (!isNaN(val)) {
          val = Number(val);
        }
        result.values[cols[i]] = val;
      }
    }
  }

  // UPDATE SET
  if (result.type === 'UPDATE') {
    const setMatch = sql.match(/set\s+(.+?)(?:\s+where|$)/i);
    if (setMatch) {
      const setParts = setMatch[1].split(',');
      for (const part of setParts) {
        const [col, val] = part.split('=').map(s => s.trim());
        let value = val;
        if (val === '?') {
          value = params[result.paramIndex++];
        } else if (val.match(/^['"].*['"]$/)) {
          value = val.slice(1, -1);
        } else if (!isNaN(val)) {
          value = Number(val);
        }
        result.values[col] = value;
      }
    }
  }

  return result;
}

function matchesCondition(doc, { field, op, value }) {
  let docVal = doc[field];

  // is_active 기본값
  if (docVal === undefined && field === 'is_active') {
    docVal = 1;
  }

  switch (op) {
    case '=':
      return docVal == value;
    case '!=':
    case '<>':
      return docVal != value;
    case '>':
      return docVal > value;
    case '<':
      return docVal < value;
    case '>=':
      return docVal >= value;
    case '<=':
      return docVal <= value;
    case 'LIKE':
      const likePattern = value.replace(/%/g, '.*').replace(/_/g, '.');
      return new RegExp(`^${likePattern}$`, 'i').test(docVal || '');
    case 'GLOB':
      // GLOB: * → .*, ? → ., [abc] → [abc]
      const globPattern = value
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.')
        .replace(/\[!/g, '[^');
      return new RegExp(`^${globPattern}$`).test(docVal || '');
    default:
      return true;
  }
}

function matchesWhere(doc, where, orGroups = null) {
  // OR 조건 그룹이 있으면 하나라도 만족하면 true
  if (orGroups && orGroups.length > 1) {
    return orGroups.some(andGroup =>
      andGroup.every(cond => matchesCondition(doc, cond))
    );
  }

  // AND 조건만 있는 경우
  for (const cond of where) {
    if (!matchesCondition(doc, cond)) return false;
  }
  return true;
}

function executeSelect(parsed, collection) {
  const col = ensureCollection(collection);
  const colsLower = parsed.columns.toLowerCase();
  const isCount = colsLower.includes('count(*)');

  // COUNT(*) alias 추출 (SELECT COUNT(*) as cnt → alias = 'cnt')
  let countAlias = 'COUNT(*)';
  if (isCount) {
    const aliasMatch = parsed.columns.match(/count\s*\(\s*\*\s*\)\s+(?:as\s+)?([a-z_][a-z0-9_]*)/i);
    if (aliasMatch) {
      countAlias = aliasMatch[1];
    }
  }

  // 전체 문서 조회 (_index 제외)
  const rows = db.prepare(`SELECT id, data FROM ${col} WHERE _deleted = 0 AND id != '_index'`).all();
  let docs = rows.map(r => {
    let data = JSON.parse(r.data);
    // aiosqlite_compat에서 {data: {...}} 형태로 저장된 경우 처리
    if (data.data && typeof data.data === 'object') {
      data = data.data;
    }
    return { ...data, id: parseInt(r.id) || r.id };
  });

  // WHERE 필터링 (OR 조건 지원)
  if (parsed.where.length > 0 || (parsed.orGroups && parsed.orGroups.length > 0)) {
    docs = docs.filter(doc => matchesWhere(doc, parsed.where, parsed.orGroups));
  }

  // COUNT(*)
  if (isCount) {
    const result = {};
    result[countAlias] = docs.length;
    // 호환성을 위해 둘 다 제공
    if (countAlias !== 'COUNT(*)') {
      result['COUNT(*)'] = docs.length;
    }
    return [result];
  }

  // ORDER BY
  if (parsed.orderBy) {
    docs.sort((a, b) => {
      const aVal = a[parsed.orderBy];
      const bVal = b[parsed.orderBy];
      if (aVal < bVal) return parsed.orderDir === 'ASC' ? -1 : 1;
      if (aVal > bVal) return parsed.orderDir === 'ASC' ? 1 : -1;
      return 0;
    });
  }

  // OFFSET
  if (parsed.offset) {
    docs = docs.slice(parsed.offset);
  }

  // LIMIT
  if (parsed.limit) {
    docs = docs.slice(0, parsed.limit);
  }

  // 특정 컬럼만 선택
  if (parsed.columns !== '*' && !isCount) {
    const cols = parsed.columns.split(',').map(c => c.trim());
    docs = docs.map(doc => {
      const result = {};
      for (const col of cols) {
        if (doc.hasOwnProperty(col)) {
          result[col] = doc[col];
        }
      }
      return result;
    });
  }

  return docs;
}

function executeInsert(parsed, collection) {
  const col = ensureCollection(collection);

  // 새 ID 생성 (auto increment)
  const indexRow = db.prepare(`SELECT data FROM ${col} WHERE id = '_index' AND _deleted = 0`).get();
  let index = indexRow ? JSON.parse(indexRow.data) : { ids: [], next_id: 1 };

  const newId = String(index.next_id);
  index.next_id++;
  index.ids.push(newId);

  // 문서 데이터
  const docData = { ...parsed.values, id: parseInt(newId) };

  // 인덱스 업데이트
  db.prepare(`INSERT OR REPLACE INTO ${col} (id, data, _version, _deleted, updated_at) VALUES (?, ?, 1, 0, CURRENT_TIMESTAMP)`)
    .run('_index', JSON.stringify(index));

  // 문서 저장
  db.prepare(`INSERT OR REPLACE INTO ${col} (id, data, _version, _deleted, updated_at) VALUES (?, ?, 1, 0, CURRENT_TIMESTAMP)`)
    .run(newId, JSON.stringify(docData));

  return { id: parseInt(newId), ...docData };
}

function executeUpdate(parsed, collection) {
  const col = ensureCollection(collection);

  // 대상 문서 찾기
  const rows = db.prepare(`SELECT id, data FROM ${col} WHERE _deleted = 0 AND id != '_index'`).all();
  let updated = 0;

  for (const row of rows) {
    const doc = { id: row.id, ...JSON.parse(row.data) };
    if (matchesWhere(doc, parsed.where, parsed.orGroups)) {
      // 업데이트 적용
      const newDoc = { ...doc, ...parsed.values };
      db.prepare(`UPDATE ${col} SET data = ?, _version = _version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(JSON.stringify(newDoc), row.id);
      updated++;
    }
  }

  return { updated };
}

function executeDelete(parsed, collection) {
  const col = ensureCollection(collection);

  // 대상 문서 찾기
  const rows = db.prepare(`SELECT id, data FROM ${col} WHERE _deleted = 0 AND id != '_index'`).all();
  let deleted = 0;

  for (const row of rows) {
    const doc = { id: row.id, ...JSON.parse(row.data) };
    if (matchesWhere(doc, parsed.where, parsed.orGroups)) {
      // soft delete
      db.prepare(`UPDATE ${col} SET _deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(row.id);

      // 인덱스에서 제거
      const indexRow = db.prepare(`SELECT data FROM ${col} WHERE id = '_index'`).get();
      if (indexRow) {
        const index = JSON.parse(indexRow.data);
        index.ids = index.ids.filter(id => id !== row.id);
        db.prepare(`UPDATE ${col} SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = '_index'`)
          .run(JSON.stringify(index));
      }
      deleted++;
    }
  }

  return { deleted };
}

// SQL API 엔드포인트
fastify.post("/api/sql", async (req, reply) => {
  const { sql, params = [], collection } = req.body;

  if (!sql) {
    return reply.code(400).send({ error: "sql is required" });
  }
  if (!collection) {
    return reply.code(400).send({ error: "collection is required" });
  }

  try {
    const parsed = parseSql(sql, params);
    let result;

    switch (parsed.type) {
      case 'SELECT':
        result = executeSelect(parsed, collection);
        return { success: true, rows: result, rowcount: result.length };
      case 'INSERT':
        result = executeInsert(parsed, collection);
        return { success: true, row: result, lastrowid: result.id };
      case 'UPDATE':
        result = executeUpdate(parsed, collection);
        return { success: true, ...result };
      case 'DELETE':
        result = executeDelete(parsed, collection);
        return { success: true, ...result };
      default:
        return reply.code(400).send({ error: "Unsupported query type" });
    }
  } catch (e) {
    return reply.code(500).send({ error: e.message });
  }
});

// ===== Graceful Shutdown =====
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`[kimdb] ${signal} received, starting safe shutdown...`);

  // 0. 안전 타이머 정리
  console.log("[kimdb] Stopping safety timers...");
  if (safetyTimers.backup) clearInterval(safetyTimers.backup);
  if (safetyTimers.checkpoint) clearInterval(safetyTimers.checkpoint);
  if (safetyTimers.integrity) clearInterval(safetyTimers.integrity);

  // 1. 모든 캐시된 문서 저장
  console.log("[kimdb] Saving cached documents...");
  for (const key of crdtDocs.keys()) {
    const doc = crdtDocs.get(key);
    if (doc) {
      const [collection, docId] = key.split(":");
      saveCRDTToDB(collection, docId, doc);
    }
  }

  // 2. 클라이언트 연결 종료 알림
  console.log(`[kimdb] Closing ${clients.size} connections...`);
  for (const [, client] of clients) {
    try {
      client.socket.send(JSON.stringify({ type: "server_shutdown" }));
      client.socket.close(1001, "Server shutting down");
    } catch (e) {}
  }

  // 4. Redis 연결 종료
  if (redisPub) {
    await redisPub.quit().catch(() => {});
  }
  if (redisSub) {
    await redisSub.quit().catch(() => {});
  }

  // 5. 최종 DB 체크포인트
  console.log("[kimdb] Final checkpoint...");
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
    console.log("[kimdb] Checkpoint completed");
  } catch (e) {
    console.error("[kimdb] Checkpoint failed:", e.message);
  }

  // 6. DB 닫기
  try {
    db.close();
    console.log("[kimdb] Database closed");
  } catch (e) {}

  // 7. 락 파일 삭제
  try {
    unlinkSync(lockFile);
  } catch (e) {}

  // 8. 서버 종료
  await fastify.close();

  console.log("[kimdb] Safe shutdown complete");
  console.log(`[kimdb] Stats - Backups: ${safetyStats.backups}, Checkpoints: ${safetyStats.checkpoints}, Recoveries: ${safetyStats.recoveries}`);
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("beforeExit", () => gracefulShutdown("beforeExit"));

// ===== Safety Timers =====
const safetyTimers = {
  backup: null,
  checkpoint: null,
  integrity: null
};

// 자동 백업 타이머
safetyTimers.backup = setInterval(() => {
  if (!isShuttingDown) createBackup();
}, safetyConfig.backupIntervalMs);

// 체크포인트 타이머
safetyTimers.checkpoint = setInterval(() => {
  if (!isShuttingDown) {
    forceCheckpoint('PASSIVE');
    metrics.checkpoints.total++;
    metrics.checkpoints.lastAt = new Date().toISOString();
  }
}, safetyConfig.checkpointIntervalMs);

// 무결성 검사 타이머
safetyTimers.integrity = setInterval(() => {
  if (!isShuttingDown) checkIntegrity();
}, safetyConfig.integrityCheckIntervalMs);

// ===== Cleanup Timer =====
const cleanupTimer = setInterval(runCleanup, config.cache.cleanupInterval);

// ===== Monitor Dashboard =====
fastify.get("/kimdb/dashboard", async (req, reply) => {
  reply.type("text/html").send(getDashboardHTML());
});

fastify.get("/kimdb/status", async () => {
  // 기본 통계
  const collections = stmt.getCollections.all();
  let totalRows = 0;

  for (const col of collections) {
    try {
      const count = db.prepare(`SELECT COUNT(*) as c FROM ${col.name} WHERE _deleted = 0`).get();
      totalRows += count.c;
    } catch (e) {}
  }

  return {
    status: 'healthy',
    version: VERSION,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    overview: {
      totalWrites: metrics.writes.total,
      bufferedWrites: 0,
      bufferSize: 0,
      cacheHits: metrics.cache.hits,
      cacheMisses: metrics.cache.misses,
      cacheHitRate: metrics.cache.hits ?
        ((metrics.cache.hits / (metrics.cache.hits + metrics.cache.misses)) * 100).toFixed(1) + '%' : '0%'
    },
    collections: collections.length,
    totalRows,
    performance: {
      avgFlushTime: 0,
      writesPerSecond: 0,
      peakBufferSize: 0
    },
    connections: clients.size,
    // 안전 관련 통계
    safety: {
      level: safetyConfig.safetyLevel,
      backups: safetyStats.backups,
      checkpoints: safetyStats.checkpoints,
      integrityChecks: safetyStats.integrityChecks,
      recoveries: safetyStats.recoveries,
      lastBackup: safetyStats.lastBackup,
      lastCheckpoint: safetyStats.lastCheckpoint,
      lastIntegrityCheck: safetyStats.lastIntegrityCheck,
      backupCount: getBackupList().length,
      errors: safetyStats.errors.length
    }
  };
});

// ===== Safety API Endpoints =====

// 수동 백업
fastify.post("/kimdb/backup", async (req, reply) => {
  const result = createBackup();
  if (result) {
    return { success: true, ...result };
  }
  return reply.code(500).send({ error: "Backup failed" });
});

// 백업 목록
fastify.get("/kimdb/backups", async () => {
  return { backups: getBackupList() };
});

// 무결성 검사
fastify.post("/kimdb/integrity-check", async () => {
  const isOk = checkIntegrity();
  return { success: true, integrity: isOk ? 'ok' : 'failed' };
});

// 강제 체크포인트
fastify.post("/kimdb/checkpoint", async () => {
  const result = forceCheckpoint('TRUNCATE');
  return { success: true, result };
});

// 안전 통계
fastify.get("/kimdb/safety", async () => {
  return {
    config: safetyConfig,
    stats: safetyStats,
    backups: getBackupList()
  };
});

function getDashboardHTML() {
  return `<!DOCTYPE html>
<html>
<head>
  <title>kimdb Monitor</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a; color: #e2e8f0; padding: 20px;
    }
    .header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #334155;
    }
    .header h1 { color: #38bdf8; font-size: 24px; }
    .status-badge {
      padding: 6px 16px; border-radius: 20px; font-weight: 600;
      background: #22c55e; color: #fff;
    }
    .status-badge.error { background: #ef4444; }

    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }

    .card {
      background: #1e293b; border-radius: 12px; padding: 20px;
      border: 1px solid #334155;
    }
    .card-title { color: #94a3b8; font-size: 12px; text-transform: uppercase; margin-bottom: 8px; }
    .card-value { font-size: 32px; font-weight: 700; color: #f8fafc; }
    .card-sub { color: #64748b; font-size: 14px; margin-top: 4px; }

    .refresh-info { text-align: center; color: #64748b; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>kimdb Monitor</h1>
    <span class="status-badge" id="status">Loading...</span>
  </div>

  <div class="grid">
    <div class="card">
      <div class="card-title">Total Writes</div>
      <div class="card-value" id="totalWrites">-</div>
      <div class="card-sub" id="writesPerSec">- writes/sec</div>
    </div>

    <div class="card">
      <div class="card-title">Collections</div>
      <div class="card-value" id="collections">-</div>
      <div class="card-sub" id="totalRows">- rows total</div>
    </div>

    <div class="card">
      <div class="card-title">Cache Hit Rate</div>
      <div class="card-value" id="cacheHitRate">-</div>
      <div class="card-sub" id="cacheStats">Hits: - / Misses: -</div>
    </div>

    <div class="card">
      <div class="card-title">Connections</div>
      <div class="card-value" id="connections">-</div>
      <div class="card-sub">WebSocket clients</div>
    </div>

    <div class="card">
      <div class="card-title">Uptime</div>
      <div class="card-value" id="uptime">-</div>
      <div class="card-sub" id="version">v-</div>
    </div>

    <div class="card">
      <div class="card-title">Server Time</div>
      <div class="card-value" id="serverTime">-</div>
      <div class="card-sub" id="timestamp">-</div>
    </div>
  </div>

  <div class="refresh-info">Auto-refresh every 2 seconds</div>

  <script>
    async function fetchStatus() {
      try {
        const res = await fetch('/kimdb/status');
        const data = await res.json();
        updateUI(data);
      } catch (e) {
        document.getElementById('status').textContent = 'Error';
        document.getElementById('status').classList.add('error');
      }
    }

    function updateUI(data) {
      const statusEl = document.getElementById('status');
      statusEl.textContent = data.status.toUpperCase();
      statusEl.classList.toggle('error', data.status !== 'healthy');

      document.getElementById('totalWrites').textContent = formatNumber(data.overview.totalWrites);
      document.getElementById('collections').textContent = data.collections;
      document.getElementById('totalRows').textContent = formatNumber(data.totalRows) + ' rows total';
      document.getElementById('cacheHitRate').textContent = data.overview.cacheHitRate;
      document.getElementById('cacheStats').textContent =
        'Hits: ' + formatNumber(data.overview.cacheHits) + ' / Misses: ' + formatNumber(data.overview.cacheMisses);
      document.getElementById('connections').textContent = data.connections;
      document.getElementById('uptime').textContent = formatUptime(data.uptime);
      document.getElementById('version').textContent = 'v' + data.version;
      document.getElementById('serverTime').textContent = new Date().toLocaleTimeString();
      document.getElementById('timestamp').textContent = data.timestamp;
    }

    function formatNumber(n) {
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return String(n);
    }

    function formatUptime(seconds) {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      if (h > 0) return h + 'h ' + m + 'm';
      if (m > 0) return m + 'm ' + s + 's';
      return s + 's';
    }

    fetchStatus();
    setInterval(fetchStatus, 2000);
  </script>
</body>
</html>`;
}

// ===== Start Server =====
async function start() {
  console.log(`[kimdb] v${VERSION} init`);
  console.log(`[kimdb] Server ID: ${config.serverId}`);

  await initRedis();
  await initMariaDB();

  // 시작 시 즉시 헬스체크 로그
  setTimeout(logHealthCheck, 1000);

  try {
    await fastify.listen({ port: config.port, host: config.host });
    console.log(`[kimdb] v${VERSION} running on port ${config.port}`);
    console.log(`[kimdb] WebSocket: ws://${config.host}:${config.port}/ws`);
    console.log(`[kimdb] Prometheus: http://${config.host}:${config.port}/metrics`);
  } catch (e) {
    console.error("[kimdb] Start failed:", e);
    process.exit(1);
  }
}

start();
