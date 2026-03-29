/**
 * kimdb 동시 쓰기 개선 모듈
 * v6.0.0 호환
 */

// ===== Write Queue (동시 쓰기 직렬화) =====
const writeQueue = [];
let isProcessingQueue = false;

export async function enqueueWrite(db, operation) {
  return new Promise((resolve, reject) => {
    writeQueue.push({ db, operation, resolve, reject });
    processWriteQueue();
  });
}

async function processWriteQueue() {
  if (isProcessingQueue || writeQueue.length === 0) return;
  
  isProcessingQueue = true;
  
  while (writeQueue.length > 0) {
    const { db, operation, resolve, reject } = writeQueue.shift();
    
    try {
      const result = await executeWithRetry(db, operation);
      resolve(result);
    } catch (e) {
      reject(e);
    }
  }
  
  isProcessingQueue = false;
}

// ===== Retry Logic =====
const MAX_RETRIES = 3;
const RETRY_DELAY = 50;

async function executeWithRetry(db, operation, retries = 0) {
  try {
    return operation(db);
  } catch (e) {
    if (e.code === 'SQLITE_BUSY' && retries < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, RETRY_DELAY * (retries + 1)));
      return executeWithRetry(db, operation, retries + 1);
    }
    throw e;
  }
}

// ===== Read Pool =====
export function createReadPool(Database, dbPath, size = 4) {
  const pool = [];
  for (let i = 0; i < size; i++) {
    const readDb = new Database(dbPath, { readonly: true });
    readDb.pragma('cache_size = 5000');
    readDb.pragma('mmap_size = 268435456');
    pool.push({ db: readDb, busy: false });
  }
  return pool;
}

export function acquireReader(pool) {
  const conn = pool.find(c => !c.busy);
  if (conn) {
    conn.busy = true;
    return conn;
  }
  return pool[0];
}

export function releaseReader(conn) {
  conn.busy = false;
}

// ===== Batch Operations =====
export function runBatch(db, operations) {
  return enqueueWrite(db, (db) => {
    const tx = db.transaction(() => {
      const results = [];
      for (const op of operations) {
        results.push(op(db));
      }
      return results;
    });
    return tx();
  });
}

export function getQueueLength() {
  return writeQueue.length;
}

export function getQueueStatus() {
  return {
    pending: writeQueue.length,
    processing: isProcessingQueue
  };
}

// ===== 트랜잭션 큐 시스템 =====
// PostgreSQL처럼 여러 트랜잭션 동시 처리 시뮬레이션

class TransactionManager {
  constructor(db) {
    this.db = db;
    this.queue = [];
    this.processing = false;
    this.activeCount = 0;
    this.maxConcurrent = 1; // SQLite 제한
    this.stats = { total: 0, success: 0, failed: 0, retries: 0 };
  }

  // 트랜잭션 실행 (자동 큐잉)
  async execute(operations, options = {}) {
    const { timeout = 30000, retries = 3 } = options;
    const txId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    
    return new Promise((resolve, reject) => {
      const task = {
        id: txId,
        operations,
        resolve,
        reject,
        retries,
        retriesLeft: retries,
        createdAt: Date.now(),
        timeout
      };
      
      this.queue.push(task);
      this.stats.total++;
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      
      // 타임아웃 체크
      if (Date.now() - task.createdAt > task.timeout) {
        task.reject(new Error('Transaction timeout'));
        this.stats.failed++;
        continue;
      }
      
      try {
        const result = await this.runTransaction(task.operations);
        task.resolve(result);
        this.stats.success++;
      } catch (e) {
        if (e.code === 'SQLITE_BUSY' && task.retriesLeft > 0) {
          task.retriesLeft--;
          this.stats.retries++;
          // 재시도를 위해 큐 앞에 다시 추가
          await new Promise(r => setTimeout(r, 50 * (task.retries - task.retriesLeft)));
          this.queue.unshift(task);
        } else {
          task.reject(e);
          this.stats.failed++;
        }
      }
    }
    
    this.processing = false;
  }

  runTransaction(operations) {
    const tx = this.db.transaction(() => {
      const results = [];
      for (const op of operations) {
        if (typeof op === 'function') {
          results.push(op(this.db));
        } else if (op.sql) {
          const stmt = this.db.prepare(op.sql);
          results.push(op.params ? stmt.run(...op.params) : stmt.run());
        }
      }
      return results;
    });
    return tx();
  }

  // Savepoint 지원 (중첩 트랜잭션)
  async executeWithSavepoint(name, operations) {
    return this.execute([
      { sql: `SAVEPOINT ${name}` },
      ...operations,
      { sql: `RELEASE SAVEPOINT ${name}` }
    ]);
  }

  // 롤백 (수동)
  rollbackTo(name) {
    this.db.exec(`ROLLBACK TO SAVEPOINT ${name}`);
  }

  getStats() {
    return {
      ...this.stats,
      queueLength: this.queue.length,
      processing: this.processing
    };
  }
}

export { TransactionManager };

// ===== 간편 사용 함수 =====
let defaultManager = null;

export function initTransactionManager(db) {
  defaultManager = new TransactionManager(db);
  return defaultManager;
}

export function getTransactionManager() {
  return defaultManager;
}

// 예약 생성 같은 복합 작업용
export async function runAtomicOperations(db, operations, options) {
  const manager = defaultManager || new TransactionManager(db);
  return manager.execute(operations, options);
}

console.log('[kimdb] Transaction Manager loaded');
