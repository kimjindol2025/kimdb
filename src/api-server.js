/**
 * kimdb API Server v2.1.0
 * 외부 의존 최소화 버전
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import Database from "better-sqlite3";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 40000;
const VERSION = "2.1.0";

const DB_DIR = join(__dirname, "..", "shared_database");
const DB_PATH = join(DB_DIR, "code_team_ai.db");
const BACKUP_DIR = join(__dirname, "..", "backups");

if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("cache_size = 10000");
db.pragma("temp_store = MEMORY");
db.pragma("mmap_size = 268435456");
db.pragma("busy_timeout = 5000");
db.pragma("wal_autocheckpoint = 1000");

console.log("kimdb v" + VERSION + " init");

let checkpointInterval;
function runCheckpoint() {
  try {
    const result = db.pragma("wal_checkpoint(PASSIVE)");
    console.log("WAL checkpoint:", result);
    return result;
  } catch (e) {
    console.error("Checkpoint error:", e.message);
    return null;
  }
}
checkpointInterval = setInterval(runCheckpoint, 60 * 60 * 1000);

function createBackup() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupPath = join(BACKUP_DIR, "kimdb_" + ts + ".db");
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(DB_PATH, backupPath);
    console.log("Backup created:", backupPath);
    return { success: true, path: backupPath, timestamp: ts };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

const fastify = Fastify({ logger: true });
await fastify.register(cors, { origin: true });

fastify.get("/health", async () => ({ 
  status: "ok", version: VERSION, uptime: process.uptime() 
}));

fastify.get("/docs", async (req, reply) => {
  reply.type("text/html").send("<!DOCTYPE html><html><head><title>kimdb API</title><style>body{font-family:system-ui;max-width:900px;margin:0 auto;padding:20px;background:#1a1a2e;color:#eee}h1{color:#00d9ff}h2{color:#0abde3}pre{background:#0a0a14;padding:15px;border-radius:8px}</style></head><body><h1>kimdb API v" + VERSION + "</h1><h2>Endpoints</h2><pre>GET  /health - 상태\nGET  /api/stats - 통계\nPOST /api/checkpoint - 체크포인트\nPOST /api/backup - 백업 생성\nGET  /api/backups - 백업 목록\nGET  /api/ai/systems - AI 시스템\nGET  /api/ai/storage - AI 저장소\nGET  /api/search?q=검색어 - 검색\nPOST /api/index - 문서 인덱싱\nPOST /api/query - SQL 쿼리</pre></body></html>");
});

fastify.get("/api/stats", async () => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const stats = {};
  for (const t of tables) {
    try { stats[t.name] = db.prepare("SELECT COUNT(*) as c FROM " + t.name).get().c; } catch {}
  }
  const wal = db.pragma("wal_checkpoint(PASSIVE)");
  return { success: true, tables: stats, wal_pages: wal[0] };
});

fastify.post("/api/checkpoint", async () => {
  const result = runCheckpoint();
  return { success: !!result, result };
});

fastify.post("/api/backup", async () => createBackup());

fastify.get("/api/backups", async () => {
  try {
    const files = readdirSync(BACKUP_DIR).filter(f => f.endsWith(".db")).map(f => {
      const s = statSync(join(BACKUP_DIR, f));
      return { name: f, size: s.size, created: s.mtime };
    }).sort((a, b) => new Date(b.created) - new Date(a.created));
    return { success: true, count: files.length, backups: files };
  } catch (e) { return { success: false, error: e.message }; }
});

fastify.get("/api/ai/systems", async () => {
  const data = db.prepare("SELECT * FROM master_ai_systems").all();
  return { success: true, count: data.length, data };
});

fastify.get("/api/ai/storage", async (req) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const data = db.prepare("SELECT * FROM ai_storage LIMIT ? OFFSET ?").all(limit, offset);
  const total = db.prepare("SELECT COUNT(*) as c FROM ai_storage").get().c;
  return { success: true, count: data.length, total, data };
});

fastify.get("/api/search", async (req) => {
  const q = req.query.q;
  if (!q) return { success: false, error: "query required" };
  const start = Date.now();
  try {
    const data = db.prepare("SELECT doc_id, title, content, tags, category, bm25(fts_documents) as score FROM fts_documents WHERE fts_documents MATCH ? ORDER BY score LIMIT 20").all(q);
    const ms = Date.now() - start;
    db.prepare("INSERT INTO search_logs (query, results_count, search_time_ms) VALUES (?, ?, ?)").run(q, data.length, ms);
    return { success: true, query: q, count: data.length, time_ms: ms, data };
  } catch (e) { return { success: false, error: e.message }; }
});

fastify.post("/api/index", async (req) => {
  const body = req.body || {};
  const { doc_id, title, content, tags, category } = body;
  if (!doc_id || !title) return { success: false, error: "doc_id, title required" };
  try {
    db.prepare("INSERT OR REPLACE INTO fts_documents (doc_id, title, content, tags, category) VALUES (?, ?, ?, ?, ?)").run(doc_id, title, content || "", tags || "", category || "");
    return { success: true, doc_id };
  } catch (e) { return { success: false, error: e.message }; }
});

fastify.post("/api/query", async (req) => {
  const body = req.body || {};
  const { sql, params } = body;
  if (!sql) return { success: false, error: "sql required" };
  if (!sql.trim().toUpperCase().startsWith("SELECT")) return { success: false, error: "SELECT only" };
  try {
    const data = db.prepare(sql).all(...(params || []));
    return { success: true, count: data.length, data };
  } catch (e) { return { success: false, error: e.message }; }
});

const shutdown = async (sig) => {
  console.log(sig + " received");
  clearInterval(checkpointInterval);
  await fastify.close();
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  console.log("kimdb shutdown");
  process.exit(0);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

await fastify.listen({ port: PORT, host: "0.0.0.0" });
console.log("kimdb v" + VERSION + " on port " + PORT);
