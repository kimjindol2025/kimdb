# KimDB API Reference

Complete API documentation for KimDB - High-performance document database with CRDT real-time sync.

**Base URL:** `http://localhost:40000`

## 📋 Table of Contents

1. [Health & Metrics](#health--metrics)
2. [Collections](#collections)
3. [Documents (CRUD)](#documents-crud)
4. [SQL Queries](#sql-queries)
5. [WebSocket Real-time Sync](#websocket-real-time-sync)
6. [Authentication](#authentication)
7. [Error Handling](#error-handling)
8. [Code Examples](#code-examples)

---

## Health & Metrics

### GET /health

Check server health and basic information.

**Request:**
```bash
curl http://localhost:40000/health
```

**Response (200 OK):**
```json
{
  "status": "ok",
  "version": "7.6.1",
  "serverId": "server-001",
  "uptime": 3600,
  "connections": 42
}
```

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| status | string | Server status (ok, degraded, down) |
| version | string | Server version |
| serverId | string | Server instance ID |
| uptime | integer | Uptime in seconds |
| connections | integer | Active WebSocket connections |

---

### GET /api/metrics

Get detailed performance metrics.

**Request:**
```bash
curl http://localhost:40000/api/metrics
```

**Response (200 OK):**
```json
{
  "success": true,
  "version": "7.6.1",
  "serverId": "server-001",
  "uptime_seconds": 3600,
  "requests": {
    "total": 1000,
    "success": 950,
    "error": 50
  },
  "websocket": {
    "connections": 42,
    "peak": 100,
    "messages": {
      "sent": 5000,
      "received": 4800
    },
    "broadcasts": 1200
  },
  "sync": {
    "operations": 15000,
    "conflicts": 3
  },
  "cache": {
    "hits": 8000,
    "misses": 2000,
    "evictions": 100
  },
  "memory": {
    "cachedDocs": 256,
    "presenceManagers": 10,
    "undoManagers": 8,
    "heapUsed": "256MB"
  }
}
```

---

## Collections

### GET /api/collections

List all collections in the database.

**Request:**
```bash
curl http://localhost:40000/api/collections
```

**Response (200 OK):**
```json
{
  "success": true,
  "collections": ["users", "documents", "posts", "comments"]
}
```

---

## Documents (CRUD)

### GET /api/c/{collection}

Get all documents in a collection.

**Request:**
```bash
curl http://localhost:40000/api/c/users
```

**Response (200 OK):**
```json
{
  "success": true,
  "collection": "users",
  "count": 2,
  "data": [
    {
      "id": "user-001",
      "name": "John Doe",
      "email": "john@example.com",
      "_version": 3
    },
    {
      "id": "user-002",
      "name": "Jane Smith",
      "email": "jane@example.com",
      "_version": 2
    }
  ]
}
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| limit | integer | Maximum documents to return (default: all) |
| skip | integer | Number of documents to skip (pagination) |
| sort | string | Sort field (e.g., "name", "-created") |

---

### GET /api/c/{collection}/{id}

Get a specific document by ID.

**Request:**
```bash
curl http://localhost:40000/api/c/users/user-001
```

**Response (200 OK):**
```json
{
  "success": true,
  "id": "user-001",
  "data": {
    "name": "John Doe",
    "email": "john@example.com",
    "role": "admin"
  },
  "_version": 3
}
```

**Error Response (404):**
```json
{
  "error": "Not found"
}
```

---

## SQL Queries

### POST /api/sql

Execute SQL queries on a collection.

**Request:**
```bash
curl -X POST http://localhost:40000/api/sql \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "SELECT * FROM users WHERE age > ? ORDER BY name",
    "params": [18],
    "collection": "users"
  }'
```

**Response (200 OK):**
```json
{
  "success": true,
  "rows": [
    {
      "id": "user-001",
      "name": "John Doe",
      "age": 30
    },
    {
      "id": "user-002",
      "name": "Jane Smith",
      "age": 28
    }
  ],
  "count": 2
}
```

**Common SQL Examples:**

#### SELECT Query
```bash
curl -X POST http://localhost:40000/api/sql \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "SELECT id, name, email FROM users WHERE age > ? ORDER BY name",
    "params": [18],
    "collection": "users"
  }'
```

#### COUNT Query
```bash
curl -X POST http://localhost:40000/api/sql \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "SELECT COUNT(*) as total FROM users WHERE active = 1",
    "collection": "users"
  }'
```

#### GROUP BY Query
```bash
curl -X POST http://localhost:40000/api/sql \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "SELECT role, COUNT(*) as count FROM users GROUP BY role",
    "collection": "users"
  }'
```

#### JOIN Query
```bash
curl -X POST http://localhost:40000/api/sql \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "SELECT u.id, u.name, p.title FROM users u LEFT JOIN posts p ON u.id = p.userId",
    "collection": "users"
  }'
```

#### ORDER BY & LIMIT
```bash
curl -X POST http://localhost:40000/api/sql \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "SELECT * FROM users ORDER BY created DESC LIMIT 10 OFFSET 20",
    "collection": "users"
  }'
```

**Error Response (400):**
```json
{
  "error": "sql is required"
}
```

**Error Response (500):**
```json
{
  "error": "SQL execution error message"
}
```

---

## WebSocket Real-time Sync

### GET /ws

Connect to WebSocket endpoint for real-time synchronization.

**WebSocket URL:**
```
ws://localhost:40000/ws
wss://api.example.com/ws (for HTTPS)
```

**JavaScript Example:**
```javascript
const ws = new WebSocket('ws://localhost:40000/ws');

// Connection established
ws.onopen = () => {
  console.log('Connected to KimDB');
};

// Receive messages
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received:', message);
};

// Handle errors
ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

// Connection closed
ws.onclose = () => {
  console.log('Disconnected from KimDB');
};
```

### WebSocket Message Types

#### 1. Subscribe to Collection

Subscribe to updates for all documents in a collection.

**Send:**
```json
{
  "type": "subscribe",
  "collection": "users"
}
```

**Receive:**
```json
{
  "type": "subscribed",
  "collection": "users"
}
```

#### 2. Subscribe to Document

Subscribe to updates for a specific document.

**Send:**
```json
{
  "type": "doc.subscribe",
  "collection": "users",
  "docId": "user-001"
}
```

**Receive (on update from other clients):**
```json
{
  "type": "doc.synced",
  "collection": "users",
  "docId": "user-001",
  "data": {
    "name": "John Doe (Updated)",
    "email": "john.doe@example.com"
  },
  "_version": 4
}
```

#### 3. Update Document

Update a document with CRDT-based synchronization.

**Send:**
```json
{
  "type": "doc.update",
  "collection": "users",
  "docId": "user-001",
  "data": {
    "name": "John Doe Updated",
    "lastModified": "2024-01-15T11:30:00Z"
  },
  "nodeId": "client-abc123"
}
```

**Receive (confirmation):**
```json
{
  "type": "doc.updated",
  "docId": "user-001",
  "success": true,
  "_version": 5
}
```

#### 4. Undo Operation

Undo the last change to a document.

**Send:**
```json
{
  "type": "doc.undo",
  "collection": "users",
  "docId": "user-001",
  "nodeId": "client-abc123"
}
```

#### 5. Redo Operation

Redo the last undone change.

**Send:**
```json
{
  "type": "doc.redo",
  "collection": "users",
  "docId": "user-001",
  "nodeId": "client-abc123"
}
```

#### 6. Presence Update

Update presence information (for collaborative editing).

**Send:**
```json
{
  "type": "presence.update",
  "collection": "users",
  "docId": "user-001",
  "nodeId": "client-abc123",
  "presence": {
    "cursor": { "line": 10, "column": 5 },
    "selection": { "start": 0, "end": 100 },
    "name": "John"
  }
}
```

**Receive (from other clients):**
```json
{
  "type": "presence.changed",
  "docId": "user-001",
  "nodeId": "client-xyz789",
  "presence": {
    "cursor": { "line": 5, "column": 10 },
    "name": "Jane"
  }
}
```

#### 7. Heartbeat

Send periodic ping to keep connection alive.

**Send:**
```json
{
  "type": "ping"
}
```

**Receive:**
```json
{
  "type": "pong",
  "timestamp": 1705317000000
}
```

---

## Authentication

### JWT Bearer Token

Include JWT token in Authorization header for authenticated requests.

**Request Header:**
```bash
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Example with cURL:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:40000/api/c/users
```

**Token Requirements:**
- Minimum 64 characters
- Base64 encoded
- Generated by server authentication endpoint (if implemented)

**Note:** Current version (7.6.1) has basic structure for authentication. Full implementation requires adding authentication endpoints.

---

## Error Handling

### Error Response Format

All errors follow this standard format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {}
}
```

### Common HTTP Status Codes

| Status | Meaning | Example |
|--------|---------|---------|
| 200 | Success | Document retrieved |
| 400 | Bad Request | Missing required field |
| 401 | Unauthorized | Invalid token |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Document/collection doesn't exist |
| 409 | Conflict | Concurrent modification conflict |
| 500 | Server Error | Internal server error |
| 503 | Service Unavailable | Server overloaded |

### Common Error Codes

| Code | Description |
|------|-------------|
| INVALID_REQUEST | Malformed request |
| NOT_FOUND | Resource not found |
| UNAUTHORIZED | Authentication required |
| FORBIDDEN | Permission denied |
| CONFLICT | Conflict error (CRDT) |
| INTERNAL_ERROR | Server error |
| DATABASE_ERROR | Database operation failed |

---

## Code Examples

### Node.js / JavaScript

```javascript
// Import
import fetch from 'node-fetch';

// REST API - GET collection
async function getUsers() {
  const response = await fetch('http://localhost:40000/api/c/users');
  const data = await response.json();
  console.log(data);
}

// REST API - SQL query
async function queryUsers() {
  const response = await fetch('http://localhost:40000/api/sql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sql: 'SELECT * FROM users WHERE age > ?',
      params: [18],
      collection: 'users'
    })
  });
  const data = await response.json();
  console.log(data);
}

// WebSocket - Real-time sync
function setupWebSocket() {
  const ws = new WebSocket('ws://localhost:40000/ws');

  ws.onopen = () => {
    // Subscribe to collection
    ws.send(JSON.stringify({
      type: 'subscribe',
      collection: 'users'
    }));

    // Subscribe to specific document
    ws.send(JSON.stringify({
      type: 'doc.subscribe',
      collection: 'users',
      docId: 'user-001'
    }));
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    console.log('Update:', message);
  };

  // Heartbeat
  setInterval(() => {
    ws.send(JSON.stringify({ type: 'ping' }));
  }, 30000);
}
```

### Python

```python
import requests
import json
import websocket

# REST API - GET collection
response = requests.get('http://localhost:40000/api/c/users')
data = response.json()
print(data)

# REST API - SQL query
response = requests.post(
  'http://localhost:40000/api/sql',
  json={
    'sql': 'SELECT * FROM users WHERE age > ?',
    'params': [18],
    'collection': 'users'
  }
)
data = response.json()
print(data)

# WebSocket - Real-time sync
def on_message(ws, message):
    data = json.loads(message)
    print(f"Update: {data}")

def on_open(ws):
    ws.send(json.dumps({
        'type': 'subscribe',
        'collection': 'users'
    }))

ws = websocket.WebSocketApp(
    'ws://localhost:40000/ws',
    on_message=on_message,
    on_open=on_open
)
ws.run_forever()
```

### cURL Examples

```bash
# Health check
curl http://localhost:40000/health

# Get metrics
curl http://localhost:40000/api/metrics

# List collections
curl http://localhost:40000/api/collections

# Get all users
curl http://localhost:40000/api/c/users

# Get specific user
curl http://localhost:40000/api/c/users/user-001

# SQL query
curl -X POST http://localhost:40000/api/sql \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "SELECT * FROM users WHERE age > ?",
    "params": [18],
    "collection": "users"
  }'
```

---

## Rate Limiting

Current implementation supports:
- IP-based rate limiting
- Configurable request limits per minute
- Custom whitelist for trusted IPs

**Configuration:**
```env
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW=60000       # 1 minute (ms)
RATE_LIMIT_MAX=1000           # requests per minute
RATE_LIMIT_PER_IP=100         # requests per IP per minute
RATE_LIMIT_WHITELIST=127.0.0.1
```

---

## Best Practices

### 1. Error Handling
Always check HTTP status codes and handle errors gracefully.

```javascript
try {
  const response = await fetch('http://localhost:40000/api/c/users');
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error);
  }
  const data = await response.json();
} catch (e) {
  console.error('API error:', e.message);
}
```

### 2. Connection Management
Implement reconnection logic for WebSocket.

```javascript
function connectWithRetry(maxRetries = 5) {
  let attempts = 0;

  function connect() {
    const ws = new WebSocket('ws://localhost:40000/ws');

    ws.onclose = () => {
      if (attempts < maxRetries) {
        attempts++;
        setTimeout(connect, Math.pow(2, attempts) * 1000);
      }
    };
  }

  connect();
}
```

### 3. Data Validation
Validate data before sending to API.

```javascript
function validateUser(user) {
  if (!user.name || typeof user.name !== 'string') {
    throw new Error('Invalid name');
  }
  if (!user.email || !user.email.includes('@')) {
    throw new Error('Invalid email');
  }
  return true;
}
```

### 4. Performance
- Use batch operations when possible
- Cache frequently accessed data
- Implement pagination for large datasets
- Use WebSocket for real-time updates

---

## Swagger UI

Interactive API documentation available at:

**Local:** http://localhost:40000/docs
**Production:** https://api.example.com/docs

---

## Support

- **Issues:** https://github.com/kim/kimdb/issues
- **Documentation:** https://github.com/kim/kimdb/docs
- **Email:** kim@example.com

---

Last updated: 2024-02-13
API Version: 7.6.1
