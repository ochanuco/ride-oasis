const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePrefArg } = require('../scripts/pref_resolver');

test('returns null when --pref is not provided', () => {
  const result = parsePrefArg({
    argv: ['node', 'script.js'],
    allowedCodes: ['13']
  });
  assert.equal(result, null);
});

test('returns null when --pref all is provided', () => {
  const result = parsePrefArg({
    argv: ['node', 'script.js', '--pref', 'all'],
    allowedCodes: ['13']
  });
  assert.equal(result, null);
});

test('resolves english prefecture name', () => {
  const result = parsePrefArg({
    argv: ['node', 'script.js', '--pref', 'tokyo'],
    allowedCodes: ['13']
  });
  assert.equal(result, '13');
});

test('throws when --pref value is missing', () => {
  assert.throws(
    () => parsePrefArg({ argv: ['node', 'script.js', '--pref'], allowedCodes: ['13'] }),
    /--pref requires a value/
  );
});

test('throws when next token after --pref is another flag', () => {
  assert.throws(
    () => parsePrefArg({ argv: ['node', 'script.js', '--pref', '--pref-list'], allowedCodes: ['13'] }),
    /--pref requires a value/
  );
});
