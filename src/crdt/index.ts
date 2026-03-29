/**
 * kimdb CRDT Engine v2
 *
 * 프로덕션 레벨 CRDT 구현 (TypeScript)
 * - VectorClock: 인과적 순서 보장
 * - LWWSet: Last-Writer-Wins Set
 * - LWWMap: 3-way 자동 병합
 * - RGA: Replicated Growable Array
 * - RichText: 서식 지원 텍스트
 * - OpBatcher: 배치 처리 + 델타 압축
 * - SnapshotManager: 스냅샷 기반 로드
 * - UndoManager: Undo/Redo
 * - PresenceManager: 실시간 참여자 관리
 *
 * 외부 의존성 없음
 */

// Re-export from v2 implementation
export {
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
  PresenceManager,
  default as CRDT
} from './v2/index.js';

// Export types
export type {
  VectorClockData,
  CRDTOperation,
  MapSetOp,
  MapDeleteOp,
  RGAInsertOp,
  RGADeleteOp,
  LWWSetAddOp,
  LWWSetRemoveOp,
} from '../shared/types.js';
