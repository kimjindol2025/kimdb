/**
 * kimdb Client SDK v2.1.0
 *
 * Production-ready CRDT 클라이언트
 * - LWW-Set, 3-way merge
 * - Op batching + delta compression
 * - Snapshot 기반 초기 로드
 * - Rich Text + Collaborative Cursor
 * - Undo/Redo (Op Inversion)
 * - Presence (실시간 접속자 + 아바타)
 * - 자동 충돌 해결 (UI 팝업 없음)
 *
 * 브라우저/React Native/Node.js 호환
 */

import {
  VectorClock,
  CRDTDocument,
  OpBatcher,
  LWWMap
} from '../crdt/v2/index.js';

// ===== 스토리지 어댑터 =====
const StorageAdapters = {
  memory: () => {
    const store = new Map();
    return {
      get: (k) => Promise.resolve(store.get(k)),
      set: (k, v) => { store.set(k, v); return Promise.resolve(); },
      delete: (k) => { store.delete(k); return Promise.resolve(); },
      keys: () => Promise.resolve([...store.keys()]),
      clear: () => { store.clear(); return Promise.resolve(); }
    };
  },

  localStorage: (prefix = 'kimdb_') => ({
    get: (k) => {
      try {
        const v = localStorage.getItem(prefix + k);
        return Promise.resolve(v ? JSON.parse(v) : null);
      } catch { return Promise.resolve(null); }
    },
    set: (k, v) => {
      localStorage.setItem(prefix + k, JSON.stringify(v));
      return Promise.resolve();
    },
    delete: (k) => {
      localStorage.removeItem(prefix + k);
      return Promise.resolve();
    },
    keys: () => {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith(prefix)) keys.push(k.slice(prefix.length));
      }
      return Promise.resolve(keys);
    },
    clear: () => {
      const toDelete = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith(prefix)) toDelete.push(k);
      }
      toDelete.forEach(k => localStorage.removeItem(k));
      return Promise.resolve();
    }
  }),

  indexedDB: (dbName = 'kimdb', storeName = 'crdt') => {
    let db = null;
    const init = () => new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(dbName, 2);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(storeName)) {
          d.createObjectStore(storeName);
        }
      };
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
      },
      clear: async () => {
        const d = await init();
        return new Promise((resolve, reject) => {
          const tx = d.transaction(storeName, 'readwrite');
          const req = tx.objectStore(storeName).clear();
          req.onerror = () => reject(req.error);
          req.onsuccess = () => resolve();
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
    this.nodeId = options.nodeId || `client_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
    this.userName = options.userName || this.nodeId.slice(0, 8);
    this.userColor = options.userColor || this._generateColor(this.nodeId);

    // WebSocket
    this.ws = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectDelay = 30000;
    this.reconnectTimer = null;
    this.clientId = null;

    // CRDT 문서
    this.documents = new Map();

    // Op Batching
    this.opBatcher = new OpBatcher({
      batchSize: 50,
      batchTimeout: 100,
      onFlush: (ops) => this._sendBatch(ops)
    });

    // 오프라인 큐
    this.offlineQueue = [];

    // 구독
    this.subscriptions = new Set();

    // 이벤트 핸들러
    this.handlers = {
      connect: [],
      disconnect: [],
      change: [],
      cursor: [],
      presence: [],
      undo: [],
      error: []
    };

    // Undo/Redo 상태 (클라이언트별)
    this.undoState = new Map(); // collection:docId -> { canUndo, canRedo, undoCount, redoCount }

    // Presence 상태
    this.presence = {
      nodeId: null,
      users: new Map(), // collection:docId -> Map<nodeId, user>
      localUser: {
        name: options.userName || this.nodeId.slice(0, 8),
        color: options.userColor || this._generateColor(this.nodeId),
        avatar: options.avatar || null,
        status: 'online'
      },
      heartbeatTimer: null
    };

    // 스토리지
    this.storage = options.storage || this._detectStorage();

    // 초기화
    this._loadOfflineQueue();
    if (options.autoConnect !== false) this.connect();
  }

  _detectStorage() {
    if (typeof indexedDB !== 'undefined') {
      return StorageAdapters.indexedDB();
    } else if (typeof localStorage !== 'undefined') {
      return StorageAdapters.localStorage();
    }
    return StorageAdapters.memory();
  }

  _generateColor(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash) + id.charCodeAt(i);
      hash |= 0;
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 70%, 50%)`;
  }

  // ===== 이벤트 시스템 =====
  on(event, handler) {
    if (this.handlers[event]) {
      this.handlers[event].push(handler);
    }
    return () => this.off(event, handler);
  }

  off(event, handler) {
    if (this.handlers[event]) {
      this.handlers[event] = this.handlers[event].filter(h => h !== handler);
    }
  }

  _emit(event, data) {
    if (this.handlers[event]) {
      this.handlers[event].forEach(h => h(data));
    }
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
          this._send({ type: 'subscribe', collection: col });
        }

        // 오프라인 큐 처리
        this._flushOfflineQueue();
        this._emit('connect', { nodeId: this.nodeId });
      };

      this.ws.onclose = () => {
        this.connected = false;
        console.log('[kimdb] Disconnected');
        this._emit('disconnect', {});
        this._scheduleReconnect();
      };

      this.ws.onerror = (e) => {
        console.error('[kimdb] WebSocket error:', e);
        this._emit('error', { error: e });
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

  // ===== 메시지 처리 =====
  _send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  _sendBatch(ops) {
    if (!this._send({ type: 'crdt_ops', operations: OpBatcher.serialize(ops) })) {
      // 오프라인 → 큐에 추가
      this.offlineQueue.push(...ops);
      this._saveOfflineQueue();
    }
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'connected':
        this.clientId = msg.clientId;
        break;

      case 'snapshot':
        this._loadSnapshot(msg.collection, msg.docId, msg.snapshot, msg.version);
        break;

      case 'batch_ops':
        this._applyBatchOps(msg.ops);
        break;

      case 'crdt_sync':
        this._applyRemoteOps(msg.collection, msg.docId, msg.operations);
        break;

      case 'cursor_sync':
        this._handleCursor(msg.collection, msg.docId, msg.cursor);
        break;

      case 'rich_data':
        this._emit('change', {
          collection: msg.collection,
          docId: msg.docId,
          type: 'rich_data',
          delta: msg.delta,
          text: msg.text
        });
        break;

      case 'set_data':
        this._emit('change', {
          collection: msg.collection,
          docId: msg.docId,
          type: 'set_data',
          path: msg.path,
          values: msg.values
        });
        break;

      case 'merge_ok':
        this._loadSnapshot(msg.collection, msg.docId, msg.state, msg.version);
        break;

      // ===== Undo/Redo 메시지 =====
      case 'undo_capture_ok':
        this._updateUndoState(msg);
        break;

      case 'undo_ok':
        this._handleUndoOk(msg);
        break;

      case 'redo_ok':
        this._handleRedoOk(msg);
        break;

      case 'undo_empty':
      case 'redo_empty':
        this._emit('undo', { type: msg.type, empty: true });
        break;

      case 'undo_state':
        this._updateUndoState(msg);
        this._emit('undo', { type: 'state', ...msg });
        break;

      case 'undo_clear_ok':
        break;

      // ===== Presence 메시지 =====
      case 'presence_join_ok':
        this.presence.nodeId = msg.nodeId;
        this._handlePresenceUsers(msg.users);
        this._emit('presence', { type: 'joined', nodeId: msg.nodeId, users: msg.users });
        break;

      case 'presence_joined':
        this._handlePresenceJoined(msg);
        break;

      case 'presence_updated':
        this._handlePresenceUpdated(msg);
        break;

      case 'presence_cursor_moved':
        this._handlePresenceCursor(msg);
        break;

      case 'presence_left':
        this._handlePresenceLeft(msg);
        break;

      case 'presence_users':
        this._handlePresenceUsers(msg.users, msg.collection, msg.docId);
        this._emit('presence', { type: 'users', collection: msg.collection, docId: msg.docId, users: msg.users, count: msg.count });
        break;

      case 'presence_update_ok':
      case 'presence_leave_ok':
        break;

      case 'error':
        console.error('[kimdb] Server error:', msg.message);
        this._emit('error', { message: msg.message });
        break;
    }
  }

  // ===== Undo/Redo 핸들러 =====
  _updateUndoState(msg) {
    if (msg.state) {
      const key = msg.docId || 'global';
      this.undoState.set(key, {
        canUndo: msg.state.undoCount > 0,
        canRedo: msg.state.redoCount > 0,
        undoCount: msg.state.undoCount,
        redoCount: msg.state.redoCount
      });
    }
  }

  _handleUndoOk(msg) {
    this._updateUndoState(msg);

    // 로컬 문서 업데이트
    if (msg.operations && msg.docId) {
      // 서버에서 적용했으므로 로컬에도 적용 필요 없음 (crdt_sync로 올 것)
    }

    this._emit('undo', {
      type: 'undo',
      docId: msg.docId,
      operations: msg.operations,
      docVersion: msg.docVersion,
      state: msg.state
    });
  }

  _handleRedoOk(msg) {
    this._updateUndoState(msg);

    this._emit('undo', {
      type: 'redo',
      docId: msg.docId,
      operations: msg.operations,
      docVersion: msg.docVersion,
      state: msg.state
    });
  }

  // ===== Presence 핸들러 =====
  _handlePresenceUsers(users, collection, docId) {
    const key = collection && docId ? `${collection}:${docId}` : 'global';
    if (!this.presence.users.has(key)) {
      this.presence.users.set(key, new Map());
    }
    const usersMap = this.presence.users.get(key);
    usersMap.clear();
    for (const user of users) {
      usersMap.set(user.nodeId, user);
    }
  }

  _handlePresenceJoined(msg) {
    const key = `${msg.collection}:${msg.docId}`;
    if (!this.presence.users.has(key)) {
      this.presence.users.set(key, new Map());
    }
    this.presence.users.get(key).set(msg.user.nodeId, msg.user);
    this._emit('presence', {
      type: 'joined',
      collection: msg.collection,
      docId: msg.docId,
      user: msg.user
    });
  }

  _handlePresenceUpdated(msg) {
    const key = `${msg.collection}:${msg.docId}`;
    if (this.presence.users.has(key)) {
      this.presence.users.get(key).set(msg.nodeId, msg.user);
    }
    this._emit('presence', {
      type: 'updated',
      collection: msg.collection,
      docId: msg.docId,
      nodeId: msg.nodeId,
      user: msg.user
    });
  }

  _handlePresenceCursor(msg) {
    const key = `${msg.collection}:${msg.docId}`;
    if (this.presence.users.has(key)) {
      const user = this.presence.users.get(key).get(msg.nodeId);
      if (user) {
        user.cursor = msg.cursor;
      }
    }
    this._emit('presence', {
      type: 'cursor',
      collection: msg.collection,
      docId: msg.docId,
      nodeId: msg.nodeId,
      cursor: msg.cursor
    });
  }

  _handlePresenceLeft(msg) {
    const key = `${msg.collection}:${msg.docId}`;
    if (this.presence.users.has(key)) {
      this.presence.users.get(key).delete(msg.nodeId);
    }
    this._emit('presence', {
      type: 'left',
      collection: msg.collection,
      docId: msg.docId,
      nodeId: msg.nodeId
    });
  }

  _loadSnapshot(collection, docId, state, version) {
    const key = `${collection}:${docId}`;
    const doc = CRDTDocument.fromJSON(state);
    this.documents.set(key, doc);
    this._saveDocLocal(collection, docId, doc);

    this._emit('change', {
      collection,
      docId,
      type: 'snapshot',
      data: doc.toObject(),
      version
    });
  }

  _applyBatchOps(compressedOps) {
    const ops = OpBatcher.deserialize(compressedOps);
    for (const op of ops) {
      if (op.docId) {
        const key = `${op.collection || ''}:${op.docId}`;
        const doc = this.documents.get(key);
        if (doc) {
          doc.applyRemote(op);
        }
      }
    }
  }

  _applyRemoteOps(collection, docId, operations) {
    const doc = this._getDoc(collection, docId);
    const applied = doc.applyRemoteBatch(operations);

    if (applied > 0) {
      this._saveDocLocal(collection, docId, doc);
      this._emit('change', {
        collection,
        docId,
        type: 'remote',
        data: doc.toObject(),
        operations
      });
    }
  }

  _handleCursor(collection, docId, cursor) {
    this._emit('cursor', { collection, docId, cursor });
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
      return CRDTDocument.fromJSON(saved);
    }
    return null;
  }

  // ===== 오프라인 큐 =====
  async _saveOfflineQueue() {
    await this.storage.set('offline_queue', this.offlineQueue);
  }

  async _loadOfflineQueue() {
    const saved = await this.storage.get('offline_queue');
    if (saved) this.offlineQueue = saved;
  }

  async _flushOfflineQueue() {
    if (!this.connected || this.offlineQueue.length === 0) return;

    // 3-way merge로 오프라인 변경 병합
    const byDoc = new Map();
    for (const op of this.offlineQueue) {
      const key = `${op.collection || ''}:${op.docId}`;
      if (!byDoc.has(key)) byDoc.set(key, []);
      byDoc.get(key).push(op);
    }

    for (const [key, ops] of byDoc) {
      const [collection, docId] = key.split(':');
      const localDoc = this._getDoc(collection, docId);

      // 서버에 현재 상태 요청 후 병합
      this._send({
        type: 'merge_remote',
        collection,
        docId,
        remoteState: localDoc.toJSON()
      });
    }

    this.offlineQueue = [];
    await this._saveOfflineQueue();
  }

  // ===== Public API =====

  // 구독
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

  // 문서 초기 로드 (Snapshot 기반)
  async doc(collection, docId) {
    // 로컬 캐시 확인
    let doc = await this._loadDocLocal(collection, docId);
    if (doc) {
      this.documents.set(`${collection}:${docId}`, doc);
    } else {
      doc = this._getDoc(collection, docId);
    }

    // 서버에서 스냅샷 요청
    if (this.connected) {
      this._send({ type: 'get_snapshot', collection, docId });
    }

    return doc;
  }

  // === Map 연산 ===
  set(collection, docId, path, value) {
    const doc = this._getDoc(collection, docId);
    const op = doc.set(path, value);

    this._saveDocLocal(collection, docId, doc);

    if (this.connected) {
      this._send({
        type: 'crdt_set',
        collection,
        docId,
        path: typeof path === 'string' ? path.split('.') : path,
        value
      });
    } else {
      this.offlineQueue.push({ ...op, collection });
      this._saveOfflineQueue();
    }

    this._emit('change', {
      collection,
      docId,
      type: 'local',
      data: doc.toObject()
    });

    return doc.toObject();
  }

  get(collection, docId, path) {
    const doc = this._getDoc(collection, docId);
    return path ? doc.get(path) : doc.toObject();
  }

  delete(collection, docId, path) {
    const doc = this._getDoc(collection, docId);
    const op = doc.delete(path);

    this._saveDocLocal(collection, docId, doc);

    if (this.connected) {
      this.opBatcher.add({ ...op, collection });
    } else {
      this.offlineQueue.push({ ...op, collection });
      this._saveOfflineQueue();
    }

    return doc.toObject();
  }

  // === List 연산 ===
  listInsert(collection, docId, path, index, value) {
    const doc = this._getDoc(collection, docId);
    const op = doc.listInsert(path, index, value);

    this._saveDocLocal(collection, docId, doc);

    if (this.connected) {
      this._send({
        type: 'crdt_list_insert',
        collection,
        docId,
        path: typeof path === 'string' ? path.split('.') : path,
        index,
        value
      });
    } else {
      this.offlineQueue.push({ ...op, collection });
      this._saveOfflineQueue();
    }

    return doc.toObject();
  }

  listDelete(collection, docId, path, index) {
    const doc = this._getDoc(collection, docId);
    const op = doc.listDelete(path, index);

    if (op) {
      this._saveDocLocal(collection, docId, doc);

      if (this.connected) {
        this._send({
          type: 'crdt_list_delete',
          collection,
          docId,
          path: typeof path === 'string' ? path.split('.') : path,
          index
        });
      } else {
        this.offlineQueue.push({ ...op, collection });
        this._saveOfflineQueue();
      }
    }

    return doc.toObject();
  }

  listGet(collection, docId, path) {
    const doc = this._getDoc(collection, docId);
    return doc.listGet(path);
  }

  // === Set 연산 (LWW-Set) ===
  setAdd(collection, docId, path, value) {
    const doc = this._getDoc(collection, docId);
    const op = doc.setAdd(path, value);

    this._saveDocLocal(collection, docId, doc);

    if (this.connected) {
      this._send({ type: 'set_add', collection, docId, path, value });
    } else {
      this.offlineQueue.push({ ...op, collection });
      this._saveOfflineQueue();
    }

    return doc.setGet(path);
  }

  setRemove(collection, docId, path, value) {
    const doc = this._getDoc(collection, docId);
    const op = doc.setRemove(path, value);

    this._saveDocLocal(collection, docId, doc);

    if (this.connected) {
      this._send({ type: 'set_remove', collection, docId, path, value });
    } else {
      this.offlineQueue.push({ ...op, collection });
      this._saveOfflineQueue();
    }

    return doc.setGet(path);
  }

  setHas(collection, docId, path, value) {
    const doc = this._getDoc(collection, docId);
    return doc.setHas(path, value);
  }

  setGet(collection, docId, path) {
    const doc = this._getDoc(collection, docId);
    return doc.setGet(path);
  }

  // === Rich Text 연산 ===
  richInsert(collection, docId, path, index, char, format = {}) {
    const doc = this._getDoc(collection, docId);
    const op = doc.richInsert(path, index, char, format);

    this._saveDocLocal(collection, docId, doc);

    if (this.connected) {
      this._send({ type: 'rich_insert', collection, docId, path, index, char, format });
    } else {
      this.offlineQueue.push({ ...op, collection });
      this._saveOfflineQueue();
    }

    return doc.richGetText(path);
  }

  richDelete(collection, docId, path, index) {
    const doc = this._getDoc(collection, docId);
    const op = doc.richDelete(path, index);

    if (op) {
      this._saveDocLocal(collection, docId, doc);

      if (this.connected) {
        this._send({ type: 'rich_delete', collection, docId, path, index });
      } else {
        this.offlineQueue.push({ ...op, collection });
        this._saveOfflineQueue();
      }
    }

    return doc.richGetText(path);
  }

  richFormat(collection, docId, path, start, end, format) {
    const doc = this._getDoc(collection, docId);
    const ops = doc.richFormat(path, start, end, format);

    this._saveDocLocal(collection, docId, doc);

    if (this.connected) {
      this._send({ type: 'rich_format', collection, docId, path, start, end, format });
    } else {
      ops.forEach(op => this.offlineQueue.push({ ...op, collection }));
      this._saveOfflineQueue();
    }

    return doc.richGetDelta(path);
  }

  richInsertEmbed(collection, docId, path, index, embedType, embedData) {
    const doc = this._getDoc(collection, docId);
    const op = doc.richInsertEmbed(path, index, embedType, embedData);

    this._saveDocLocal(collection, docId, doc);

    if (this.connected) {
      this._send({ type: 'rich_embed', collection, docId, path, index, embedType, embedData });
    } else {
      this.offlineQueue.push({ ...op, collection });
      this._saveOfflineQueue();
    }

    return doc.richGetDelta(path);
  }

  richGetText(collection, docId, path) {
    const doc = this._getDoc(collection, docId);
    return doc.richGetText(path);
  }

  richGetDelta(collection, docId, path) {
    const doc = this._getDoc(collection, docId);
    return doc.richGetDelta(path);
  }

  // === Cursor 연산 ===
  setCursor(collection, docId, position, selection = null) {
    if (this.connected) {
      this._send({
        type: 'cursor_update',
        collection,
        docId,
        position,
        selection,
        color: this.userColor,
        name: this.userName
      });
    }
  }

  getCursors(collection, docId) {
    if (this.connected) {
      this._send({ type: 'get_cursors', collection, docId });
    }
    const doc = this._getDoc(collection, docId);
    return doc.getRemoteCursors();
  }

  // ===== Undo/Redo API =====

  /**
   * 작업을 Undo 스택에 저장 (자동으로 호출됨, 필요시 수동 호출)
   */
  captureUndo(collection, docId, op, previousValue = null) {
    if (this.connected) {
      this._send({
        type: 'undo_capture',
        collection,
        docId,
        op,
        previousValue
      });
    }
  }

  /**
   * Undo 실행
   */
  undo(collection, docId) {
    if (this.connected) {
      this._send({ type: 'undo', collection, docId });
      return true;
    }
    return false;
  }

  /**
   * Redo 실행
   */
  redo(collection, docId) {
    if (this.connected) {
      this._send({ type: 'redo', collection, docId });
      return true;
    }
    return false;
  }

  /**
   * Undo/Redo 상태 조회
   */
  getUndoState(collection, docId) {
    const key = docId || 'global';
    const state = this.undoState.get(key);
    if (state) return state;

    // 서버에서 최신 상태 요청
    if (this.connected) {
      this._send({ type: 'undo_state', collection, docId });
    }

    return { canUndo: false, canRedo: false, undoCount: 0, redoCount: 0 };
  }

  /**
   * Undo 가능 여부
   */
  canUndo(collection, docId) {
    return this.getUndoState(collection, docId).canUndo;
  }

  /**
   * Redo 가능 여부
   */
  canRedo(collection, docId) {
    return this.getUndoState(collection, docId).canRedo;
  }

  /**
   * Undo 히스토리 클리어
   */
  clearUndoHistory(collection, docId) {
    if (this.connected) {
      this._send({ type: 'undo_clear', collection, docId });
    }
    this.undoState.delete(docId || 'global');
  }

  // ===== Presence API =====

  /**
   * 문서에 참여 (Presence 시작)
   * @param {string} collection
   * @param {string} docId
   * @param {object} userInfo - { name, color, avatar }
   */
  joinPresence(collection, docId, userInfo = {}) {
    const user = {
      ...this.presence.localUser,
      ...userInfo
    };

    if (this.connected) {
      this._send({
        type: 'presence_join',
        collection,
        docId,
        user
      });

      // Heartbeat 시작 (10초마다)
      if (this.presence.heartbeatTimer) {
        clearInterval(this.presence.heartbeatTimer);
      }
      this.presence.heartbeatTimer = setInterval(() => {
        this._send({
          type: 'presence_update',
          collection,
          docId,
          user: this.presence.localUser
        });
      }, 10000);
    }

    return this;
  }

  /**
   * 문서에서 나가기
   */
  leavePresence(collection, docId) {
    if (this.presence.heartbeatTimer) {
      clearInterval(this.presence.heartbeatTimer);
      this.presence.heartbeatTimer = null;
    }

    if (this.connected) {
      this._send({ type: 'presence_leave', collection, docId });
    }

    const key = `${collection}:${docId}`;
    this.presence.users.delete(key);

    return this;
  }

  /**
   * 커서 위치 업데이트 (Presence)
   */
  updatePresenceCursor(collection, docId, position, selection = null) {
    if (this.connected) {
      this._send({
        type: 'presence_cursor',
        collection,
        docId,
        position,
        selection
      });
    }
  }

  /**
   * 현재 접속자 목록 조회
   */
  getPresenceUsers(collection, docId) {
    const key = `${collection}:${docId}`;
    const usersMap = this.presence.users.get(key);
    if (!usersMap) {
      // 서버에서 요청
      if (this.connected) {
        this._send({ type: 'presence_get', collection, docId });
      }
      return [];
    }
    return [...usersMap.values()];
  }

  /**
   * 접속자 수
   */
  getPresenceCount(collection, docId) {
    return this.getPresenceUsers(collection, docId).length;
  }

  /**
   * 로컬 유저 정보 설정
   */
  setLocalUser(info) {
    this.presence.localUser = { ...this.presence.localUser, ...info };
    return this.presence.localUser;
  }

  /**
   * 로컬 유저 정보 조회
   */
  getLocalUser() {
    return { ...this.presence.localUser, nodeId: this.presence.nodeId };
  }

  // === 상태 ===
  get status() {
    return {
      connected: this.connected,
      nodeId: this.nodeId,
      clientId: this.clientId,
      queueSize: this.offlineQueue.length,
      documentsCount: this.documents.size,
      subscriptions: [...this.subscriptions],
      presenceNodeId: this.presence.nodeId,
      presenceUsers: this.presence.users.size
    };
  }

  // === 정리 ===
  async clearCache() {
    await this.storage.clear();
    this.documents.clear();
    this.offlineQueue = [];
    this.undoState.clear();
  }

  disconnect() {
    // Presence 정리
    if (this.presence.heartbeatTimer) {
      clearInterval(this.presence.heartbeatTimer);
      this.presence.heartbeatTimer = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }
}

// ===== 내보내기 =====
export { KimDBClient, StorageAdapters };
export default KimDBClient;

// Browser global
if (typeof window !== 'undefined') {
  window.KimDBClient = KimDBClient;
}
