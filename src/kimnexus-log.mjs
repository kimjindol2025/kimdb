/**
 * KimNexus v9 Log SDK (ESM Version)
 * 중앙 로그 서버로 로그를 전송하는 클라이언트 라이브러리
 *
 * 사용법:
 *   import { createLogger } from './kimnexus-log.mjs';
 *   const log = createLogger('my-project', '253');
 *   log.info('서버 시작됨');
 */

import http from 'http';

const LOG_SERVER = process.env.LOG_SERVER || '192.168.45.73';
const LOG_PORT = process.env.LOG_PORT || 50100;

class KimNexusLogger {
  constructor(projectId, server = '') {
    this.pid = projectId;
    this.srv = server;
    this.queue = [];
    this.flushInterval = null;
    this.batchSize = 10;
    this.flushDelay = 1000;

    this._startBatching();
  }

  _generateTid() {
    return 'tx-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }

  async _send(logData) {
    return new Promise((resolve) => {
      const data = JSON.stringify(logData);

      const options = {
        hostname: LOG_SERVER,
        port: LOG_PORT,
        path: '/log',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: 3000
      };

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve(JSON.parse(body || '{}')));
      });

      req.on('error', (e) => {
        console.error('[KimNexus] Log send failed:', e.message);
        resolve({ success: false });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false });
      });

      req.write(data);
      req.end();
    });
  }

  async _sendBatch(logs) {
    if (logs.length === 0) return;

    return new Promise((resolve) => {
      const data = JSON.stringify(logs);

      const options = {
        hostname: LOG_SERVER,
        port: LOG_PORT,
        path: '/logs',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: 5000
      };

      const req = http.request(options, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve());
      });

      req.on('error', () => resolve());
      req.on('timeout', () => { req.destroy(); resolve(); });

      req.write(data);
      req.end();
    });
  }

  _startBatching() {
    this.flushInterval = setInterval(() => {
      if (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.batchSize);
        this._sendBatch(batch);
      }
    }, this.flushDelay);

    process.on('beforeExit', () => this.flush());
  }

  async flush() {
    if (this.queue.length > 0) {
      await this._sendBatch(this.queue);
      this.queue = [];
    }
  }

  _log(level, message, meta = {}, tags = []) {
    const logData = {
      v: 9,
      pid: this.pid,
      lvl: level,
      msg: message,
      ts: new Date().toISOString(),
      srv: this.srv,
      tid: this._generateTid(),
      tag: tags,
      meta: meta
    };

    if (level === 'error') {
      this._send(logData);
    } else {
      this.queue.push(logData);
    }

    return logData.tid;
  }

  info(message, meta = {}, tags = []) {
    return this._log('info', message, meta, tags);
  }

  warn(message, meta = {}, tags = []) {
    return this._log('warn', message, meta, tags);
  }

  error(message, meta = {}, tags = []) {
    if (meta instanceof Error) {
      meta = {
        name: meta.name,
        message: meta.message,
        stack: meta.stack
      };
    }
    return this._log('error', message, meta, tags);
  }

  debug(message, meta = {}, tags = []) {
    return this._log('debug', message, meta, tags);
  }

  log(level, message, meta = {}, tags = []) {
    return this._log(level, message, meta, tags);
  }

  withTrace(tid) {
    const self = this;
    return {
      info: (msg, meta, tags) => self._logWithTid(tid, 'info', msg, meta, tags),
      warn: (msg, meta, tags) => self._logWithTid(tid, 'warn', msg, meta, tags),
      error: (msg, meta, tags) => self._logWithTid(tid, 'error', msg, meta, tags),
      debug: (msg, meta, tags) => self._logWithTid(tid, 'debug', msg, meta, tags)
    };
  }

  _logWithTid(tid, level, message, meta = {}, tags = []) {
    const logData = {
      v: 9,
      pid: this.pid,
      lvl: level,
      msg: message,
      ts: new Date().toISOString(),
      srv: this.srv,
      tid: tid,
      tag: tags,
      meta: meta
    };

    if (level === 'error') {
      this._send(logData);
    } else {
      this.queue.push(logData);
    }

    return tid;
  }
}

export function createLogger(projectId, server = '') {
  return new KimNexusLogger(projectId, server);
}

export { KimNexusLogger };
export default createLogger;
