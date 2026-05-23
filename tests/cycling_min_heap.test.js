'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { MinHeap } = require('../lib/cycling/min_heap');

test('MinHeap: 空のときの pop/peek は undefined', () => {
  const h = new MinHeap();
  assert.equal(h.size, 0);
  assert.equal(h.pop(), undefined);
  assert.equal(h.peek(), undefined);
});

test('MinHeap: 単一要素', () => {
  const h = new MinHeap();
  h.push(5, 'a');
  assert.equal(h.size, 1);
  assert.deepEqual(h.peek(), { key: 5, val: 'a' });
  assert.deepEqual(h.pop(), { key: 5, val: 'a' });
  assert.equal(h.size, 0);
});

test('MinHeap: 昇順に取り出される', () => {
  const h = new MinHeap();
  const inserted = [5, 3, 8, 1, 9, 2, 7, 4, 6, 0];
  for (const k of inserted) h.push(k, `v${k}`);
  const out = [];
  while (h.size > 0) out.push(h.pop().key);
  assert.deepEqual(out, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('MinHeap: 同一キーでも安定動作 (順不同で全て出る)', () => {
  const h = new MinHeap();
  h.push(1, 'a');
  h.push(1, 'b');
  h.push(1, 'c');
  const out = new Set();
  while (h.size > 0) out.add(h.pop().val);
  assert.deepEqual([...out].sort(), ['a', 'b', 'c']);
});

test('MinHeap: 浮動小数キーでも順序が崩れない', () => {
  const h = new MinHeap();
  for (const k of [3.7, 1.2, 2.5, 0.1, 9.9]) h.push(k, k);
  const out = [];
  while (h.size > 0) out.push(h.pop().key);
  assert.deepEqual(out, [0.1, 1.2, 2.5, 3.7, 9.9]);
});
