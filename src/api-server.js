/**
 * kimdb API Server v2.3.0
 * - Prepared Statement 캐싱
 * - API Key 인증
 * - 테이블 자동 생성
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import Database from "better-sqlite3";
import crypto from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 40000;
const VERSION = "2.3.0";
const API_KEY = process.env.KIMDB_API_KEY || "kimdb-dev-key-2025";

const DB_DIR = join(__dirname, "..", "shared_database");
const DB_PATH = join(DB_DIR, "code_team_ai.db");
const BACKUP_DIR = join(__dirname, "..", "backups");

if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("cache_size = 10000");
db.pragma("temp_store = MEMORY");
db.pragma("mmap_size = 268435456");
db.pragma("busy_timeout = 5000");
db.pragma("wal_autocheckpoint = 1000");

// ===== 테이블 자동 생성 =====
function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT,
      results_count INTEGER,
      search_time_ms INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS master_ai_systems (
      id TEXT PRIMARY KEY,
      name TEXT,
      type TEXT,
      config TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ai_storage (
      id TEXT PRIMARY KEY,
      system_id TEXT,
      key TEXT,
      value TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS wiki_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      icon TEXT,
      display_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS wiki_documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      content TEXT NOT NULL,
      summary TEXT,
      display_order INTEGER DEFAULT 0,
      views INTEGER DEFAULT 0,
      category_id TEXT,
      parent_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES wiki_categories(id),
      FOREIGN KEY (parent_id) REFERENCES wiki_documents(id)
    );

    CREATE TABLE IF NOT EXISTS wiki_edit_requests (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      summary TEXT,
      edit_summary TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING',
      reviewed_by_id TEXT,
      review_note TEXT,
      reviewed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES wiki_documents(id)
    );

    CREATE TABLE IF NOT EXISTS glossary_terms (
      id TEXT PRIMARY KEY,
      term TEXT NOT NULL,
      definition TEXT NOT NULL,
      category TEXT,
      related_terms TEXT,
      unit TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // FTS5 테이블 (별도 생성)
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_documents USING fts5(
        doc_id, title, content, tags, category,
        tokenize='unicode61'
      );
    `);
  } catch (e) {
    // 이미 존재하면 무시
  }

  console.log("Schema ensured");
}
ensureSchema();

// ===== Prepared Statement 캐싱 =====
const stmt = {
  // Search
  ftsSearch: db.prepare(`
    SELECT doc_id, title, content, tags, category, bm25(fts_documents) as score
    FROM fts_documents WHERE fts_documents MATCH ? ORDER BY score LIMIT 20
  `),
  insertSearchLog: db.prepare(`
    INSERT INTO search_logs (query, results_count, search_time_ms) VALUES (?, ?, ?)
  `),
  ftsUpsert: db.prepare(`
    INSERT OR REPLACE INTO fts_documents (doc_id, title, content, tags, category) VALUES (?, ?, ?, ?, ?)
  `),
  ftsDelete: db.prepare(`DELETE FROM fts_documents WHERE doc_id = ?`),

  // AI
  getAiSystems: db.prepare(`SELECT * FROM master_ai_systems`),
  getAiStorage: db.prepare(`SELECT * FROM ai_storage LIMIT ? OFFSET ?`),
  countAiStorage: db.prepare(`SELECT COUNT(*) as c FROM ai_storage`),

  // Wiki Categories
  getCategories: db.prepare(`SELECT * FROM wiki_categories ORDER BY display_order`),
  insertCategory: db.prepare(`
    INSERT INTO wiki_categories (id, name, slug, icon, display_order) VALUES (?, ?, ?, ?, ?)
  `),

  // Wiki Documents
  getDocuments: db.prepare(`SELECT * FROM wiki_documents ORDER BY display_order LIMIT ? OFFSET ?`),
  getDocumentsByCategory: db.prepare(`
    SELECT * FROM wiki_documents WHERE category_id = ? ORDER BY display_order LIMIT ? OFFSET ?
  `),
  getDocumentBySlug: db.prepare(`SELECT * FROM wiki_documents WHERE slug = ?`),
  getDocumentById: db.prepare(`SELECT * FROM wiki_documents WHERE id = ?`),
  getCategoryById: db.prepare(`SELECT * FROM wiki_categories WHERE id = ?`),
  getChildDocuments: db.prepare(`
    SELECT id, title, slug FROM wiki_documents WHERE parent_id = ? ORDER BY display_order
  `),
  incrementViews: db.prepare(`UPDATE wiki_documents SET views = views + 1 WHERE slug = ?`),
  insertDocument: db.prepare(`
    INSERT INTO wiki_documents (id, title, slug, content, summary, category_id, parent_id, display_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateDocument: db.prepare(`
    UPDATE wiki_documents SET title = COALESCE(?, title), content = COALESCE(?, content),
    summary = COALESCE(?, summary), display_order = COALESCE(?, display_order),
    updated_at = CURRENT_TIMESTAMP WHERE slug = ?
  `),
  deleteDocument: db.prepare(`DELETE FROM wiki_documents WHERE slug = ?`),

  // Edit Requests
  getEditRequests: db.prepare(`
    SELECT * FROM wiki_edit_requests WHERE status = ? ORDER BY created_at DESC
  `),
  getEditRequestById: db.prepare(`SELECT * FROM wiki_edit_requests WHERE id = ?`),
  insertEditRequest: db.prepare(`
    INSERT INTO wiki_edit_requests (id, document_id, author_id, title, content, summary, edit_summary)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  updateEditRequest: db.prepare(`
    UPDATE wiki_edit_requests SET status = ?, reviewed_by_id = ?, review_note = ?,
    reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `),
  applyEditRequest: db.prepare(`
    UPDATE wiki_documents SET title = ?, content = ?, summary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `),

  // Glossary
  getGlossary: db.prepare(`SELECT * FROM glossary_terms ORDER BY term`),
  getGlossaryByCategory: db.prepare(`SELECT * FROM glossary_terms WHERE category = ? ORDER BY term`),
  insertGlossary: db.prepare(`
    INSERT INTO glossary_terms (id, term, definition, category, related_terms, unit) VALUES (?, ?, ?, ?, ?, ?)
  `),
};

console.log("kimdb v" + VERSION + " init");

// ===== WAL Checkpoint =====
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

// ===== API Key 인증 미들웨어 =====
const publicPaths = ["/health", "/docs", "/api/stats", "/api/wiki/categories", "/api/wiki/documents", "/api/wiki/glossary", "/api/search"];

fastify.addHook("preHandler", async (request, reply) => {
  const path = request.url.split("?")[0];

  // Public GET 요청은 인증 불필요
  if (request.method === "GET" && publicPaths.some(p => path.startsWith(p))) {
    return;
  }

  // 쓰기 작업은 API Key 필요
  if (["POST", "PUT", "DELETE"].includes(request.method)) {
    const apiKey = request.headers["x-api-key"];
    if (apiKey !== API_KEY) {
      return reply.code(401).send({ success: false, error: "Invalid API key" });
    }
  }
});

// ===== 시스템 API =====

fastify.get("/health", async () => ({
  status: "ok", version: VERSION, uptime: process.uptime()
}));

fastify.get("/docs", async (req, reply) => {
  reply.type("text/html").send(`<!DOCTYPE html><html><head><title>kimdb API</title>
<style>body{font-family:system-ui;max-width:900px;margin:0 auto;padding:20px;background:#1a1a2e;color:#eee}
h1{color:#00d9ff}h2{color:#0abde3;margin-top:30px}pre{background:#0a0a14;padding:15px;border-radius:8px;overflow-x:auto}
.ep{background:#16213e;padding:10px 15px;margin:5px 0;border-radius:6px;font-family:monospace}
.auth{color:#ff6b6b;font-size:12px;margin-left:10px}</style></head>
<body><h1>kimdb API v${VERSION}</h1>
<p>인증: 쓰기 API는 <code>X-API-Key</code> 헤더 필요</p>
<h2>System</h2>
<div class="ep">GET /health</div>
<div class="ep">GET /api/stats</div>
<div class="ep">POST /api/checkpoint<span class="auth">AUTH</span></div>
<div class="ep">POST /api/backup<span class="auth">AUTH</span></div>
<div class="ep">GET /api/backups</div>
<div class="ep">POST /api/query<span class="auth">AUTH</span></div>
<h2>AI Data</h2>
<div class="ep">GET /api/ai/systems</div>
<div class="ep">GET /api/ai/storage</div>
<h2>Search</h2>
<div class="ep">GET /api/search?q=검색어</div>
<div class="ep">POST /api/index<span class="auth">AUTH</span></div>
<h2>Wiki</h2>
<div class="ep">GET /api/wiki/categories</div>
<div class="ep">POST /api/wiki/categories<span class="auth">AUTH</span></div>
<div class="ep">GET /api/wiki/documents</div>
<div class="ep">GET /api/wiki/documents/:slug</div>
<div class="ep">POST /api/wiki/documents<span class="auth">AUTH</span></div>
<div class="ep">PUT /api/wiki/documents/:slug<span class="auth">AUTH</span></div>
<div class="ep">DELETE /api/wiki/documents/:slug<span class="auth">AUTH</span></div>
<div class="ep">GET /api/wiki/edit-requests</div>
<div class="ep">POST /api/wiki/edit-requests<span class="auth">AUTH</span></div>
<div class="ep">PUT /api/wiki/edit-requests/:id<span class="auth">AUTH</span></div>
<div class="ep">GET /api/wiki/glossary</div>
<div class="ep">POST /api/wiki/glossary<span class="auth">AUTH</span></div>
</body></html>`);
});

fastify.get("/api/stats", async () => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const stats = {};
  for (const t of tables) {
    try { stats[t.name] = db.prepare("SELECT COUNT(*) as c FROM " + t.name).get().c; } catch {}
  }
  const wal = db.pragma("wal_checkpoint(PASSIVE)");
  return { success: true, version: VERSION, tables: stats, wal_pages: wal[0] };
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
  const data = stmt.getAiSystems.all();
  return { success: true, count: data.length, data };
});

fastify.get("/api/ai/storage", async (req) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const data = stmt.getAiStorage.all(limit, offset);
  const total = stmt.countAiStorage.get().c;
  return { success: true, count: data.length, total, data };
});

fastify.get("/api/search", async (req) => {
  const q = req.query.q;
  if (!q) return { success: false, error: "query required" };
  const start = Date.now();
  try {
    const data = stmt.ftsSearch.all(q);
    const ms = Date.now() - start;
    stmt.insertSearchLog.run(q, data.length, ms);
    return { success: true, query: q, count: data.length, time_ms: ms, data };
  } catch (e) { return { success: false, error: e.message }; }
});

fastify.post("/api/index", async (req) => {
  const { doc_id, title, content, tags, category } = req.body || {};
  if (!doc_id || !title) return { success: false, error: "doc_id, title required" };
  try {
    stmt.ftsUpsert.run(doc_id, title, content || "", tags || "", category || "");
    return { success: true, doc_id };
  } catch (e) { return { success: false, error: e.message }; }
});

fastify.post("/api/query", async (req) => {
  const { sql, params } = req.body || {};
  if (!sql) return { success: false, error: "sql required" };
  if (!sql.trim().toUpperCase().startsWith("SELECT")) return { success: false, error: "SELECT only" };
  try {
    const data = db.prepare(sql).all(...(params || []));
    return { success: true, count: data.length, data };
  } catch (e) { return { success: false, error: e.message }; }
});

// ===== Wiki API =====

fastify.get("/api/wiki/categories", async () => {
  const data = stmt.getCategories.all();
  return { success: true, count: data.length, data };
});

fastify.post("/api/wiki/categories", async (req) => {
  const { id, name, slug, icon, display_order } = req.body || {};
  if (!name || !slug) return { success: false, error: "name, slug required" };
  const docId = id || crypto.randomUUID();
  try {
    stmt.insertCategory.run(docId, name, slug, icon || null, display_order || 0);
    return { success: true, id: docId };
  } catch (e) { return { success: false, error: e.message }; }
});

fastify.get("/api/wiki/documents", async (req) => {
  const categoryId = req.query.category_id;
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const data = categoryId
    ? stmt.getDocumentsByCategory.all(categoryId, limit, offset)
    : stmt.getDocuments.all(limit, offset);
  return { success: true, count: data.length, data };
});

fastify.get("/api/wiki/documents/:slug", async (req) => {
  const slug = req.params.slug;
  const doc = stmt.getDocumentBySlug.get(slug);
  if (!doc) return { success: false, error: "not found" };
  stmt.incrementViews.run(slug);
  const category = stmt.getCategoryById.get(doc.category_id);
  const children = stmt.getChildDocuments.all(doc.id);
  return { success: true, data: { ...doc, category, children } };
});

fastify.post("/api/wiki/documents", async (req) => {
  const { id, title, slug, content, summary, category_id, parent_id, display_order } = req.body || {};
  if (!title || !slug || !content || !category_id) return { success: false, error: "title, slug, content, category_id required" };
  const docId = id || crypto.randomUUID();
  try {
    stmt.insertDocument.run(docId, title, slug, content, summary || null, category_id, parent_id || null, display_order || 0);
    stmt.ftsUpsert.run("wiki:" + docId, title, content, "", "wiki");
    return { success: true, id: docId };
  } catch (e) { return { success: false, error: e.message }; }
});

fastify.put("/api/wiki/documents/:slug", async (req) => {
  const slug = req.params.slug;
  const { title, content, summary, display_order } = req.body || {};
  const existing = stmt.getDocumentBySlug.get(slug);
  if (!existing) return { success: false, error: "not found" };
  try {
    stmt.updateDocument.run(title, content, summary, display_order, slug);
    if (title || content) {
      const doc = stmt.getDocumentBySlug.get(slug);
      stmt.ftsUpsert.run("wiki:" + existing.id, doc.title, doc.content, "", "wiki");
    }
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

fastify.delete("/api/wiki/documents/:slug", async (req) => {
  const slug = req.params.slug;
  try {
    const doc = stmt.getDocumentBySlug.get(slug);
    if (!doc) return { success: false, error: "not found" };
    stmt.deleteDocument.run(slug);
    stmt.ftsDelete.run("wiki:" + doc.id);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

fastify.post("/api/wiki/edit-requests", async (req) => {
  const { document_id, author_id, title, content, summary, edit_summary } = req.body || {};
  if (!document_id || !author_id || !title || !content || !edit_summary) {
    return { success: false, error: "document_id, author_id, title, content, edit_summary required" };
  }
  const id = crypto.randomUUID();
  try {
    stmt.insertEditRequest.run(id, document_id, author_id, title, content, summary || null, edit_summary);
    return { success: true, id };
  } catch (e) { return { success: false, error: e.message }; }
});

fastify.get("/api/wiki/edit-requests", async (req) => {
  const status = req.query.status || "PENDING";
  const data = stmt.getEditRequests.all(status);
  return { success: true, count: data.length, data };
});

fastify.put("/api/wiki/edit-requests/:id", async (req) => {
  const id = req.params.id;
  const { status, reviewed_by_id, review_note } = req.body || {};
  if (!status || !["APPROVED", "REJECTED"].includes(status)) {
    return { success: false, error: "status must be APPROVED or REJECTED" };
  }
  try {
    const request = stmt.getEditRequestById.get(id);
    if (!request) return { success: false, error: "not found" };
    stmt.updateEditRequest.run(status, reviewed_by_id, review_note, id);
    if (status === "APPROVED") {
      stmt.applyEditRequest.run(request.title, request.content, request.summary, request.document_id);
      stmt.ftsUpsert.run("wiki:" + request.document_id, request.title, request.content, "", "wiki");
    }
    return { success: true, status };
  } catch (e) { return { success: false, error: e.message }; }
});

fastify.get("/api/wiki/glossary", async (req) => {
  const category = req.query.category;
  const search = req.query.q;

  let data;
  if (category) {
    data = stmt.getGlossaryByCategory.all(category);
  } else {
    data = stmt.getGlossary.all();
  }

  if (search) {
    const s = search.toLowerCase();
    data = data.filter(d => d.term.toLowerCase().includes(s) || d.definition.toLowerCase().includes(s));
  }

  return { success: true, count: data.length, data };
});

fastify.post("/api/wiki/glossary", async (req) => {
  const { term, definition, category, related_terms, unit } = req.body || {};
  if (!term || !definition) return { success: false, error: "term, definition required" };
  const id = crypto.randomUUID();
  try {
    stmt.insertGlossary.run(id, term, definition, category || null, related_terms || null, unit || null);
    stmt.ftsUpsert.run("glossary:" + id, term, definition, category || "", "glossary");
    return { success: true, id };
  } catch (e) { return { success: false, error: e.message }; }
});

// ===== Graceful Shutdown =====
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
