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

async function captureHeaders(page, prefCode) {
  let captured = null;
  page.on('request', (req) => {
    if (req.url().includes('/v1/search-by-condition')) {
      captured = req.headers();
    }
  });

  const requestPromise = page.waitForRequest((req) =>
    req.url().includes('/v1/search-by-condition')
  );
  await page.goto(`https://seven-eleven.areamarker.com/711map/arealist/${prefCode}`, {
    waitUntil: 'networkidle'
  });
  await requestPromise;

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

async function fetchPref(page, headers, prefCode, fields) {
  const nowKey = jstNowKey();
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

  let aborted = false;
  process.on('SIGINT', () => {
    aborted = true;
    console.error('SIGINT: stopping after current item...');
  });

  try {
    const onlyPref = parsePrefArg();
    const targets = onlyPref ? [onlyPref] : PREF_CODES;
    const headerPref = targets[0] || '01';
    const headers = await captureHeaders(page, headerPref);
    const scrapedAt = new Date().toISOString();
    const sourceUrl = 'https://seven-eleven.areamarker.com/711map/top';
    const svcRes = await page.request.get('https://seven-eleven.areamarker.com/711map/data/serviceCol.json');
    const svc = await svcRes.json();
    const serviceMap = new Map(svc.map((s) => [s.id, s.name]));
    const baseFields = ['kyo_id', 'name', 'addr_1', 'zip_code', 'col_5', 'pre_code', 'city_code'];
    const detailFields = [
      'col_16',  // 24時間営業
      'col_79',  // 月曜営業開始
      'col_80',  // 月曜営業終了
      'col_82',  // 火曜営業開始
      'col_83',  // 火曜営業終了
      'col_85',  // 水曜営業開始
      'col_86',  // 水曜営業終了
      'col_88',  // 木曜営業開始
      'col_89',  // 木曜営業終了
      'col_91',  // 金曜営業開始
      'col_92',  // 金曜営業終了
      'col_94',  // 土曜営業開始
      'col_95',  // 土曜営業終了
      'col_97',  // 日曜営業開始
      'col_98',  // 日曜営業終了
      'col_100', // 祝日営業開始
      'col_101'  // 祝日営業終了
    ];
    const serviceFields = svc.map((s) => s.id);
    const fields = Array.from(new Set([...baseFields, ...detailFields, ...serviceFields]));

    for (const pref of targets) {
      if (aborted) break;
      const hits = await fetchPref(page, headers, pref, fields);
      const outPath = path.join(outDir, `stores_7eleven_pref_${pref}.ndjson`);
      const lines = [];
      const total = hits.length;
      let idx = 0;
      for (const h of hits) {
        idx += 1;
        console.log(`${pref}: detail ${idx}/${total}`);
        if (aborted) break;
        const f = h.fields || {};
        let hours24 = null;
        let hoursMonStart = null;
        let hoursMonEnd = null;
        let hoursTueStart = null;
        let hoursTueEnd = null;
        let hoursWedStart = null;
        let hoursWedEnd = null;
        let hoursThuStart = null;
        let hoursThuEnd = null;
        let hoursFriStart = null;
        let hoursFriEnd = null;
        let hoursSatStart = null;
        let hoursSatEnd = null;
        let hoursSunStart = null;
        let hoursSunEnd = null;
        let hoursHolidayStart = null;
        let hoursHolidayEnd = null;
        let services = null;

        hours24 = f.col_16 === '1' ? true : false;
        hoursMonStart = f.col_79 || null;
        hoursMonEnd = f.col_80 || null;
        hoursTueStart = f.col_82 || null;
        hoursTueEnd = f.col_83 || null;
        hoursWedStart = f.col_85 || null;
        hoursWedEnd = f.col_86 || null;
        hoursThuStart = f.col_88 || null;
        hoursThuEnd = f.col_89 || null;
        hoursFriStart = f.col_91 || null;
        hoursFriEnd = f.col_92 || null;
        hoursSatStart = f.col_94 || null;
        hoursSatEnd = f.col_95 || null;
        hoursSunStart = f.col_97 || null;
        hoursSunEnd = f.col_98 || null;
        hoursHolidayStart = f.col_100 || null;
        hoursHolidayEnd = f.col_101 || null;
        if (!hours24 && !hoursMonStart && !hoursMonEnd && !hoursHolidayStart && !hoursHolidayEnd) {
          console.log(
            `hours missing kyo_id=${f.kyo_id || ''} col_16=${f.col_16 || ''} ` +
            `col_79=${f.col_79 || ''} col_80=${f.col_80 || ''} ` +
            `col_82=${f.col_82 || ''} col_83=${f.col_83 || ''} ` +
            `col_85=${f.col_85 || ''} col_86=${f.col_86 || ''} ` +
            `col_88=${f.col_88 || ''} col_89=${f.col_89 || ''} ` +
            `col_91=${f.col_91 || ''} col_92=${f.col_92 || ''} ` +
            `col_94=${f.col_94 || ''} col_95=${f.col_95 || ''} ` +
            `col_97=${f.col_97 || ''} col_98=${f.col_98 || ''} ` +
            `col_100=${f.col_100 || ''} col_101=${f.col_101 || ''}`
          );
        }
        services = [];
        for (const [key, val] of Object.entries(f)) {
          if (serviceMap?.has(key) && String(val) === '1') {
            services.push(serviceMap.get(key));
          }
        }

        const detailUrl = f.kyo_id
          ? `https://seven-eleven.areamarker.com/711map/info/${f.kyo_id}?shopid=${f.kyo_id}`
          : null;

        lines.push(JSON.stringify({
          store_id: f.kyo_id || null,
          store_name: f.name || null,
          address_raw: f.addr_1 || null,
          postal_code: f.zip_code || null,
          source_url: sourceUrl,
          detail_url: detailUrl,
          scraped_at: scrapedAt,
          hours_24h: hours24,
          hours_mon_start: hoursMonStart,
          hours_mon_end: hoursMonEnd,
          hours_tue_start: hoursTueStart,
          hours_tue_end: hoursTueEnd,
          hours_wed_start: hoursWedStart,
          hours_wed_end: hoursWedEnd,
          hours_thu_start: hoursThuStart,
          hours_thu_end: hoursThuEnd,
          hours_fri_start: hoursFriStart,
          hours_fri_end: hoursFriEnd,
          hours_sat_start: hoursSatStart,
          hours_sat_end: hoursSatEnd,
          hours_sun_start: hoursSunStart,
          hours_sun_end: hoursSunEnd,
          hours_holiday_start: hoursHolidayStart,
          hours_holiday_end: hoursHolidayEnd,
          services,
          payload_json: h
        }));

        // no extra sleep when navigating list/detail
      }
      fs.writeFileSync(outPath, lines.join('\n') + (lines.length ? '\n' : ''));
      console.log(`${pref}: ${lines.length} -> ${outPath}`);
      // no extra sleep after each prefecture
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
