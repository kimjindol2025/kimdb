# PostgreSQL to KimDB Migration Guide

Complete guide for migrating from PostgreSQL to KimDB with compatibility notes.

## Overview

This guide covers migrating PostgreSQL databases to KimDB while understanding the architectural differences.

**Why Migrate to KimDB?**
- Better for document-oriented data
- Native CRDT support (conflict-free sync)
- Real-time WebSocket updates
- Horizontal scalability
- Simplified schema management

**When to Keep PostgreSQL?**
- Complex transactions (ACID)
- Strict relational data
- Complex joins (>5 tables)
- Financial data with strong consistency requirements

---

## Architecture Differences

### PostgreSQL vs KimDB

| Aspect | PostgreSQL | KimDB |
|--------|-----------|-------|
| **Model** | Relational | Document |
| **Schema** | Strict DDL | Flexible JSON |
| **Consistency** | Strong (ACID) | Eventual (CRDT) |
| **Sync** | Replication | Real-time (WebSocket) |
| **Scaling** | Vertical | Horizontal |
| **Transactions** | Full ACID | Document-level |
| **Queries** | Complex SQL | Simple + SQL |

### Decision Matrix

```
Choose PostgreSQL if:
- Multiple foreign keys (>3 tables)
- Transactions are critical
- Consistent reads required
- Complex reporting queries
- Data integrity paramount

Choose KimDB if:
- Document-oriented data
- Real-time sync needed
- Horizontal scaling required
- Flexible schema preferred
- Conflict resolution built-in
```

---

## Data Type Mapping

### PostgreSQL to JSON (KimDB)

| PostgreSQL | JSON | KimDB | Notes |
|-----------|------|-------|-------|
| SMALLINT/INT/BIGINT | number | int64 | 64-bit |
| DECIMAL/NUMERIC | number | float64 | Loss of precision possible |
| REAL/DOUBLE | number | float64 | IEEE 754 |
| BOOLEAN | boolean | boolean | true/false |
| TEXT/VARCHAR | string | utf-8 | Unlimited |
| CHAR | string | utf-8 | Trimmed |
| BYTEA | string (hex) | base64 | Encoded |
| DATE | string (ISO) | datetime | "2024-01-15" |
| TIMESTAMP | string (ISO) | datetime | "2024-01-15T12:00:00Z" |
| TIME | string (ISO) | time | "12:00:00" |
| INTERVAL | object | duration | {"days": 1, "seconds": 3600} |
| JSON/JSONB | object | object | Direct mapping |
| UUID | string | uuid | "550e8400-e29b..." |
| ARRAY | array | array | Direct mapping |

### Example PostgreSQL Schema

```sql
-- PostgreSQL
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  profile JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  metadata JSONB,
  published_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE comments (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_posts_user_id ON posts(user_id);
CREATE INDEX idx_comments_post_id ON comments(post_id);
CREATE INDEX idx_comments_user_id ON comments(user_id);
```

### KimDB Document Schema

```json
// users collection
{
  "id": "user-001",
  "username": "johndoe",
  "email": "john@example.com",
  "password_hash": "bcrypt_hash...",
  "profile": {
    "bio": "Developer",
    "avatar": "url...",
    "preferences": {
      "theme": "dark",
      "notifications": true
    }
  },
  "created_at": "2024-01-15T12:00:00Z",
  "updated_at": "2024-01-15T12:30:00Z"
}

// posts collection
{
  "id": "post-001",
  "user_id": "user-001",
  "title": "My First Post",
  "content": "This is the post content...",
  "tags": ["nodejs", "database", "tutorial"],
  "metadata": {
    "views": 150,
    "likes": 25,
    "category": "tech"
  },
  "published_at": "2024-01-15T12:00:00Z",
  "created_at": "2024-01-15T12:00:00Z"
}

// comments collection (denormalized)
{
  "id": "comment-001",
  "post_id": "post-001",
  "user_id": "user-001",
  "username": "johndoe",  // Denormalized for faster queries
  "content": "Great post!",
  "created_at": "2024-01-15T13:00:00Z"
}
```

---

## Migration Strategy

### Phase 1: Export PostgreSQL Data

```bash
# Option 1: Using pg_dump with JSON
pg_dump --format=custom \
  --verbose \
  --file=/tmp/dump.sql \
  production_db

# Option 2: Export as CSV
psql production_db -c "
  COPY users TO STDOUT WITH CSV HEADER;" > users.csv

# Option 3: Export as JSON (per table)
psql production_db -c "
  SELECT json_agg(row_to_json(t)) FROM users t;" > users.json
```

### Phase 2: Transform Data

```typescript
// transform-postgres.ts
import { parse } from 'csv-parse';
import fs from 'fs';

interface PostgresUser {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  profile: any;
  created_at: string;
  updated_at: string;
}

function transformPostgresUser(row: PostgresUser) {
  return {
    id: `user-${String(row.id).padStart(6, '0')}`,
    username: row.username,
    email: row.email,
    password_hash: row.password_hash,
    profile: typeof row.profile === 'string'
      ? JSON.parse(row.profile)
      : row.profile,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

function transformPostgresPost(row: any) {
  return {
    id: `post-${String(row.id).padStart(6, '0')}`,
    user_id: `user-${String(row.user_id).padStart(6, '0')}`,
    title: row.title,
    content: row.content,
    tags: typeof row.tags === 'string'
      ? row.tags.split(',')
      : row.tags,
    metadata: typeof row.metadata === 'string'
      ? JSON.parse(row.metadata)
      : row.metadata,
    published_at: row.published_at
      ? new Date(row.published_at).toISOString()
      : null,
    created_at: new Date(row.created_at).toISOString(),
  };
}

// Process CSV files
async function transformData() {
  const users = await processCSV('users.csv', transformPostgresUser);
  const posts = await processCSV('posts.csv', transformPostgresPost);
  const comments = await processCSV('comments.csv', transformPostgresComment);

  return { users, posts, comments };
}

async function processCSV(filePath: string, transformer: Function) {
  return new Promise((resolve, reject) => {
    const records: any[] = [];
    fs.createReadStream(filePath)
      .pipe(parse({ columns: true }))
      .on('data', (record) => {
        records.push(transformer(record));
      })
      .on('end', () => resolve(records))
      .on('error', reject);
  });
}
```

### Phase 3: Handle Relationships

PostgreSQL relationships must be denormalized in KimDB:

```typescript
// Denormalization strategy
async function denormalizeComments(comments: any[]) {
  const userCache = new Map();
  const postCache = new Map();

  // Pre-load referenced documents
  for (const comment of comments) {
    if (!userCache.has(comment.user_id)) {
      const user = await kimdb.getDocument('users', comment.user_id);
      userCache.set(comment.user_id, user);
    }

    if (!postCache.has(comment.post_id)) {
      const post = await kimdb.getDocument('posts', comment.post_id);
      postCache.set(comment.post_id, post);
    }
  }

  // Add denormalized fields
  return comments.map(comment => ({
    ...comment,
    // Denormalized user data
    username: userCache.get(comment.user_id)?.data?.username,
    user_email: userCache.get(comment.user_id)?.data?.email,

    // Denormalized post data
    post_title: postCache.get(comment.post_id)?.data?.title,

    // Denormalization for faster queries
    _indexed_user_id: comment.user_id,
    _indexed_post_id: comment.post_id,
  }));
}
```

### Phase 4: Load into KimDB

```typescript
// bulk-load.ts
import { KimDBClient } from '@kimdb/client';

async function loadData(collections: Record<string, any[]>) {
  const client = new KimDBClient({
    baseUrl: 'http://localhost:40000'
  });

  for (const [collection, documents] of Object.entries(collections)) {
    console.log(`Loading ${collection}...`);

    // Batch loading
    const batchSize = 1000;
    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);

      const promises = batch.map(doc =>
        client.upsert(collection, doc)
          .catch(error => {
            console.error(`Failed to insert ${doc.id}:`, error);
          })
      );

      await Promise.all(promises);
      console.log(`  Loaded ${i + batch.length}/${documents.length}`);
    }

    // Verify
    const response = await client.getCollection(collection);
    console.log(`✅ ${collection}: ${response.count} documents`);
  }
}
```

---

## Query Migration

### PostgreSQL to KimDB Query Examples

#### Example 1: Simple SELECT

```sql
-- PostgreSQL
SELECT * FROM users WHERE email = 'john@example.com';

-- KimDB (SQL)
SELECT * FROM users WHERE email = 'john@example.com';

-- KimDB (Client)
const users = await client.query(
  'SELECT * FROM users WHERE email = ?',
  'users',
  ['john@example.com']
);
```

#### Example 2: JOIN (Denormalized)

```sql
-- PostgreSQL (Normalized)
SELECT p.id, p.title, u.username, COUNT(c.id) as comments
FROM posts p
JOIN users u ON p.user_id = u.id
LEFT JOIN comments c ON p.id = c.post_id
GROUP BY p.id, u.id;

-- KimDB (Denormalized approach)
SELECT id, title, username, comment_count
FROM posts
WHERE username IS NOT NULL;

-- More efficient: Use application layer
const posts = await client.query('SELECT * FROM posts', 'posts');
const enriched = posts.rows.map(post => ({
  ...post,
  comment_count: post._comment_count || 0
}));
```

#### Example 3: Aggregation

```sql
-- PostgreSQL
SELECT user_id, COUNT(*) as post_count
FROM posts
GROUP BY user_id
ORDER BY post_count DESC;

-- KimDB
SELECT user_id, COUNT(*) as post_count
FROM posts
GROUP BY user_id
ORDER BY post_count DESC;
```

#### Example 4: Full-text Search

```sql
-- PostgreSQL (tsquery)
SELECT id, title FROM posts
WHERE to_tsvector(content) @@ to_tsquery('database');

-- KimDB (SQL LIKE)
SELECT id, title FROM posts
WHERE content LIKE '%database%';

-- KimDB (Application layer)
const posts = await client.query('SELECT * FROM posts', 'posts');
const results = posts.rows.filter(p =>
  p.content.toLowerCase().includes('database')
);
```

---

## Handling Complex PostgreSQL Features

### 1. Transactions

PostgreSQL uses transactions; KimDB uses document-level atomicity:

```typescript
// PostgreSQL
BEGIN;
INSERT INTO posts (...) VALUES (...);
INSERT INTO audit_log (...) VALUES (...);
COMMIT;

// KimDB approach
// Use document-level consistency + application logic
const post = {
  id: generateId(),
  title: 'Post',
  content: 'Content',
  audit: {
    created_at: new Date().toISOString(),
    created_by: userId
  }
};

await client.upsert('posts', post);
```

### 2. Constraints & Triggers

```typescript
// PostgreSQL uses triggers; KimDB uses application logic
class UserService {
  async createUser(userData: any) {
    // Validation (replaces CHECK constraints)
    if (!userData.email.includes('@')) {
      throw new Error('Invalid email');
    }

    // Insert with audit (replaces triggers)
    const user = {
      ...userData,
      id: generateId(),
      created_at: new Date().toISOString(),
      status: 'active'
    };

    await client.upsert('users', user);

    // Log action (replaces trigger logging)
    await auditLog.record({
      action: 'user.created',
      user_id: user.id,
      timestamp: new Date().toISOString()
    });
  }
}
```

### 3. Foreign Key Constraints

```typescript
// Replace PostgreSQL foreign keys with application logic
class PostService {
  async createPost(postData: any) {
    // Check foreign key (replaces FK constraint)
    const user = await client.getDocument('users', postData.user_id);
    if (!user) {
      throw new Error('User not found');
    }

    const post = {
      ...postData,
      id: generateId(),
      user_id: postData.user_id,
      username: user.data.username, // Denormalize
      created_at: new Date().toISOString()
    };

    await client.upsert('posts', post);
  }
}
```

---

## Performance Tuning

### Indexing Strategy

```typescript
// KimDB uses automatic indexing
// No explicit index creation needed

// But structure data for optimal queries:

// Good: Frequently filtered fields at root
{
  "id": "post-001",
  "user_id": "user-001",        // Will be indexed
  "status": "published",         // Will be indexed
  "created_at": "2024-01-15...", // Will be indexed
  "metadata": {                  // Nested
    "views": 150
  }
}

// Avoid: Deeply nested frequently filtered fields
{
  "id": "post-001",
  "data": {
    "metadata": {
      "user_id": "user-001"      // Slow to filter
    }
  }
}
```

### Query Optimization

```typescript
// ✅ Fast: Specific fields
SELECT id, title, user_id FROM posts;

// ❌ Slow: SELECT *
SELECT * FROM posts;

// ✅ Fast: Filtered query
SELECT * FROM posts WHERE user_id = 'user-001';

// ❌ Slow: Full scan + application filter
const posts = await client.query('SELECT * FROM posts', 'posts');
const filtered = posts.rows.filter(p => p.user_id === 'user-001');
```

---

## Validation Checklist

```typescript
async function validateMigration() {
  const tests = [];

  // 1. Row counts
  const pgUsers = await postgres.query('SELECT COUNT(*) FROM users');
  const kdUsers = await kimdb.getCollection('users');
  tests.push({
    name: 'User count',
    pg: pgUsers[0].count,
    kd: kdUsers.count,
    pass: pgUsers[0].count === kdUsers.count
  });

  // 2. Sample data verification
  const pgSample = await postgres.query('SELECT * FROM users LIMIT 1');
  const kdSample = await kimdb.getDocument('users', pgSample[0].id);
  tests.push({
    name: 'Data integrity',
    pass: pgSample[0].email === kdSample.data.email
  });

  // 3. No null violations
  const nulls = await kimdb.query(
    'SELECT * FROM users WHERE email IS NULL',
    'users'
  );
  tests.push({
    name: 'Null constraints',
    violations: nulls.count,
    pass: nulls.count === 0
  });

  // 4. Denormalization check
  const comments = await kimdb.getCollection('comments');
  const missingUsernames = comments.data.filter(c => !c.username);
  tests.push({
    name: 'Denormalization',
    missing: missingUsernames.length,
    pass: missingUsernames.length === 0
  });

  console.table(tests);
  return tests.every(t => t.pass);
}
```

---

## Common Issues

### Issue 1: NUMERIC Precision Loss

**Problem**: PostgreSQL NUMERIC → float64 loses precision

**Solution**:
```typescript
// Store as string for exact precision
const amount = {
  id: 'invoice-001',
  total: '1234.56',  // String, not number
  currency: 'USD'
};
```

### Issue 2: Array Handling

**Problem**: PostgreSQL TEXT[] doesn't map directly

**Solution**:
```typescript
// PostgreSQL: tags TEXT[] = '{tag1, tag2}'
// KimDB: tags = ['tag1', 'tag2']

function transformTags(pgArray: string): string[] {
  if (!pgArray) return [];
  // Remove curly braces and split
  return pgArray
    .slice(1, -1)
    .split(',')
    .map(t => t.trim().replace(/^"/, '').replace(/"$/, ''));
}
```

### Issue 3: NULL Handling

**Problem**: PostgreSQL distinguishes NULL; JSON doesn't

**Solution**:
```typescript
// Explicitly handle nulls
{
  "id": "doc-001",
  "optional_field": null,     // Explicitly null
  "missing_field": undefined  // Undefined (don't store)
}

// Clean before inserting
function cleanDocument(doc: any) {
  return Object.entries(doc)
    .reduce((acc, [key, value]) => {
      if (value !== undefined) {
        acc[key] = value;
      }
      return acc;
    }, {} as any);
}
```

---

## Post-Migration

### 1. Feature Parity

Some PostgreSQL features won't exist in KimDB:

```typescript
// PostgreSQL Feature → KimDB Alternative

// Sequences → Generate IDs
function generateId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random()}`;
}

// Triggers → Application logic
await service.createUser(userData); // Handles cascades

// Stored procedures → Application functions
async function getUserWithPosts(userId: string) {
  const user = await client.getDocument('users', userId);
  const posts = await client.query(
    'SELECT * FROM posts WHERE user_id = ?',
    'posts',
    [userId]
  );
  return { user, posts };
}

// Views → Application queries
async function getActiveUserStats() {
  return client.query(`
    SELECT user_id, COUNT(*) as post_count
    FROM posts
    WHERE status = 'published'
    GROUP BY user_id
  `, 'posts');
}
```

### 2. Monitoring

```typescript
async function monitorPostMigration() {
  setInterval(async () => {
    // Query performance
    const start = Date.now();
    const result = await client.query(
      'SELECT * FROM posts LIMIT 1000',
      'posts'
    );
    console.log(`Query: ${Date.now() - start}ms`);

    // Connection health
    const health = await client.health();
    console.log(`Health: ${health.status}`);

    // Error tracking
    const metrics = await client.metrics();
    console.log(`Error rate: ${(metrics.requests.error / metrics.requests.total).toFixed(2)}%`);
  }, 60000);
}
```

---

## See Also

- [PostgreSQL Migration Guide - Advanced](./MIGRATION_POSTGRESQL_ADVANCED.md)
- [SQLite Migration Guide](./MIGRATION_SQLITE_TO_KIMDB.md)
- [Firestore Migration Guide](./MIGRATION_FIRESTORE_TO_KIMDB.md)
- [Data Model Best Practices](./DATA_MODELING.md)

---

Last updated: 2024-02-13
Version: 1.0.0
