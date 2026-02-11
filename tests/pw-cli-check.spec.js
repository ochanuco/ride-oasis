const { test, expect } = require('@playwright/test');

function jstNowKey() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = jst.getUTCFullYear();
  const mm = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(jst.getUTCDate()).padStart(2, '0');
  const hh = String(jst.getUTCHours()).padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}`;
}

test('7-Eleven Kochi API reachable via Playwright CLI', async ({ page }) => {
  let capturedHeaders = null;
  page.on('request', (req) => {
    if (req.url().includes('/v1/search-by-condition')) {
      capturedHeaders = req.headers();
    }
  });

  const requestPromise = page.waitForRequest((req) =>
    req.url().includes('/v1/search-by-condition')
  );
  await page.goto('https://seven-eleven.areamarker.com/711map/arealist/39/212?shopid=373221', {
    waitUntil: 'networkidle'
  });
  await requestPromise;

  expect(capturedHeaders).toBeTruthy();

  const headers = {
    'content-type': 'application/json',
    origin: 'https://seven-eleven.areamarker.com',
    referer: 'https://seven-eleven.areamarker.com/711map/top'
  };
  for (const [k, v] of Object.entries(capturedHeaders)) {
    const key = k.toLowerCase();
    if (['x-api-key', 'authorization', 'x-amz-security-token'].includes(key)) {
      headers[key] = v;
    }
  }

  const nowKey = jstNowKey();
  const fields = ['kyo_id', 'name', 'addr_1', 'zip_code', 'col_5', 'pre_code', 'city_code'];
  const searchConditions = [
    { field: 'pre_code', value: '39', comparison_operator: '=' },
    { field: 'col_2', value: nowKey, comparison_operator: '<=' },
    { field: 'col_10', value: '1', comparison_operator: '=' },
    {
      conditions: [
        { field: 'col_2', value: '1', comparison_operator: 'prefix' },
        { field: 'col_2', value: '2', comparison_operator: 'prefix', logical_operator: 'OR' }
      ]
    }
  ];

  const res = await page.request.post('https://seven-eleven-ss-api.areamarker.com/v1/search-by-condition', {
    headers,
    data: {
      paging_mode: 'search_after',
      sort: '+kyo_id',
      size: 200,
      fields,
      search_conditions: searchConditions,
      corp_id: '711map'
    }
  });

  expect(res.ok()).toBe(true);
  const data = await res.json();
  const count = data?.result?.hits?.found ?? 0;
  expect(count).toBeGreaterThan(0);
});
