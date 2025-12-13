# kimdb v6.0.0

A real-time WebSocket-based JSON document database with CRDT support.

> ⚠️ **Experimental**: This project is under active development. Use in production with caution.

## Features

- **Real-time Sync**: Bidirectional WebSocket communication
- **Redis Pub/Sub**: Multi-server clustering support
- **CRDT**: Conflict-free Replicated Data Types (RGA, LWW-Set)
- **Rich Text**: Collaborative text editing with Undo/Redo
- **Presence**: Real-time user awareness
- **SQLite**: Persistent storage with WAL mode
- **LRU Cache**: Memory-efficient caching
- **Prometheus Metrics**: Built-in monitoring
- **Zero Dependencies**: Core CRDT implementation without external libraries (~35KB)

## Installation

```bash
git clone https://github.com/bigwash2025a-oss/kimdb.git
cd kimdb
npm install
```

## Quick Start

```bash
# Single server
npm start

# With PM2
pm2 start ecosystem.config.cjs
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 40000 | API server port |
| REDIS_HOST | 127.0.0.1 | Redis host for clustering |
| REDIS_PORT | 6379 | Redis port |
| SERVER_ID | hostname | Server identifier |

## API Endpoints

### REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Server health check |
| GET | /metrics | Prometheus metrics |
| GET | /api/collections | List all collections |
| POST | /api/:collection | Create document |
| GET | /api/:collection/:id | Get document |
| PUT | /api/:collection/:id | Update document |
| DELETE | /api/:collection/:id | Delete document |

### WebSocket API

```javascript
const ws = new WebSocket('ws://localhost:40000');

// Subscribe to collection
ws.send(JSON.stringify({
  type: 'subscribe',
  collection: 'users'
}));

// Create document
ws.send(JSON.stringify({
  type: 'create',
  collection: 'users',
  data: { name: 'kim' }
}));

// Update document
ws.send(JSON.stringify({
  type: 'update',
  collection: 'users',
  id: 'doc-id',
  data: { name: 'updated' }
}));

// Listen for changes
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  console.log('Change:', msg);
};
```

## Clustering

Multi-server synchronization via Redis Pub/Sub:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Server 1   │────▶│    Redis    │◀────│  Server 2   │
│  :40000     │◀────│   Pub/Sub   │────▶│   :40001    │
└─────────────┘     └─────────────┘     └─────────────┘
```

```bash
# Server 1
PORT=40000 REDIS_HOST=redis-server npm start

# Server 2
PORT=40001 REDIS_HOST=redis-server npm start
```

## CRDT Implementation

kimdb implements the following CRDT algorithms:

- **RGA (Replicated Growable Array)**: For ordered sequences and text
- **LWW-Register**: For single values with last-writer-wins semantics
- **LWW-Set**: For sets with add/remove operations
- **3-Way Merge**: For complex object merging
- **Operation Inversion**: For undo/redo support

## Benchmarks

| Test | Result |
|------|--------|
| Feature tests | 13/13 passed |
| Load test (100 clients) | 32K msg/sec |
| Load test (10,000 clients) | 57K msg/sec, 100% success |
| Cluster test (2 servers) | 2.1M sync events, 0 errors |
| Integrity test | 1,000 docs, 30 min verified |

## Project Structure

```
kimdb/
├── src/
│   ├── api-server.js      # Main API server
│   ├── kimdb-core.js      # Core database engine
│   ├── crdt.js            # CRDT implementations
│   └── ...
├── test/
│   ├── feature-test.js    # Feature tests
│   ├── load-test.js       # Load tests
│   ├── cluster-test.js    # Cluster tests
│   └── integrity-test.js  # Data integrity tests
└── ecosystem.config.cjs   # PM2 configuration
```

## Roadmap

- [ ] More CRDT types (Counter, Map)
- [ ] Offline-first sync queue
- [ ] Authentication middleware
- [ ] Horizontal scaling beyond 2 nodes
- [ ] Admin dashboard

## Contributing

Issues and PRs welcome. This is an experimental project - expect breaking changes.

## License

MIT License
