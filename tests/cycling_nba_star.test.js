'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  nbaStarOnView,
  aStarOnView,
  bidiDijkstraOnView
} = require('../lib/cycling/tiled_router');

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

function link(view, a, b, cost) {
  const ensure = (m, k) => {
    let arr = m.get(k);
    if (!arr) {
      arr = [];
      m.set(k, arr);
    }
    return arr;
  };
  ensure(view.fwd, a).push({ from: a, to: b, toLon: 0, toLat: 0, cost });
  ensure(view.rev, b).push({ from: a, to: b, cost });
  ensure(view.fwd, b).push({ from: b, to: a, toLon: 0, toLat: 0, cost });
  ensure(view.rev, a).push({ from: b, to: a, cost });
}

test('NBA*: start == goal は distance 0', () => {
  const view = makeView();
  addNode(view, 1, 0, 0);
  const r = nbaStarOnView(view, 1, 1);
  assert.equal(r.distance, 0);
  assert.deepEqual(r.path, [1]);
});

test('NBA*: 直線3ノード A→B→C で最適経路', () => {
  const view = makeView();
  addNode(view, 1, 135.0, 34.0);
  addNode(view, 2, 135.001, 34.0);
  addNode(view, 3, 135.002, 34.0);
  link(view, 1, 2, 100);
  link(view, 2, 3, 100);
  const r = nbaStarOnView(view, 1, 3);
  assert.equal(r.distance, 200);
  assert.deepEqual(r.path, [1, 2, 3]);
});

test('NBA* と A* と bidi Dijkstra が同じ最短距離を返す (グリッド対角)', () => {
  // 5x5 グリッドの対角 + 一部 cost を不均等に
  const view = makeView();
  const W = 5;
  for (let y = 0; y < W; y += 1) {
    for (let x = 0; x < W; x += 1) {
      addNode(view, y * W + x, 135.0 + x * 0.001, 34.0 + y * 0.001);
    }
  }
  for (let y = 0; y < W; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const id = y * W + x;
      if (x + 1 < W) link(view, id, id + 1, 100 + (id % 7));
      if (y + 1 < W) link(view, id, id + W, 100 + (id % 5));
    }
  }
  for (const [s, t] of [[0, 24], [0, 4], [4, 20], [12, 7]]) {
    const nba = nbaStarOnView(view, s, t);
    const a = aStarOnView(view, s, t);
    const d = bidiDijkstraOnView(view, s, t);
    assert.ok(
      Math.abs(nba.distance - d.distance) < 1e-6,
      `s=${s} t=${t} nba=${nba.distance} dijk=${d.distance}`
    );
    assert.equal(nba.distance, a.distance, `s=${s} t=${t} A* / NBA* mismatch`);
  }
});

test('NBA*: 到達不能なら distance Infinity', () => {
  const view = makeView();
  addNode(view, 1, 0, 0);
  addNode(view, 2, 0.001, 0);
  const r = nbaStarOnView(view, 1, 2);
  assert.equal(r.distance, Infinity);
});

test('NBA*: goal ノードが view に居なくても落ちない', () => {
  const view = makeView();
  addNode(view, 1, 0, 0);
  const r = nbaStarOnView(view, 1, 99);
  assert.equal(r.distance, Infinity);
});

test('NBA*: 旧形式 view (sidecar 無し) でも動く', () => {
  // ノード間 ~111m、コスト 200 (>= haversine * MIN_COST_FACTOR=78) で
  // heuristic は consistent。実 OSM の (length * factor>=0.7) を満たす値域。
  const view = {
    nodes: new Map([
      [10, [0, 0]],
      [20, [0.001, 0]],
      [30, [0.002, 0]]
    ]),
    fwd: new Map([
      [10, [{ from: 10, to: 20, cost: 200 }]],
      [20, [{ from: 20, to: 30, cost: 200 }]]
    ]),
    rev: new Map([
      [20, [{ from: 10, to: 20, cost: 200 }]],
      [30, [{ from: 20, to: 30, cost: 200 }]]
    ])
  };
  const r = nbaStarOnView(view, 10, 30);
  assert.equal(r.distance, 400);
  assert.deepEqual(r.path, [10, 20, 30]);
});

test('NBA* は forward A* 比で settled が同程度かそれ以下 (bidi 効果)', () => {
  // 線形 chain でゴール側からも探索が始まるため、forward A* の半分くらいになる
  const view = makeView();
  for (let i = 0; i <= 20; i += 1) addNode(view, i, 135.0 + i * 0.001, 34.0);
  for (let i = 0; i < 20; i += 1) link(view, i, i + 1, 100);
  const nba = nbaStarOnView(view, 0, 20);
  const a = aStarOnView(view, 0, 20);
  assert.equal(nba.distance, a.distance);
  assert.ok(nba.settled <= a.settled, `nba=${nba.settled} a=${a.settled}`);
});
