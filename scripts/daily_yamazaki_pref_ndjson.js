const fs = require('fs');
const path = require('path');
const {
  parsePrefArg: resolvePrefArg,
  hasPrefListArg,
  printPrefList
} = require('./pref_resolver');

const PREF_CODES = [
  '01', '02', '03', '04', '05', '06', '07',
  '08', '09', '10', '11', '12', '13', '14',
  '15', '16', '17', '18', '19', '20', '21',
  '22', '23', '24', '25', '26', '27', '28',
  '29', '30', '31', '32', '33', '34', '35',
  '36', '37', '38', '39', '40', '41', '42',
  '43', '44', '45', '46', '47'
];

const SOURCE_URL = 'https://www.areamarker.com/daily-yamazaki/map';
const SEARCH_URL = 'https://ss-api.areamarker.com/v1/search-by-condition';
const CORP_ID = 'daily-yamazaki';

function parsePrefArg() {
  return resolvePrefArg({
    allowedCodes: PREF_CODES,
    allowJapanese: false,
    allowNumeric: false,
    allowAll: true
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildHoursText(fields) {
  const slots = [
    fields.b_mon || null,
    fields.b_tue || null,
    fields.b_wed || null,
    fields.b_thu || null,
    fields.b_fri || null,
    fields.b_sat || null,
    fields.b_sun || null
  ].filter(Boolean);
  if (slots.length === 0) return null;
  const uniq = Array.from(new Set(slots));
  if (uniq.length === 1) return uniq[0];
  return null;
}

async function postJsonWithRetry(url, body, maxAttempts = 4, baseDelay = 500) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          referer: SOURCE_URL,
          'x-amss-shopsite-corp-id': CORP_ID
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.warn(`post failed (attempt ${attempt}/${maxAttempts}) err=${err.message}`);
      await sleep(delay);
    }
  }
  throw new Error(`post failed after retries err=${lastErr?.message || 'unknown'}`);
}

async function fetchPrefHits(prefCode) {
  const fields = [
    'kyo_id',
    'name',
    'addr_1',
    'zip_code',
    'tel_1',
    'pre_code',
    'city_code',
    'b_mon',
    'b_tue',
    'b_wed',
    'b_thu',
    'b_fri',
    'b_sat',
    'b_sun',
    'col_16',
    'col_17',
    'col_18'
  ];

  const hits = [];
  let searchAfter = null;

  for (let pageNo = 1; pageNo <= 200; pageNo += 1) {
    const body = {
      paging_mode: 'search_after',
      sort: '+kyo_id',
      size: 200,
      corp_id: CORP_ID,
      fields,
      search_conditions: [
        { field: 'pre_code', value: prefCode, comparison_operator: '=' }
      ]
    };
    if (searchAfter) body.search_after = searchAfter;

    const data = await postJsonWithRetry(SEARCH_URL, body);
    const pageHits = data?.result?.hits?.hit || [];
    const next = data?.result?.hits?.search_after || null;
    const found = data?.result?.hits?.found ?? null;
    console.log(`pref ${prefCode}: page ${pageNo} hits=${pageHits.length} total=${found ?? 'unknown'}`);

    hits.push(...pageHits);
    if (!pageHits.length || !next || (searchAfter && next[0] === searchAfter[0])) break;
    searchAfter = next;
    await sleep(200);
  }

  return hits;
}

async function main() {
  if (hasPrefListArg()) {
    printPrefList({ allowedCodes: PREF_CODES });
    return;
  }

  const outDir = path.join('data', 'daily_yamazaki', 'ndjson');
  fs.mkdirSync(outDir, { recursive: true });

  let aborted = false;
  process.on('SIGINT', () => {
    aborted = true;
    console.error('SIGINT: stopping after current prefecture...');
  });

  const onlyPref = parsePrefArg();
  const targets = onlyPref ? [onlyPref] : PREF_CODES;

  for (const pref of targets) {
    if (aborted) break;
    console.log(`pref ${pref}: start`);
    const scrapedAt = new Date().toISOString();
    const hits = await fetchPrefHits(pref);
    const lines = [];

    for (const h of hits) {
      const f = h.fields || {};
      lines.push(JSON.stringify({
        store_id: f.kyo_id || null,
        store_name: f.name || null,
        address_raw: f.addr_1 || null,
        postal_code: f.zip_code || null,
        phone_number: f.tel_1 || null,
        source_url: SOURCE_URL,
        scraped_at: scrapedAt,
        hours_text: buildHoursText(f),
        hours_mon: f.b_mon || null,
        hours_tue: f.b_tue || null,
        hours_wed: f.b_wed || null,
        hours_thu: f.b_thu || null,
        hours_fri: f.b_fri || null,
        hours_sat: f.b_sat || null,
        hours_sun: f.b_sun || null,
        hours_notice: f.col_16 || null,
        hours_note: f.col_17 || null,
        business_day_note: f.col_18 || null,
        payload_json: h
      }));
    }

    if (lines.length === 0) {
      console.log(`${pref}: 0 stores found, skipping file creation`);
      continue;
    }

    const outPath = path.join(outDir, `stores_daily_yamazaki_pref_${pref}.ndjson`);
    fs.writeFileSync(outPath, `${lines.join('\n')}\n`);
    console.log(`${pref}: ${lines.length} -> ${outPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
