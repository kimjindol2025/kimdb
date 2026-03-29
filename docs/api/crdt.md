# CRDT API

> 프로덕션 레벨 충돌 없는 복제 데이터 타입 (Conflict-free Replicated Data Types)

## 개요

KimDB CRDT는 실시간 협업을 위한 완전한 솔루션:
- **VectorClock**: 인과적 순서 보장
- **LWWSet/LWWMap**: Last-Writer-Wins 자동 병합
- **RGA**: 텍스트/리스트 동시 편집
- **RichText**: 서식 + 임베드 (Quill 호환)
- **Presence**: 온라인 유저 + 커서 공유
- **Undo/Redo**: 편집 취소

**외부 의존성 없음** - Yjs, Automerge 없이 자체 구현

## 설치

```javascript
import {
  VectorClock,
  LWWSet,
  LWWMap,
  RGA,
  RichText,
  CRDTDocument,
  CursorManager,
  PresenceManager,
  UndoManager,
  OpBatcher,
  SnapshotManager
} from 'kimdb/crdt';
```

---

## VectorClock

인과적 순서를 추적하는 논리적 시계

### 생성자

```javascript
const clock = new VectorClock('node-1');
// 또는 기존 상태로 복원
const clock = new VectorClock('node-1', { 'node-1': 5, 'node-2': 3 });
```

### 메서드

#### `tick()`

로컬 시계 증가

```javascript
clock.tick();
// { 'node-1': 1 }
clock.tick();
// { 'node-1': 2 }
```

---

#### `merge(other)`

다른 시계와 병합

```javascript
const clockA = new VectorClock('A');
clockA.tick(); // { A: 1 }

const clockB = new VectorClock('B');
clockB.tick(); // { B: 1 }
clockB.tick(); // { B: 2 }

clockA.merge(clockB);
// { A: 1, B: 2 }
```

---

#### `compare(other)`

순서 비교

```javascript
clock1.compare(clock2);
// 1: clock1이 나중 (clock1 > clock2)
// -1: clock1이 이전 (clock1 < clock2)
// 0: 동시 (concurrent)
```

---

#### `happensBefore(other)`

인과적 선행 여부

```javascript
if (clock1.happensBefore(clock2)) {
  // clock1이 clock2보다 먼저 발생
}
```

---

#### `isConcurrent(other)`

동시성 여부

```javascript
if (clock1.isConcurrent(clock2)) {
  // 두 이벤트가 동시에 발생 (충돌 가능)
}
```

---

#### `lamport()`

Lamport 타임스탬프 (총 순서)

```javascript
const ts = clock.lamport();
// 모든 노드 카운터의 합
```

---

## LWWSet

Last-Writer-Wins Set - 삭제 가능한 집합

### 생성자

```javascript
const set = new LWWSet('node-1');
```

### 메서드

#### `add(value)`

요소 추가

```javascript
const op = set.add({ id: 'item-1', name: 'Apple' });
// op를 다른 노드에 전파
```

---

#### `remove(value)`

요소 제거

```javascript
const op = set.remove({ id: 'item-1', name: 'Apple' });
```

---

#### `has(value)`

포함 여부

```javascript
if (set.has({ id: 'item-1', name: 'Apple' })) {
  // 존재함
}
```

---

#### `toArray()`

배열로 변환

```javascript
const items = set.toArray();
// [{ id: 'item-1', name: 'Apple' }, ...]
```

---

#### `applyRemote(op)`

원격 작업 적용

```javascript
// 다른 노드에서 받은 op
set.applyRemote(op);
```

---

#### `gc(maxAge)`

오래된 tombstone 정리

```javascript
set.gc(24 * 60 * 60 * 1000); // 24시간 이전 tombstone 삭제
```

---

## LWWMap

Last-Writer-Wins Map with 3-way 자동 병합

### 생성자

```javascript
const map = new LWWMap('node-1');
```

### 메서드

#### `set(key, value)`

값 설정

```javascript
const op = map.set('title', 'Hello World');
```

---

#### `get(key)`

값 조회

```javascript
const title = map.get('title'); // 'Hello World'
```

---

#### `delete(key)`

값 삭제

```javascript
const op = map.delete('title');
```

---

#### `has(key)`

키 존재 여부

```javascript
if (map.has('title')) { ... }
```

---

#### `toObject()`

일반 객체로 변환

```javascript
const obj = map.toObject();
// { title: 'Hello World', author: 'Kim' }
```

---

#### `keys()`

키 목록

```javascript
const keys = map.keys(); // ['title', 'author']
```

---

### 3-way 병합

```javascript
// base: 공통 조상
// local: 로컬 변경
// remote: 원격 변경

const merged = LWWMap.merge3way(base, local, remote);
// 충돌 시 timestamp 비교 (LWW)
```

---

## RGA

Replicated Growable Array - 순서 있는 리스트

### 생성자

```javascript
const array = new RGA('node-1');
```

### 메서드

#### `insert(index, value)`

요소 삽입

```javascript
const op = array.insert(0, 'a');
array.insert(1, 'b');
array.insert(2, 'c');
// ['a', 'b', 'c']
```

---

#### `delete(index)`

요소 삭제

```javascript
const op = array.delete(1);
// ['a', 'c']
```

---

#### `toArray()`

배열로 변환

```javascript
const arr = array.toArray(); // ['a', 'c']
```

---

#### `toString()`

문자열로 변환 (텍스트용)

```javascript
array.insert(0, 'H');
array.insert(1, 'i');
array.toString(); // 'Hi'
```

---

#### `length()`

길이

```javascript
const len = array.length(); // 2
```

---

#### `gc()`

tombstone 정리

```javascript
array.gc();
```

---

## RichText

서식 있는 텍스트 (Quill 호환)

### 생성자

```javascript
const text = new RichText('node-1');
```

### 메서드

#### `insert(index, char, format)`

문자 삽입 (서식 포함)

```javascript
text.insert(0, 'H', { bold: true });
text.insert(1, 'e');
text.insert(2, 'l');
text.insert(3, 'l');
text.insert(4, 'o');
```

---

#### `delete(index)`

문자 삭제

```javascript
text.delete(4); // 'Hell'
```

---

#### `format(startIndex, endIndex, formatAttrs)`

범위 서식 적용

```javascript
text.format(0, 4, { bold: true, color: '#ff0000' });
```

---

#### `insertEmbed(index, embedType, embedData)`

임베드 삽입 (이미지, 비디오)

```javascript
text.insertEmbed(5, 'image', { src: 'photo.jpg', alt: 'Photo' });
```

---

#### `toDelta()`

Quill Delta 형식으로 변환

```javascript
const delta = text.toDelta();
// [
//   { insert: 'Hell', attributes: { bold: true, color: '#ff0000' } },
//   { insert: { image: { src: 'photo.jpg' } } }
// ]
```

---

#### `toString()`

일반 텍스트로 변환

```javascript
const plain = text.toString(); // 'Hello'
```

---

## CRDTDocument

모든 CRDT 타입을 통합한 문서

### 생성자

```javascript
const doc = new CRDTDocument('node-1', 'doc-123');
```

### Map 작업

```javascript
// 값 설정
const op = doc.set('title', 'My Document');
doc.set('author.name', 'Kim');

// 값 조회
const title = doc.get('title');

// 삭제
doc.delete('author.name');
```

### List 작업

```javascript
// 리스트 삽입
doc.listInsert('tags', 0, 'javascript');
doc.listInsert('tags', 1, 'database');

// 리스트 조회
const tags = doc.listGet('tags'); // ['javascript', 'database']

// 리스트 삭제
doc.listDelete('tags', 0);
```

### Set 작업

```javascript
// Set에 추가
doc.setAdd('collaborators', { id: 'u001', name: 'Kim' });

// Set에서 제거
doc.setRemove('collaborators', { id: 'u001', name: 'Kim' });

// 포함 여부
doc.setHas('collaborators', { id: 'u001', name: 'Kim' });

// Set 조회
const collaborators = doc.setGet('collaborators');
```

### RichText 작업

```javascript
// 텍스트 편집
doc.richInsert('content', 0, 'H', { bold: true });
doc.richDelete('content', 0);
doc.richFormat('content', 0, 5, { italic: true });

// 임베드
doc.richInsertEmbed('content', 10, 'image', { src: 'img.jpg' });

// 조회
const delta = doc.richGetDelta('content');
const text = doc.richGetText('content');
```

### 원격 동기화

```javascript
// 로컬 변경 → 원격 전파
const ops = doc.flushPendingOps();
sendToServer(ops);

// 원격 변경 → 로컬 적용
const remoteOps = receiveFromServer();
doc.applyRemoteBatch(remoteOps);
```

### 스냅샷

```javascript
// 현재 스냅샷
const snapshot = doc.getSnapshot();

// 스냅샷에서 복원
doc.loadFromSnapshot(snapshot, opsAfterSnapshot);
```

### 직렬화

```javascript
// 저장
const json = doc.toJSON();
localStorage.setItem('doc', JSON.stringify(json));

// 복원
const saved = JSON.parse(localStorage.getItem('doc'));
const doc = CRDTDocument.fromJSON(saved);

// 일반 객체로
const obj = doc.toObject();
```

---

## CursorManager

협업 커서 공유

### 생성자

```javascript
const cursors = new CursorManager('node-1');
```

### 메서드

```javascript
// 로컬 커서 설정
const op = cursors.setLocal(position, selection);
sendToOthers(op);

// 원격 커서 적용
cursors.applyRemote(remoteOp);

// 원격 커서 목록
const remoteCursors = cursors.getRemoteCursors();
// [{ nodeId: 'node-2', position: 50, color: '#ff0000', name: 'Kim' }]
```

---

## PresenceManager

온라인 유저 관리

### 생성자

```javascript
const presence = new PresenceManager('node-1', {
  name: 'Kim',
  color: '#ff0000',
  avatar: 'avatar.jpg'
});
```

### 메서드

```javascript
// 입장 메시지
const enterOp = presence.getPresenceUpdate();
broadcast(enterOp);

// 퇴장 메시지
const leaveOp = presence.getPresenceLeave();
broadcast(leaveOp);

// 원격 업데이트 적용
presence.applyRemote(remoteOp);

// 온라인 유저 목록
const users = presence.getOnlineUsers();
// [{ nodeId: 'node-1', name: 'Kim', color: '#ff0000', isLocal: true }, ...]
```

---

## UndoManager

편집 취소/다시 실행

### 생성자

```javascript
const undo = new UndoManager({
  maxHistory: 100,
  captureTimeout: 500  // 500ms 내 연속 입력은 하나로
});
```

### 메서드

```javascript
// 작업 캡처
undo.capture(op, previousValue);

// Undo 가능 여부
if (undo.canUndo()) {
  const inverseOps = undo.undo();
  inverseOps.forEach(op => doc.applyRemote(op));
}

// Redo 가능 여부
if (undo.canRedo()) {
  const ops = undo.redo();
  ops.forEach(op => doc.applyRemote(op));
}

// 상태
console.log(undo.state);
// { undoCount: 5, redoCount: 2, pendingCount: 0 }
```

---

## OpBatcher

작업 배치 + 압축

### 생성자

```javascript
const batcher = new OpBatcher({
  batchSize: 50,
  batchTimeout: 100,
  onFlush: (ops) => sendToServer(ops)
});
```

### 메서드

```javascript
// 작업 추가
batcher.add(op);

// 수동 플러시
batcher.flush();
```

### 압축

```javascript
// 네트워크 전송용 직렬화
const compressed = OpBatcher.serialize(ops);
// 복원
const ops = OpBatcher.deserialize(compressed);
```

---

## 예제

### 실시간 협업 에디터

```javascript
import { CRDTDocument, PresenceManager } from 'kimdb/crdt';

// 문서 생성
const doc = new CRDTDocument('user-1', 'document-1');
const presence = new PresenceManager('user-1', { name: 'Kim' });

// WebSocket 연결
const ws = new WebSocket('ws://server/doc/document-1');

ws.onopen = () => {
  // 입장 알림
  ws.send(JSON.stringify({ type: 'presence', data: presence.getPresenceUpdate() }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === 'ops') {
    // 원격 작업 적용
    doc.applyRemoteBatch(msg.data);
    renderDocument();
  } else if (msg.type === 'presence') {
    presence.applyRemote(msg.data);
    renderUsers();
  }
};

// 로컬 편집
function onUserInput(index, char) {
  const op = doc.richInsert('content', index, char);
  ws.send(JSON.stringify({ type: 'ops', data: [op] }));
  renderDocument();
}

// 커서 이동
function onCursorMove(position) {
  const op = doc.setCursor(position);
  ws.send(JSON.stringify({ type: 'cursor', data: op }));
}
```

### 오프라인 동기화

```javascript
// 오프라인 상태에서 편집
const doc = new CRDTDocument('user-1', 'doc-1');
doc.set('title', 'Offline edit');
doc.listInsert('items', 0, 'Item 1');

// 로컬 저장
localStorage.setItem('doc', JSON.stringify(doc.toJSON()));

// 온라인 복귀 시
const saved = CRDTDocument.fromJSON(JSON.parse(localStorage.getItem('doc')));
const localOps = saved.flushPendingOps();

// 서버와 동기화
const serverOps = await fetch('/sync', {
  method: 'POST',
  body: JSON.stringify({ ops: localOps })
}).then(r => r.json());

// 서버 변경 적용
doc.applyRemoteBatch(serverOps);
```
