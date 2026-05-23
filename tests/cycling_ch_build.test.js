'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseArgs, loadEdges } = require('../scripts/cycling_ch_build');

test('parseArgs: --dir 必須、--hop-limit 任意', () => {
  const r = parseArgs(['--dir', '/x']);
  assert.equal(r.dir, '/x');
  assert.equal(r.hopLimit, 5);
  assert.equal(parseArgs(['--dir', '/x', '--hop-limit', '8']).hopLimit, 8);
});

test('parseArgs: --hop-limit は正の数値のみ', () => {
  assert.equal(parseArgs(['--hop-limit', '0']).hopLimit, 5);
  assert.equal(parseArgs(['--hop-limit', '-3']).hopLimit, 5);
  assert.equal(parseArgs(['--hop-limit', 'abc']).hopLimit, 5);
});

test('parseArgs: 未知引数は例外', () => {
  assert.throws(() => parseArgs(['--bad']), /Unknown argument/);
});

test('loadEdges: NDJSON を配列にパース', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-build-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'edges.ndjson'),
      [
        JSON.stringify({ from: 1, to: 2, cost_m: 100, oneway: false }),
        JSON.stringify({ from: 2, to: 3, cost_m: 50, oneway: true })
      ].join('\n') + '\n'
    );
    const edges = loadEdges(path.join(dir, 'edges.ndjson'));
    assert.equal(edges.length, 2);
    assert.equal(edges[0].from, 1);
    assert.equal(edges[1].oneway, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
