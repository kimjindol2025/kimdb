/**
 * kimdb Client
 *
 * 브라우저/Node.js 클라이언트
 */
import { CRDTDocument, OpBatcher, UndoManager, PresenceManager, } from '../crdt/index.js';
export class KimDBClient {
    options;
    ws = null;
    state = {
        connected: false,
        clientId: null,
        serverId: null,
        reconnectAttempts: 0,
    };
    subscriptions = new Set();
    docSubscriptions = new Map();
    messageHandlers = new Map();
    batcher;
    undoManagers = new Map();
    presenceManager = null;
    // Event handlers
    onConnect;
    onDisconnect;
    onError;
    onSync;
    constructor(options) {
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
    async connect() {
        return new Promise((resolve, reject) => {
            const wsUrl = this.options.apiKey
                ? `${this.options.url}?api_key=${this.options.apiKey}`
                : this.options.url;
            try {
                this.ws = new WebSocket(wsUrl);
            }
            catch (e) {
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
                    const msg = JSON.parse(event.data);
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
                }
                catch (e) {
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
                        this.connect().catch(() => { });
                    }, this.options.reconnectInterval * this.state.reconnectAttempts);
                }
            };
        });
    }
    disconnect() {
        this.options.autoReconnect = false;
        this.ws?.close();
        this.ws = null;
        this.state.connected = false;
    }
    // ===== Messaging =====
    send(msg) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }
    sendBatch(ops) {
        if (ops.length === 0)
            return;
        // Group by docId
        const byDoc = new Map();
        for (const op of ops) {
            const { docId } = op;
            if (!byDoc.has(docId))
                byDoc.set(docId, []);
            byDoc.get(docId).push(op);
        }
        for (const [docId, docOps] of byDoc) {
            const firstOp = docOps[0];
            this.send({
                type: 'crdt_ops',
                collection: firstOp.collection,
                docId,
                operations: docOps,
            });
        }
    }
    handleMessage(msg) {
        const handlers = this.messageHandlers.get(msg.type);
        if (handlers) {
            for (const handler of handlers) {
                handler(msg);
            }
        }
        // Sync events
        if (msg.type === 'sync') {
            this.onSync?.(msg.collection, msg.event, msg);
        }
        // CRDT sync
        if (msg.type === 'crdt_sync') {
            const doc = this.docSubscriptions.get(`${msg.collection}:${msg.docId}`);
            if (doc) {
                doc.applyRemoteBatch(msg.operations);
            }
        }
    }
    on(type, handler) {
        if (!this.messageHandlers.has(type)) {
            this.messageHandlers.set(type, []);
        }
        this.messageHandlers.get(type).push(handler);
    }
    off(type, handler) {
        const handlers = this.messageHandlers.get(type);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index >= 0)
                handlers.splice(index, 1);
        }
    }
    // ===== Subscriptions =====
    subscribe(collection) {
        this.subscriptions.add(collection);
        if (this.state.connected) {
            this.send({ type: 'subscribe', collection });
        }
    }
    unsubscribe(collection) {
        this.subscriptions.delete(collection);
        if (this.state.connected) {
            this.send({ type: 'unsubscribe', collection });
        }
    }
    // ===== CRDT Document =====
    async openDocument(collection, docId) {
        const key = `${collection}:${docId}`;
        if (this.docSubscriptions.has(key)) {
            return this.docSubscriptions.get(key);
        }
        // Subscribe to doc
        this.send({ type: 'subscribe_doc', collection, docId });
        // Get initial state
        return new Promise((resolve) => {
            const handler = (msg) => {
                const m = msg;
                if (m.type === 'crdt_state' && m.collection === collection && m.docId === docId) {
                    this.off('crdt_state', handler);
                    const doc = CRDTDocument.fromJSON(m.state);
                    this.docSubscriptions.set(key, doc);
                    resolve(doc);
                }
            };
            this.on('crdt_state', handler);
            this.send({ type: 'crdt_get', collection, docId });
        });
    }
    closeDocument(collection, docId) {
        const key = `${collection}:${docId}`;
        this.docSubscriptions.delete(key);
        this.send({ type: 'unsubscribe_doc', collection, docId });
    }
    // ===== Document Operations =====
    set(collection, docId, path, value) {
        const doc = this.docSubscriptions.get(`${collection}:${docId}`);
        if (!doc) {
            throw new Error(`Document not opened: ${collection}/${docId}`);
        }
        const op = doc.set(path, value);
        this.batcher.add({ ...op, collection });
    }
    get(collection, docId, path) {
        const doc = this.docSubscriptions.get(`${collection}:${docId}`);
        if (!doc) {
            throw new Error(`Document not opened: ${collection}/${docId}`);
        }
        return doc.get(path);
    }
    // ===== Undo/Redo =====
    getUndoManager(collection, docId) {
        const key = `${collection}:${docId}`;
        if (!this.undoManagers.has(key)) {
            this.undoManagers.set(key, new UndoManager({ maxHistory: 100, captureTimeout: 500 }));
        }
        return this.undoManagers.get(key);
    }
    undo(collection, docId) {
        const um = this.getUndoManager(collection, docId);
        const ops = um.undo();
        if (ops && ops.length > 0) {
            this.send({ type: 'undo', collection, docId });
        }
    }
    redo(collection, docId) {
        const um = this.getUndoManager(collection, docId);
        const ops = um.redo();
        if (ops && ops.length > 0) {
            this.send({ type: 'redo', collection, docId });
        }
    }
    // ===== Presence =====
    async joinPresence(collection, docId, user) {
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
    leavePresence(collection, docId) {
        this.send({ type: 'presence_leave', collection, docId });
        this.presenceManager = null;
    }
    updatePresence(cursor) {
        if (this.presenceManager) {
            this.send({
                type: 'presence_cursor',
                position: cursor.position,
                selection: cursor.selection,
            });
        }
    }
    // ===== REST API =====
    get httpUrl() {
        // ws:// -> http://, wss:// -> https://
        return this.options.url
            .replace(/^ws:/, 'http:')
            .replace(/^wss:/, 'https:')
            .replace(/\/ws\/?$/, '');
    }
    async httpFetch(path, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
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
        return res.json();
    }
    /** REST: 컬렉션 문서 목록 조회 */
    async list(collection) {
        return this.httpFetch(`/api/c/${collection}`);
    }
    /** REST: 단일 문서 조회 */
    async getDoc(collection, id) {
        return this.httpFetch(`/api/c/${collection}/${id}`);
    }
    /** REST: 문서 생성 (ID 자동 생성) */
    async create(collection, data) {
        return this.httpFetch(`/api/c/${collection}`, {
            method: 'POST',
            body: JSON.stringify({ data }),
        });
    }
    /** REST: 문서 저장 (upsert) */
    async save(collection, id, data) {
        return this.httpFetch(`/api/c/${collection}/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ data }),
        });
    }
    /** REST: 문서 부분 업데이트 */
    async update(collection, id, data) {
        return this.httpFetch(`/api/c/${collection}/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ data }),
        });
    }
    /** REST: 문서 삭제 */
    async remove(collection, id) {
        return this.httpFetch(`/api/c/${collection}/${id}`, {
            method: 'DELETE',
        });
    }
    // ===== State =====
    get isConnected() {
        return this.state.connected;
    }
    get clientId() {
        return this.state.clientId;
    }
    get serverId() {
        return this.state.serverId;
    }
}
export default KimDBClient;
//# sourceMappingURL=index.js.map