'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseArgs,
  binarySearch,
  loadSortedIds,
  loadNodesMap,
  passJoin
} = require('../scripts/cycling_build_graph');

test('parseArgs: --pbf と --out を受け取る', () => {
  const r = parseArgs(['--pbf', '/tmp/a.pbf', '--out', '/tmp/out']);
  assert.equal(r.pbf, '/tmp/a.pbf');
  assert.equal(r.out, '/tmp/out');
  assert.equal(r.limit, null);
});

test('parseArgs: --limit は正の数値のみ受け付け', () => {
  assert.equal(parseArgs(['--limit', '1000']).limit, 1000);
  assert.equal(parseArgs(['--limit', '0']).limit, null);
  assert.equal(parseArgs(['--limit', '-5']).limit, null);
  assert.equal(parseArgs(['--limit', 'abc']).limit, null);
});

test('parseArgs: 未知の引数は例外', () => {
  assert.throws(() => parseArgs(['--unknown']), /Unknown argument/);
});

test('parseArgs: --help でフラグだけ立つ', () => {
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-h']).help, true);
});

test('binarySearch: 該当あり / なし / 端', () => {
  const arr = new Float64Array([1, 3, 5, 7, 9]);
  assert.equal(binarySearch(arr, 1), true);
  assert.equal(binarySearch(arr, 9), true);
  assert.equal(binarySearch(arr, 5), true);
  assert.equal(binarySearch(arr, 2), false);
  assert.equal(binarySearch(arr, 0), false);
  assert.equal(binarySearch(arr, 10), false);
});

test('binarySearch: 空配列でも落ちない', () => {
  assert.equal(binarySearch(new Float64Array(0), 1), false);
});

test('loadSortedIds / loadNodesMap で書き戻しが round-trip', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cycling-test-'));
  try {
    const ids = new Float64Array([10, 20, 30]);
    fs.writeFileSync(path.join(dir, 'node_ids.bin'), Buffer.from(ids.buffer));
    const loaded = loadSortedIds(path.join(dir, 'node_ids.bin'));
    assert.deepEqual(Array.from(loaded), [10, 20, 30]);

    fs.writeFileSync(
      path.join(dir, 'nodes.ndjson'),
      [
        JSON.stringify({ id: 10, lon: 139.0, lat: 35.0 }),
        JSON.stringify({ id: 20, lon: 139.01, lat: 35.01 })
      ].join('\n') + '\n'
    );
    const m = loadNodesMap(path.join(dir, 'nodes.ndjson'));
    assert.deepEqual(m.get(10), [139.0, 35.0]);
    assert.deepEqual(m.get(20), [139.01, 35.01]);
    assert.equal(m.size, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('passJoin: ways.ndjson + nodes.ndjson → edges.ndjson の統合動作', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cycling-test-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'ways.ndjson'),
      [
        JSON.stringify({ id: 1, refs: [10, 11], tags: { highway: 'residential' } }),
        JSON.stringify({ id: 2, refs: [11, 12], tags: { highway: 'cycleway' } }),
        JSON.stringify({ id: 3, refs: [12, 999], tags: { highway: 'primary' } })
      ].join('\n') + '\n'
    );
    fs.writeFileSync(
      path.join(dir, 'nodes.ndjson'),
      [
        JSON.stringify({ id: 10, lon: 139.7, lat: 35.65 }),
        JSON.stringify({ id: 11, lon: 139.701, lat: 35.6505 }),
        JSON.stringify({ id: 12, lon: 139.702, lat: 35.651 })
      ].join('\n') + '\n'
    );

    const r = await passJoin(dir);
    assert.equal(r.waysProcessed, 3);
    assert.equal(r.edges, 2);
    assert.equal(r.skippedMissingNode, 1);

    const written = fs
      .readFileSync(path.join(dir, 'edges.ndjson'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.equal(written.length, 2);
    assert.equal(written[0].kind, 'residential');
    assert.equal(written[1].kind, 'cycleway');
    assert.ok(written[1].cost_m < written[1].length_m);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
