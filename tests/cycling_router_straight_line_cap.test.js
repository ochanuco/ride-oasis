'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TiledRouter,
  MAX_STRAIGHT_LINE_METERS,
  straightLineMeters
} = require('../lib/cycling/tiled_router');
const { TileLoader } = require('../lib/cycling/tile_loader');

function emptyLoader() {
  return new TileLoader(async () => null);
}

test('straightLineMeters: 大阪駅〜京都駅 (~40km) が概ね合う', () => {
  const m = straightLineMeters(135.4959, 34.7026, 135.7585, 34.9858);
  assert.ok(m > 35000 && m < 45000, `expected ~40km, got ${m}`);
});

test('straightLineMeters: 同一点は 0', () => {
  assert.equal(straightLineMeters(135.5, 34.7, 135.5, 34.7), 0);
});

test('MAX_STRAIGHT_LINE_METERS は 15km', () => {
  assert.equal(MAX_STRAIGHT_LINE_METERS, 15000);
});

test('TiledRouter: 閾値超なら too_far を即返し、tile load しない', async () => {
  let fetcherCalls = 0;
  const loader = new TileLoader(async () => {
    fetcherCalls += 1;
    return null;
  });
  const router = new TiledRouter(loader);
  // 大阪駅 → 京都駅 (~40km)
  const r = await router.route(135.4959, 34.7026, 135.7585, 34.9858);
  assert.equal(r.error, 'too_far');
  assert.ok(r.straight_line_m > 35000);
  assert.equal(r.max_straight_line_m, 15000);
  // 早期 return で tile fetch は走らない
  assert.equal(fetcherCalls, 0);
});

test('TiledRouter: 閾値内ならチェック通過 (snap でエラーになるのは別件)', async () => {
  const router = new TiledRouter(emptyLoader());
  // 100m 程度の距離
  const r = await router.route(135.5, 34.7, 135.5005, 34.7005);
  assert.notEqual(r.error, 'too_far');
});

test('TiledRouter: maxStraightLineMeters を上書き可能 (1km で 2km の点は弾く)', async () => {
  const router = new TiledRouter(emptyLoader(), { maxStraightLineMeters: 1000 });
  const r = await router.route(135.5, 34.7, 135.52, 34.7);
  assert.equal(r.error, 'too_far');
  assert.equal(r.max_straight_line_m, 1000);
});
