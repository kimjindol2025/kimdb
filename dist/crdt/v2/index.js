/**
 * kimdb CRDT Engine v2.0.0
 *
 * 프로덕션 레벨 CRDT 구현
 * - LWW-Set (삭제 버그 수정)
 * - Op batching + Delta compression
 * - 3-way 자동 병합 (충돌 UI 제거)
 * - Snapshot 기반 초기 로드
 * - Rich Text (서식, 임베드)
 * - Collaborative Cursor
 *
 * 외부 의존성 없음
 */

// ===== Vector Clock =====
export class VectorClock {
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
      const t1 = this.clock[node] || 0;
      const t2 = otherClock[node] || 0;
      if (t1 > t2) thisGreater = true;
      if (t2 > t1) otherGreater = true;
    }
    if (thisGreater && !otherGreater) return 1;
    if (otherGreater && !thisGreater) return -1;
    return 0;
  }

  happensBefore(other) { return this.compare(other) === -1; }
  isConcurrent(other) { return this.compare(other) === 0; }
  clone() { return new VectorClock(this.nodeId, { ...this.clock }); }

  // Lamport timestamp (총 순서)
  lamport() {
    return Object.values(this.clock).reduce((a, b) => a + b, 0);
  }

  toJSON() { return { nodeId: this.nodeId, clock: this.clock }; }
  static fromJSON(j) { return new VectorClock(j.nodeId, j.clock); }
}

// ===== LWW-Set (Last-Writer-Wins Set) =====
// ORSet의 add-win 버그 수정 - 삭제가 확실하게 동작
export class LWWSet {
  constructor(nodeId) {
    this.nodeId = nodeId;
    this.clock = new VectorClock(nodeId);
    // elements: Map<valueKey, { value, addTime, removeTime }>
    // addTime > removeTime 이면 존재, removeTime > addTime 이면 삭제됨
    this.elements = new Map();
  }

  _key(value) {
    return JSON.stringify(value);
  }

  _now() {
    return Date.now() * 1000 + Math.floor(Math.random() * 1000); // 마이크로초 정밀도
  }

  add(value) {
    this.clock.tick();
    const key = this._key(value);
    const now = this._now();

    const existing = this.elements.get(key);
    if (existing) {
      existing.addTime = Math.max(existing.addTime, now);
    } else {
      this.elements.set(key, { value, addTime: now, removeTime: 0 });
    }

    return {
      type: 'lwwset_add',
      value,
      addTime: now,
      clock: this.clock.clone().toJSON(),
      nodeId: this.nodeId
    };
  }

  remove(value) {
    this.clock.tick();
    const key = this._key(value);
    const now = this._now();

    const existing = this.elements.get(key);
    if (existing) {
      existing.removeTime = Math.max(existing.removeTime, now);
    } else {
      // 존재하지 않아도 tombstone 생성 (지연된 add 대비)
      this.elements.set(key, { value, addTime: 0, removeTime: now });
    }

    return {
      type: 'lwwset_remove',
      value,
      removeTime: now,
      clock: this.clock.clone().toJSON(),
      nodeId: this.nodeId
    };
  }

  has(value) {
    const key = this._key(value);
    const el = this.elements.get(key);
    return el && el.addTime > el.removeTime;
  }

  applyRemote(op) {
    this.clock.merge(VectorClock.fromJSON(op.clock));
    const key = this._key(op.value);

    if (op.type === 'lwwset_add') {
      const existing = this.elements.get(key);
      if (existing) {
        existing.addTime = Math.max(existing.addTime, op.addTime);
      } else {
        this.elements.set(key, { value: op.value, addTime: op.addTime, removeTime: 0 });
      }
    } else if (op.type === 'lwwset_remove') {
      const existing = this.elements.get(key);
      if (existing) {
        existing.removeTime = Math.max(existing.removeTime, op.removeTime);
      } else {
        this.elements.set(key, { value: op.value, addTime: 0, removeTime: op.removeTime });
      }
    }
  }

  toArray() {
    const result = [];
    for (const el of this.elements.values()) {
      if (el.addTime > el.removeTime) {
        result.push(el.value);
      }
    }
    return result;
  }

  // GC: 오래된 tombstone 제거 (메모리 관리)
  gc(maxAge = 24 * 60 * 60 * 1000) {
    const cutoff = this._now() - maxAge * 1000;
    for (const [key, el] of this.elements) {
      if (el.addTime < cutoff && el.removeTime < cutoff && el.removeTime > el.addTime) {
        this.elements.delete(key);
      }
    }
  }

  toJSON() {
    const elements = {};
    for (const [k, v] of this.elements) elements[k] = v;
    return { nodeId: this.nodeId, clock: this.clock.toJSON(), elements };
  }

  static fromJSON(j) {
    const set = new LWWSet(j.nodeId);
    set.clock = VectorClock.fromJSON(j.clock);
    for (const [k, v] of Object.entries(j.elements)) set.elements.set(k, v);
    return set;
  }
}

// ===== LWW-Map with 3-way Merge =====
export class LWWMap {
  constructor(nodeId) {
    this.nodeId = nodeId;
    this.clock = new VectorClock(nodeId);
    // fields: Map<key, { value, timestamp, nodeId, removed }>
    this.fields = new Map();
  }

  _now() {
    return Date.now() * 1000 + Math.floor(Math.random() * 1000);
  }

  set(key, value) {
    this.clock.tick();
    const now = this._now();

    this.fields.set(key, {
      value,
      timestamp: now,
      nodeId: this.nodeId,
      removed: false
    });

    return {
      type: 'map_set',
      key,
      value,
      timestamp: now,
      clock: this.clock.clone().toJSON(),
      nodeId: this.nodeId
    };
  }

  delete(key) {
    this.clock.tick();
    const now = this._now();

    this.fields.set(key, {
      value: null,
      timestamp: now,
      nodeId: this.nodeId,
      removed: true
    });

    return {
      type: 'map_delete',
      key,
      timestamp: now,
      clock: this.clock.clone().toJSON(),
      nodeId: this.nodeId
    };
  }

  get(key) {
    const field = this.fields.get(key);
    if (!field || field.removed) return undefined;
    return field.value;
  }

  has(key) {
    const field = this.fields.get(key);
    return field && !field.removed;
  }

  // 3-way merge: base, local, remote를 비교해서 자동 병합
  static merge3way(base, local, remote) {
    const result = new LWWMap(local.nodeId);
    result.clock = local.clock.clone().merge(remote.clock);

    const allKeys = new Set([
      ...local.fields.keys(),
      ...remote.fields.keys()
    ]);

    for (const key of allKeys) {
      const baseField = base?.fields.get(key);
      const localField = local.fields.get(key);
      const remoteField = remote.fields.get(key);

      // 둘 다 없으면 스킵
      if (!localField && !remoteField) continue;

      // 한쪽만 있으면 그쪽 사용
      if (!localField) {
        result.fields.set(key, { ...remoteField });
        continue;
      }
      if (!remoteField) {
        result.fields.set(key, { ...localField });
        continue;
      }

      // 둘 다 있으면
      // 1. base와 비교해서 어느 쪽이 변경했는지 확인
      const baseValue = baseField?.value;
      const localChanged = !baseField || localField.value !== baseValue || localField.removed !== (baseField?.removed || false);
      const remoteChanged = !baseField || remoteField.value !== baseValue || remoteField.removed !== (baseField?.removed || false);

      if (!localChanged && remoteChanged) {
        // remote만 변경 → remote 사용
        result.fields.set(key, { ...remoteField });
      } else if (localChanged && !remoteChanged) {
        // local만 변경 → local 사용
        result.fields.set(key, { ...localField });
      } else if (localChanged && remoteChanged) {
        // 둘 다 변경 → timestamp 비교 (LWW)
        if (remoteField.timestamp > localField.timestamp) {
          result.fields.set(key, { ...remoteField });
        } else if (localField.timestamp > remoteField.timestamp) {
          result.fields.set(key, { ...localField });
        } else {
          // 같은 timestamp → nodeId 비교 (deterministic)
          if (remoteField.nodeId > localField.nodeId) {
            result.fields.set(key, { ...remoteField });
          } else {
            result.fields.set(key, { ...localField });
          }
        }
      } else {
        // 둘 다 변경 안 함 → local 유지
        result.fields.set(key, { ...localField });
      }
    }

    return result;
  }

  applyRemote(op) {
    this.clock.merge(VectorClock.fromJSON(op.clock));
    const existing = this.fields.get(op.key);

    // LWW: timestamp 비교
    if (existing && existing.timestamp >= op.timestamp) {
      if (existing.timestamp === op.timestamp && op.nodeId > existing.nodeId) {
        // 같은 timestamp면 nodeId 비교
      } else {
        return; // 기존이 더 최신
      }
    }

    if (op.type === 'map_set') {
      this.fields.set(op.key, {
        value: op.value,
        timestamp: op.timestamp,
        nodeId: op.nodeId,
        removed: false
      });
    } else if (op.type === 'map_delete') {
      this.fields.set(op.key, {
        value: null,
        timestamp: op.timestamp,
        nodeId: op.nodeId,
        removed: true
      });
    }
  }

  toObject() {
    const obj = {};
    for (const [k, v] of this.fields) {
      if (!v.removed) obj[k] = v.value;
    }
    return obj;
  }

  keys() {
    return [...this.fields.keys()].filter(k => !this.fields.get(k).removed);
  }

  toJSON() {
    const fields = {};
    for (const [k, v] of this.fields) fields[k] = v;
    return { nodeId: this.nodeId, clock: this.clock.toJSON(), fields };
  }

  static fromJSON(j) {
    const map = new LWWMap(j.nodeId);
    map.clock = VectorClock.fromJSON(j.clock);
    for (const [k, v] of Object.entries(j.fields)) map.fields.set(k, v);
    return map;
  }
}

// ===== RGA (Replicated Growable Array) - 개선 =====
export class RGA {
  constructor(nodeId) {
    this.nodeId = nodeId;
    this.clock = new VectorClock(nodeId);
    this.elements = [];
    this.tombstones = new Set();
    this.idIndex = new Map(); // id -> index (빠른 검색)
  }

  _generateId() {
    this.clock.tick();
    return `${this.nodeId}_${this.clock.clock[this.nodeId]}_${Date.now()}`;
  }

  _rebuildIndex() {
    this.idIndex.clear();
    for (let i = 0; i < this.elements.length; i++) {
      this.idIndex.set(this.elements[i].id, i);
    }
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

  _findById(id) {
    const cached = this.idIndex.get(id);
    if (cached !== undefined && this.elements[cached]?.id === id) return cached;

    // 캐시 미스 시 선형 검색 + 캐시 갱신
    for (let i = 0; i < this.elements.length; i++) {
      if (this.elements[i].id === id) {
        this.idIndex.set(id, i);
        return i;
      }
    }
    return -1;
  }

  insert(index, value) {
    const id = this._generateId();
    const realIndex = this._findVisibleIndex(index - 1);
    const left = realIndex >= 0 ? this.elements[realIndex]?.id : null;

    const element = {
      id,
      value,
      clock: this.clock.clone().toJSON(),
      left
    };

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
    this._rebuildIndex();

    return { type: 'rga_insert', id, value, left, clock: element.clock };
  }

  delete(index) {
    const realIndex = this._findVisibleIndex(index);
    if (realIndex < 0 || realIndex >= this.elements.length) return null;

    const element = this.elements[realIndex];
    this.tombstones.add(element.id);
    this.clock.tick();

    return { type: 'rga_delete', id: element.id, clock: this.clock.clone().toJSON() };
  }

  applyRemote(op) {
    if (op.type === 'rga_insert') {
      if (this._findById(op.id) >= 0) return; // 이미 존재

      const opClock = VectorClock.fromJSON(op.clock);
      this.clock.merge(opClock);

      let insertAt = 0;
      if (op.left) {
        const leftIdx = this._findById(op.left);
        if (leftIdx >= 0) insertAt = leftIdx + 1;
      }

      while (insertAt < this.elements.length) {
        const el = this.elements[insertAt];
        if (el.left !== op.left) break;
        const elClock = VectorClock.fromJSON(el.clock);
        if (opClock.compare(elClock) > 0) break;
        if (opClock.compare(elClock) === 0 && op.clock.nodeId > el.clock.nodeId) break;
        insertAt++;
      }

      this.elements.splice(insertAt, 0, {
        id: op.id,
        value: op.value,
        clock: op.clock,
        left: op.left
      });
      this._rebuildIndex();

    } else if (op.type === 'rga_delete') {
      this.tombstones.add(op.id);
      this.clock.merge(VectorClock.fromJSON(op.clock));
    }
  }

  toArray() {
    return this.elements.filter(e => !this.tombstones.has(e.id)).map(e => e.value);
  }

  toString() {
    return this.toArray().join('');
  }

  length() {
    return this.elements.filter(e => !this.tombstones.has(e.id)).length;
  }

  // GC: tombstone 정리
  gc() {
    this.elements = this.elements.filter(e => !this.tombstones.has(e.id));
    this.tombstones.clear();
    this._rebuildIndex();
  }

  toJSON() {
    return {
      nodeId: this.nodeId,
      clock: this.clock.toJSON(),
      elements: this.elements,
      tombstones: [...this.tombstones]
    };
  }

  static fromJSON(j) {
    const rga = new RGA(j.nodeId);
    rga.clock = VectorClock.fromJSON(j.clock);
    rga.elements = j.elements || [];
    rga.tombstones = new Set(j.tombstones || []);
    rga._rebuildIndex();
    return rga;
  }
}

// ===== Rich Text CRDT =====
// 서식, 임베드 지원
export class RichText {
  constructor(nodeId) {
    this.nodeId = nodeId;
    this.clock = new VectorClock(nodeId);
    this.content = new RGA(nodeId); // { char, format }
    this.formats = new Map(); // id -> format object
  }

  _generateId() {
    this.clock.tick();
    return `${this.nodeId}_${this.clock.clock[this.nodeId]}`;
  }

  // 텍스트 삽입
  insert(index, char, format = {}) {
    const op = this.content.insert(index, { char, format, id: this._generateId() });
    return { ...op, richType: 'insert' };
  }

  // 텍스트 삭제
  delete(index) {
    const op = this.content.delete(index);
    return op ? { ...op, richType: 'delete' } : null;
  }

  // 서식 적용 (범위)
  format(startIndex, endIndex, formatAttrs) {
    this.clock.tick();
    const ops = [];
    const arr = this.content.elements.filter(e => !this.content.tombstones.has(e.id));

    let visibleIdx = 0;
    for (const el of arr) {
      if (visibleIdx >= startIndex && visibleIdx < endIndex) {
        el.value.format = { ...el.value.format, ...formatAttrs };
        ops.push({
          type: 'rich_format',
          id: el.id,
          format: formatAttrs,
          clock: this.clock.clone().toJSON()
        });
      }
      visibleIdx++;
    }

    return ops;
  }

  // 임베드 삽입 (이미지, 비디오 등)
  insertEmbed(index, embedType, embedData) {
    const op = this.content.insert(index, {
      embed: true,
      type: embedType,
      data: embedData,
      id: this._generateId()
    });
    return { ...op, richType: 'embed' };
  }

  applyRemote(op) {
    if (op.type === 'rga_insert' || op.type === 'rga_delete') {
      this.content.applyRemote(op);
    } else if (op.type === 'rich_format') {
      const idx = this.content._findById(op.id);
      if (idx >= 0 && this.content.elements[idx]) {
        this.content.elements[idx].value.format = {
          ...this.content.elements[idx].value.format,
          ...op.format
        };
      }
      this.clock.merge(VectorClock.fromJSON(op.clock));
    }
  }

  // Delta 형식으로 변환 (Quill 호환)
  toDelta() {
    const delta = [];
    let currentOp = null;

    for (const el of this.content.elements) {
      if (this.content.tombstones.has(el.id)) continue;

      const value = el.value;
      if (value.embed) {
        if (currentOp) {
          delta.push(currentOp);
          currentOp = null;
        }
        delta.push({ insert: { [value.type]: value.data } });
      } else {
        const formatKey = JSON.stringify(value.format || {});
        if (currentOp && JSON.stringify(currentOp.attributes || {}) === formatKey) {
          currentOp.insert += value.char;
        } else {
          if (currentOp) delta.push(currentOp);
          currentOp = { insert: value.char };
          if (value.format && Object.keys(value.format).length > 0) {
            currentOp.attributes = value.format;
          }
        }
      }
    }
    if (currentOp) delta.push(currentOp);

    return delta;
  }

  // Plain text
  toString() {
    return this.content.elements
      .filter(e => !this.content.tombstones.has(e.id) && !e.value.embed)
      .map(e => e.value.char)
      .join('');
  }

  toJSON() {
    return {
      nodeId: this.nodeId,
      clock: this.clock.toJSON(),
      content: this.content.toJSON()
    };
  }

  static fromJSON(j) {
    const rt = new RichText(j.nodeId);
    rt.clock = VectorClock.fromJSON(j.clock);
    rt.content = RGA.fromJSON(j.content);
    return rt;
  }
}

// ===== Collaborative Cursor =====
export class CursorManager {
  constructor(nodeId) {
    this.nodeId = nodeId;
    this.cursors = new Map(); // nodeId -> { position, selection, color, name, lastUpdate }
    this.localCursor = { position: 0, selection: null };
  }

  setLocal(position, selection = null) {
    this.localCursor = { position, selection };
    return {
      type: 'cursor_update',
      nodeId: this.nodeId,
      position,
      selection,
      timestamp: Date.now()
    };
  }

  applyRemote(op) {
    if (op.type === 'cursor_update' && op.nodeId !== this.nodeId) {
      this.cursors.set(op.nodeId, {
        position: op.position,
        selection: op.selection,
        color: op.color || this._generateColor(op.nodeId),
        name: op.name || op.nodeId.slice(0, 8),
        lastUpdate: op.timestamp
      });
    } else if (op.type === 'cursor_remove') {
      this.cursors.delete(op.nodeId);
    }
  }

  _generateColor(nodeId) {
    // nodeId를 해시해서 일관된 색상 생성
    let hash = 0;
    for (let i = 0; i < nodeId.length; i++) {
      hash = ((hash << 5) - hash) + nodeId.charCodeAt(i);
      hash |= 0;
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 70%, 50%)`;
  }

  getRemoteCursors() {
    // 30초 이상 업데이트 없으면 제거
    const cutoff = Date.now() - 30000;
    const result = [];
    for (const [nodeId, cursor] of this.cursors) {
      if (cursor.lastUpdate > cutoff) {
        result.push({ nodeId, ...cursor });
      } else {
        this.cursors.delete(nodeId);
      }
    }
    return result;
  }

  toJSON() {
    const cursors = {};
    for (const [k, v] of this.cursors) cursors[k] = v;
    return { nodeId: this.nodeId, cursors, localCursor: this.localCursor };
  }

  static fromJSON(j) {
    const cm = new CursorManager(j.nodeId);
    for (const [k, v] of Object.entries(j.cursors || {})) cm.cursors.set(k, v);
    cm.localCursor = j.localCursor || { position: 0, selection: null };
    return cm;
  }
}

// ===== Op Batcher + Delta Compression =====
export class OpBatcher {
  constructor(options = {}) {
    this.batchSize = options.batchSize || 50;
    this.batchTimeout = options.batchTimeout || 100; // ms
    this.ops = [];
    this.timer = null;
    this.onFlush = options.onFlush || (() => {});
  }

  add(op) {
    this.ops.push(op);

    if (this.ops.length >= this.batchSize) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.batchTimeout);
    }
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.ops.length === 0) return;

    // Delta compression: 같은 path에 대한 연속 set은 마지막만 유지
    const compressed = this._compress(this.ops);
    this.ops = [];

    this.onFlush(compressed);
  }

  _compress(ops) {
    const lastSetByPath = new Map();
    const result = [];

    for (const op of ops) {
      if (op.type === 'map_set') {
        const pathKey = `${op.docId || ''}:${(op.path || []).join('.')}:${op.key}`;
        lastSetByPath.set(pathKey, op);
      } else if (op.type === 'rga_insert' || op.type === 'rga_delete') {
        // RGA ops는 압축하지 않음 (순서 중요)
        result.push(op);
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

  // 네트워크 전송용 직렬화 (추가 압축)
  static serialize(ops) {
    // 간단한 압축: 반복되는 키 제거
    const typeMap = {
      'map_set': 0, 'map_delete': 1,
      'rga_insert': 2, 'rga_delete': 3,
      'lwwset_add': 4, 'lwwset_remove': 5,
      'rich_format': 6, 'cursor_update': 7
    };

    return ops.map(op => ({
      t: typeMap[op.type] ?? op.type,
      k: op.key,
      v: op.value,
      p: op.path,
      ts: op.timestamp,
      c: op.clock?.clock,
      n: op.nodeId,
      id: op.id,
      l: op.left
    }));
  }

  static deserialize(compressed) {
    const typeMapReverse = {
      0: 'map_set', 1: 'map_delete',
      2: 'rga_insert', 3: 'rga_delete',
      4: 'lwwset_add', 5: 'lwwset_remove',
      6: 'rich_format', 7: 'cursor_update'
    };

    return compressed.map(c => ({
      type: typeMapReverse[c.t] ?? c.t,
      key: c.k,
      value: c.v,
      path: c.p,
      timestamp: c.ts,
      clock: c.c ? { clock: c.c } : undefined,
      nodeId: c.n,
      id: c.id,
      left: c.l
    }));
  }
}

// ===== Snapshot Manager =====
export class SnapshotManager {
  constructor(options = {}) {
    this.snapshotInterval = options.snapshotInterval || 1000; // ops
    this.maxSnapshots = options.maxSnapshots || 5;
    this.snapshots = []; // { version, state, timestamp }
    this.opsSinceSnapshot = 0;
  }

  shouldSnapshot() {
    return this.opsSinceSnapshot >= this.snapshotInterval;
  }

  recordOp() {
    this.opsSinceSnapshot++;
  }

  createSnapshot(state, version) {
    const snapshot = {
      version,
      state: JSON.parse(JSON.stringify(state)), // deep clone
      timestamp: Date.now()
    };

    this.snapshots.push(snapshot);
    this.opsSinceSnapshot = 0;

    // 오래된 스냅샷 제거
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }

    return snapshot;
  }

  getLatestSnapshot() {
    return this.snapshots[this.snapshots.length - 1] || null;
  }

  getSnapshotAt(version) {
    // 해당 버전 이전의 가장 최근 스냅샷
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      if (this.snapshots[i].version <= version) {
        return this.snapshots[i];
      }
    }
    return null;
  }

  toJSON() {
    return {
      snapshotInterval: this.snapshotInterval,
      maxSnapshots: this.maxSnapshots,
      snapshots: this.snapshots,
      opsSinceSnapshot: this.opsSinceSnapshot
    };
  }

  static fromJSON(j) {
    const sm = new SnapshotManager({
      snapshotInterval: j.snapshotInterval,
      maxSnapshots: j.maxSnapshots
    });
    sm.snapshots = j.snapshots || [];
    sm.opsSinceSnapshot = j.opsSinceSnapshot || 0;
    return sm;
  }
}

// ===== CRDT Document v2 =====
export class CRDTDocument {
  constructor(nodeId, docId) {
    this.nodeId = nodeId;
    this.docId = docId;
    this.clock = new VectorClock(nodeId);
    this.root = new LWWMap(nodeId);
    this.lists = new Map();  // path -> RGA
    this.sets = new Map();   // path -> LWWSet
    this.richTexts = new Map(); // path -> RichText
    this.cursors = new CursorManager(nodeId);

    this.pendingOps = [];
    this.appliedOps = new Set();
    this.version = 0;

    this.snapshotManager = new SnapshotManager();
    this.baseSnapshot = null; // 3-way merge용
  }

  _pathKey(path) {
    return Array.isArray(path) ? path.join('.') : path;
  }

  // ===== Map Operations =====
  set(path, value) {
    if (typeof path === 'string') path = path.split('.');
    this.clock.tick();

    const key = path[path.length - 1];
    const op = this.root.set(key, { path, value });

    const fullOp = {
      ...op,
      docId: this.docId,
      path,
      opId: `${this.nodeId}_${this.version}_${Date.now()}`
    };

    this._recordOp(fullOp);
    return fullOp;
  }

  delete(path) {
    if (typeof path === 'string') path = path.split('.');
    this.clock.tick();

    const key = path[path.length - 1];
    const op = this.root.delete(key);

    const fullOp = {
      ...op,
      docId: this.docId,
      path,
      opId: `${this.nodeId}_${this.version}_${Date.now()}`
    };

    this._recordOp(fullOp);
    return fullOp;
  }

  get(path) {
    if (typeof path === 'string') path = path.split('.');
    const key = path[path.length - 1];
    const field = this.root.get(key);
    return field?.value;
  }

  // ===== List Operations =====
  list(path) {
    const key = this._pathKey(path);
    if (!this.lists.has(key)) {
      this.lists.set(key, new RGA(this.nodeId));
    }
    return this.lists.get(key);
  }

  listInsert(path, index, value) {
    const rga = this.list(path);
    const op = rga.insert(index, value);
    const fullOp = { ...op, docId: this.docId, path, opId: `${this.nodeId}_${this.version}_${Date.now()}` };
    this._recordOp(fullOp);
    return fullOp;
  }

  listDelete(path, index) {
    const rga = this.list(path);
    const op = rga.delete(index);
    if (!op) return null;
    const fullOp = { ...op, docId: this.docId, path, opId: `${this.nodeId}_${this.version}_${Date.now()}` };
    this._recordOp(fullOp);
    return fullOp;
  }

  listGet(path) {
    return this.list(path).toArray();
  }

  // ===== Set Operations =====
  setCollection(path) {
    const key = this._pathKey(path);
    if (!this.sets.has(key)) {
      this.sets.set(key, new LWWSet(this.nodeId));
    }
    return this.sets.get(key);
  }

  setAdd(path, value) {
    const set = this.setCollection(path);
    const op = set.add(value);
    const fullOp = { ...op, docId: this.docId, path, opId: `${this.nodeId}_${this.version}_${Date.now()}` };
    this._recordOp(fullOp);
    return fullOp;
  }

  setRemove(path, value) {
    const set = this.setCollection(path);
    const op = set.remove(value);
    const fullOp = { ...op, docId: this.docId, path, opId: `${this.nodeId}_${this.version}_${Date.now()}` };
    this._recordOp(fullOp);
    return fullOp;
  }

  setHas(path, value) {
    return this.setCollection(path).has(value);
  }

  setGet(path) {
    return this.setCollection(path).toArray();
  }

  // ===== Rich Text Operations =====
  richText(path) {
    const key = this._pathKey(path);
    if (!this.richTexts.has(key)) {
      this.richTexts.set(key, new RichText(this.nodeId));
    }
    return this.richTexts.get(key);
  }

  richInsert(path, index, char, format = {}) {
    const rt = this.richText(path);
    const op = rt.insert(index, char, format);
    const fullOp = { ...op, docId: this.docId, path, opId: `${this.nodeId}_${this.version}_${Date.now()}` };
    this._recordOp(fullOp);
    return fullOp;
  }

  richDelete(path, index) {
    const rt = this.richText(path);
    const op = rt.delete(index);
    if (!op) return null;
    const fullOp = { ...op, docId: this.docId, path, opId: `${this.nodeId}_${this.version}_${Date.now()}` };
    this._recordOp(fullOp);
    return fullOp;
  }

  richFormat(path, start, end, format) {
    const rt = this.richText(path);
    const ops = rt.format(start, end, format);
    const fullOps = ops.map(op => ({
      ...op, docId: this.docId, path, opId: `${this.nodeId}_${this.version}_${Date.now()}`
    }));
    fullOps.forEach(op => this._recordOp(op));
    return fullOps;
  }

  richInsertEmbed(path, index, embedType, embedData) {
    const rt = this.richText(path);
    const op = rt.insertEmbed(index, embedType, embedData);
    const fullOp = { ...op, docId: this.docId, path, opId: `${this.nodeId}_${this.version}_${Date.now()}` };
    this._recordOp(fullOp);
    return fullOp;
  }

  richGetDelta(path) {
    return this.richText(path).toDelta();
  }

  richGetText(path) {
    return this.richText(path).toString();
  }

  // ===== Cursor Operations =====
  setCursor(position, selection = null) {
    const op = this.cursors.setLocal(position, selection);
    return { ...op, docId: this.docId };
  }

  getRemoteCursors() {
    return this.cursors.getRemoteCursors();
  }

  // ===== Operation Recording =====
  _recordOp(op) {
    this.pendingOps.push(op);
    this.appliedOps.add(op.opId);
    this.version++;
    this.snapshotManager.recordOp();

    // 스냅샷 생성 조건 체크
    if (this.snapshotManager.shouldSnapshot()) {
      this.snapshotManager.createSnapshot(this.toJSON(), this.version);
    }
  }

  // ===== Remote Operations =====
  applyRemote(op) {
    if (this.appliedOps.has(op.opId)) return false;

    this.clock.merge(VectorClock.fromJSON(op.clock));

    if (op.type === 'map_set' || op.type === 'map_delete') {
      this.root.applyRemote(op);
    } else if (op.type === 'rga_insert' || op.type === 'rga_delete') {
      this.list(op.path).applyRemote(op);
    } else if (op.type === 'lwwset_add' || op.type === 'lwwset_remove') {
      this.setCollection(op.path).applyRemote(op);
    } else if (op.type === 'rich_format' || op.richType) {
      this.richText(op.path).applyRemote(op);
    } else if (op.type === 'cursor_update' || op.type === 'cursor_remove') {
      this.cursors.applyRemote(op);
    }

    this.appliedOps.add(op.opId);
    this.version++;
    this.snapshotManager.recordOp();

    return true;
  }

  applyRemoteBatch(ops) {
    // 인과적 순서 정렬
    ops.sort((a, b) => {
      const clockA = VectorClock.fromJSON(a.clock);
      const clockB = VectorClock.fromJSON(b.clock);
      const cmp = clockA.compare(clockB);
      if (cmp !== 0) return cmp;
      return (a.timestamp || 0) - (b.timestamp || 0);
    });

    let applied = 0;
    for (const op of ops) {
      if (this.applyRemote(op)) applied++;
    }
    return applied;
  }

  // ===== 3-way Merge =====
  merge(remoteDoc) {
    // base = 마지막 공통 상태 (snapshot)
    const base = this.baseSnapshot;

    // 새로운 병합된 root 생성
    this.root = LWWMap.merge3way(
      base?.root ? LWWMap.fromJSON(base.root) : null,
      this.root,
      remoteDoc.root
    );

    // clock 병합
    this.clock.merge(remoteDoc.clock);

    // 현재 상태를 새로운 base로
    this.baseSnapshot = {
      root: this.root.toJSON(),
      timestamp: Date.now()
    };
  }

  // ===== Pending Ops =====
  flushPendingOps() {
    const ops = this.pendingOps;
    this.pendingOps = [];
    return ops;
  }

  // ===== Snapshot =====
  getSnapshot() {
    return this.snapshotManager.getLatestSnapshot();
  }

  loadFromSnapshot(snapshot, opsAfter = []) {
    const state = CRDTDocument.fromJSON(snapshot.state);
    this.root = state.root;
    this.clock = state.clock;
    this.lists = state.lists;
    this.sets = state.sets;
    this.richTexts = state.richTexts;
    this.version = snapshot.version;

    // 스냅샷 이후의 ops 적용
    this.applyRemoteBatch(opsAfter);
  }

  // ===== Serialization =====
  toObject() {
    const obj = {};

    // Map data
    for (const [k, v] of this.root.fields) {
      if (!v.removed && v.value?.value !== undefined) {
        obj[k] = v.value.value;
      }
    }

    // Lists
    for (const [path, rga] of this.lists) {
      const parts = path.split('.');
      let target = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!target[parts[i]]) target[parts[i]] = {};
        target = target[parts[i]];
      }
      target[parts[parts.length - 1]] = rga.toArray();
    }

    // Sets
    for (const [path, set] of this.sets) {
      const parts = path.split('.');
      let target = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!target[parts[i]]) target[parts[i]] = {};
        target = target[parts[i]];
      }
      target[parts[parts.length - 1]] = set.toArray();
    }

    return obj;
  }

  toJSON() {
    const lists = {}, sets = {}, richTexts = {};
    for (const [k, v] of this.lists) lists[k] = v.toJSON();
    for (const [k, v] of this.sets) sets[k] = v.toJSON();
    for (const [k, v] of this.richTexts) richTexts[k] = v.toJSON();

    return {
      nodeId: this.nodeId,
      docId: this.docId,
      clock: this.clock.toJSON(),
      root: this.root.toJSON(),
      lists,
      sets,
      richTexts,
      cursors: this.cursors.toJSON(),
      version: this.version,
      appliedOps: [...this.appliedOps].slice(-2000),
      snapshotManager: this.snapshotManager.toJSON()
    };
  }

  static fromJSON(j) {
    const doc = new CRDTDocument(j.nodeId, j.docId);
    doc.clock = VectorClock.fromJSON(j.clock);
    doc.root = LWWMap.fromJSON(j.root);
    doc.version = j.version || 0;
    doc.appliedOps = new Set(j.appliedOps || []);

    for (const [k, v] of Object.entries(j.lists || {})) {
      doc.lists.set(k, RGA.fromJSON(v));
    }
    for (const [k, v] of Object.entries(j.sets || {})) {
      doc.sets.set(k, LWWSet.fromJSON(v));
    }
    for (const [k, v] of Object.entries(j.richTexts || {})) {
      doc.richTexts.set(k, RichText.fromJSON(v));
    }
    if (j.cursors) {
      doc.cursors = CursorManager.fromJSON(j.cursors);
    }
    if (j.snapshotManager) {
      doc.snapshotManager = SnapshotManager.fromJSON(j.snapshotManager);
    }

    return doc;
  }
}

// ===== Undo/Redo Manager =====
export class UndoManager {
  constructor(options = {}) {
    this.maxHistory = options.maxHistory || 100;
    this.undoStack = [];  // { ops, inverseOps, timestamp }
    this.redoStack = [];
    this.captureTimeout = options.captureTimeout || 500; // ms
    this.pendingOps = [];
    this.pendingTimer = null;
    this.trackedPaths = options.trackedPaths || null; // null = 전체, ['content'] = content만
  }

  // Op 역연산 생성
  invertOp(op) {
    switch (op.type) {
      case 'map_set':
        // set의 역은 이전 값으로 set (또는 delete)
        if (op.previousValue !== undefined) {
          return {
            ...op,
            type: 'map_set',
            value: op.previousValue,
            previousValue: op.value
          };
        } else {
          return {
            ...op,
            type: 'map_delete',
            previousValue: op.value
          };
        }

      case 'map_delete':
        // delete의 역은 이전 값으로 set
        return {
          ...op,
          type: 'map_set',
          value: op.previousValue,
          previousValue: undefined
        };

      case 'rga_insert':
        // insert의 역은 delete
        return {
          ...op,
          type: 'rga_delete'
        };

      case 'rga_delete':
        // delete의 역은 insert
        return {
          ...op,
          type: 'rga_insert',
          value: op.deletedValue
        };

      case 'lwwset_add':
        // add의 역은 remove
        return {
          ...op,
          type: 'lwwset_remove',
          removeTime: op.addTime + 1
        };

      case 'lwwset_remove':
        // remove의 역은 add
        return {
          ...op,
          type: 'lwwset_add',
          addTime: op.removeTime + 1
        };

      case 'rich_format':
        // format의 역은 이전 format으로 복원
        return {
          ...op,
          format: op.previousFormat || {}
        };

      default:
        return null;
    }
  }

  // Op 캡처 (tracked path인지 확인)
  capture(op, previousValue) {
    // 특정 path만 추적하는 경우
    if (this.trackedPaths && op.path) {
      const pathStr = Array.isArray(op.path) ? op.path[0] : op.path.split('.')[0];
      if (!this.trackedPaths.includes(pathStr)) return;
    }

    // 이전 값 저장
    const opWithPrev = { ...op, previousValue };

    this.pendingOps.push(opWithPrev);
    this.redoStack = []; // 새 작업 시 redo 스택 클리어

    // 500ms 내 연속 입력은 하나의 undo 단위로 묶음
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
    }
    this.pendingTimer = setTimeout(() => this._flushPending(), this.captureTimeout);
  }

  _flushPending() {
    if (this.pendingOps.length === 0) return;

    const ops = this.pendingOps;
    const inverseOps = ops.map(op => this.invertOp(op)).filter(Boolean).reverse();

    this.undoStack.push({
      ops,
      inverseOps,
      timestamp: Date.now()
    });

    // 최대 히스토리 유지
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }

    this.pendingOps = [];
    this.pendingTimer = null;
  }

  // Undo 가능 여부
  canUndo() {
    this._flushPending();
    return this.undoStack.length > 0;
  }

  // Redo 가능 여부
  canRedo() {
    return this.redoStack.length > 0;
  }

  // Undo 실행 - 역연산 ops 반환
  undo() {
    this._flushPending();

    if (this.undoStack.length === 0) return null;

    const entry = this.undoStack.pop();
    this.redoStack.push(entry);

    return entry.inverseOps;
  }

  // Redo 실행 - 원래 ops 반환
  redo() {
    if (this.redoStack.length === 0) return null;

    const entry = this.redoStack.pop();
    this.undoStack.push(entry);

    return entry.ops;
  }

  // 히스토리 클리어
  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.pendingOps = [];
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  // 상태
  get state() {
    return {
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
      pendingCount: this.pendingOps.length
    };
  }

  toJSON() {
    this._flushPending();
    return {
      undoStack: this.undoStack,
      redoStack: this.redoStack,
      maxHistory: this.maxHistory,
      captureTimeout: this.captureTimeout,
      trackedPaths: this.trackedPaths
    };
  }

  static fromJSON(j) {
    const um = new UndoManager({
      maxHistory: j.maxHistory,
      captureTimeout: j.captureTimeout,
      trackedPaths: j.trackedPaths
    });
    um.undoStack = j.undoStack || [];
    um.redoStack = j.redoStack || [];
    return um;
  }
}

// ===== Presence Manager =====
export class PresenceManager {
  constructor(nodeId, options = {}) {
    this.nodeId = nodeId;
    this.heartbeatInterval = options.heartbeatInterval || 10000; // 10초
    this.timeout = options.timeout || 30000; // 30초
    this.users = new Map(); // nodeId -> { name, color, avatar, cursor, lastSeen, status }
    this.localUser = {
      name: options.name || nodeId.slice(0, 8),
      color: options.color || this._generateColor(nodeId),
      avatar: options.avatar || null,
      status: 'online'
    };
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

  // 로컬 유저 정보 설정
  setLocalUser(info) {
    this.localUser = { ...this.localUser, ...info };
    return this.getPresenceUpdate();
  }

  // Presence 업데이트 메시지 생성
  getPresenceUpdate() {
    return {
      type: 'presence_update',
      nodeId: this.nodeId,
      user: this.localUser,
      timestamp: Date.now()
    };
  }

  // 로컬 유저 나감 메시지
  getPresenceLeave() {
    return {
      type: 'presence_leave',
      nodeId: this.nodeId,
      timestamp: Date.now()
    };
  }

  // 원격 유저 업데이트 적용
  applyRemote(msg) {
    if (msg.type === 'presence_update') {
      if (msg.nodeId === this.nodeId) return; // 자기 자신 무시

      this.users.set(msg.nodeId, {
        ...msg.user,
        nodeId: msg.nodeId,
        lastSeen: msg.timestamp
      });
    } else if (msg.type === 'presence_leave') {
      this.users.delete(msg.nodeId);
    }
  }

  // 커서 위치 업데이트
  updateCursor(position, selection = null) {
    this.localUser.cursor = { position, selection };
    return {
      type: 'presence_cursor',
      nodeId: this.nodeId,
      cursor: this.localUser.cursor,
      timestamp: Date.now()
    };
  }

  // 원격 커서 업데이트
  applyRemoteCursor(msg) {
    if (msg.nodeId === this.nodeId) return;

    const user = this.users.get(msg.nodeId);
    if (user) {
      user.cursor = msg.cursor;
      user.lastSeen = msg.timestamp;
    }
  }

  // 타임아웃된 유저 정리
  cleanup() {
    const now = Date.now();
    const removed = [];

    for (const [nodeId, user] of this.users) {
      if (now - user.lastSeen > this.timeout) {
        this.users.delete(nodeId);
        removed.push(nodeId);
      }
    }

    return removed;
  }

  // 온라인 유저 목록
  getOnlineUsers() {
    this.cleanup();
    const users = [];

    // 자기 자신 포함
    users.push({
      nodeId: this.nodeId,
      ...this.localUser,
      isLocal: true
    });

    // 원격 유저
    for (const [nodeId, user] of this.users) {
      users.push({
        nodeId,
        ...user,
        isLocal: false
      });
    }

    return users;
  }

  // 특정 유저 정보
  getUser(nodeId) {
    if (nodeId === this.nodeId) {
      return { nodeId: this.nodeId, ...this.localUser, isLocal: true };
    }
    return this.users.get(nodeId);
  }

  // 유저 수
  get count() {
    this.cleanup();
    return this.users.size + 1; // 자기 자신 포함
  }

  toJSON() {
    const users = {};
    for (const [k, v] of this.users) users[k] = v;
    return {
      nodeId: this.nodeId,
      localUser: this.localUser,
      users,
      heartbeatInterval: this.heartbeatInterval,
      timeout: this.timeout
    };
  }

  static fromJSON(j) {
    const pm = new PresenceManager(j.nodeId, {
      heartbeatInterval: j.heartbeatInterval,
      timeout: j.timeout,
      name: j.localUser.name,
      color: j.localUser.color,
      avatar: j.localUser.avatar
    });
    pm.localUser = j.localUser;
    for (const [k, v] of Object.entries(j.users || {})) {
      pm.users.set(k, v);
    }
    return pm;
  }
}

// ===== Export =====
export default {
  VectorClock,
  LWWSet,
  LWWMap,
  RGA,
  RichText,
  CursorManager,
  OpBatcher,
  SnapshotManager,
  CRDTDocument,
  UndoManager,
  PresenceManager
};
