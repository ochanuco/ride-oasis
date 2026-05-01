const test = require('node:test');
const assert = require('node:assert/strict');

const { buildGpxText, parseGpxText, parseCoordinateTokens } = require('../frontend/gpx');

test('GPX Export: 経路と補給地点を両方含むドキュメントを生成する', () => {
  const xml = buildGpxText({
    name: 'Test Route',
    creator: 'TestSuite',
    generatedAt: '2026-05-01T00:00:00Z',
    route: [
      [139.0, 35.0],
      [139.001, 35.0]
    ],
    waypoints: [
      { lat: 35.0001, lon: 139.0005, name: 'Lawson 渋谷', desc: '累計 0.5km / 左側', type: 'lawson' }
    ]
  });

  assert.match(xml, /<\?xml version="1\.0"/);
  assert.match(xml, /creator="TestSuite"/);
  assert.match(xml, /<name>Test Route<\/name>/);
  assert.match(xml, /<time>2026-05-01T00:00:00Z<\/time>/);
  assert.match(xml, /<wpt lat="35\.0001" lon="139\.0005">/);
  assert.match(xml, /Lawson 渋谷/);
  assert.match(xml, /累計 0\.5km \/ 左側/);
  assert.match(xml, /<type>lawson<\/type>/);
  assert.match(xml, /<trk>/);
  assert.match(xml, /<trkpt lat="35" lon="139"><\/trkpt>/);
  assert.match(xml, /<trkpt lat="35" lon="139\.001"><\/trkpt>/);
});

test('GPX Export: 経路が短いと <trk> を省略する', () => {
  const xml = buildGpxText({
    waypoints: [{ lat: 35, lon: 139, name: 'Solo' }],
    route: [[139, 35]]
  });
  assert.equal(xml.includes('<trk>'), false);
  assert.match(xml, /<wpt lat="35" lon="139">/);
});

test('GPX Export: 不正な座標の wpt と trkpt は除外する', () => {
  const xml = buildGpxText({
    route: [
      [139, 35],
      [Number.NaN, 35],
      [139.1, 35]
    ],
    waypoints: [
      { lat: 35, lon: 139, name: 'OK' },
      { lat: Number.NaN, lon: 139, name: 'Bad' }
    ]
  });
  assert.match(xml, /<wpt lat="35" lon="139">/);
  assert.equal(xml.includes('Bad'), false);
  // route filter drops NaN
  const trkptCount = (xml.match(/<trkpt /g) || []).length;
  assert.equal(trkptCount, 2);
});

test('GPX Export: name や desc 内の特殊文字を XML エスケープする', () => {
  const xml = buildGpxText({
    waypoints: [
      { lat: 35, lon: 139, name: '<&"\'>', desc: 'a & b' }
    ]
  });
  assert.match(xml, /<name>&lt;&amp;&quot;&apos;&gt;<\/name>/);
  assert.match(xml, /<desc>a &amp; b<\/desc>/);
  assert.equal(xml.includes('< &'), false);
});

test('GPX Export: 出力は parseGpxText で再パースできる', () => {
  const xml = buildGpxText({
    route: [
      [139.0, 35.0],
      [139.1, 35.1]
    ],
    waypoints: []
  });
  const parsed = parseGpxText(xml);
  assert.deepEqual(parsed.geometry.coordinates, [
    [139.0, 35.0],
    [139.1, 35.1]
  ]);
});

test('GPX Export: 既定で creator は RideOasis、name はデフォルト文言になる', () => {
  const xml = buildGpxText({ waypoints: [{ lat: 35, lon: 139, name: 'A' }] });
  assert.match(xml, /creator="RideOasis"/);
  assert.match(xml, /<name>RideOasis Supply Points<\/name>/);
});

test('GPX Export: parseCoordinateTokens は出力した trkpt を順序通り抽出する', () => {
  const xml = buildGpxText({
    route: [
      [139.5, 35.5],
      [139.6, 35.5],
      [139.6, 35.6]
    ],
    waypoints: []
  });
  assert.deepEqual(parseCoordinateTokens(xml), [
    [139.5, 35.5],
    [139.6, 35.5],
    [139.6, 35.6]
  ]);
});
