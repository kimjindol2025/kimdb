# @kimdb/client

High-performance document database client for KimDB with CRDT real-time synchronization.

## Features

- 🚀 REST API client with automatic retries
- 🔄 WebSocket real-time synchronization
- 🔐 JWT and API Key authentication
- 📊 Full TypeScript support
- ⚡ Connection pooling and request batching
- 🛡️ Automatic error handling and recovery

## Installation

```bash
npm install @kimdb/client
```

## Quick Start

### REST API (Synchronous Operations)

```typescript
import { KimDBClient } from '@kimdb/client';

const client = new KimDBClient({
  baseUrl: 'http://localhost:40000',
  token: 'your-jwt-token', // or apiKey: 'your-api-key'
});

// Get all documents
const users = await client.getCollection('users');
console.log(users.data);

// Get specific document
const user = await client.getDocument('users', 'user-001');
console.log(user.data);

// SQL query
const results = await client.query({
  sql: 'SELECT * FROM users WHERE age > ? ORDER BY name',
  params: [18],
  collection: 'users'
});
console.log(results.rows);

// Health check
const health = await client.health();
console.log(health.status); // 'ok'

// Metrics
const metrics = await client.metrics();
console.log(metrics.websocket.connections);
```

### WebSocket (Real-time Synchronization)

```typescript
import { KimDBWebSocket } from '@kimdb/client/websocket';

const ws = new KimDBWebSocket('ws://localhost:40000/ws', 'my-client-id');

// Connect and subscribe
await ws.connect();
ws.subscribe('users');

// Listen for updates
ws.on('doc.synced', (event) => {
  console.log(`Document updated: ${event.docId}`, event.data);
});

// Update document
ws.updateDocument('users', 'user-001', {
  name: 'John Doe Updated',
  lastModified: new Date().toISOString()
});

// Track presence (collaborative editing)
ws.updatePresence('users', 'user-001', {
  cursor: { line: 10, column: 5 },
  name: 'John'
});

// Listen for presence changes
ws.on('presence.changed', (event) => {
  console.log(`${event.nodeId} moved to ${event.presence.cursor}`);
});

// Disconnect
ws.disconnect();
```

## API Reference

### KimDBClient

#### Constructor

```typescript
new KimDBClient(config: KimDBConfig)
```

**Config Options:**
- `baseUrl` (string): Server URL (e.g., `http://localhost:40000`)
- `token` (string, optional): JWT token for authentication
- `apiKey` (string, optional): API Key for authentication
- `timeout` (number, optional): Request timeout in ms (default: 30000)
- `retries` (number, optional): Number of retries on failure (default: 3)

#### Methods

**Core Operations:**
- `health(): Promise<HealthResponse>` - Check server health
- `metrics(): Promise<MetricsResponse>` - Get performance metrics
- `listCollections(): Promise<string[]>` - List all collections
- `getCollection(collection, query?): Promise<CollectionResponse>` - Get all documents
- `getDocument(collection, id): Promise<Document>` - Get specific document
- `query(sqlQuery): Promise<SQLResponse>` - Execute SQL query

**Helper Methods:**
- `queryUsersByAge(minAge): Promise<Record[]>` - Query users by age
- `count(collection, whereClause?): Promise<number>` - Count documents
- `groupBy(collection, field): Promise<{[key]: count}>` - Group by aggregation

### KimDBWebSocket

#### Constructor

```typescript
new KimDBWebSocket(url: string, nodeId?: string)
```

#### Methods

**Connection:**
- `connect(): Promise<void>` - Connect to server
- `disconnect(): void` - Close connection
- `connected(): boolean` - Check connection status

**Subscription:**
- `subscribe(collection: string): void` - Subscribe to collection updates
- `subscribeDocument(collection: string, docId: string): void` - Subscribe to specific document

**Operations:**
- `updateDocument(collection: string, docId: string, data: object): void` - Update document
- `undo(collection: string, docId: string): void` - Undo last operation
- `redo(collection: string, docId: string): void` - Redo operation
- `updatePresence(collection: string, docId: string, presence: object): void` - Update presence

**Events:**
- `connected` - Connected to server
- `disconnected` - Disconnected from server
- `subscribed` - Subscribed to collection
- `doc.synced` - Document update received
- `doc.updated` - Document update confirmed
- `presence.changed` - Presence update from another client
- `pong` - Heartbeat response
- `error` - Error occurred

## Examples

### Paginated Query

```typescript
const page = 1;
const pageSize = 20;

const response = await client.getCollection('users', {
  limit: pageSize,
  skip: (page - 1) * pageSize,
  sort: 'created'
});

console.log(`Page ${page}: ${response.data.length} items`);
```

### Advanced SQL

```typescript
// Join query
const results = await client.query({
  sql: `
    SELECT u.id, u.name, COUNT(p.id) as post_count
    FROM users u
    LEFT JOIN posts p ON u.id = p.userId
    GROUP BY u.id
    ORDER BY post_count DESC
  `,
  collection: 'users'
});
```

### Real-time Collaborative Editor

```typescript
const ws = new KimDBWebSocket('ws://localhost:40000/ws');
await ws.connect();

// Subscribe to document
ws.subscribeDocument('documents', 'doc-123');

// Listen for remote changes
ws.on('doc.synced', (event) => {
  console.log('Content updated:', event.data.content);
  renderContent(event.data.content);
});

// Listen for presence
ws.on('presence.changed', (event) => {
  console.log(`${event.presence.name} is editing...`);
  showCursor(event.nodeId, event.presence.cursor);
});

// Send local changes
function onContentChange(newContent) {
  ws.updateDocument('documents', 'doc-123', { content: newContent });

  ws.updatePresence('documents', 'doc-123', {
    cursor: getCursorPosition(),
    name: getCurrentUserName()
  });
}

// Undo/Redo
function onUndoClick() {
  ws.undo('documents', 'doc-123');
}

function onRedoClick() {
  ws.redo('documents', 'doc-123');
}
```

### Error Handling

```typescript
try {
  const user = await client.getDocument('users', 'user-001');
} catch (error) {
  if (error.message.includes('HTTP 404')) {
    console.log('User not found');
  } else if (error.message.includes('HTTP 401')) {
    console.log('Authentication failed');
  } else {
    console.error('Unknown error:', error);
  }
}

// WebSocket error handling
ws.on('error', (error) => {
  console.error('WebSocket error:', error);
  // Client will auto-reconnect
});
```

## Authentication

### JWT Token

```typescript
const client = new KimDBClient({
  baseUrl: 'http://localhost:40000',
  token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
});
```

### API Key

```typescript
const client = new KimDBClient({
  baseUrl: 'http://localhost:40000',
  apiKey: 'your-64-character-api-key'
});
```

## Testing

```bash
npm test
```

## Performance Tips

1. **Batch Operations**: Use SQL queries for bulk operations instead of multiple requests
2. **Connection Pooling**: Reuse client instances
3. **WebSocket Subscriptions**: Use selective subscriptions to avoid unnecessary updates
4. **Pagination**: Use `limit` and `skip` for large datasets

## License

MIT

## Support

- [KimDB Documentation](https://github.com/kim/kimdb/docs)
- [API Reference](./docs/API.md)
- [Authentication Guide](./docs/AUTHENTICATION.md)
