'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TILE_DEG,
  tileXY,
  tileKey,
  parseTileKey,
  tileBboxXY,
  neighborhoodKeys,
  corridorKeys
} = require('../lib/cycling/tile_partition');

test('TILE_DEG は 0.05 (~5km)', () => {
  assert.equal(TILE_DEG, 0.05);
});

test('tileXY: 同一セル内は同じインデックス', () => {
  assert.deepEqual(tileXY(135.5, 34.7), tileXY(135.51, 34.71));
  assert.notDeepEqual(tileXY(135.5, 34.7), tileXY(135.55, 34.7));
});

test('tileKey: x_y 文字列', () => {
  const k = tileKey(135.5, 34.7);
  assert.match(k, /^\d+_\d+$/);
});

test('parseTileKey は逆変換', () => {
  const [x, y] = tileXY(135.5, 34.7);
  assert.deepEqual(parseTileKey(`${x}_${y}`), [x, y]);
});

test('parseTileKey: 不正入力は null', () => {
  assert.equal(parseTileKey('bogus'), null);
  assert.equal(parseTileKey(''), null);
  assert.equal(parseTileKey('1_2_3'), null);
});

test('parseTileKey: 負の座標も扱える', () => {
  assert.deepEqual(parseTileKey('-5_-3'), [-5, -3]);
});

test('tileBboxXY: 境界が TILE_DEG ぴったり', () => {
  const b = tileBboxXY(2710, 694);
  assert.ok(Math.abs(b.west - 135.5) < 1e-9);
  assert.ok(Math.abs(b.east - 135.55) < 1e-9);
  assert.ok(Math.abs(b.north - b.south - TILE_DEG) < 1e-9);
});

test('neighborhoodKeys(radius=1): 3x3 の 9 タイル', () => {
  const keys = neighborhoodKeys(135.5, 34.7, 1);
  assert.equal(keys.length, 9);
  assert.ok(keys.includes(tileKey(135.5, 34.7)));
});

test('neighborhoodKeys(radius=2): 5x5 の 25 タイル', () => {
  const keys = neighborhoodKeys(135.5, 34.7, 2);
  assert.equal(keys.length, 25);
});

test('corridorKeys: from/to の bbox + 余白を網羅', () => {
  const keys = corridorKeys(135.5, 34.7, 135.55, 34.72, 1);
  // x: 2710-2711 → padding 1 → 2709-2712 (4 cells)
  // y: 694-694 → padding 1 → 693-695 (3 cells)
  // 4 * 3 = 12
  assert.equal(keys.length, 12);
  assert.ok(keys.includes(tileKey(135.5, 34.7)));
  assert.ok(keys.includes(tileKey(135.55, 34.72)));
});

test('corridorKeys: 同一タイル内 from/to (padding=0) は 1', () => {
  const keys = corridorKeys(135.5, 34.7, 135.51, 34.71, 0);
  assert.equal(keys.length, 1);
});
