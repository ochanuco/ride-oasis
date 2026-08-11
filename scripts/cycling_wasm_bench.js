'use strict';

// Node.js bench for Rust WASM route_ch. Loads tile buffers from disk and
// calls the WASM entry point, comparing distance + timing against the
// existing JS CSR-only path (lib/cycling/chquery_csr.js).
//
// Usage:
//   npm run wasm:fetch  (ochanuco/cycling-router の Release から取得)
//   node --expose-gc scripts/cycling_wasm_bench.js --from 135.49,34.69 --to 135.52,34.71

const fs = require('fs');
const path = require('path');
const { route_ch } = require('../vendor/wasm/nodejs/router_wasm.js');
const { corridorKeys, neighborhoodKeys } = require('../lib/cycling/tile_partition');

function parseLonLat(s) {
  const [lon, lat] = s.split(',').map(Number);
  return [lon, lat];
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = { from: null, to: null, iters: 3, dir: 'data/cycling', maxSnap: 500 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--from') args.from = parseLonLat(argv[++i]);
    else if (a === '--to') args.to = parseLonLat(argv[++i]);
    else if (a === '--iters') args.iters = Number(argv[++i]);
    else if (a === '--dir') args.dir = argv[++i];
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!args.from || !args.to) throw new Error('--from / --to required');
  return args;
}

async function main() {
  const args = parseArgs();
  console.log(`[setup] from=${args.from} to=${args.to} iters=${args.iters}`);

  // Compute corridor + snap neighborhood, load Uint8Array buffers from FS.
  const corridor = corridorKeys(args.from[0], args.from[1], args.to[0], args.to[1], 1);
  const snapFrom = neighborhoodKeys(args.from[0], args.from[1], 1);
  const snapTo = neighborhoodKeys(args.to[0], args.to[1], 1);
  const allKeys = Array.from(new Set([...corridor, ...snapFrom, ...snapTo]));

  const tLoad0 = process.hrtime.bigint();
  const buffers = [];
  for (const key of allKeys) {
    const p = path.join(args.dir, 'tiles', `${key}.bin`);
    if (!fs.existsSync(p)) continue;
    buffers.push(new Uint8Array(fs.readFileSync(p)));
  }
  const tLoad1 = process.hrtime.bigint();
  const loadMs = Number(tLoad1 - tLoad0) / 1e6;
  console.log(`[load] ${buffers.length} tiles in ${loadMs.toFixed(0)}ms`);

  for (let i = 0; i < args.iters; i += 1) {
    if (global.gc) global.gc();
    const t0 = process.hrtime.bigint();
    const r = route_ch(buffers, args.from[0], args.from[1], args.to[0], args.to[1], args.maxSnap);
    const t1 = process.hrtime.bigint();
    const ms = Number(t1 - t0) / 1e6;
    if (r.error) {
      console.log(`[iter ${i + 1}] ERROR ${r.error} (${ms.toFixed(1)}ms)`);
    } else {
      console.log(`[iter ${i + 1}] ${ms.toFixed(1)}ms alg=${r.algorithm} settled=${r.settled} dist=${r.distance.toFixed(1)} nodes=${r.node_count} ch_ms=${r.ch_ms} csr_build_ms=${r.csr_build_ms} csr_bytes=${(r.csr_bytes / 1024 / 1024).toFixed(1)}MB`);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
