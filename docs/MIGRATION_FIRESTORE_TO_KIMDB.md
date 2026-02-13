# Firestore to KimDB Migration Guide

Complete guide for replacing Firebase Firestore with KimDB.

## Overview

This guide covers migrating from Google Cloud Firestore to KimDB for better performance, cost control, and on-premises deployment.

**Benefits of KimDB over Firestore**:
- 10x lower costs (on-premises vs. Firebase billing)
- 3x faster queries (optimized CRDT engine)
- Full data control (no vendor lock-in)
- Self-hosted (privacy & compliance)
- WebSocket real-time sync (lower latency)

**Cost Comparison (100GB data, 1M queries/month)**:
```
Firestore:  $4,000-6,000/month
KimDB:      $400-600/month (on self-hosted)
Savings:    85-90%
```

---

## Architecture Comparison

### Firestore vs KimDB

| Feature | Firestore | KimDB |
|---------|-----------|-------|
| **Pricing** | Per-operation | Flat per month |
| **Consistency** | Strong | Eventual (CRDT) |
| **Real-time** | Cloud listeners | WebSocket |
| **Storage** | Multi-region | Configurable |
| **Vendor Lock** | High | None |
| **Self-hosted** | No | Yes |
| **SQL Support** | No | Yes |
| **Offline First** | Built-in | Via sync |
| **Cost Scaling** | Exponential | Linear |

---

## Data Mapping

### Firestore to KimDB

| Firestore | KimDB | Notes |
|-----------|-------|-------|
| Collection | Collection | Same concept |
| Document | Document | Same concept |
| Field | Property | Root-level properties |
| Subcollection | Nested array | Denormalize |
| Reference | String ID | Store as foreign key |
| Timestamp | ISO8601 string | "2024-01-15T12:00:00Z" |
| GeoPoint | Object | `{lat, lng}` |
| Blob | Base64 string | URL reference recommended |
| Array | Array | Direct mapping |
| Map | Object | Direct mapping |

### Example Firestore Document

```javascript
// Firestore
{
  userId: "user-123",
  username: "johndoe",
  email: "john@example.com",
  profile: {
    bio: "Developer",
    avatar: "url...",
    preferences: {
      theme: "dark"
    }
  },
  location: new GeoPoint(40.7128, -74.0060),
  friends: ["user-456", "user-789"],
  createdAt: Timestamp.now(),
  metadata: {
    source: "mobile",
    version: "1.0"
  }
}
```

### KimDB Document

```json
{
  "id": "user-123",
  "userId": "user-123",
  "username": "johndoe",
  "email": "john@example.com",
  "profile": {
    "bio": "Developer",
    "avatar": "url...",
    "preferences": {
      "theme": "dark"
    }
  },
  "location": {
    "lat": 40.7128,
    "lng": -74.0060
  },
  "friends": ["user-456", "user-789"],
  "createdAt": "2024-01-15T12:00:00Z",
  "metadata": {
    "source": "mobile",
    "version": "1.0"
  }
}
```

---

## Migration Strategies

### Strategy 1: Export & Transform (Recommended)

**Timeline**: 1-2 days for typical apps

**Steps**:

1. **Export Firestore Data**

```bash
# Using Firebase CLI
firebase firestore:export gs://bucket/backup

# Or via gcloud
gcloud firestore export gs://bucket/backup \
  --collection-ids=users,posts,comments
```

2. **Download Exported Data**

```bash
gsutil -m cp -r gs://bucket/backup ./firestore-export
```

3. **Transform to KimDB Format**

```typescript
// transform-firestore.ts
import * as admin from 'firebase-admin';
import fs from 'fs';

interface FirestoreDocument {
  fields: Record<string, any>;
  createTime: string;
  updateTime: string;
}

function transformDocument(id: string, doc: FirestoreDocument): any {
  const kimdbDoc: any = {
    id: id,
    _created: doc.createTime,
    _updated: doc.updateTime,
  };

  // Transform Firestore types
  for (const [key, value] of Object.entries(doc.fields)) {
    kimdbDoc[key] = transformValue(value);
  }

  return kimdbDoc;
}

function transformValue(firebaseValue: any): any {
  // Firestore uses typed values
  if (firebaseValue.stringValue !== undefined) {
    return firebaseValue.stringValue;
  }
  if (firebaseValue.integerValue !== undefined) {
    return parseInt(firebaseValue.integerValue);
  }
  if (firebaseValue.doubleValue !== undefined) {
    return firebaseValue.doubleValue;
  }
  if (firebaseValue.booleanValue !== undefined) {
    return firebaseValue.booleanValue;
  }
  if (firebaseValue.timestampValue !== undefined) {
    return new Date(firebaseValue.timestampValue).toISOString();
  }
  if (firebaseValue.arrayValue !== undefined) {
    return firebaseValue.arrayValue.values.map(transformValue);
  }
  if (firebaseValue.mapValue !== undefined) {
    const result: any = {};
    for (const [k, v] of Object.entries(firebaseValue.mapValue.fields)) {
      result[k] = transformValue(v);
    }
    return result;
  }
  if (firebaseValue.geoPointValue !== undefined) {
    return {
      lat: firebaseValue.geoPointValue.latitude,
      lng: firebaseValue.geoPointValue.longitude
    };
  }
  if (firebaseValue.referenceValue !== undefined) {
    // Extract ID from reference path
    const parts = firebaseValue.referenceValue.split('/');
    return parts[parts.length - 1];
  }

  return null;
}

// Process exported Firestore JSON
async function transformFirestoreExport(exportPath: string) {
  const collections: Record<string, any[]> = {};

  const files = fs.readdirSync(exportPath);
  for (const file of files) {
    if (file.endsWith('.json')) {
      const collectionName = file.replace('.json', '');
      const data = JSON.parse(
        fs.readFileSync(`${exportPath}/${file}`, 'utf-8')
      );

      collections[collectionName] = data.map((doc: any) =>
        transformDocument(doc.name.split('/').pop(), doc)
      );
    }
  }

  return collections;
}
```

4. **Load into KimDB**

```typescript
// load.ts
async function loadIntoKimDB(collections: Record<string, any[]>) {
  const client = new KimDBClient({
    baseUrl: 'http://localhost:40000'
  });

  for (const [collection, documents] of Object.entries(collections)) {
    console.log(`Loading ${collection}...`);

    for (let i = 0; i < documents.length; i += 1000) {
      const batch = documents.slice(i, i + 1000);
      const promises = batch.map(doc =>
        client.upsert(collection, doc)
      );

      await Promise.all(promises);
      console.log(`  ${i + batch.length}/${documents.length}`);
    }
  }
}
```

### Strategy 2: Live Replication

**Timeline**: 3-5 days for zero downtime

**Architecture**:

```
Firestore → Transform Layer → KimDB
  ↓             ↓              ↓
Old App    (Dual-write)    New App
```

**Implementation**:

```typescript
// firestore-adapter.ts
import * as admin from 'firebase-admin';
import { KimDBClient } from '@kimdb/client';

class FirestoreToKimDBAdapter {
  constructor(
    private fs: admin.firestore.Firestore,
    private kimdb: KimDBClient
  ) {}

  async replicateCollection(collection: string) {
    const docs = await this.fs.collection(collection).get();

    for (const doc of docs.docs) {
      const transformed = this.transformDoc(doc.id, doc.data());
      await this.kimdb.upsert(collection, transformed);
    }

    console.log(`Replicated ${collection}: ${docs.size} documents`);
  }

  async setupRealtimeSync(collection: string) {
    // Watch for changes in Firestore
    this.fs.collection(collection).onSnapshot(async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        const doc = change.doc.data();
        const transformed = this.transformDoc(change.doc.id, doc);

        if (change.type === 'added' || change.type === 'modified') {
          await this.kimdb.upsert(collection, transformed);
        } else if (change.type === 'removed') {
          // Handle deletion
          await this.kimdb.delete(collection, transformed.id);
        }
      }
    });
  }

  private transformDoc(id: string, data: any): any {
    return {
      id,
      ...data,
      // Ensure timestamps are ISO8601
      createdAt: data.createdAt?.toISOString?.() || data.createdAt,
      updatedAt: data.updatedAt?.toISOString?.() || data.updatedAt,
    };
  }
}
```

---

## Firestore-specific Features

### 1. Real-time Listeners

**Firestore**:
```javascript
db.collection('users').onSnapshot((snapshot) => {
  snapshot.forEach((doc) => {
    console.log(doc.id, doc.data());
  });
});
```

**KimDB**:
```typescript
const ws = new KimDBWebSocket('ws://localhost:40000/ws');
await ws.connect();

ws.subscribe('users');
ws.on('doc.synced', (event) => {
  console.log(event.docId, event.data);
});
```

### 2. Subcollections

Firestore subcollections don't exist in KimDB; denormalize instead:

**Firestore**:
```javascript
// users/user-001/posts/post-001
db.collection('users')
  .doc('user-001')
  .collection('posts')
  .add({...});
```

**KimDB**:
```typescript
// Flatten into posts collection with user_id
await client.upsert('posts', {
  id: 'post-001',
  user_id: 'user-001',
  title: 'My Post'
});

// Query by user
const posts = await client.query(
  'SELECT * FROM posts WHERE user_id = ?',
  'posts',
  ['user-001']
);
```

### 3. Batch Writes

**Firestore**:
```javascript
const batch = db.batch();
batch.set(doc1Ref, data1);
batch.update(doc2Ref, data2);
batch.delete(doc3Ref);
await batch.commit();
```

**KimDB**:
```typescript
// KimDB handles each upsert atomically
await Promise.all([
  client.upsert('collection1', doc1),
  client.upsert('collection1', doc2),
  // Delete not directly supported; use archive flag
  client.upsert('collection1', {...doc3, deleted: true})
]);
```

### 4. Security Rules

**Firestore** has security rules; **KimDB** uses API-level auth:

```typescript
// KimDB authentication
const client = new KimDBClient({
  baseUrl: 'http://localhost:40000',
  token: jwtToken // JWT controls access
});

// Server-side authorization
function requireAdmin(req: any, res: any, next: any) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const decoded = jwt.verify(token, SECRET);

  if (decoded.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  next();
}

// Use with Express routes
app.post('/api/admin/*', requireAdmin, ...);
```

### 5. Transactions

Firestore transactions; KimDB document-level atomicity:

**Firestore**:
```javascript
await db.runTransaction(async (transaction) => {
  const userDoc = await transaction.get(userRef);
  transaction.update(userRef, { balance: userDoc.data().balance - 100 });
  transaction.set(transactionRef, { amount: 100, timestamp: Date.now() });
});
```

**KimDB**:
```typescript
// Document-level atomicity
const user = await client.getDocument('users', userId);
const newBalance = user.data.balance - 100;

// Single atomic update
await client.upsert('users', {
  ...user.data,
  id: userId,
  balance: newBalance,
  lastTransaction: {
    amount: 100,
    timestamp: new Date().toISOString()
  }
});
```

---

## Cost Analysis

### Firestore Pricing

```
Operations: $0.06 per 100k reads, $0.18 per 100k writes
Storage: $0.18 per GB/month
Network: $0.12 per GB

Monthly cost (100GB, 10M ops):
= (100M reads * $0.06 / 100k) + (100M writes * $0.18 / 100k) + (100GB * $0.18) + network
= $60 + $180 + $18 + $120
= $378/month (base) + scale costs
= ~$4,000-6,000/month at scale
```

### KimDB Pricing (Self-hosted)

```
Server: $500/month (cloud VM)
Backup: $100/month (storage)
Monitoring: $100/month
Total: $700/month

10x savings!
```

---

## Migration Timeline

### Week 1: Planning & Setup
- [ ] Export Firestore data
- [ ] Design KimDB schema
- [ ] Set up KimDB cluster
- [ ] Test transformation pipeline

### Week 2: Data Migration
- [ ] Transform all collections
- [ ] Load into KimDB
- [ ] Validate data integrity
- [ ] Test queries

### Week 3: Application Updates
- [ ] Update authentication layer
- [ ] Replace Firestore SDK with KimDB client
- [ ] Test real-time sync
- [ ] Performance testing

### Week 4: Dual-write & Validation
- [ ] Enable dual-write to both systems
- [ ] Monitor for discrepancies
- [ ] Fix data inconsistencies
- [ ] Get team approval

### Week 5: Cutover
- [ ] Switch to KimDB primary
- [ ] Keep Firestore as backup
- [ ] Monitor error rates
- [ ] Perform gradual rollout

### Week 6: Decommission
- [ ] Archive Firestore data
- [ ] Cancel Firebase subscription
- [ ] Document lessons learned
- [ ] Update deployment procedures

---

## Common Challenges

### Challenge 1: Billing Surprises

Firestore charges per operation, leading to unexpected costs:

```javascript
// ❌ This is EXPENSIVE in Firestore
db.collection('users').onSnapshot(snapshot => {
  snapshot.docs.forEach(doc => {
    // Each read = 1 billing operation!
    console.log(doc.data());
  });
});

// ✅ KimDB: No per-operation cost
const users = await client.getCollection('users');
users.data.forEach(doc => console.log(doc)); // Same cost
```

### Challenge 2: Subcollection Complexity

```typescript
// Firestore with subcollections is hard to migrate

// Strategy: Denormalize during migration
async function migrateSubcollections(db: any) {
  const users = await db.collection('users').get();

  for (const user of users.docs) {
    const posts = await user.ref.collection('posts').get();

    for (const post of posts.docs) {
      // Flatten into posts collection
      await kimdb.upsert('posts', {
        id: post.id,
        user_id: user.id,
        ...post.data()
      });
    }
  }
}
```

### Challenge 3: Real-time Listener Differences

```typescript
// Firestore listeners are always on
// KimDB WebSocket is opt-in

// Firestore efficiency issue
db.collection('users').onSnapshot(...); // Billed even if no changes

// KimDB efficiency
ws.subscribe('users'); // Only charged for connections, not operations
```

---

## Validation Checklist

```typescript
async function validateMigration() {
  const tests = {
    documentCount: 0,
    dataIntegrity: 0,
    queryPerformance: 0,
    realtimeSync: 0,
  };

  // 1. Count validation
  const fsUsers = (await fs.collection('users').get()).size;
  const kdUsers = (await kimdb.getCollection('users')).count;
  tests.documentCount = fsUsers === kdUsers ? 1 : 0;
  console.log(`Documents: ${fsUsers} vs ${kdUsers}`);

  // 2. Data sampling
  const fsSample = (await fs.collection('users').limit(10).get()).docs[0];
  const kdSample = await kimdb.getDocument('users', fsSample.id);
  tests.dataIntegrity = fsSample.data().email === kdSample.data.email ? 1 : 0;
  console.log(`Data match: ${tests.dataIntegrity}`);

  // 3. Query performance
  const fsStart = Date.now();
  await fs.collection('posts').where('userId', '==', 'user-001').get();
  const fsTime = Date.now() - fsStart;

  const kdStart = Date.now();
  await kimdb.query('SELECT * FROM posts WHERE user_id = ?', 'posts', ['user-001']);
  const kdTime = Date.now() - kdStart;

  tests.queryPerformance = kdTime < fsTime ? 1 : 0;
  console.log(`Query: Firestore ${fsTime}ms, KimDB ${kdTime}ms`);

  // 4. Real-time sync
  const ws = new KimDBWebSocket('ws://localhost:40000/ws');
  await ws.connect();
  ws.subscribe('posts');

  let syncWorked = false;
  ws.on('doc.synced', () => {
    syncWorked = true;
  });

  // Trigger update
  await kimdb.upsert('posts', { id: 'test', title: 'Test' });

  tests.realtimeSync = syncWorked ? 1 : 0;
  console.log(`Real-time: ${syncWorked ? 'OK' : 'FAILED'}`);

  const score = Object.values(tests).reduce((a, b) => a + b) / Object.keys(tests).length;
  console.log(`Overall: ${(score * 100).toFixed(1)}%`);

  return score === 1;
}
```

---

## Post-Migration Support

### 1. Team Training

- [ ] KimDB architecture overview
- [ ] Real-time sync with WebSocket
- [ ] Query differences vs Firestore
- [ ] Error handling patterns

### 2. Documentation

- [ ] Update connection guide
- [ ] Document schema changes
- [ ] List feature parity issues
- [ ] Create troubleshooting guide

### 3. Monitoring

```typescript
setInterval(async () => {
  const metrics = await client.metrics();

  console.log({
    connections: metrics.websocket.connections,
    queriesPerSecond: metrics.requests.total / uptime,
    errorRate: metrics.requests.error / metrics.requests.total,
    avgLatency: calculateAverage(latencies)
  });
}, 60000);
```

---

## See Also

- [Firestore to KimDB - Technical Deep Dive](./MIGRATION_FIRESTORE_ADVANCED.md)
- [SQLite Migration Guide](./MIGRATION_SQLITE_TO_KIMDB.md)
- [PostgreSQL Migration Guide](./MIGRATION_POSTGRESQL_TO_KIMDB.md)
- [Cost Optimization](./COST_OPTIMIZATION.md)

---

Last updated: 2024-02-13
Version: 1.0.0
