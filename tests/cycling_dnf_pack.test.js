'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  haversineMeters,
  perpendicularMeters,
  douglasPeucker,
  routeBBoxWithBuffer
} = require('../lib/cycling/dnf_pack');

test('haversineMeters: 同一点は 0', () => {
  assert.equal(haversineMeters(135.5, 34.7, 135.5, 34.7), 0);
});

test('haversineMeters: 関西で 1km 前後の妥当性', () => {
  // 35°N で経度 0.01° ≒ 911m
  const d = haversineMeters(135.50, 35.0, 135.51, 35.0);
  assert.ok(d > 900 && d < 920, `got ${d}`);
});

test('perpendicularMeters: 線分上の点は ~0m', () => {
  // (0,0) → (0, 0.01) 上の (0, 0.005)
  const d = perpendicularMeters(0, 0.005, 0, 0, 0, 0.01);
  assert.ok(d < 1e-6, `got ${d}`);
});

test('perpendicularMeters: 線分から離れた点はそれなりの距離', () => {
  // (135, 35) → (135.01, 35) の線分から (135.005, 35.001) はおよそ 111m
  const d = perpendicularMeters(135.005, 35.001, 135.0, 35.0, 135.01, 35.0);
  assert.ok(d > 100 && d < 120, `got ${d}`);
});

test('douglasPeucker: 入力 <= 2 点はそのまま', () => {
  const c = [[0, 0], [1, 1]];
  assert.equal(douglasPeucker(c, 10), c);
});

test('douglasPeucker: 直線上の中間点は削除される', () => {
  // tolerance 10m: 直線 0→1km の中間点 4 点 (ズレ 0) は削除されて 2 点になる
  const coords = [
    [135.0, 35.0],
    [135.002, 35.0],
    [135.004, 35.0],
    [135.006, 35.0],
    [135.008, 35.0],
    [135.01, 35.0]
  ];
  const out = douglasPeucker(coords, 10);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], [135.0, 35.0]);
  assert.deepEqual(out[1], [135.01, 35.0]);
});

test('douglasPeucker: 大きく逸脱する中間点は残る', () => {
  // (0,0) → (0,0.01) → (0.01, 0.01) で中間点 (0,0.01) は保持される
  const coords = [[0, 0], [0, 0.01], [0.01, 0.01]];
  const out = douglasPeucker(coords, 10);
  assert.equal(out.length, 3);
});

test('douglasPeucker: tolerance 0 は原配列を返す (no-op)', () => {
  const c = [[0, 0], [0.001, 0.0001], [0.002, 0]];
  assert.equal(douglasPeucker(c, 0), c);
});

test('douglasPeucker: no-op 経路は入力参照そのものを返す (mutate 注意の根拠)', () => {
  // docstring の「呼び出し側が結果を mutate するなら slice() で複製を」の
  // 契約を担保するため、参照同一性を assert.strictEqual で確認する。
  const c = [[0, 0], [1, 1]];
  assert.strictEqual(douglasPeucker(c, 5), c);
});

test('routeBBoxWithBuffer: 単一点 + buffer で正方形 bbox', () => {
  const bbox = routeBBoxWithBuffer([[135.0, 35.0]], 1000);
  assert.ok(bbox.minLng < 135.0 && bbox.maxLng > 135.0);
  assert.ok(bbox.minLat < 35.0 && bbox.maxLat > 35.0);
  // ~1km は 0.009 程度 (緯度) / 0.011 程度 (経度 @ 35°N)
  assert.ok(Math.abs((bbox.maxLat - bbox.minLat) - 0.018) < 0.002);
});

test('routeBBoxWithBuffer: 空配列は null', () => {
  assert.equal(routeBBoxWithBuffer([], 100), null);
});

test('routeBBoxWithBuffer: 複数点で min/max が範囲を囲む', () => {
  const bbox = routeBBoxWithBuffer([[135.0, 35.0], [135.01, 35.005]], 0);
  assert.equal(bbox.minLng, 135.0);
  assert.equal(bbox.maxLng, 135.01);
  assert.equal(bbox.minLat, 35.0);
  assert.equal(bbox.maxLat, 35.005);
});
