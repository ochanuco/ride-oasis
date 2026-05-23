'use strict';

const fs = require('fs');
const path = require('path');

const { buildContractionHierarchy } = require('../lib/cycling/ch_builder');

function parseArgs(argv = process.argv.slice(2)) {
  const args = { dir: null, hopLimit: 5 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dir') args.dir = argv[++i] || null;
    else if (a === '--hop-limit') {
      const v = Number(argv[++i]);
      if (Number.isFinite(v) && v > 0) args.hopLimit = v;
    } else if (a === '-h' || a === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/cycling_ch_build.js --dir <graphDir> [--hop-limit N]',
    '',
    'Reads <graphDir>/edges.ndjson and produces:',
    '  <graphDir>/ch_levels.ndjson  - {id, level} per node',
    '  <graphDir>/ch_edges.ndjson   - {from, to, cost, via, lowerIdx, upperIdx}',
    '                                 (originals + shortcuts, with parent indices)',
    '',
    '--hop-limit caps the witness search depth (default 5, higher = fewer shortcuts).'
  ].join('\n');
}

function loadEdges(filePath) {
  const out = [];
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    if (!line) continue;
    out.push(JSON.parse(line));
  }
  return out;
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

  const edgesPath = path.join(args.dir, 'edges.ndjson');
  if (!fs.existsSync(edgesPath)) {
    process.stderr.write(`edges.ndjson not found in ${args.dir}\n`);
    process.exitCode = 1;
    return;
  }

  const t0 = Date.now();
  process.stderr.write(`loading edges from ${edgesPath}...\n`);
  const edges = loadEdges(edgesPath);
  process.stderr.write(`  edges=${edges.length} loaded in ${Date.now() - t0}ms\n`);

  const t1 = Date.now();
  process.stderr.write(`building CH (hop-limit=${args.hopLimit})...\n`);
  const ch = buildContractionHierarchy(edges, { hopLimit: args.hopLimit });
  process.stderr.write(
    `  nodes=${ch.level.size} shortcuts=${ch.shortcuts.length} in ${Date.now() - t1}ms\n`
  );

  const levelsPath = path.join(args.dir, 'ch_levels.ndjson');
  const chEdgesPath = path.join(args.dir, 'ch_edges.ndjson');

  const levelsOut = fs.createWriteStream(levelsPath);
  for (const [id, lvl] of ch.level) {
    levelsOut.write(`${JSON.stringify({ id, level: lvl })}\n`);
  }
  await new Promise((resolve, reject) =>
    levelsOut.end((e) => (e ? reject(e) : resolve()))
  );

  const edgesOut = fs.createWriteStream(chEdgesPath);
  for (const e of ch.adj.allEdges) {
    edgesOut.write(`${JSON.stringify(e)}\n`);
  }
  await new Promise((resolve, reject) =>
    edgesOut.end((e) => (e ? reject(e) : resolve()))
  );

  process.stderr.write(
    `wrote ${levelsPath} and ${chEdgesPath} (total ${((Date.now() - t0) / 1000).toFixed(1)}s)\n`
  );
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`error: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
}

module.exports = { parseArgs, loadEdges };
