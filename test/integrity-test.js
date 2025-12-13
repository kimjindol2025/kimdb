/**
 * kimdb v6.0.0 데이터 무결성 테스트
 * - 1000개 문서 생성
 * - 30분간 읽기/쓰기 반복
 * - 데이터 손실/손상 검증
 */

import WebSocket from 'ws';

const WS_URL = 'ws://127.0.0.1:40000/ws';
const DOC_COUNT = 1000;
const TEST_DURATION = 30 * 60 * 1000; // 30분
const COLLECTION = 'integrity_test';

const stats = {
  writes: 0,
  reads: 0,
  writeSuccess: 0,
  readSuccess: 0,
  dataMatches: 0,
  dataMismatches: 0,
  errors: 0
};

// 검증용 데이터 저장소
const expectedData = new Map();

function createClient() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'subscribe', collection: COLLECTION }));
      resolve(ws);
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('Connection timeout')), 10000);
  });
}

function saveDoc(ws, docId, data) {
  return new Promise((resolve) => {
    const handler = (msg) => {
      try {
        const parsed = JSON.parse(msg);
        if (parsed.docId === docId && (parsed.type === 'doc_saved' || parsed.type === 'doc_created')) {
          ws.off('message', handler);
          resolve({ success: true, data: parsed });
        }
      } catch (e) {}
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({
      type: 'doc_save',
      collection: COLLECTION,
      docId,
      data
    }));
    setTimeout(() => {
      ws.off('message', handler);
      resolve({ success: false });
    }, 5000);
  });
}

function getDoc(ws, docId) {
  return new Promise((resolve) => {
    const handler = (msg) => {
      try {
        const parsed = JSON.parse(msg);
        if (parsed.docId === docId && (parsed.type === 'doc' || parsed.type === 'doc_not_found')) {
          ws.off('message', handler);
          resolve(parsed);
        }
      } catch (e) {}
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({
      type: 'doc_get',
      collection: COLLECTION,
      docId
    }));
    setTimeout(() => {
      ws.off('message', handler);
      resolve({ type: 'timeout' });
    }, 5000);
  });
}

function generateData(docId, version) {
  return {
    id: docId,
    version,
    timestamp: Date.now(),
    checksum: `${docId}_v${version}_${Date.now()}`,
    payload: {
      numbers: Array.from({ length: 10 }, (_, i) => version * 10 + i),
      text: `Document ${docId} version ${version}`,
      nested: {
        a: version,
        b: version * 2,
        c: { d: version * 3 }
      }
    }
  };
}

function verifyData(docId, received, expected) {
  if (!received || !expected) return false;
  if (received.id !== expected.id) return false;
  if (received.version !== expected.version) return false;
  if (received.checksum !== expected.checksum) return false;
  if (JSON.stringify(received.payload) !== JSON.stringify(expected.payload)) return false;
  return true;
}

async function runTest() {
  console.log('\n' + '='.repeat(60));
  console.log('  kimdb v6.0.0 Data Integrity Test');
  console.log('  Documents: ' + DOC_COUNT);
  console.log('  Duration: ' + (TEST_DURATION / 60000) + ' minutes');
  console.log('='.repeat(60) + '\n');

  let ws;
  try {
    // 1. 연결
    console.log('[Phase 1] Connecting...');
    ws = await createClient();
    console.log('  -> Connected\n');

    // 2. 초기 1000개 문서 생성
    console.log('[Phase 2] Creating ' + DOC_COUNT + ' documents...');
    const createStart = Date.now();

    for (let i = 0; i < DOC_COUNT; i++) {
      const docId = 'doc_' + String(i).padStart(4, '0');
      const data = generateData(docId, 1);
      expectedData.set(docId, data);

      const result = await saveDoc(ws, docId, data);
      stats.writes++;
      if (result.success) {
        stats.writeSuccess++;
      } else {
        stats.errors++;
      }

      if ((i + 1) % 100 === 0) {
        process.stdout.write('\r  -> Created: ' + (i + 1) + '/' + DOC_COUNT);
      }
    }

    const createTime = (Date.now() - createStart) / 1000;
    console.log('\n  -> ' + DOC_COUNT + ' documents created in ' + createTime.toFixed(1) + 's');
    console.log('  -> Write success rate: ' + (stats.writeSuccess / stats.writes * 100).toFixed(1) + '%\n');

    // 3. 30분 읽기/쓰기 테스트
    console.log('[Phase 3] Running read/write test for ' + (TEST_DURATION / 60000) + ' minutes...');
    const testStart = Date.now();
    let lastReport = Date.now();
    let iteration = 0;

    while (Date.now() - testStart < TEST_DURATION) {
      iteration++;

      // 랜덤 문서 선택
      const docIndex = Math.floor(Math.random() * DOC_COUNT);
      const docId = 'doc_' + String(docIndex).padStart(4, '0');

      // 50% 확률로 읽기 또는 쓰기
      if (Math.random() < 0.5) {
        // 읽기
        stats.reads++;
        const result = await getDoc(ws, docId);

        if (result.type === 'doc' && result.data) {
          stats.readSuccess++;
          const expected = expectedData.get(docId);
          if (verifyData(docId, result.data, expected)) {
            stats.dataMatches++;
          } else {
            stats.dataMismatches++;
            console.log('\n  [MISMATCH] ' + docId);
            console.log('    Expected version: ' + (expected ? expected.version : 'null'));
            console.log('    Received version: ' + (result.data ? result.data.version : 'null'));
          }
        } else if (result.type === 'doc_not_found') {
          stats.dataMismatches++;
          console.log('\n  [MISSING] ' + docId);
        }
      } else {
        // 쓰기 (버전 업데이트)
        stats.writes++;
        const current = expectedData.get(docId);
        const newVersion = current ? current.version + 1 : 1;
        const newData = generateData(docId, newVersion);

        const result = await saveDoc(ws, docId, newData);
        if (result.success) {
          stats.writeSuccess++;
          expectedData.set(docId, newData);
        } else {
          stats.errors++;
        }
      }

      // 1분마다 진행 상황 보고
      if (Date.now() - lastReport > 60000) {
        const elapsed = Math.floor((Date.now() - testStart) / 60000);
        const remaining = Math.ceil((TEST_DURATION - (Date.now() - testStart)) / 60000);
        console.log('\n  [' + elapsed + 'min] Reads: ' + stats.reads + ', Writes: ' + stats.writes +
                    ', Matches: ' + stats.dataMatches + ', Mismatches: ' + stats.dataMismatches +
                    ', Remaining: ' + remaining + 'min');
        lastReport = Date.now();
      }

      // 약간의 딜레이 (너무 빠른 요청 방지)
      await new Promise(r => setTimeout(r, 10));
    }

    ws.close();

    // 4. 최종 검증
    console.log('\n\n[Phase 4] Final verification...');
    ws = await createClient();

    let finalMatches = 0;
    let finalMismatches = 0;

    for (let i = 0; i < DOC_COUNT; i++) {
      const docId = 'doc_' + String(i).padStart(4, '0');
      const result = await getDoc(ws, docId);
      const expected = expectedData.get(docId);

      if (result.type === 'doc' && result.data && verifyData(docId, result.data, expected)) {
        finalMatches++;
      } else {
        finalMismatches++;
        if (finalMismatches <= 10) {
          console.log('  [FINAL MISMATCH] ' + docId);
        }
      }

      if ((i + 1) % 200 === 0) {
        process.stdout.write('\r  -> Verified: ' + (i + 1) + '/' + DOC_COUNT);
      }
    }

    console.log('\n  -> Final matches: ' + finalMatches + '/' + DOC_COUNT);

    ws.close();

    // 5. 결과
    const totalTime = (Date.now() - testStart) / 60000;
    const totalOps = stats.reads + stats.writes;

    console.log('\n' + '='.repeat(60));
    console.log('  RESULTS');
    console.log('='.repeat(60));

    console.log('\n  [Operations]');
    console.log('    Total: ' + totalOps.toLocaleString());
    console.log('    Reads: ' + stats.reads.toLocaleString() + ' (success: ' + stats.readSuccess.toLocaleString() + ')');
    console.log('    Writes: ' + stats.writes.toLocaleString() + ' (success: ' + stats.writeSuccess.toLocaleString() + ')');
    console.log('    Rate: ' + Math.round(totalOps / (totalTime * 60)) + ' ops/sec');

    console.log('\n  [Data Integrity]');
    console.log('    Runtime matches: ' + stats.dataMatches.toLocaleString());
    console.log('    Runtime mismatches: ' + stats.dataMismatches);
    console.log('    Final verification: ' + finalMatches + '/' + DOC_COUNT);
    console.log('    Errors: ' + stats.errors);

    const integrityRate = (finalMatches / DOC_COUNT * 100).toFixed(2);
    console.log('\n  [Integrity Rate]');
    console.log('    ' + integrityRate + '%');

    console.log('\n' + '='.repeat(60));
    const success = finalMatches >= DOC_COUNT * 0.99 && stats.dataMismatches < DOC_COUNT * 0.01;
    if (success) {
      console.log('  PASSED - Data integrity verified (' + integrityRate + '%)');
    } else {
      console.log('  FAILED - Data integrity issues detected');
      console.log('    - Final mismatches: ' + finalMismatches);
      console.log('    - Runtime mismatches: ' + stats.dataMismatches);
    }
    console.log('='.repeat(60) + '\n');

    process.exit(success ? 0 : 1);

  } catch (e) {
    console.error('\nTest error:', e.message);
    if (ws) ws.close();
    process.exit(1);
  }
}

runTest();
