/**
 * kimdb Server
 *
 * 메인 서버 진입점
 */

// KimNexus v9 Central Log
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nexusLog = require('../../../kimnexus-log.js')('kimdb', '253');

import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import crypto from 'crypto';
import { loadConfig, logConfig, type Config } from './config.js';
import { KimDatabase } from './database.js';
import {
  VectorClock,
  CRDTDocument,
  UndoManager,
  PresenceManager,
  LWWMap,
} from '../crdt/index.js';

const VERSION = '7.0.0';

// ===== LRU Cache =====
class LRUCache<T> {
  private maxSize: number;
  private cache = new Map<string, T>();
  private accessTime = new Map<string, number>();

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: string): T | null {
    if (this.cache.has(key)) {
      this.accessTime.set(key, Date.now());
      return this.cache.get(key)!;
    }
    return null;
  }

  set(key: string, value: T): void {
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictOldest();
    }
    this.cache.set(key, value);
    this.accessTime.set(key, Date.now());
  }

  delete(key: string): void {
    this.cache.delete(key);
    this.accessTime.delete(key);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, time] of this.accessTime) {
      if (time < oldestTime) {
        oldestTime = time;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.accessTime.delete(oldestKey);
    }
  }

  get size(): number {
    return this.cache.size;
  }

  keys(): IterableIterator<string> {
    return this.cache.keys();
  }

  cleanup(ttl: number, onEvict?: (key: string, value: T) => void): number {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [key, time] of this.accessTime) {
      if (now - time > ttl) {
        if (onEvict) {
          const value = this.cache.get(key);
          if (value) onEvict(key, value);
        }
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      this.cache.delete(key);
      this.accessTime.delete(key);
    }

    return toDelete.length;
  }
}

// ===== Server Class =====
export class KimDBServer {
  private config: Config;
  private db: KimDatabase;
  private fastify: ReturnType<typeof Fastify>;

  // State
  private clients = new Map<string, {
    socket: WebSocket;
    subscriptions: Set<string>;
    docSubscriptions: Set<string>;
    connectedAt: number;
  }>();
  private subscriptions = new Map<string, Set<string>>();
  private docSubscriptions = new Map<string, Set<string>>();
  private crdtDocs: LRUCache<CRDTDocument>;
  private presenceManagers = new Map<string, { pm: PresenceManager; lastAccess: number }>();
  private clientPresence = new Map<string, { collection: string; docId: string; nodeId: string }>();
  private clientUndoManagers = new Map<string, { um: UndoManager; lastAccess: number }>();

  // Metrics
  private metrics = {
    startTime: Date.now(),
    requests: { total: 0, success: 0, error: 0 },
    websocket: {
      connections: 0,
      peak: 0,
      messages: { sent: 0, received: 0 },
      broadcasts: 0,
    },
    sync: { operations: 0, conflicts: 0 },
    cache: { hits: 0, misses: 0, evictions: 0 },
    presence: { joins: 0, leaves: 0, updates: 0 },
    undo: { captures: 0, undos: 0, redos: 0 },
  };

  // Cleanup timers
  private cleanupTimer?: NodeJS.Timeout;
  private checkpointTimer?: NodeJS.Timeout;

  constructor(config?: Partial<Config>) {
    this.config = config ? { ...loadConfig(), ...config } : loadConfig();
    this.db = new KimDatabase(this.config);
    this.crdtDocs = new LRUCache(this.config.cache.maxDocs);
    this.fastify = Fastify({ logger: false, trustProxy: true, bodyLimit: 10 * 1024 * 1024 });
  }

  private generateClientId(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  private getCRDTDoc(collection: string, docId: string): CRDTDocument {
    const key = `${collection}:${docId}`;

    let doc = this.crdtDocs.get(key);
    if (doc) {
      this.metrics.cache.hits++;
      return doc;
    }

    this.metrics.cache.misses++;

    const row = this.db.getDocument(collection, docId);
    if (row?.crdt_state) {
      try {
        doc = CRDTDocument.fromJSON(JSON.parse(row.crdt_state));
      } catch {
        doc = new CRDTDocument(this.config.serverId, docId);
      }
    } else {
      doc = new CRDTDocument(this.config.serverId, docId);
    }

    this.crdtDocs.set(key, doc);
    return doc;
  }

  private saveCRDTToDB(collection: string, docId: string, doc: CRDTDocument): void {
    try {
      const state = JSON.stringify(doc.toJSON());
      const data = JSON.stringify(doc.toObject());
      this.db.saveDocument(collection, docId, data, state);
    } catch (e) {
      console.error('[kimdb] Save CRDT error:', e);
    }
  }

  private getPresenceManager(collection: string, docId: string): PresenceManager {
    const key = `${collection}:${docId}`;
    let entry = this.presenceManagers.get(key);

    if (!entry) {
      entry = {
        pm: new PresenceManager(`server_${this.config.serverId}`, {
          heartbeatInterval: 10000,
          timeout: this.config.cache.presenceTTL,
        }),
        lastAccess: Date.now(),
      };
      this.presenceManagers.set(key, entry);
    } else {
      entry.lastAccess = Date.now();
    }

    return entry.pm;
  }

  private getClientUndoManager(clientId: string, collection: string, docId: string): UndoManager {
    const key = `${clientId}:${collection}:${docId}`;
    let entry = this.clientUndoManagers.get(key);

    if (!entry) {
      entry = {
        um: new UndoManager({ maxHistory: 100, captureTimeout: 500 }),
        lastAccess: Date.now(),
      };
      this.clientUndoManagers.set(key, entry);
    } else {
      entry.lastAccess = Date.now();
    }

    return entry.um;
  }

  private localBroadcast(collection: string, event: string, data: unknown, excludeClientId: string | null): number {
    const subs = this.subscriptions.get(collection);
    if (!subs) return 0;

    const msg = JSON.stringify({ type: 'sync', event, ...data as object });
    let count = 0;

    for (const clientId of subs) {
      if (clientId === excludeClientId) continue;
      const client = this.clients.get(clientId);
      if (client && client.socket.readyState === 1) {
        client.socket.send(msg);
        count++;
      }
    }

    this.metrics.websocket.broadcasts++;
    return count;
  }

  private localBroadcastToDoc(collection: string, docId: string, msgObj: unknown, excludeClientId: string | null): number {
    const key = `${collection}:${docId}`;
    const subs = this.docSubscriptions.get(key) || this.subscriptions.get(collection);
    if (!subs) return 0;

    const msg = JSON.stringify(msgObj);
    let count = 0;

    for (const clientId of subs) {
      if (clientId === excludeClientId) continue;
      const client = this.clients.get(clientId);
      if (client && client.socket.readyState === 1) {
        client.socket.send(msg);
        count++;
      }
    }

    return count;
  }

  private broadcastOp(collection: string, docId: string, operations: unknown[], excludeClientId: string | null): void {
    const msg = {
      type: 'crdt_sync',
      collection,
      docId,
      operations,
      serverTime: Date.now(),
    };

    this.localBroadcastToDoc(collection, docId, msg, excludeClientId);
  }

  private requireAuth(req: { headers: Record<string, string | undefined> }): boolean {
    const key = req.headers['x-api-key'] || req.headers.authorization?.replace('Bearer ', '');
    return key === this.config.apiKey;
  }

  private handleClientDisconnect(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    for (const col of client.subscriptions) {
      this.subscriptions.get(col)?.delete(clientId);
    }

    for (const key of client.docSubscriptions) {
      this.docSubscriptions.get(key)?.delete(clientId);
    }

    // Presence cleanup
    const presence = this.clientPresence.get(clientId);
    if (presence) {
      const pm = this.presenceManagers.get(`${presence.collection}:${presence.docId}`);
      if (pm) {
        pm.pm.users.delete(presence.nodeId);
      }

      this.localBroadcastToDoc(presence.collection, presence.docId, {
        type: 'presence_left',
        collection: presence.collection,
        docId: presence.docId,
        nodeId: presence.nodeId,
        timestamp: Date.now(),
      }, clientId);

      this.clientPresence.delete(clientId);
      this.metrics.presence.leaves++;
    }

    this.clients.delete(clientId);
    this.metrics.websocket.connections--;
  }

  private runCleanup(): void {
    const now = Date.now();

    // Cleanup old CRDT docs
    this.crdtDocs.cleanup(this.config.cache.docTTL, (key, doc) => {
      const [collection, docId] = key.split(':');
      this.saveCRDTToDB(collection, docId, doc);
    });

    // Cleanup presence managers
    for (const [key, entry] of this.presenceManagers) {
      if (now - entry.lastAccess > this.config.cache.presenceTTL * 2) {
        this.presenceManagers.delete(key);
      } else {
        entry.pm.cleanup();
      }
    }

    // Cleanup undo managers
    for (const [key, entry] of this.clientUndoManagers) {
      if (now - entry.lastAccess > this.config.cache.undoTTL) {
        this.clientUndoManagers.delete(key);
      }
    }
  }

  async start(): Promise<void> {
    console.log(`[kimdb] v${VERSION} initializing...`);
    logConfig(this.config);

    // CORS
    await this.fastify.register(cors, {
      origin: this.config.cors.origins.includes('*') ? true : this.config.cors.origins,
      credentials: this.config.cors.credentials,
    });

    // WebSocket
    await this.fastify.register(websocket, {
      options: { maxPayload: 1024 * 1024, perMessageDeflate: false },
    });

    // Request hooks
    this.fastify.addHook('onRequest', async () => {
      this.metrics.requests.total++;
    });

    this.fastify.addHook('onResponse', async (_, reply) => {
      if (reply.statusCode < 400) {
        this.metrics.requests.success++;
      } else {
        this.metrics.requests.error++;
      }
    });

    // Register routes
    this.registerRoutes();
    this.registerWebSocket();

    // Cleanup timers
    this.cleanupTimer = setInterval(() => this.runCleanup(), this.config.cache.cleanupInterval);
    this.checkpointTimer = setInterval(() => this.db.checkpoint(), 10 * 60 * 1000);

    // Start server
    await this.fastify.listen({ port: this.config.port, host: this.config.host });
    console.log(`[kimdb] v${VERSION} running on http://${this.config.host}:${this.config.port}`);
    console.log(`[kimdb] WebSocket: ws://${this.config.host}:${this.config.port}/ws`);

    // KimNexus 관제소 보고
    nexusLog.info('System Integrated', { version: VERSION, port: this.config.port }, ['startup']);
  }

  private registerRoutes(): void {
    // Health
    this.fastify.get('/health', async () => ({
      status: 'ok',
      version: VERSION,
      serverId: this.config.serverId,
      uptime: Math.floor((Date.now() - this.metrics.startTime) / 1000),
      connections: this.metrics.websocket.connections,
    }));

    // Metrics
    this.fastify.get('/api/metrics', async () => ({
      success: true,
      version: VERSION,
      serverId: this.config.serverId,
      uptime_seconds: Math.floor((Date.now() - this.metrics.startTime) / 1000),
      ...this.metrics,
      memory: {
        cachedDocs: this.crdtDocs.size,
        presenceManagers: this.presenceManagers.size,
        undoManagers: this.clientUndoManagers.size,
        heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      },
    }));

    // Collections
    this.fastify.get('/api/collections', async () => {
      const collections = this.db.getCollections();
      return { success: true, collections: collections.map((c) => c.name) };
    });

    // Collection documents
    this.fastify.get('/api/c/:collection', async (req) => {
      const rows = this.db.getDocuments((req.params as { collection: string }).collection);
      return {
        success: true,
        collection: (req.params as { collection: string }).collection,
        count: rows.length,
        data: rows.map((r) => ({ id: r.id, ...JSON.parse(r.data), _version: r._version })),
      };
    });

    // Single document
    this.fastify.get('/api/c/:collection/:id', async (req, reply) => {
      const params = req.params as { collection: string; id: string };
      const row = this.db.getDocument(params.collection, params.id);
      if (!row) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return { success: true, id: row.id, data: JSON.parse(row.data), _version: row._version };
    });

    // SQL API
    this.fastify.post('/api/sql', async (req, reply) => {
      const body = req.body as { sql: string; params?: unknown[]; collection: string };
      const { sql, params: sqlParams = [], collection } = body;

      if (!sql) return reply.code(400).send({ error: 'sql is required' });
      if (!collection) return reply.code(400).send({ error: 'collection is required' });

      try {
        const result = this.executeSQL(sql, sqlParams, collection);
        return { success: true, ...result };
      } catch (e) {
        return reply.code(500).send({ error: (e as Error).message });
      }
    });
  }

  private registerWebSocket(): void {
    this.fastify.register(async (fastify) => {
      fastify.get('/ws', { websocket: true }, (socket) => {
        const clientId = this.generateClientId();
        this.clients.set(clientId, {
          socket: socket as unknown as WebSocket,
          subscriptions: new Set(),
          docSubscriptions: new Set(),
          connectedAt: Date.now(),
        });

        this.metrics.websocket.connections++;
        if (this.metrics.websocket.connections > this.metrics.websocket.peak) {
          this.metrics.websocket.peak = this.metrics.websocket.connections;
        }

        socket.send(JSON.stringify({
          type: 'connected',
          clientId,
          serverId: this.config.serverId,
        }));

        socket.on('message', (raw: Buffer) => {
          try {
            const msg = JSON.parse(raw.toString());
            this.metrics.websocket.messages.received++;
            this.handleWebSocketMessage(clientId, socket as unknown as WebSocket, msg);
          } catch (e) {
            socket.send(JSON.stringify({ type: 'error', message: (e as Error).message }));
          }
        });

        socket.on('close', () => this.handleClientDisconnect(clientId));
        socket.on('error', () => this.handleClientDisconnect(clientId));
      });
    });
  }

  private handleWebSocketMessage(clientId: string, socket: WebSocket, msg: { type: string; [key: string]: unknown }): void {
    const send = (data: unknown) => {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify(data));
        this.metrics.websocket.messages.sent++;
      }
    };

    switch (msg.type) {
      case 'subscribe': {
        const col = msg.collection as string;
        if (!this.subscriptions.has(col)) this.subscriptions.set(col, new Set());
        this.subscriptions.get(col)!.add(clientId);
        this.clients.get(clientId)?.subscriptions.add(col);
        send({ type: 'subscribed', collection: col });
        break;
      }

      case 'unsubscribe': {
        const col = msg.collection as string;
        this.subscriptions.get(col)?.delete(clientId);
        this.clients.get(clientId)?.subscriptions.delete(col);
        send({ type: 'unsubscribed', collection: col });
        break;
      }

      case 'subscribe_doc': {
        const key = `${msg.collection}:${msg.docId}`;
        if (!this.docSubscriptions.has(key)) this.docSubscriptions.set(key, new Set());
        this.docSubscriptions.get(key)!.add(clientId);
        this.clients.get(clientId)?.docSubscriptions.add(key);
        send({ type: 'subscribed_doc', collection: msg.collection, docId: msg.docId });
        break;
      }

      case 'crdt_get': {
        const doc = this.getCRDTDoc(msg.collection as string, msg.docId as string);
        send({
          type: 'crdt_state',
          collection: msg.collection,
          docId: msg.docId,
          state: doc.toJSON(),
          data: doc.toObject(),
        });
        break;
      }

      case 'crdt_set': {
        const doc = this.getCRDTDoc(msg.collection as string, msg.docId as string);
        const path = typeof msg.path === 'string' ? (msg.path as string).split('.') : msg.path as string[];
        const previousValue = doc.get(path);
        const op = doc.set(path, msg.value);

        this.saveCRDTToDB(msg.collection as string, msg.docId as string, doc);
        this.broadcastOp(msg.collection as string, msg.docId as string, [op], clientId);

        const um = this.getClientUndoManager(clientId, msg.collection as string, msg.docId as string);
        um.capture({ ...op, previousValue }, previousValue);

        this.metrics.sync.operations++;
        send({ type: 'crdt_set_ok', docId: msg.docId, op, version: doc.version });
        break;
      }

      case 'crdt_ops': {
        const doc = this.getCRDTDoc(msg.collection as string, msg.docId as string);
        const applied = doc.applyRemoteBatch(msg.operations as unknown[]);
        this.saveCRDTToDB(msg.collection as string, msg.docId as string, doc);
        this.broadcastOp(msg.collection as string, msg.docId as string, msg.operations as unknown[], clientId);
        this.metrics.sync.operations += applied;
        send({ type: 'crdt_ops_ok', docId: msg.docId, applied, version: doc.version });
        break;
      }

      case 'ping': {
        send({ type: 'pong', time: msg.time || Date.now() });
        break;
      }

      default:
        send({ type: 'error', message: `Unknown message type: ${msg.type}` });
    }
  }

  private executeSQL(sql: string, params: unknown[], collection: string): {
    rows?: unknown[];
    rowcount?: number;
    row?: unknown;
    lastrowid?: number;
    updated?: number;
    deleted?: number;
  } {
    // SQL 파싱 및 실행 (기존 api-server.js 로직 사용)
    const sqlLower = sql.toLowerCase().trim();

    if (sqlLower.startsWith('select')) {
      const rows = this.db.getDocuments(collection);
      const docs = rows.map((r) => {
        let data = JSON.parse(r.data);
        if (data.data && typeof data.data === 'object') data = data.data;
        return { ...data, id: parseInt(r.id) || r.id };
      });
      return { rows: docs, rowcount: docs.length };
    }

    if (sqlLower.startsWith('insert')) {
      // INSERT 처리
      const id = crypto.randomBytes(8).toString('hex');
      const data = JSON.stringify({ id });
      this.db.saveDocument(collection, id, data);
      return { row: { id }, lastrowid: parseInt(id) || 0 };
    }

    throw new Error(`Unsupported SQL: ${sql}`);
  }

  async stop(): Promise<void> {
    console.log('[kimdb] Shutting down...');

    // Save all cached documents
    for (const key of this.crdtDocs.keys()) {
      const doc = this.crdtDocs.get(key);
      if (doc) {
        const [collection, docId] = key.split(':');
        this.saveCRDTToDB(collection, docId, doc);
      }
    }

    // Notify clients
    for (const [, client] of this.clients) {
      try {
        client.socket.send(JSON.stringify({ type: 'server_shutdown' }));
        client.socket.close(1001, 'Server shutting down');
      } catch {
        // Ignore
      }
    }

    // Clear timers
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.checkpointTimer) clearInterval(this.checkpointTimer);

    // Close database
    this.db.close();

    // Close server
    await this.fastify.close();
    console.log('[kimdb] Shutdown complete');
  }
}

// ===== CLI Entry Point =====
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new KimDBServer();

  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.stop();
    process.exit(0);
  });

  // KimNexus 글로벌 에러 핸들러
  process.on('uncaughtException', (error) => {
    nexusLog.error('Uncaught Exception', { name: error.name, message: error.message, stack: error.stack }, ['fatal']);
    console.error('[kimdb] Uncaught Exception:', error);
  });

  process.on('unhandledRejection', (reason) => {
    nexusLog.error('Unhandled Rejection', { reason: String(reason) }, ['fatal']);
    console.error('[kimdb] Unhandled Rejection:', reason);
  });

  server.start().catch((e) => {
    console.error('[kimdb] Failed to start:', e);
    nexusLog.error('서버 시작 실패', { message: e.message, stack: e.stack }, ['startup', 'fatal']);
    process.exit(1);
  });
}

export { VERSION };
export default KimDBServer;
