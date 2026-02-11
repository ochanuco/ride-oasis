const fs = require('fs');
const path = require('path');

const PREF_CODE_TO_NAME = {
  '01': '北海道',
  '02': '青森県',
  '03': '岩手県',
  '04': '宮城県',
  '05': '秋田県',
  '06': '山形県',
  '07': '福島県',
  '08': '茨城県',
  '09': '栃木県',
  '10': '群馬県',
  '11': '埼玉県',
  '12': '千葉県',
  '13': '東京都',
  '14': '神奈川県',
  '15': '新潟県',
  '16': '富山県',
  '17': '石川県',
  '18': '福井県',
  '19': '山梨県',
  '20': '長野県',
  '21': '岐阜県',
  '22': '静岡県',
  '23': '愛知県',
  '24': '三重県',
  '25': '滋賀県',
  '26': '京都府',
  '27': '大阪府',
  '28': '兵庫県',
  '29': '奈良県',
  '30': '和歌山県',
  '31': '鳥取県',
  '32': '島根県',
  '33': '岡山県',
  '34': '広島県',
  '35': '山口県',
  '36': '徳島県',
  '37': '香川県',
  '38': '愛媛県',
  '39': '高知県',
  '40': '福岡県',
  '41': '佐賀県',
  '42': '長崎県',
  '43': '熊本県',
  '44': '大分県',
  '45': '宮崎県',
  '46': '鹿児島県',
  '47': '沖縄県'
};

const PREF_CODES = Object.keys(PREF_CODE_TO_NAME);
const SOURCE_URL = 'https://map.ministop.co.jp/';

function parsePrefArg() {
  const idx = process.argv.indexOf('--pref');
  if (idx === -1) return null;
  const val = process.argv[idx + 1];
  if (!val) return null;
  const norm = String(val).padStart(2, '0');
  if (!PREF_CODES.includes(norm)) {
    throw new Error(`invalid pref code: ${val}`);
  }
  return norm;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTextWithRetry(url, maxAttempts = 4, baseDelay = 400) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
          'accept-language': 'ja-JP,ja;q=0.9'
        },
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.text();
    } catch (err) {
      lastErr = err;
      console.warn(`fetch failed (attempt ${attempt}/${maxAttempts}) url=${url} err=${err.message}`);
      if (attempt < maxAttempts) {
        await sleep(baseDelay * Math.pow(2, attempt - 1));
      }
    }
  }
  throw new Error(`fetch failed after retries url=${url} err=${lastErr?.message || 'unknown'}`);
}

function extractBuildId(topHtml) {
  const m = topHtml.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) {
    throw new Error('failed to parse __NEXT_DATA__');
  }
  const nextData = JSON.parse(m[1]);
  const buildId = nextData?.buildId || null;
  if (!buildId) {
    throw new Error('buildId is missing');
  }
  return buildId;
}

function normalizeHm(timeStr) {
  if (!timeStr) return null;
  const m = String(timeStr).match(/^(\d{2}):(\d{2})/);
  if (!m) return null;
  return `${m[1]}:${m[2]}`;
}

function buildHoursMap(businessHours) {
  const out = {
    hours_mon: null,
    hours_tue: null,
    hours_wed: null,
    hours_thu: null,
    hours_fri: null,
    hours_sat: null,
    hours_sun: null
  };
  if (!Array.isArray(businessHours)) return out;

  const dayToField = {
    MONDAY: 'hours_mon',
    TUESDAY: 'hours_tue',
    WEDNESDAY: 'hours_wed',
    THURSDAY: 'hours_thu',
    FRIDAY: 'hours_fri',
    SATURDAY: 'hours_sat',
    SUNDAY: 'hours_sun'
  };
  for (const row of businessHours) {
    const key = dayToField[row?.name || ''];
    if (!key) continue;
    const open = normalizeHm(row?.openTime);
    const close = normalizeHm(row?.closeTime);
    if (!open || !close) continue;
    out[key] = `${open}～${close}`;
  }
  return out;
}

function buildHoursText(hoursMap) {
  const vals = [
    hoursMap.hours_mon,
    hoursMap.hours_tue,
    hoursMap.hours_wed,
    hoursMap.hours_thu,
    hoursMap.hours_fri,
    hoursMap.hours_sat,
    hoursMap.hours_sun
  ].filter(Boolean);
  if (vals.length === 0) return null;
  const uniq = Array.from(new Set(vals));
  if (uniq.length === 1 && vals.length === 7) return uniq[0];
  return `月:${hoursMap.hours_mon || '-'} 火:${hoursMap.hours_tue || '-'} 水:${hoursMap.hours_wed || '-'} 木:${hoursMap.hours_thu || '-'} 金:${hoursMap.hours_fri || '-'} 土:${hoursMap.hours_sat || '-'} 日:${hoursMap.hours_sun || '-'}`;
}

function storeToRecord(store, scrapedAt) {
  const hoursMap = buildHoursMap(store.businessHours);
  return {
    store_id: store.storeCode ? String(store.storeCode) : (store.storeId ? String(store.storeId) : null),
    store_name: store.nameKanji || null,
    address_raw: store.address || null,
    postal_code: store.postalCode || null,
    phone_number: store.phoneNumber || null,
    source_url: SOURCE_URL,
    scraped_at: scrapedAt,
    hours_text: buildHoursText(hoursMap),
    hours_mon: hoursMap.hours_mon,
    hours_tue: hoursMap.hours_tue,
    hours_wed: hoursMap.hours_wed,
    hours_thu: hoursMap.hours_thu,
    hours_fri: hoursMap.hours_fri,
    hours_sat: hoursMap.hours_sat,
    hours_sun: hoursMap.hours_sun,
    payload_json: store
  };
}

function filterByPref(shops, prefCode) {
  const prefName = PREF_CODE_TO_NAME[prefCode];
  return shops.filter((s) => {
    const address = s?.address || '';
    return typeof address === 'string' && address.startsWith(prefName);
  });
}

async function fetchAllShops() {
  const topHtml = await fetchTextWithRetry(SOURCE_URL);
  const buildId = extractBuildId(topHtml);
  const dataUrl = `https://map.ministop.co.jp/_next/data/${buildId}/map.json`;
  const text = await fetchTextWithRetry(dataUrl);
  const data = JSON.parse(text);
  const shops = data?.pageProps?.allShopsData?.shops || [];
  if (!Array.isArray(shops)) {
    throw new Error('shops is not an array');
  }
  console.log(`shops total: ${shops.length}`);
  return shops;
}

async function main() {
  const outDir = path.join('data', 'ministop', 'ndjson');
  fs.mkdirSync(outDir, { recursive: true });

  const onlyPref = parsePrefArg();
  const targets = onlyPref ? [onlyPref] : PREF_CODES;
  const shops = await fetchAllShops();

  for (const pref of targets) {
    const prefName = PREF_CODE_TO_NAME[pref];
    console.log(`pref ${pref}: ${prefName}`);
    const filtered = filterByPref(shops, pref);
    if (filtered.length === 0) {
      console.log(`${pref}: 0 stores found, skipping file creation`);
      continue;
    }

    const scrapedAt = new Date().toISOString();
    const lines = filtered.map((s) => JSON.stringify(storeToRecord(s, scrapedAt)));
    const outPath = path.join(outDir, `stores_ministop_pref_${pref}.ndjson`);
    fs.writeFileSync(outPath, `${lines.join('\n')}\n`);
    console.log(`${pref}: ${lines.length} -> ${outPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
