const test = require('node:test');
const assert = require('node:assert/strict');

const { parseUrlState, formatUrlState } = require('../frontend/url_state');

test('UrlState: 空入力は全て null / undefined と既定の extra を返す', () => {
  const out = parseUrlState('');
  assert.equal(out.rwg, null);
  assert.equal(out.chains, null);
  assert.equal(out.precision, null);
  assert.equal(out.cp, null);
  assert.equal(out.cptypes, null);
  assert.equal(out.extra.toString(), '');
});

test('UrlState: rwg は正の整数だけ受け付ける', () => {
  assert.equal(parseUrlState('?rwg=12345').rwg, 12345);
  assert.equal(parseUrlState('?rwg=0').rwg, null);
  assert.equal(parseUrlState('?rwg=-1').rwg, null);
  assert.equal(parseUrlState('?rwg=abc').rwg, null);
});

test('UrlState: chains は trim + 重複除去された配列にする', () => {
  assert.deepEqual(parseUrlState('?chains=lawson,7eleven, lawson').chains, ['lawson', '7eleven']);
  assert.deepEqual(parseUrlState('?chains=').chains, []);
  assert.equal(parseUrlState('').chains, null);
});

test('UrlState: precision は precise / rough のみ通す', () => {
  assert.deepEqual(parseUrlState('?precision=precise,rough,unknown').precision, ['precise', 'rough']);
  assert.deepEqual(parseUrlState('?precision=').precision, []);
});

test('UrlState: cp は 0 で false、それ以外で true', () => {
  assert.equal(parseUrlState('?cp=1').cp, true);
  assert.equal(parseUrlState('?cp=0').cp, false);
  assert.equal(parseUrlState('?cp=true').cp, true);
  assert.equal(parseUrlState('').cp, null);
});

test('UrlState: 未知のキーは extra に残す', () => {
  const out = parseUrlState('?utm_source=x&rwg=42&random=1');
  assert.equal(out.rwg, 42);
  assert.equal(out.extra.get('utm_source'), 'x');
  assert.equal(out.extra.get('random'), '1');
  assert.equal(out.extra.has('rwg'), false);
});

test('UrlState: format は default を省略してクリーンな URL を返す', () => {
  assert.equal(formatUrlState({}), '');
  assert.equal(formatUrlState({ rwg: 12345 }), '?rwg=12345');
  assert.equal(formatUrlState({ rwg: null, chains: null, cp: null }), '');
});

test('UrlState: format は cp=false だけ書き出す (true は省略)', () => {
  assert.equal(formatUrlState({ cp: false }), '?cp=0');
  assert.equal(formatUrlState({ cp: true }), '');
});

test('UrlState: format はリスト型を comma 区切りで書き出す', () => {
  assert.equal(
    formatUrlState({ chains: ['lawson', '7eleven'], precision: ['precise'] }),
    '?chains=lawson%2C7eleven&precision=precise'
  );
});

test('UrlState: format は extra を末尾に保持する', () => {
  const extra = new URLSearchParams('utm_source=tw&id=99');
  assert.equal(
    formatUrlState({ rwg: 42, extra }),
    '?rwg=42&utm_source=tw&id=99'
  );
});

test('UrlState: parse → format は extra を含めて round-trip する', () => {
  const original = '?rwg=999&chains=lawson%2Cfamilymart&precision=precise&cp=0&cptypes=left%2Cright&utm_source=tw';
  const parsed = parseUrlState(original);
  const formatted = formatUrlState(parsed);
  // Re-parse the formatted result to verify semantic equivalence regardless of
  // key ordering or comma encoding.
  const reparsed = parseUrlState(formatted);
  assert.equal(reparsed.rwg, 999);
  assert.deepEqual(reparsed.chains, ['lawson', 'familymart']);
  assert.deepEqual(reparsed.precision, ['precise']);
  assert.equal(reparsed.cp, false);
  assert.deepEqual(reparsed.cptypes, ['left', 'right']);
  assert.equal(reparsed.extra.get('utm_source'), 'tw');
});
