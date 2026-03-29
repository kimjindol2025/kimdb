/**
 * kimdb Shared Types
 */

// ===== Configuration =====
export interface KimDBConfig {
  port: number;
  host: string;
  apiKey: string;
  dataDir: string;
  redis?: RedisConfig;
  mariadb?: MariaDBConfig;
  cache?: CacheConfig;
}

export interface RedisConfig {
  enabled: boolean;
  host: string;
  port: number;
  password?: string;
}

export interface MariaDBConfig {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface CacheConfig {
  maxDocs: number;
  docTTL: number;
  presenceTTL: number;
  undoTTL: number;
  cleanupInterval: number;
}

// ===== CRDT Types =====
export interface VectorClockData {
  nodeId: string;
  clock: Record<string, number>;
}

export interface CRDTOperation {
  type: string;
  opId: string;
  docId?: string;
  path?: string | string[];
  key?: string;
  value?: unknown;
  clock: VectorClockData;
  nodeId: string;
  timestamp?: number;
}

export interface MapSetOp extends CRDTOperation {
  type: 'map_set';
  key: string;
  value: unknown;
  previousValue?: unknown;
}

export interface MapDeleteOp extends CRDTOperation {
  type: 'map_delete';
  key: string;
}

export interface RGAInsertOp extends CRDTOperation {
  type: 'rga_insert';
  id: string;
  value: unknown;
  left: string | null;
}

export interface RGADeleteOp extends CRDTOperation {
  type: 'rga_delete';
  id: string;
}

export interface LWWSetAddOp extends CRDTOperation {
  type: 'lwwset_add';
  value: unknown;
  addTime: number;
}

export interface LWWSetRemoveOp extends CRDTOperation {
  type: 'lwwset_remove';
  value: unknown;
  removeTime: number;
}

// ===== WebSocket Messages =====
export interface WSMessage {
  type: string;
  [key: string]: unknown;
}

export interface WSConnectedMessage extends WSMessage {
  type: 'connected';
  clientId: string;
  serverId: string;
}

export interface WSSubscribeMessage extends WSMessage {
  type: 'subscribe';
  collection: string;
}

export interface WSCRDTGetMessage extends WSMessage {
  type: 'crdt_get';
  collection: string;
  docId: string;
}

export interface WSCRDTSetMessage extends WSMessage {
  type: 'crdt_set';
  collection: string;
  docId: string;
  path: string | string[];
  value: unknown;
}

export interface WSCRDTOpsMessage extends WSMessage {
  type: 'crdt_ops';
  collection: string;
  docId: string;
  operations: CRDTOperation[];
}

// ===== SQL Types =====
export interface SQLRequest {
  sql: string;
  params?: unknown[];
  collection: string;
}

export interface SQLResponse {
  success: boolean;
  rows?: unknown[];
  rowcount?: number;
  lastrowid?: number;
  updated?: number;
  deleted?: number;
  error?: string;
}

export interface ParsedSQL {
  type: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
  table: string | null;
  columns: string;
  where: SQLCondition[];
  orGroups?: SQLCondition[][];
  orderBy: string | null;
  orderDir: 'ASC' | 'DESC';
  limit: number | null;
  offset: number | null;
  values: Record<string, unknown>;
  paramIndex: number;
}

export interface SQLCondition {
  field: string;
  op: '=' | '!=' | '<>' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'GLOB';
  value: unknown;
}

// ===== Metrics =====
export interface ServerMetrics {
  startTime: number;
  serverId: string;
  requests: {
    total: number;
    success: number;
    error: number;
  };
  websocket: {
    connections: number;
    peak: number;
    messages: { sent: number; received: number };
    broadcasts: number;
  };
  sync: {
    operations: number;
    conflicts: number;
  };
  redis: {
    published: number;
    received: number;
    errors: number;
  };
  cache: {
    hits: number;
    misses: number;
    evictions: number;
  };
  presence: {
    joins: number;
    leaves: number;
    updates: number;
  };
  undo: {
    captures: number;
    undos: number;
    redos: number;
  };
  backups: {
    total: number;
    lastAt: string | null;
  };
  checkpoints: {
    total: number;
    lastAt: string | null;
  };
  cleanup: {
    runs: number;
    docsRemoved: number;
    presenceRemoved: number;
    undoRemoved: number;
  };
}

// ===== Client Types =====
export interface ClientInfo {
  socket: WebSocket;
  subscriptions: Set<string>;
  docSubscriptions: Set<string>;
  connectedAt: number;
}

export interface PresenceUser {
  nodeId: string;
  name: string;
  color: string;
  avatar?: string;
  cursor?: {
    position: number;
    selection?: { start: number; end: number } | null;
  };
  lastSeen: number;
  status: 'online' | 'away' | 'offline';
}

// ===== Document Types =====
export interface DocumentRow {
  id: string;
  data: string;
  crdt_state?: string;
  _version: number;
  _deleted: number;
  created_at: string;
  updated_at: string;
}

export interface Collection {
  name: string;
  created_at: string;
}
