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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function gotoWithRetry(page, url, options, maxAttempts = 4, baseDelay = 500) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await page.goto(url, options);
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
  const ok = await gotoWithRetry(page, detailUrl, { waitUntil: 'networkidle', timeout: 60000 });
  if (!ok) return null;

  const hours = await page.evaluate(() => {
    const th = Array.from(document.querySelectorAll('th'))
      .find((el) => (el.textContent || '').trim().includes('営業時間'));
    if (!th) return null;
    const td = th.nextElementSibling;
    const text = td ? (td.textContent || '').replace(/\u00a0/g, ' ').trim() : null;
    return text || null;
  });
  return hours;
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
  for (const store of stores) {
    store.hours_text = await fetchHoursText(page, store.detail_url);
  }
  return stores;
}

async function main() {
  const outDir = path.join('data', 'famima', 'ndjson');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'ja-JP'
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

      const outPath = path.join(outDir, `stores_famima_pref_${pref}.ndjson`);
      fs.writeFileSync(outPath, lines.join('\n') + (lines.length ? '\n' : ''));
      console.log(`${pref}: ${lines.length} -> ${outPath}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
