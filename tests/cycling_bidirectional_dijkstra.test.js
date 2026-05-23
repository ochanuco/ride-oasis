'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Graph, buildGraphFromArrays } = require('../lib/cycling/graph');
const { bidirectionalDijkstra } = require('../lib/cycling/bidirectional_dijkstra');

function edge(from, to, cost, oneway = false) {
  return { from, to, cost_m: cost, oneway };
}

function nodesAt(coords) {
  return coords.map(([id, lon, lat]) => ({ id, lon, lat }));
}

test('start == goal は distance 0 と 1 ノード経路', () => {
  const g = buildGraphFromArrays(nodesAt([[1, 0, 0]]), []);
  const r = bidirectionalDijkstra(g, 1, 1);
  assert.equal(r.distance, 0);
  assert.deepEqual(r.path, [1]);
});

test('直線3ノード A→B→C: 最短経路と距離', () => {
  const nodes = nodesAt([[1, 0, 0], [2, 0, 0], [3, 0, 0]]);
  const edges = [edge(1, 2, 100), edge(2, 3, 150)];
  const g = buildGraphFromArrays(nodes, edges);
  const r = bidirectionalDijkstra(g, 1, 3);
  assert.equal(r.distance, 250);
  assert.deepEqual(r.path, [1, 2, 3]);
});

test('双方向エッジ (oneway=false) は逆向きも通れる', () => {
  const nodes = nodesAt([[1, 0, 0], [2, 0, 0]]);
  const g = buildGraphFromArrays(nodes, [edge(1, 2, 50, false)]);
  const r = bidirectionalDijkstra(g, 2, 1);
  assert.equal(r.distance, 50);
  assert.deepEqual(r.path, [2, 1]);
});

test('oneway=true は逆走不可 (到達不能)', () => {
  const nodes = nodesAt([[1, 0, 0], [2, 0, 0]]);
  const g = buildGraphFromArrays(nodes, [edge(1, 2, 50, true)]);
  const r = bidirectionalDijkstra(g, 2, 1);
  assert.equal(r.distance, Infinity);
  assert.deepEqual(r.path, []);
});

test('複数経路から最短を選ぶ (直行 vs 迂回)', () => {
  // 1 → 2 → 4 (10 + 10 = 20)
  // 1 → 3 → 4 (5 + 5 = 10)  <- 最短
  const nodes = nodesAt([[1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0]]);
  const edges = [
    edge(1, 2, 10),
    edge(2, 4, 10),
    edge(1, 3, 5),
    edge(3, 4, 5)
  ];
  const g = buildGraphFromArrays(nodes, edges);
  const r = bidirectionalDijkstra(g, 1, 4);
  assert.equal(r.distance, 10);
  assert.deepEqual(r.path, [1, 3, 4]);
});

test('到達不能 (連結成分が違う)', () => {
  const nodes = nodesAt([[1, 0, 0], [2, 0, 0], [3, 0, 0]]);
  const g = buildGraphFromArrays(nodes, [edge(1, 2, 10)]);
  const r = bidirectionalDijkstra(g, 1, 3);
  assert.equal(r.distance, Infinity);
  assert.deepEqual(r.path, []);
});

test('一方通行ループ: 行ける方は最短取得', () => {
  // 1 →(5)→ 2 →(5)→ 3、3→1 はない (一方通行)
  const nodes = nodesAt([[1, 0, 0], [2, 0, 0], [3, 0, 0]]);
  const edges = [edge(1, 2, 5, true), edge(2, 3, 5, true)];
  const g = buildGraphFromArrays(nodes, edges);
  const fwd = bidirectionalDijkstra(g, 1, 3);
  assert.equal(fwd.distance, 10);
  assert.deepEqual(fwd.path, [1, 2, 3]);
  const back = bidirectionalDijkstra(g, 3, 1);
  assert.equal(back.distance, Infinity);
});

test('双方向探索の meeting node は中央に近いことを確認 (settled 数で)', () => {
  // 1-2-3-4-5-6-7 の直線、各エッジ cost=1
  // 全探索ダイクストラなら 7 ノード settled になる
  // 双方向ならおよそ半分程度で停止
  const nodes = nodesAt(Array.from({ length: 7 }, (_, i) => [i + 1, 0, 0]));
  const edges = Array.from({ length: 6 }, (_, i) => edge(i + 1, i + 2, 1));
  const g = buildGraphFromArrays(nodes, edges);
  const r = bidirectionalDijkstra(g, 1, 7);
  assert.equal(r.distance, 6);
  assert.deepEqual(r.path, [1, 2, 3, 4, 5, 6, 7]);
  // 双方向の効果: 全 7 + 7 = 14 ノード settled よりは少なくなるはず
  assert.ok(r.settled < 14, `expected fewer settled, got ${r.settled}`);
});

test('start と隣接ノードに直接ゴールがあるケース', () => {
  const nodes = nodesAt([[1, 0, 0], [2, 0, 0]]);
  const g = buildGraphFromArrays(nodes, [edge(1, 2, 42)]);
  const r = bidirectionalDijkstra(g, 1, 2);
  assert.equal(r.distance, 42);
  assert.deepEqual(r.path, [1, 2]);
});

test('単方向ダイクストラ等価性 (ランダム小グラフでスポット比較)', () => {
  // 既知の正解と比較
  // グラフ:
  //   1 → 2 (cost 4)
  //   1 → 3 (cost 2)
  //   2 → 3 (cost 1)
  //   2 → 4 (cost 5)
  //   3 → 4 (cost 8)
  //   3 → 5 (cost 10)
  //   4 → 5 (cost 2)
  //   全て一方通行
  const nodes = nodesAt([[1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0], [5, 0, 0]]);
  const edges = [
    edge(1, 2, 4, true),
    edge(1, 3, 2, true),
    edge(2, 3, 1, true),
    edge(2, 4, 5, true),
    edge(3, 4, 8, true),
    edge(3, 5, 10, true),
    edge(4, 5, 2, true)
  ];
  const g = buildGraphFromArrays(nodes, edges);
  const r = bidirectionalDijkstra(g, 1, 5);
  // 1→2→4→5 = 4+5+2 = 11
  // 1→3→5 = 2+10 = 12
  // 最短は 11
  assert.equal(r.distance, 11);
  assert.deepEqual(r.path, [1, 2, 4, 5]);
});
