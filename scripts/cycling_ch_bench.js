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
    else if (a === '--no-ch' || a === '--csr' || a === '--debug-csr') { /* flags consumed by main */ }
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
  // --no-ch で enableCh=false 比較ベンチが取れる。
  // --csr で CH CSR モード (per-request CSR build) を試す。
  const enableCh = !process.argv.includes('--no-ch');
  const useChCsr = process.argv.includes('--csr');
  console.log(`[setup] enableCh=${enableCh} useChCsr=${useChCsr}`);
  const loader = new TileLoader(fetcher, { enableCh, maxTiles: 2048 });
  const router = new TiledRouter(loader, { useChCsr });
  // expose csr caps for debugging
  if (useChCsr) {
    const { chQueryCsr } = require('../lib/cycling/chquery_csr');
    const orig = chQueryCsr;
    // monkey-patch to use big caps for debugging
    // (not ideal; better: pass opts via TiledRouter, but for quick repro)
  }

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
  if (global.gc) global.gc();
  const memBeforeLoad = process.memoryUsage();
  await loader.loadMany(corridor);
  const tLoad1 = process.hrtime.bigint();
  console.log(`[setup] tiles loaded in ${Number(tLoad1 - tLoad0) / 1e6}ms`);
  console.log(`[setup] view.nodes=${loader.view.nodes.size} fwd_adj=${loader.view.fwd.size} levels=${loader.view.levels.size} cores=${loader.view.cores.size} scFwd=${loader.view.scFwd?.size || 0} hasCh=${loader.view.hasCh}`);
  if (global.gc) global.gc();
  const memAfterLoad = process.memoryUsage();
  const deltaHeap = (memAfterLoad.heapUsed - memBeforeLoad.heapUsed) / 1024 / 1024;
  const deltaRss = (memAfterLoad.rss - memBeforeLoad.rss) / 1024 / 1024;
  console.log(`[mem] view footprint delta: heap=+${deltaHeap.toFixed(1)}MB rss=+${deltaRss.toFixed(1)}MB`);
  console.log(`[mem] absolute rss=${(memAfterLoad.rss / 1024 / 1024).toFixed(1)}MB heapUsed=${(memAfterLoad.heapUsed / 1024 / 1024).toFixed(1)}MB heapTotal=${(memAfterLoad.heapTotal / 1024 / 1024).toFixed(1)}MB external=${(memAfterLoad.external / 1024 / 1024).toFixed(1)}MB`);

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

  // --debug-csr で view chQuery と csr chQuery を直接呼んで比較する
  if (process.argv.includes('--debug-csr')) {
    const { chQueryOnView } = require('../lib/cycling/tiled_router');
    const { buildCsr } = require('../lib/cycling/ch_csr');
    const { chQueryCsr } = require('../lib/cycling/chquery_csr');
    const { corridorKeys, neighborhoodKeys } = require('../lib/cycling/tile_partition');
    const corridor = corridorKeys(args.from[0], args.from[1], args.to[0], args.to[1], 1);
    const snapFrom = neighborhoodKeys(args.from[0], args.from[1], 1);
    const snapTo = neighborhoodKeys(args.to[0], args.to[1], 1);
    const keys = Array.from(new Set([...corridor, ...snapFrom, ...snapTo]));
    const tileBufs = await loader.loadBuffers(keys);
    const csr = buildCsr(tileBufs);
    const fromSnap = loader.grid.nearest(args.from[0], args.from[1], 8);
    const toSnap = loader.grid.nearest(args.to[0], args.to[1], 8);
    const fromIdx = csr.idToIdx.get(fromSnap.id);
    const toIdx = csr.idToIdx.get(toSnap.id);
    console.log(`[debug] snap from id=${fromSnap.id} → csrIdx=${fromIdx}, lvl=${csr.levels[fromIdx]}, core=${csr.cores[fromIdx]}`);
    console.log(`[debug] snap to   id=${toSnap.id} → csrIdx=${toIdx}, lvl=${csr.levels[toIdx]}, core=${csr.cores[toIdx]}`);
    console.log(`[debug] view fromLvl=${loader.view.levels.get(fromSnap.id)} core=${loader.view.cores.has(fromSnap.id)}`);
    console.log(`[debug] view toLvl=${loader.view.levels.get(toSnap.id)} core=${loader.view.cores.has(toSnap.id)}`);
    const vr = chQueryOnView(loader.view, fromSnap.id, toSnap.id);
    const cr = chQueryCsr(csr, fromIdx, toIdx, { settledCap: 1000000, popsCap: 5000000, timeBudgetMs: 60000 });
    console.log(`[debug] view: dist=${vr.distance.toFixed(1)} settled=${vr.settled} pathLen=${vr.path?.length}`);
    console.log(`[debug] csr:  dist=${cr.distance.toFixed(1)} settled=${cr.settled} pathLen=${cr.pathIdx.length} term=${cr.terminated}`);
    // Dump CSR raw path (local idx + osm)
    console.log(`[debug] csr pathIdx (raw, before unpack):`);
    for (let i = 0; i < cr.pathIdx.length; i += 1) {
      const idx = cr.pathIdx[i];
      console.log(`  ${i}: idx=${idx} osm=${csr.ids[idx]} lvl=${csr.levels[idx]} core=${csr.cores[idx]}`);
    }
    // Same for view path (first 20)
    console.log(`[debug] view path (post-unpack first 20):`);
    for (let i = 0; i < Math.min(vr.path.length, 20); i += 1) {
      const id = vr.path[i];
      console.log(`  ${i}: osm=${id} lvl=${loader.view.levels.get(id)}`);
    }
    // edges count of snap-from node in both
    const fwdListView = loader.view.fwd.get(fromSnap.id) || [];
    const scListView = loader.view.scFwd.get(fromSnap.id);
    const scCountView = scListView ? scListView.length / 5 : 0;
    const fwdStart = csr.fwdOffsets[fromIdx], fwdEnd = csr.fwdOffsets[fromIdx + 1];
    console.log(`[debug] from-node fwd: view orig=${fwdListView.length} sc=${scCountView}  csr=${fwdEnd - fwdStart}`);
    // first few CSR fwd edges of snap-from
    console.log(`[debug] csr fwd[from] first 5:`);
    for (let e = fwdStart; e < Math.min(fwdEnd, fwdStart + 5); e += 1) {
      console.log(`  e${e}: to=${csr.fwdTo[e]} (osm=${csr.ids[csr.fwdTo[e]]}, lvl=${csr.levels[csr.fwdTo[e]]}) cost=${csr.fwdCost[e]} via=${csr.fwdViaId[e]}`);
    }
    console.log(`[debug] view fwd[from] first 5:`);
    for (let i = 0; i < Math.min(fwdListView.length, 5); i += 1) {
      const e = fwdListView[i];
      console.log(`  e${i}: to=${e.to} (lvl=${loader.view.levels.get(e.to)}) cost=${e.cost} via=${e.viaId}`);
    }
    if (scListView) {
      console.log(`[debug] view scFwd[from] first 5:`);
      for (let i = 0; i < Math.min(scListView.length, 25); i += 5) {
        const idx = i;
        console.log(`  sc${i/5}: to=${scListView[idx]} (lvl=${loader.view.levels.get(scListView[idx])}) cost=${scListView[idx+1]} via=${scListView[idx+2]}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
