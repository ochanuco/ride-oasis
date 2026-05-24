const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeBbox,
  expandBbox,
  quantizeBbox,
  pointToPointDistanceMeters,
  pointToRouteDistanceMeters,
  bearingDegrees,
  isWithinHeadingDeg,
  cumulativeDistancesMeters,
  routeProjection
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

test('GPX Elevation: trkpt 内の ele を読み取り properties.elevations を返す', () => {
  const xml = [
    '<gpx><trk><trkseg>',
    '<trkpt lat="35.0" lon="139.0"><ele>10.5</ele></trkpt>',
    '<trkpt lat="35.1" lon="139.1"><ele>20</ele></trkpt>',
    '<trkpt lat="35.2" lon="139.2"><ele>15.25</ele></trkpt>',
    '</trkseg></trk></gpx>'
  ].join('');
  const parsed = parseGpxText(xml);
  assert.deepEqual(parsed.geometry.coordinates, [
    [139.0, 35.0],
    [139.1, 35.1],
    [139.2, 35.2]
  ]);
  assert.deepEqual(parsed.properties.elevations, [10.5, 20, 15.25]);
});

test('GPX Elevation: 一部の trkpt に ele が無い場合は null を残す', () => {
  const xml = [
    '<gpx><trk><trkseg>',
    '<trkpt lat="35.0" lon="139.0"><ele>10</ele></trkpt>',
    '<trkpt lat="35.1" lon="139.1"></trkpt>',
    '<trkpt lat="35.2" lon="139.2"><ele>30</ele></trkpt>',
    '</trkseg></trk></gpx>'
  ].join('');
  const parsed = parseGpxText(xml);
  assert.deepEqual(parsed.properties.elevations, [10, null, 30]);
});

test('GPX Elevation: ele が全く無い GPX では elevations は null', () => {
  const xml = [
    '<gpx><trk><trkseg>',
    '<trkpt lat="35.0" lon="139.0"></trkpt>',
    '<trkpt lat="35.1" lon="139.1"></trkpt>',
    '</trkseg></trk></gpx>'
  ].join('');
  const parsed = parseGpxText(xml);
  assert.equal(parsed.properties.elevations, null);
});

test('GPX Elevation: 自己終端タグや属性順違いでも順序通り抽出できる', () => {
  const xml = [
    '<gpx><rte>',
    "<rtept lon='139.0' lat='35.0'><ele>5</ele></rtept>",
    '<rtept lat="35.1" lon="139.1" />',
    '</rte></gpx>'
  ].join('');
  const parsed = parseGpxText(xml);
  assert.deepEqual(parsed.geometry.coordinates, [
    [139.0, 35.0],
    [139.1, 35.1]
  ]);
  assert.deepEqual(parsed.properties.elevations, [5, null]);
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

test('Route Math: 真北は方位 0 度になる', () => {
  const bearing = bearingDegrees([139.0, 35.0], [139.0, 35.1]);
  assert.ok(bearing >= 359 || bearing <= 1, `expected ~0, got ${bearing}`);
});

test('Route Math: 真東は方位 90 度になる', () => {
  const bearing = bearingDegrees([139.0, 35.0], [139.1, 35.0]);
  assert.ok(bearing > 89 && bearing < 91, `expected ~90, got ${bearing}`);
});

test('Route Math: 真南は方位 180 度になる', () => {
  const bearing = bearingDegrees([139.0, 35.1], [139.0, 35.0]);
  assert.ok(bearing > 179 && bearing < 181, `expected ~180, got ${bearing}`);
});

test('Route Math: 真西は方位 270 度になる', () => {
  const bearing = bearingDegrees([139.1, 35.0], [139.0, 35.0]);
  assert.ok(bearing > 269 && bearing < 271, `expected ~270, got ${bearing}`);
});

test('Route Math: 不正な座標の方位は null を返す', () => {
  assert.equal(bearingDegrees(null, [139.0, 35.0]), null);
  assert.equal(bearingDegrees([Number.NaN, 35.0], [139.0, 35.0]), null);
});

test('Route Math: 同一地点の方位は 0 を返す', () => {
  assert.equal(bearingDegrees([139.0, 35.0], [139.0, 35.0]), 0);
});

test('Route Math: ヘディング許容範囲内なら true', () => {
  assert.equal(isWithinHeadingDeg(0, 45, 90), true);
  assert.equal(isWithinHeadingDeg(0, 90, 90), true);
  assert.equal(isWithinHeadingDeg(0, 91, 90), false);
});

test('Route Math: ヘディングは 360 度ラップを正しく扱う', () => {
  assert.equal(isWithinHeadingDeg(350, 10, 30), true);
  assert.equal(isWithinHeadingDeg(10, 350, 30), true);
  assert.equal(isWithinHeadingDeg(0, 180, 90), false);
});

test('Route Math: 不正なヘディング入力は false を返す', () => {
  assert.equal(isWithinHeadingDeg(Number.NaN, 90, 90), false);
  assert.equal(isWithinHeadingDeg(0, Number.NaN, 90), false);
});

test('Route Math: 累計距離は各頂点までの合計を返す', () => {
  const cum = cumulativeDistancesMeters([
    [139.0, 35.0],
    [139.001, 35.0],
    [139.002, 35.0]
  ]);
  assert.equal(cum.length, 3);
  assert.equal(cum[0], 0);
  assert.ok(cum[1] > 80 && cum[1] < 100);
  assert.ok(cum[2] > 170 && cum[2] < 200);
});

test('Route Math: 累計距離は空配列で空配列を返す', () => {
  assert.deepEqual(cumulativeDistancesMeters([]), []);
});

test('Route Math: routeProjection は東進ルートで北側の点を L と判定する', () => {
  const proj = routeProjection([139.001, 35.0001], [
    [139.0, 35.0],
    [139.002, 35.0]
  ]);
  assert.equal(proj.side, 'L');
  assert.ok(proj.perpMeters > 0);
});

test('Route Math: routeProjection は東進ルートで南側の点を R と判定する', () => {
  const proj = routeProjection([139.001, 34.9999], [
    [139.0, 35.0],
    [139.002, 35.0]
  ]);
  assert.equal(proj.side, 'R');
});

test('Route Math: routeProjection は北進ルートで東側の点を R と判定する', () => {
  const proj = routeProjection([139.0001, 35.001], [
    [139.0, 35.0],
    [139.0, 35.002]
  ]);
  assert.equal(proj.side, 'R');
});

test('Route Math: routeProjection は累計距離 (alongMeters) を正しく計算する', () => {
  const coords = [
    [139.0, 35.0],
    [139.002, 35.0],
    [139.004, 35.0]
  ];
  const cum = cumulativeDistancesMeters(coords);
  // Project to mid of segment 2 -> alongMeters ≈ cum[1] + segment2Length/2 ≈ cum[1] + (cum[2]-cum[1])/2
  const proj = routeProjection([139.003, 35.0], coords, cum);
  assert.equal(proj.segmentIndex, 1);
  const expected = cum[1] + (cum[2] - cum[1]) * 0.5;
  assert.ok(Math.abs(proj.alongMeters - expected) < 1);
});

test('Route Math: routeProjection は経路が短すぎると null を返す', () => {
  assert.equal(routeProjection([139.0, 35.0], [[139.0, 35.0]]), null);
  assert.equal(routeProjection([139.0, 35.0], []), null);
});

test('Route Math: routeProjection は不正な点で null を返す', () => {
  const coords = [[139.0, 35.0], [139.001, 35.0]];
  assert.equal(routeProjection([Number.NaN, 35.0], coords), null);
  assert.equal(routeProjection(null, coords), null);
});

test('Route Math: quantizeBbox は grid セル境界に揃える', () => {
  // 0.01° grid 上で min/max が同じセル内に収まる入力
  const q = quantizeBbox([135.5023, 34.6937, 135.5051, 34.6950], 0.01);
  assert.deepEqual(q, [135.50, 34.69, 135.51, 34.70]);
});

test('Route Math: quantizeBbox は粒度を跨ぐ bbox をそれぞれ floor/ceil', () => {
  const q = quantizeBbox([135.502, 34.693, 135.522, 34.713], 0.01);
  assert.deepEqual(q, [135.50, 34.69, 135.53, 34.72]);
});

test('Route Math: quantizeBbox はデフォルト grid 0.01°', () => {
  const q = quantizeBbox([135.5023, 34.6937, 135.5051, 34.6950]);
  // 浮動小数誤差を許容
  assert.ok(Math.abs(q[0] - 135.50) < 1e-9);
  assert.ok(Math.abs(q[1] - 34.69) < 1e-9);
  assert.ok(Math.abs(q[2] - 135.51) < 1e-9);
  assert.ok(Math.abs(q[3] - 34.70) < 1e-9);
});

test('Route Math: quantizeBbox(null) は null', () => {
  assert.equal(quantizeBbox(null, 0.01), null);
});

test('Route Math: quantizeBbox は不正形状を null で弾く', () => {
  // 長さ不正
  assert.equal(quantizeBbox([135, 34, 136], 0.01), null);
  // NaN 含む
  assert.equal(quantizeBbox([135, NaN, 136, 35], 0.01), null);
  // min>max 逆転
  assert.equal(quantizeBbox([136, 34, 135, 35], 0.01), null);
  assert.equal(quantizeBbox([135, 35, 136, 34], 0.01), null);
});

test('Route Math: 隣接の似たエリアは quantize 後に同じ bbox になる (cache hit 期待)', () => {
  // 同じ ~1km セル内の 2 つの異なる詳細 bbox は同じ量子化結果を返す
  const a = quantizeBbox([135.502, 34.693, 135.504, 34.695], 0.01);
  const b = quantizeBbox([135.503, 34.694, 135.505, 34.696], 0.01);
  assert.deepEqual(a, b);
});
