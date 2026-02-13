const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const {
  parsePrefArg: resolvePrefArg,
  hasPrefListArg,
  printPrefList
} = require('./pref_resolver');

const PREF_CODES = [
  '01','02','03','04','05','06','07',
  '08','09','10','11','12','13','14',
  '15','16','17','18','19','20','21',
  '22','23','24','25','26','27','28',
  '29','30','31','32','33','34','35',
  '36','37','38','39','40','41','42',
  '43','44','45','46','47'
];

const SOURCE_URL = 'https://www.e-map.ne.jp/p/lawson/';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
const DEFAULT_AREA_CONCURRENCY = 4;

function parsePrefArg() {
  return resolvePrefArg({
    allowedCodes: PREF_CODES,
    allowAll: true
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function gotoWithRetry(page, url, options = {}, maxAttempts = 4, baseDelay = 500) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000, ...options });
      return true;
    } catch (err) {
      lastErr = err;
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.warn(`goto failed (attempt ${attempt}/${maxAttempts}) url=${url} err=${err.message}`);
      await sleep(delay);
    }
  }
  console.error(`goto failed after retries url=${url} err=${lastErr?.message || 'unknown'}`);
  return false;
}

async function extractAreaUrlsFromPage(page) {
  return page.evaluate((sourceUrl) => {
    const out = new Set();
    const links = Array.from(document.querySelectorAll('a[href*="type=ShopA"][href*="area2="]'));
    for (const a of links) {
      const href = a.getAttribute('href');
      if (!href) continue;
      const abs = href.startsWith('http') ? href : `${sourceUrl}${href.replace(/^\//, '')}`;
      const normalized = abs
        .replace(/([?&])page=\d+&?/g, '$1')
        .replace(/[?&]$/, '');
      out.add(normalized);
    }
    return Array.from(out);
  }, SOURCE_URL);
}

async function extractMaxPageFromCurrentPage(page) {
  return page.evaluate(() => {
    let max = 0;
    const links = Array.from(document.querySelectorAll('a[href*="page="]'));
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/[?&]page=(\d+)/);
      if (!m) continue;
      const p = Number(m[1]);
      if (Number.isFinite(p) && p > max) max = p;
    }
    return max;
  });
}

async function extractStoresFromCurrentPage(page, listUrl) {
  return page.evaluate(({ sourceUrl, listUrlParam }) => {
    const stores = [];
    const cards = Array.from(document.querySelectorAll('a[href*="/dtl/"]'));
    for (const a of cards) {
      const href = a.getAttribute('href') || '';
      const idMatch = href.match(/\/dtl\/(\d+)\//);
      if (!idMatch) continue;
      const storeId = idMatch[1];
      const detailUrl = href.startsWith('http') ? href : `${sourceUrl}${href.replace(/^\//, '')}`;

      const box = a.querySelector('.facility-box') || a;
      const dt = box.querySelector('dt');
      const name = dt ? (dt.textContent || '').replace(/\s+/g, ' ').trim() : null;
      if (!name) continue;

      const lines = Array.from(box.querySelectorAll('ul.address-name li'))
        .map((li) => (li.textContent || '').replace(/\s+/g, ' ').trim());

      const addressRaw = lines[0] || null;
      const phoneLine = lines[1] || '';
      const phoneMatch = phoneLine.match(/\d{2,4}-\d{2,4}-\d{3,4}/);
      const phoneNumber = phoneMatch ? phoneMatch[0] : (phoneLine || null);
      const hoursText = lines[2] || null;

      stores.push({
        store_id: storeId,
        store_name: name,
        address_raw: addressRaw,
        phone_number: phoneNumber,
        hours_text: hoursText,
        detail_url: detailUrl,
        payload_json: {
          list_url: listUrlParam,
          detail_url: detailUrl
        }
      });
    }
    return stores;
  }, { sourceUrl: SOURCE_URL, listUrlParam: listUrl });
}

async function mapWithConcurrency(items, limit, mapper) {
  const result = new Array(items.length);
  let index = 0;

  async function worker() {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) break;
      result[current] = await mapper(items[current], current);
    }
  }

  const workers = [];
  const count = Math.max(1, Math.min(limit, items.length));
  for (let i = 0; i < count; i += 1) workers.push(worker());
  await Promise.all(workers);
  return result;
}

async function fetchStoresByArea(page, areaUrl) {
  const ok = await gotoWithRetry(page, areaUrl);
  if (!ok) return [];

  const all = [];
  all.push(...(await extractStoresFromCurrentPage(page, areaUrl)));

  const maxPage = await extractMaxPageFromCurrentPage(page);
  for (let pageNo = 2; pageNo <= maxPage; pageNo += 1) {
    const base = areaUrl
      .replace(/([?&])page=\d+&?/g, '$1')
      .replace(/[?&]$/, '');
    const sep = base.includes('?') ? '&' : '?';
    const pageUrl = `${base}${sep}page=${pageNo}`;
    const okPage = await gotoWithRetry(page, pageUrl);
    if (!okPage) continue;
    all.push(...(await extractStoresFromCurrentPage(page, pageUrl)));
  }

  return all;
}

async function main() {
  if (hasPrefListArg()) {
    printPrefList({ allowedCodes: PREF_CODES });
    return;
  }

  const outDir = path.join('data', 'lawson', 'ndjson');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: DEFAULT_USER_AGENT,
    locale: 'ja-JP'
  });
  await context.route('**/*', (route) => {
    const req = route.request();
    const url = req.url();
    const type = req.resourceType();
    if (url.includes('google-analytics.com') || url.includes('googletagmanager.com')) {
      return route.abort();
    }
    if (type === 'image' || type === 'font' || type === 'media') {
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();

  try {
    const onlyPref = parsePrefArg();
    const targets = onlyPref ? [onlyPref] : PREF_CODES;

    for (const pref of targets) {
      const baseUrl = `https://www.e-map.ne.jp/p/lawson/search.htm?type=ShopA&areaptn=1&area1=${pref}`;
      console.log(`pref ${pref}: area list`);
      const baseOk = await gotoWithRetry(page, baseUrl);
      if (!baseOk) {
        console.log(`${pref}: failed to load area list, skipping`);
        continue;
      }

      const areaUrls = await extractAreaUrlsFromPage(page);
      console.log(`pref ${pref}: areas ${areaUrls.length}`);
      const areaConcurrency = Math.max(
        1,
        Number.parseInt(process.env.LAWSON_AREA_CONCURRENCY || `${DEFAULT_AREA_CONCURRENCY}`, 10) || DEFAULT_AREA_CONCURRENCY
      );
      console.log(`pref ${pref}: area concurrency ${areaConcurrency}`);

      const scrapedAt = new Date().toISOString();
      const byStoreId = new Map();
      let done = 0;

      const storesByArea = await mapWithConcurrency(areaUrls, areaConcurrency, async (areaUrl, idx) => {
        const workerPage = await context.newPage();
        try {
          const stores = await fetchStoresByArea(workerPage, areaUrl);
          done += 1;
          console.log(`pref ${pref}: area ${done}/${areaUrls.length} (idx=${idx + 1}) stores=${stores.length}`);
          return stores;
        } finally {
          await workerPage.close();
        }
      });

      for (const stores of storesByArea) {
        for (const store of stores || []) {
          if (!byStoreId.has(store.store_id)) {
            byStoreId.set(store.store_id, store);
          }
        }
      }

      const lines = Array.from(byStoreId.values()).map((s) => JSON.stringify({
        store_id: s.store_id || null,
        store_name: s.store_name || null,
        address_raw: s.address_raw || null,
        phone_number: s.phone_number || null,
        hours_text: s.hours_text || null,
        source_url: SOURCE_URL,
        detail_url: s.detail_url || null,
        scraped_at: scrapedAt,
        payload_json: s.payload_json
      }));

      const outPath = path.join(outDir, `stores_lawson_pref_${pref}.ndjson`);
      if (lines.length > 0) {
        fs.writeFileSync(outPath, `${lines.join('\n')}\n`);
        console.log(`${pref}: ${lines.length} -> ${outPath}`);
      } else {
        console.log(`${pref}: 0 stores found, skipping file creation`);
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
