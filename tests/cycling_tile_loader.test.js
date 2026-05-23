'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { TileLoader, parseTile } = require('../lib/cycling/tile_loader');

function makeMemFetcher(data) {
  return async (key) => (key in data ? data[key] : null);
}

test('parseTile: 行ごとに n/e を振り分ける', () => {
  const text = [
    JSON.stringify({ t: 'n', id: 1, lon: 135.5, lat: 34.7 }),
    JSON.stringify({ t: 'e', from: 1, to: 2, toLon: 135.51, toLat: 34.71, cost: 100 }),
    ''
  ].join('\n');
  const parsed = parseTile(text);
  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.edges.length, 1);
});

test('load: 同じ key を 2 回呼んでも fetcher は 1 回しか呼ばれない (cache)', async () => {
  let calls = 0;
  const fetcher = async (key) => {
    calls += 1;
    return key === 'A' ? `${JSON.stringify({ t: 'n', id: 1, lon: 0, lat: 0 })}\n` : null;
  };
  const loader = new TileLoader(fetcher);
  await loader.load('A');
  await loader.load('A');
  assert.equal(calls, 1);
});

test('load: 並列呼び出しでも fetcher は 1 回 (inflight dedup)', async () => {
  let calls = 0;
  const fetcher = async (key) => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 10));
    return key === 'A' ? '' : null;
  };
  const loader = new TileLoader(fetcher);
  await Promise.all([loader.load('A'), loader.load('A'), loader.load('A')]);
  assert.equal(calls, 1);
});

test('load: 存在しないキーは null を返し、二度目以降は fetcher 呼ばれない', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return null;
  };
  const loader = new TileLoader(fetcher);
  assert.equal(await loader.load('X'), null);
  assert.equal(await loader.load('X'), null);
  assert.equal(calls, 1);
});

test('loadMany: nullを除いた配列を返す', async () => {
  const data = {
    A: `${JSON.stringify({ t: 'n', id: 1, lon: 0, lat: 0 })}\n`
  };
  const loader = new TileLoader(makeMemFetcher(data));
  const got = await loader.loadMany(['A', 'B']);
  assert.equal(got.length, 1);
});

test('has: load 後に true', async () => {
  const loader = new TileLoader(makeMemFetcher({ A: '' }));
  assert.equal(loader.has('A'), false);
  await loader.load('A');
  assert.equal(loader.has('A'), true);
});
