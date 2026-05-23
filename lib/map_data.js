const DEFAULT_MART_DATASET = 'rideoasis_mart';
const DEFAULT_MART_TABLE = 'rideoasis_supply_points';
const DEFAULT_SQLITE_PATH = '.local/rideoasis-map.db';
const DEFAULT_API_PORT = 8787;
const DEFAULT_MIN_POINT_LEVEL = 8;
const DEFAULT_LIMIT = 5000;
const MAX_LIMIT = 10000;

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

// export:map-db で SQLite に書き出す全カラム (Dataform mart と同期)。
// 将来別の API でも使えるよう、保存側はすべての列を持つ。
const SQLITE_COLUMNS = [
  'supply_point_id',
  'chain',
  'store_id',
  'name',
  'lat',
  'lng',
  'address_norm',
  'geocode_level',
  'geocode_point_level',
  'source_url',
  'updated_at'
];

// /api/supply-points レスポンスで実際に返す列 (frontend で使われるもののみ)。
const API_COLUMNS = [
  'supply_point_id',
  'chain',
  'name',
  'lat',
  'lng',
  'address_norm',
  'geocode_point_level'
];

/** Validates the SQLite output path argument. */
function sanitizeSqlitePath(value) {
  if (!value) {
    throw new ValidationError('sqlite path is required');
  }
  return String(value);
}

/** Reads a required CLI flag value. */
function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || String(value).startsWith('-')) {
    throw new ValidationError(`${flag} requires a value`);
  }
  return value;
}

/** Parses CLI arguments for the BigQuery-to-SQLite export script. */
function parseExportArgs(argv = process.argv) {
  const args = {
    project: null,
    dataset: DEFAULT_MART_DATASET,
    table: DEFAULT_MART_TABLE,
    output: DEFAULT_SQLITE_PATH,
    location: null,
    dryRun: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--project') {
      args.project = readValue(argv, i, '--project');
      i += 1;
      continue;
    }
    if (token === '--dataset') {
      args.dataset = readValue(argv, i, '--dataset');
      i += 1;
      continue;
    }
    if (token === '--table') {
      args.table = readValue(argv, i, '--table');
      i += 1;
      continue;
    }
    if (token === '--output') {
      args.output = readValue(argv, i, '--output');
      i += 1;
      continue;
    }
    if (token === '--location') {
      args.location = readValue(argv, i, '--location');
      i += 1;
      continue;
    }
    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      return { help: true };
    }
    throw new ValidationError(`unknown arg: ${token}`);
  }

  if (!args.project) throw new ValidationError('--project is required');

  return { help: false, ...args };
}

/** Parses CLI arguments for the local map development server. */
function parseServerArgs(argv = process.argv) {
  const args = {
    db: DEFAULT_SQLITE_PATH,
    port: DEFAULT_API_PORT
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--db') {
      args.db = readValue(argv, i, '--db');
      i += 1;
      continue;
    }
    if (token === '--port') {
      const value = Number(readValue(argv, i, '--port'));
      if (!Number.isInteger(value) || value <= 0) {
        throw new ValidationError('--port must be a positive integer');
      }
      args.port = value;
      i += 1;
      continue;
    }
    if (token === '--help' || token === '-h') {
      return { help: true };
    }
    throw new ValidationError(`unknown arg: ${token}`);
  }

  return { help: false, ...args };
}

/** Validates SQL identifier fragments used for dataset, table, and chain names. */
function sanitizeId(value, label) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new ValidationError(`invalid ${label}: ${value}`);
  }
  return value;
}

/** Validates a BigQuery project id before interpolating it into SQL. */
function validateProjectId(value) {
  const projectId = String(value || '');
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new ValidationError(`invalid project: ${projectId}`);
  }
  return projectId;
}

/** Builds the BigQuery SQL used to export the final supply point mart. */
function buildBqSelectSql(project, dataset, table) {
  const validatedProject = validateProjectId(project);
  const safeDataset = sanitizeId(dataset, 'dataset');
  const safeTable = sanitizeId(table, 'table');
  return [
    'SELECT',
    '  supply_point_id,',
    '  chain,',
    '  store_id,',
    '  name,',
    '  lat,',
    '  lng,',
    '  address_norm,',
    '  geocode_level,',
    '  geocode_point_level,',
    '  source_url,',
    '  updated_at',
    `FROM \`${validatedProject}.${safeDataset}.${safeTable}\``,
    'WHERE lat IS NOT NULL AND lng IS NOT NULL',
    'ORDER BY supply_point_id'
  ].join('\n');
}

/** Returns the SQLite schema and indexes for local map lookups. */
function createSchemaSql() {
  return [
    'CREATE TABLE IF NOT EXISTS supply_points (',
    '  supply_point_id TEXT PRIMARY KEY,',
    '  chain TEXT NOT NULL,',
    '  store_id TEXT NOT NULL,',
    '  name TEXT NOT NULL,',
    '  lat REAL NOT NULL,',
    '  lng REAL NOT NULL,',
    '  address_norm TEXT,',
    '  geocode_level INTEGER,',
    '  geocode_point_level INTEGER,',
    '  source_url TEXT,',
    '  updated_at TEXT',
    ')',
    ';',
    'CREATE INDEX IF NOT EXISTS idx_supply_points_chain ON supply_points(chain);',
    'CREATE INDEX IF NOT EXISTS idx_supply_points_point_level ON supply_points(geocode_point_level);',
    'CREATE INDEX IF NOT EXISTS idx_supply_points_lat_lng ON supply_points(lat, lng);'
  ].join('\n');
}

/** Normalizes a mart row into the SQLite insert shape, skipping null coordinates. */
function normalizePointRow(row) {
  if (!row || row.lat == null || row.lng == null) {
    return null;
  }

  return {
    supply_point_id: String(row.supply_point_id),
    chain: String(row.chain),
    store_id: String(row.store_id),
    name: String(row.name || row.supply_point_id),
    lat: Number(row.lat),
    lng: Number(row.lng),
    address_norm: row.address_norm == null ? null : String(row.address_norm),
    geocode_level: row.geocode_level == null ? null : Number(row.geocode_level),
    geocode_point_level: row.geocode_point_level == null ? null : Number(row.geocode_point_level),
    source_url: row.source_url == null ? null : String(row.source_url),
    updated_at: row.updated_at == null ? null : String(row.updated_at)
  };
}

/** Prepares the SQLite upsert statement used during export. */
function createUpsertStatement(database) {
  return database.prepare(`
    INSERT INTO supply_points (
      supply_point_id,
      chain,
      store_id,
      name,
      lat,
      lng,
      address_norm,
      geocode_level,
      geocode_point_level,
      source_url,
      updated_at
    ) VALUES (
      :supply_point_id,
      :chain,
      :store_id,
      :name,
      :lat,
      :lng,
      :address_norm,
      :geocode_level,
      :geocode_point_level,
      :source_url,
      :updated_at
    )
    ON CONFLICT(supply_point_id) DO UPDATE SET
      chain = excluded.chain,
      store_id = excluded.store_id,
      name = excluded.name,
      lat = excluded.lat,
      lng = excluded.lng,
      address_norm = excluded.address_norm,
      geocode_level = excluded.geocode_level,
      geocode_point_level = excluded.geocode_point_level,
      source_url = excluded.source_url,
      updated_at = excluded.updated_at
  `);
}

/** Parses a bbox query parameter into numeric bounds. */
function parseBBox(value) {
  if (!value) return null;
  const parts = String(value).split(',').map((v) => Number(v.trim()));
  if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) {
    throw new ValidationError('bbox must be minLng,minLat,maxLng,maxLat');
  }
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLng > maxLng || minLat > maxLat) {
    throw new ValidationError('bbox min values must be <= max values');
  }
  return { minLng, minLat, maxLng, maxLat };
}

/** Parses the comma-separated chain filter query parameter. */
function parseChains(value) {
  if (value == null) return null;
  if (String(value).trim() === '') return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => sanitizeId(item, 'chain'));
}

/** Parses a positive integer query parameter with a fallback default. */
function parsePositiveInt(value, label, fallback) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`${label} must be a positive integer`);
  }
  return parsed;
}

/** Parses a non-negative integer query parameter with a fallback default. */
function parseNonNegativeInt(value, label, fallback) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ValidationError(`${label} must be a non-negative integer`);
  }
  return parsed;
}

/** Parses HTTP query parameters for the supply point lookup API. */
function parseSupplyPointFilters(searchParams) {
  const limit = parsePositiveInt(searchParams.get('limit'), 'limit', DEFAULT_LIMIT);
  if (limit > MAX_LIMIT) {
    throw new ValidationError(`limit must be <= ${MAX_LIMIT}`);
  }
  return {
    bbox: parseBBox(searchParams.get('bbox')),
    chains: parseChains(searchParams.get('chains')),
    minPointLevel: parsePositiveInt(
      searchParams.get('min_point_level'),
      'min_point_level',
      DEFAULT_MIN_POINT_LEVEL
    ),
    limit,
    offset: parseNonNegativeInt(searchParams.get('offset'), 'offset', 0)
  };
}

/** Builds the SQLite SELECT and bound params for supply point API queries. */
function buildSupplyPointsQuery(filters) {
  const where = [];
  const params = {};

  if (filters.bbox) {
    where.push('lng BETWEEN :minLng AND :maxLng');
    where.push('lat BETWEEN :minLat AND :maxLat');
    params.minLng = filters.bbox.minLng;
    params.maxLng = filters.bbox.maxLng;
    params.minLat = filters.bbox.minLat;
    params.maxLat = filters.bbox.maxLat;
  }

  if (Number.isInteger(filters.minPointLevel)) {
    where.push('(geocode_point_level IS NOT NULL AND geocode_point_level >= :minPointLevel)');
    params.minPointLevel = filters.minPointLevel;
  }

  if (filters.chains === null) {
    // No explicit chain filter means all chains.
  } else if (filters.chains.length === 0) {
    where.push('0 = 1');
  } else if (filters.chains.length > 0) {
    const placeholders = filters.chains.map((_, index) => `:chain${index}`);
    where.push(`chain IN (${placeholders.join(', ')})`);
    filters.chains.forEach((chain, index) => {
      params[`chain${index}`] = chain;
    });
  }

  params.limit = filters.limit;
  params.offset = filters.offset;

  return {
    sql: [
      'SELECT',
      // frontend が実利用する列のみ。store_id/source_url/updated_at/geocode_level
      // は外部 (将来の店舗詳細リンク) に必要になったら再追加する。
      `  ${API_COLUMNS.join(', ')}`,
      'FROM supply_points',
      where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
      // ORDER BY を削除: FeatureCollection の features は描画順に依存しない。
      // 1000 行超の三列ソートが効いてレイテンシを押し上げていた。
      'LIMIT :limit',
      'OFFSET :offset'
    ]
      .filter(Boolean)
      .join('\n'),
    params
  };
}

/** Converts a SQLite row into a GeoJSON Point feature. */
function toGeoJsonFeature(row) {
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [row.lng, row.lat]
    },
    properties: {
      supply_point_id: row.supply_point_id,
      chain: row.chain,
      name: row.name,
      address_norm: row.address_norm,
      geocode_point_level: row.geocode_point_level
    }
  };
}

/** Wraps point features into a GeoJSON FeatureCollection payload. */
function toFeatureCollection(rows) {
  return {
    type: 'FeatureCollection',
    features: rows.map(toGeoJsonFeature)
  };
}

module.exports = {
  DEFAULT_API_PORT,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  DEFAULT_MART_DATASET,
  DEFAULT_MART_TABLE,
  DEFAULT_MIN_POINT_LEVEL,
  DEFAULT_SQLITE_PATH,
  SQLITE_COLUMNS,
  buildBqSelectSql,
  buildSupplyPointsQuery,
  createSchemaSql,
  createUpsertStatement,
  normalizePointRow,
  parseBBox,
  parseChains,
  parseExportArgs,
  parseNonNegativeInt,
  parseServerArgs,
  parseSupplyPointFilters,
  sanitizeId,
  sanitizeSqlitePath,
  toFeatureCollection,
  validateProjectId,
  ValidationError
};
