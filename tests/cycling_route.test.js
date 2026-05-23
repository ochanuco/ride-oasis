'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseArgs, loadGraph } = require('../scripts/cycling_route');
const { bidirectionalDijkstra } = require('../lib/cycling/bidirectional_dijkstra');

test('parseArgs: --dir / --from / --to を読み取る', () => {
  const r = parseArgs(['--dir', '/x', '--from', '10', '--to', '20']);
  assert.equal(r.dir, '/x');
  assert.equal(r.from, 10);
  assert.equal(r.to, 20);
  assert.equal(r.json, false);
});

test('parseArgs: --json フラグ', () => {
  assert.equal(parseArgs(['--json']).json, true);
});

test('parseArgs: 未知の引数は例外', () => {
  assert.throws(() => parseArgs(['--bogus']), /Unknown argument/);
});

test('loadGraph + bidirectionalDijkstra の E2E', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cycling-route-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'nodes.ndjson'),
      [
        JSON.stringify({ id: 1, lon: 139.7, lat: 35.65 }),
        JSON.stringify({ id: 2, lon: 139.701, lat: 35.6505 }),
        JSON.stringify({ id: 3, lon: 139.702, lat: 35.651 })
      ].join('\n') + '\n'
    );
    fs.writeFileSync(
      path.join(dir, 'edges.ndjson'),
      [
        JSON.stringify({ from: 1, to: 2, cost_m: 100, oneway: false }),
        JSON.stringify({ from: 2, to: 3, cost_m: 100, oneway: false })
      ].join('\n') + '\n'
    );
    const g = loadGraph(dir);
    assert.equal(g.nodeCount, 3);
    const r = bidirectionalDijkstra(g, 1, 3);
    assert.equal(r.distance, 200);
    assert.deepEqual(r.path, [1, 2, 3]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
