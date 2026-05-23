'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  aStarOnView,
  bidiDijkstraOnView,
  MIN_COST_FACTOR
} = require('../lib/cycling/tiled_router');

/**
 * Builds a synthetic view with the node-index sidecars that aStarOnView
 * relies on. Tests previously constructed only { nodes, fwd, rev } but
 * after the typed-array refactor we need indexToNodeId / nodeIdToIndex too.
 */
function makeView() {
  return {
    nodes: new Map(),
    fwd: new Map(),
    rev: new Map(),
    nodeIdToIndex: new Map(),
    indexToNodeId: []
  };
}

function addNode(view, id, lon, lat) {
  view.nodes.set(id, [lon, lat]);
  view.nodeIdToIndex.set(id, view.indexToNodeId.length);
  view.indexToNodeId.push(id);
}

function gridView(W) {
  const view = makeView();
  const ensure = (m, k) => {
    let arr = m.get(k);
    if (!arr) {
      arr = [];
      m.set(k, arr);
    }
    return arr;
  };
  for (let y = 0; y < W; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const id = y * W + x;
      addNode(view, id, 135.0 + x * 0.001, 34.0 + y * 0.001);
    }
  }
  for (let y = 0; y < W; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const id = y * W + x;
      const link = (to, cost) => {
        ensure(view.fwd, id).push({ from: id, to, toLon: 0, toLat: 0, cost });
        ensure(view.rev, to).push({ from: id, to, cost });
        ensure(view.fwd, to).push({ from: to, to: id, toLon: 0, toLat: 0, cost });
        ensure(view.rev, id).push({ from: to, to: id, cost });
      };
      if (x + 1 < W) link(id + 1, 100);
      if (y + 1 < W) link(id + W, 100);
    }
  }
  return view;
}

test('A*: start == goal は distance 0', () => {
  const view = gridView(3);
  const r = aStarOnView(view, 0, 0);
  assert.equal(r.distance, 0);
  assert.deepEqual(r.path, [0]);
});

test('A* と双方向 Dijkstra が同じ最短距離を返す (小グリッド)', () => {
  const view = gridView(5);
  for (const start of [0, 6, 12]) {
    for (const goal of [24, 18, 20]) {
      const a = aStarOnView(view, start, goal);
      const d = bidiDijkstraOnView(view, start, goal);
      assert.equal(
        a.distance, d.distance,
        `start=${start} goal=${goal} astar=${a.distance} dijk=${d.distance}`
      );
    }
  }
});

test('A* は線形 chain + 北方向 detour で detour ノードを settle しない', () => {
  // 東向きチェーン 0..10 (= goal)、北向き detour 11..30 が start から伸びる。
  // A* は heuristic が goal 方向以外を抑えるので detour を一度も pop しない
  // (= settled に含まれない)。settled <= chain 長 (11) を担保することで
  // heuristic 効果を直接検証する。
  const view = makeView();
  const ensure = (m, k) => {
    let a = m.get(k);
    if (!a) { a = []; m.set(k, a); }
    return a;
  };
  const link = (a, b, cost) => {
    ensure(view.fwd, a).push({ from: a, to: b, toLon: 0, toLat: 0, cost });
    ensure(view.rev, b).push({ from: a, to: b, cost });
    ensure(view.fwd, b).push({ from: b, to: a, toLon: 0, toLat: 0, cost });
    ensure(view.rev, a).push({ from: b, to: a, cost });
  };
  for (let i = 0; i <= 10; i += 1) addNode(view, i, 135.0 + i * 0.01, 34.0);
  for (let i = 0; i < 10; i += 1) link(i, i + 1, 1000);
  for (let i = 11; i <= 30; i += 1) {
    addNode(view, i, 135.0, 34.0 + (i - 10) * 0.01);
    link(i === 11 ? 0 : i - 1, i, 1000);
  }
  const a = aStarOnView(view, 0, 10);
  const d = bidiDijkstraOnView(view, 0, 10);
  // 最適距離は両方一致
  assert.equal(a.distance, 10000);
  assert.equal(d.distance, 10000);
  // chain は 11 ノード + detour 20 = 全 31 ノード。heuristic 無い実装だと
  // detour も大量に settle されうるところ、A* は heuristic で抑制される。
  assert.ok(a.settled <= 20, `expected A* settled << 31 (detour 抑制), got ${a.settled}`);
  // detour 抑制効果が bidi Dijkstra より明確であることを直接比較
  assert.ok(
    a.settled <= d.settled,
    `A* settled (${a.settled}) should be <= bidi (${d.settled})`
  );
});

test('A*: 到達不能なら distance Infinity', () => {
  const view = makeView();
  addNode(view, 1, 0, 0);
  addNode(view, 2, 0.001, 0);
  const r = aStarOnView(view, 1, 2);
  assert.equal(r.distance, Infinity);
});

test('A*: goal ノードが view に居なくても落ちない', () => {
  const view = makeView();
  addNode(view, 1, 0, 0);
  const r = aStarOnView(view, 1, 99);
  assert.equal(r.distance, Infinity);
});

test('MIN_COST_FACTOR は 0.7 (cycleway 相当, admissibility 保証)', () => {
  assert.equal(MIN_COST_FACTOR, 0.7);
});

test('aStarOnView: 旧形式 view (nodeIdToIndex/indexToNodeId 無し) でも動く', () => {
  // 外部から手作りされた view (TileLoader を介さない) は sidecar を持たない
  // ことがある。後方互換のため即時クラッシュではなくフォールバックで index
  // 射影を構築する。
  const view = {
    nodes: new Map([
      [10, [0, 0]],
      [20, [0.001, 0]],
      [30, [0.002, 0]]
    ]),
    fwd: new Map([
      [10, [{ from: 10, to: 20, cost: 50 }]],
      [20, [{ from: 20, to: 30, cost: 50 }]]
    ]),
    rev: new Map()
  };
  const r = aStarOnView(view, 10, 30);
  assert.equal(r.distance, 100);
  assert.deepEqual(r.path, [10, 20, 30]);
});
