'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { TileLoader } = require('../lib/cycling/tile_loader');
const { TiledRouter, bidiDijkstraOnView } = require('../lib/cycling/tiled_router');
const { tileKey } = require('../lib/cycling/tile_partition');

function buildKansaiSyntheticTiles() {
  // 大阪近辺の合成データ: 3 ノード A-B-C を西→東に並べる
  // A (135.50, 34.70) → tile 2710_694
  // B (135.55, 34.70) → tile 2711_694
  // C (135.60, 34.70) → tile 2712_694
  const A = { id: 1, lon: 135.50, lat: 34.70 };
  const B = { id: 2, lon: 135.55, lat: 34.70 };
  const C = { id: 3, lon: 135.60, lat: 34.70 };
  const cost_AB = 5000;
  const cost_BC = 5000;
  const tiles = {};
  const push = (key, item) => {
    if (!tiles[key]) tiles[key] = [];
    tiles[key].push(item);
  };
  for (const n of [A, B, C]) {
    push(tileKey(n.lon, n.lat), { t: 'n', ...n });
  }
  // 非 oneway: A↔B, B↔C を双方向で 2 つずつ emit
  push(tileKey(A.lon, A.lat), {
    t: 'e', from: A.id, to: B.id, toLon: B.lon, toLat: B.lat, cost: cost_AB
  });
  push(tileKey(B.lon, B.lat), {
    t: 'e', from: B.id, to: A.id, toLon: A.lon, toLat: A.lat, cost: cost_AB
  });
  push(tileKey(B.lon, B.lat), {
    t: 'e', from: B.id, to: C.id, toLon: C.lon, toLat: C.lat, cost: cost_BC
  });
  push(tileKey(C.lon, C.lat), {
    t: 'e', from: C.id, to: B.id, toLon: B.lon, toLat: B.lat, cost: cost_BC
  });
  const data = {};
  for (const [key, items] of Object.entries(tiles)) {
    data[key] = items.map((i) => JSON.stringify(i)).join('\n') + '\n';
  }
  return data;
}

function memFetcher(data) {
  return async (key) => (key in data ? data[key] : null);
}

test('TiledRouter: 隣接タイル跨ぎ A→C を解ける', async () => {
  const data = buildKansaiSyntheticTiles();
  const loader = new TileLoader(memFetcher(data));
  const router = new TiledRouter(loader);
  const r = await router.route(135.501, 34.701, 135.601, 34.701);
  assert.equal(r.error, undefined);
  assert.equal(r.distance_cost, 10000);
  assert.equal(r.node_count, 3);
  assert.equal(r.coordinates.length, 3);
  assert.ok(r.loaded_tiles >= 1);
});

test('TiledRouter: 近すぎる点が無いと no_nearby_node_from', async () => {
  const data = buildKansaiSyntheticTiles();
  const loader = new TileLoader(memFetcher(data));
  const router = new TiledRouter(loader, { maxSnapMeters: 10 });
  // 100km 離れた点 → snap 不可
  const r = await router.route(140.0, 36.0, 135.55, 34.70);
  assert.equal(r.error, 'no_nearby_node_from');
});

test('TiledRouter: 同じタイル内の往復', async () => {
  const data = {};
  data[tileKey(135.55, 34.70)] = [
    JSON.stringify({ t: 'n', id: 1, lon: 135.550, lat: 34.700 }),
    JSON.stringify({ t: 'n', id: 2, lon: 135.555, lat: 34.700 }),
    JSON.stringify({
      t: 'e', from: 1, to: 2, toLon: 135.555, toLat: 34.700, cost: 500
    }),
    JSON.stringify({
      t: 'e', from: 2, to: 1, toLon: 135.550, toLat: 34.700, cost: 500
    })
  ].join('\n') + '\n';
  const loader = new TileLoader(memFetcher(data));
  const router = new TiledRouter(loader);
  const r = await router.route(135.550, 34.700, 135.555, 34.700);
  assert.equal(r.distance_cost, 500);
});

test('bidiDijkstraOnView: 単純な view で動作する', () => {
  const view = {
    nodes: new Map([[1, [0, 0]], [2, [0, 0]], [3, [0, 0]]]),
    fwd: new Map([
      [1, [{ from: 1, to: 2, cost: 10 }]],
      [2, [{ from: 2, to: 3, cost: 10 }]]
    ]),
    rev: new Map([
      [2, [{ from: 1, to: 2, cost: 10 }]],
      [3, [{ from: 2, to: 3, cost: 10 }]]
    ])
  };
  const r = bidiDijkstraOnView(view, 1, 3);
  assert.equal(r.distance, 20);
  assert.deepEqual(r.path, [1, 2, 3]);
});

test('TiledRouter: タイル読み込みは corridor 範囲内のキーで loadMany 呼ばれる', async () => {
  const requested = [];
  const data = buildKansaiSyntheticTiles();
  const loader = new TileLoader(async (key) => {
    requested.push(key);
    return key in data ? data[key] : null;
  });
  const router = new TiledRouter(loader, { corridorPadding: 0, snapNeighborhoodRadius: 0 });
  await router.route(135.501, 34.701, 135.601, 34.701);
  // corridor: from タイル + to タイルの間 (padding=0) → 3 タイル
  // それぞれ 1 回ずつ fetch
  const distinct = new Set(requested);
  assert.ok(distinct.size >= 3, `expected at least 3 distinct fetches, got ${distinct.size}`);
});
