const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseArgs,
  sqlLiteral,
  buildInsertHeader,
  buildRowTuple,
  COLUMNS
} = require('../scripts/export_d1_seed');

test('export_d1_seed: parseArgs は既定値を返す', () => {
  const args = parseArgs(['node', 'export_d1_seed.js']);
  assert.equal(args.input, '.local/rideoasis-map.db');
  assert.equal(args.output, 'cloudflare/seed.sql');
  assert.equal(args.batch, 200);
  assert.equal(args.help, false);
});

test('export_d1_seed: parseArgs は --input/--output/--batch を反映する', () => {
  const args = parseArgs([
    'node',
    'export_d1_seed.js',
    '--input', '/tmp/source.db',
    '--output', '/tmp/out.sql',
    '--batch', '50'
  ]);
  assert.equal(args.input, '/tmp/source.db');
  assert.equal(args.output, '/tmp/out.sql');
  assert.equal(args.batch, 50);
});

test('export_d1_seed: parseArgs は --batch=0 や負数を拒否する', () => {
  assert.throws(() => parseArgs(['node', 'x.js', '--batch', '0']), /positive integer/);
  assert.throws(() => parseArgs(['node', 'x.js', '--batch', '-1']), /positive integer/);
  assert.throws(() => parseArgs(['node', 'x.js', '--batch', 'abc']), /positive integer/);
});

test('export_d1_seed: parseArgs は未知フラグを拒否する', () => {
  assert.throws(() => parseArgs(['node', 'x.js', '--mystery']), /unknown arg/);
});

test('export_d1_seed: sqlLiteral は null / undefined / NaN を NULL にする', () => {
  assert.equal(sqlLiteral(null), 'NULL');
  assert.equal(sqlLiteral(undefined), 'NULL');
  assert.equal(sqlLiteral(Number.NaN), 'NULL');
  assert.equal(sqlLiteral(Number.POSITIVE_INFINITY), 'NULL');
});

test('export_d1_seed: sqlLiteral は数値をそのまま、文字列をシングルクォートで囲む', () => {
  assert.equal(sqlLiteral(0), '0');
  assert.equal(sqlLiteral(35.681), '35.681');
  assert.equal(sqlLiteral('lawson'), "'lawson'");
});

test('export_d1_seed: sqlLiteral は文字列内のシングルクォートを2重化してエスケープする', () => {
  assert.equal(sqlLiteral("O'Reilly"), "'O''Reilly'");
  assert.equal(sqlLiteral("''"), "''''''"); // 内側に '' があるので '''''' (6 quotes)
});

test('export_d1_seed: buildInsertHeader は全列を含む INSERT VALUES 句を返す', () => {
  const header = buildInsertHeader();
  assert.match(header, /^INSERT INTO supply_points \(supply_point_id, chain/);
  assert.match(header, /\) VALUES$/);
  for (const col of COLUMNS) {
    assert.ok(header.includes(col), `missing column ${col}`);
  }
});

test('export_d1_seed: buildRowTuple は COLUMNS 順で値を埋める', () => {
  const tuple = buildRowTuple({
    supply_point_id: 'lawson:1',
    chain: 'lawson',
    store_id: '1',
    name: '銀座店',
    lat: 35.6702,
    lng: 139.7641,
    address_norm: '東京都中央区',
    geocode_level: 8,
    geocode_point_level: 8,
    source_url: null,
    updated_at: '2026-04-01'
  });
  assert.equal(
    tuple,
    "('lawson:1', 'lawson', '1', '銀座店', 35.6702, 139.7641, '東京都中央区', 8, 8, NULL, '2026-04-01')"
  );
});
