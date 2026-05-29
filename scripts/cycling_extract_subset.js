'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { once } = require('events');
const { finished } = require('stream/promises');

// Extracts a bbox subset of nodes.ndjson + edges.ndjson into a separate dir.
// Used as a backup / verification dataset when full Kansai CH preprocessing
// is too slow.
//
// Usage:
//   node scripts/cycling_extract_subset.js \
//     --src data/cycling --dst data/cycling-osaka \
//     --bbox 135.4,34.6,135.6,34.8

function parseArgs(argv = process.argv.slice(2)) {
  const args = { src: null, dst: null, bbox: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--src') args.src = argv[++i] || null;
    else if (a === '--dst') args.dst = argv[++i] || null;
    else if (a === '--bbox') args.bbox = argv[++i] || null;
    else if (a === '-h' || a === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function parseBbox(str) {
  if (!str) return null;
  const parts = str.split(',').map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  return { minLon: parts[0], minLat: parts[1], maxLon: parts[2], maxLat: parts[3] };
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
  if (args.help || !args.src || !args.dst || !args.bbox) {
    process.stdout.write(
      'Usage: node scripts/cycling_extract_subset.js --src <dir> --dst <dir> --bbox minLon,minLat,maxLon,maxLat\n'
    );
    if (!args.help) process.exitCode = 1;
    return;
  }
  const bbox = parseBbox(args.bbox);
  if (!bbox) {
    process.stderr.write('invalid bbox\n');
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(args.dst, { recursive: true });

  const t0 = Date.now();
  const keepIds = new Set();
  const nodesOut = fs.createWriteStream(path.join(args.dst, 'nodes.ndjson'));

  process.stderr.write('[pass 1/2] filtering nodes by bbox\n');
  let nodesSeen = 0;
  let nodesKept = 0;
  let writes = 0;
  await streamLines(path.join(args.src, 'nodes.ndjson'), (line) => {
    nodesSeen += 1;
    const n = JSON.parse(line);
    if (
      n.lon >= bbox.minLon && n.lon <= bbox.maxLon &&
      n.lat >= bbox.minLat && n.lat <= bbox.maxLat
    ) {
      keepIds.add(n.id);
      nodesOut.write(line + '\n');
      nodesKept += 1;
      writes += 1;
    }
  });
  nodesOut.end();
  await finished(nodesOut);
  process.stderr.write(`  nodes ${nodesKept}/${nodesSeen} in ${Date.now() - t0}ms\n`);

  const edgesOut = fs.createWriteStream(path.join(args.dst, 'edges.ndjson'));
  let edgesSeen = 0;
  let edgesKept = 0;
  const t1 = Date.now();
  process.stderr.write('[pass 2/2] filtering edges (both endpoints in bbox)\n');
  await streamLines(path.join(args.src, 'edges.ndjson'), (line) => {
    edgesSeen += 1;
    const e = JSON.parse(line);
    if (keepIds.has(e.from) && keepIds.has(e.to)) {
      edgesOut.write(line + '\n');
      edgesKept += 1;
    }
  });
  edgesOut.end();
  await finished(edgesOut);
  process.stderr.write(`  edges ${edgesKept}/${edgesSeen} in ${Date.now() - t1}ms\n`);
  process.stderr.write(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`error: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
}

module.exports = { parseArgs, parseBbox };
