const fs = require('fs');
const path = require('path');
const {
  parsePrefArg: resolvePrefArg,
  hasPrefListArg,
  printPrefList
} = require('./pref_resolver');

const PREF_CODES = [
  '10', '11', '12', '13', '14', '15', '16',
  '17', '18', '19', '20', '21', '22', '23',
  '24', '25', '26', '27', '28', '29', '30',
  '31', '32', '33', '34', '35', '36', '37',
  '38', '39', '40', '41', '42', '43', '44',
  '45', '46', '47', '48', '49', '50', '51',
  '52', '53', '54', '55', '56'
];

const SOURCE_URL = 'https://www.michi-no-eki.jp/search';
const SEARCH_BASE_URL = 'https://www.michi-no-eki.jp/stations/search';
const FETCH_TIMEOUT_MS = 30000;
const DEFAULT_HEADERS = {
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  'accept-language': 'ja-JP,ja;q=0.9'
};

function parsePrefArg() {
  return resolvePrefArg({
    allowedCodes: PREF_CODES,
    fromStandardCode: (code) => String(Number(code) + 9).padStart(2, '0'),
    allowAll: true
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripHtml(value) {
  if (!value) return null;
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim() || null;
}

function extractPostalAndAddress(locationText) {
  if (!locationText) {
    return { postalCode: null, addressRaw: null };
  }

  let work = locationText.replace(/\s+/g, ' ').trim();
  let postalCode = null;
  const m = work.match(/(?:〒\s*)?(\d{3})-?(\d{4})/);
  if (m) {
    postalCode = `${m[1]}-${m[2]}`;
    work = work.replace(m[0], '').trim();
  }
  work = work.replace(/^[,，\s]+/, '').trim();
  return { postalCode, addressRaw: work || null };
}

async function fetchTextWithRetry(url, maxAttempts = 4, baseDelay = 500) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: DEFAULT_HEADERS,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.text();
    } catch (err) {
      lastErr = err;
      console.warn(`fetch failed (attempt ${attempt}/${maxAttempts}) url=${url} err=${err.message}`);
      if (attempt < maxAttempts) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
  }
  throw new Error(`fetch failed after retries url=${url} err=${lastErr?.message || 'unknown'}`);
}

function extractMaxPageIndex(html) {
  const blockMatch = html.match(/<div class="pagination">[\s\S]*?<\/div>\s*<\/div>/i);
  const block = blockMatch ? blockMatch[0] : html;
  const pageMatches = Array.from(block.matchAll(/[?&]page=(\d+)/g));
  if (pageMatches.length === 0) return 0;
  let max = 0;
  for (const m of pageMatches) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

function extractDetailUrlsFromSearchPage(html) {
  const urls = new Set();
  const matches = html.matchAll(/href="(\/stations\/views\/\d+)"/g);
  for (const m of matches) {
    urls.add(`https://www.michi-no-eki.jp${m[1]}`);
  }
  return Array.from(urls);
}

function extractDetailFields(html) {
  const out = {};
  const infoMatch = html.match(/<div class="info">([\s\S]*?)<\/div>\s*<\/div>/i);
  const infoBlock = infoMatch ? infoMatch[1] : html;
  const dlMatches = infoBlock.matchAll(/<dl>([\s\S]*?)<\/dl>/g);
  for (const dl of dlMatches) {
    const block = dl[1];
    const dt = stripHtml((block.match(/<dt>([\s\S]*?)<\/dt>/i) || [])[1] || '');
    const dd = stripHtml((block.match(/<dd>([\s\S]*?)<\/dd>/i) || [])[1] || '');
    if (dt) out[dt] = dd;
  }
  return out;
}

function extractStoreName(html, fields) {
  if (fields['道の駅名']) return fields['道の駅名'];
  const h2 = stripHtml((html.match(/<h2>([\s\S]*?)<\/h2>/i) || [])[1] || '');
  return h2 || null;
}

function extractStoreId(detailUrl) {
  const m = detailUrl.match(/\/stations\/views\/(\d+)/);
  return m ? m[1] : null;
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

async function collectDetailUrlsByPref(prefCode) {
  const base = `${SEARCH_BASE_URL}/${prefCode}/all/all`;
  const firstHtml = await fetchTextWithRetry(base);
  const maxPageIndex = extractMaxPageIndex(firstHtml);
  const urls = new Set(extractDetailUrlsFromSearchPage(firstHtml));
  console.log(`pref ${prefCode}: search pages ${maxPageIndex + 1}`);

  for (let pageNo = 2; pageNo <= maxPageIndex + 1; pageNo += 1) {
    const pageUrl = `${base}?page=${pageNo}`;
    const html = await fetchTextWithRetry(pageUrl);
    const pageUrls = extractDetailUrlsFromSearchPage(html);
    for (const u of pageUrls) urls.add(u);
    console.log(`pref ${prefCode}: page ${pageNo}/${maxPageIndex + 1} links=${pageUrls.length}`);
    await sleep(120);
  }

  return Array.from(urls);
}

async function fetchStoreRecord(detailUrl, prefCode, scrapedAt) {
  const html = await fetchTextWithRetry(detailUrl);
  const fields = extractDetailFields(html);
  const location = fields['所在地'] || null;
  const tel = fields['TEL'] || null;
  const hours = fields['営業時間'] || null;
  const storeName = extractStoreName(html, fields);
  const { postalCode, addressRaw } = extractPostalAndAddress(location);

  return {
    store_id: extractStoreId(detailUrl),
    store_name: storeName,
    address_raw: addressRaw,
    postal_code: postalCode,
    phone_number: tel,
    source_url: SOURCE_URL,
    detail_url: detailUrl,
    scraped_at: scrapedAt,
    hours_text: hours,
    payload_json: {
      pref_code: prefCode,
      location_raw: location,
      fields
    }
  };
}

async function main() {
  if (hasPrefListArg()) {
    printPrefList({
      allowedCodes: PREF_CODES,
      toStandardCode: (code) => String(Number(code) - 9).padStart(2, '0')
    });
    return;
  }

  const outDir = path.join('data', 'michi_no_eki', 'ndjson');
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
    console.log(`pref ${pref}: collect detail links`);
    const detailUrls = await collectDetailUrlsByPref(pref);
    console.log(`pref ${pref}: details ${detailUrls.length}`);
    if (detailUrls.length === 0) {
      console.log(`${pref}: 0 stores found, skipping file creation`);
      continue;
    }

    const scrapedAt = new Date().toISOString();
    const records = await mapWithConcurrency(detailUrls, 5, async (detailUrl, idx) => {
      if (idx % 25 === 0 || idx === detailUrls.length - 1) {
        console.log(`pref ${pref}: detail ${idx + 1}/${detailUrls.length}`);
      }
      return await fetchStoreRecord(detailUrl, pref, scrapedAt);
    });

    const dedup = new Map();
    for (const rec of records) {
      if (rec?.store_id && !dedup.has(rec.store_id)) {
        dedup.set(rec.store_id, rec);
      }
    }

    const lines = Array.from(dedup.values()).map((r) => JSON.stringify(r));
    const outPath = path.join(outDir, `stores_michi_no_eki_pref_${pref}.ndjson`);
    fs.writeFileSync(outPath, `${lines.join('\n')}\n`);
    console.log(`${pref}: ${lines.length} -> ${outPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
