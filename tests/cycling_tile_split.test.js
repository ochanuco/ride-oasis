'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseArgs } = require('../scripts/cycling_tile_split');

test('parseArgs: --dir 必須', () => {
  const r = parseArgs(['--dir', '/x']);
  assert.equal(r.dir, '/x');
});

test('parseArgs: --help でフラグ立つ', () => {
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-h']).help, true);
});

test('parseArgs: 未知引数は例外', () => {
  assert.throws(() => parseArgs(['--unknown']), /Unknown argument/);
});
