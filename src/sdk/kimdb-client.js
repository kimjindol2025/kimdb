/**
 * kimdb Client SDK v1.0.0
 *
 * 특징:
 * - 자동 재연결 (exponential backoff)
 * - 오프라인 큐잉
 * - 로컬 캐시 (IndexedDB/localStorage)
 * - CRDT 기반 충돌 해결
 * - React Native / 브라우저 호환
 */

const DEFAULT_OPTIONS = {
  url: 'wss://db.dclub.kr/ws',
  apiUrl: 'https://db.dclub.kr',
  apiKey: null,
  autoReconnect: true,
  reconnectInterval: 1000,
  maxReconnectInterval: 30000,
  reconnectDecay: 1.5,
  storage: 'localStorage', // 'localStorage', 'indexedDB', 'memory'
};

// ===== LWW-Register CRDT =====
class LWWRegister {
  constructor(value = null, timestamp = 0, clientId = null) {
    this.value = value;
    this.timestamp = timestamp;
    this.clientId = clientId;
  }

  set(value, timestamp, clientId) {
    if (timestamp > this.timestamp ||
        (timestamp === this.timestamp && clientId > this.clientId)) {
      this.value = value;
      this.timestamp = timestamp;
      this.clientId = clientId;
      return true;
    }
    return false;
  }

  merge(other) {
    return this.set(other.value, other.timestamp, other.clientId);
  }

  toJSON() {
    return { value: this.value, timestamp: this.timestamp, clientId: this.clientId };
  }

  static fromJSON(json) {
    return new LWWRegister(json.value, json.timestamp, json.clientId);
  }
}

// ===== LWW-Map CRDT (for documents) =====
class LWWMap {
  constructor() {
    this.fields = new Map();
  }

  set(key, value, timestamp, clientId) {
    if (!this.fields.has(key)) {
      this.fields.set(key, new LWWRegister());
    }
    return this.fields.get(key).set(value, timestamp, clientId);
  }

  get(key) {
    const reg = this.fields.get(key);
    return reg ? reg.value : undefined;
  }

  merge(other) {
    let changed = false;
    for (const [key, reg] of other.fields) {
      if (!this.fields.has(key)) {
        this.fields.set(key, new LWWRegister());
      }
      if (this.fields.get(key).merge(reg)) {
        changed = true;
      }
    }
    return changed;
  }

  toObject() {
    const obj = {};
    for (const [key, reg] of this.fields) {
      obj[key] = reg.value;
    }
    return obj;
  }

  toJSON() {
    const json = {};
    for (const [key, reg] of this.fields) {
      json[key] = reg.toJSON();
    }
    return json;
  }

  static fromJSON(json) {
    const map = new LWWMap();
    for (const [key, regJson] of Object.entries(json)) {
      map.fields.set(key, LWWRegister.fromJSON(regJson));
    }
    return map;
  }

  static fromObject(obj, timestamp, clientId) {
    const map = new LWWMap();
    for (const [key, value] of Object.entries(obj)) {
      map.set(key, value, timestamp, clientId);
    }
    return map;
  }
}

// ===== Storage Adapters =====
class MemoryStorage {
  constructor() {
    this.data = new Map();
  }
  async get(key) { return this.data.get(key); }
  async set(key, value) { this.data.set(key, value); }
  async delete(key) { this.data.delete(key); }
  async keys(prefix) {
    return [...this.data.keys()].filter(k => k.startsWith(prefix));
  }
  async clear(prefix) {
    for (const key of await this.keys(prefix)) {
      this.data.delete(key);
    }
  }
}

class LocalStorageAdapter {
  constructor(prefix = 'kimdb:') {
    this.prefix = prefix;
  }
  async get(key) {
    const val = localStorage.getItem(this.prefix + key);
    return val ? JSON.parse(val) : undefined;
  }
  async set(key, value) {
    localStorage.setItem(this.prefix + key, JSON.stringify(value));
  }
  async delete(key) {
    localStorage.removeItem(this.prefix + key);
  }
  async keys(prefix) {
    const results = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(this.prefix + prefix)) {
        results.push(key.slice(this.prefix.length));
      }
    }
    return results;
  }
  async clear(prefix) {
    const keysToDelete = await this.keys(prefix);
    for (const key of keysToDelete) {
      await this.delete(key);
    }
  }
}

class IndexedDBAdapter {
  constructor(dbName = 'kimdb', storeName = 'cache') {
    this.dbName = dbName;
    this.storeName = storeName;
    this.db = null;
  }

  async init() {
    if (this.db) return;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
    });
  }

  async get(key) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async set(key, value) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const request = store.put(value, key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async delete(key) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const request = store.delete(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async keys(prefix) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.getAllKeys();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        resolve(request.result.filter(k => typeof k === 'string' && k.startsWith(prefix)));
      };
    });
  }

  async clear(prefix) {
    const keysToDelete = await this.keys(prefix);
    for (const key of keysToDelete) {
      await this.delete(key);
    }
  }
}

// ===== Main Client =====
class KimDBClient {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.ws = null;
    this.clientId = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.subscriptions = new Map(); // collection -> Set<callback>
    this.pendingQueue = []; // offline queue
    this.syncTimestamps = new Map(); // collection -> lastSyncTimestamp
    this.documents = new Map(); // collection:id -> LWWMap
    this.listeners = new Map(); // event -> Set<callback>

    // Storage
    if (this.options.storage === 'indexedDB' && typeof indexedDB !== 'undefined') {
      this.storage = new IndexedDBAdapter();
    } else if (this.options.storage === 'localStorage' && typeof localStorage !== 'undefined') {
      this.storage = new LocalStorageAdapter();
    } else {
      this.storage = new MemoryStorage();
    }

    // Auto-connect
    if (this.options.autoConnect !== false) {
      this.connect();
    }
  }

  // ===== Connection =====
  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    try {
      this.ws = new WebSocket(this.options.url);

      this.ws.onopen = () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        this._emit('connected');

        // Re-subscribe
        for (const collection of this.subscriptions.keys()) {
          this._send({ type: 'subscribe', collection });
        }

        // Flush pending queue
        this._flushQueue();

        // Sync all subscribed collections
        this._syncAll();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this._handleMessage(msg);
        } catch (e) {
          console.error('[kimdb] Parse error:', e);
        }
      };

      this.ws.onclose = () => {
        this.connected = false;
        this._emit('disconnected');

        if (this.options.autoReconnect) {
          this._scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        this._emit('error', error);
      };

    } catch (e) {
      console.error('[kimdb] Connect error:', e);
      if (this.options.autoReconnect) {
        this._scheduleReconnect();
      }
    }
  }

  disconnect() {
    this.options.autoReconnect = false;
    if (this.ws) {
      this.ws.close();
    }
  }

  _scheduleReconnect() {
    const interval = Math.min(
      this.options.reconnectInterval * Math.pow(this.options.reconnectDecay, this.reconnectAttempts),
      this.options.maxReconnectInterval
    );
    this.reconnectAttempts++;

    setTimeout(() => {
      if (!this.connected) {
        this._emit('reconnecting', this.reconnectAttempts);
        this.connect();
      }
    }, interval);
  }

  _send(msg) {
    if (this.connected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  // ===== Message Handling =====
  _handleMessage(msg) {
    switch (msg.type) {
      case 'connected':
        this.clientId = msg.clientId;
        break;

      case 'subscribed':
      case 'unsubscribed':
        break;

      case 'sync':
        this._handleSync(msg);
        break;

      case 'sync_response':
        this._handleSyncResponse(msg);
        break;

      case 'insert_ok':
      case 'update_ok':
      case 'delete_ok':
        // Confirmation from server
        break;

      case 'error':
        this._emit('error', new Error(msg.message));
        break;

      case 'pong':
        break;
    }
  }

  _handleSync(msg) {
    const { collection, event, data, timestamp } = msg;
    const docKey = `${collection}:${data.id}`;

    if (event === 'delete') {
      this.documents.delete(docKey);
      this._cacheDelete(docKey);
    } else {
      // Merge with CRDT
      const incoming = LWWMap.fromObject(data.data, timestamp, msg.clientId || 'server');

      if (!this.documents.has(docKey)) {
        this.documents.set(docKey, new LWWMap());
      }

      const local = this.documents.get(docKey);
      const changed = local.merge(incoming);

      if (changed) {
        this._cacheSet(docKey, {
          id: data.id,
          data: local.toObject(),
          _version: data._version,
          _crdt: local.toJSON()
        });
      }
    }

    // Update sync timestamp
    this.syncTimestamps.set(collection, Math.max(
      this.syncTimestamps.get(collection) || 0,
      timestamp
    ));

    // Notify subscribers
    const callbacks = this.subscriptions.get(collection);
    if (callbacks) {
      for (const cb of callbacks) {
        cb(event, data);
      }
    }
  }

  _handleSyncResponse(msg) {
    const { collection, changes, serverTime } = msg;

    for (const change of changes) {
      this._handleSync({
        type: 'sync',
        collection,
        event: change.operation,
        data: { id: change.doc_id, data: change.data },
        timestamp: change.timestamp
      });
    }

    this.syncTimestamps.set(collection, serverTime);
    this._cacheSyncTimestamp(collection, serverTime);
  }

  async _syncAll() {
    for (const collection of this.subscriptions.keys()) {
      const since = await this._getCachedSyncTimestamp(collection);
      this._send({ type: 'sync', collection, since });
    }
  }

  // ===== Offline Queue =====
  _enqueue(operation) {
    this.pendingQueue.push({
      ...operation,
      timestamp: Date.now(),
      clientId: this.clientId
    });
    this._cacheQueue();
  }

  async _flushQueue() {
    const queue = [...this.pendingQueue];
    this.pendingQueue = [];

    for (const op of queue) {
      if (!this._send(op)) {
        this.pendingQueue.push(op);
      }
    }

    this._cacheQueue();
  }

  // ===== Cache Operations =====
  async _cacheSet(key, value) {
    try {
      await this.storage.set(`doc:${key}`, value);
    } catch (e) {
      console.error('[kimdb] Cache set error:', e);
    }
  }

  async _cacheGet(key) {
    try {
      return await this.storage.get(`doc:${key}`);
    } catch (e) {
      return undefined;
    }
  }

  async _cacheDelete(key) {
    try {
      await this.storage.delete(`doc:${key}`);
    } catch (e) {}
  }

  async _cacheSyncTimestamp(collection, timestamp) {
    try {
      await this.storage.set(`sync:${collection}`, timestamp);
    } catch (e) {}
  }

  async _getCachedSyncTimestamp(collection) {
    try {
      return (await this.storage.get(`sync:${collection}`)) || 0;
    } catch (e) {
      return 0;
    }
  }

  async _cacheQueue() {
    try {
      await this.storage.set('queue', this.pendingQueue);
    } catch (e) {}
  }

  async _loadQueue() {
    try {
      const queue = await this.storage.get('queue');
      if (queue) this.pendingQueue = queue;
    } catch (e) {}
  }

  // ===== Public API =====

  /**
   * Subscribe to a collection
   */
  subscribe(collection, callback) {
    if (!this.subscriptions.has(collection)) {
      this.subscriptions.set(collection, new Set());
      if (this.connected) {
        this._send({ type: 'subscribe', collection });
        const since = this.syncTimestamps.get(collection) || 0;
        this._send({ type: 'sync', collection, since });
      }
    }
    this.subscriptions.get(collection).add(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.subscriptions.get(collection);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.subscriptions.delete(collection);
          this._send({ type: 'unsubscribe', collection });
        }
      }
    };
  }

  /**
   * Get all documents from a collection (from cache)
   */
  async getAll(collection) {
    const keys = await this.storage.keys(`doc:${collection}:`);
    const docs = [];
    for (const key of keys) {
      const doc = await this.storage.get(key);
      if (doc) docs.push(doc);
    }
    return docs;
  }

  /**
   * Get a single document
   */
  async get(collection, id) {
    return await this._cacheGet(`${collection}:${id}`);
  }

  /**
   * Insert a document
   */
  insert(collection, data, id = null) {
    const docId = id || this._generateId();
    const timestamp = Date.now();
    const docKey = `${collection}:${docId}`;

    // Create CRDT
    const crdt = LWWMap.fromObject(data, timestamp, this.clientId);
    this.documents.set(docKey, crdt);

    // Cache locally
    this._cacheSet(docKey, {
      id: docId,
      data: crdt.toObject(),
      _version: 1,
      _crdt: crdt.toJSON(),
      _pending: !this.connected
    });

    // Send or queue
    const op = { type: 'insert', collection, id: docId, data };
    if (!this._send(op)) {
      this._enqueue(op);
    }

    return docId;
  }

  /**
   * Update a document
   */
  async update(collection, id, data) {
    const docKey = `${collection}:${id}`;
    const timestamp = Date.now();

    // Get or create CRDT
    if (!this.documents.has(docKey)) {
      const cached = await this._cacheGet(docKey);
      if (cached && cached._crdt) {
        this.documents.set(docKey, LWWMap.fromJSON(cached._crdt));
      } else {
        this.documents.set(docKey, new LWWMap());
      }
    }

    const crdt = this.documents.get(docKey);

    // Update fields
    for (const [key, value] of Object.entries(data)) {
      crdt.set(key, value, timestamp, this.clientId);
    }

    // Cache
    this._cacheSet(docKey, {
      id,
      data: crdt.toObject(),
      _crdt: crdt.toJSON(),
      _pending: !this.connected
    });

    // Send or queue
    const op = { type: 'update', collection, id, data };
    if (!this._send(op)) {
      this._enqueue(op);
    }
  }

  /**
   * Delete a document
   */
  delete(collection, id) {
    const docKey = `${collection}:${id}`;
    this.documents.delete(docKey);
    this._cacheDelete(docKey);

    const op = { type: 'delete', collection, id };
    if (!this._send(op)) {
      this._enqueue(op);
    }
  }

  /**
   * Event listeners
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.listeners.get(event).delete(callback);
  }

  _emit(event, data) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const cb of callbacks) {
        cb(data);
      }
    }
  }

  _generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Check online status
   */
  get isOnline() {
    return this.connected;
  }

  /**
   * Get pending operations count
   */
  get pendingCount() {
    return this.pendingQueue.length;
  }
}

// ===== React Hook (optional) =====
function useKimDB(client, collection) {
  // This would be implemented with React hooks
  // For now, just return the basic API
  return {
    subscribe: (cb) => client.subscribe(collection, cb),
    getAll: () => client.getAll(collection),
    get: (id) => client.get(collection, id),
    insert: (data, id) => client.insert(collection, data, id),
    update: (id, data) => client.update(collection, id, data),
    delete: (id) => client.delete(collection, id),
  };
}

// ===== Export =====
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { KimDBClient, LWWRegister, LWWMap, useKimDB };
} else if (typeof window !== 'undefined') {
  window.KimDBClient = KimDBClient;
  window.useKimDB = useKimDB;
}
