# KimDB Python Client

High-performance document database client for KimDB with CRDT real-time synchronization.

## Features

- 🚀 REST API client with automatic retries
- 🔄 WebSocket real-time synchronization
- 🔐 JWT and API Key authentication
- 📊 Full type hints support
- ⚡ Connection pooling with session management
- 🛡️ Automatic error handling and recovery

## Installation

```bash
pip install kimdb-client
```

## Quick Start

### REST API (Synchronous Operations)

```python
from kimdb import KimDBClient

# Initialize client
client = KimDBClient(
    base_url='http://localhost:40000',
    token='your-jwt-token',  # or api_key='your-api-key'
)

# Get all documents
response = client.get_collection('users')
print(response['data'])  # List of documents

# Get specific document
user = client.get_document('users', 'user-001')
print(user.data)

# SQL query
results = client.query(
    'SELECT * FROM users WHERE age > ? ORDER BY name',
    collection='users',
    params=[18]
)
print(results['rows'])

# Health check
health = client.health()
print(health['status'])  # 'ok'

# Metrics
metrics = client.metrics()
print(metrics['websocket']['connections'])
```

### WebSocket (Real-time Synchronization)

```python
from kimdb import KimDBWebSocket
import time

# Initialize WebSocket client
ws = KimDBWebSocket('ws://localhost:40000/ws', 'my-client-id')

# Connect
ws.connect()

# Subscribe to collection
ws.subscribe('users')

# Listen for updates
def on_doc_synced(event):
    print(f"Document updated: {event['docId']}")
    print(f"Data: {event['data']}")

ws.on('doc.synced', on_doc_synced)

# Update document
ws.update_document('users', 'user-001', {
    'name': 'John Doe Updated',
    'lastModified': '2024-01-15T12:00:00Z'
})

# Track presence (collaborative editing)
ws.update_presence('users', 'user-001', {
    'cursor': {'line': 10, 'column': 5},
    'name': 'John'
})

# Listen for presence changes
def on_presence_changed(event):
    print(f"{event['nodeId']} moved to {event['presence']['cursor']}")

ws.on('presence.changed', on_presence_changed)

# Undo/Redo
ws.undo('users', 'user-001')
ws.redo('users', 'user-001')

# Keep connection alive
try:
    while ws.is_connected():
        time.sleep(1)
except KeyboardInterrupt:
    ws.disconnect()
```

## API Reference

### KimDBClient

#### Constructor

```python
KimDBClient(
    base_url: str,
    token: str = None,
    api_key: str = None,
    timeout: int = 30,
    retries: int = 3
)
```

**Parameters:**
- `base_url` (str): Server URL (e.g., `http://localhost:40000`)
- `token` (str, optional): JWT token for authentication
- `api_key` (str, optional): API Key for authentication
- `timeout` (int): Request timeout in seconds (default: 30)
- `retries` (int): Number of retries on failure (default: 3)

#### Methods

**Core Operations:**
- `health() -> dict` - Check server health
- `metrics() -> dict` - Get performance metrics
- `list_collections() -> List[str]` - List all collections
- `get_collection(collection, query=None) -> dict` - Get all documents
- `get_document(collection, doc_id) -> Document` - Get specific document
- `query(sql, collection, params=None) -> dict` - Execute SQL query

**Helper Methods:**
- `query_users_by_age(min_age) -> List[dict]` - Query users by age
- `count(collection, where_clause=None) -> int` - Count documents
- `group_by(collection, field) -> dict` - Group by aggregation

**Connection Management:**
- `close() -> None` - Close the session
- `__enter__` and `__exit__` for context manager support

### KimDBWebSocket

#### Constructor

```python
KimDBWebSocket(
    url: str,
    node_id: str = None
)
```

#### Methods

**Connection:**
- `connect(timeout=10) -> None` - Connect to server
- `disconnect() -> None` - Close connection
- `is_connected() -> bool` - Check connection status

**Subscription:**
- `subscribe(collection: str) -> None` - Subscribe to collection updates
- `subscribe_document(collection: str, doc_id: str) -> None` - Subscribe to specific document

**Operations:**
- `update_document(collection: str, doc_id: str, data: dict) -> None` - Update document
- `undo(collection: str, doc_id: str) -> None` - Undo last operation
- `redo(collection: str, doc_id: str) -> None` - Redo operation
- `update_presence(collection: str, doc_id: str, presence: dict) -> None` - Update presence

**Events:**
- `on(event: str, callback: Callable) -> None` - Register event listener

**Supported Events:**
- `connected` - Connected to server
- `disconnected` - Disconnected from server
- `subscribed` - Subscribed to collection
- `doc.synced` - Document update received
- `doc.updated` - Document update confirmed
- `presence.changed` - Presence update from another client
- `pong` - Heartbeat response
- `error` - Error occurred

## Examples

### Context Manager (Automatic Cleanup)

```python
from kimdb import KimDBClient

with KimDBClient(base_url='http://localhost:40000') as client:
    users = client.get_collection('users')
    print(users['data'])
# Session automatically closed
```

### Pagination

```python
page = 1
page_size = 20

response = client.get_collection('users', DocumentQuery(
    limit=page_size,
    skip=(page - 1) * page_size,
    sort='created'
))

print(f"Page {page}: {len(response['data'])} items")
```

### Advanced SQL

```python
# Join query
results = client.query(
    '''
    SELECT u.id, u.name, COUNT(p.id) as post_count
    FROM users u
    LEFT JOIN posts p ON u.id = p.userId
    GROUP BY u.id
    ORDER BY post_count DESC
    ''',
    collection='users'
)

for row in results['rows']:
    print(f"{row['name']}: {row['post_count']} posts")
```

### Real-time Collaborative Editing

```python
from kimdb import KimDBWebSocket

ws = KimDBWebSocket('ws://localhost:40000/ws')
ws.connect()

# Subscribe to document
ws.subscribe_document('documents', 'doc-123')

# Listen for remote changes
def on_content_change(event):
    print(f"Content updated: {event['data']['content']}")
    render_content(event['data']['content'])

ws.on('doc.synced', on_content_change)

# Listen for presence
def on_presence_update(event):
    print(f"{event['presence']['name']} is editing...")
    show_cursor(event['nodeId'], event['presence']['cursor'])

ws.on('presence.changed', on_presence_update)

# Send local changes
def on_local_content_change(new_content):
    ws.update_document('documents', 'doc-123', {
        'content': new_content,
        'lastModified': time.time()
    })

    ws.update_presence('documents', 'doc-123', {
        'cursor': get_cursor_position(),
        'name': get_current_user_name()
    })

# Undo/Redo
def on_undo_click():
    ws.undo('documents', 'doc-123')

def on_redo_click():
    ws.redo('documents', 'doc-123')
```

### Error Handling

```python
import requests

try:
    user = client.get_document('users', 'user-001')
except requests.RequestException as error:
    if '404' in str(error):
        print("User not found")
    elif '401' in str(error):
        print("Authentication failed")
    else:
        print(f"Error: {error}")

# WebSocket error handling
def on_error(event):
    print(f"WebSocket error: {event['message']}")
    # Client will auto-reconnect

ws.on('error', on_error)
```

### Batch Operations

```python
# Count users
user_count = client.count('users')
print(f"Total users: {user_count}")

# Count with condition
active_users = client.count('users', 'active = 1')
print(f"Active users: {active_users}")

# Group by role
roles = client.group_by('users', 'role')
for role, count in roles.items():
    print(f"{role}: {count} users")
```

## Authentication

### JWT Token

```python
client = KimDBClient(
    base_url='http://localhost:40000',
    token='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
)
```

### API Key

```python
client = KimDBClient(
    base_url='http://localhost:40000',
    api_key='your-64-character-api-key'
)
```

## Testing

```bash
# Install dev dependencies
pip install -e ".[dev]"

# Run tests
pytest

# With coverage
pytest --cov=kimdb

# Type checking
mypy kimdb
```

## Performance Tips

1. **Batch Operations**: Use SQL queries for bulk operations instead of multiple requests
2. **Connection Pooling**: Reuse client instances across requests
3. **WebSocket Subscriptions**: Use selective subscriptions to avoid unnecessary updates
4. **Pagination**: Use `limit` and `skip` for large datasets
5. **Timeouts**: Adjust timeout for slow networks

## License

MIT

## Support

- [KimDB Documentation](https://github.com/kim/kimdb/docs)
- [API Reference](../kimdb-client/docs/API.md)
- [Authentication Guide](../kimdb-client/docs/AUTHENTICATION.md)
