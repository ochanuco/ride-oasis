'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildContractionHierarchy } = require('../lib/cycling/ch_builder');
const { chQuery } = require('../lib/cycling/ch_query');
const { buildGraphFromArrays } = require('../lib/cycling/graph');
const { bidirectionalDijkstra } = require('../lib/cycling/bidirectional_dijkstra');

function edge(from, to, cost, oneway = false) {
  return { from, to, cost_m: cost, oneway };
}

function nodesAt(coords) {
  return coords.map(([id, lon, lat]) => ({ id, lon, lat }));
}

function compareWithDijkstra(nodes, edges, pairs) {
  const g = buildGraphFromArrays(nodes, edges);
  const ch = buildContractionHierarchy(edges);
  for (const [s, t] of pairs) {
    const baseline = bidirectionalDijkstra(g, s, t);
    const ch_r = chQuery(ch.adj, ch.level, s, t);
    if (!Number.isFinite(baseline.distance)) {
      assert.equal(ch_r.distance, Infinity, `expected unreachable s=${s} t=${t}`);
      continue;
    }
    assert.ok(
      Math.abs(ch_r.distance - baseline.distance) < 1e-9,
      `distance mismatch s=${s} t=${t} baseline=${baseline.distance} ch=${ch_r.distance}`
    );
    const sumOriginal = computePathCost(ch_r.path, edges);
    assert.ok(
      Math.abs(sumOriginal - ch_r.distance) < 1e-9,
      `unpacked path cost mismatch s=${s} t=${t} unpacked=${sumOriginal} reported=${ch_r.distance}`
    );
  }
}

function computePathCost(path, edges) {
  if (path.length < 2) return 0;
  const map = new Map();
  for (const e of edges) {
    map.set(`${e.from}-${e.to}`, e.cost_m);
    if (!e.oneway) map.set(`${e.to}-${e.from}`, e.cost_m);
  }
  let sum = 0;
  for (let i = 1; i < path.length; i += 1) {
    const c = map.get(`${path[i - 1]}-${path[i]}`);
    if (c === undefined) throw new Error(`no edge ${path[i - 1]}-${path[i]}`);
    sum += c;
  }
  return sum;
}

test('CH: 直線3ノードでダイクストラと一致', () => {
  const nodes = nodesAt([[1, 0, 0], [2, 0, 0], [3, 0, 0]]);
  const edges = [edge(1, 2, 100), edge(2, 3, 150)];
  compareWithDijkstra(nodes, edges, [[1, 3], [3, 1]]);
});

test('CH: 分岐ありグラフでダイクストラと一致', () => {
  const nodes = nodesAt([[1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0]]);
  const edges = [
    edge(1, 2, 10),
    edge(2, 4, 10),
    edge(1, 3, 5),
    edge(3, 4, 5)
  ];
  compareWithDijkstra(nodes, edges, [[1, 4], [4, 1], [1, 3], [2, 4]]);
});

test('CH: 一方通行混在グラフでダイクストラと一致', () => {
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
  compareWithDijkstra(nodes, edges, [[1, 5], [1, 4], [2, 5]]);
});

test('CH: 到達不能ペアは Infinity', () => {
  const nodes = nodesAt([[1, 0, 0], [2, 0, 0], [3, 0, 0]]);
  const edges = [edge(1, 2, 10)];
  const ch = buildContractionHierarchy(edges);
  const r = chQuery(ch.adj, ch.level, 1, 3);
  assert.equal(r.distance, Infinity);
});

test('CH: 大きめのグリッドグラフ (10x10) でダイクストラと完全一致', () => {
  const W = 10;
  const nodes = [];
  for (let y = 0; y < W; y += 1) {
    for (let x = 0; x < W; x += 1) {
      nodes.push({ id: y * W + x, lon: x, lat: y });
    }
  }
  const edges = [];
  for (let y = 0; y < W; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const id = y * W + x;
      if (x + 1 < W) edges.push(edge(id, id + 1, 1 + Math.random() * 0.1));
      if (y + 1 < W) edges.push(edge(id, id + W, 1 + Math.random() * 0.1));
    }
  }
  compareWithDijkstra(nodes, edges, [
    [0, 99],
    [0, 9],
    [9, 90],
    [5, 95],
    [50, 59]
  ]);
});

test('CH: ショートカット展開後の経路は元エッジだけで構成', () => {
  const nodes = nodesAt(Array.from({ length: 5 }, (_, i) => [i + 1, i, 0]));
  const edges = [
    edge(1, 2, 1),
    edge(2, 3, 1),
    edge(3, 4, 1),
    edge(4, 5, 1)
  ];
  const ch = buildContractionHierarchy(edges);
  const r = chQuery(ch.adj, ch.level, 1, 5);
  assert.equal(r.distance, 4);
  assert.deepEqual(r.path, [1, 2, 3, 4, 5]);
});

test('CH: start == goal は path 1 ノード', () => {
  const nodes = nodesAt([[1, 0, 0]]);
  const ch = buildContractionHierarchy([]);
  ch.level.set(1, 0);
  const r = chQuery(ch.adj, ch.level, 1, 1);
  assert.equal(r.distance, 0);
  assert.deepEqual(r.path, [1]);
});
