/**
 * kimdb Client
 *
 * 브라우저/Node.js 클라이언트
 */

import {
  VectorClock,
  CRDTDocument,
  OpBatcher,
  UndoManager,
  PresenceManager,
} from '../crdt/index.js';

export interface KimDBClientOptions {
  url: string;
  apiKey?: string;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  batchSize?: number;
  batchTimeout?: number;
}

export interface ConnectionState {
  connected: boolean;
  clientId: string | null;
  serverId: string | null;
  reconnectAttempts: number;
}

type MessageHandler = (msg: unknown) => void;

export class KimDBClient {
  private options: Required<KimDBClientOptions>;
  private ws: WebSocket | null = null;
  private state: ConnectionState = {
    connected: false,
    clientId: null,
    serverId: null,
    reconnectAttempts: 0,
  };

  private subscriptions = new Set<string>();
  private docSubscriptions = new Map<string, CRDTDocument>();
  private messageHandlers = new Map<string, MessageHandler[]>();
  private batcher: OpBatcher;
  private undoManagers = new Map<string, UndoManager>();
  private presenceManager: PresenceManager | null = null;

  // Event handlers
  public onConnect?: () => void;
  public onDisconnect?: () => void;
  public onError?: (error: Error) => void;
  public onSync?: (collection: string, event: string, data: unknown) => void;

  constructor(options: KimDBClientOptions) {
    this.options = {
      url: options.url,
      apiKey: options.apiKey || '',
      autoReconnect: options.autoReconnect ?? true,
      reconnectInterval: options.reconnectInterval ?? 1000,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 10,
      batchSize: options.batchSize ?? 50,
      batchTimeout: options.batchTimeout ?? 100,
    };

    this.batcher = new OpBatcher({
      batchSize: this.options.batchSize,
      batchTimeout: this.options.batchTimeout,
      onFlush: (ops) => this.sendBatch(ops),
    });
  }

  // ===== Connection =====

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.options.apiKey
        ? `${this.options.url}?api_key=${this.options.apiKey}`
        : this.options.url;

      try {
        this.ws = new WebSocket(wsUrl);
      } catch (e) {
        reject(e);
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 10000);

      this.ws.onopen = () => {
        // Wait for 'connected' message
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          this.handleMessage(msg);

          if (msg.type === 'connected') {
            clearTimeout(timeout);
            this.state.connected = true;
            this.state.clientId = msg.clientId;
            this.state.serverId = msg.serverId;
            this.state.reconnectAttempts = 0;

            // Re-subscribe
            for (const col of this.subscriptions) {
              this.send({ type: 'subscribe', collection: col });
            }

            this.onConnect?.();
            resolve();
          }
        } catch (e) {
          console.error('[kimdb-client] Message parse error:', e);
        }
      };

      this.ws.onerror = (event) => {
        clearTimeout(timeout);
        const error = new Error('WebSocket error');
        this.onError?.(error);
        reject(error);
      };

      this.ws.onclose = () => {
        this.state.connected = false;
        this.onDisconnect?.();

        if (this.options.autoReconnect && this.state.reconnectAttempts < this.options.maxReconnectAttempts) {
          this.state.reconnectAttempts++;
          setTimeout(() => {
            this.connect().catch(() => {});
          }, this.options.reconnectInterval * this.state.reconnectAttempts);
        }
      };
    });
  }

  disconnect(): void {
    this.options.autoReconnect = false;
    this.ws?.close();
    this.ws = null;
    this.state.connected = false;
  }

  // ===== Messaging =====

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private sendBatch(ops: unknown[]): void {
    if (ops.length === 0) return;

    // Group by docId
    const byDoc = new Map<string, unknown[]>();
    for (const op of ops) {
      const { docId } = op as { docId: string };
      if (!byDoc.has(docId)) byDoc.set(docId, []);
      byDoc.get(docId)!.push(op);
    }

    for (const [docId, docOps] of byDoc) {
      const firstOp = docOps[0] as { collection: string };
      this.send({
        type: 'crdt_ops',
        collection: firstOp.collection,
        docId,
        operations: docOps,
      });
    }
  }

  private handleMessage(msg: { type: string; [key: string]: unknown }): void {
    const handlers = this.messageHandlers.get(msg.type);
    if (handlers) {
      for (const handler of handlers) {
        handler(msg);
      }
    }

    // Sync events
    if (msg.type === 'sync') {
      this.onSync?.(msg.collection as string, msg.event as string, msg);
    }

    // CRDT sync
    if (msg.type === 'crdt_sync') {
      const doc = this.docSubscriptions.get(`${msg.collection}:${msg.docId}`);
      if (doc) {
        doc.applyRemoteBatch(msg.operations as unknown[]);
      }
    }
  }

  on(type: string, handler: MessageHandler): void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, []);
    }
    this.messageHandlers.get(type)!.push(handler);
  }

  off(type: string, handler: MessageHandler): void {
    const handlers = this.messageHandlers.get(type);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index >= 0) handlers.splice(index, 1);
    }
  }

  // ===== Subscriptions =====

  subscribe(collection: string): void {
    this.subscriptions.add(collection);
    if (this.state.connected) {
      this.send({ type: 'subscribe', collection });
    }
  }

  unsubscribe(collection: string): void {
    this.subscriptions.delete(collection);
    if (this.state.connected) {
      this.send({ type: 'unsubscribe', collection });
    }
  }

  // ===== CRDT Document =====

  async openDocument(collection: string, docId: string): Promise<CRDTDocument> {
    const key = `${collection}:${docId}`;

    if (this.docSubscriptions.has(key)) {
      return this.docSubscriptions.get(key)!;
    }

    // Subscribe to doc
    this.send({ type: 'subscribe_doc', collection, docId });

    // Get initial state
    return new Promise((resolve) => {
      const handler: MessageHandler = (msg) => {
        const m = msg as { type: string; collection: string; docId: string; state: unknown };
        if (m.type === 'crdt_state' && m.collection === collection && m.docId === docId) {
          this.off('crdt_state', handler);

          const doc = CRDTDocument.fromJSON(m.state as ReturnType<CRDTDocument['toJSON']>);
          this.docSubscriptions.set(key, doc);
          resolve(doc);
        }
      };

      this.on('crdt_state', handler);
      this.send({ type: 'crdt_get', collection, docId });
    });
  }

  closeDocument(collection: string, docId: string): void {
    const key = `${collection}:${docId}`;
    this.docSubscriptions.delete(key);
    this.send({ type: 'unsubscribe_doc', collection, docId });
  }

  // ===== Document Operations =====

  set(collection: string, docId: string, path: string | string[], value: unknown): void {
    const doc = this.docSubscriptions.get(`${collection}:${docId}`);
    if (!doc) {
      throw new Error(`Document not opened: ${collection}/${docId}`);
    }

    const op = doc.set(path, value);
    this.batcher.add({ ...op, collection });
  }

  get(collection: string, docId: string, path: string | string[]): unknown {
    const doc = this.docSubscriptions.get(`${collection}:${docId}`);
    if (!doc) {
      throw new Error(`Document not opened: ${collection}/${docId}`);
    }

    return doc.get(path);
  }

  // ===== Undo/Redo =====

  getUndoManager(collection: string, docId: string): UndoManager {
    const key = `${collection}:${docId}`;
    if (!this.undoManagers.has(key)) {
      this.undoManagers.set(key, new UndoManager({ maxHistory: 100, captureTimeout: 500 }));
    }
    return this.undoManagers.get(key)!;
  }

  undo(collection: string, docId: string): void {
    const um = this.getUndoManager(collection, docId);
    const ops = um.undo();
    if (ops && ops.length > 0) {
      this.send({ type: 'undo', collection, docId });
    }
  }

  redo(collection: string, docId: string): void {
    const um = this.getUndoManager(collection, docId);
    const ops = um.redo();
    if (ops && ops.length > 0) {
      this.send({ type: 'redo', collection, docId });
    }
  }

  // ===== Presence =====

  async joinPresence(collection: string, docId: string, user: { name: string; color?: string }): Promise<void> {
    this.presenceManager = new PresenceManager(this.state.clientId || 'unknown', {
      name: user.name,
      color: user.color,
    });

    this.send({
      type: 'presence_join',
      collection,
      docId,
      user,
    });
  }

  leavePresence(collection: string, docId: string): void {
    this.send({ type: 'presence_leave', collection, docId });
    this.presenceManager = null;
  }

  updatePresence(cursor: { position: number; selection?: { start: number; end: number } | null }): void {
    if (this.presenceManager) {
      this.send({
        type: 'presence_cursor',
        position: cursor.position,
        selection: cursor.selection,
      });
    }
  }

  // ===== REST API =====

  private get httpUrl(): string {
    // ws:// -> http://, wss:// -> https://
    return this.options.url
      .replace(/^ws:/, 'http:')
      .replace(/^wss:/, 'https:')
      .replace(/\/ws\/?$/, '');
  }

  private async httpFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    if (this.options.apiKey) {
      headers['X-API-Key'] = this.options.apiKey;
    }

    const res = await fetch(`${this.httpUrl}${path}`, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`HTTP ${res.status}: ${error}`);
    }

    return res.json() as Promise<T>;
  }

  /** REST: 컬렉션 문서 목록 조회 */
  async list(collection: string): Promise<{ docs: Array<{ id: string; data: unknown; _version: number }> }> {
    return this.httpFetch(`/api/c/${collection}`);
  }

  /** REST: 단일 문서 조회 */
  async getDoc(collection: string, id: string): Promise<{ id: string; data: unknown; _version: number }> {
    return this.httpFetch(`/api/c/${collection}/${id}`);
  }

  /** REST: 문서 생성 (ID 자동 생성) */
  async create(collection: string, data: unknown): Promise<{ success: boolean; id: string; _version: number }> {
    return this.httpFetch(`/api/c/${collection}`, {
      method: 'POST',
      body: JSON.stringify({ data }),
    });
  }

  /** REST: 문서 저장 (upsert) */
  async save(collection: string, id: string, data: unknown): Promise<{ success: boolean; id: string; _version: number }> {
    return this.httpFetch(`/api/c/${collection}/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ data }),
    });
  }

  /** REST: 문서 부분 업데이트 */
  async update(collection: string, id: string, data: unknown): Promise<{ success: boolean; id: string; _version: number }> {
    return this.httpFetch(`/api/c/${collection}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ data }),
    });
  }

  /** REST: 문서 삭제 */
  async remove(collection: string, id: string): Promise<{ success: boolean }> {
    return this.httpFetch(`/api/c/${collection}/${id}`, {
      method: 'DELETE',
    });
  }

  // ===== State =====

  get isConnected(): boolean {
    return this.state.connected;
  }

  get clientId(): string | null {
    return this.state.clientId;
  }

  get serverId(): string | null {
    return this.state.serverId;
  }
}

export default KimDBClient;
