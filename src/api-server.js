/**
 * kimdb API Server v2.2.0
 * 외부 의존 최소화 + Wiki API
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
const VERSION = "2.2.0";

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

// ===== 시스템 API =====

fastify.get("/health", async () => ({
  status: "ok", version: VERSION, uptime: process.uptime()
}));

fastify.get("/docs", async (req, reply) => {
  reply.type("text/html").send(`<!DOCTYPE html><html><head><title>kimdb API</title>
<style>body{font-family:system-ui;max-width:900px;margin:0 auto;padding:20px;background:#1a1a2e;color:#eee}
h1{color:#00d9ff}h2{color:#0abde3;margin-top:30px}pre{background:#0a0a14;padding:15px;border-radius:8px;overflow-x:auto}
.ep{background:#16213e;padding:10px 15px;margin:5px 0;border-radius:6px;font-family:monospace}</style></head>
<body><h1>kimdb API v${VERSION}</h1>
<h2>System</h2>
<div class="ep">GET /health</div>
<div class="ep">GET /api/stats</div>
<div class="ep">POST /api/checkpoint</div>
<div class="ep">POST /api/backup</div>
<div class="ep">GET /api/backups</div>
<div class="ep">POST /api/query</div>
<h2>AI Data</h2>
<div class="ep">GET /api/ai/systems</div>
<div class="ep">GET /api/ai/storage</div>
<h2>Search</h2>
<div class="ep">GET /api/search?q=검색어</div>
<div class="ep">POST /api/index</div>
<h2>Wiki</h2>
<div class="ep">GET /api/wiki/categories</div>
<div class="ep">POST /api/wiki/categories</div>
<div class="ep">GET /api/wiki/documents</div>
<div class="ep">GET /api/wiki/documents/:slug</div>
<div class="ep">POST /api/wiki/documents</div>
<div class="ep">PUT /api/wiki/documents/:slug</div>
<div class="ep">DELETE /api/wiki/documents/:slug</div>
<div class="ep">GET /api/wiki/edit-requests</div>
<div class="ep">POST /api/wiki/edit-requests</div>
<div class="ep">PUT /api/wiki/edit-requests/:id</div>
<div class="ep">GET /api/wiki/glossary</div>
<div class="ep">POST /api/wiki/glossary</div>
</body></html>`);
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

// ===== Wiki API =====

fastify.get("/api/wiki/categories", async () => {
  const data = db.prepare("SELECT * FROM wiki_categories ORDER BY display_order").all();
  return { success: true, count: data.length, data };
});

fastify.post("/api/wiki/categories", async (req) => {
  const { id, name, slug, icon, display_order } = req.body || {};
  if (!name || !slug) return { success: false, error: "name, slug required" };
  const docId = id || crypto.randomUUID();
  try {
    db.prepare("INSERT INTO wiki_categories (id, name, slug, icon, display_order) VALUES (?, ?, ?, ?, ?)").run(docId, name, slug, icon || null, display_order || 0);
    return { success: true, id: docId };
  } catch (e) { return { success: false, error: e.message }; }
});

fastify.get("/api/wiki/documents", async (req) => {
  const categoryId = req.query.category_id;
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  let sql = "SELECT * FROM wiki_documents";
  const params = [];
  if (categoryId) { sql += " WHERE category_id = ?"; params.push(categoryId); }
  sql += " ORDER BY display_order LIMIT ? OFFSET ?";
  params.push(limit, offset);
  const data = db.prepare(sql).all(...params);
  return { success: true, count: data.length, data };
});

fastify.get("/api/wiki/documents/:slug", async (req) => {
  const slug = req.params.slug;
  const doc = db.prepare("SELECT * FROM wiki_documents WHERE slug = ?").get(slug);
  if (!doc) return { success: false, error: "not found" };
  db.prepare("UPDATE wiki_documents SET views = views + 1 WHERE slug = ?").run(slug);
  const category = db.prepare("SELECT * FROM wiki_categories WHERE id = ?").get(doc.category_id);
  const children = db.prepare("SELECT id, title, slug FROM wiki_documents WHERE parent_id = ? ORDER BY display_order").all(doc.id);
  return { success: true, data: { ...doc, category, children } };
});

fastify.post("/api/wiki/documents", async (req) => {
  const { id, title, slug, content, summary, category_id, parent_id, display_order } = req.body || {};
  if (!title || !slug || !content || !category_id) return { success: false, error: "title, slug, content, category_id required" };
  const docId = id || crypto.randomUUID();
  try {
    db.prepare("INSERT INTO wiki_documents (id, title, slug, content, summary, category_id, parent_id, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(docId, title, slug, content, summary || null, category_id, parent_id || null, display_order || 0);
    db.prepare("INSERT OR REPLACE INTO fts_documents (doc_id, title, content, tags, category) VALUES (?, ?, ?, ?, ?)").run("wiki:" + docId, title, content, "", "wiki");
    return { success: true, id: docId };
  } catch (e) { return { success: false, error: e.message }; }
});

fastify.put("/api/wiki/documents/:slug", async (req) => {
  const slug = req.params.slug;
  const { title, content, summary, display_order } = req.body || {};
  const existing = db.prepare("SELECT id FROM wiki_documents WHERE slug = ?").get(slug);
  if (!existing) return { success: false, error: "not found" };
  try {
    db.prepare("UPDATE wiki_documents SET title = COALESCE(?, title), content = COALESCE(?, content), summary = COALESCE(?, summary), display_order = COALESCE(?, display_order), updated_at = CURRENT_TIMESTAMP WHERE slug = ?").run(title, content, summary, display_order, slug);
    if (title || content) {
      const doc = db.prepare("SELECT * FROM wiki_documents WHERE slug = ?").get(slug);
      db.prepare("INSERT OR REPLACE INTO fts_documents (doc_id, title, content, tags, category) VALUES (?, ?, ?, ?, ?)").run("wiki:" + existing.id, doc.title, doc.content, "", "wiki");
    }
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

fastify.delete("/api/wiki/documents/:slug", async (req) => {
  const slug = req.params.slug;
  try {
    const doc = db.prepare("SELECT id FROM wiki_documents WHERE slug = ?").get(slug);
    if (!doc) return { success: false, error: "not found" };
    db.prepare("DELETE FROM wiki_documents WHERE slug = ?").run(slug);
    db.prepare("DELETE FROM fts_documents WHERE doc_id = ?").run("wiki:" + doc.id);
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
    db.prepare("INSERT INTO wiki_edit_requests (id, document_id, author_id, title, content, summary, edit_summary) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, document_id, author_id, title, content, summary || null, edit_summary);
    return { success: true, id };
  } catch (e) { return { success: false, error: e.message }; }
});

fastify.get("/api/wiki/edit-requests", async (req) => {
  const status = req.query.status || "PENDING";
  const data = db.prepare("SELECT * FROM wiki_edit_requests WHERE status = ? ORDER BY created_at DESC").all(status);
  return { success: true, count: data.length, data };
});

fastify.put("/api/wiki/edit-requests/:id", async (req) => {
  const id = req.params.id;
  const { status, reviewed_by_id, review_note } = req.body || {};
  if (!status || !["APPROVED", "REJECTED"].includes(status)) {
    return { success: false, error: "status must be APPROVED or REJECTED" };
  }
  try {
    const request = db.prepare("SELECT * FROM wiki_edit_requests WHERE id = ?").get(id);
    if (!request) return { success: false, error: "not found" };
    db.prepare("UPDATE wiki_edit_requests SET status = ?, reviewed_by_id = ?, review_note = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, reviewed_by_id, review_note, id);
    if (status === "APPROVED") {
      db.prepare("UPDATE wiki_documents SET title = ?, content = ?, summary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(request.title, request.content, request.summary, request.document_id);
      db.prepare("INSERT OR REPLACE INTO fts_documents (doc_id, title, content, tags, category) VALUES (?, ?, ?, ?, ?)").run("wiki:" + request.document_id, request.title, request.content, "", "wiki");
    }
    return { success: true, status };
  } catch (e) { return { success: false, error: e.message }; }
});

fastify.get("/api/wiki/glossary", async (req) => {
  const category = req.query.category;
  const search = req.query.q;
  let sql = "SELECT * FROM glossary_terms WHERE 1=1";
  const params = [];
  if (category) { sql += " AND category = ?"; params.push(category); }
  if (search) { sql += " AND (term LIKE ? OR definition LIKE ?)"; params.push("%" + search + "%", "%" + search + "%"); }
  sql += " ORDER BY term";
  const data = db.prepare(sql).all(...params);
  return { success: true, count: data.length, data };
});

fastify.post("/api/wiki/glossary", async (req) => {
  const { term, definition, category, related_terms, unit } = req.body || {};
  if (!term || !definition) return { success: false, error: "term, definition required" };
  const id = crypto.randomUUID();
  try {
    db.prepare("INSERT INTO glossary_terms (id, term, definition, category, related_terms, unit) VALUES (?, ?, ?, ?, ?, ?)").run(id, term, definition, category || null, related_terms || null, unit || null);
    db.prepare("INSERT OR REPLACE INTO fts_documents (doc_id, title, content, tags, category) VALUES (?, ?, ?, ?, ?)").run("glossary:" + id, term, definition, category || "", "glossary");
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
