const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeFitData, parseFitArrayBuffer, _resetCacheForTests } = require('../frontend/fit');

test('FIT Parser: records と course_points を内部形式に正規化する', () => {
  const data = {
    records: [
      { position_lat: 35.0, position_long: 139.0, distance: 0, altitude: 12.5 },
      { position_lat: 35.1, position_long: 139.1, distance: 1234.5 }
    ],
    course_points: [
      { position_lat: 35.5, position_long: 139.5, name: 'PC1', type: 'checkpoint', distance: 50000 }
    ]
  };
  const out = normalizeFitData(data);
  assert.equal(out.records.length, 2);
  assert.deepEqual(out.records[0], { lat: 35.0, lon: 139.0, distanceMeters: 0, elevationMeters: 12.5 });
  assert.deepEqual(out.records[1], { lat: 35.1, lon: 139.1, distanceMeters: 1234.5, elevationMeters: null });
  assert.equal(out.coursePoints.length, 1);
  assert.deepEqual(out.coursePoints[0], {
    lat: 35.5,
    lon: 139.5,
    distanceMeters: 50000,
    name: 'PC1',
    type: 'checkpoint'
  });
});

test('FIT Parser: 不正な lat/lon を持つレコードを除外する', () => {
  const out = normalizeFitData({
    records: [
      { position_lat: 35.0, position_long: 139.0 },
      { position_lat: null, position_long: 139.0 },
      { position_lat: 35.0, position_long: null },
      { position_lat: Number.NaN, position_long: 139.0 }
    ],
    course_points: [
      { position_lat: 35.5, position_long: 139.5, name: 'OK' },
      { position_lat: null, position_long: 139.0, name: 'Bad' }
    ]
  });
  assert.equal(out.records.length, 1);
  assert.equal(out.coursePoints.length, 1);
  assert.equal(out.coursePoints[0].name, 'OK');
});

test('FIT Parser: WGS84 範囲外の lat/lon を除外する', () => {
  const out = normalizeFitData({
    records: [
      { position_lat: 35.0, position_long: 139.0 },
      { position_lat: 999, position_long: 139.0 },
      { position_lat: -91, position_long: 139.0 },
      { position_lat: 35.0, position_long: 181 },
      { position_lat: 35.0, position_long: -181 }
    ],
    course_points: [
      { position_lat: 91, position_long: 0, name: 'NorthOfNorth' },
      { position_lat: 35, position_long: 139, name: 'OK' }
    ]
  });
  assert.equal(out.records.length, 1);
  assert.equal(out.records[0].lat, 35);
  assert.equal(out.coursePoints.length, 1);
  assert.equal(out.coursePoints[0].name, 'OK');
});

test('FIT Parser: distance が無い record / course_point は distanceMeters: null になる', () => {
  const out = normalizeFitData({
    records: [{ position_lat: 35, position_long: 139 }],
    course_points: [{ position_lat: 35.5, position_long: 139.5 }]
  });
  assert.equal(out.records[0].distanceMeters, null);
  assert.equal(out.records[0].elevationMeters, null);
  assert.equal(out.coursePoints[0].distanceMeters, null);
});

test('FIT Parser: enhanced_altitude を優先しつつ altitude にフォールバックする', () => {
  const out = normalizeFitData({
    records: [
      { position_lat: 35, position_long: 139, altitude: 10, enhanced_altitude: 11 },
      { position_lat: 35.1, position_long: 139.1, altitude: 20 },
      { position_lat: 35.2, position_long: 139.2 }
    ]
  });
  assert.equal(out.records[0].elevationMeters, 11);
  assert.equal(out.records[1].elevationMeters, 20);
  assert.equal(out.records[2].elevationMeters, null);
});

test('FIT Parser: name / type が文字列でない場合は default 値で正規化する', () => {
  const out = normalizeFitData({
    course_points: [
      { position_lat: 35.5, position_long: 139.5, name: undefined, type: 5 }
    ]
  });
  assert.equal(out.coursePoints[0].name, '');
  assert.equal(out.coursePoints[0].type, 'generic');
});

test('FIT Parser: 入力が空 / 不正でも例外を投げず空配列を返す', () => {
  assert.deepEqual(normalizeFitData({}), { records: [], coursePoints: [] });
  assert.deepEqual(normalizeFitData(null), { records: [], coursePoints: [] });
  assert.deepEqual(normalizeFitData({ records: 'not-array' }), { records: [], coursePoints: [] });
});

test('FIT Parser: parseFitArrayBuffer は注入された importFn 経由で正規化結果を返す', async () => {
  _resetCacheForTests();
  // Stub fit-file-parser so the test runs offline.
  class StubParser {
    constructor(opts) { this.opts = opts; }
    parse(buffer, cb) {
      cb(null, {
        records: [
          { position_lat: 35, position_long: 139, distance: 0 },
          { position_lat: 35.01, position_long: 139.01, distance: 1500 }
        ],
        course_points: [
          { position_lat: 35.005, position_long: 139.005, name: 'PC', type: 'checkpoint', distance: 750 }
        ]
      });
    }
  }
  const importFn = async () => ({ default: StubParser });
  const buffer = new ArrayBuffer(16);
  const result = await parseFitArrayBuffer(buffer, { importFn });
  assert.equal(result.records.length, 2);
  assert.equal(result.coursePoints.length, 1);
  assert.equal(result.coursePoints[0].name, 'PC');
});

test('FIT Parser: parseFitArrayBuffer はライブラリのエラーを Error として reject する', async () => {
  _resetCacheForTests();
  class FailingParser {
    parse(_buffer, cb) { cb('boom'); }
  }
  const importFn = async () => ({ default: FailingParser });
  const buffer = new ArrayBuffer(16);
  await assert.rejects(parseFitArrayBuffer(buffer, { importFn }), /boom/);
});

test('FIT Parser: parseFitArrayBuffer は Error インスタンスをそのまま reject する', async () => {
  _resetCacheForTests();
  const original = new Error('detail message');
  original.code = 'XYZ';
  class FailingParser {
    parse(_buffer, cb) { cb(original); }
  }
  const importFn = async () => ({ default: FailingParser });
  const buffer = new ArrayBuffer(16);
  await assert.rejects(parseFitArrayBuffer(buffer, { importFn }), (received) => {
    assert.equal(received, original);
    assert.equal(received.code, 'XYZ');
    return true;
  });
});
