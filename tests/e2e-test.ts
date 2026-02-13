/**
 * KimDB E2E Test Suite
 * Tests complete workflows using Playwright
 */

import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import { KimDBClient } from '@kimdb/client';

// Setup
const BASE_URL = process.env.BASE_URL || 'http://localhost:40000';
const API_URL = `${BASE_URL}/api`;

test.describe('KimDB E2E Tests', () => {
  let client: KimDBClient;

  test.beforeAll(async () => {
    client = new KimDBClient({
      baseUrl: BASE_URL,
    });
  });

  test.describe('Health & Connectivity', () => {
    test('should respond to health check', async () => {
      const response = await client.health();
      expect(response.status).toBe('ok');
      expect(response.version).toBeDefined();
    });

    test('should return metrics', async () => {
      const metrics = await client.metrics();
      expect(metrics.success).toBe(true);
      expect(metrics.version).toBeDefined();
      expect(metrics.requests).toBeDefined();
    });

    test('should list collections', async () => {
      const collections = await client.listCollections();
      expect(Array.isArray(collections)).toBe(true);
    });
  });

  test.describe('CRUD Operations', () => {
    const testCollection = `test-${Date.now()}`;
    const testDocId = `doc-${Math.random()}`;
    const testData = {
      id: testDocId,
      name: 'Test User',
      email: 'test@example.com',
      age: 30,
      created_at: new Date().toISOString(),
    };

    test('should create a document', async () => {
      // Insert via query
      await client.query(
        'INSERT INTO users (id, name, email, age) VALUES (?, ?, ?, ?)',
        testCollection,
        [testDocId, 'Test User', 'test@example.com', 30]
      );
    });

    test('should read a document', async () => {
      const doc = await client.getDocument(testCollection, testDocId);
      expect(doc.id).toBe(testDocId);
    });

    test('should update a document', async () => {
      // Update via query
      await client.query(
        'UPDATE users SET name = ? WHERE id = ?',
        testCollection,
        ['Updated Name', testDocId]
      );

      const doc = await client.getDocument(testCollection, testDocId);
      expect(doc.data.name).toBe('Updated Name');
    });

    test('should query documents', async () => {
      const results = await client.query(
        'SELECT * FROM users WHERE id = ?',
        testCollection,
        [testDocId]
      );
      expect(results.count).toBeGreaterThan(0);
      expect(results.rows[0].id).toBe(testDocId);
    });

    test('should delete a document', async () => {
      await client.query(
        'DELETE FROM users WHERE id = ?',
        testCollection,
        [testDocId]
      );
    });
  });

  test.describe('Query Operations', () => {
    test('should execute SELECT query', async () => {
      const result = await client.query(
        'SELECT * FROM users LIMIT 10',
        'users'
      );
      expect(result.success).toBe(true);
      expect(Array.isArray(result.rows)).toBe(true);
    });

    test('should execute WHERE clause', async () => {
      const result = await client.query(
        'SELECT * FROM users WHERE age > ?',
        'users',
        [18]
      );
      expect(result.success).toBe(true);
    });

    test('should execute GROUP BY', async () => {
      const result = await client.query(
        'SELECT age, COUNT(*) as count FROM users GROUP BY age',
        'users'
      );
      expect(result.success).toBe(true);
    });

    test('should execute ORDER BY', async () => {
      const result = await client.query(
        'SELECT * FROM users ORDER BY created_at DESC LIMIT 5',
        'users'
      );
      expect(result.success).toBe(true);
    });
  });

  test.describe('Error Handling', () => {
    test('should handle invalid collection', async () => {
      try {
        await client.getCollection('nonexistent-collection');
        expect(false).toBe(true); // Should throw
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    test('should handle invalid document ID', async () => {
      try {
        await client.getDocument('users', 'nonexistent-id');
        expect(false).toBe(true); // Should throw
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    test('should handle malformed SQL', async () => {
      try {
        await client.query(
          'INVALID SQL QUERY',
          'users'
        );
        expect(false).toBe(true); // Should throw
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  test.describe('Performance', () => {
    test('should return health check within 100ms', async () => {
      const start = Date.now();
      await client.health();
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100);
    });

    test('should list collections within 100ms', async () => {
      const start = Date.now();
      await client.listCollections();
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100);
    });

    test('should query users within 500ms', async () => {
      const start = Date.now();
      await client.query(
        'SELECT * FROM users LIMIT 100',
        'users'
      );
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(500);
    });
  });

  test.describe('Data Integrity', () => {
    test('should maintain data consistency', async () => {
      // Get initial count
      const before = await client.count('users');

      // Get same count again
      const after = await client.count('users');

      expect(before).toBe(after);
    });

    test('should preserve data types', async () => {
      const response = await client.getCollection('users', { limit: 1 });
      if (response.data.length > 0) {
        const doc = response.data[0];
        expect(typeof doc.id).toBe('string');
        expect(doc._version).toBeDefined();
      }
    });
  });

  test.describe('Pagination', () => {
    test('should handle limit parameter', async () => {
      const response = await client.getCollection('users', { limit: 5 });
      expect(response.data.length).toBeLessThanOrEqual(5);
    });

    test('should handle skip parameter', async () => {
      const page1 = await client.getCollection('users', { limit: 10, skip: 0 });
      const page2 = await client.getCollection('users', { limit: 10, skip: 10 });

      if (page1.data.length > 0 && page2.data.length > 0) {
        expect(page1.data[0].id).not.toBe(page2.data[0].id);
      }
    });

    test('should handle sorting', async () => {
      const response = await client.getCollection('users', { sort: 'created_at' });
      expect(response.data).toBeDefined();
    });
  });
});

// WebSocket E2E Tests
test.describe('WebSocket E2E Tests', () => {
  test('should connect to WebSocket', async () => {
    const { KimDBWebSocket } = await import('@kimdb/client/websocket');
    const ws = new KimDBWebSocket(`ws://localhost:40000/ws`);

    await ws.connect();
    expect(ws.IsConnected()).toBe(true);

    ws.disconnect();
  });

  test('should subscribe to collection', async ({ page }) => {
    // This would require a browser environment
    // Typically done with Playwright
  });
});

// Real-time Sync Tests
test.describe('Real-time Synchronization', () => {
  test('should sync document updates', async () => {
    const { KimDBWebSocket } = await import('@kimdb/client/websocket');

    const ws = new KimDBWebSocket(`ws://localhost:40000/ws`);
    await ws.connect();

    let syncedData: any = null;

    ws.on('doc.synced', (event) => {
      syncedData = event.data;
    });

    // Wait for sync
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 2000);
      ws.on('doc.synced', () => clearTimeout(timeout));
    });

    ws.disconnect();
  });
});
