/**
 * kimdb - High-performance document database with CRDT real-time sync
 *
 * @packageDocumentation
 */
export { KimDBServer, VERSION } from './server/index.js';
export { loadConfig, logConfig, generateEnvExample } from './server/config.js';
export type { Config } from './server/config.js';
export { KimDatabase } from './server/database.js';
export { KimDBClient } from './client/index.js';
export type { KimDBClientOptions, ConnectionState } from './client/index.js';
export { VectorClock, LWWSet, LWWMap, RGA, RichText, CursorManager, OpBatcher, SnapshotManager, CRDTDocument, UndoManager, PresenceManager, CRDT, } from './crdt/index.js';
export type { KimDBConfig, RedisConfig, MariaDBConfig, CacheConfig, VectorClockData, CRDTOperation, WSMessage, SQLRequest, SQLResponse, ServerMetrics, PresenceUser, } from './shared/types.js';
import { KimDBServer } from './server/index.js';
export default KimDBServer;
//# sourceMappingURL=index.d.ts.map