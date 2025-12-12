/**
 * kimdb API Server v2.0
 * 고성능 문서형 데이터베이스 API
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 40000;

// DB 연결 + 성능 최적화
const dbPath = join(__dirname, '..', 'shared_database', 'code_team_ai.db');
const db = new Database(dbPath);

// 성능 PRAGMA
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = 10000');
db.pragma('temp_store = MEMORY');
db.pragma('mmap_size = 268435456');
db.pragma('busy_timeout = 5000');

console.log('📊 kimdb 초기화 완료');

const fastify = Fastify({ logger: true });

await fastify.register(cors, { origin: true });
await fastify.register(helmet);
await fastify.register(rateLimit, { max: 1000, timeWindow: '1 minute' });

// Health check
fastify.get('/health', async () => ({ status: 'ok', version: '2.0.0' }));

// 통계
fastify.get('/api/stats', async () => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const stats = {};
  tables.forEach(t => {
    try {
      const count = db.prepare(`SELECT COUNT(*) as cnt FROM ${t.name}`).get();
      stats[t.name] = count.cnt;
    } catch (e) {}
  });
  return { success: true, tables: stats };
});

// AI 시스템 목록
fastify.get('/api/ai/systems', async () => {
  const systems = db.prepare('SELECT * FROM master_ai_systems').all();
  return { success: true, count: systems.length, data: systems };
});

// AI 저장소
fastify.get('/api/ai/storage', async (req) => {
  const limit = req.query.limit || 50;
  const offset = req.query.offset || 0;
  const data = db.prepare('SELECT * FROM ai_storage LIMIT ? OFFSET ?').all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) as cnt FROM ai_storage').get();
  return { success: true, count: data.length, total: total.cnt, data };
});

// 전문검색
fastify.get('/api/search', async (req) => {
  const q = req.query.q;
  if (!q) return { success: false, error: 'query required' };
  
  const startTime = Date.now();
  try {
    const results = db.prepare(`
      SELECT doc_id, title, content, tags, category, bm25(fts_documents) as score
      FROM fts_documents WHERE fts_documents MATCH ? ORDER BY score LIMIT 20
    `).all(q);
    
    const elapsed = Date.now() - startTime;
    db.prepare('INSERT INTO search_logs (query, results_count, search_time_ms) VALUES (?, ?, ?)').run(q, results.length, elapsed);
    
    return { success: true, query: q, count: results.length, time_ms: elapsed, data: results };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 문서 인덱싱
fastify.post('/api/index', async (req) => {
  const { doc_id, title, content, tags, category } = req.body;
  if (!doc_id || !title) return { success: false, error: 'doc_id and title required' };
  
  try {
    db.prepare('INSERT OR REPLACE INTO fts_documents (doc_id, title, content, tags, category) VALUES (?, ?, ?, ?, ?)').run(doc_id, title, content || '', tags || '', category || '');
    return { success: true, message: 'indexed', doc_id };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 쿼리 실행
fastify.post('/api/query', async (req) => {
  const { sql, params } = req.body;
  if (!sql) return { success: false, error: 'sql required' };
  
  // 읽기 전용 체크
  const readOnly = sql.trim().toUpperCase().startsWith('SELECT');
  if (!readOnly) return { success: false, error: 'only SELECT allowed' };
  
  try {
    const results = db.prepare(sql).all(...(params || []));
    return { success: true, count: results.length, data: results };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 서버 시작
try {
  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`🚀 kimdb API Server running on port ${PORT}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
