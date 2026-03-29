/**
 * kimdb Monitor & Admin API
 * HyperScale 실시간 모니터링
 *
 * 기능:
 * - 8개 샤드 상태 모니터링
 * - 버퍼 크기/플러시 통계
 * - 실시간 대시보드 UI
 * - Health Check API
 */

import { EventEmitter } from 'events';

class KimDBMonitor extends EventEmitter {
  constructor(db) {
    super();
    this.db = db;
    this.history = {
      writes: [],      // 초당 쓰기 수
      flushTimes: [],  // 플러시 소요시간
      bufferSizes: [], // 버퍼 크기 추이
      errors: []       // 에러 로그
    };
    this.maxHistory = 60; // 60초 보관
    this.intervalId = null;
  }

  // 모니터링 시작
  start(intervalMs = 1000) {
    this.intervalId = setInterval(() => {
      this.collect();
    }, intervalMs);

    // DB 이벤트 리스닝
    if (this.db.on) {
      this.db.on('flush', (data) => {
        this.history.flushTimes.push({
          time: Date.now(),
          count: data.count,
          duration: data.time || 0
        });
        this.trimHistory('flushTimes');
      });

      this.db.on('error', (err) => {
        this.history.errors.push({
          time: Date.now(),
          message: err.message
        });
        this.trimHistory('errors');
      });
    }

    console.log('[kimdb] Monitor started');
    return this;
  }

  // 데이터 수집
  collect() {
    const stats = this.db.getStats ? this.db.getStats() : this.db.stats();

    this.history.writes.push({
      time: Date.now(),
      value: stats.bufferedWrites
    });

    this.history.bufferSizes.push({
      time: Date.now(),
      value: stats.bufferSize || 0
    });

    this.trimHistory('writes');
    this.trimHistory('bufferSizes');

    this.emit('stats', stats);
  }

  trimHistory(key) {
    while (this.history[key].length > this.maxHistory) {
      this.history[key].shift();
    }
  }

  // 현재 상태
  getStatus() {
    const stats = this.db.getStats ? this.db.getStats() : this.db.stats();
    const shardStats = this.getShardStats();

    return {
      status: 'healthy',
      version: '7.4.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),

      // 전체 통계
      overview: {
        totalWrites: stats.flushedWrites || 0,
        bufferedWrites: stats.bufferedWrites || 0,
        bufferSize: stats.bufferSize || 0,
        cacheHits: stats.cacheHits || 0,
        cacheMisses: stats.cacheMisses || 0,
        cacheHitRate: stats.cacheHits ?
          ((stats.cacheHits / (stats.cacheHits + stats.cacheMisses)) * 100).toFixed(1) + '%' : '0%'
      },

      // 샤드 상태
      shards: shardStats,

      // WAL 상태
      wal: {
        enabled: stats.safeMode !== false,
        writes: stats.walWrites || 0,
        recovered: stats.recoveredWrites || 0
      },

      // 성능 메트릭
      performance: {
        avgFlushTime: this.getAvgFlushTime(),
        writesPerSecond: this.getWritesPerSecond(),
        peakBufferSize: stats.peakBufferSize || 0
      },

      // 최근 에러
      recentErrors: this.history.errors.slice(-5)
    };
  }

  // 샤드별 상태
  getShardStats() {
    if (!this.db.shards) return [];

    const shardStats = [];
    for (const [index, shard] of this.db.shards) {
      try {
        const tables = shard.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).all();

        let totalRows = 0;
        for (const t of tables) {
          try {
            const count = shard.prepare(`SELECT COUNT(*) as c FROM ${t.name}`).get();
            totalRows += count.c;
          } catch (e) {}
        }

        // DB 파일 크기
        const dbPath = shard.name;

        shardStats.push({
          index,
          status: 'online',
          tables: tables.length,
          rows: totalRows,
          path: dbPath
        });
      } catch (e) {
        shardStats.push({
          index,
          status: 'error',
          error: e.message
        });
      }
    }

    return shardStats;
  }

  getAvgFlushTime() {
    if (this.history.flushTimes.length === 0) return 0;
    const sum = this.history.flushTimes.reduce((a, b) => a + (b.duration || 0), 0);
    return Math.round(sum / this.history.flushTimes.length);
  }

  getWritesPerSecond() {
    if (this.history.writes.length < 2) return 0;
    const recent = this.history.writes.slice(-10);
    if (recent.length < 2) return 0;

    const first = recent[0];
    const last = recent[recent.length - 1];
    const timeDiff = (last.time - first.time) / 1000;
    const writeDiff = last.value - first.value;

    return timeDiff > 0 ? Math.round(writeDiff / timeDiff) : 0;
  }

  // Health Check (간단)
  healthCheck() {
    try {
      // 샤드 하나 테스트
      if (this.db.shards) {
        const shard = this.db.shards.get(0);
        shard.prepare('SELECT 1').get();
      }
      return { status: 'ok', timestamp: new Date().toISOString() };
    } catch (e) {
      return { status: 'error', error: e.message };
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log('[kimdb] Monitor stopped');
  }
}

// ===== Fastify 플러그인 =====
async function monitorPlugin(fastify, options) {
  const { db, prefix = '/kimdb' } = options;
  const monitor = new KimDBMonitor(db).start();

  // Health Check
  fastify.get(`${prefix}/health`, async () => {
    return monitor.healthCheck();
  });

  // 전체 상태
  fastify.get(`${prefix}/status`, async () => {
    return monitor.getStatus();
  });

  // 샤드 상태
  fastify.get(`${prefix}/shards`, async () => {
    return { shards: monitor.getShardStats() };
  });

  // 히스토리 (차트용)
  fastify.get(`${prefix}/history`, async () => {
    return monitor.history;
  });

  // 대시보드 UI
  fastify.get(`${prefix}/dashboard`, async (req, reply) => {
    reply.type('text/html').send(getDashboardHTML(prefix));
  });

  fastify.decorate('kimdbMonitor', monitor);
}

// ===== 대시보드 HTML =====
function getDashboardHTML(prefix) {
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

    .shard-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 16px; }
    .shard {
      background: #0f172a; border-radius: 8px; padding: 12px; text-align: center;
      border: 1px solid #334155;
    }
    .shard.online { border-color: #22c55e; }
    .shard.error { border-color: #ef4444; }
    .shard-index { font-size: 12px; color: #64748b; }
    .shard-rows { font-size: 18px; font-weight: 600; color: #f8fafc; }

    .chart-container { height: 120px; margin-top: 16px; position: relative; }
    .chart { display: flex; align-items: flex-end; height: 100%; gap: 2px; }
    .bar {
      flex: 1; background: #3b82f6; border-radius: 2px 2px 0 0;
      min-height: 2px; transition: height 0.3s;
    }

    .error-list { margin-top: 16px; }
    .error-item {
      background: #450a0a; border-radius: 6px; padding: 10px;
      margin-bottom: 8px; font-size: 13px; border-left: 3px solid #ef4444;
    }
    .error-time { color: #fca5a5; font-size: 11px; }

    .refresh-info { text-align: center; color: #64748b; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🗄️ kimdb HyperScale Monitor</h1>
    <span class="status-badge" id="status">Loading...</span>
  </div>

  <div class="grid">
    <div class="card">
      <div class="card-title">Total Writes</div>
      <div class="card-value" id="totalWrites">-</div>
      <div class="card-sub" id="writesPerSec">- writes/sec</div>
    </div>

    <div class="card">
      <div class="card-title">Buffer Size</div>
      <div class="card-value" id="bufferSize">-</div>
      <div class="card-sub" id="peakBuffer">Peak: -</div>
    </div>

    <div class="card">
      <div class="card-title">Cache Hit Rate</div>
      <div class="card-value" id="cacheHitRate">-</div>
      <div class="card-sub" id="cacheStats">Hits: - / Misses: -</div>
    </div>

    <div class="card">
      <div class="card-title">Avg Flush Time</div>
      <div class="card-value" id="flushTime">-</div>
      <div class="card-sub">milliseconds</div>
    </div>
  </div>

  <div class="card" style="margin-top: 16px;">
    <div class="card-title">Shards Status (${8} shards)</div>
    <div class="shard-grid" id="shards"></div>
  </div>

  <div class="grid" style="margin-top: 16px;">
    <div class="card">
      <div class="card-title">Buffer Size History</div>
      <div class="chart-container">
        <div class="chart" id="bufferChart"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">WAL Status</div>
      <div style="margin-top: 10px;">
        <div>Enabled: <strong id="walEnabled">-</strong></div>
        <div>Writes: <strong id="walWrites">-</strong></div>
        <div>Recovered: <strong id="walRecovered">-</strong></div>
      </div>
    </div>
  </div>

  <div class="card" style="margin-top: 16px;">
    <div class="card-title">Recent Errors</div>
    <div class="error-list" id="errors">No errors</div>
  </div>

  <div class="refresh-info">Auto-refresh every 2 seconds</div>

  <script>
    const prefix = '${prefix}';

    async function fetchStatus() {
      try {
        const res = await fetch(prefix + '/status');
        const data = await res.json();
        updateUI(data);
      } catch (e) {
        document.getElementById('status').textContent = 'Error';
        document.getElementById('status').classList.add('error');
      }
    }

    function updateUI(data) {
      // Status badge
      const statusEl = document.getElementById('status');
      statusEl.textContent = data.status.toUpperCase();
      statusEl.classList.toggle('error', data.status !== 'healthy');

      // Overview
      document.getElementById('totalWrites').textContent = formatNumber(data.overview.totalWrites);
      document.getElementById('writesPerSec').textContent = data.performance.writesPerSecond + ' writes/sec';
      document.getElementById('bufferSize').textContent = formatNumber(data.overview.bufferSize);
      document.getElementById('peakBuffer').textContent = 'Peak: ' + formatNumber(data.performance.peakBufferSize);
      document.getElementById('cacheHitRate').textContent = data.overview.cacheHitRate;
      document.getElementById('cacheStats').textContent =
        'Hits: ' + formatNumber(data.overview.cacheHits) + ' / Misses: ' + formatNumber(data.overview.cacheMisses);
      document.getElementById('flushTime').textContent = data.performance.avgFlushTime + 'ms';

      // WAL
      document.getElementById('walEnabled').textContent = data.wal.enabled ? 'Yes ✅' : 'No';
      document.getElementById('walWrites').textContent = formatNumber(data.wal.writes);
      document.getElementById('walRecovered').textContent = formatNumber(data.wal.recovered);

      // Shards
      const shardsEl = document.getElementById('shards');
      shardsEl.innerHTML = data.shards.map(s => \`
        <div class="shard \${s.status}">
          <div class="shard-index">Shard \${s.index}</div>
          <div class="shard-rows">\${formatNumber(s.rows || 0)}</div>
        </div>
      \`).join('');

      // Errors
      const errorsEl = document.getElementById('errors');
      if (data.recentErrors && data.recentErrors.length > 0) {
        errorsEl.innerHTML = data.recentErrors.map(e => \`
          <div class="error-item">
            <div class="error-time">\${new Date(e.time).toLocaleTimeString()}</div>
            \${e.message}
          </div>
        \`).join('');
      } else {
        errorsEl.innerHTML = '<div style="color: #22c55e;">No errors ✓</div>';
      }
    }

    async function fetchHistory() {
      try {
        const res = await fetch(prefix + '/history');
        const data = await res.json();
        updateChart(data.bufferSizes);
      } catch (e) {}
    }

    function updateChart(bufferSizes) {
      const chart = document.getElementById('bufferChart');
      if (!bufferSizes || bufferSizes.length === 0) {
        chart.innerHTML = '<div style="color: #64748b; text-align: center; width: 100%;">No data yet</div>';
        return;
      }

      const max = Math.max(...bufferSizes.map(b => b.value), 1);
      chart.innerHTML = bufferSizes.slice(-30).map(b => {
        const height = Math.max((b.value / max) * 100, 2);
        return \`<div class="bar" style="height: \${height}%" title="\${b.value}"></div>\`;
      }).join('');
    }

    function formatNumber(n) {
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return String(n);
    }

    // Initial fetch
    fetchStatus();
    fetchHistory();

    // Auto refresh
    setInterval(fetchStatus, 2000);
    setInterval(fetchHistory, 5000);
  </script>
</body>
</html>`;
}

export { KimDBMonitor, monitorPlugin, getDashboardHTML };
export default KimDBMonitor;

console.log('[kimdb] Monitor module loaded');
