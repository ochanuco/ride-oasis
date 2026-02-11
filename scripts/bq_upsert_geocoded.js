const { execFileSync } = require('node:child_process');
const path = require('node:path');

const DEFAULT_DATASET = 'raw';
const DEFAULT_TABLE = 'stores_geocoded';
const DEFAULT_SCHEMA = path.join('schemas', 'raw', 'stores_geocoded.json');

const UPSERT_COLUMNS = [
  'chain',
  'store_id',
  'address_raw',
  'address_norm',
  'point_lat',
  'point_lng',
  'level',
  'point_level',
  'geocode_engine',
  'engine_version',
  'geocoded_at',
  'geocode_error',
  'pref',
  'city',
  'town',
  'addr',
  'other'
];

function parseArgs(argv = process.argv) {
  const args = {
    project: null,
    dataset: DEFAULT_DATASET,
    table: DEFAULT_TABLE,
    schema: DEFAULT_SCHEMA,
    source: null,
    location: null,
    keepTemp: false,
    dryRun: false,
    tempSuffix: null
  };

  function readValue(flag, index) {
    const value = argv[index + 1];
    if (!value || String(value).startsWith('-')) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  }

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--project') {
      args.project = readValue('--project', i);
      i += 1;
      continue;
    }
    if (token === '--dataset') {
      args.dataset = readValue('--dataset', i);
      i += 1;
      continue;
    }
    if (token === '--table') {
      args.table = readValue('--table', i);
      i += 1;
      continue;
    }
    if (token === '--schema') {
      args.schema = readValue('--schema', i);
      i += 1;
      continue;
    }
    if (token === '--source') {
      args.source = readValue('--source', i);
      i += 1;
      continue;
    }
    if (token === '--location') {
      args.location = readValue('--location', i);
      i += 1;
      continue;
    }
    if (token === '--temp-suffix') {
      args.tempSuffix = readValue('--temp-suffix', i);
      i += 1;
      continue;
    }
    if (token === '--keep-temp') {
      args.keepTemp = true;
      continue;
    }
    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      return { help: true };
    }
    throw new Error(`unknown arg: ${token}`);
  }

  if (!args.project) throw new Error('--project is required');
  if (!args.source) throw new Error('--source is required');

  return { help: false, ...args };
}

function printHelp() {
  console.log([
    'Usage:',
    '  node scripts/bq_upsert_geocoded.js --project <gcp-project> --source <ndjson-or-gs-uri> [--dataset raw] [--table stores_geocoded] [--schema schemas/raw/stores_geocoded.json] [--location asia-northeast1] [--dry-run]',
    '',
    'Examples:',
    '  node scripts/bq_upsert_geocoded.js --project my-project --source data/geocoded/stores_geocoded_lawson.ndjson',
    '  node scripts/bq_upsert_geocoded.js --project my-project --source gs://bucket/path/stores_geocoded_lawson.ndjson --location asia-northeast1'
  ].join('\n'));
}

function sanitizeId(value, label) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`invalid ${label}: ${value}`);
  }
  return value;
}

function buildTempTableName(dataset, table, suffix) {
  const safeDataset = sanitizeId(dataset, 'dataset');
  const safeTable = sanitizeId(table, 'table');
  const ts = suffix || `${Date.now()}`;
  const normalized = String(ts).replace(/[^A-Za-z0-9_]/g, '_');
  return `${safeDataset}._tmp_${safeTable}_${normalized}`;
}

function buildMergeSql(project, dataset, table, tempTable) {
  const target = `\`${project}.${dataset}.${table}\``;
  const source = `\`${project}.${tempTable}\``;
  const setClause = UPSERT_COLUMNS
    .filter((col) => !(col === 'chain' || col === 'store_id'))
    .map((col) => `  ${col} = S.${col}`)
    .join(',\n');
  const insertColumns = UPSERT_COLUMNS.join(', ');
  const insertValues = UPSERT_COLUMNS.map((col) => `S.${col}`).join(', ');

  return `MERGE ${target} AS T
USING (
  SELECT *
  FROM ${source}
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY chain, store_id
    ORDER BY geocoded_at DESC, address_raw DESC
  ) = 1
) AS S
ON T.chain = S.chain AND T.store_id = S.store_id
WHEN MATCHED AND (T.geocoded_at IS NULL OR S.geocoded_at >= T.geocoded_at)
  THEN UPDATE SET
${setClause}
WHEN NOT MATCHED THEN
  INSERT (${insertColumns})
  VALUES (${insertValues})`;
}

function buildBqBaseArgs(options) {
  const args = [];
  args.push('--project_id', options.project);
  if (options.location) {
    args.push('--location', options.location);
  }
  return args;
}

function runBq(args, options = {}) {
  const printCommand = `bq ${args.map((v) => (v.includes(' ') ? JSON.stringify(v) : v)).join(' ')}`;
  console.log(`[exec] ${printCommand}`);
  if (options.dryRun) {
    return;
  }

  execFileSync('bq', args, {
    stdio: 'inherit'
  });
}

function runUpsertFlow(options) {
  const safeDataset = sanitizeId(options.dataset, 'dataset');
  const safeTable = sanitizeId(options.table, 'table');
  const tempTable = buildTempTableName(safeDataset, safeTable, options.tempSuffix);
  const baseArgs = buildBqBaseArgs(options);
  const tempTableFq = `${options.project}:${tempTable}`;

  const loadArgs = [
    ...baseArgs,
    'load',
    '--replace',
    '--source_format=NEWLINE_DELIMITED_JSON',
    tempTableFq,
    options.source,
    options.schema
  ];
  runBq(loadArgs, { dryRun: options.dryRun });

  const sql = buildMergeSql(options.project, safeDataset, safeTable, tempTable);
  const queryArgs = [
    ...baseArgs,
    'query',
    '--use_legacy_sql=false',
    sql
  ];
  runBq(queryArgs, { dryRun: options.dryRun });

  if (!options.keepTemp) {
    const rmArgs = [
      ...baseArgs,
      'rm',
      '-f',
      '-t',
      tempTableFq
    ];
    runBq(rmArgs, { dryRun: options.dryRun });
  }
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  runUpsertFlow(args);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err?.message || err);
    process.exit(1);
  }
}

module.exports = {
  UPSERT_COLUMNS,
  parseArgs,
  buildTempTableName,
  buildMergeSql,
  sanitizeId
};
