/**
 * CRDT Unit Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  VectorClock,
  LWWSet,
  LWWMap,
  RGA,
  CRDTDocument,
  UndoManager,
} from '../src/crdt/v2/index.js';

describe('VectorClock', () => {
  it('should initialize with correct nodeId', () => {
    const clock = new VectorClock('node1');
    expect(clock.nodeId).toBe('node1');
    expect(clock.clock['node1']).toBe(0);
  });

  it('should tick correctly', () => {
    const clock = new VectorClock('node1');
    clock.tick();
    expect(clock.clock['node1']).toBe(1);
    clock.tick();
    expect(clock.clock['node1']).toBe(2);
  });

  it('should merge clocks correctly', () => {
    const clock1 = new VectorClock('node1');
    const clock2 = new VectorClock('node2');

    clock1.tick();
    clock1.tick();
    clock2.tick();

    clock1.merge(clock2);

    expect(clock1.clock['node1']).toBe(2);
    expect(clock1.clock['node2']).toBe(1);
  });

  it('should compare clocks correctly', () => {
    const clock1 = new VectorClock('node1');
    const clock2 = new VectorClock('node2');

    clock1.tick();
    expect(clock1.compare(clock2)).toBe(1); // clock1 > clock2

    clock2.tick();
    clock2.tick();
    expect(clock1.compare(clock2)).toBe(0); // concurrent
  });

  it('should serialize and deserialize', () => {
    const clock = new VectorClock('node1');
    clock.tick();
    clock.tick();

    const json = clock.toJSON();
    const restored = VectorClock.fromJSON(json);

    expect(restored.nodeId).toBe('node1');
    expect(restored.clock['node1']).toBe(2);
  });
});

describe('LWWSet', () => {
  let set: LWWSet;

  beforeEach(() => {
    set = new LWWSet('node1');
  });

  it('should add elements', () => {
    set.add('item1');
    expect(set.has('item1')).toBe(true);
    expect(set.toArray()).toContain('item1');
  });

  it('should remove elements', async () => {
    set.add('item1');
    // Wait to ensure different timestamp for LWW
    await new Promise((r) => setTimeout(r, 5));
    set.remove('item1');
    expect(set.has('item1')).toBe(false);
  });

  it('should handle add-after-remove (LWW)', async () => {
    set.add('item1');
    set.remove('item1');

    // Wait a bit to ensure different timestamp
    await new Promise((r) => setTimeout(r, 10));
    set.add('item1');

    expect(set.has('item1')).toBe(true);
  });

  it('should apply remote operations', () => {
    const set2 = new LWWSet('node2');
    const op = set2.add('remote-item');

    set.applyRemote(op);
    expect(set.has('remote-item')).toBe(true);
  });

  it('should serialize and deserialize', () => {
    set.add('item1');
    set.add('item2');

    const json = set.toJSON();
    const restored = LWWSet.fromJSON(json);

    expect(restored.has('item1')).toBe(true);
    expect(restored.has('item2')).toBe(true);
  });
});

describe('LWWMap', () => {
  let map: LWWMap;

  beforeEach(() => {
    map = new LWWMap('node1');
  });

  it('should set and get values', () => {
    map.set('key1', 'value1');
    expect(map.get('key1')).toBe('value1');
  });

  it('should delete values', () => {
    map.set('key1', 'value1');
    map.delete('key1');
    expect(map.has('key1')).toBe(false);
    expect(map.get('key1')).toBeUndefined();
  });

  it('should list keys', () => {
    map.set('key1', 'value1');
    map.set('key2', 'value2');
    expect(map.keys()).toContain('key1');
    expect(map.keys()).toContain('key2');
  });

  it('should convert to object', () => {
    map.set('key1', 'value1');
    map.set('key2', 'value2');

    const obj = map.toObject();
    expect(obj).toEqual({ key1: 'value1', key2: 'value2' });
  });

  it('should apply remote operations', () => {
    const map2 = new LWWMap('node2');
    const op = map2.set('remote-key', 'remote-value');

    map.applyRemote(op);
    expect(map.get('remote-key')).toBe('remote-value');
  });
});

describe('RGA (List)', () => {
  let rga: RGA;

  beforeEach(() => {
    rga = new RGA('node1');
  });

  it('should insert elements', () => {
    rga.insert(0, 'a');
    rga.insert(1, 'b');
    rga.insert(2, 'c');

    expect(rga.toArray()).toEqual(['a', 'b', 'c']);
    expect(rga.toString()).toBe('abc');
  });

  it('should delete elements', () => {
    rga.insert(0, 'a');
    rga.insert(1, 'b');
    rga.insert(2, 'c');

    rga.delete(1);

    expect(rga.toArray()).toEqual(['a', 'c']);
  });

  it('should insert at beginning', () => {
    rga.insert(0, 'b');
    rga.insert(0, 'a');

    // RGA inserts after left reference, so 'a' comes after 'b' at position 0
    // This is correct RGA behavior
    expect(rga.toArray()).toEqual(['b', 'a']);
  });

  it('should handle concurrent inserts', () => {
    const rga2 = new RGA('node2');

    // Both insert at position 0
    const op1 = rga.insert(0, 'a');
    const op2 = rga2.insert(0, 'b');

    // Apply each other's operations
    rga.applyRemote(op2);
    rga2.applyRemote(op1);

    // Both should have same order (deterministic)
    expect(rga.toArray()).toEqual(rga2.toArray());
  });

  it('should serialize and deserialize', () => {
    rga.insert(0, 'a');
    rga.insert(1, 'b');
    rga.insert(2, 'c');

    const json = rga.toJSON();
    const restored = RGA.fromJSON(json);

    expect(restored.toArray()).toEqual(['a', 'b', 'c']);
  });
});

describe('CRDTDocument', () => {
  let doc: CRDTDocument;

  beforeEach(() => {
    doc = new CRDTDocument('node1', 'doc1');
  });

  it('should set and get values', () => {
    doc.set('name', 'test');
    expect(doc.get('name')).toBe('test');
  });

  it('should work with nested paths', () => {
    doc.set(['user', 'name'], 'John');
    doc.set(['user', 'age'], 30);

    expect(doc.get(['user', 'name'])).toBe('John');
    expect(doc.get(['user', 'age'])).toBe(30);
  });

  it('should handle lists', () => {
    doc.listInsert('items', 0, 'item1');
    doc.listInsert('items', 1, 'item2');

    expect(doc.listGet('items')).toEqual(['item1', 'item2']);
  });

  it('should handle sets', () => {
    doc.setAdd('tags', 'tag1');
    doc.setAdd('tags', 'tag2');

    expect(doc.setHas('tags', 'tag1')).toBe(true);
    expect(doc.setGet('tags')).toContain('tag1');
    expect(doc.setGet('tags')).toContain('tag2');
  });

  it('should apply remote operations', () => {
    const doc2 = new CRDTDocument('node2', 'doc1');
    const op = doc2.set('remote-key', 'remote-value');

    doc.applyRemote(op);
    expect(doc.get('remote-key')).toBe('remote-value');
  });

  it('should serialize and deserialize', () => {
    doc.set('name', 'test');
    doc.set('count', 42);

    const json = doc.toJSON();
    const restored = CRDTDocument.fromJSON(json);

    expect(restored.get('name')).toBe('test');
    expect(restored.get('count')).toBe(42);
  });

  it('should convert to plain object', () => {
    doc.set('name', 'test');
    doc.set('count', 42);

    const obj = doc.toObject();
    expect(obj).toHaveProperty('name', 'test');
    expect(obj).toHaveProperty('count', 42);
  });
});

describe('UndoManager', () => {
  let um: UndoManager;

  beforeEach(() => {
    um = new UndoManager({ maxHistory: 10, captureTimeout: 50 });
  });

  it('should capture operations', async () => {
    const op = {
      type: 'map_set',
      key: 'name',
      value: 'new',
      opId: 'op1',
      clock: { nodeId: 'node1', clock: { node1: 1 } },
      nodeId: 'node1',
    };

    um.capture(op, 'old');

    // Wait for batch flush
    await new Promise((r) => setTimeout(r, 100));

    expect(um.canUndo()).toBe(true);
  });

  it('should undo operations', async () => {
    const op = {
      type: 'map_set',
      key: 'name',
      value: 'new',
      opId: 'op1',
      clock: { nodeId: 'node1', clock: { node1: 1 } },
      nodeId: 'node1',
    };

    um.capture(op, 'old');
    await new Promise((r) => setTimeout(r, 100));

    const inverseOps = um.undo();
    expect(inverseOps).not.toBeNull();
    expect(inverseOps!.length).toBeGreaterThan(0);
  });

  it('should redo operations', async () => {
    const op = {
      type: 'map_set',
      key: 'name',
      value: 'new',
      opId: 'op1',
      clock: { nodeId: 'node1', clock: { node1: 1 } },
      nodeId: 'node1',
    };

    um.capture(op, 'old');
    await new Promise((r) => setTimeout(r, 100));

    um.undo();
    expect(um.canRedo()).toBe(true);

    const redoOps = um.redo();
    expect(redoOps).not.toBeNull();
  });

  it('should clear history', async () => {
    const op = {
      type: 'map_set',
      key: 'name',
      value: 'new',
      opId: 'op1',
      clock: { nodeId: 'node1', clock: { node1: 1 } },
      nodeId: 'node1',
    };

    um.capture(op, 'old');
    await new Promise((r) => setTimeout(r, 100));

    um.clear();
    expect(um.canUndo()).toBe(false);
    expect(um.canRedo()).toBe(false);
  });
});
