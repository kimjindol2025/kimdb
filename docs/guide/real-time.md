# 실시간 협업 가이드

> Google Docs 스타일 실시간 편집 구현하기

## 개요

KimDB CRDT로 구현할 수 있는 것:
- 실시간 문서 편집 (Google Docs)
- 협업 화이트보드 (Miro)
- 멀티플레이어 게임 상태
- 실시간 대시보드

---

## 기본 구조

```
┌─────────────┐    WebSocket    ┌─────────────┐
│  Client A   │ ←───────────→ │   Server    │
│  (CRDT)     │                │  (Relay)    │
└─────────────┘                └─────────────┘
       ↑                              ↑
       │          WebSocket           │
       └──────────────────────────────┘
                  Client B
```

---

## 1. 서버 설정

```javascript
// server.js
import Fastify from 'fastify';
import websocket from '@fastify/websocket';

const fastify = Fastify();
await fastify.register(websocket);

// 문서별 클라이언트 관리
const rooms = new Map(); // docId → Set<connection>

fastify.register(async (app) => {
  app.get('/doc/:docId', { websocket: true }, (conn, req) => {
    const { docId } = req.params;

    // 방 입장
    if (!rooms.has(docId)) rooms.set(docId, new Set());
    rooms.get(docId).add(conn);

    // 메시지 브로드캐스트
    conn.on('message', (msg) => {
      const data = JSON.parse(msg);

      // 같은 방의 다른 클라이언트에게 전달
      for (const client of rooms.get(docId)) {
        if (client !== conn && client.readyState === 1) {
          client.send(msg);
        }
      }
    });

    // 퇴장
    conn.on('close', () => {
      rooms.get(docId).delete(conn);
    });
  });
});

await fastify.listen({ port: 3000 });
```

---

## 2. 클라이언트 설정

```javascript
// client.js
import { CRDTDocument, PresenceManager } from 'kimdb/crdt';

class CollaborativeDoc {
  constructor(userId, docId) {
    this.doc = new CRDTDocument(userId, docId);
    this.presence = new PresenceManager(userId, { name: userId });
    this.ws = null;
    this.onChange = null;
    this.onPresence = null;
  }

  // 서버 연결
  connect(serverUrl) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${serverUrl}/doc/${this.doc.docId}`);

      this.ws.onopen = () => {
        // 입장 알림
        this.send({ type: 'presence', data: this.presence.getPresenceUpdate() });
        resolve();
      };

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        this.handleMessage(msg);
      };

      this.ws.onerror = reject;
    });
  }

  // 메시지 처리
  handleMessage(msg) {
    switch (msg.type) {
      case 'ops':
        // 원격 작업 적용
        msg.data.forEach(op => this.doc.applyRemote(op));
        this.onChange?.(this.doc.toObject());
        break;

      case 'presence':
        this.presence.applyRemote(msg.data);
        this.onPresence?.(this.presence.getOnlineUsers());
        break;

      case 'cursor':
        this.doc.cursors.applyRemote(msg.data);
        break;
    }
  }

  // 메시지 전송
  send(msg) {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  // 편집 (로컬 + 전파)
  set(path, value) {
    const op = this.doc.set(path, value);
    this.send({ type: 'ops', data: [op] });
    this.onChange?.(this.doc.toObject());
    return op;
  }

  // 리스트 삽입
  listInsert(path, index, value) {
    const op = this.doc.listInsert(path, index, value);
    this.send({ type: 'ops', data: [op] });
    this.onChange?.(this.doc.toObject());
    return op;
  }

  // 커서 이동
  setCursor(position, selection) {
    const op = this.doc.setCursor(position, selection);
    this.send({ type: 'cursor', data: op });
  }

  // 종료
  disconnect() {
    this.send({ type: 'presence', data: this.presence.getPresenceLeave() });
    this.ws?.close();
  }
}

export default CollaborativeDoc;
```

---

## 3. React 통합

```jsx
// useCollaborativeDoc.js
import { useState, useEffect, useRef } from 'react';
import CollaborativeDoc from './client';

export function useCollaborativeDoc(userId, docId, serverUrl) {
  const [doc, setDoc] = useState({});
  const [users, setUsers] = useState([]);
  const [connected, setConnected] = useState(false);
  const clientRef = useRef(null);

  useEffect(() => {
    const client = new CollaborativeDoc(userId, docId);
    clientRef.current = client;

    client.onChange = setDoc;
    client.onPresence = setUsers;

    client.connect(serverUrl)
      .then(() => setConnected(true))
      .catch(console.error);

    return () => client.disconnect();
  }, [userId, docId, serverUrl]);

  const set = (path, value) => clientRef.current?.set(path, value);
  const listInsert = (path, index, value) => clientRef.current?.listInsert(path, index, value);

  return { doc, users, connected, set, listInsert };
}

// App.jsx
function App() {
  const { doc, users, connected, set } = useCollaborativeDoc(
    'user-123',
    'doc-456',
    'ws://localhost:3000'
  );

  if (!connected) return <div>연결 중...</div>;

  return (
    <div>
      <h1>접속자: {users.length}명</h1>
      <input
        value={doc.title || ''}
        onChange={(e) => set('title', e.target.value)}
        placeholder="제목"
      />
      <pre>{JSON.stringify(doc, null, 2)}</pre>
    </div>
  );
}
```

---

## 4. RichText 에디터

```javascript
import { CRDTDocument } from 'kimdb/crdt';

class RichTextEditor {
  constructor(userId, docId, ws) {
    this.doc = new CRDTDocument(userId, docId);
    this.ws = ws;
    this.path = 'content';
  }

  // 텍스트 입력
  insertText(index, text, format = {}) {
    const ops = [];
    for (let i = 0; i < text.length; i++) {
      const op = this.doc.richInsert(this.path, index + i, text[i], format);
      ops.push(op);
    }
    this.ws.send(JSON.stringify({ type: 'ops', data: ops }));
  }

  // 텍스트 삭제
  deleteText(index, length) {
    const ops = [];
    for (let i = 0; i < length; i++) {
      const op = this.doc.richDelete(this.path, index);
      if (op) ops.push(op);
    }
    this.ws.send(JSON.stringify({ type: 'ops', data: ops }));
  }

  // 서식 적용
  format(startIndex, endIndex, attrs) {
    const ops = this.doc.richFormat(this.path, startIndex, endIndex, attrs);
    this.ws.send(JSON.stringify({ type: 'ops', data: ops }));
  }

  // 이미지 삽입
  insertImage(index, src, alt) {
    const op = this.doc.richInsertEmbed(this.path, index, 'image', { src, alt });
    this.ws.send(JSON.stringify({ type: 'ops', data: [op] }));
  }

  // Quill Delta로 변환
  getDelta() {
    return this.doc.richGetDelta(this.path);
  }

  // 원격 작업 적용
  applyRemote(ops) {
    ops.forEach(op => this.doc.applyRemote(op));
  }
}
```

---

## 5. 협업 커서

```javascript
// 커서 표시 컴포넌트
function RemoteCursors({ doc }) {
  const cursors = doc.cursors.getRemoteCursors();

  return (
    <>
      {cursors.map(cursor => (
        <div
          key={cursor.nodeId}
          style={{
            position: 'absolute',
            left: cursor.position * 8, // 문자 폭
            backgroundColor: cursor.color,
            width: 2,
            height: 20
          }}
        >
          <span style={{ backgroundColor: cursor.color, color: '#fff', fontSize: 12 }}>
            {cursor.name}
          </span>
        </div>
      ))}
    </>
  );
}

// 커서 위치 업데이트
function handleSelectionChange(doc, ws) {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;

  const range = selection.getRangeAt(0);
  const position = range.startOffset;

  const op = doc.setCursor(position, {
    start: range.startOffset,
    end: range.endOffset
  });

  ws.send(JSON.stringify({ type: 'cursor', data: op }));
}
```

---

## 6. 오프라인 지원

```javascript
class OfflineFirstDoc {
  constructor(userId, docId) {
    this.doc = new CRDTDocument(userId, docId);
    this.pendingOps = [];
    this.online = false;
    this.ws = null;
  }

  // 로컬 저장소에서 복원
  async load() {
    const saved = localStorage.getItem(`doc:${this.doc.docId}`);
    if (saved) {
      const data = JSON.parse(saved);
      this.doc = CRDTDocument.fromJSON(data.doc);
      this.pendingOps = data.pendingOps || [];
    }
  }

  // 로컬 저장
  save() {
    localStorage.setItem(`doc:${this.doc.docId}`, JSON.stringify({
      doc: this.doc.toJSON(),
      pendingOps: this.pendingOps
    }));
  }

  // 편집 (오프라인 가능)
  edit(path, value) {
    const op = this.doc.set(path, value);

    if (this.online) {
      this.ws.send(JSON.stringify({ type: 'ops', data: [op] }));
    } else {
      this.pendingOps.push(op);
    }

    this.save();
  }

  // 온라인 복귀 시 동기화
  async sync() {
    if (this.pendingOps.length > 0) {
      this.ws.send(JSON.stringify({ type: 'ops', data: this.pendingOps }));
      this.pendingOps = [];
      this.save();
    }
  }

  // 연결 상태 변경
  setOnline(online, ws) {
    this.online = online;
    this.ws = ws;
    if (online) this.sync();
  }
}
```

---

## 7. 충돌 시나리오

### 시나리오 1: 같은 필드 동시 수정

```
Client A: set('title', 'Hello')  @ t=1000
Client B: set('title', 'World')  @ t=1001

결과: 'World' (LWW - 더 늦은 타임스탬프)
```

### 시나리오 2: 같은 위치 동시 삽입

```
Client A: insert(5, 'X')  @ t=1000
Client B: insert(5, 'Y')  @ t=1000

결과: 'XY' 또는 'YX' (일관되게 결정)
```

### 시나리오 3: 삭제 vs 수정

```
Client A: delete('title')
Client B: set('title', 'Hello')

결과: 타임스탬프 비교
- A가 나중 → 삭제
- B가 나중 → 'Hello'
```

모든 충돌은 **자동으로** 해결됩니다!
