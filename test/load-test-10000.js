/**
 * kimdb v5.1.0 부하 테스트
 * 10,000명 동시 접속 시뮬레이션
 */

import WebSocket from 'ws';

const WS_URL = 'ws://127.0.0.1:40000/ws';
const TOTAL_CLIENTS = 10000;
const TEST_DURATION = 15000; // 15초
const BATCH_SIZE = 500; // 연결 배치 크기
const BATCH_DELAY = 200; // 배치 간 딜레이

const stats = {
  connected: 0,
  disconnected: 0,
  connectionFailed: 0,
  messagesSent: 0,
  messagesReceived: 0,
  errors: 0,
  presenceJoins: 0,
  presenceUpdates: 0,
  undoCaptures: 0,
  latencies: [],
  connectTimes: []
};

const clients = [];

function createClient(id) {
  return new Promise((resolve) => {
    const connectStart = Date.now();
    const ws = new WebSocket(WS_URL, {
      perMessageDeflate: false,
      maxPayload: 1024 * 1024
    });
    const client = { id, ws, connected: false };

    const timeout = setTimeout(() => {
      if (!client.connected) {
        ws.terminate();
        stats.connectionFailed++;
        resolve(null);
      }
    }, 10000);

    ws.on('open', () => {
      client.connected = true;
      stats.connected++;
      stats.connectTimes.push(Date.now() - connectStart);
      clearTimeout(timeout);

      // Subscribe
      ws.send(JSON.stringify({ type: 'subscribe', collection: 'load_test_10k' }));
      stats.messagesSent++;

      clients.push(client);
      resolve(client);
    });

    ws.on('message', (data) => {
      stats.messagesReceived++;
      try {
        const msg = JSON.parse(data);

        if (msg.type === 'presence_join_ok') {
          stats.presenceJoins++;
        } else if (msg.type === 'presence_updated' || msg.type === 'presence_cursor_moved') {
          stats.presenceUpdates++;
        } else if (msg.type === 'undo_capture_ok') {
          stats.undoCaptures++;
        } else if (msg.type === 'pong') {
          const latency = Date.now() - msg.time;
          stats.latencies.push(latency);
        }
      } catch (e) {
        // JSON 파싱 에러 무시
      }
    });

    ws.on('error', () => {
      stats.errors++;
    });

    ws.on('close', () => {
      stats.disconnected++;
      client.connected = false;
    });
  });
}

function formatNumber(n) {
  return n.toLocaleString();
}

async function runLoadTest() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  kimdb v5.1.0 Load Test - ${formatNumber(TOTAL_CLIENTS)} Clients`);
  console.log(`${'='.repeat(60)}\n`);

  const startTime = Date.now();

  // 1. 클라이언트 10,000개 생성 (배치로)
  console.log(`[Phase 1] Creating ${formatNumber(TOTAL_CLIENTS)} connections (batch: ${BATCH_SIZE})...`);
  const connectStart = Date.now();

  for (let batch = 0; batch < Math.ceil(TOTAL_CLIENTS / BATCH_SIZE); batch++) {
    const batchStart = batch * BATCH_SIZE;
    const batchEnd = Math.min(batchStart + BATCH_SIZE, TOTAL_CLIENTS);
    const batchPromises = [];

    for (let i = batchStart; i < batchEnd; i++) {
      batchPromises.push(createClient(i));
    }

    await Promise.allSettled(batchPromises);

    const progress = ((batchEnd / TOTAL_CLIENTS) * 100).toFixed(0);
    const elapsed = ((Date.now() - connectStart) / 1000).toFixed(1);
    process.stdout.write(`\r  Progress: ${progress}% (${formatNumber(stats.connected)} connected, ${elapsed}s)`);

    // 배치 간 딜레이
    if (batchEnd < TOTAL_CLIENTS) {
      await new Promise(r => setTimeout(r, BATCH_DELAY));
    }
  }

  const connectTime = Date.now() - connectStart;
  console.log(`\n  → ${formatNumber(stats.connected)}/${formatNumber(TOTAL_CLIENTS)} connected in ${(connectTime/1000).toFixed(1)}s`);
  console.log(`  → ${formatNumber(stats.connectionFailed)} connection failures`);
  console.log(`  → Rate: ${(stats.connected / (connectTime / 1000)).toFixed(0)} connections/sec`);

  if (stats.connectTimes.length > 0) {
    stats.connectTimes.sort((a, b) => a - b);
    const avgConnect = stats.connectTimes.reduce((a, b) => a + b, 0) / stats.connectTimes.length;
    console.log(`  → Avg connect time: ${avgConnect.toFixed(0)}ms`);
  }

  const successRate = (stats.connected / TOTAL_CLIENTS * 100).toFixed(1);
  if (stats.connected < TOTAL_CLIENTS * 0.8) {
    console.error(`\n  ✗ Connection success rate too low: ${successRate}%`);
    process.exit(1);
  }

  // 2. Presence Join (샘플링 - 1000명만)
  const presenceSample = Math.min(1000, clients.length);
  console.log(`\n[Phase 2] Presence join (sample: ${formatNumber(presenceSample)} clients)...`);
  const presenceStart = Date.now();

  for (let i = 0; i < presenceSample; i++) {
    const client = clients[i];
    if (client && client.connected) {
      client.ws.send(JSON.stringify({
        type: 'presence_join',
        collection: 'load_test_10k',
        docId: 'stress_doc',
        user: { name: `User${client.id}`, color: `hsl(${(client.id * 36) % 360}, 70%, 50%)` }
      }));
      stats.messagesSent++;
    }
  }

  await new Promise(r => setTimeout(r, 2000));
  const presenceTime = Date.now() - presenceStart;
  console.log(`  → ${formatNumber(stats.presenceJoins)} presence joins in ${(presenceTime/1000).toFixed(1)}s`);

  // 3. 동시 작업 시뮬레이션
  console.log(`\n[Phase 3] Concurrent operations (${TEST_DURATION/1000}s)...`);
  const opsStart = Date.now();
  let opsCount = 0;
  let intervalCount = 0;

  const operationInterval = setInterval(() => {
    intervalCount++;
    let batchOps = 0;

    // 각 클라이언트 중 일부만 작업 수행 (10%씩)
    const sampleSize = Math.min(1000, clients.length);
    const offset = (intervalCount * 100) % clients.length;

    for (let i = 0; i < sampleSize; i++) {
      const idx = (offset + i) % clients.length;
      const client = clients[idx];
      if (!client || !client.connected) continue;

      const action = Math.random();

      try {
        if (action < 0.4) {
          // Ping (latency 측정) (40%)
          client.ws.send(JSON.stringify({ type: 'ping', time: Date.now() }));
        } else if (action < 0.6) {
          // Cursor 업데이트 (20%)
          client.ws.send(JSON.stringify({
            type: 'presence_cursor',
            collection: 'load_test_10k',
            docId: 'stress_doc',
            position: Math.floor(Math.random() * 1000)
          }));
        } else if (action < 0.75) {
          // Undo capture (15%)
          client.ws.send(JSON.stringify({
            type: 'undo_capture',
            collection: 'load_test_10k',
            docId: 'stress_doc',
            op: { type: 'map_set', path: ['f' + client.id], value: Math.random() }
          }));
        }
        // 25% idle

        batchOps++;
        stats.messagesSent++;
      } catch (e) {
        // 전송 실패 무시
      }
    }

    opsCount += batchOps;
  }, 100); // 100ms마다

  // 진행 상황 표시
  const progressInterval = setInterval(() => {
    const elapsed = ((Date.now() - opsStart) / 1000).toFixed(0);
    const rate = (stats.messagesReceived / (Date.now() - startTime) * 1000).toFixed(0);
    process.stdout.write(`\r  Ops: ${formatNumber(opsCount)}, Recv: ${formatNumber(stats.messagesReceived)}, Rate: ${formatNumber(parseInt(rate))}/s, Time: ${elapsed}s`);
  }, 1000);

  await new Promise(r => setTimeout(r, TEST_DURATION));
  clearInterval(operationInterval);
  clearInterval(progressInterval);

  const opsTime = Date.now() - opsStart;
  console.log(`\n  → ${formatNumber(opsCount)} operations in ${(opsTime/1000).toFixed(1)}s`);
  console.log(`  → ${formatNumber(Math.round(opsCount / (opsTime / 1000)))} ops/sec`);

  // 4. 정리
  console.log(`\n[Phase 4] Cleanup...`);
  const closeStart = Date.now();

  // 배치로 종료
  for (let i = 0; i < clients.length; i += 1000) {
    const batch = clients.slice(i, i + 1000);
    batch.forEach(c => {
      if (c && c.connected) {
        c.ws.close();
      }
    });
    await new Promise(r => setTimeout(r, 100));
  }

  await new Promise(r => setTimeout(r, 2000));
  console.log(`  → Cleanup completed in ${((Date.now() - closeStart)/1000).toFixed(1)}s`);

  // 5. 결과
  const totalTime = Date.now() - startTime;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  RESULTS`);
  console.log(`${'='.repeat(60)}`);

  console.log(`\n  Total time: ${(totalTime/1000).toFixed(1)}s`);

  console.log(`\n  [Connections]`);
  console.log(`    Target:     ${formatNumber(TOTAL_CLIENTS)}`);
  console.log(`    Connected:  ${formatNumber(stats.connected)} (${(stats.connected/TOTAL_CLIENTS*100).toFixed(1)}%)`);
  console.log(`    Failed:     ${formatNumber(stats.connectionFailed)}`);
  console.log(`    Errors:     ${formatNumber(stats.errors)}`);

  console.log(`\n  [Messages]`);
  console.log(`    Sent:       ${formatNumber(stats.messagesSent)}`);
  console.log(`    Received:   ${formatNumber(stats.messagesReceived)}`);
  console.log(`    Throughput: ${formatNumber(Math.round(stats.messagesReceived / (totalTime / 1000)))} msg/sec`);

  console.log(`\n  [Features]`);
  console.log(`    Presence:   ${formatNumber(stats.presenceJoins)} joins, ${formatNumber(stats.presenceUpdates)} updates`);
  console.log(`    Undo:       ${formatNumber(stats.undoCaptures)} captures`);

  if (stats.latencies.length > 0) {
    stats.latencies.sort((a, b) => a - b);
    const avg = stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length;
    const p50 = stats.latencies[Math.floor(stats.latencies.length * 0.5)];
    const p95 = stats.latencies[Math.floor(stats.latencies.length * 0.95)];
    const p99 = stats.latencies[Math.floor(stats.latencies.length * 0.99)];
    const max = stats.latencies[stats.latencies.length - 1];

    console.log(`\n  [Latency] (${formatNumber(stats.latencies.length)} samples)`);
    console.log(`    Avg:  ${avg.toFixed(1)}ms`);
    console.log(`    P50:  ${p50}ms`);
    console.log(`    P95:  ${p95}ms`);
    console.log(`    P99:  ${p99}ms`);
    console.log(`    Max:  ${max}ms`);
  }

  // 성공 기준
  const connectionSuccess = stats.connected >= TOTAL_CLIENTS * 0.9;
  const lowErrors = stats.errors < TOTAL_CLIENTS * 0.1;
  const success = connectionSuccess && lowErrors;

  console.log(`\n${'='.repeat(60)}`);
  if (success) {
    console.log(`  ✓ PASSED - ${formatNumber(TOTAL_CLIENTS)} concurrent connections handled`);
  } else {
    console.log(`  ✗ FAILED`);
    if (!connectionSuccess) console.log(`    - Connection rate below 90%`);
    if (!lowErrors) console.log(`    - Error rate above 10%`);
  }
  console.log(`${'='.repeat(60)}\n`);

  process.exit(success ? 0 : 1);
}

// 시스템 리소스 제한 확인
console.log('\n[System Check]');
console.log('  Checking ulimit for file descriptors...');

import { execSync } from 'child_process';
try {
  const ulimit = execSync('ulimit -n').toString().trim();
  console.log(`  Current ulimit -n: ${ulimit}`);
  if (parseInt(ulimit) < TOTAL_CLIENTS * 2) {
    console.log(`  ⚠ Warning: ulimit may be too low for ${formatNumber(TOTAL_CLIENTS)} connections`);
    console.log(`  Run: ulimit -n ${TOTAL_CLIENTS * 2}`);
  }
} catch (e) {
  console.log('  Could not check ulimit');
}

runLoadTest().catch(e => {
  console.error('Load test error:', e);
  process.exit(1);
});
