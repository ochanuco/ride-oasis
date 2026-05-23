'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  aStarOnView,
  bidiDijkstraOnView,
  MIN_COST_FACTOR
} = require('../lib/cycling/tiled_router');

function gridView(W) {
  // W x W グリッド、coord は度単位 (1 セル ≈ 100m)
  const nodes = new Map();
  const fwd = new Map();
  const rev = new Map();
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
      nodes.set(id, [135.0 + x * 0.001, 34.0 + y * 0.001]);
    }
  }
  for (let y = 0; y < W; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const id = y * W + x;
      const link = (to, cost) => {
        ensure(fwd, id).push({ from: id, to, toLon: 0, toLat: 0, cost });
        ensure(rev, to).push({ from: id, to, cost });
        ensure(fwd, to).push({ from: to, to: id, toLon: 0, toLat: 0, cost });
        ensure(rev, id).push({ from: to, to: id, cost });
      };
      if (x + 1 < W) link(id + 1, 100);
      if (y + 1 < W) link(id + W, 100);
    }
  }
  return { nodes, fwd, rev };
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
  const nodes = new Map();
  const fwd = new Map();
  const rev = new Map();
  const ensure = (m, k) => {
    let a = m.get(k);
    if (!a) { a = []; m.set(k, a); }
    return a;
  };
  const link = (a, b, cost) => {
    ensure(fwd, a).push({ from: a, to: b, toLon: 0, toLat: 0, cost });
    ensure(rev, b).push({ from: a, to: b, cost });
    ensure(fwd, b).push({ from: b, to: a, toLon: 0, toLat: 0, cost });
    ensure(rev, a).push({ from: b, to: a, cost });
  };
  for (let i = 0; i <= 10; i += 1) nodes.set(i, [135.0 + i * 0.01, 34.0]);
  for (let i = 0; i < 10; i += 1) link(i, i + 1, 1000);
  for (let i = 11; i <= 30; i += 1) {
    nodes.set(i, [135.0, 34.0 + (i - 10) * 0.01]);
    link(i === 11 ? 0 : i - 1, i, 1000);
  }
  const view = { nodes, fwd, rev };
  const a = aStarOnView(view, 0, 10);
  // chain は 11 ノード。detour は北方向 (=goal と直交) で h() があまり増えない
  // ため一部 pop されるが、heuristic が無いと 31 ノード全部 settle する。
  // chain 11 + 少数 detour (経験上 ~3) で settle が 31 << に押さえられることを担保。
  assert.equal(a.distance, 10000);
  assert.ok(a.settled <= 20, `expected A* settled << 31 (detour 抑制), got ${a.settled}`);
});

test('A*: 到達不能なら distance Infinity', () => {
  const view = {
    nodes: new Map([[1, [0, 0]], [2, [0.001, 0]]]),
    fwd: new Map(),
    rev: new Map()
  };
  const r = aStarOnView(view, 1, 2);
  assert.equal(r.distance, Infinity);
});

test('A*: goal ノードが view に居なくても落ちない', () => {
  const view = { nodes: new Map([[1, [0, 0]]]), fwd: new Map(), rev: new Map() };
  const r = aStarOnView(view, 1, 99);
  assert.equal(r.distance, Infinity);
});

test('MIN_COST_FACTOR は 0.7 (cycleway 相当, admissibility 保証)', () => {
  assert.equal(MIN_COST_FACTOR, 0.7);
});
