'use strict';

const fs = require('fs');
const path = require('path');
const { once } = require('events');

const { classifyWay } = require('../lib/cycling/tag_classifier');
const { edgesForWay } = require('../lib/cycling/graph_builder');

// Heuristic: only check backpressure every N writes to amortize the syscall
// cost. Combined with a generous highWaterMark this keeps memory bounded for
// the 8GB+ workstation use case without per-line awaits.
const BACKPRESSURE_CHECK_INTERVAL = 2048;
const STREAM_HIGH_WATER_MARK = 4 * 1024 * 1024;

function createBufferedStream(filePath) {
  return fs.createWriteStream(filePath, { highWaterMark: STREAM_HIGH_WATER_MARK });
}

async function drainIfNeeded(stream) {
  if (stream.writableNeedDrain) {
    await once(stream, 'drain');
  }
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = { pbf: null, out: null, limit: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--pbf') args.pbf = argv[++i] || null;
    else if (a === '--out') args.out = argv[++i] || null;
    else if (a === '--limit') {
      const v = Number(argv[++i]);
      args.limit = Number.isFinite(v) && v > 0 ? v : null;
    } else if (a === '-h' || a === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/cycling_build_graph.js --pbf <path> --out <dir> [--limit N]',
    '',
    'Extracts a bicycle-routable graph from an OSM PBF file in three passes:',
    '  pass 1 (ways):  classify and write ways.ndjson + collect node IDs',
    '  pass 2 (nodes): write nodes.ndjson for referenced IDs only',
    '  pass 3 (join):  materialize edges.ndjson with inlined geometry',
    '',
    '--limit caps the number of items per pass (useful for smoke tests).'
  ].join('\n');
}

function logProgress(label, n, last) {
  if (n - last < 1_000_000) return last;
  process.stderr.write(`  ${label}: ${n.toLocaleString()}\n`);
  return n;
}

async function streamPbf(pbfPath, onItem, limit) {
  const { createOSMStream } = await import('osm-pbf-parser-node');
  let n = 0;
  for await (const item of createOSMStream(pbfPath)) {
    if (limit && n >= limit) break;
    await onItem(item);
    n += 1;
  }
  return n;
}

async function passWays(pbfPath, outDir, limit) {
  const waysPath = path.join(outDir, 'ways.ndjson');
  const idsPath = path.join(outDir, 'node_ids.bin');
  const waysOut = createBufferedStream(waysPath);

  const neededIds = new Set();
  let waysSeen = 0;
  let waysEligible = 0;
  let waysExcluded = 0;
  let writes = 0;
  let last = 0;

  await streamPbf(
    pbfPath,
    async (item) => {
      if (item && item.type === 'way') {
        waysSeen += 1;
        const cls = classifyWay(item.tags);
        if (!cls.allowed) {
          waysExcluded += 1;
          return;
        }
        const refs = item.refs || [];
        if (refs.length < 2) return;
        waysEligible += 1;
        for (const r of refs) neededIds.add(r);
        waysOut.write(
          `${JSON.stringify({ id: item.id, refs, tags: item.tags })}\n`
        );
        writes += 1;
        if (writes % BACKPRESSURE_CHECK_INTERVAL === 0) await drainIfNeeded(waysOut);
        last = logProgress('ways seen', waysSeen, last);
      }
    },
    limit
  );

  await new Promise((resolve, reject) => {
    waysOut.end((err) => (err ? reject(err) : resolve()));
  });

  const sorted = new Float64Array(neededIds.size);
  let i = 0;
  for (const id of neededIds) sorted[i++] = id;
  sorted.sort();
  fs.writeFileSync(idsPath, Buffer.from(sorted.buffer));

  return { waysSeen, waysEligible, waysExcluded, neededNodes: neededIds.size };
}

function loadSortedIds(filePath) {
  const buf = fs.readFileSync(filePath);
  return new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
}

function binarySearch(arr, target) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo < arr.length && arr[lo] === target;
}

async function passNodes(pbfPath, outDir, limit) {
  const idsPath = path.join(outDir, 'node_ids.bin');
  const nodesPath = path.join(outDir, 'nodes.ndjson');
  const sortedIds = loadSortedIds(idsPath);
  const nodesOut = createBufferedStream(nodesPath);

  let nodesSeen = 0;
  let nodesKept = 0;
  let writes = 0;
  let last = 0;

  await streamPbf(
    pbfPath,
    async (item) => {
      if (item && item.type === 'node') {
        nodesSeen += 1;
        if (!binarySearch(sortedIds, item.id)) return;
        nodesKept += 1;
        nodesOut.write(
          `${JSON.stringify({ id: item.id, lon: item.lon, lat: item.lat })}\n`
        );
        writes += 1;
        if (writes % BACKPRESSURE_CHECK_INTERVAL === 0) await drainIfNeeded(nodesOut);
        last = logProgress('nodes seen', nodesSeen, last);
      }
    },
    limit
  );

  await new Promise((resolve, reject) => {
    nodesOut.end((err) => (err ? reject(err) : resolve()));
  });

  return { nodesSeen, nodesKept };
}

function loadNodesMap(filePath) {
  const map = new Map();
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    if (!line) continue;
    const n = JSON.parse(line);
    map.set(n.id, [n.lon, n.lat]);
  }
  return map;
}

async function passJoin(outDir) {
  const waysPath = path.join(outDir, 'ways.ndjson');
  const nodesPath = path.join(outDir, 'nodes.ndjson');
  const edgesPath = path.join(outDir, 'edges.ndjson');

  const nodes = loadNodesMap(nodesPath);
  const edgesOut = createBufferedStream(edgesPath);

  let edges = 0;
  let waysProcessed = 0;
  let skippedMissingNode = 0;
  let skippedZeroLength = 0;

  const lines = fs.readFileSync(waysPath, 'utf8').split('\n');
  for (const line of lines) {
    if (!line) continue;
    const way = JSON.parse(line);
    const r = edgesForWay(way, nodes);
    waysProcessed += 1;
    skippedMissingNode += r.skippedMissingNode;
    skippedZeroLength += r.skippedZeroLength;
    for (const e of r.edges) {
      edgesOut.write(`${JSON.stringify(e)}\n`);
      edges += 1;
      if (edges % BACKPRESSURE_CHECK_INTERVAL === 0) await drainIfNeeded(edgesOut);
    }
  }

  await new Promise((resolve, reject) => {
    edgesOut.end((err) => (err ? reject(err) : resolve()));
  });
  return { waysProcessed, edges, skippedMissingNode, skippedZeroLength };
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.pbf || !args.out) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(args.pbf)) {
    process.stderr.write(`PBF not found: ${args.pbf}\n`);
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(args.out, { recursive: true });

  const t0 = Date.now();
  process.stderr.write(`[pass 1/3] ways → ${args.out}/ways.ndjson\n`);
  const r1 = await passWays(args.pbf, args.out, args.limit);
  process.stderr.write(`  eligible=${r1.waysEligible} excluded=${r1.waysExcluded} nodeIds=${r1.neededNodes}\n`);

  process.stderr.write(`[pass 2/3] nodes → ${args.out}/nodes.ndjson\n`);
  const r2 = await passNodes(args.pbf, args.out, args.limit);
  process.stderr.write(`  kept=${r2.nodesKept} / seen=${r2.nodesSeen}\n`);

  process.stderr.write(`[pass 3/3] join → ${args.out}/edges.ndjson\n`);
  const r3 = await passJoin(args.out);
  process.stderr.write(
    `  edges=${r3.edges} skippedMissingNode=${r3.skippedMissingNode} skippedZeroLength=${r3.skippedZeroLength}\n`
  );

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  process.stderr.write(`done in ${dt}s\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`error: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  binarySearch,
  loadSortedIds,
  loadNodesMap,
  passJoin
};
