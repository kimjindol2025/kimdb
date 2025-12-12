/**
 * kimdb CRDT Engine v1.0.0
 *
 * Automerge/Yjs 수준의 CRDT 직접 구현
 * 외부 의존성 없음
 *
 * 구현:
 * - Vector Clock (벡터 클럭)
 * - Lamport Timestamp (논리적 시간)
 * - Op-based CRDT (작업 기반)
 * - RGA (Replicated Growable Array) - 텍스트/리스트
 * - LWW-Register with Vector Clock
 * - OR-Set (Observed-Remove Set)
 * - Causal Order (인과적 순서 보장)
 */

// ===== Vector Clock =====
export class VectorClock {
  constructor(nodeId, clock = {}) {
    this.nodeId = nodeId;
    this.clock = { ...clock };
    if (!this.clock[nodeId]) {
      this.clock[nodeId] = 0;
    }
  }

  // 로컬 이벤트 발생
  tick() {
    this.clock[this.nodeId] = (this.clock[this.nodeId] || 0) + 1;
    return this.clone();
  }

  // 다른 클럭과 병합 (max 취함)
  merge(other) {
    const otherClock = other instanceof VectorClock ? other.clock : other;
    for (const [node, time] of Object.entries(otherClock)) {
      this.clock[node] = Math.max(this.clock[node] || 0, time);
    }
    return this;
  }

  // 비교: -1 (this < other), 0 (concurrent), 1 (this > other)
  compare(other) {
    const otherClock = other instanceof VectorClock ? other.clock : other;
    const allNodes = new Set([...Object.keys(this.clock), ...Object.keys(otherClock)]);

    let thisGreater = false;
    let otherGreater = false;

    for (const node of allNodes) {
      const thisTime = this.clock[node] || 0;
      const otherTime = otherClock[node] || 0;

      if (thisTime > otherTime) thisGreater = true;
      if (otherTime > thisTime) otherGreater = true;
    }

    if (thisGreater && !otherGreater) return 1;  // this > other
    if (otherGreater && !thisGreater) return -1; // this < other
    return 0; // concurrent (동시 발생)
  }

  // 인과적 순서 확인: other가 this 이후에 발생했는가?
  happensBefore(other) {
    return this.compare(other) === -1;
  }

  // 동시 발생 확인
  isConcurrent(other) {
    return this.compare(other) === 0;
  }

  clone() {
    return new VectorClock(this.nodeId, { ...this.clock });
  }

  toJSON() {
    return { nodeId: this.nodeId, clock: this.clock };
  }

  static fromJSON(json) {
    return new VectorClock(json.nodeId, json.clock);
  }

  // 고유 식별자 생성 (정렬 가능)
  toSortKey() {
    const sum = Object.values(this.clock).reduce((a, b) => a + b, 0);
    return `${sum.toString().padStart(10, '0')}_${this.nodeId}`;
  }
}

// ===== Operation =====
export class Operation {
  constructor(type, path, value, clock, nodeId) {
    this.id = `${nodeId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.type = type;       // 'set', 'delete', 'insert', 'remove', 'move'
    this.path = path;       // ['users', 'user1', 'name'] 형태의 경로
    this.value = value;     // 값 (set/insert 시)
    this.clock = clock;     // VectorClock
    this.nodeId = nodeId;
    this.timestamp = Date.now();
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      path: this.path,
      value: this.value,
      clock: this.clock instanceof VectorClock ? this.clock.toJSON() : this.clock,
      nodeId: this.nodeId,
      timestamp: this.timestamp
    };
  }

  static fromJSON(json) {
    const op = new Operation(
      json.type,
      json.path,
      json.value,
      VectorClock.fromJSON(json.clock),
      json.nodeId
    );
    op.id = json.id;
    op.timestamp = json.timestamp;
    return op;
  }
}

// ===== RGA (Replicated Growable Array) =====
// 텍스트, 리스트 등 순서가 있는 데이터용 CRDT
export class RGA {
  constructor(nodeId) {
    this.nodeId = nodeId;
    this.clock = new VectorClock(nodeId);
    // 각 요소: { id, value, deleted, clock, left }
    this.elements = [];
    this.tombstones = new Set(); // 삭제된 요소 ID
  }

  // 고유 ID 생성
  _generateId() {
    this.clock.tick();
    return `${this.nodeId}_${this.clock.clock[this.nodeId]}`;
  }

  // 위치 찾기 (삭제되지 않은 요소 기준)
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

  // ID로 위치 찾기
  _findById(id) {
    return this.elements.findIndex(e => e.id === id);
  }

  // 삽입 (index 위치에)
  insert(index, value) {
    const id = this._generateId();
    const realIndex = this._findVisibleIndex(index - 1);
    const left = realIndex >= 0 ? this.elements[realIndex]?.id : null;

    const element = {
      id,
      value,
      deleted: false,
      clock: this.clock.clone().toJSON(),
      left
    };

    // 삽입 위치 결정 (같은 left를 가진 요소 중 clock 순서로)
    let insertAt = realIndex + 1;
    while (insertAt < this.elements.length) {
      const el = this.elements[insertAt];
      if (el.left !== left) break;

      // clock 비교로 순서 결정
      const elClock = VectorClock.fromJSON(el.clock);
      if (this.clock.compare(elClock) > 0) break;
      if (this.clock.compare(elClock) === 0 && this.nodeId > el.clock.nodeId) break;
      insertAt++;
    }

    this.elements.splice(insertAt, 0, element);

    return {
      type: 'rga_insert',
      id,
      value,
      left,
      clock: this.clock.clone().toJSON()
    };
  }

  // 삭제 (index 위치)
  delete(index) {
    const realIndex = this._findVisibleIndex(index);
    if (realIndex < 0 || realIndex >= this.elements.length) return null;

    const element = this.elements[realIndex];
    element.deleted = true;
    this.tombstones.add(element.id);
    this.clock.tick();

    return {
      type: 'rga_delete',
      id: element.id,
      clock: this.clock.clone().toJSON()
    };
  }

  // 원격 작업 적용
  applyRemote(op) {
    if (op.type === 'rga_insert') {
      // 이미 있으면 무시
      if (this._findById(op.id) >= 0) return;

      const opClock = VectorClock.fromJSON(op.clock);
      this.clock.merge(opClock);

      // left 요소 찾기
      let insertAt = 0;
      if (op.left) {
        const leftIdx = this._findById(op.left);
        insertAt = leftIdx + 1;
      }

      // 같은 left를 가진 요소 중 올바른 위치 찾기
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
        deleted: false,
        clock: op.clock,
        left: op.left
      });

    } else if (op.type === 'rga_delete') {
      const idx = this._findById(op.id);
      if (idx >= 0 && !this.elements[idx].deleted) {
        this.elements[idx].deleted = true;
        this.tombstones.add(op.id);
      }
      this.clock.merge(VectorClock.fromJSON(op.clock));
    }
  }

  // 현재 배열 값 반환
  toArray() {
    return this.elements
      .filter(e => !this.tombstones.has(e.id))
      .map(e => e.value);
  }

  // 문자열 반환 (텍스트용)
  toString() {
    return this.toArray().join('');
  }

  toJSON() {
    return {
      nodeId: this.nodeId,
      clock: this.clock.toJSON(),
      elements: this.elements,
      tombstones: [...this.tombstones]
    };
  }

  static fromJSON(json) {
    const rga = new RGA(json.nodeId);
    rga.clock = VectorClock.fromJSON(json.clock);
    rga.elements = json.elements;
    rga.tombstones = new Set(json.tombstones);
    return rga;
  }
}

// ===== OR-Set (Observed-Remove Set) =====
// 동시 추가/삭제 충돌 해결
export class ORSet {
  constructor(nodeId) {
    this.nodeId = nodeId;
    this.clock = new VectorClock(nodeId);
    // elements: Map<value, Set<tag>>
    this.elements = new Map();
    // tombstones: Set<tag>
    this.tombstones = new Set();
  }

  _generateTag() {
    this.clock.tick();
    return `${this.nodeId}_${this.clock.clock[this.nodeId]}_${Date.now()}`;
  }

  add(value) {
    const tag = this._generateTag();
    const valueKey = JSON.stringify(value);

    if (!this.elements.has(valueKey)) {
      this.elements.set(valueKey, new Set());
    }
    this.elements.get(valueKey).add(tag);

    return {
      type: 'orset_add',
      value,
      tag,
      clock: this.clock.clone().toJSON()
    };
  }

  remove(value) {
    const valueKey = JSON.stringify(value);
    const tags = this.elements.get(valueKey);

    if (!tags || tags.size === 0) return null;

    this.clock.tick();
    const removedTags = [...tags];

    // 모든 태그를 tombstone으로 이동
    for (const tag of removedTags) {
      this.tombstones.add(tag);
    }
    this.elements.delete(valueKey);

    return {
      type: 'orset_remove',
      value,
      tags: removedTags,
      clock: this.clock.clone().toJSON()
    };
  }

  has(value) {
    const valueKey = JSON.stringify(value);
    const tags = this.elements.get(valueKey);
    return tags && tags.size > 0;
  }

  applyRemote(op) {
    if (op.type === 'orset_add') {
      // 이미 tombstone이면 무시 (add-wins 아님, remove-wins 아님 → 인과적 순서)
      if (this.tombstones.has(op.tag)) return;

      const valueKey = JSON.stringify(op.value);
      if (!this.elements.has(valueKey)) {
        this.elements.set(valueKey, new Set());
      }
      this.elements.get(valueKey).add(op.tag);
      this.clock.merge(VectorClock.fromJSON(op.clock));

    } else if (op.type === 'orset_remove') {
      for (const tag of op.tags) {
        this.tombstones.add(tag);
        // 모든 value에서 해당 tag 제거
        for (const [key, tags] of this.elements) {
          tags.delete(tag);
          if (tags.size === 0) {
            this.elements.delete(key);
          }
        }
      }
      this.clock.merge(VectorClock.fromJSON(op.clock));
    }
  }

  toArray() {
    return [...this.elements.keys()].map(k => JSON.parse(k));
  }

  toJSON() {
    const elements = {};
    for (const [k, v] of this.elements) {
      elements[k] = [...v];
    }
    return {
      nodeId: this.nodeId,
      clock: this.clock.toJSON(),
      elements,
      tombstones: [...this.tombstones]
    };
  }

  static fromJSON(json) {
    const set = new ORSet(json.nodeId);
    set.clock = VectorClock.fromJSON(json.clock);
    for (const [k, v] of Object.entries(json.elements)) {
      set.elements.set(k, new Set(v));
    }
    set.tombstones = new Set(json.tombstones);
    return set;
  }
}

// ===== LWW-Map with Vector Clock =====
// 필드별 독립 버전 관리
export class CRDTMap {
  constructor(nodeId) {
    this.nodeId = nodeId;
    this.clock = new VectorClock(nodeId);
    // fields: Map<key, { value, clock, nodeId, timestamp }>
    this.fields = new Map();
    // tombstones: Map<key, { clock, nodeId, timestamp }>
    this.tombstones = new Map();
  }

  set(key, value) {
    this.clock.tick();
    const entry = {
      value,
      clock: this.clock.clone().toJSON(),
      nodeId: this.nodeId,
      timestamp: Date.now()
    };
    this.fields.set(key, entry);
    this.tombstones.delete(key);

    return {
      type: 'map_set',
      key,
      value,
      clock: entry.clock,
      nodeId: this.nodeId,
      timestamp: entry.timestamp
    };
  }

  delete(key) {
    this.clock.tick();
    const entry = {
      clock: this.clock.clone().toJSON(),
      nodeId: this.nodeId,
      timestamp: Date.now()
    };
    this.fields.delete(key);
    this.tombstones.set(key, entry);

    return {
      type: 'map_delete',
      key,
      clock: entry.clock,
      nodeId: this.nodeId,
      timestamp: entry.timestamp
    };
  }

  get(key) {
    const entry = this.fields.get(key);
    return entry ? entry.value : undefined;
  }

  has(key) {
    return this.fields.has(key);
  }

  applyRemote(op) {
    const opClock = VectorClock.fromJSON(op.clock);
    this.clock.merge(opClock);

    if (op.type === 'map_set') {
      const existing = this.fields.get(op.key);
      const tombstone = this.tombstones.get(op.key);

      // 기존 값과 비교
      if (existing) {
        const existingClock = VectorClock.fromJSON(existing.clock);
        const cmp = opClock.compare(existingClock);

        if (cmp < 0) return; // 기존이 더 최신
        if (cmp === 0) {
          // 동시 발생: nodeId + timestamp로 결정 (deterministic)
          if (op.nodeId < existing.nodeId) return;
          if (op.nodeId === existing.nodeId && op.timestamp <= existing.timestamp) return;
        }
      }

      // tombstone 확인
      if (tombstone) {
        const tombClock = VectorClock.fromJSON(tombstone.clock);
        const cmp = opClock.compare(tombClock);
        if (cmp < 0) return; // 삭제가 더 최신
        if (cmp === 0 && op.timestamp <= tombstone.timestamp) return;
      }

      this.fields.set(op.key, {
        value: op.value,
        clock: op.clock,
        nodeId: op.nodeId,
        timestamp: op.timestamp
      });
      this.tombstones.delete(op.key);

    } else if (op.type === 'map_delete') {
      const existing = this.fields.get(op.key);

      if (existing) {
        const existingClock = VectorClock.fromJSON(existing.clock);
        const cmp = opClock.compare(existingClock);

        if (cmp < 0) return; // 기존 set이 더 최신
        if (cmp === 0 && op.timestamp <= existing.timestamp) return;
      }

      this.fields.delete(op.key);
      this.tombstones.set(op.key, {
        clock: op.clock,
        nodeId: op.nodeId,
        timestamp: op.timestamp
      });
    }
  }

  toObject() {
    const obj = {};
    for (const [k, v] of this.fields) {
      obj[k] = v.value;
    }
    return obj;
  }

  keys() {
    return [...this.fields.keys()];
  }

  toJSON() {
    const fields = {};
    for (const [k, v] of this.fields) {
      fields[k] = v;
    }
    const tombstones = {};
    for (const [k, v] of this.tombstones) {
      tombstones[k] = v;
    }
    return {
      nodeId: this.nodeId,
      clock: this.clock.toJSON(),
      fields,
      tombstones
    };
  }

  static fromJSON(json) {
    const map = new CRDTMap(json.nodeId);
    map.clock = VectorClock.fromJSON(json.clock);
    for (const [k, v] of Object.entries(json.fields)) {
      map.fields.set(k, v);
    }
    for (const [k, v] of Object.entries(json.tombstones)) {
      map.tombstones.set(k, v);
    }
    return map;
  }
}

// ===== CRDT Document =====
// 전체 문서를 관리하는 최상위 CRDT
export class CRDTDocument {
  constructor(nodeId, docId) {
    this.nodeId = nodeId;
    this.docId = docId;
    this.clock = new VectorClock(nodeId);
    this.root = new CRDTMap(nodeId);
    this.lists = new Map();  // path -> RGA
    this.sets = new Map();   // path -> ORSet
    this.pendingOps = [];    // 로컬 pending 작업
    this.appliedOps = new Set(); // 적용된 op ID
    this.version = 0;
  }

  // 경로 문자열화
  _pathKey(path) {
    return path.join('.');
  }

  // 중첩 맵 접근/생성
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

  // 값 설정
  set(path, value) {
    if (typeof path === 'string') path = path.split('.');

    this.clock.tick();
    const parentMap = this._getNestedMap(path);
    const key = path[path.length - 1];
    const op = parentMap.set(key, value);

    const fullOp = {
      ...op,
      docId: this.docId,
      path,
      opId: `${this.nodeId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    };

    this.pendingOps.push(fullOp);
    this.appliedOps.add(fullOp.opId);
    this.version++;

    return fullOp;
  }

  // 값 삭제
  delete(path) {
    if (typeof path === 'string') path = path.split('.');

    this.clock.tick();
    const parentMap = this._getNestedMap(path);
    const key = path[path.length - 1];
    const op = parentMap.delete(key);

    const fullOp = {
      ...op,
      docId: this.docId,
      path,
      opId: `${this.nodeId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    };

    this.pendingOps.push(fullOp);
    this.appliedOps.add(fullOp.opId);
    this.version++;

    return fullOp;
  }

  // 값 읽기
  get(path) {
    if (typeof path === 'string') path = path.split('.');

    let current = this.root;
    for (let i = 0; i < path.length; i++) {
      if (current instanceof CRDTMap) {
        current = current.get(path[i]);
      } else {
        return undefined;
      }
      if (current === undefined) return undefined;
    }

    if (current instanceof CRDTMap) {
      return current.toObject();
    }
    return current;
  }

  // 리스트 접근
  list(path) {
    if (typeof path === 'string') path = path.split('.');
    const key = this._pathKey(path);

    if (!this.lists.has(key)) {
      this.lists.set(key, new RGA(this.nodeId));
    }
    return this.lists.get(key);
  }

  // 리스트 삽입
  listInsert(path, index, value) {
    const rga = this.list(path);
    const op = rga.insert(index, value);

    const fullOp = {
      ...op,
      docId: this.docId,
      path,
      opId: `${this.nodeId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    };

    this.pendingOps.push(fullOp);
    this.appliedOps.add(fullOp.opId);
    this.version++;

    return fullOp;
  }

  // 리스트 삭제
  listDelete(path, index) {
    const rga = this.list(path);
    const op = rga.delete(index);
    if (!op) return null;

    const fullOp = {
      ...op,
      docId: this.docId,
      path,
      opId: `${this.nodeId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    };

    this.pendingOps.push(fullOp);
    this.appliedOps.add(fullOp.opId);
    this.version++;

    return fullOp;
  }

  // Set 접근
  set_collection(path) {
    if (typeof path === 'string') path = path.split('.');
    const key = this._pathKey(path);

    if (!this.sets.has(key)) {
      this.sets.set(key, new ORSet(this.nodeId));
    }
    return this.sets.get(key);
  }

  // 원격 작업 적용
  applyRemote(op) {
    // 이미 적용된 작업 무시
    if (this.appliedOps.has(op.opId)) return false;

    this.clock.merge(VectorClock.fromJSON(op.clock));

    if (op.type === 'map_set' || op.type === 'map_delete') {
      const parentMap = this._getNestedMap(op.path);
      parentMap.applyRemote(op);
    } else if (op.type === 'rga_insert' || op.type === 'rga_delete') {
      const rga = this.list(op.path);
      rga.applyRemote(op);
    } else if (op.type === 'orset_add' || op.type === 'orset_remove') {
      const set = this.set_collection(op.path);
      set.applyRemote(op);
    }

    this.appliedOps.add(op.opId);
    this.version++;
    return true;
  }

  // 여러 작업 일괄 적용
  applyRemoteBatch(ops) {
    // 인과적 순서로 정렬
    ops.sort((a, b) => {
      const clockA = VectorClock.fromJSON(a.clock);
      const clockB = VectorClock.fromJSON(b.clock);
      const cmp = clockA.compare(clockB);
      if (cmp !== 0) return cmp;
      return a.timestamp - b.timestamp;
    });

    let applied = 0;
    for (const op of ops) {
      if (this.applyRemote(op)) applied++;
    }
    return applied;
  }

  // pending 작업 가져오기 & 클리어
  flushPendingOps() {
    const ops = this.pendingOps;
    this.pendingOps = [];
    return ops;
  }

  // 전체 상태 반환
  toObject() {
    const obj = this.root.toObject();

    // 리스트 포함
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
    for (const [k, v] of this.lists) {
      lists[k] = v.toJSON();
    }
    const sets = {};
    for (const [k, v] of this.sets) {
      sets[k] = v.toJSON();
    }
    return {
      nodeId: this.nodeId,
      docId: this.docId,
      clock: this.clock.toJSON(),
      root: this.root.toJSON(),
      lists,
      sets,
      version: this.version,
      appliedOps: [...this.appliedOps].slice(-1000) // 최근 1000개만 유지
    };
  }

  static fromJSON(json) {
    const doc = new CRDTDocument(json.nodeId, json.docId);
    doc.clock = VectorClock.fromJSON(json.clock);
    doc.root = CRDTMap.fromJSON(json.root);
    doc.version = json.version;
    doc.appliedOps = new Set(json.appliedOps || []);

    for (const [k, v] of Object.entries(json.lists || {})) {
      doc.lists.set(k, RGA.fromJSON(v));
    }
    for (const [k, v] of Object.entries(json.sets || {})) {
      doc.sets.set(k, ORSet.fromJSON(v));
    }

    return doc;
  }
}

// ===== 충돌 감지 및 해결 =====
export class ConflictResolver {
  constructor() {
    this.conflicts = [];
    this.resolveStrategy = 'auto'; // 'auto', 'manual', 'callback'
    this.onConflict = null;
  }

  // 충돌 감지
  detectConflict(localOp, remoteOp) {
    if (localOp.path.join('.') !== remoteOp.path.join('.')) return null;
    if (localOp.key !== remoteOp.key) return null;

    const localClock = VectorClock.fromJSON(localOp.clock);
    const remoteClock = VectorClock.fromJSON(remoteOp.clock);

    if (localClock.isConcurrent(remoteClock)) {
      return {
        type: 'concurrent_write',
        path: localOp.path,
        key: localOp.key,
        local: { value: localOp.value, clock: localOp.clock, nodeId: localOp.nodeId },
        remote: { value: remoteOp.value, clock: remoteOp.clock, nodeId: remoteOp.nodeId }
      };
    }
    return null;
  }

  // 자동 해결 (deterministic)
  autoResolve(conflict) {
    // 1차: nodeId 비교 (알파벳 순으로 큰 쪽 승리)
    if (conflict.local.nodeId > conflict.remote.nodeId) {
      return { winner: 'local', value: conflict.local.value };
    } else if (conflict.local.nodeId < conflict.remote.nodeId) {
      return { winner: 'remote', value: conflict.remote.value };
    }

    // 2차: timestamp 비교
    const localSum = Object.values(conflict.local.clock.clock).reduce((a, b) => a + b, 0);
    const remoteSum = Object.values(conflict.remote.clock.clock).reduce((a, b) => a + b, 0);

    if (localSum >= remoteSum) {
      return { winner: 'local', value: conflict.local.value };
    }
    return { winner: 'remote', value: conflict.remote.value };
  }

  // 충돌 기록 (UI에서 나중에 해결)
  recordConflict(conflict) {
    conflict.id = `conflict_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    conflict.timestamp = Date.now();
    conflict.resolved = false;
    this.conflicts.push(conflict);

    if (this.onConflict) {
      this.onConflict(conflict);
    }

    return conflict;
  }

  // 수동 해결
  resolveManual(conflictId, choice) {
    const conflict = this.conflicts.find(c => c.id === conflictId);
    if (!conflict) return null;

    conflict.resolved = true;
    conflict.resolution = choice; // 'local' or 'remote' or custom value
    conflict.resolvedAt = Date.now();

    return conflict;
  }

  // 미해결 충돌 목록
  getPendingConflicts() {
    return this.conflicts.filter(c => !c.resolved);
  }
}

export default {
  VectorClock,
  Operation,
  RGA,
  ORSet,
  CRDTMap,
  CRDTDocument,
  ConflictResolver
};
