#!/usr/bin/env node
/**
 * kimdb 교차 검증 스크립트
 * - 73, 253 서버 상태 확인
 * - MariaDB 로그 분석
 * - 3분마다 자동 실행
 */

import mysql from 'mysql2/promise';

const MARIADB_CONFIG = {
  host: process.env.MARIADB_HOST || '192.168.45.73',
  port: parseInt(process.env.MARIADB_PORT) || 3306,
  user: process.env.MARIADB_USER || 'kim',
  password: process.env.MARIADB_PASSWORD || 'kimdb2025',
  database: process.env.MARIADB_DATABASE || 'kimdb_logs'
};

const SERVERS = [
  { name: '73', url: 'http://127.0.0.1:40000' },
  { name: '253', url: 'http://192.168.45.253:40001' }
];

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
    return { ...server, status: 'error', error: res.statusText };
  } catch (e) {
    return { ...server, status: 'offline', error: e.message };
  }
}

async function getRecentLogs(pool, minutes = 3) {
  const since = Date.now() - (minutes * 60 * 1000);

  const [opLogs] = await pool.query(
    `SELECT server_id, type, COUNT(*) as count
     FROM operation_logs
     WHERE timestamp > ?
     GROUP BY server_id, type
     ORDER BY server_id, count DESC`,
    [since]
  );

  const [healthLogs] = await pool.query(
    `SELECT server_id, connections, memory_mb, uptime, redis_connected, created_at
     FROM health_checks
     WHERE timestamp > ?
     ORDER BY timestamp DESC`,
    [since]
  );

  return { opLogs, healthLogs };
}

async function getStats(pool) {
  const [totals] = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM operation_logs) as total_ops,
      (SELECT COUNT(*) FROM health_checks) as total_health,
      (SELECT COUNT(DISTINCT server_id) FROM health_checks) as servers
  `);

  const [byServer] = await pool.query(`
    SELECT server_id,
           COUNT(*) as ops,
           SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success,
           SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed
    FROM operation_logs
    GROUP BY server_id
  `);

  return { totals: totals[0], byServer };
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

async function runCheck() {
  const timestamp = new Date().toLocaleString('ko-KR');
  console.log('\n' + '='.repeat(60));
  console.log(`  kimdb Cross-Server Check - ${timestamp}`);
  console.log('='.repeat(60));

  // 1. 서버 상태 확인
  console.log('\n[Server Status]');
  for (const server of SERVERS) {
    const result = await checkServer(server);
    if (result.status === 'online') {
      console.log(`  ${server.name}: ONLINE (v${result.version}, ${result.connections} conn, redis:${result.redis})`);
    } else {
      console.log(`  ${server.name}: ${result.status.toUpperCase()} - ${result.error}`);
    }
  }

  // 2. MariaDB 연결 및 로그 분석
  let pool;
  try {
    pool = mysql.createPool(MARIADB_CONFIG);

    const { opLogs, healthLogs } = await getRecentLogs(pool, 3);
    const stats = await getStats(pool);

    console.log('\n[Recent Activity (3min)]');
    if (opLogs.length === 0) {
      console.log('  No operations logged');
    } else {
      const grouped = {};
      opLogs.forEach(log => {
        if (!grouped[log.server_id]) grouped[log.server_id] = [];
        grouped[log.server_id].push(`${log.type}:${log.count}`);
      });
      Object.entries(grouped).forEach(([srv, ops]) => {
        console.log(`  ${srv}: ${ops.join(', ')}`);
      });
    }

    console.log('\n[Health Checks]');
    if (healthLogs.length === 0) {
      console.log('  No health checks in last 3 minutes');
    } else {
      healthLogs.forEach(h => {
        console.log(`  ${h.server_id}: ${h.connections} conn, ${h.memory_mb}MB, uptime ${formatTime(h.uptime * 1000)}, redis:${h.redis_connected}`);
      });
    }

    console.log('\n[Total Statistics]');
    console.log(`  Total operations: ${stats.totals.total_ops}`);
    console.log(`  Total health checks: ${stats.totals.total_health}`);
    console.log(`  Active servers: ${stats.totals.servers}`);

    if (stats.byServer.length > 0) {
      console.log('\n[Per-Server Stats]');
      stats.byServer.forEach(s => {
        const rate = s.ops > 0 ? ((s.success / s.ops) * 100).toFixed(1) : '0';
        console.log(`  ${s.server_id}: ${s.ops} ops (${rate}% success)`);
      });
    }

    await pool.end();
  } catch (e) {
    console.log('\n[MariaDB] Connection failed:', e.message);
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

// 단일 실행 또는 반복 실행
const args = process.argv.slice(2);
if (args.includes('--loop') || args.includes('-l')) {
  console.log('Starting cross-check loop (every 3 minutes)...');
  runCheck();
  setInterval(runCheck, 3 * 60 * 1000);
} else {
  runCheck().then(() => process.exit(0));
}
