const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const {
  buildBqSelectSql,
  buildSupplyPointsQuery,
  createSchemaSql,
  createUpsertStatement,
  MAX_LIMIT,
  normalizePointRow,
  parseBBox,
  parseExportArgs,
  parseNonNegativeInt,
  parseServerArgs,
  parseSupplyPointFilters,
  toFeatureCollection,
  validateProjectId,
  ValidationError
} = require('../lib/map_data');

test('Map Data: export 用CLI引数を正常に解釈できる', () => {
  const args = parseExportArgs([
    'node',
    'scripts/export_map_db.js',
    '--project',
    'rideoasis-dev',
    '--output',
    '.local/map.db'
  ]);

  assert.equal(args.project, 'rideoasis-dev');
  assert.equal(args.output, '.local/map.db');
});

test('Map Data: export 用CLIで --project が欠落している場合は例外を投げる', () => {
  assert.throws(() => parseExportArgs(['node', 'x']), /--project is required/);
});

test('Map Data: server 用CLI引数を正常に解釈できる', () => {
  const args = parseServerArgs(['node', 'scripts/map_dev_server.js', '--db', '.local/map.db', '--port', '9090']);
  assert.equal(args.db, '.local/map.db');
  assert.equal(args.port, 9090);
});

test('Map Data: bbox を正常に解釈できる', () => {
  assert.deepEqual(parseBBox('139.0,35.0,140.0,36.0'), {
    minLng: 139.0,
    minLat: 35.0,
    maxLng: 140.0,
    maxLat: 36.0
  });
});

test('Map Data: 不正な bbox は例外を投げる', () => {
  assert.throws(() => parseBBox('139,35,140'), /bbox must be/);
});

test('Map Data: supply point filters を既定値付きで解釈できる', () => {
  const params = new URLSearchParams('bbox=139,35,140,36&chains=lawson,familymart');
  const filters = parseSupplyPointFilters(params);
  assert.equal(filters.chains.length, 2);
  assert.equal(filters.minPointLevel, 8);
  assert.equal(filters.limit, 5000);
  assert.equal(filters.offset, 0);
});

test('Map Data: chains が空文字なら明示的な0件指定として扱う', () => {
  const filters = parseSupplyPointFilters(new URLSearchParams('chains='));
  assert.deepEqual(filters.chains, []);
  const { sql } = buildSupplyPointsQuery({
    bbox: null,
    chains: filters.chains,
    minPointLevel: 8,
    limit: 100,
    offset: 0
  });
  assert.match(sql, /0 = 1/);
});

test('Map Data: limit の上限を超えると例外を投げる', () => {
  assert.throws(
    () => parseSupplyPointFilters(new URLSearchParams(`limit=${MAX_LIMIT + 1}`)),
    /limit must be <=/
  );
});

test('Map Data: offset は非負整数のみ許可する', () => {
  assert.equal(parseNonNegativeInt('0', 'offset', 99), 0);
  assert.throws(() => parseNonNegativeInt('-1', 'offset', 0), /non-negative/);
});

test('Map Data: BigQuery SELECT SQL に null 除外が含まれる', () => {
  const sql = buildBqSelectSql('rideoasis-dev', 'rideoasis_mart', 'rideoasis_supply_points');
  assert.match(sql, /WHERE lat IS NOT NULL AND lng IS NOT NULL/);
  assert.match(sql, /FROM `rideoasis-dev\.rideoasis_mart\.rideoasis_supply_points`/);
});

test('Map Data: 不正な project id は例外を投げる', () => {
  assert.throws(() => validateProjectId('bad.project'), ValidationError);
});

test('Map Data: export 用 bq query は 100 件上限を外す', () => {
  const { DEFAULT_BQ_TIMEOUT_MS, buildBqArgs } = require('../scripts/export_map_db');
  const args = buildBqArgs({
    project: 'rideoasis-dev',
    dataset: 'rideoasis_mart',
    table: 'rideoasis_supply_points',
    location: null
  });
  assert.ok(args.includes('--max_rows=1000000000'));
  assert.equal(DEFAULT_BQ_TIMEOUT_MS, 10 * 60 * 1000);
});

test('Map Data: null 座標の行は normalize 時に除外される', () => {
  assert.equal(normalizePointRow({ supply_point_id: 'x', chain: 'lawson', store_id: '1', lat: null, lng: 139 }), null);
});

test('Map Data: SQLite upsert で同一 supply_point_id を更新できる', () => {
  const database = new DatabaseSync(':memory:');
  database.exec(createSchemaSql());
  const statement = createUpsertStatement(database);

  statement.run(
    normalizePointRow({
      supply_point_id: 'lawson:1',
      chain: 'lawson',
      store_id: '1',
      name: '旧店舗',
      lat: 35.0,
      lng: 139.0,
      address_norm: '東京都',
      geocode_level: 3,
      geocode_point_level: 8,
      source_url: 'https://example.com/old',
      updated_at: '2026-03-19T00:00:00Z'
    })
  );
  statement.run(
    normalizePointRow({
      supply_point_id: 'lawson:1',
      chain: 'lawson',
      store_id: '1',
      name: '新店舗',
      lat: 35.1,
      lng: 139.1,
      address_norm: '東京都千代田区',
      geocode_level: 8,
      geocode_point_level: 8,
      source_url: 'https://example.com/new',
      updated_at: '2026-03-20T00:00:00Z'
    })
  );

  const row = database.prepare('SELECT name, lat, lng, source_url FROM supply_points WHERE supply_point_id = ?').get('lawson:1');
  assert.equal(row.name, '新店舗');
  assert.equal(row.lat, 35.1);
  assert.equal(row.lng, 139.1);
  assert.equal(row.source_url, 'https://example.com/new');
  database.close();
});

test('Map Data: API query が bbox と chain と point_level を反映する', () => {
  const { sql, params } = buildSupplyPointsQuery({
    bbox: { minLng: 139, minLat: 35, maxLng: 140, maxLat: 36 },
    chains: ['lawson', 'familymart'],
    minPointLevel: 8,
    limit: 123,
    offset: 456
  });

  assert.match(sql, /lng BETWEEN :minLng AND :maxLng/);
  assert.match(sql, /chain IN \(:chain0, :chain1\)/);
  assert.match(sql, /geocode_point_level >= :minPointLevel/);
  assert.equal(params.limit, 123);
  assert.equal(params.offset, 456);
  assert.equal(params.chain0, 'lawson');
});

test('Map Data: GeoJSON FeatureCollection を生成できる', () => {
  const collection = toFeatureCollection([
    {
      supply_point_id: 'familymart:1',
      chain: 'familymart',
      store_id: '1',
      name: 'FM',
      lat: 35.1,
      lng: 139.2,
      address_norm: '東京都',
      geocode_level: 8,
      geocode_point_level: 8,
      source_url: null,
      updated_at: '2026-03-19T00:00:00Z'
    }
  ]);

  assert.equal(collection.type, 'FeatureCollection');
  assert.equal(collection.features[0].geometry.type, 'Point');
  assert.deepEqual(collection.features[0].geometry.coordinates, [139.2, 35.1]);
});

test('Map Data: frontend 未使用の列は properties から落とす (payload 軽量化)', () => {
  const collection = toFeatureCollection([
    {
      supply_point_id: 'lawson:1',
      chain: 'lawson',
      store_id: '1',
      name: 'L',
      lat: 35.0,
      lng: 139.0,
      address_norm: '東京都',
      geocode_level: 3,
      geocode_point_level: 8,
      source_url: 'https://example.com',
      updated_at: '2026-04-01T00:00:00Z'
    }
  ]);
  const props = collection.features[0].properties;
  // 使われる列のみ残る
  assert.equal(props.supply_point_id, 'lawson:1');
  assert.equal(props.chain, 'lawson');
  assert.equal(props.name, 'L');
  assert.equal(props.address_norm, '東京都');
  assert.equal(props.geocode_point_level, 8);
  // 落とされる列
  assert.equal(Object.prototype.hasOwnProperty.call(props, 'source_url'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(props, 'store_id'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(props, 'updated_at'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(props, 'geocode_level'), false);
});

test('Map Data: SELECT に不要列が含まれない', () => {
  const { sql } = buildSupplyPointsQuery({
    bbox: { minLng: 139, minLat: 35, maxLng: 140, maxLat: 36 },
    chains: null,
    minPointLevel: 8,
    limit: 100,
    offset: 0
  });
  // 落とした列が SELECT に出ない
  assert.equal(sql.includes('source_url'), false);
  assert.equal(sql.includes('updated_at'), false);
  assert.equal(/SELECT[^F]*store_id/.test(sql), false);
  assert.equal(/SELECT[^F]*geocode_level[^_]/.test(sql), false);
});

test('Map Data: ORDER BY 削除済 (sort のオーバヘッド回避)', () => {
  const { sql } = buildSupplyPointsQuery({
    bbox: { minLng: 139, minLat: 35, maxLng: 140, maxLat: 36 },
    chains: null,
    minPointLevel: 8,
    limit: 100,
    offset: 0
  });
  assert.equal(/ORDER BY/i.test(sql), false);
});
