'use strict';

// 本番の chQuery CPU 1102 を手元で再現するベンチマーク。
// data/cycling/tiles の v2 タイルを corridor 分ロードして、
// 3km route の chQuery を呼び timing と settled 数を観測する。
//
// Usage:
//   node --expose-gc scripts/cycling_ch_bench.js \
//     --from 135.49,34.69 --to 135.52,34.71 [--iters 3]

const path = require('path');
const { TileLoader, makeFsFetcher } = require('../lib/cycling/tile_loader');
const { TiledRouter } = require('../lib/cycling/tiled_router');
const { corridorKeys } = require('../lib/cycling/tile_partition');

function parseLonLat(s) {
  const [lon, lat] = s.split(',').map(Number);
  return [lon, lat];
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = { from: null, to: null, iters: 3, dir: 'data/cycling', preload: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--from') args.from = parseLonLat(argv[++i]);
    else if (a === '--to') args.to = parseLonLat(argv[++i]);
    else if (a === '--iters') args.iters = Number(argv[++i]);
    else if (a === '--dir') args.dir = argv[++i];
    else if (a === '--preload') args.preload = Number(argv[++i]);
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!args.from || !args.to) throw new Error('--from / --to required');
  return args;
}

async function main() {
  const args = parseArgs();
  console.log(`[setup] dir=${args.dir} from=${args.from} to=${args.to} iters=${args.iters}`);

  const fetcher = makeFsFetcher(args.dir);
  // 本番 worker と同じ enableCh=true 設定。
  // maxTiles を緩めて preload で view を巨大化できるようにする。
  const loader = new TileLoader(fetcher, { enableCh: true, maxTiles: 2048 });
  const router = new TiledRouter(loader);

  // preload で異なる bbox の N タイルを先にロードして、本番 isolate に
  // 過去のリクエストで貯まったタイル状況を再現する。0 なら corridor のみ。
  if (args.preload > 0) {
    const fs = require('fs');
    const all = fs.readdirSync(path.join(args.dir, 'tiles')).filter(f => f.endsWith('.bin')).map(f => f.replace('.bin', ''));
    // shuffle deterministically with simple seed
    let s = 12345;
    const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff;
    for (let i = all.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    const preload = all.slice(0, args.preload);
    console.log(`[setup] preloading ${preload.length} random tiles to simulate hot isolate`);
    const tP0 = process.hrtime.bigint();
    await loader.loadMany(preload);
    const tP1 = process.hrtime.bigint();
    console.log(`[setup] preload done in ${Number(tP1 - tP0) / 1e6}ms`);
  }

  // 1 度ロード (本番 cold path 相当)
  const corridor = corridorKeys(args.from[0], args.from[1], args.to[0], args.to[1], 1);
  console.log(`[setup] corridor tiles: ${corridor.length}`);
  const tLoad0 = process.hrtime.bigint();
  await loader.loadMany(corridor);
  const tLoad1 = process.hrtime.bigint();
  console.log(`[setup] tiles loaded in ${Number(tLoad1 - tLoad0) / 1e6}ms`);
  console.log(`[setup] view.nodes=${loader.view.nodes.size} fwd_adj=${loader.view.fwd.size} levels=${loader.view.levels.size} cores=${loader.view.cores.size} hasCh=${loader.view.hasCh}`);

  // edge count + max degree
  let edgeTotal = 0;
  let maxDeg = 0;
  let maxDegNode = null;
  for (const [u, arr] of loader.view.fwd) {
    edgeTotal += arr.length;
    if (arr.length > maxDeg) { maxDeg = arr.length; maxDegNode = u; }
  }
  console.log(`[setup] fwd edges total=${edgeTotal} max_degree=${maxDeg} (node=${maxDegNode}, isCore=${loader.view.cores.has(maxDegNode)}, level=${loader.view.levels.get(maxDegNode)})`);

  // 本番 router.route() 経由でタイミング測定。
  for (let i = 0; i < args.iters; i += 1) {
    if (global.gc) global.gc();
    const t0 = process.hrtime.bigint();
    const r = await router.route(args.from[0], args.from[1], args.to[0], args.to[1]);
    const t1 = process.hrtime.bigint();
    const ms = Number(t1 - t0) / 1e6;
    console.log(`[iter ${i + 1}] ${ms.toFixed(1)}ms alg=${r.algorithm} settled=${r.settled} dist=${r.distance_cost?.toFixed(1)} nodes=${r.node_count} error=${r.error || '-'}`);
  }
}

main().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
