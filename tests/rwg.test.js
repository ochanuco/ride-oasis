const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseRouteId,
  normalizeRwgData,
  fetchRoute,
  buildRouteUrl
} = require('../frontend/rwg');

test('RWG: parseRouteId は URL 文字列から数値 id を抽出する', () => {
  assert.equal(parseRouteId('https://ridewithgps.com/routes/34616079'), 34616079);
  assert.equal(parseRouteId('https://ridewithgps.com/routes/34616079?foo=bar'), 34616079);
  assert.equal(parseRouteId('http://ridewithgps.com/routes/12345'), 12345);
  assert.equal(parseRouteId('  https://ridewithgps.com/routes/777  '), 777);
});

test('RWG: parseRouteId は数値文字列をそのまま受ける', () => {
  assert.equal(parseRouteId('34616079'), 34616079);
  assert.equal(parseRouteId('  34616079  '), 34616079);
});

test('RWG: parseRouteId は無効入力で null を返す', () => {
  assert.equal(parseRouteId(''), null);
  assert.equal(parseRouteId(null), null);
  assert.equal(parseRouteId('not a url'), null);
  assert.equal(parseRouteId('https://example.com/routes/123'), null);
  assert.equal(parseRouteId(34616079), null);
});

test('RWG: buildRouteUrl は public JSON URL を返す', () => {
  assert.equal(buildRouteUrl(34616079), 'https://ridewithgps.com/routes/34616079.json');
});

test('RWG: normalizeRwgData は track_points / course_points / POI を統合する', () => {
  const data = {
    name: '神戸-伊勢',
    track_points: [
      { x: 139.0, y: 35.0, d: 0, e: 12.3 },
      { x: 139.001, y: 35.001, d: 150 }
    ],
    course_points: [
      { x: 139.0005, y: 35.0005, d: 75, n: '右折', t: 'Right' }
    ],
    points_of_interest: [
      {
        lat: 34.5392, lng: 136.6027,
        name: '通過チェック2a　従是外宮三里 石碑',
        description: '1a 自転車と写真',
        poi_type_name: 'generic'
      }
    ]
  };
  const out = normalizeRwgData(data);
  assert.equal(out.name, '神戸-伊勢');
  assert.equal(out.records.length, 2);
  assert.deepEqual(out.records[0], { lat: 35.0, lon: 139.0, distanceMeters: 0, elevationMeters: 12.3 });
  assert.equal(out.records[1].elevationMeters, null);
  assert.equal(out.coursePoints.length, 2);
  assert.equal(out.coursePoints[0].name, '右折');
  assert.equal(out.coursePoints[0].type, 'right');
  assert.equal(out.coursePoints[0].description, '');
  assert.equal(out.coursePoints[1].name, '通過チェック2a　従是外宮三里 石碑');
  assert.equal(out.coursePoints[1].description, '1a 自転車と写真');
  assert.equal(out.coursePoints[1].type, 'generic');
  assert.equal(out.coursePoints[1].lat, 34.5392);
  assert.equal(out.coursePoints[1].lon, 136.6027);
});

test('RWG: normalizeRwgData は不正座標を除外する', () => {
  const out = normalizeRwgData({
    track_points: [
      { x: 139, y: 35 },
      { x: 999, y: 35 }
    ],
    course_points: [
      { x: 139, y: 91, n: 'oob' },
      { x: 139, y: 35, n: 'ok' }
    ],
    points_of_interest: [
      { lat: 35, lng: -181, name: 'oob' },
      { lat: 35, lng: 139, name: 'ok' }
    ]
  });
  assert.equal(out.records.length, 1);
  assert.equal(out.coursePoints.length, 2);
  assert.equal(out.coursePoints[0].name, 'ok');
  assert.equal(out.coursePoints[1].name, 'ok');
});

test('RWG: normalizeRwgData は欠落フィールドを安全に扱う', () => {
  const out = normalizeRwgData({});
  assert.deepEqual(out, { records: [], coursePoints: [], name: '' });
  assert.deepEqual(normalizeRwgData(null), { records: [], coursePoints: [], name: '' });
});

test('RWG: fetchRoute は fetchFn を経由して normalize した結果を返す', async () => {
  const fakeJson = {
    name: 'TestRoute',
    track_points: [{ x: 139, y: 35, d: 0 }, { x: 139.01, y: 35, d: 800 }],
    course_points: [],
    points_of_interest: [{ lat: 35, lng: 139, name: 'PC', description: 'D', poi_type_name: 'finish' }]
  };
  const fetchFn = async (url, opts) => {
    assert.equal(url, 'https://ridewithgps.com/routes/12345.json');
    assert.equal(opts.headers.Accept, 'application/json');
    return {
      ok: true,
      json: async () => fakeJson
    };
  };
  const result = await fetchRoute(12345, { fetchFn });
  assert.equal(result.name, 'TestRoute');
  assert.equal(result.records.length, 2);
  assert.equal(result.coursePoints.length, 1);
  assert.equal(result.coursePoints[0].type, 'finish');
});

test('RWG: fetchRoute は HTTP エラーで Error を投げる', async () => {
  const fetchFn = async () => ({ ok: false, status: 404 });
  await assert.rejects(fetchRoute(99999, { fetchFn }), /HTTP 404/);
});

test('RWG: fetchRoute は不正 id で Error を投げる', async () => {
  await assert.rejects(fetchRoute(NaN, { fetchFn: async () => ({}) }), /不正/);
  await assert.rejects(fetchRoute('abc', { fetchFn: async () => ({}) }), /不正/);
});
