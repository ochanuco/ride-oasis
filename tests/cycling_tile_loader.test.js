'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { TileLoader } = require('../lib/cycling/tile_loader');

function makeMemFetcher(data) {
  return async (key) => (key in data ? data[key] : null);
}

function ndjson(...items) {
  return items.map((i) => JSON.stringify(i)).join('\n') + '\n';
}

test('load: 同じ key を 2 回呼んでも fetcher は 1 回 (cache)', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return ndjson({ t: 'n', id: 1, lon: 0, lat: 0 });
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
    return '';
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
  const loader = new TileLoader(
    makeMemFetcher({ A: ndjson({ t: 'n', id: 1, lon: 0, lat: 0 }) })
  );
  const got = await loader.loadMany(['A', 'B']);
  assert.deepEqual(got, [true, false]);
});

test('has: load 後に true', async () => {
  const loader = new TileLoader(makeMemFetcher({ A: '' }));
  assert.equal(loader.has('A'), false);
  await loader.load('A');
  assert.equal(loader.has('A'), true);
});

test('load 後に view にノードとエッジが反映される', async () => {
  const loader = new TileLoader(
    makeMemFetcher({
      A: ndjson(
        { t: 'n', id: 1, lon: 135.5, lat: 34.7 },
        {
          t: 'e',
          from: 1,
          to: 2,
          toLon: 135.51,
          toLat: 34.71,
          cost: 100
        }
      )
    })
  );
  await loader.load('A');
  assert.deepEqual(loader.view.nodes.get(1), [135.5, 34.7]);
  // 'to' ノードも座標が伝搬する (隣接タイル未読み込みでもエッジを辿れる)
  assert.deepEqual(loader.view.nodes.get(2), [135.51, 34.71]);
  assert.equal(loader.view.fwd.get(1).length, 1);
  assert.equal(loader.view.rev.get(2).length, 1);
});

test('複数タイルがマージされる (同じノード ID は重複登録しない)', async () => {
  const loader = new TileLoader(
    makeMemFetcher({
      A: ndjson({ t: 'n', id: 1, lon: 135.5, lat: 34.7 }),
      B: ndjson({ t: 'n', id: 1, lon: 135.5, lat: 34.7 })
    })
  );
  await loader.loadMany(['A', 'B']);
  assert.equal(loader.view.nodes.size, 1);
});

test('grid からスナップ検索が可能', async () => {
  const loader = new TileLoader(
    makeMemFetcher({
      A: ndjson({ t: 'n', id: 42, lon: 135.5, lat: 34.7 })
    })
  );
  await loader.load('A');
  const r = loader.grid.nearest(135.5001, 34.7001);
  assert.equal(r.id, 42);
});
