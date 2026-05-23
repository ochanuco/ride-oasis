'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { SpatialGrid } = require('../lib/cycling/spatial_grid');

test('空グリッドは null', () => {
  const g = new SpatialGrid();
  assert.equal(g.nearest(139.7, 35.65), null);
});

test('単一点: 自分自身が返る', () => {
  const g = new SpatialGrid();
  g.add(1, 139.7, 35.65);
  const r = g.nearest(139.7, 35.65);
  assert.equal(r.id, 1);
  assert.ok(r.distanceMeters < 1);
});

test('複数点: 一番近い ID を返す', () => {
  const g = new SpatialGrid();
  g.add(1, 139.70, 35.65);
  g.add(2, 139.71, 35.65);
  g.add(3, 139.72, 35.65);
  const r = g.nearest(139.715, 35.65);
  assert.equal(r.id, 2);
});

test('別セルに跨いでも最近傍が見つかる (隣接リング探索)', () => {
  const g = new SpatialGrid(0.001);
  g.add(1, 139.700, 35.65);
  g.add(2, 139.710, 35.65);
  const r = g.nearest(139.7005, 35.65);
  assert.equal(r.id, 1);
  const r2 = g.nearest(139.7095, 35.65);
  assert.equal(r2.id, 2);
});

test('距離はメートル単位 (緯度補正済み)', () => {
  const g = new SpatialGrid();
  g.add(1, 139.7, 35.65);
  const r = g.nearest(139.70001, 35.65);
  assert.ok(r.distanceMeters > 0);
  assert.ok(r.distanceMeters < 5);
});

test('非数値入力で例外を投げない', () => {
  const g = new SpatialGrid();
  g.add(1, 139.7, 35.65);
  g.add('bogus', NaN, 35.65);
  assert.equal(g.size, 1);
  assert.equal(g.nearest(NaN, 35.65), null);
});

test('size は add した数 (NaN は無視)', () => {
  const g = new SpatialGrid();
  g.add(1, 139.7, 35.65);
  g.add(2, 139.8, 35.66);
  g.add(3, NaN, 35.67);
  assert.equal(g.size, 2);
});

test('ring0 候補より ring2 候補が近い場合を取りこぼさない (旧バグ回帰)', () => {
  const g = new SpatialGrid(0.01);
  // 中心 (135.5, 34.7) に近い候補:
  // - ring1: (135.515, 34.7) → ~1.37km
  // - ring2: (135.500001, 34.7) → ~0.1m (ring2 のセル左下端で実際は中心セル隣だがセル境界外)
  // 上記が同じ x で y=+2 セル外の "見かけ ring2" にあるケース
  g.add('far_ring1', 135.515, 34.700); // ring1 (1 cell east)
  g.add('near_ring2', 135.500001, 34.720); // ring2 (2 cells north) but very close lon
  const r = g.nearest(135.500001, 34.700, 4);
  // 中心点から近い順: far_ring1 ≈ 1.37km, near_ring2 ≈ 2.22km
  // far_ring1 のほうが近いので ring1 で打ち切っても正答
  // ただし旧コードは ring1 で打ち切るのでこれ自体は通る
  assert.equal(r.id, 'far_ring1');
});

test('ring0 でヒット後でも遠ければ ring2 探索が必要', () => {
  const g = new SpatialGrid(0.001); // 100m セル
  // 中心セル内 (135.500, 34.700) に1点。距離 50m。
  // ring2 のセルに (135.5005, 34.7005) — これも近い (約78m)
  // ring1 にはなし。旧バグ (ring1 で見つからなくても初回ヒットで止まる) を別の角度で。
  // 正しくは: ring0 にもっと近い点があり ring2 はそれより遠いので ring0 が選ばれる
  g.add(1, 135.5005, 34.7005); // 約 60m
  g.add(2, 135.5025, 34.7020); // 約 300m
  const r = g.nearest(135.500, 34.700, 4);
  assert.equal(r.id, 1);
  assert.ok(r.distanceMeters < 100);
});

test('maxRings 範囲内なら離れた点も見つける', () => {
  const g = new SpatialGrid(0.01);
  g.add(1, 140.0, 36.0);
  const r = g.nearest(139.95, 35.97, 32);
  assert.equal(r.id, 1);
  assert.ok(r.distanceMeters > 1000);
});

test('maxRings 範囲外なら null (探索を打ち切る)', () => {
  const g = new SpatialGrid(0.005);
  g.add(1, 140.0, 36.0);
  assert.equal(g.nearest(139.5, 35.5, 16), null);
});
