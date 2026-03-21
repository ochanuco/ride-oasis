const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeBbox,
  expandBbox,
  pointToPointDistanceMeters,
  pointToRouteDistanceMeters
} = require('../frontend/route_math');
const { parseCoordinateTokens, parseGpxText } = require('../frontend/gpx');

test('Route Math: GPX から trkpt を順序通り抽出できる', () => {
  const coords = parseCoordinateTokens([
    '<gpx><trk><trkseg>',
    '<trkpt lat="35.0" lon="139.0"></trkpt>',
    '<trkpt lat="35.1" lon="139.1"></trkpt>',
    '</trkseg></trk></gpx>'
  ].join(''));

  assert.deepEqual(coords, [
    [139.0, 35.0],
    [139.1, 35.1]
  ]);
});

test('Route Math: 属性順やシングルクォートが異なる GPX も抽出できる', () => {
  const coords = parseCoordinateTokens([
    "<gpx><trk><trkseg>",
    "<trkpt lon='139.2' lat='35.2'></trkpt>",
    "<rtept foo='x' lat=\"35.3\" bar='y' lon=\"139.3\"></rtept>",
    '</trkseg></trk></gpx>'
  ].join(''));

  assert.deepEqual(coords, [
    [139.2, 35.2],
    [139.3, 35.3]
  ]);
});

test('Route Math: 2点未満の GPX は例外を投げる', () => {
  assert.throws(() => parseGpxText('<gpx><trkpt lat="35" lon="139"></trkpt></gpx>'), /2点以上/);
});

test('Route Math: bbox を算出できる', () => {
  assert.deepEqual(
    computeBbox([
      [139.3, 35.3],
      [139.0, 35.1],
      [139.2, 35.5]
    ]),
    [139.0, 35.1, 139.3, 35.5]
  );
});

test('Route Math: bbox をメートル相当で拡張できる', () => {
  const expanded = expandBbox([139.0, 35.0, 139.1, 35.1], 1000);
  assert.ok(expanded[0] < 139.0);
  assert.ok(expanded[2] > 139.1);
});

test('Route Math: 経路上の点はほぼゼロ距離になる', () => {
  const distance = pointToRouteDistanceMeters(
    [139.05, 35.0],
    [
      [139.0, 35.0],
      [139.1, 35.0]
    ]
  );
  assert.ok(distance < 1);
});

test('Route Math: 経路から離れた点は数百メートル以上になる', () => {
  const distance = pointToRouteDistanceMeters(
    [139.05, 35.01],
    [
      [139.0, 35.0],
      [139.1, 35.0]
    ]
  );
  assert.ok(distance > 500);
});

test('Route Math: 単一点どうしの距離をメートル換算できる', () => {
  const distance = pointToPointDistanceMeters([139.0, 35.0], [139.001, 35.0]);
  assert.ok(distance > 80);
  assert.ok(distance < 100);
});

test('Route Math: 非数値の座標は無限距離として扱う', () => {
  const distance = pointToPointDistanceMeters([139.0, Number.NaN], [139.001, 35.0]);
  assert.equal(distance, Number.POSITIVE_INFINITY);
});
