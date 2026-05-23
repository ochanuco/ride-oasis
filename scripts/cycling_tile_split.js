'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { tileKey } = require('../lib/cycling/tile_partition');

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
    '  <graphDir>/tiles/{x}_{y}.ndjson  - per-tile content (one item per line)',
    '  <graphDir>/tile_index.json       - { tiles: ["x_y", ...], cellDeg, bbox }',
    '',
    'Tile NDJSON items:',
    '  {"t":"n","id":N,"lon":F,"lat":F}                                   primary node',
    '  {"t":"e","from":N,"to":N,"toLon":F,"toLat":F,"cost":F,"kind":?}    directed edge'
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
  let bbox = null;
  let nodeCount = 0;

  process.stderr.write(`[pass 1/2] reading nodes from ${nodesPath}\n`);
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

  const tileStreams = new Map();
  const tileStats = new Map();
  const openTile = (key) => {
    let s = tileStreams.get(key);
    if (!s) {
      s = fs.createWriteStream(path.join(tilesDir, `${key}.ndjson`));
      tileStreams.set(key, s);
      tileStats.set(key, { nodes: 0, edges: 0 });
    }
    return s;
  };

  for (const [id, [lon, lat]] of nodes) {
    const key = nodeToTile.get(id);
    openTile(key).write(`${JSON.stringify({ t: 'n', id, lon, lat })}\n`);
    tileStats.get(key).nodes += 1;
  }

  const t1 = Date.now();
  process.stderr.write(`[pass 2/2] tiling edges from ${edgesPath}\n`);
  let edgeRecords = 0;
  await streamLines(edgesPath, (line) => {
    const e = JSON.parse(line);
    const fromTile = nodeToTile.get(e.from);
    const toCoord = nodes.get(e.to);
    if (!fromTile || !toCoord) return;
    openTile(fromTile).write(
      `${JSON.stringify({
        t: 'e',
        from: e.from,
        to: e.to,
        toLon: toCoord[0],
        toLat: toCoord[1],
        cost: e.cost_m,
        kind: e.kind || null
      })}\n`
    );
    tileStats.get(fromTile).edges += 1;
    edgeRecords += 1;

    if (!e.oneway) {
      const toTile = nodeToTile.get(e.to);
      const fromCoord = nodes.get(e.from);
      if (toTile && fromCoord) {
        openTile(toTile).write(
          `${JSON.stringify({
            t: 'e',
            from: e.to,
            to: e.from,
            toLon: fromCoord[0],
            toLat: fromCoord[1],
            cost: e.cost_m,
            kind: e.kind || null
          })}\n`
        );
        tileStats.get(toTile).edges += 1;
        edgeRecords += 1;
      }
    }
  });
  process.stderr.write(`  directed edge records=${edgeRecords} in ${Date.now() - t1}ms\n`);

  await Promise.all(
    [...tileStreams.values()].map(
      (s) => new Promise((resolve, reject) => s.end((e) => (e ? reject(e) : resolve())))
    )
  );

  const tileKeys = [...tileStats.keys()].sort();
  fs.writeFileSync(
    path.join(args.dir, 'tile_index.json'),
    JSON.stringify(
      {
        cell_deg: 0.05,
        bbox,
        tile_count: tileKeys.length,
        tiles: tileKeys
      },
      null,
      2
    )
  );

  const totalMs = Date.now() - t0;
  process.stderr.write(
    `done: ${tileKeys.length} tiles, ${(totalMs / 1000).toFixed(1)}s\n`
  );
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`error: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
}

module.exports = { parseArgs };
