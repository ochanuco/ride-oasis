const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseArgs,
  buildTempTableName,
  buildMergeSql,
  sanitizeId
} = require('../scripts/bq_upsert_geocoded');

test('BQ Upsert: CLI引数を正常に解釈できる', () => {
  const args = parseArgs([
    'node',
    'scripts/bq_upsert_geocoded.js',
    '--project',
    'rideoasis-dev',
    '--source',
    'data/geocoded/stores_geocoded_lawson.ndjson',
    '--dataset',
    'raw',
    '--table',
    'stores_geocoded'
  ]);

  assert.equal(args.project, 'rideoasis-dev');
  assert.equal(args.source, 'data/geocoded/stores_geocoded_lawson.ndjson');
  assert.equal(args.dataset, 'raw');
  assert.equal(args.table, 'stores_geocoded');
});

test('BQ Upsert: --project が欠落している場合は例外を投げる', () => {
  assert.throws(
    () => parseArgs(['node', 'x', '--source', 'x.ndjson']),
    /--project is required/
  );
});

test('BQ Upsert: --source の値が欠落している場合は例外を投げる', () => {
  assert.throws(
    () => parseArgs(['node', 'x', '--project', 'rideoasis-dev', '--source', '--dataset', 'raw']),
    /--source requires a value/
  );
});

test('BQ Upsert: 一時テーブル名は安全な形式に正規化される', () => {
  const table = buildTempTableName('raw', 'stores_geocoded', '2026-02-11T23:59:59.000Z');
  assert.equal(table, 'raw._tmp_stores_geocoded_2026_02_11T23_59_59_000Z');
});

test('BQ Upsert: 不正な dataset 名は例外を投げる', () => {
  assert.throws(() => sanitizeId('raw-prod', 'dataset'), /invalid dataset/);
});

test('BQ Upsert: MERGE SQLに最新化条件とキー条件が含まれる', () => {
  const sql = buildMergeSql('rideoasis-dev', 'raw', 'stores_geocoded', 'raw._tmp_stores_geocoded_1');
  assert.match(sql, /PARTITION BY chain, store_id/);
  assert.match(sql, /ON T\.chain = S\.chain AND T\.store_id = S\.store_id/);
  assert.match(sql, /S\.geocoded_at >= T\.geocoded_at/);
  assert.match(sql, /WHEN NOT MATCHED THEN/);
});
