const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const {
  buildBqSelectSql,
  createSchemaSql,
  createUpsertStatement,
  normalizePointRow,
  parseExportArgs,
  sanitizeSqlitePath
} = require('../lib/map_data');

const DEFAULT_BQ_TIMEOUT_MS = 10 * 60 * 1000;

function printHelp() {
  console.log([
    'Usage:',
    '  node scripts/export_map_db.js --project <gcp-project> [--dataset rideoasis_mart] [--table rideoasis_supply_points] [--output .local/rideoasis-map.db] [--location asia-northeast1] [--dry-run]',
    '',
    'Example:',
    '  node scripts/export_map_db.js --project my-project --output .local/rideoasis-map.db'
  ].join('\n'));
}

function buildBqArgs(options) {
  const args = ['--project_id', options.project];
  if (options.location) {
    args.push('--location', options.location);
  }
  args.push('query', '--use_legacy_sql=false', '--format=json', '--max_rows=1000000000');
  args.push(buildBqSelectSql(options.project, options.dataset, options.table));
  return args;
}

function fetchMartRows(options) {
  const args = buildBqArgs(options);
  const output = execFileSync('bq', args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: DEFAULT_BQ_TIMEOUT_MS
  });
  return JSON.parse(output);
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeRowsToSqlite(rows, outputPath) {
  ensureParentDirectory(outputPath);
  const database = new DatabaseSync(outputPath);
  database.exec(createSchemaSql());

  const upsert = createUpsertStatement(database);
  let count = 0;

  database.exec('BEGIN');
  try {
    database.exec('DELETE FROM supply_points');
    for (const row of rows) {
      const normalized = normalizePointRow(row);
      if (!normalized) continue;
      upsert.run(normalized);
      count += 1;
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }

  return count;
}

function main() {
  const args = parseExportArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const outputPath = sanitizeSqlitePath(args.output);
  const querySql = buildBqSelectSql(args.project, args.dataset, args.table);

  if (args.dryRun) {
    console.log(querySql);
    return;
  }

  const rows = fetchMartRows(args);
  const count = writeRowsToSqlite(rows, outputPath);
  console.log(`exported ${count} supply points to ${outputPath}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error?.message || error);
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_BQ_TIMEOUT_MS,
  buildBqArgs,
  fetchMartRows,
  writeRowsToSqlite
};
