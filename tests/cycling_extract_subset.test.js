'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseArgs, parseBbox } = require('../scripts/cycling_extract_subset');

test('parseArgs: --src / --dst / --bbox を読み取る', () => {
  const r = parseArgs(['--src', 'data/cycling', '--dst', 'data/cycling-osaka', '--bbox', '135.4,34.6,135.6,34.8']);
  assert.equal(r.src, 'data/cycling');
  assert.equal(r.dst, 'data/cycling-osaka');
  assert.equal(r.bbox, '135.4,34.6,135.6,34.8');
});

test('parseArgs: 省略した引数は null のまま', () => {
  const r = parseArgs(['--src', 'data/cycling']);
  assert.equal(r.src, 'data/cycling');
  assert.equal(r.dst, null);
  assert.equal(r.bbox, null);
});

test('parseArgs: --help でフラグ立つ', () => {
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-h']).help, true);
});

test('parseArgs: 未知引数は例外', () => {
  assert.throws(() => parseArgs(['--unknown']), /Unknown argument/);
});

test('parseArgs: 値が欠けたオプションは null になり後続の必須チェックに落ちる', () => {
  const r = parseArgs(['--src']);
  assert.equal(r.src, null);
});

test('parseBbox: 4 要素を minLon/minLat/maxLon/maxLat に割り当てる', () => {
  const b = parseBbox('135.4,34.6,135.6,34.8');
  assert.deepEqual(b, { minLon: 135.4, minLat: 34.6, maxLon: 135.6, maxLat: 34.8 });
});

test('parseBbox: 負値を含む bbox も扱える', () => {
  const b = parseBbox('-10.5,-20.25,10.5,20.25');
  assert.deepEqual(b, { minLon: -10.5, minLat: -20.25, maxLon: 10.5, maxLat: 20.25 });
});

test('parseBbox: 未指定は null', () => {
  assert.equal(parseBbox(null), null);
  assert.equal(parseBbox(''), null);
});

test('parseBbox: 要素数が 4 でなければ null', () => {
  assert.equal(parseBbox('135.4,34.6,135.6'), null);
  assert.equal(parseBbox('135.4,34.6,135.6,34.8,1'), null);
});

test('parseBbox: 数値でない要素があれば null', () => {
  assert.equal(parseBbox('135.4,abc,135.6,34.8'), null);
  assert.equal(parseBbox('135.4,,135.6,34.8'), null);
});

test('parseBbox: NaN / Infinity は弾く', () => {
  assert.equal(parseBbox('NaN,34.6,135.6,34.8'), null);
  assert.equal(parseBbox('135.4,34.6,Infinity,34.8'), null);
});
