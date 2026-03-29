/**
 * kimdb - High-performance document database with CRDT real-time sync
 *
 * @packageDocumentation
 */

// Re-export server
export { KimDBServer, VERSION } from './server/index.js';
export { loadConfig, logConfig, generateEnvExample } from './server/config.js';
export type { Config } from './server/config.js';
export { KimDatabase } from './server/database.js';

// Re-export client
export { KimDBClient } from './client/index.js';
export type { KimDBClientOptions, ConnectionState } from './client/index.js';

// Re-export CRDT
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
  CRDT,
} from './crdt/index.js';

// Re-export types
export type {
  KimDBConfig,
  RedisConfig,
  MariaDBConfig,
  CacheConfig,
  VectorClockData,
  CRDTOperation,
  WSMessage,
  SQLRequest,
  SQLResponse,
  ServerMetrics,
  PresenceUser,
} from './shared/types.js';

// Default export
import { KimDBServer } from './server/index.js';
export default KimDBServer;
