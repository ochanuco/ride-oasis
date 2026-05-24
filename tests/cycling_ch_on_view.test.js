'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  chQueryOnView,
  nbaStarOnView,
  unpackChEdge
} = require('../lib/cycling/tiled_router');

function makeView() {
  return {
    nodes: new Map(),
    fwd: new Map(),
    rev: new Map(),
    nodeIdToIndex: new Map(),
    indexToNodeId: [],
    levels: new Map(),
    cores: new Set(),
    hasCh: false
  };
}

function addNode(view, id, lon, lat, level, core) {
  view.nodes.set(id, [lon, lat]);
  view.nodeIdToIndex.set(id, view.indexToNodeId.length);
  view.indexToNodeId.push(id);
  if (level !== undefined) view.levels.set(id, level);
  if (core) view.cores.add(id);
}

function ensure(m, k) {
  let a = m.get(k);
  if (!a) { a = []; m.set(k, a); }
  return a;
}

function link(view, from, to, cost, viaId = 0) {
  const fromCoord = view.nodes.get(from);
  const toCoord = view.nodes.get(to);
  const fwd = { from, to, toLon: toCoord[0], toLat: toCoord[1], cost, viaId };
  ensure(view.fwd, from).push(fwd);
  ensure(view.rev, to).push(fwd);
  const back = { from: to, to: from, toLon: fromCoord[0], toLat: fromCoord[1], cost, viaId };
  ensure(view.fwd, to).push(back);
  ensure(view.rev, from).push(back);
}

test('CH: start == goal は distance 0', () => {
  const view = makeView();
  addNode(view, 1, 0, 0, 5);
  const r = chQueryOnView(view, 1, 1);
  assert.equal(r.distance, 0);
  assert.deepEqual(r.path, [1]);
});

test('CH: 直線 chain (level 単調) で最短経路を返す', () => {
  // 4 nodes 0->1->2->3, levels 0,1,2,3 — forward search uphill from 0 to 3
  const view = makeView();
  addNode(view, 0, 0, 0, 0);
  addNode(view, 1, 0.001, 0, 1);
  addNode(view, 2, 0.002, 0, 2);
  addNode(view, 3, 0.003, 0, 3);
  link(view, 0, 1, 100);
  link(view, 1, 2, 100);
  link(view, 2, 3, 100);
  const r = chQueryOnView(view, 0, 3);
  assert.equal(r.distance, 300);
  assert.deepEqual(r.path, [0, 1, 2, 3]);
});

test('CH: level に従わないエッジは relax されない (制約確認)', () => {
  // 0 (level=5) - 1 (level=10) - 2 (level=3): forward は 0→1 で止まる、2 へは行けない
  const view = makeView();
  addNode(view, 0, 0, 0, 5);
  addNode(view, 1, 0.001, 0, 10);
  addNode(view, 2, 0.002, 0, 3); // lower than 1
  link(view, 0, 1, 100);
  link(view, 1, 2, 100);
  const r = chQueryOnView(view, 0, 2);
  // forward は 1 (level 10) まで、そこから 2 (level 3) は降りない → 到達不能
  // backward は 2 (level 3) から 1 (level 10) を rev で見て上に上がれる
  // 1 で meeting 可能
  assert.equal(r.distance, 200);
  assert.deepEqual(r.path, [0, 1, 2]);
});

test('CH: shortcut edge を unpackChEdge で展開', () => {
  // path: 0 -> 1 -> 2, shortcut (0, 2) via 1
  const view = makeView();
  addNode(view, 0, 0, 0, 0);
  addNode(view, 1, 0.001, 0, 1);
  addNode(view, 2, 0.002, 0, 2);
  link(view, 0, 1, 100);
  link(view, 1, 2, 100);
  link(view, 0, 2, 200, 1); // shortcut via 1
  const expanded = [0];
  unpackChEdge(view, 0, 2, expanded);
  assert.deepEqual(expanded, [0, 1, 2]);
});

test('CH: 多段 shortcut (深さ 3) も iterative に展開', () => {
  // 0 -> 1 -> 2 -> 3 -> 4
  // shortcut (1, 3) via 2
  // shortcut (0, 3) via 1 (再帰: 0→1 ; (1→3 via 2 = 1→2 ; 2→3))
  // つまり 0→3 を展開すると 0→1→2→3
  const view = makeView();
  for (let i = 0; i <= 4; i += 1) addNode(view, i, i * 0.001, 0, i);
  link(view, 0, 1, 100);
  link(view, 1, 2, 100);
  link(view, 2, 3, 100);
  link(view, 3, 4, 100);
  link(view, 1, 3, 200, 2);
  link(view, 0, 3, 300, 1);
  const expanded = [0];
  unpackChEdge(view, 0, 3, expanded);
  assert.deepEqual(expanded, [0, 1, 2, 3]);
});

test('CH: 無 level (旧形式) は Infinity', () => {
  const view = makeView();
  addNode(view, 1, 0, 0); // no level
  addNode(view, 2, 0.001, 0); // no level
  link(view, 1, 2, 100);
  const r = chQueryOnView(view, 1, 2);
  assert.equal(r.distance, Infinity);
});

test('CH: core-core lateral relax (level 制約なしで横移動可能)', () => {
  // 0 (level=10, core=1) - 1 (level=5, core=1) - 2 (level=10, core=0)
  // 0→1 は level 10→5 で通常なら upward only に違反するが、両端 core なので relax 許可
  // 2 は core でない (uncontracted top でも degree-skipped でもない通常ノード)
  const view = makeView();
  addNode(view, 0, 0, 0, 10, /*core*/ true);
  addNode(view, 1, 0.001, 0, 5, /*core*/ true);
  addNode(view, 2, 0.002, 0, 10, /*core*/ false);
  link(view, 0, 1, 100); // core-core lateral
  link(view, 1, 2, 100); // core-non_core upward (5→10) OK
  const r = chQueryOnView(view, 0, 2);
  assert.equal(r.distance, 200);
});

test('CH: core 無しで level 10→5 は relax 不可 (制約確認)', () => {
  // 0 (level=10, core=0) - 1 (level=5, core=0)
  // 通常 CH 制約で forward 0→1 不可、backward 1→0 も rev edge から見ると同様
  const view = makeView();
  addNode(view, 0, 0, 0, 10, /*core*/ false);
  addNode(view, 1, 0.001, 0, 5, /*core*/ false);
  link(view, 0, 1, 100);
  const r = chQueryOnView(view, 0, 1);
  // forward: 0 (L10) から 1 (L5) は下降 → skip
  // backward: 1 (L5) から rev edge を見ても from=0 (L10) > to=1 (L5) なので upward OK
  //   → backward は 0 を settle、forward は 0 を settle、distF=0, distB=100、meet at 0
  // meeting=0、best=100。距離は OK
  assert.equal(r.distance, 100);
});

test('CH と NBA* が同じ最短距離 (synthetic CH-encoded graph)', () => {
  // 同じグラフを (a) plain で NBA*、(b) CH 風 (level 単調) で chQuery
  // 結果一致
  const plain = makeView();
  for (let i = 0; i <= 5; i += 1) addNode(plain, i, i * 0.001, 0);
  for (let i = 0; i < 5; i += 1) link(plain, i, i + 1, 100);

  const ch = makeView();
  for (let i = 0; i <= 5; i += 1) addNode(ch, i, i * 0.001, 0, i);
  for (let i = 0; i < 5; i += 1) link(ch, i, i + 1, 100);

  const a = nbaStarOnView(plain, 0, 5);
  const b = chQueryOnView(ch, 0, 5);
  assert.ok(Math.abs(a.distance - b.distance) < 1e-6, `nba=${a.distance} ch=${b.distance}`);
});
