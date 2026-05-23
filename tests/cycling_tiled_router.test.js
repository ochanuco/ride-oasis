'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { TileLoader } = require('../lib/cycling/tile_loader');
const { TiledRouter, bidiDijkstraOnView } = require('../lib/cycling/tiled_router');
const { tileKey } = require('../lib/cycling/tile_partition');
const { encodeTile } = require('../lib/cycling/tile_binary');

function buildKansaiSyntheticTiles() {
  // 大阪近辺の合成データ: 3 ノード A-B-C を西→東に並べる
  // A (135.50, 34.70) → tile 2710_694
  // B (135.55, 34.70) → tile 2711_694
  // C (135.60, 34.70) → tile 2712_694
  const A = { id: 1, lon: 135.50, lat: 34.70 };
  const B = { id: 2, lon: 135.55, lat: 34.70 };
  const C = { id: 3, lon: 135.60, lat: 34.70 };
  const cost = 5000;
  const tiles = {};
  const ensure = (key) => {
    if (!tiles[key]) tiles[key] = { nodes: [], edges: [] };
    return tiles[key];
  };
  for (const n of [A, B, C]) ensure(tileKey(n.lon, n.lat)).nodes.push(n);
  // 非 oneway: A↔B, B↔C を双方向で 2 つずつ emit
  ensure(tileKey(A.lon, A.lat)).edges.push({
    from: A.id, to: B.id, toLon: B.lon, toLat: B.lat, cost
  });
  ensure(tileKey(B.lon, B.lat)).edges.push({
    from: B.id, to: A.id, toLon: A.lon, toLat: A.lat, cost
  });
  ensure(tileKey(B.lon, B.lat)).edges.push({
    from: B.id, to: C.id, toLon: C.lon, toLat: C.lat, cost
  });
  ensure(tileKey(C.lon, C.lat)).edges.push({
    from: C.id, to: B.id, toLon: B.lon, toLat: B.lat, cost
  });
  const data = {};
  for (const [key, { nodes, edges }] of Object.entries(tiles)) {
    data[key] = encodeTile(nodes, edges);
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
  // Float32 → cost 比較は近似
  assert.ok(Math.abs(r.distance_cost - 10000) < 1);
  assert.equal(r.node_count, 3);
  assert.equal(r.coordinates.length, 3);
  assert.ok(r.loaded_tiles >= 1);
});

test('TiledRouter: 近すぎる点が無いと no_nearby_node_from', async () => {
  const data = buildKansaiSyntheticTiles();
  const loader = new TileLoader(memFetcher(data));
  const router = new TiledRouter(loader, { maxSnapMeters: 10 });
  const r = await router.route(135.40, 34.70, 135.55, 34.70);
  assert.equal(r.error, 'no_nearby_node_from');
});

test('TiledRouter: 同じタイル内の往復', async () => {
  const key = tileKey(135.55, 34.70);
  const data = {
    [key]: encodeTile(
      [
        { id: 1, lon: 135.550, lat: 34.700 },
        { id: 2, lon: 135.555, lat: 34.700 }
      ],
      [
        { from: 1, to: 2, toLon: 135.555, toLat: 34.700, cost: 500 },
        { from: 2, to: 1, toLon: 135.550, toLat: 34.700, cost: 500 }
      ]
    )
  };
  const loader = new TileLoader(memFetcher(data));
  const router = new TiledRouter(loader);
  const r = await router.route(135.550, 34.700, 135.555, 34.700);
  assert.ok(Math.abs(r.distance_cost - 500) < 0.1);
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
  const distinct = new Set(requested);
  assert.ok(distinct.size >= 3, `expected at least 3 distinct fetches, got ${distinct.size}`);
});
