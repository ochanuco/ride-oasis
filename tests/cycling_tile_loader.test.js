'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { TileLoader } = require('../lib/cycling/tile_loader');
const { encodeTile } = require('../lib/cycling/tile_binary');

function makeMemFetcher(data) {
  return async (key) => (key in data ? data[key] : null);
}

function tileOf(nodes, edges) {
  return encodeTile(nodes, edges);
}

test('load: 同じ key を 2 回呼んでも fetcher は 1 回 (cache)', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return tileOf([{ id: 1, lon: 0, lat: 0 }], []);
  };
  const loader = new TileLoader(fetcher);
  await loader.load('A');
  await loader.load('A');
  assert.equal(calls, 1);
});

test('load: 並列呼び出しでも fetcher は 1 回 (inflight dedup)', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 10));
    return tileOf([], []);
  };
  const loader = new TileLoader(fetcher);
  await Promise.all([loader.load('A'), loader.load('A'), loader.load('A')]);
  assert.equal(calls, 1);
});

test('load: 存在しないキーは false を返し、二度目以降は fetcher 呼ばれない', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return null;
  };
  const loader = new TileLoader(fetcher);
  assert.equal(await loader.load('X'), false);
  assert.equal(await loader.load('X'), false);
  assert.equal(calls, 1);
});

test('loadMany: boolean 配列を返す', async () => {
  const data = { A: tileOf([{ id: 1, lon: 0, lat: 0 }], []) };
  const loader = new TileLoader(makeMemFetcher(data));
  const got = await loader.loadMany(['A', 'B']);
  assert.deepEqual(got, [true, false]);
});

test('has: load 後に true', async () => {
  const loader = new TileLoader(makeMemFetcher({ A: tileOf([], []) }));
  assert.equal(loader.has('A'), false);
  await loader.load('A');
  assert.equal(loader.has('A'), true);
});

test('load 後に view にノードとエッジが反映される', async () => {
  const loader = new TileLoader(
    makeMemFetcher({
      A: tileOf(
        [{ id: 1, lon: 135.5, lat: 34.7 }],
        [{ from: 1, to: 2, toLon: 135.51, toLat: 34.71, cost: 100 }]
      )
    })
  );
  await loader.load('A');
  const c1 = loader.view.nodes.get(1);
  assert.ok(c1 && Math.abs(c1[0] - 135.5) < 1e-4);
  const c2 = loader.view.nodes.get(2);
  assert.ok(c2 && Math.abs(c2[0] - 135.51) < 1e-4);
  assert.equal(loader.view.fwd.get(1).length, 1);
  assert.equal(loader.view.rev.get(2).length, 1);
});

test('複数タイルがマージされる (同じノード ID は重複登録しない)', async () => {
  const node = { id: 1, lon: 135.5, lat: 34.7 };
  const loader = new TileLoader(
    makeMemFetcher({ A: tileOf([node], []), B: tileOf([node], []) })
  );
  await loader.loadMany(['A', 'B']);
  assert.equal(loader.view.nodes.size, 1);
});

test('grid からスナップ検索が可能', async () => {
  const loader = new TileLoader(
    makeMemFetcher({ A: tileOf([{ id: 42, lon: 135.5, lat: 34.7 }], []) })
  );
  await loader.load('A');
  const r = loader.grid.nearest(135.5001, 34.7001);
  assert.equal(r.id, 42);
});

test('容量到達 ∧ 他者進行中のとき新規 load は skip', async () => {
  // maxTiles=2 で 3 つ並列に load 開始 → A,B 完了で cap 到達、
  // 直後 D を呼ぶ (C は in-flight) と skip 経路に入る
  const gates = new Map();
  const makeGate = (key) => {
    let release;
    const p = new Promise((r) => { release = r; });
    gates.set(key, { p, release });
  };
  ['A', 'B', 'C', 'D'].forEach(makeGate);
  let calls = 0;
  const fetcher = async (key) => {
    calls += 1;
    await gates.get(key).p;
    return tileOf([{ id: key.charCodeAt(0), lon: 0, lat: 0 }], []);
  };
  const loader = new TileLoader(fetcher, { maxTiles: 2 });
  const pA = loader.load('A');
  const pB = loader.load('B');
  const pC = loader.load('C');
  // A, B を完了させ cap (2) 到達
  gates.get('A').release();
  await pA;
  gates.get('B').release();
  await pB;
  assert.equal(loader.loaded.size, 2);
  // この瞬間: loaded={A,B} (cap), inflight={C} → D は skip
  const okD = await loader.load('D');
  assert.equal(okD, false);
  assert.equal(calls, 3, 'D should not trigger a fetch');
  // クリーンアップ
  gates.get('C').release();
  await pC;
});
