'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CyclingRouter } = require('../lib/cycling/router');

function buildSquareRouter() {
  // 4 ノードの正方形 + 対角無し
  //  3 — 4
  //  |   |
  //  1 — 2
  const router = new CyclingRouter();
  router.addNode(1, 139.700, 35.650);
  router.addNode(2, 139.701, 35.650);
  router.addNode(3, 139.700, 35.651);
  router.addNode(4, 139.701, 35.651);
  router.addEdge({ from: 1, to: 2, cost_m: 90, oneway: false });
  router.addEdge({ from: 1, to: 3, cost_m: 110, oneway: false });
  router.addEdge({ from: 2, to: 4, cost_m: 110, oneway: false });
  router.addEdge({ from: 3, to: 4, cost_m: 90, oneway: false });
  return router;
}

test('正常: 端点クリックを最近傍ノードにスナップしてルート返却', () => {
  const router = buildSquareRouter();
  const r = router.route(139.7001, 35.6501, 139.7009, 35.6509);
  assert.equal(r.error, undefined);
  assert.ok(r.coordinates.length >= 2);
  assert.equal(r.coordinates[0][0], 139.700);
  assert.equal(r.coordinates[r.coordinates.length - 1][0], 139.701);
});

test('スナップ閾値超えなら no_nearby_node エラー', () => {
  const router = buildSquareRouter();
  const r = router.route(150.0, 40.0, 139.7, 35.65);
  assert.equal(r.error, 'no_nearby_node_from');
});

test('到達不能なら unreachable + from/to node IDs', () => {
  const router = new CyclingRouter();
  router.addNode(1, 139.700, 35.650);
  router.addNode(2, 139.800, 35.650);
  const r = router.route(139.700, 35.650, 139.800, 35.650);
  assert.equal(r.error, 'unreachable');
  assert.equal(r.from_node, 1);
  assert.equal(r.to_node, 2);
});

test('NDJSON ロードで動作する', () => {
  const router = new CyclingRouter();
  const nodes = [
    JSON.stringify({ id: 1, lon: 139.7, lat: 35.65 }),
    JSON.stringify({ id: 2, lon: 139.701, lat: 35.65 })
  ].join('\n');
  const edges = [
    JSON.stringify({ from: 1, to: 2, cost_m: 90, oneway: false })
  ].join('\n');
  router.loadFromNDJSON(nodes, edges);
  assert.equal(router.nodeCount, 2);
  const r = router.route(139.7, 35.65, 139.701, 35.65);
  assert.deepEqual(r.coordinates, [[139.7, 35.65], [139.701, 35.65]]);
});

test('snap_from_m / snap_to_m が返る', () => {
  const router = buildSquareRouter();
  const r = router.route(139.7001, 35.6501, 139.7009, 35.6509);
  assert.ok(Number.isFinite(r.snap_from_m));
  assert.ok(Number.isFinite(r.snap_to_m));
  assert.ok(r.snap_from_m < 100);
});

test('maxSnapMeters を渡せばスナップ閾値を変えられる', () => {
  const router = buildSquareRouter();
  // 通常は OK、maxSnapMeters=0.1 だと too far
  const ok = router.route(139.7001, 35.6501, 139.7009, 35.6509);
  assert.equal(ok.error, undefined);
  const tight = router.route(139.7001, 35.6501, 139.7009, 35.6509, { maxSnapMeters: 0.1 });
  assert.equal(tight.error, 'no_nearby_node_from');
});
