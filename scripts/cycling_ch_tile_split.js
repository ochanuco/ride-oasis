'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { tileKey } = require('../lib/cycling/tile_partition');
const { encodeTileV2 } = require('../lib/cycling/tile_binary');

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
    'Usage: node --max-old-space-size=12288 scripts/cycling_ch_tile_split.js --dir <graphDir>',
    '  (or: npm run cycling:ch-tile-split -- --dir <graphDir>)',
    '',
    'Note: --max-old-space-size=12288 (12GB) is required for Kansai-scale',
    '  (7.6M nodes + 18M directed edges). Default 4GB heap OOMs in pass 3.',
    '',
    'Reads nodes.ndjson + ch_levels.ndjson + ch_edges.ndjson and writes:',
    '  <graphDir>/tiles/{x}_{y}.bin  - binary v2 tile (level + coreBit + viaId per edge)',
    '  <graphDir>/tile_index.json    - { tiles, cell_deg, bbox, format }',
    '',
    'v2 tiles preserve CH metadata: nodes carry their hierarchy level',
    'and a coreBit (1 = uncontracted core, allows lateral relax in query);',
    'edges carry a viaId (0 for original, nonzero for shortcut).'
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
  const levelsPath = path.join(args.dir, 'ch_levels.ndjson');
  const chEdgesPath = path.join(args.dir, 'ch_edges.ndjson');
  const tilesDir = path.join(args.dir, 'tiles');
  for (const p of [nodesPath, levelsPath, chEdgesPath]) {
    if (!fs.existsSync(p)) {
      process.stderr.write(`missing ${p}\n`);
      process.exitCode = 1;
      return;
    }
  }
  fs.rmSync(tilesDir, { recursive: true, force: true });
  fs.mkdirSync(tilesDir, { recursive: true });

  const t0 = Date.now();

  const nodes = new Map();
  const nodeToTile = new Map();
  const levels = new Map();
  const tileNodes = new Map();
  const tileEdges = new Map();
  let bbox = null;
  let nodeCount = 0;

  process.stderr.write(`[pass 1/3] reading nodes from ${nodesPath}\n`);
  await streamLines(nodesPath, (line) => {
    const n = JSON.parse(line);
    nodes.set(n.id, [n.lon, n.lat]);
    nodeToTile.set(n.id, tileKey(n.lon, n.lat));
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

  const t1 = Date.now();
  process.stderr.write(`[pass 2/3] reading CH levels from ${levelsPath}\n`);
  let levelCount = 0;
  let coreCount = 0;
  // core ノード集合。CH builder (rust-router) の出力 ch_levels.ndjson に
  // 含まれる core=1 (uncontracted top fraction + degree-skipped) を保持。
  // tile encoder 側で level の高位ビットに coreBit として詰める。
  const cores = new Set();
  await streamLines(levelsPath, (line) => {
    const l = JSON.parse(line);
    levels.set(l.id, l.level);
    if (l.core === 1) {
      cores.add(l.id);
      coreCount += 1;
    }
    levelCount += 1;
  });
  process.stderr.write(`  levels=${levelCount} core=${coreCount} in ${Date.now() - t1}ms\n`);

  // assemble per-tile node lists now that we know levels
  for (const [id, [lon, lat]] of nodes) {
    const key = nodeToTile.get(id);
    let arr = tileNodes.get(key);
    if (!arr) {
      arr = [];
      tileNodes.set(key, arr);
    }
    arr.push({
      id,
      lon,
      lat,
      level: levels.get(id) || 0,
      core: cores.has(id) ? 1 : 0
    });
  }

  const pushEdge = (key, edge) => {
    let arr = tileEdges.get(key);
    if (!arr) {
      arr = [];
      tileEdges.set(key, arr);
    }
    arr.push(edge);
  };

  const t2 = Date.now();
  process.stderr.write(`[pass 3/3] tiling CH edges from ${chEdgesPath}\n`);
  let edgeRecords = 0;
  await streamLines(chEdgesPath, (line) => {
    const e = JSON.parse(line);
    const fromTile = nodeToTile.get(e.from);
    const toCoord = nodes.get(e.to);
    if (!fromTile || !toCoord) return;
    pushEdge(fromTile, {
      from: e.from,
      to: e.to,
      toLon: toCoord[0],
      toLat: toCoord[1],
      cost: e.cost,
      viaId: e.via || 0
    });
    edgeRecords += 1;
  });
  process.stderr.write(`  edge records=${edgeRecords} in ${Date.now() - t2}ms\n`);

  const tileKeys = new Set([...tileNodes.keys(), ...tileEdges.keys()]);
  let bytesWritten = 0;
  for (const key of tileKeys) {
    const ns = tileNodes.get(key) || [];
    const es = tileEdges.get(key) || [];
    const buf = encodeTileV2(ns, es);
    fs.writeFileSync(path.join(tilesDir, `${key}.bin`), Buffer.from(buf));
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
        format: 'binary-v2-ch',
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
