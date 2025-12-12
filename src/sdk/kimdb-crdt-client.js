/**
 * kimdb CRDT Client SDK v4.0.0
 *
 * Automerge/Yjs 수준의 CRDT 클라이언트
 * - Vector Clock 기반 인과적 순서
 * - RGA (텍스트/리스트)
 * - OR-Set
 * - 오프라인 큐 + 자동 재연결
 * - 충돌 감지 및 UI 선택
 *
 * 브라우저/React Native/Node.js 호환
 */

// ===== CRDT 클래스 (서버와 동일) =====

class VectorClock {
  constructor(nodeId, clock = {}) {
    this.nodeId = nodeId;
    this.clock = { ...clock };
    if (!this.clock[nodeId]) this.clock[nodeId] = 0;
  }

  tick() {
    this.clock[this.nodeId] = (this.clock[this.nodeId] || 0) + 1;
    return this.clone();
  }

  merge(other) {
    const otherClock = other instanceof VectorClock ? other.clock : other;
    for (const [node, time] of Object.entries(otherClock)) {
      this.clock[node] = Math.max(this.clock[node] || 0, time);
    }
    return this;
  }

  compare(other) {
    const otherClock = other instanceof VectorClock ? other.clock : other;
    const allNodes = new Set([...Object.keys(this.clock), ...Object.keys(otherClock)]);
    let thisGreater = false, otherGreater = false;
    for (const node of allNodes) {
      const t1 = this.clock[node] || 0, t2 = otherClock[node] || 0;
      if (t1 > t2) thisGreater = true;
      if (t2 > t1) otherGreater = true;
    }
    if (thisGreater && !otherGreater) return 1;
    if (otherGreater && !thisGreater) return -1;
    return 0;
  }

  isConcurrent(other) { return this.compare(other) === 0; }
  clone() { return new VectorClock(this.nodeId, { ...this.clock }); }
  toJSON() { return { nodeId: this.nodeId, clock: this.clock }; }
  static fromJSON(j) { return new VectorClock(j.nodeId, j.clock); }
}

class CRDTMap {
  constructor(nodeId) {
    this.nodeId = nodeId;
    this.clock = new VectorClock(nodeId);
    this.fields = new Map();
    this.tombstones = new Map();
  }

  set(key, value) {
    this.clock.tick();
    const entry = {
      value, clock: this.clock.clone().toJSON(),
      nodeId: this.nodeId, timestamp: Date.now()
    };
    this.fields.set(key, entry);
    this.tombstones.delete(key);
    return {
      type: 'map_set', key, value,
      clock: entry.clock, nodeId: this.nodeId, timestamp: entry.timestamp
    };
  }

  delete(key) {
    this.clock.tick();
    const entry = { clock: this.clock.clone().toJSON(), nodeId: this.nodeId, timestamp: Date.now() };
    this.fields.delete(key);
    this.tombstones.set(key, entry);
    return { type: 'map_delete', key, clock: entry.clock, nodeId: this.nodeId, timestamp: entry.timestamp };
  }

  get(key) { const e = this.fields.get(key); return e ? e.value : undefined; }
  has(key) { return this.fields.has(key); }

  applyRemote(op) {
    const opClock = VectorClock.fromJSON(op.clock);
    this.clock.merge(opClock);

    if (op.type === 'map_set') {
      const existing = this.fields.get(op.key);
      const tombstone = this.tombstones.get(op.key);
      if (existing) {
        const cmp = opClock.compare(VectorClock.fromJSON(existing.clock));
        if (cmp < 0) return;
        if (cmp === 0) {
          if (op.nodeId < existing.nodeId) return;
          if (op.nodeId === existing.nodeId && op.timestamp <= existing.timestamp) return;
        }
      }
      if (tombstone) {
        const cmp = opClock.compare(VectorClock.fromJSON(tombstone.clock));
        if (cmp < 0) return;
        if (cmp === 0 && op.timestamp <= tombstone.timestamp) return;
      }
      this.fields.set(op.key, { value: op.value, clock: op.clock, nodeId: op.nodeId, timestamp: op.timestamp });
      this.tombstones.delete(op.key);
    } else if (op.type === 'map_delete') {
      const existing = this.fields.get(op.key);
      if (existing) {
        const cmp = opClock.compare(VectorClock.fromJSON(existing.clock));
        if (cmp < 0) return;
        if (cmp === 0 && op.timestamp <= existing.timestamp) return;
      }
      this.fields.delete(op.key);
      this.tombstones.set(op.key, { clock: op.clock, nodeId: op.nodeId, timestamp: op.timestamp });
    }
  }

  toObject() {
    const obj = {};
    for (const [k, v] of this.fields) obj[k] = v.value;
    return obj;
  }

  toJSON() {
    const f = {}, t = {};
    for (const [k, v] of this.fields) f[k] = v;
    for (const [k, v] of this.tombstones) t[k] = v;
    return { nodeId: this.nodeId, clock: this.clock.toJSON(), fields: f, tombstones: t };
  }

  static fromJSON(j) {
    const m = new CRDTMap(j.nodeId);
    m.clock = VectorClock.fromJSON(j.clock);
    for (const [k, v] of Object.entries(j.fields)) m.fields.set(k, v);
    for (const [k, v] of Object.entries(j.tombstones)) m.tombstones.set(k, v);
    return m;
  }
}

class RGA {
  constructor(nodeId) {
    this.nodeId = nodeId;
    this.clock = new VectorClock(nodeId);
    this.elements = [];
    this.tombstones = new Set();
  }

  _generateId() {
    this.clock.tick();
    return `${this.nodeId}_${this.clock.clock[this.nodeId]}`;
  }

  _findVisibleIndex(index) {
    let visible = -1;
    for (let i = 0; i < this.elements.length; i++) {
      if (!this.tombstones.has(this.elements[i].id)) {
        visible++;
        if (visible === index) return i;
      }
    }
    return this.elements.length;
  }

  _findById(id) { return this.elements.findIndex(e => e.id === id); }

  insert(index, value) {
    const id = this._generateId();
    const realIndex = this._findVisibleIndex(index - 1);
    const left = realIndex >= 0 ? this.elements[realIndex]?.id : null;
    const element = { id, value, deleted: false, clock: this.clock.clone().toJSON(), left };

    let insertAt = realIndex + 1;
    while (insertAt < this.elements.length) {
      const el = this.elements[insertAt];
      if (el.left !== left) break;
      const elClock = VectorClock.fromJSON(el.clock);
      if (this.clock.compare(elClock) > 0) break;
      if (this.clock.compare(elClock) === 0 && this.nodeId > el.clock.nodeId) break;
      insertAt++;
    }

    this.elements.splice(insertAt, 0, element);
    return { type: 'rga_insert', id, value, left, clock: this.clock.clone().toJSON() };
  }

  delete(index) {
    const realIndex = this._findVisibleIndex(index);
    if (realIndex < 0 || realIndex >= this.elements.length) return null;
    const element = this.elements[realIndex];
    element.deleted = true;
    this.tombstones.add(element.id);
    this.clock.tick();
    return { type: 'rga_delete', id: element.id, clock: this.clock.clone().toJSON() };
  }

  applyRemote(op) {
    if (op.type === 'rga_insert') {
      if (this._findById(op.id) >= 0) return;
      const opClock = VectorClock.fromJSON(op.clock);
      this.clock.merge(opClock);

      let insertAt = 0;
      if (op.left) {
        const leftIdx = this._findById(op.left);
        insertAt = leftIdx + 1;
      }
      while (insertAt < this.elements.length) {
        const el = this.elements[insertAt];
        if (el.left !== op.left) break;
        const elClock = VectorClock.fromJSON(el.clock);
        if (opClock.compare(elClock) > 0) break;
        if (opClock.compare(elClock) === 0 && op.clock.nodeId > el.clock.nodeId) break;
        insertAt++;
      }
      this.elements.splice(insertAt, 0, { id: op.id, value: op.value, deleted: false, clock: op.clock, left: op.left });
    } else if (op.type === 'rga_delete') {
      const idx = this._findById(op.id);
      if (idx >= 0 && !this.elements[idx].deleted) {
        this.elements[idx].deleted = true;
        this.tombstones.add(op.id);
      }
      this.clock.merge(VectorClock.fromJSON(op.clock));
    }
  }

  toArray() { return this.elements.filter(e => !this.tombstones.has(e.id)).map(e => e.value); }
  toString() { return this.toArray().join(''); }

  toJSON() {
    return { nodeId: this.nodeId, clock: this.clock.toJSON(), elements: this.elements, tombstones: [...this.tombstones] };
  }

  static fromJSON(j) {
    const rga = new RGA(j.nodeId);
    rga.clock = VectorClock.fromJSON(j.clock);
    rga.elements = j.elements;
    rga.tombstones = new Set(j.tombstones);
    return rga;
  }
}

// ===== 로컬 CRDT 문서 =====
class CRDTDocument {
  constructor(nodeId, docId) {
    this.nodeId = nodeId;
    this.docId = docId;
    this.clock = new VectorClock(nodeId);
    this.root = new CRDTMap(nodeId);
    this.lists = new Map();
    this.pendingOps = [];
    this.appliedOps = new Set();
    this.version = 0;
  }

  _pathKey(path) { return path.join('.'); }

  _getNestedMap(path) {
    let current = this.root;
    for (let i = 0; i < path.length - 1; i++) {
      let next = current.get(path[i]);
      if (!next || !(next instanceof CRDTMap)) {
        next = new CRDTMap(this.nodeId);
        current.set(path[i], next);
      }
      current = next;
    }
    return current;
  }

  set(path, value) {
    if (typeof path === 'string') path = path.split('.');
    this.clock.tick();
    const parentMap = this._getNestedMap(path);
    const key = path[path.length - 1];
    const op = parentMap.set(key, value);
    const fullOp = { ...op, docId: this.docId, path, opId: `${this.nodeId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` };
    this.pendingOps.push(fullOp);
    this.appliedOps.add(fullOp.opId);
    this.version++;
    return fullOp;
  }

  delete(path) {
    if (typeof path === 'string') path = path.split('.');
    this.clock.tick();
    const parentMap = this._getNestedMap(path);
    const key = path[path.length - 1];
    const op = parentMap.delete(key);
    const fullOp = { ...op, docId: this.docId, path, opId: `${this.nodeId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` };
    this.pendingOps.push(fullOp);
    this.appliedOps.add(fullOp.opId);
    this.version++;
    return fullOp;
  }

  get(path) {
    if (typeof path === 'string') path = path.split('.');
    let current = this.root;
    for (let i = 0; i < path.length; i++) {
      if (current instanceof CRDTMap) current = current.get(path[i]);
      else return undefined;
      if (current === undefined) return undefined;
    }
    return current instanceof CRDTMap ? current.toObject() : current;
  }

  list(path) {
    if (typeof path === 'string') path = path.split('.');
    const key = this._pathKey(path);
    if (!this.lists.has(key)) this.lists.set(key, new RGA(this.nodeId));
    return this.lists.get(key);
  }

  listInsert(path, index, value) {
    const rga = this.list(path);
    const op = rga.insert(index, value);
    const fullOp = { ...op, docId: this.docId, path, opId: `${this.nodeId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` };
    this.pendingOps.push(fullOp);
    this.appliedOps.add(fullOp.opId);
    this.version++;
    return fullOp;
  }

  listDelete(path, index) {
    const rga = this.list(path);
    const op = rga.delete(index);
    if (!op) return null;
    const fullOp = { ...op, docId: this.docId, path, opId: `${this.nodeId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` };
    this.pendingOps.push(fullOp);
    this.appliedOps.add(fullOp.opId);
    this.version++;
    return fullOp;
  }

  applyRemote(op) {
    if (this.appliedOps.has(op.opId)) return false;
    this.clock.merge(VectorClock.fromJSON(op.clock));

    if (op.type === 'map_set' || op.type === 'map_delete') {
      const parentMap = this._getNestedMap(op.path);
      parentMap.applyRemote(op);
    } else if (op.type === 'rga_insert' || op.type === 'rga_delete') {
      const rga = this.list(op.path);
      rga.applyRemote(op);
    }

    this.appliedOps.add(op.opId);
    this.version++;
    return true;
  }

  applyRemoteBatch(ops) {
    ops.sort((a, b) => {
      const cmp = VectorClock.fromJSON(a.clock).compare(VectorClock.fromJSON(b.clock));
      if (cmp !== 0) return cmp;
      return a.timestamp - b.timestamp;
    });
    let applied = 0;
    for (const op of ops) if (this.applyRemote(op)) applied++;
    return applied;
  }

  flushPendingOps() {
    const ops = this.pendingOps;
    this.pendingOps = [];
    return ops;
  }

  toObject() {
    const obj = this.root.toObject();
    for (const [path, rga] of this.lists) {
      let target = obj;
      const parts = path.split('.');
      for (let i = 0; i < parts.length - 1; i++) {
        if (!target[parts[i]]) target[parts[i]] = {};
        target = target[parts[i]];
      }
      target[parts[parts.length - 1]] = rga.toArray();
    }
    return obj;
  }

  toJSON() {
    const lists = {};
    for (const [k, v] of this.lists) lists[k] = v.toJSON();
    return {
      nodeId: this.nodeId, docId: this.docId,
      clock: this.clock.toJSON(), root: this.root.toJSON(),
      lists, version: this.version,
      appliedOps: [...this.appliedOps].slice(-1000)
    };
  }

  static fromJSON(j) {
    const doc = new CRDTDocument(j.nodeId, j.docId);
    doc.clock = VectorClock.fromJSON(j.clock);
    doc.root = CRDTMap.fromJSON(j.root);
    doc.version = j.version;
    doc.appliedOps = new Set(j.appliedOps || []);
    for (const [k, v] of Object.entries(j.lists || {})) doc.lists.set(k, RGA.fromJSON(v));
    return doc;
  }
}

// ===== 스토리지 어댑터 =====
const StorageAdapters = {
  memory: () => {
    const store = new Map();
    return {
      get: (k) => Promise.resolve(store.get(k)),
      set: (k, v) => { store.set(k, v); return Promise.resolve(); },
      delete: (k) => { store.delete(k); return Promise.resolve(); },
      keys: () => Promise.resolve([...store.keys()])
    };
  },

  localStorage: (prefix = 'kimdb_') => ({
    get: (k) => {
      try { const v = localStorage.getItem(prefix + k); return Promise.resolve(v ? JSON.parse(v) : null); }
      catch { return Promise.resolve(null); }
    },
    set: (k, v) => { localStorage.setItem(prefix + k, JSON.stringify(v)); return Promise.resolve(); },
    delete: (k) => { localStorage.removeItem(prefix + k); return Promise.resolve(); },
    keys: () => {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith(prefix)) keys.push(k.slice(prefix.length));
      }
      return Promise.resolve(keys);
    }
  }),

  indexedDB: (dbName = 'kimdb', storeName = 'crdt') => {
    let db = null;
    const init = () => new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(dbName, 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onupgradeneeded = () => { req.result.createObjectStore(storeName); };
    });
    return {
      get: async (k) => {
        const d = await init();
        return new Promise((resolve, reject) => {
          const tx = d.transaction(storeName, 'readonly');
          const req = tx.objectStore(storeName).get(k);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => resolve(req.result);
        });
      },
      set: async (k, v) => {
        const d = await init();
        return new Promise((resolve, reject) => {
          const tx = d.transaction(storeName, 'readwrite');
          const req = tx.objectStore(storeName).put(v, k);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => resolve();
        });
      },
      delete: async (k) => {
        const d = await init();
        return new Promise((resolve, reject) => {
          const tx = d.transaction(storeName, 'readwrite');
          const req = tx.objectStore(storeName).delete(k);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => resolve();
        });
      },
      keys: async () => {
        const d = await init();
        return new Promise((resolve, reject) => {
          const tx = d.transaction(storeName, 'readonly');
          const req = tx.objectStore(storeName).getAllKeys();
          req.onerror = () => reject(req.error);
          req.onsuccess = () => resolve(req.result);
        });
      }
    };
  }
};

// ===== 메인 클라이언트 =====
class KimDBClient {
  constructor(options = {}) {
    this.url = options.url || 'wss://db.dclub.kr/ws';
    this.apiKey = options.apiKey || '';
    this.nodeId = options.nodeId || `client_${Math.random().toString(36).slice(2, 10)}`;

    // WebSocket
    this.ws = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectDelay = 30000;
    this.reconnectTimer = null;

    // CRDT 문서
    this.documents = new Map(); // collection:docId -> CRDTDocument

    // 오프라인 큐
    this.offlineQueue = [];
    this.queueProcessing = false;

    // 구독
    this.subscriptions = new Set();

    // 콜백
    this.onConnect = options.onConnect || (() => {});
    this.onDisconnect = options.onDisconnect || (() => {});
    this.onChange = options.onChange || (() => {});
    this.onConflict = options.onConflict || null; // UI에서 충돌 선택

    // 스토리지
    this.storage = options.storage || (
      typeof indexedDB !== 'undefined' ? StorageAdapters.indexedDB() :
      typeof localStorage !== 'undefined' ? StorageAdapters.localStorage() :
      StorageAdapters.memory()
    );

    // 자동 연결
    if (options.autoConnect !== false) this.connect();
  }

  // ===== 연결 관리 =====
  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        console.log('[kimdb] Connected');

        // 구독 복원
        for (const col of this.subscriptions) {
          this.ws.send(JSON.stringify({ type: 'subscribe', collection: col }));
        }

        // 오프라인 큐 처리
        this._flushQueue();
        this.onConnect();
      };

      this.ws.onclose = () => {
        this.connected = false;
        console.log('[kimdb] Disconnected');
        this.onDisconnect();
        this._scheduleReconnect();
      };

      this.ws.onerror = (e) => {
        console.error('[kimdb] WebSocket error:', e);
      };

      this.ws.onmessage = (e) => this._handleMessage(JSON.parse(e.data));

    } catch (e) {
      console.error('[kimdb] Connect error:', e);
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
    this.reconnectAttempts++;
    console.log(`[kimdb] Reconnecting in ${delay}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // ===== 메시지 처리 =====
  _handleMessage(msg) {
    switch (msg.type) {
      case 'connected':
        this.clientId = msg.clientId;
        break;

      case 'crdt_sync':
        // 원격 CRDT 작업 수신
        this._applyRemoteOps(msg.collection, msg.docId, msg.operations);
        break;

      case 'crdt_state':
        // 전체 상태 수신
        this._loadDocState(msg.collection, msg.docId, msg.state);
        break;

      case 'crdt_ops_ok':
      case 'crdt_set_ok':
      case 'crdt_list_insert_ok':
      case 'crdt_list_delete_ok':
        // 작업 확인됨
        break;

      case 'conflicts':
        // 충돌 목록
        if (this.onConflict) {
          for (const c of msg.conflicts) this.onConflict(c);
        }
        break;

      case 'error':
        console.error('[kimdb] Server error:', msg.message);
        break;
    }
  }

  _applyRemoteOps(collection, docId, operations) {
    const doc = this._getDoc(collection, docId);
    const applied = doc.applyRemoteBatch(operations);
    if (applied > 0) {
      this._saveDocLocal(collection, docId, doc);
      this.onChange({ collection, docId, data: doc.toObject(), operations });
    }
  }

  _loadDocState(collection, docId, state) {
    const key = `${collection}:${docId}`;
    const doc = CRDTDocument.fromJSON(state);
    this.documents.set(key, doc);
    this._saveDocLocal(collection, docId, doc);
    this.onChange({ collection, docId, data: doc.toObject(), full: true });
  }

  // ===== 문서 관리 =====
  _getDoc(collection, docId) {
    const key = `${collection}:${docId}`;
    if (!this.documents.has(key)) {
      this.documents.set(key, new CRDTDocument(this.nodeId, docId));
    }
    return this.documents.get(key);
  }

  async _saveDocLocal(collection, docId, doc) {
    const key = `doc:${collection}:${docId}`;
    await this.storage.set(key, doc.toJSON());
  }

  async _loadDocLocal(collection, docId) {
    const key = `doc:${collection}:${docId}`;
    const saved = await this.storage.get(key);
    if (saved) {
      const doc = CRDTDocument.fromJSON(saved);
      this.documents.set(`${collection}:${docId}`, doc);
      return doc;
    }
    return null;
  }

  // ===== 큐 관리 =====
  _enqueue(msg) {
    this.offlineQueue.push({ ...msg, queuedAt: Date.now() });
    this._saveQueue();
    if (this.connected) this._flushQueue();
  }

  async _flushQueue() {
    if (this.queueProcessing || !this.connected || this.offlineQueue.length === 0) return;
    this.queueProcessing = true;

    // 큐 압축: 같은 doc에 대한 연속 작업 병합
    const compressed = this._compressQueue();

    while (compressed.length > 0) {
      const batch = compressed.splice(0, 50); // 50개씩 처리
      this._send({ type: 'crdt_ops', operations: batch });
    }

    this.offlineQueue = [];
    await this._saveQueue();
    this.queueProcessing = false;
  }

  _compressQueue() {
    // 같은 문서의 연속 set 작업을 하나로 병합
    const result = [];
    const lastSetByPath = new Map();

    for (const op of this.offlineQueue) {
      if (op.type === 'map_set') {
        const pathKey = `${op.collection}:${op.docId}:${op.path.join('.')}`;
        lastSetByPath.set(pathKey, op);
      } else {
        result.push(op);
      }
    }

    // 마지막 set만 추가
    for (const op of lastSetByPath.values()) {
      result.push(op);
    }

    return result;
  }

  async _saveQueue() {
    await this.storage.set('offline_queue', this.offlineQueue);
  }

  async _loadQueue() {
    const saved = await this.storage.get('offline_queue');
    if (saved) this.offlineQueue = saved;
  }

  _send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  // ===== 공개 API =====

  // 컬렉션 구독
  subscribe(collection) {
    this.subscriptions.add(collection);
    if (this.connected) {
      this._send({ type: 'subscribe', collection });
    }
    return this;
  }

  unsubscribe(collection) {
    this.subscriptions.delete(collection);
    if (this.connected) {
      this._send({ type: 'unsubscribe', collection });
    }
    return this;
  }

  // 문서 가져오기
  async doc(collection, docId) {
    // 로컬에서 먼저 로드
    let doc = this._getDoc(collection, docId);
    const local = await this._loadDocLocal(collection, docId);
    if (local) doc = local;

    // 서버에서 최신 상태 요청
    if (this.connected) {
      this._send({ type: 'crdt_get', collection, docId });
    }

    return doc;
  }

  // 필드 설정
  set(collection, docId, path, value) {
    const doc = this._getDoc(collection, docId);
    const op = doc.set(path, value);

    this._saveDocLocal(collection, docId, doc);

    if (this.connected) {
      this._send({ type: 'crdt_set', collection, docId, path: typeof path === 'string' ? path.split('.') : path, value });
    } else {
      this._enqueue({ ...op, collection });
    }

    this.onChange({ collection, docId, data: doc.toObject(), local: true });
    return doc.toObject();
  }

  // 필드 삭제
  del(collection, docId, path) {
    const doc = this._getDoc(collection, docId);
    const op = doc.delete(path);

    this._saveDocLocal(collection, docId, doc);

    if (this.connected) {
      this._send({ type: 'crdt_ops', collection, docId, operations: [op] });
    } else {
      this._enqueue({ ...op, collection });
    }

    return doc.toObject();
  }

  // 값 읽기
  get(collection, docId, path) {
    const doc = this._getDoc(collection, docId);
    return path ? doc.get(path) : doc.toObject();
  }

  // 리스트 삽입
  listInsert(collection, docId, path, index, value) {
    const doc = this._getDoc(collection, docId);
    const op = doc.listInsert(path, index, value);

    this._saveDocLocal(collection, docId, doc);

    if (this.connected) {
      this._send({ type: 'crdt_list_insert', collection, docId, path: typeof path === 'string' ? path.split('.') : path, index, value });
    } else {
      this._enqueue({ ...op, collection });
    }

    return doc.toObject();
  }

  // 리스트 삭제
  listDelete(collection, docId, path, index) {
    const doc = this._getDoc(collection, docId);
    const op = doc.listDelete(path, index);
    if (!op) return doc.toObject();

    this._saveDocLocal(collection, docId, doc);

    if (this.connected) {
      this._send({ type: 'crdt_list_delete', collection, docId, path: typeof path === 'string' ? path.split('.') : path, index });
    } else {
      this._enqueue({ ...op, collection });
    }

    return doc.toObject();
  }

  // 리스트 배열 반환
  listGet(collection, docId, path) {
    const doc = this._getDoc(collection, docId);
    return doc.list(path).toArray();
  }

  // 텍스트 (RGA as string)
  text(collection, docId, path) {
    const doc = this._getDoc(collection, docId);
    return doc.list(path).toString();
  }

  // 텍스트 삽입
  textInsert(collection, docId, path, index, char) {
    return this.listInsert(collection, docId, path, index, char);
  }

  // 텍스트 삭제
  textDelete(collection, docId, path, index) {
    return this.listDelete(collection, docId, path, index);
  }

  // 충돌 해결 (UI에서 호출)
  resolveConflict(conflictId, choice) {
    this._send({ type: 'resolve_conflict', conflictId, choice });
  }

  // 상태 정보
  get status() {
    return {
      connected: this.connected,
      nodeId: this.nodeId,
      queueSize: this.offlineQueue.length,
      documentsCount: this.documents.size,
      subscriptions: [...this.subscriptions]
    };
  }
}

// ===== 내보내기 =====
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { KimDBClient, CRDTDocument, CRDTMap, RGA, VectorClock, StorageAdapters };
}
if (typeof window !== 'undefined') {
  window.KimDBClient = KimDBClient;
  window.KimDBCRDT = { CRDTDocument, CRDTMap, RGA, VectorClock };
}

export { KimDBClient, CRDTDocument, CRDTMap, RGA, VectorClock, StorageAdapters };
export default KimDBClient;
