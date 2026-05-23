'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { tileKey } = require('../lib/cycling/tile_partition');
const { encodeTile } = require('../lib/cycling/tile_binary');

function parseArgs(argv = process.argv.slice(2)) {
  const args = { dir: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dir') args.dir = argv[++i] || null;
    else if (a === '-h' || a === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/cycling_tile_split.js --dir <graphDir>',
    '',
    'Reads <graphDir>/nodes.ndjson + edges.ndjson and writes:',
    '  <graphDir>/tiles/{x}_{y}.bin  - binary v1 tile (see lib/cycling/tile_binary.js)',
    '  <graphDir>/tile_index.json    - { tiles, cell_deg, bbox }',
    '',
    'Binary format trades JSON readability for ~5x smaller size and faster parse',
    'on the Worker side. NDJSON intermediates (nodes/edges.ndjson) are still kept',
    'because cycling_route.js (debug CLI) reads them directly.'
  ].join('\n');
}

async function streamLines(filePath, onLine) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });
  for await (const line of rl) {
    if (!line) continue;
    onLine(line);
  }
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.dir) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 1;
    return;
  }

  const nodesPath = path.join(args.dir, 'nodes.ndjson');
  const edgesPath = path.join(args.dir, 'edges.ndjson');
  const tilesDir = path.join(args.dir, 'tiles');
  if (!fs.existsSync(nodesPath) || !fs.existsSync(edgesPath)) {
    process.stderr.write(`nodes.ndjson or edges.ndjson missing in ${args.dir}\n`);
    process.exitCode = 1;
    return;
  }
  fs.rmSync(tilesDir, { recursive: true, force: true });
  fs.mkdirSync(tilesDir, { recursive: true });

  const t0 = Date.now();

  const nodes = new Map();
  const nodeToTile = new Map();
  const tileNodes = new Map();
  const tileEdges = new Map();
  let bbox = null;
  let nodeCount = 0;

  process.stderr.write(`[pass 1/2] reading nodes from ${nodesPath}\n`);
  await streamLines(nodesPath, (line) => {
    const n = JSON.parse(line);
    nodes.set(n.id, [n.lon, n.lat]);
    const key = tileKey(n.lon, n.lat);
    nodeToTile.set(n.id, key);
    let arr = tileNodes.get(key);
    if (!arr) {
      arr = [];
      tileNodes.set(key, arr);
    }
    arr.push({ id: n.id, lon: n.lon, lat: n.lat });
    nodeCount += 1;
    if (!bbox) bbox = { west: n.lon, east: n.lon, south: n.lat, north: n.lat };
    else {
      if (n.lon < bbox.west) bbox.west = n.lon;
      if (n.lon > bbox.east) bbox.east = n.lon;
      if (n.lat < bbox.south) bbox.south = n.lat;
      if (n.lat > bbox.north) bbox.north = n.lat;
    }
  });
  process.stderr.write(`  nodes=${nodeCount} in ${Date.now() - t0}ms\n`);

  const pushEdge = (key, edge) => {
    let arr = tileEdges.get(key);
    if (!arr) {
      arr = [];
      tileEdges.set(key, arr);
    }
    arr.push(edge);
  };

  const t1 = Date.now();
  process.stderr.write(`[pass 2/2] tiling edges from ${edgesPath}\n`);
  let edgeRecords = 0;
  await streamLines(edgesPath, (line) => {
    const e = JSON.parse(line);
    const fromTile = nodeToTile.get(e.from);
    const toCoord = nodes.get(e.to);
    if (!fromTile || !toCoord) return;
    pushEdge(fromTile, {
      from: e.from,
      to: e.to,
      toLon: toCoord[0],
      toLat: toCoord[1],
      cost: e.cost_m
    });
    edgeRecords += 1;
    if (!e.oneway) {
      const toTile = nodeToTile.get(e.to);
      const fromCoord = nodes.get(e.from);
      if (toTile && fromCoord) {
        pushEdge(toTile, {
          from: e.to,
          to: e.from,
          toLon: fromCoord[0],
          toLat: fromCoord[1],
          cost: e.cost_m
        });
        edgeRecords += 1;
      }
    }
  });
  process.stderr.write(`  directed edge records=${edgeRecords} in ${Date.now() - t1}ms\n`);

  const tileKeys = new Set([...tileNodes.keys(), ...tileEdges.keys()]);
  let bytesWritten = 0;
  for (const key of tileKeys) {
    const ns = tileNodes.get(key) || [];
    const es = tileEdges.get(key) || [];
    const buf = encodeTile(ns, es);
    const outPath = path.join(tilesDir, `${key}.bin`);
    fs.writeFileSync(outPath, Buffer.from(buf));
    bytesWritten += buf.byteLength;
  }

  const sortedKeys = [...tileKeys].sort();
  fs.writeFileSync(
    path.join(args.dir, 'tile_index.json'),
    JSON.stringify(
      {
        cell_deg: 0.05,
        bbox,
        tile_count: sortedKeys.length,
        tiles: sortedKeys,
        format: 'binary-v1',
        bytes: bytesWritten
      },
      null,
      2
    )
  );

  const totalMs = Date.now() - t0;
  process.stderr.write(
    `done: ${sortedKeys.length} tiles, ${(bytesWritten / 1024 / 1024).toFixed(1)}MB, ${(totalMs / 1000).toFixed(1)}s\n`
  );
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`error: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
}

module.exports = { parseArgs };
