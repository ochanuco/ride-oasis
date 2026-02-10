const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PREF_CODES = [
  '01','02','03','04','05','06','07',
  '08','09','10','11','12','13','14',
  '15','16','17','18','19','20','21',
  '22','23','24','25','26','27','28',
  '29','30','31','32','33','34','35',
  '36','37','38','39','40','41','42',
  '43','44','45','46','47'
];

function parsePrefArg() {
  const idx = process.argv.indexOf('--pref');
  if (idx === -1) return null;
  const val = process.argv[idx + 1];
  if (!val) return null;
  const norm = String(val).padStart(2, '0');
  if (!/^(0[1-9]|[1-3][0-9]|4[0-7])$/.test(norm)) {
    throw new Error(`invalid pref code: ${val}`);
  }
  return norm;
}

function jstNowKey() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = jst.getUTCFullYear();
  const mm = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(jst.getUTCDate()).padStart(2, '0');
  const hh = String(jst.getUTCHours()).padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureHeaders(page) {
  let captured = null;
  page.on('request', (req) => {
    if (req.url().includes('/v1/search-by-condition')) {
      captured = req.headers();
    }
  });

  await page.goto('https://seven-eleven.areamarker.com/711map/top', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.locator('input#input').fill('大阪東野田町４丁目');
  await page.locator('input#input').press('Enter');
  await page.waitForTimeout(3000);

  if (!captured) {
    throw new Error('failed to capture headers');
  }

  const headers = {
    'content-type': 'application/json',
    origin: 'https://seven-eleven.areamarker.com',
    referer: 'https://seven-eleven.areamarker.com/711map/top'
  };
  for (const [k, v] of Object.entries(captured)) {
    const key = k.toLowerCase();
    if (['x-api-key', 'authorization', 'x-amz-security-token'].includes(key)) {
      headers[key] = v;
    }
  }
  return headers;
}

async function fetchPref(page, headers, prefCode) {
  const nowKey = jstNowKey();
  const fields = ['kyo_id', 'name', 'addr_1', 'zip_code', 'col_5', 'pre_code', 'city_code'];
  const searchConditions = [
    { field: 'pre_code', value: prefCode, comparison_operator: '=' },
    { field: 'col_2', value: nowKey, comparison_operator: '<=' },
    { field: 'col_10', value: '1', comparison_operator: '=' },
    {
      conditions: [
        { field: 'col_2', value: '1', comparison_operator: 'prefix' },
        { field: 'col_2', value: '2', comparison_operator: 'prefix', logical_operator: 'OR' }
      ]
    }
  ];

  const hits = [];
  let searchAfter = null;

  for (let i = 0; i < 200; i++) {
    const body = {
      paging_mode: 'search_after',
      sort: '+kyo_id',
      size: 200,
      fields,
      search_conditions: searchConditions,
      corp_id: '711map'
    };
    if (searchAfter) body.search_after = searchAfter;

    const res = await page.request.post('https://seven-eleven-ss-api.areamarker.com/v1/search-by-condition', {
      headers,
      data: body
    });

    if (!res.ok()) {
      throw new Error(`HTTP ${res.status()} for pref ${prefCode}`);
    }

    const data = await res.json();
    const hit = data?.result?.hits?.hit || [];
    const next = data?.result?.hits?.search_after || null;

    hits.push(...hit);
    if (!hit.length || !next || (searchAfter && next[0] === searchAfter[0])) break;
    searchAfter = next;
    await sleep(300);
  }

  return hits;
}

async function main() {
  const outDir = path.join('data', '7eleven', 'ndjson');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'ja-JP'
  });

  const headers = await captureHeaders(page);
  const scrapedAt = new Date().toISOString();
  const sourceUrl = 'https://seven-eleven.areamarker.com/711map/top';

  const onlyPref = parsePrefArg();
  const targets = onlyPref ? [onlyPref] : PREF_CODES;

  for (const pref of targets) {
    const hits = await fetchPref(page, headers, pref);
    const outPath = path.join(outDir, `stores_7eleven_pref_${pref}.ndjson`);
    const lines = hits.map((h) => {
      const f = h.fields || {};
      return JSON.stringify({
        store_id: f.kyo_id || null,
        store_name: f.name || null,
        address_raw: f.addr_1 || null,
        postal_code: f.zip_code || null,
        source_url: sourceUrl,
        scraped_at: scrapedAt,
        payload_json: h
      });
    });
    fs.writeFileSync(outPath, lines.join('\n') + (lines.length ? '\n' : ''));
    console.log(`${pref}: ${lines.length} -> ${outPath}`);
    await sleep(500);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
