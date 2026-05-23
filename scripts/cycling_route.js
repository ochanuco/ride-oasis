'use strict';

const fs = require('fs');
const path = require('path');

const { Graph } = require('../lib/cycling/graph');
const { bidirectionalDijkstra } = require('../lib/cycling/bidirectional_dijkstra');

function parseArgs(argv = process.argv.slice(2)) {
  const args = { dir: null, from: null, to: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dir') args.dir = argv[++i] || null;
    else if (a === '--from') args.from = Number(argv[++i]);
    else if (a === '--to') args.to = Number(argv[++i]);
    else if (a === '--json') args.json = true;
    else if (a === '-h' || a === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/cycling_route.js --dir <graphDir> --from <nodeId> --to <nodeId> [--json]',
    '',
    'Loads nodes.ndjson + edges.ndjson from <graphDir> and runs bidirectional',
    'Dijkstra between the two node IDs. Output: distance (cost), path as node IDs',
    'and lon/lat list. Use --json for machine-readable output.'
  ].join('\n');
}

function loadGraph(dir) {
  const g = new Graph();
  const nodesPath = path.join(dir, 'nodes.ndjson');
  const edgesPath = path.join(dir, 'edges.ndjson');

  for (const line of fs.readFileSync(nodesPath, 'utf8').split('\n')) {
    if (!line) continue;
    const n = JSON.parse(line);
    g.addNode(n.id, n.lon, n.lat);
  }
  for (const line of fs.readFileSync(edgesPath, 'utf8').split('\n')) {
    if (!line) continue;
    g.addEdge(JSON.parse(line));
  }
  return g;
}

function main() {
  const args = parseArgs();
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.dir || !Number.isFinite(args.from) || !Number.isFinite(args.to)) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 1;
    return;
  }

  const t0 = Date.now();
  const g = loadGraph(args.dir);
  const tLoad = Date.now() - t0;

  const t1 = Date.now();
  const r = bidirectionalDijkstra(g, args.from, args.to);
  const tQuery = Date.now() - t1;

  if (args.json) {
    const coords = r.path.map((id) => g.coord(id) || null);
    process.stdout.write(
      `${JSON.stringify({
        from: args.from,
        to: args.to,
        distance_cost: r.distance,
        node_count: r.path.length,
        settled: r.settled,
        load_ms: tLoad,
        query_ms: tQuery,
        path_ids: r.path,
        path_lonlat: coords
      })}\n`
    );
    return;
  }

  process.stderr.write(
    `nodes=${g.nodeCount} edges=${g.edgeCount} load=${tLoad}ms query=${tQuery}ms settled=${r.settled}\n`
  );
  if (!Number.isFinite(r.distance)) {
    process.stderr.write('UNREACHABLE\n');
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`cost=${r.distance.toFixed(1)} nodes=${r.path.length}\n`);
  for (const id of r.path) {
    const c = g.coord(id);
    if (c) process.stdout.write(`${id}\t${c[0]}\t${c[1]}\n`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`error: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  }
}

module.exports = { parseArgs, loadGraph };
