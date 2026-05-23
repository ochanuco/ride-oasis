'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  encodeTile,
  decodeTile,
  HEADER_BYTES,
  NODE_BYTES,
  EDGE_BYTES,
  MAGIC,
  VERSION
} = require('../lib/cycling/tile_binary');

function fuzzNodes(n, seed = 1) {
  let s = seed;
  const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff;
  return Array.from({ length: n }, (_, i) => ({
    id: 10_000_000_000 + i,
    lon: 135 + rand() * 2,
    lat: 34 + rand() * 2
  }));
}

function fuzzEdges(n, seed = 2) {
  let s = seed;
  const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff;
  return Array.from({ length: n }, (_, i) => ({
    from: 10_000_000_000 + i,
    to: 10_000_000_000 + ((i + 1) % n),
    toLon: 135 + rand() * 2,
    toLat: 34 + rand() * 2,
    cost: rand() * 1000
  }));
}

test('round-trip: 空のタイル', () => {
  const buf = encodeTile([], []);
  assert.equal(buf.byteLength, HEADER_BYTES);
  const r = decodeTile(buf);
  assert.deepEqual(r.nodes, []);
  assert.deepEqual(r.edges, []);
});

test('round-trip: 単一ノード単一エッジ (Float32 誤差は許容)', () => {
  const nodes = [{ id: 42, lon: 135.5, lat: 34.7 }];
  const edges = [
    { from: 42, to: 43, toLon: 135.51, toLat: 34.71, cost: 100 }
  ];
  const buf = encodeTile(nodes, edges);
  assert.equal(buf.byteLength, HEADER_BYTES + NODE_BYTES + EDGE_BYTES);
  const r = decodeTile(buf);
  // 緯度経度は Float32 → ~1cm 精度。実用上は問題なし。
  assert.equal(r.nodes[0].id, 42);
  assert.ok(Math.abs(r.nodes[0].lon - 135.5) < 1e-4);
  assert.ok(Math.abs(r.nodes[0].lat - 34.7) < 1e-4);
  assert.equal(r.edges[0].from, 42);
  assert.equal(r.edges[0].to, 43);
  assert.ok(Math.abs(r.edges[0].toLon - 135.51) < 1e-4);
  assert.ok(Math.abs(r.edges[0].toLat - 34.71) < 1e-4);
  assert.ok(Math.abs(r.edges[0].cost - 100) < 1e-2);
});

test('round-trip: ファジング 1000 ノード + 2000 エッジで形状一致', () => {
  const nodes = fuzzNodes(1000);
  const edges = fuzzEdges(2000);
  const buf = encodeTile(nodes, edges);
  const r = decodeTile(buf);
  assert.equal(r.nodes.length, 1000);
  assert.equal(r.edges.length, 2000);
  // ID は Float64 で保持されるので完全一致
  for (let i = 0; i < 100; i += 1) {
    assert.equal(r.nodes[i].id, nodes[i].id);
    assert.equal(r.edges[i].from, edges[i].from);
    assert.equal(r.edges[i].to, edges[i].to);
  }
});

test('decode: magic mismatch を例外で弾く', () => {
  const buf = new ArrayBuffer(HEADER_BYTES);
  assert.throws(() => decodeTile(buf), /magic mismatch/);
});

test('decode: version mismatch を例外で弾く', () => {
  const buf = new ArrayBuffer(HEADER_BYTES);
  const dv = new DataView(buf);
  dv.setUint32(0, MAGIC, true);
  dv.setUint8(4, 99);
  assert.throws(() => decodeTile(buf), /unsupported tile version/);
});

test('decode: ヘッダ未満のバッファは例外', () => {
  assert.throws(() => decodeTile(new ArrayBuffer(4)), /too small/);
});

test('decode: 宣言された count とバイト数が合わないと例外', () => {
  const nodes = [{ id: 1, lon: 0, lat: 0 }];
  const edges = [];
  const buf = encodeTile(nodes, edges);
  // 1 バイト切り詰めて壊す
  const truncated = buf.slice(0, buf.byteLength - 1);
  assert.throws(() => decodeTile(truncated), /size mismatch/);
});

test('サイズが NDJSON 比で大幅に縮む (~4x 以上)', () => {
  const nodes = fuzzNodes(100);
  const edges = fuzzEdges(200);
  const ndjsonBytes =
    nodes.reduce((acc, n) => acc + JSON.stringify({ t: 'n', ...n }).length + 1, 0) +
    edges.reduce((acc, e) => acc + JSON.stringify({ t: 'e', ...e }).length + 1, 0);
  const binaryBytes = encodeTile(nodes, edges).byteLength;
  assert.ok(
    binaryBytes * 4 < ndjsonBytes,
    `expected binary << ndjson; got bin=${binaryBytes} ndjson=${ndjsonBytes}`
  );
});

test('Version 定数が 1', () => {
  assert.equal(VERSION, 1);
});
