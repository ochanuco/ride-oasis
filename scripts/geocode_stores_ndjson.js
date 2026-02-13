const fs = require('fs');
const path = require('path');

const ALLOWED_CHAINS = new Set([
  '7eleven',
  'lawson',
  'familymart',
  'daily_yamazaki',
  'michi_no_eki',
  'ministop'
]);

const CHAIN_FILE_PREFIX = {
  '7eleven': 'stores_7eleven',
  'lawson': 'stores_lawson',
  'familymart': 'stores_familymart',
  'daily_yamazaki': 'stores_daily_yamazaki',
  'michi_no_eki': 'stores_michi_no_eki',
  'ministop': 'stores_ministop'
};

function parseArgs(argv = process.argv) {
  const args = {
    chain: null,
    input: null,
    output: null,
    existing: null,
    engineVersion: null,
    geocodeEngine: 'geolonia/normalize-japanese-addresses',
    japaneseAddressesApi: null
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
    if (token === '--chain') {
      args.chain = readValue('--chain', i);
      i += 1;
      continue;
    }
    if (token === '--input') {
      args.input = readValue('--input', i);
      i += 1;
      continue;
    }
    if (token === '--output') {
      args.output = readValue('--output', i);
      i += 1;
      continue;
    }
    if (token === '--existing') {
      args.existing = readValue('--existing', i);
      i += 1;
      continue;
    }
    if (token === '--engine-version') {
      args.engineVersion = readValue('--engine-version', i);
      i += 1;
      continue;
    }
    if (token === '--geocode-engine') {
      args.geocodeEngine = readValue('--geocode-engine', i);
      i += 1;
      continue;
    }
    if (token === '--japanese-addresses-api') {
      args.japaneseAddressesApi = readValue('--japanese-addresses-api', i);
      i += 1;
      continue;
    }
    if (token === '--help' || token === '-h') {
      return { help: true };
    }
    throw new Error(`unknown arg: ${token}`);
  }

  if (!args.chain) throw new Error('--chain is required');
  if (!ALLOWED_CHAINS.has(args.chain)) {
    throw new Error(`invalid --chain: ${args.chain}`);
  }
  if (!args.input) throw new Error('--input is required');
  if (!args.output) throw new Error('--output is required');
  if (!args.geocodeEngine) throw new Error('--geocode-engine requires a value');

  return { help: false, ...args };
}

function printHelp() {
  console.log(
    [
      'Usage:',
      '  node scripts/geocode_stores_ndjson.js --chain <chain> --input <file-or-dir> --output <file> [--existing <file-or-dir>] [--engine-version <version>] [--japanese-addresses-api <url-or-file-url>]',
      '',
      'Examples:',
      '  node scripts/geocode_stores_ndjson.js --chain 7eleven --input data/7eleven/ndjson --output data/geocoded/stores_geocoded_7eleven.ndjson',
      '  node scripts/geocode_stores_ndjson.js --chain lawson --input data/lawson/ndjson --existing data/geocoded --output data/geocoded/stores_geocoded_lawson.ndjson',
      '  node scripts/geocode_stores_ndjson.js --chain lawson --input data/lawson/ndjson --output data/geocoded/stores_geocoded_lawson.ndjson --japanese-addresses-api file:///tmp/japanese-addresses/api/ja'
    ].join('\n')
  );
}

function splitInputSpecs(input) {
  return String(input)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function resolveInputFiles(inputSpec, chain) {
  const specs = splitInputSpecs(inputSpec);
  const files = [];
  const filePrefix = CHAIN_FILE_PREFIX[chain] || `stores_${chain}`;

  for (const spec of specs) {
    const abs = path.resolve(spec);
    if (!fs.existsSync(abs)) {
      throw new Error(`input not found: ${spec}`);
    }
    const stat = fs.statSync(abs);
    if (stat.isFile()) {
      files.push(abs);
      continue;
    }
    if (stat.isDirectory()) {
      const names = fs.readdirSync(abs)
        .filter((name) => name.endsWith('.ndjson'))
        .filter((name) => chain ? name.includes(filePrefix) : name.includes('stores_'))
        .sort();
      for (const name of names) {
        files.push(path.join(abs, name));
      }
      continue;
    }
    throw new Error(`unsupported input type: ${spec}`);
  }

  return files;
}

function readNdjsonFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line));
  }
  return rows;
}

function readNdjsonFromSpec(spec, chainForDirectory) {
  if (!spec) return [];
  const files = resolveInputFiles(spec, chainForDirectory || '');
  const out = [];
  for (const filePath of files) {
    out.push(...readNdjsonFile(filePath));
  }
  return out;
}

function toEpoch(value) {
  const n = Date.parse(value || '');
  return Number.isFinite(n) ? n : -1;
}

function pickLatestByStoreId(rows) {
  const map = new Map();
  const anonymous = [];

  for (const row of rows) {
    const storeId = (row?.store_id || '').toString().trim();
    if (!storeId) {
      anonymous.push(row);
      continue;
    }

    const prev = map.get(storeId);
    if (!prev) {
      map.set(storeId, row);
      continue;
    }

    const prevTs = toEpoch(prev.scraped_at);
    const nextTs = toEpoch(row.scraped_at);
    if (nextTs >= prevTs) {
      map.set(storeId, row);
    }
  }

  return [...map.values(), ...anonymous];
}

function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function normalizedAddressFromResult(result) {
  const parts = [result?.pref, result?.city, result?.town, result?.addr, result?.other]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
  if (parts.length > 0) return parts.join('');

  const fallback = typeof result?.address === 'string' ? result.address.trim() : '';
  return fallback || null;
}

function geocodeFieldsFromResult(result) {
  const pointLat = asNumber(result?.point?.lat ?? result?.point?.latitude ?? result?.lat ?? result?.latitude);
  const pointLng = asNumber(result?.point?.lng ?? result?.point?.lon ?? result?.point?.longitude ?? result?.lng ?? result?.lon ?? result?.longitude);

  return {
    address_norm: normalizedAddressFromResult(result),
    point_lat: pointLat,
    point_lng: pointLng,
    level: asInt(result?.level),
    point_level: asInt(result?.point?.level ?? result?.pointLevel),
    pref: typeof result?.pref === 'string' ? result.pref : null,
    city: typeof result?.city === 'string' ? result.city : null,
    town: typeof result?.town === 'string' ? result.town : null,
    addr: typeof result?.addr === 'string' ? result.addr : null,
    other: typeof result?.other === 'string' ? result.other : null
  };
}

function buildAddressCache(existingRows) {
  const cache = new Map();
  for (const row of existingRows) {
    const key = typeof row?.address_raw === 'string' ? row.address_raw.trim() : '';
    if (!key) continue;
    cache.set(key, {
      address_norm: row.address_norm ?? null,
      point_lat: row.point_lat ?? null,
      point_lng: row.point_lng ?? null,
      level: row.level ?? null,
      point_level: row.point_level ?? null,
      geocode_error: row.geocode_error ?? null,
      pref: row.pref ?? null,
      city: row.city ?? null,
      town: row.town ?? null,
      addr: row.addr ?? null,
      other: row.other ?? null
    });
  }
  return cache;
}

async function createNormalizer(options = {}) {
  const { japaneseAddressesApi } = options;
  let mod;
  try {
    mod = await import('@geolonia/normalize-japanese-addresses');
  } catch (err) {
    throw new Error(
      'failed to load @geolonia/normalize-japanese-addresses. install it first: npm i @geolonia/normalize-japanese-addresses'
    );
  }

  if (typeof mod.normalize !== 'function') {
    throw new Error('normalize function is not exported by @geolonia/normalize-japanese-addresses');
  }

  if (japaneseAddressesApi) {
    if (!mod.config || typeof mod.config !== 'object') {
      throw new Error('config is not exported by @geolonia/normalize-japanese-addresses');
    }
    mod.config.japaneseAddressesApi = japaneseAddressesApi;
  }

  return async (addressRaw) => {
    return await mod.normalize(addressRaw);
  };
}

async function buildGeocodedRows(options) {
  const {
    chain,
    scrapedRows,
    existingRows,
    geocodeEngine,
    engineVersion,
    nowIso,
    normalizeAddress,
    onProgress
  } = options;

  const addressCache = buildAddressCache(existingRows || []);
  const latestRows = pickLatestByStoreId(scrapedRows || []);
  const outputRows = [];
  const stats = {
    processed: 0,
    total: latestRows.length,
    skipped_store_id: 0,
    cache_hits: 0,
    geocoded_new: 0,
    geocode_errors: 0,
    missing_address: 0
  };

  const reportProgress = () => {
    if (typeof onProgress === 'function') {
      onProgress({ ...stats });
    }
  };

  for (const row of latestRows) {
    const storeId = row?.store_id ? String(row.store_id) : null;
    if (!storeId) {
      stats.processed += 1;
      stats.skipped_store_id += 1;
      reportProgress();
      continue;
    }

    const addressRaw = typeof row?.address_raw === 'string' ? row.address_raw.trim() : null;
    const base = {
      chain,
      store_id: storeId,
      address_raw: addressRaw,
      address_norm: null,
      point_lat: null,
      point_lng: null,
      level: null,
      point_level: null,
      geocode_engine: geocodeEngine,
      engine_version: engineVersion,
      geocoded_at: nowIso,
      geocode_error: null,
      pref: null,
      city: null,
      town: null,
      addr: null,
      other: null
    };

    if (!addressRaw) {
      stats.processed += 1;
      stats.missing_address += 1;
      stats.geocode_errors += 1;
      outputRows.push({ ...base, geocode_error: 'address_raw is missing' });
      reportProgress();
      continue;
    }

    const cached = addressCache.get(addressRaw);
    if (cached) {
      stats.processed += 1;
      stats.cache_hits += 1;
      outputRows.push({
        ...base,
        ...cached,
        level: asInt(cached.level),
        point_level: asInt(cached.point_level),
        point_lat: asNumber(cached.point_lat),
        point_lng: asNumber(cached.point_lng)
      });
      reportProgress();
      continue;
    }

    try {
      const result = await normalizeAddress(addressRaw);
      const fields = geocodeFieldsFromResult(result || {});
      const geocodeError = fields.point_lat === null || fields.point_lng === null
        ? 'point is missing'
        : null;

      const geocoded = {
        ...base,
        ...fields,
        geocode_error: geocodeError
      };
      stats.processed += 1;
      stats.geocoded_new += 1;
      if (geocodeError) {
        stats.geocode_errors += 1;
      }
      outputRows.push(geocoded);
      addressCache.set(addressRaw, {
        address_norm: geocoded.address_norm,
        point_lat: geocoded.point_lat,
        point_lng: geocoded.point_lng,
        level: geocoded.level,
        point_level: geocoded.point_level,
        geocode_error: geocoded.geocode_error,
        pref: geocoded.pref,
        city: geocoded.city,
        town: geocoded.town,
        addr: geocoded.addr,
        other: geocoded.other
      });
      reportProgress();
    } catch (err) {
      stats.processed += 1;
      stats.geocode_errors += 1;
      outputRows.push({
        ...base,
        geocode_error: err?.message || 'geocode failed'
      });
      reportProgress();
    }
  }

  return outputRows;
}

function writeNdjson(filePath, rows) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const content = rows.map((row) => JSON.stringify(row)).join('\n');
  fs.writeFileSync(filePath, `${content}${rows.length > 0 ? '\n' : ''}`);
}

async function main() {
  const parsed = parseArgs(process.argv);
  if (parsed.help) {
    printHelp();
    return;
  }

  const scrapedRows = readNdjsonFromSpec(parsed.input, parsed.chain);
  const existingRows = parsed.existing ? readNdjsonFromSpec(parsed.existing, '') : [];
  const normalizeAddress = await createNormalizer({
    japaneseAddressesApi: parsed.japaneseAddressesApi
  });
  const startedAt = Date.now();
  let lastLoggedProcessed = 0;

  const rows = await buildGeocodedRows({
    chain: parsed.chain,
    scrapedRows,
    existingRows,
    geocodeEngine: parsed.geocodeEngine,
    engineVersion: parsed.engineVersion,
    nowIso: new Date().toISOString(),
    normalizeAddress,
    onProgress: (progress) => {
      const { processed, total } = progress;
      const shouldLog = processed === total || processed === 1 || processed - lastLoggedProcessed >= 100;
      if (!shouldLog) return;
      lastLoggedProcessed = processed;

      const pct = total > 0 ? ((processed / total) * 100).toFixed(1) : '100.0';
      const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
      console.log(
        `[progress] chain=${parsed.chain} ${processed}/${total} (${pct}%) elapsed=${elapsedSec}s cache=${progress.cache_hits} new=${progress.geocoded_new} errors=${progress.geocode_errors}`
      );
    }
  });

  writeNdjson(parsed.output, rows);
  console.log(`geocoded rows: ${rows.length} -> ${parsed.output}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  splitInputSpecs,
  resolveInputFiles,
  readNdjsonFile,
  pickLatestByStoreId,
  geocodeFieldsFromResult,
  buildAddressCache,
  buildGeocodedRows
};
