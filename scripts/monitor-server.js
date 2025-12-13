#!/usr/bin/env node
/**
 * kimdb 24시간 모니터링 서버
 * - Gogs 웹훅 수신
 * - 실시간 대시보드 제공
 * - 알람 (서버 다운 시)
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import mysql from 'mysql2/promise';

const PORT = process.env.MONITOR_PORT || 40010;

const MARIADB_CONFIG = {
  host: process.env.MARIADB_HOST || '192.168.45.73',
  port: parseInt(process.env.MARIADB_PORT) || 3306,
  user: process.env.MARIADB_USER || 'kim',
  password: process.env.MARIADB_PASSWORD || 'kimdb2025',
  database: process.env.MARIADB_DATABASE || 'kimdb_logs'
};

const SERVERS = [
  { name: '73', url: 'http://127.0.0.1:40000', ip: '192.168.45.73' },
  { name: '253', url: 'http://192.168.45.253:40001', ip: '192.168.45.253' }
];

const fastify = Fastify({ logger: false });
await fastify.register(cors, { origin: true });

let mariaPool = null;

// MariaDB 연결
async function initMariaDB() {
  try {
    mariaPool = mysql.createPool(MARIADB_CONFIG);
    const conn = await mariaPool.getConnection();
    await conn.ping();
    conn.release();
    console.log('[Monitor] MariaDB connected');
  } catch (e) {
    console.error('[Monitor] MariaDB failed:', e.message);
  }
}

// 서버 상태 체크
async function checkServer(server) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${server.url}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      return { ...server, status: 'online', ...data };
    }
    return { ...server, status: 'error' };
  } catch (e) {
    return { ...server, status: 'offline', error: e.message };
  }
}

// 최근 로그 조회
async function getRecentLogs(minutes = 60) {
  if (!mariaPool) return { ops: [], health: [] };
  const since = Date.now() - (minutes * 60 * 1000);

  try {
    const [ops] = await mariaPool.query(
      `SELECT server_id, type, COUNT(*) as count,
              SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as success
       FROM operation_logs WHERE timestamp > ?
       GROUP BY server_id, type ORDER BY count DESC`,
      [since]
    );

    const [health] = await mariaPool.query(
      `SELECT server_id, connections, memory_mb, uptime, redis_connected,
              FROM_UNIXTIME(timestamp/1000) as checked_at
       FROM health_checks WHERE timestamp > ?
       ORDER BY timestamp DESC LIMIT 20`,
      [since]
    );

    return { ops, health };
  } catch (e) {
    return { ops: [], health: [], error: e.message };
  }
}

// 통계
async function getStats() {
  if (!mariaPool) return null;

  try {
    const [totals] = await mariaPool.query(`
      SELECT
        (SELECT COUNT(*) FROM operation_logs) as total_ops,
        (SELECT COUNT(*) FROM health_checks) as total_health,
        (SELECT COUNT(DISTINCT server_id) FROM health_checks) as servers,
        (SELECT SUM(CASE WHEN success=0 THEN 1 ELSE 0 END) FROM operation_logs) as failed_ops
    `);

    const [hourly] = await mariaPool.query(`
      SELECT
        DATE_FORMAT(FROM_UNIXTIME(timestamp/1000), '%Y-%m-%d %H:00') as hour,
        COUNT(*) as ops
      FROM operation_logs
      WHERE timestamp > ?
      GROUP BY hour
      ORDER BY hour DESC
      LIMIT 24
    `, [Date.now() - 24 * 60 * 60 * 1000]);

    return { ...totals[0], hourly };
  } catch (e) {
    return { error: e.message };
  }
}

// Gogs 웹훅 저장 테이블 생성
async function ensureWebhookTable() {
  if (!mariaPool) return;
  try {
    await mariaPool.query(`
      CREATE TABLE IF NOT EXISTS gogs_webhooks (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        event_type VARCHAR(50),
        repo VARCHAR(100),
        branch VARCHAR(100),
        commit_id VARCHAR(100),
        author VARCHAR(100),
        message TEXT,
        payload JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_repo (repo),
        INDEX idx_created (created_at)
      )
    `);
  } catch (e) {}
}

// ===== API 엔드포인트 =====

// 대시보드 HTML
fastify.get('/', async (req, reply) => {
  reply.type('text/html').send(`
<!DOCTYPE html>
<html>
<head>
  <title>kimdb Monitor</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #eee; padding: 20px; }
    h1 { color: #00d9ff; margin-bottom: 20px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
    .card { background: #16213e; border-radius: 10px; padding: 20px; }
    .card h2 { color: #00d9ff; font-size: 1rem; margin-bottom: 15px; border-bottom: 1px solid #0f3460; padding-bottom: 10px; }
    .server { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #0f3460; }
    .server:last-child { border-bottom: none; }
    .status { padding: 4px 12px; border-radius: 20px; font-size: 0.8rem; font-weight: bold; }
    .status.online { background: #00c853; color: #000; }
    .status.offline { background: #ff1744; color: #fff; }
    .stat { display: flex; justify-content: space-between; padding: 8px 0; }
    .stat-value { color: #00d9ff; font-weight: bold; }
    .log-item { font-size: 0.85rem; padding: 8px 0; border-bottom: 1px solid #0f3460; }
    .log-item:last-child { border-bottom: none; }
    .time { color: #888; font-size: 0.75rem; }
    .refresh { position: fixed; bottom: 20px; right: 20px; background: #00d9ff; color: #000; border: none; padding: 12px 24px; border-radius: 30px; cursor: pointer; font-weight: bold; }
    .webhook { background: #0f3460; padding: 10px; border-radius: 5px; margin-bottom: 10px; }
    .webhook-repo { color: #00d9ff; font-weight: bold; }
  </style>
</head>
<body>
  <h1>📊 kimdb 24h Monitor</h1>
  <div class="grid">
    <div class="card">
      <h2>🖥️ Server Status</h2>
      <div id="servers">Loading...</div>
    </div>
    <div class="card">
      <h2>📈 Statistics</h2>
      <div id="stats">Loading...</div>
    </div>
    <div class="card">
      <h2>💓 Recent Health Checks</h2>
      <div id="health">Loading...</div>
    </div>
    <div class="card">
      <h2>🔔 Recent Webhooks</h2>
      <div id="webhooks">Loading...</div>
    </div>
  </div>
  <button class="refresh" onclick="loadAll()">🔄 Refresh</button>

  <script>
    async function loadServers() {
      const res = await fetch('/api/status');
      const data = await res.json();
      document.getElementById('servers').innerHTML = data.servers.map(s =>
        '<div class="server"><span>' + s.name + ' (' + s.url + ')</span>' +
        '<span class="status ' + s.status + '">' + s.status.toUpperCase() + '</span></div>'
      ).join('');
    }

    async function loadStats() {
      const res = await fetch('/api/stats');
      const data = await res.json();
      document.getElementById('stats').innerHTML =
        '<div class="stat"><span>Total Operations</span><span class="stat-value">' + (data.total_ops || 0).toLocaleString() + '</span></div>' +
        '<div class="stat"><span>Health Checks</span><span class="stat-value">' + (data.total_health || 0).toLocaleString() + '</span></div>' +
        '<div class="stat"><span>Active Servers</span><span class="stat-value">' + (data.servers || 0) + '</span></div>' +
        '<div class="stat"><span>Failed Ops</span><span class="stat-value">' + (data.failed_ops || 0) + '</span></div>';
    }

    async function loadHealth() {
      const res = await fetch('/api/logs?minutes=60');
      const data = await res.json();
      document.getElementById('health').innerHTML = (data.health || []).slice(0, 5).map(h =>
        '<div class="log-item">' +
        '<strong>' + h.server_id + '</strong> ' + h.connections + ' conn, ' + h.memory_mb + 'MB' +
        '<div class="time">' + h.checked_at + '</div></div>'
      ).join('') || 'No data';
    }

    async function loadWebhooks() {
      const res = await fetch('/api/webhooks');
      const data = await res.json();
      document.getElementById('webhooks').innerHTML = (data.webhooks || []).map(w =>
        '<div class="webhook">' +
        '<div class="webhook-repo">' + w.repo + '</div>' +
        '<div>' + (w.message || '').substring(0, 50) + '</div>' +
        '<div class="time">' + w.created_at + '</div></div>'
      ).join('') || 'No webhooks yet';
    }

    function loadAll() {
      loadServers();
      loadStats();
      loadHealth();
      loadWebhooks();
    }

    loadAll();
    setInterval(loadAll, 30000);
  </script>
</body>
</html>
  `);
});

// API: 서버 상태
fastify.get('/api/status', async () => {
  const servers = await Promise.all(SERVERS.map(checkServer));
  return { servers, timestamp: new Date().toISOString() };
});

// API: 통계
fastify.get('/api/stats', async () => {
  return await getStats() || {};
});

// API: 로그
fastify.get('/api/logs', async (req) => {
  const minutes = parseInt(req.query.minutes) || 60;
  return await getRecentLogs(minutes);
});

// API: 웹훅 목록
fastify.get('/api/webhooks', async () => {
  if (!mariaPool) return { webhooks: [] };
  try {
    const [rows] = await mariaPool.query(
      `SELECT repo, branch, author, message, created_at
       FROM gogs_webhooks ORDER BY id DESC LIMIT 20`
    );
    return { webhooks: rows };
  } catch (e) {
    return { webhooks: [], error: e.message };
  }
});

// Gogs 웹훅 수신
fastify.post('/webhook/gogs', async (req, reply) => {
  const event = req.headers['x-gogs-event'] || 'unknown';
  const payload = req.body;

  console.log(`[Webhook] ${event} from ${payload?.repository?.full_name || 'unknown'}`);

  if (mariaPool) {
    try {
      await mariaPool.query(
        `INSERT INTO gogs_webhooks (event_type, repo, branch, commit_id, author, message, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          event,
          payload?.repository?.full_name || null,
          payload?.ref?.replace('refs/heads/', '') || null,
          payload?.after || payload?.commits?.[0]?.id || null,
          payload?.pusher?.username || payload?.sender?.username || null,
          payload?.commits?.[0]?.message || null,
          JSON.stringify(payload)
        ]
      );
    } catch (e) {
      console.error('[Webhook] DB error:', e.message);
    }
  }

  // 자동 배포 트리거 (kimdb 저장소인 경우)
  if (payload?.repository?.name === 'kimdb' && event === 'push') {
    console.log('[Webhook] kimdb push detected - auto deploy trigger');
    // TODO: 자동 배포 로직 추가 가능
  }

  return { received: true, event };
});

// 서버 시작
async function start() {
  await initMariaDB();
  await ensureWebhookTable();

  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[Monitor] Running on http://0.0.0.0:${PORT}`);
  console.log(`[Monitor] Dashboard: http://0.0.0.0:${PORT}/`);
  console.log(`[Monitor] Webhook: http://0.0.0.0:${PORT}/webhook/gogs`);
}

start();
