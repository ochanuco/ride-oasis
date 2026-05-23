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
