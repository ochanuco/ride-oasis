const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePrefArg } = require('../scripts/pref_resolver');

test('--pref 未指定なら null を返す', () => {
  const result = parsePrefArg({
    argv: ['node', 'script.js'],
    allowedCodes: ['13']
  });
  assert.equal(result, null);
});

test('--pref all 指定なら null を返す', () => {
  const result = parsePrefArg({
    argv: ['node', 'script.js', '--pref', 'all'],
    allowedCodes: ['13']
  });
  assert.equal(result, null);
});

test('英語県名を標準コードに解決する', () => {
  const result = parsePrefArg({
    argv: ['node', 'script.js', '--pref', 'tokyo'],
    allowedCodes: ['13']
  });
  assert.equal(result, '13');
});

test('--pref の値が欠けている場合は例外を投げる', () => {
  assert.throws(
    () => parsePrefArg({ argv: ['node', 'script.js', '--pref'], allowedCodes: ['13'] }),
    /--pref requires a value/
  );
});

test('--pref の次が別フラグなら例外を投げる', () => {
  assert.throws(
    () => parsePrefArg({ argv: ['node', 'script.js', '--pref', '--pref-list'], allowedCodes: ['13'] }),
    /--pref requires a value/
  );
});
