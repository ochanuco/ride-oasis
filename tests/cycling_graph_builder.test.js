'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  edgesForWay,
  buildEdges,
  collectReferencedNodeIds
} = require('../lib/cycling/graph_builder');

function nodeMap(entries) {
  return new Map(entries);
}

test('単一way: residentialの3ノード列から2エッジ生成', () => {
  const way = {
    id: 1,
    refs: [10, 11, 12],
    tags: { highway: 'residential' }
  };
  const coords = nodeMap([
    [10, [139.7, 35.65]],
    [11, [139.701, 35.6505]],
    [12, [139.702, 35.651]]
  ]);
  const { edges } = edgesForWay(way, coords);
  assert.equal(edges.length, 2);
  assert.deepEqual(
    edges.map((e) => [e.from, e.to]),
    [[10, 11], [11, 12]]
  );
  for (const e of edges) {
    assert.ok(e.length_m > 0);
    assert.equal(e.cost_m, e.length_m * 0.9);
    assert.equal(e.kind, 'residential');
    assert.equal(e.oneway, false);
    assert.equal(e.way_id, 1);
  }
});

test('motorway は除外フラグが立ち、エッジは出ない', () => {
  const way = { id: 9, refs: [1, 2], tags: { highway: 'motorway' } };
  const coords = nodeMap([[1, [139, 35]], [2, [139.001, 35]]]);
  const r = edgesForWay(way, coords);
  assert.equal(r.excluded, true);
  assert.equal(r.edges.length, 0);
});

test('参照ノードが座標マップに無い場合はスキップとしてカウント', () => {
  const way = { id: 2, refs: [10, 11, 12], tags: { highway: 'residential' } };
  const coords = nodeMap([
    [10, [139.7, 35.65]],
    [12, [139.702, 35.651]]
  ]);
  const r = edgesForWay(way, coords);
  assert.equal(r.edges.length, 0);
  assert.equal(r.skippedMissingNode, 2);
});

test('連続する同一ノードIDはスキップ (ゼロ長, スキップカウント外)', () => {
  const way = { id: 3, refs: [10, 10, 11], tags: { highway: 'residential' } };
  const coords = nodeMap([[10, [139.7, 35.65]], [11, [139.701, 35.6505]]]);
  const r = edgesForWay(way, coords);
  assert.equal(r.edges.length, 1);
  assert.equal(r.skippedZeroLength, 0);
});

test('ref が1個以下はエッジ無し (例外なし)', () => {
  const coords = nodeMap([[10, [139.7, 35.65]]]);
  assert.equal(edgesForWay({ id: 1, refs: [10], tags: { highway: 'residential' } }, coords).edges.length, 0);
  assert.equal(edgesForWay({ id: 1, refs: [], tags: { highway: 'residential' } }, coords).edges.length, 0);
});

test('oneway=yes は edge.oneway=true で伝搬', () => {
  const way = { id: 1, refs: [10, 11], tags: { highway: 'primary', oneway: 'yes' } };
  const coords = nodeMap([[10, [139, 35]], [11, [139.01, 35.01]]]);
  const r = edgesForWay(way, coords);
  assert.equal(r.edges[0].oneway, true);
});

test('cycleway の cost_m は length_m より明確に小さい', () => {
  const way = { id: 1, refs: [10, 11], tags: { highway: 'cycleway' } };
  const coords = nodeMap([[10, [139, 35]], [11, [139.01, 35]]]);
  const e = edgesForWay(way, coords).edges[0];
  assert.ok(e.cost_m < e.length_m);
});

test('buildEdges は除外/通行可/スキップを集計する', () => {
  const ways = [
    { id: 1, refs: [10, 11], tags: { highway: 'residential' } },
    { id: 2, refs: [11, 12, 13], tags: { highway: 'motorway' } },
    { id: 3, refs: [10, 99], tags: { highway: 'tertiary' } } // 99 は座標欠落
  ];
  const coords = nodeMap([
    [10, [139.7, 35.65]],
    [11, [139.701, 35.6505]],
    [12, [139.702, 35.651]]
  ]);
  const { edges, stats } = buildEdges(ways, coords);
  assert.equal(stats.waysTotal, 3);
  assert.equal(stats.waysEligible, 2);
  assert.equal(stats.waysExcluded, 1);
  assert.equal(stats.skippedMissingNode, 1);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].way_id, 1);
});

test('collectReferencedNodeIds は通行可 way の ref のみ収集', () => {
  const ways = [
    { id: 1, refs: [10, 11], tags: { highway: 'residential' } },
    { id: 2, refs: [20, 21], tags: { highway: 'motorway' } },
    { id: 3, refs: [11, 30], tags: { highway: 'primary' } }
  ];
  const ids = collectReferencedNodeIds(ways);
  assert.deepEqual([...ids].sort((a, b) => a - b), [10, 11, 30]);
});

test('way が null/壊れていても例外を投げず除外扱い', () => {
  const coords = nodeMap([]);
  assert.equal(edgesForWay(null, coords).excluded, true);
  assert.equal(edgesForWay({ tags: null }, coords).excluded, true);
  assert.equal(edgesForWay({ tags: { highway: 'residential' } }, coords).edges.length, 0);
});
