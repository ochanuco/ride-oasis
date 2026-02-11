const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const {
  parsePrefArg: resolvePrefArg,
  hasPrefListArg,
  printPrefList
} = require('./pref_resolver');

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

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
  return resolvePrefArg({
    allowedCodes: PREF_CODES,
    allowAll: true
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripHtml(value) {
  if (!value) return null;
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

async function gotoWithRetry(page, url, options = {}, maxAttempts = 4, baseDelay = 500) {
  let lastErr = null;
  const merged = { waitUntil: 'domcontentloaded', timeout: 45000, ...options };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await page.goto(url, merged);
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

async function fetchTextWithRetry(request, url, options = {}, maxAttempts = 4, baseDelay = 300) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await request.get(url, options);
      if (!res.ok()) {
        const status = res.status();
        if (status === 429 || status >= 500) {
          throw new Error(`HTTP ${status}`);
        }
        return null;
      }
      return await res.text();
    } catch (err) {
      lastErr = err;
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.warn(`request failed (attempt ${attempt}/${maxAttempts}) url=${url} err=${err.message}`);
      await sleep(delay);
    }
  }
  console.error(`request failed after retries url=${url} err=${lastErr?.message || 'unknown'}`);
  return null;
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

function normalizeDetailUrl(href) {
  if (!href) return null;
  if (href.startsWith('http')) return href;
  return `https://as.chizumaru.com${href}`;
}

function extractBid(detailUrl) {
  if (!detailUrl) return null;
  try {
    const u = new URL(detailUrl);
    return u.searchParams.get('bid');
  } catch {
    return null;
  }
}

async function fetchHoursText(page, detailUrl) {
  if (!detailUrl) return null;
  const html = await fetchTextWithRetry(page.request, detailUrl, {
    headers: {
      referer: 'https://as.chizumaru.com/famima/top?account=famima&accmd=0'
    },
    timeout: 30000
  });
  if (!html) return null;

  const m = html.match(/<th[^>]*>\s*営業時間\s*<\/th>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i);
  return stripHtml(m ? m[1] : null);
}

async function fetchArticleListUrls(page, prefCode) {
  const url = `https://as.chizumaru.com/famima/articleAddressList?account=famima&accmd=0&ftop=1&adr=${prefCode}&c2=1%2C2`;
  const ok = await gotoWithRetry(page, url, { waitUntil: 'networkidle', timeout: 60000 });
  if (!ok) return [];

  const hrefs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a'))
      .map((a) => a.href)
      .filter((h) => h && h.includes('/famima/articleList'));
  });

  return Array.from(new Set(hrefs));
}

async function fetchStoresFromArticleList(page, listUrl) {
  const ok = await gotoWithRetry(page, listUrl, { waitUntil: 'networkidle', timeout: 60000 });
  if (!ok) return [];

  const rows = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/famima/detailMap"]'));
    return links.map((a) => {
      const name = (a.textContent || '').trim();
      const href = a.href;
      let address = null;
      const table = a.closest('table');
      if (table) {
        const ths = Array.from(table.querySelectorAll('th'));
        const addrTh = ths.find((th) => (th.textContent || '').trim() === '住所');
        if (addrTh) {
          const td = addrTh.nextElementSibling;
          address = td ? (td.textContent || '').replace(/\u00a0/g, ' ').trim() : null;
        }
      }
      return { name, href, address };
    });
  });

  const byBid = new Map();
  for (const row of rows) {
    const detailUrl = normalizeDetailUrl(row.href);
    const bid = extractBid(detailUrl);
    if (!bid) continue;
    if (!byBid.has(bid)) {
      byBid.set(bid, {
        store_id: bid,
        store_name: row.name || null,
        address_raw: row.address || null,
        detail_url: detailUrl,
        hours_text: null
      });
    }
  }

  const stores = Array.from(byBid.values());
  await mapWithConcurrency(stores, 3, async (store) => {
    store.hours_text = await fetchHoursText(page, store.detail_url);
    return store;
  });
  return stores;
}

async function main() {
  if (hasPrefListArg()) {
    printPrefList({ allowedCodes: PREF_CODES });
    return;
  }

  const outDir = path.join('data', 'familymart', 'ndjson');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent: DEFAULT_USER_AGENT,
    locale: 'ja-JP'
  });
  await page.setExtraHTTPHeaders({
    referer: 'https://as.chizumaru.com/famima/top?account=famima&accmd=0'
  });
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.includes('google-analytics.com') || url.includes('googletagmanager.com')) {
      return route.abort();
    }
    return route.continue();
  });

  let aborted = false;
  process.on('SIGINT', () => {
    aborted = true;
    console.error('SIGINT: stopping after current item...');
  });

  const sourceUrl = 'https://as.chizumaru.com/famima/top?account=famima&accmd=0';

  try {
    const onlyPref = parsePrefArg();
    const targets = onlyPref ? [onlyPref] : PREF_CODES;

    for (const pref of targets) {
      if (aborted) break;
      console.log(`pref ${pref}: address list`);
      const listUrls = await fetchArticleListUrls(page, pref);
      const lines = [];
      const scrapedAt = new Date().toISOString();
      let idx = 0;

      for (const listUrl of listUrls) {
        if (aborted) break;
        idx += 1;
        console.log(`pref ${pref}: list ${idx}/${listUrls.length}`);
        const stores = await fetchStoresFromArticleList(page, listUrl);
        for (const s of stores) {
          lines.push(JSON.stringify({
            store_id: s.store_id || null,
            store_name: s.store_name || null,
            address_raw: s.address_raw || null,
            source_url: sourceUrl,
            detail_url: s.detail_url || null,
            scraped_at: scrapedAt,
            hours_text: s.hours_text || null,
            payload_json: {
              list_url: listUrl,
              detail_url: s.detail_url || null,
              hours_text: s.hours_text || null
            }
          }));
        }
      }

      const outPath = path.join(outDir, `stores_familymart_pref_${pref}.ndjson`);
      if (lines.length > 0) {
        fs.writeFileSync(outPath, `${lines.join('\n')}\n`);
        console.log(`${pref}: ${lines.length} -> ${outPath}`);
      } else {
        console.log(`${pref}: 0 stores found, skipping file creation`);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
