const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseArgs,
  pickLatestByStoreId,
  buildGeocodedRows,
  geocodeFieldsFromResult
} = require('../scripts/geocode_stores_ndjson');

test('CLI引数を正常に解釈できる', () => {
  const result = parseArgs([
    'node',
    'scripts/geocode_stores_ndjson.js',
    '--chain',
    'lawson',
    '--input',
    'data/lawson/ndjson',
    '--output',
    'data/geocoded/stores_geocoded_lawson.ndjson'
  ]);

  assert.equal(result.chain, 'lawson');
  assert.equal(result.input, 'data/lawson/ndjson');
  assert.equal(result.output, 'data/geocoded/stores_geocoded_lawson.ndjson');
  assert.equal(result.geocodeEngine, 'geolonia/normalize-japanese-addresses');
});

test('--japanese-addresses-api を指定した場合は値を解釈できる', () => {
  const result = parseArgs([
    'node',
    'scripts/geocode_stores_ndjson.js',
    '--chain',
    'lawson',
    '--input',
    'data/lawson/ndjson',
    '--output',
    'data/geocoded/stores_geocoded_lawson.ndjson',
    '--japanese-addresses-api',
    'file:///tmp/japanese-addresses/api/ja'
  ]);

  assert.equal(result.japaneseAddressesApi, 'file:///tmp/japanese-addresses/api/ja');
});

test('--chain が欠落している場合は例外を投げる', () => {
  assert.throws(
    () => parseArgs(['node', 'x', '--input', 'a', '--output', 'b']),
    /--chain is required/
  );
});

test('不正な --chain 指定は例外を投げる', () => {
  assert.throws(
    () => parseArgs(['node', 'x', '--chain', 'unknown', '--input', 'a', '--output', 'b']),
    /invalid --chain/
  );
});

test('--input の値が欠落している場合は例外を投げる', () => {
  assert.throws(
    () => parseArgs(['node', 'x', '--chain', 'lawson', '--input', '--output', 'x.ndjson']),
    /--input requires a value/
  );
});

test('--japanese-addresses-api の値が欠落している場合は例外を投げる', () => {
  assert.throws(
    () => parseArgs(['node', 'x', '--chain', 'lawson', '--input', 'a', '--output', 'b', '--japanese-addresses-api']),
    /--japanese-addresses-api requires a value/
  );
});

test('store_id ごとに scraped_at が最新のレコードが残る', () => {
  const rows = pickLatestByStoreId([
    { store_id: 'A', scraped_at: '2026-02-11T00:00:00.000Z', address_raw: 'old' },
    { store_id: 'A', scraped_at: '2026-02-11T01:00:00.000Z', address_raw: 'new' },
    { store_id: 'B', scraped_at: '2026-02-11T00:30:00.000Z', address_raw: 'b' }
  ]);

  const byId = new Map(rows.map((row) => [row.store_id, row]));
  assert.equal(byId.get('A').address_raw, 'new');
  assert.equal(byId.get('B').address_raw, 'b');
});

test('既存 geocoded の同一住所を再利用し geocode を再実行しない', async () => {
  let callCount = 0;
  const rows = await buildGeocodedRows({
    chain: 'lawson',
    scrapedRows: [
      { store_id: '100', address_raw: '東京都千代田区1-1', scraped_at: '2026-02-11T00:00:00.000Z' }
    ],
    existingRows: [
      {
        address_raw: '東京都千代田区1-1',
        address_norm: '東京都千代田区1-1',
        point_lat: 35.0,
        point_lng: 139.0,
        level: 8,
        point_level: 8,
        geocode_error: null,
        pref: '東京都',
        city: '千代田区',
        town: null,
        addr: '1-1',
        other: null
      }
    ],
    geocodeEngine: 'geolonia/normalize-japanese-addresses',
    engineVersion: 'test',
    nowIso: '2026-02-11T12:00:00.000Z',
    normalizeAddress: async () => {
      callCount += 1;
      return {};
    }
  });

  assert.equal(callCount, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].point_lat, 35.0);
  assert.equal(rows[0].point_lng, 139.0);
  assert.equal(rows[0].address_norm, '東京都千代田区1-1');
});

test('address_raw がない場合は geocode_error を残す', async () => {
  const rows = await buildGeocodedRows({
    chain: 'lawson',
    scrapedRows: [
      { store_id: '100', address_raw: null, scraped_at: '2026-02-11T00:00:00.000Z' }
    ],
    existingRows: [],
    geocodeEngine: 'geolonia/normalize-japanese-addresses',
    engineVersion: 'test',
    nowIso: '2026-02-11T12:00:00.000Z',
    normalizeAddress: async () => ({})
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].geocode_error, 'address_raw is missing');
  assert.equal(rows[0].point_lat, null);
  assert.equal(rows[0].point_lng, null);
});

test('point_level は point 系フィールドのみから算出し level を流用しない', () => {
  const fields = geocodeFieldsFromResult({
    level: 8,
    point: {}
  });
  assert.equal(fields.level, 8);
  assert.equal(fields.point_level, null);
});
