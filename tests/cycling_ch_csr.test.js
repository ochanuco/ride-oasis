'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCsr, csrMemoryBytes, NO_VIA } = require('../lib/cycling/ch_csr');
const { chQueryCsr, unpackChEdgeCsr } = require('../lib/cycling/chquery_csr');
const { encodeTileV2 } = require('../lib/cycling/tile_binary');

function makeTile(nodes, edges) {
  const buf = encodeTileV2(nodes, edges);
  return { key: 'T', buf };
}

test('CSR: 空タイルで build できる', () => {
  const csr = buildCsr([makeTile([], [])]);
  assert.equal(csr.nodeCount, 0);
  assert.equal(csr.edgeCount, 0);
});

test('CSR: 単一ノード単一エッジ round-trip', () => {
  const nodes = [
    { id: 100, lon: 135, lat: 34, level: 0, core: 0 },
    { id: 200, lon: 135.001, lat: 34, level: 1, core: 0 }
  ];
  const edges = [
    { from: 100, to: 200, toLon: 135.001, toLat: 34, cost: 100, viaId: 0 }
  ];
  const csr = buildCsr([makeTile(nodes, edges)]);
  assert.equal(csr.nodeCount, 2);
  assert.equal(csr.edgeCount, 1);
  const i100 = csr.idToIdx.get(100);
  const i200 = csr.idToIdx.get(200);
  assert.equal(csr.fwdOffsets[i100 + 1] - csr.fwdOffsets[i100], 1);
  assert.equal(csr.fwdTo[csr.fwdOffsets[i100]], i200);
  assert.equal(csr.fwdCost[csr.fwdOffsets[i100]], 100);
  assert.equal(csr.fwdViaId[csr.fwdOffsets[i100]], NO_VIA);
  // rev
  assert.equal(csr.revOffsets[i200 + 1] - csr.revOffsets[i200], 1);
  assert.equal(csr.revFrom[csr.revOffsets[i200]], i100);
});

test('CSR: shortcut (viaId 付き) は viaId を local idx に変換', () => {
  const nodes = [
    { id: 1, lon: 0, lat: 0, level: 0, core: 0 },
    { id: 2, lon: 0.001, lat: 0, level: 1, core: 0 },
    { id: 3, lon: 0.002, lat: 0, level: 2, core: 0 }
  ];
  const edges = [
    { from: 1, to: 2, toLon: 0.001, toLat: 0, cost: 100, viaId: 0 },  // original
    { from: 2, to: 3, toLon: 0.002, toLat: 0, cost: 100, viaId: 0 },  // original
    { from: 1, to: 3, toLon: 0.002, toLat: 0, cost: 200, viaId: 2 }   // shortcut via 2
  ];
  const csr = buildCsr([makeTile(nodes, edges)]);
  const i1 = csr.idToIdx.get(1);
  const i2 = csr.idToIdx.get(2);
  const i3 = csr.idToIdx.get(3);
  // 1 has 2 fwd edges: to=2 (orig) and to=3 (shortcut via 2)
  assert.equal(csr.fwdOffsets[i1 + 1] - csr.fwdOffsets[i1], 2);
  // find the shortcut edge
  let foundShortcut = false;
  for (let e = csr.fwdOffsets[i1]; e < csr.fwdOffsets[i1 + 1]; e += 1) {
    if (csr.fwdTo[e] === i3) {
      assert.equal(csr.fwdViaId[e], i2);
      assert.equal(csr.fwdCost[e], 200);
      foundShortcut = true;
    }
  }
  assert.ok(foundShortcut, 'shortcut edge should be present');
});

test('CSR: chQueryCsr 直線 chain で正しい最短距離', () => {
  // 0 → 1 → 2 → 3, levels 0,1,2,3, costs 100 each
  const nodes = [];
  const edges = [];
  for (let i = 0; i <= 3; i += 1) {
    nodes.push({ id: 10 + i, lon: i * 0.001, lat: 0, level: i, core: 0 });
  }
  for (let i = 0; i < 3; i += 1) {
    edges.push({ from: 10 + i, to: 11 + i, toLon: (i + 1) * 0.001, toLat: 0, cost: 100, viaId: 0 });
  }
  const csr = buildCsr([makeTile(nodes, edges)]);
  const r = chQueryCsr(csr, csr.idToIdx.get(10), csr.idToIdx.get(13));
  assert.equal(r.distance, 300);
  assert.equal(r.pathIdx.length, 4);
  // local idx → osm
  const osmPath = r.pathIdx.map(i => csr.ids[i]);
  assert.deepEqual(osmPath, [10, 11, 12, 13]);
});

test('CSR: chQueryCsr core-core lateral relax', () => {
  // 0(L10,core) - 1(L5,core) - 2(L10,non-core)
  // 通常の CH 制約だと 0→1 は降下で skip だが core-core なら relax 許可
  const nodes = [
    { id: 0, lon: 0, lat: 0, level: 10, core: 1 },
    { id: 1, lon: 0.001, lat: 0, level: 5, core: 1 },
    { id: 2, lon: 0.002, lat: 0, level: 10, core: 0 }
  ];
  const edges = [
    { from: 0, to: 1, toLon: 0.001, toLat: 0, cost: 100, viaId: 0 },
    { from: 1, to: 2, toLon: 0.002, toLat: 0, cost: 100, viaId: 0 }
  ];
  const csr = buildCsr([makeTile(nodes, edges)]);
  const r = chQueryCsr(csr, csr.idToIdx.get(0), csr.idToIdx.get(2));
  assert.equal(r.distance, 200);
});

test('CSR: chQueryCsr 到達不能は Infinity', () => {
  // 0 と 1 が辺なし
  const nodes = [
    { id: 0, lon: 0, lat: 0, level: 0, core: 0 },
    { id: 1, lon: 0.001, lat: 0, level: 1, core: 0 }
  ];
  const csr = buildCsr([makeTile(nodes, [])]);
  const r = chQueryCsr(csr, csr.idToIdx.get(0), csr.idToIdx.get(1));
  assert.equal(r.distance, Infinity);
});

test('CSR: chQueryCsr start == goal は distance 0', () => {
  const nodes = [{ id: 1, lon: 0, lat: 0, level: 0, core: 0 }];
  const csr = buildCsr([makeTile(nodes, [])]);
  const r = chQueryCsr(csr, 0, 0);
  assert.equal(r.distance, 0);
  assert.deepEqual(r.pathIdx, [0]);
});

test('CSR: unpackChEdgeCsr で shortcut 展開', () => {
  const nodes = [
    { id: 0, lon: 0, lat: 0, level: 0, core: 0 },
    { id: 1, lon: 0.001, lat: 0, level: 1, core: 0 },
    { id: 2, lon: 0.002, lat: 0, level: 2, core: 0 }
  ];
  const edges = [
    { from: 0, to: 1, toLon: 0.001, toLat: 0, cost: 100, viaId: 0 },
    { from: 1, to: 2, toLon: 0.002, toLat: 0, cost: 100, viaId: 0 },
    { from: 0, to: 2, toLon: 0.002, toLat: 0, cost: 200, viaId: 1 }
  ];
  const csr = buildCsr([makeTile(nodes, edges)]);
  const i0 = csr.idToIdx.get(0);
  const i1 = csr.idToIdx.get(1);
  const i2 = csr.idToIdx.get(2);
  const out = [];
  unpackChEdgeCsr(csr, i0, i2, out);
  assert.deepEqual(out, [i1, i2]);
});

test('CSR: csrMemoryBytes は妥当な byte サイズを返す', () => {
  const nodes = Array.from({ length: 10 }, (_, i) => ({ id: i, lon: i * 0.001, lat: 0, level: i, core: 0 }));
  const edges = Array.from({ length: 9 }, (_, i) => ({ from: i, to: i + 1, toLon: (i + 1) * 0.001, toLat: 0, cost: 100, viaId: 0 }));
  const csr = buildCsr([makeTile(nodes, edges)]);
  const bytes = csrMemoryBytes(csr);
  assert.ok(bytes > 0);
  // 10 nodes * (8+4+4+4+1) + 11 offsets * 4 + 9 edges * (4+4+4) * 2 directions
  // ≈ 210 + 44 + 216 = ~470. Allow 200-2000 range for typed-array headers.
  assert.ok(bytes > 100 && bytes < 5000, `expected modest bytes, got ${bytes}`);
});
