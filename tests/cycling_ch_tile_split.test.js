'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseArgs } = require('../scripts/cycling_ch_tile_split');

test('parseArgs: --dir', () => {
  const r = parseArgs(['--dir', '/x']);
  assert.equal(r.dir, '/x');
});

test('parseArgs: --help', () => {
  assert.equal(parseArgs(['--help']).help, true);
});

test('parseArgs: unknown rejects', () => {
  assert.throws(() => parseArgs(['--bogus']), /Unknown/);
});
