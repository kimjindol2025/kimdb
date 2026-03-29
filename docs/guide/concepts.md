# 핵심 개념

> KimDB의 설계 원리와 동작 방식

## 1. 버퍼링 쓰기

### 문제

SQLite는 쓰기 시 파일 락을 걸어 동시성이 제한됩니다.

```
요청 1 → [LOCK] 쓰기 → [UNLOCK]
요청 2 → .............. [LOCK] 쓰기 → [UNLOCK]
요청 3 → ............................ [LOCK] 쓰기 → [UNLOCK]
```

### 해결: 버퍼링

```
요청 1 → [버퍼에 추가] → 즉시 반환 (1ms)
요청 2 → [버퍼에 추가] → 즉시 반환 (1ms)
요청 3 → [버퍼에 추가] → 즉시 반환 (1ms)
         ↓ 100ms 후
      [배치 INSERT] → 3건 한 번에
```

### 효과

| 방식 | 1만 건 쓰기 | 지연시간 |
|------|------------|----------|
| 직접 쓰기 | 200ms | 20ms/건 |
| 버퍼링 | 11ms | 1ms/건 |

---

## 2. WAL 이중화

### 문제

버퍼 데이터는 메모리에만 있어서 크래시 시 유실됩니다.

### 해결: WAL 이중화

```
write() 호출
    ↓
[1] buffer.wal에 기록 (디스크)
    ↓
[2] 메모리 버퍼에 추가
    ↓
[3] 100ms 후 배치 INSERT
    ↓
[4] 성공 시 buffer.wal 클리어
```

### 크래시 복구

```javascript
// 서버 재시작 시
const db = new SimpleDB({ safeMode: true });
// [kimdb] Recovering 150 buffered writes from WAL...
// [kimdb] Recovered 150 writes
```

---

## 3. 샤딩

### 문제

단일 SQLite 파일은 동시 쓰기가 1개뿐입니다.

### 해결: 8샤드 병렬

```
┌─────────────────────────────────────┐
│           KimDB HyperScale          │
├─────────┬─────────┬─────────┬───────┤
│ Shard 0 │ Shard 1 │ Shard 2 │ ...   │
│  .db    │  .db    │  .db    │  .db  │
└─────────┴─────────┴─────────┴───────┘
```

### 샤드 결정

```javascript
const hash = md5(key);
const shardIndex = hash % 8;
```

### 효과

| 샤드 수 | 동시 쓰기 | 처리량 |
|--------|----------|--------|
| 1 | 1 | 50K/s |
| 4 | 4 | 200K/s |
| 8 | 8 | 400K/s |
| + 버퍼링 | 8 | 909K/s |

---

## 4. Read-After-Write

### 문제

버퍼링 하면 방금 쓴 데이터를 바로 읽을 수 없습니다.

### 해결: 캐시 동기화

```javascript
// 쓰기
write() → WAL기록 → 버퍼추가 → **캐시 업데이트**

// 읽기
read() → 캐시 확인 → 버퍼 확인 → DB 조회
```

```javascript
await db.set('users', 'u001', { name: 'Kim' });
const user = await db.get('users', 'u001');
// { name: 'Kim' } - 즉시 읽기 가능 (캐시에서)
```

---

## 5. CRDT (Conflict-free Replicated Data Types)

### 문제

여러 클라이언트가 동시에 같은 데이터를 수정하면 충돌이 발생합니다.

```
Client A: title = "Hello"
Client B: title = "World"
→ 누가 이김?
```

### 해결: LWW (Last-Writer-Wins)

```javascript
// 마이크로초 단위 타임스탬프로 결정
Client A: title = "Hello" @ 1705312200000001
Client B: title = "World" @ 1705312200000002
→ "World" 승 (더 늦은 타임스탬프)
```

### CRDT 종류

| 타입 | 충돌 해결 | 용도 |
|------|----------|------|
| LWWMap | 타임스탬프 비교 | JSON 문서 |
| LWWSet | 타임스탬프 비교 | 태그, 집합 |
| RGA | 위치 기반 삽입 | 텍스트, 리스트 |
| VectorClock | 인과적 순서 | 동시성 감지 |

---

## 6. VectorClock

### 문제

단순 타임스탬프는 시계 동기화 문제가 있습니다.

### 해결: 논리적 시계

```javascript
// 각 노드별 카운터 관리
Node A: { A: 5, B: 3 }
Node B: { A: 4, B: 6 }

// 병합
merge → { A: 5, B: 6 }
```

### 인과적 순서

```
A: {A:1} → {A:2} → {A:3}
              ↘
B:             {A:2, B:1} → {A:2, B:2}

{A:3}과 {A:2, B:2}는 동시(concurrent)
→ LWW로 해결
```

---

## 7. RGA (Replicated Growable Array)

### 문제

리스트에서 같은 위치에 동시 삽입하면?

```
[A, B, C]
Client 1: insert(1, 'X') → [A, X, B, C]
Client 2: insert(1, 'Y') → [A, Y, B, C]
→ 결과가 다름!
```

### 해결: 고유 ID + 정렬

```javascript
// 각 요소에 고유 ID 부여
[A@id1, B@id2, C@id3]

// 삽입 시 "어느 요소 뒤에" 삽입할지 기록
insert(after: id1, value: 'X')
insert(after: id1, value: 'Y')

// 같은 위치면 ID로 정렬
→ [A, X, Y, B, C] 또는 [A, Y, X, B, C]
  (일관되게 결정)
```

---

## 8. 스냅샷

### 문제

작업(op) 히스토리가 계속 쌓이면 메모리 폭발.

### 해결: 주기적 스냅샷

```
ops: [op1, op2, op3, ..., op1000]
               ↓ 1000개마다 스냅샷
snapshot: { state: {...}, version: 1000 }
ops: [op1001, op1002, ...]
```

### 새 클라이언트 동기화

```
1. 최신 스냅샷 다운로드 (전체 상태)
2. 스냅샷 이후 ops만 다운로드
3. ops 적용
→ 전체 히스토리 불필요
```

---

## 정리

```
┌─────────────────────────────────────────────────┐
│                   KimDB                         │
├─────────────────────────────────────────────────┤
│  [버퍼링] → 909K/s 쓰기                          │
│  [WAL]   → 크래시 복구                          │
│  [샤딩]  → 8배 병렬화                           │
│  [캐시]  → Read-After-Write                    │
│  [CRDT]  → 충돌 없는 동기화                      │
│  [스냅샷] → 메모리 효율                          │
└─────────────────────────────────────────────────┘
```
