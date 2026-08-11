'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { parseArgs, parseBbox } = require('../scripts/cycling_extract_subset');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'cycling_extract_subset.js');

/** src/dst を持つ一時ディレクトリを作り、nodes/edges.ndjson を書き込む。 */
function makeFixture(nodes, edges) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-subset-'));
  const src = path.join(dir, 'src');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(
    path.join(src, 'nodes.ndjson'),
    nodes.map((n) => JSON.stringify(n)).join('\n') + '\n'
  );
  fs.writeFileSync(
    path.join(src, 'edges.ndjson'),
    edges.map((e) => JSON.stringify(e)).join('\n') + '\n'
  );
  return { dir, src, dst: path.join(dir, 'dst') };
}

function readNdjson(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function runExtract(src, dst, bbox) {
  return execFileSync(process.execPath, [SCRIPT, '--src', src, '--dst', dst, '--bbox', bbox], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

test('parseArgs: --src / --dst / --bbox を読み取る', () => {
  const r = parseArgs(['--src', 'data/cycling', '--dst', 'data/cycling-osaka', '--bbox', '135.4,34.6,135.6,34.8']);
  assert.equal(r.src, 'data/cycling');
  assert.equal(r.dst, 'data/cycling-osaka');
  assert.equal(r.bbox, '135.4,34.6,135.6,34.8');
});

test('parseArgs: 省略した引数は null のまま', () => {
  const r = parseArgs(['--src', 'data/cycling']);
  assert.equal(r.src, 'data/cycling');
  assert.equal(r.dst, null);
  assert.equal(r.bbox, null);
});

test('parseArgs: --help でフラグ立つ', () => {
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-h']).help, true);
});

test('parseArgs: 未知引数は例外', () => {
  assert.throws(() => parseArgs(['--unknown']), /Unknown argument/);
});

test('parseArgs: 値が欠けたオプションは null になり後続の必須チェックに落ちる', () => {
  const r = parseArgs(['--src']);
  assert.equal(r.src, null);
});

test('parseBbox: 4 要素を minLon/minLat/maxLon/maxLat に割り当てる', () => {
  const b = parseBbox('135.4,34.6,135.6,34.8');
  assert.deepEqual(b, { minLon: 135.4, minLat: 34.6, maxLon: 135.6, maxLat: 34.8 });
});

test('parseBbox: 負値を含む bbox も扱える', () => {
  const b = parseBbox('-10.5,-20.25,10.5,20.25');
  assert.deepEqual(b, { minLon: -10.5, minLat: -20.25, maxLon: 10.5, maxLat: 20.25 });
});

test('parseBbox: 未指定は null', () => {
  assert.equal(parseBbox(null), null);
  assert.equal(parseBbox(''), null);
});

test('parseBbox: 要素数が 4 でなければ null', () => {
  assert.equal(parseBbox('135.4,34.6,135.6'), null);
  assert.equal(parseBbox('135.4,34.6,135.6,34.8,1'), null);
});

test('parseBbox: 数値でない要素があれば null', () => {
  assert.equal(parseBbox('135.4,abc,135.6,34.8'), null);
  assert.equal(parseBbox('135.4,,135.6,34.8'), null);
});

test('parseBbox: NaN / Infinity は弾く', () => {
  assert.equal(parseBbox('NaN,34.6,135.6,34.8'), null);
  assert.equal(parseBbox('135.4,34.6,Infinity,34.8'), null);
});

// --- 抽出フロー (fixture) -------------------------------------------------

test('抽出: bbox 境界上のノードは含み、外のノードは落とす', (t) => {
  // bbox = 135.4,34.6,135.6,34.8
  const nodes = [
    { id: 1, lon: 135.4, lat: 34.6 },   // 南西の角 (境界上 → 含む)
    { id: 2, lon: 135.6, lat: 34.8 },   // 北東の角 (境界上 → 含む)
    { id: 3, lon: 135.5, lat: 34.7 },   // 内側
    { id: 4, lon: 135.39, lat: 34.7 },  // 西に外れる
    { id: 5, lon: 135.5, lat: 34.81 }   // 北に外れる
  ];
  const { dir, src, dst } = makeFixture(nodes, []);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  runExtract(src, dst, '135.4,34.6,135.6,34.8');

  const kept = readNdjson(path.join(dst, 'nodes.ndjson')).map((n) => n.id).sort();
  assert.deepEqual(kept, [1, 2, 3]);
});

test('抽出: 両端が残ったエッジだけを出力する', (t) => {
  const nodes = [
    { id: 1, lon: 135.4, lat: 34.6 },   // 境界上
    { id: 2, lon: 135.5, lat: 34.7 },   // 内側
    { id: 3, lon: 135.6, lat: 34.8 },   // 境界上
    { id: 9, lon: 135.9, lat: 34.9 }    // 範囲外
  ];
  const edges = [
    { from: 1, to: 2, cost_m: 10 },     // 両端とも残る → 出力
    { from: 2, to: 3, cost_m: 20 },     // 両端とも残る (境界端どうしを含む) → 出力
    { from: 1, to: 3, cost_m: 30 },     // 境界上どうし → 出力
    { from: 2, to: 9, cost_m: 40 },     // 片端が範囲外 → 落とす
    { from: 9, to: 1, cost_m: 50 }      // 片端が範囲外 (向き違い) → 落とす
  ];
  const { dir, src, dst } = makeFixture(nodes, edges);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  runExtract(src, dst, '135.4,34.6,135.6,34.8');

  const kept = readNdjson(path.join(dst, 'edges.ndjson')).map((e) => `${e.from}-${e.to}`).sort();
  assert.deepEqual(kept, ['1-2', '1-3', '2-3']);
});

test('抽出: src と dst が同じなら書き込む前に中断する', (t) => {
  const nodes = [{ id: 1, lon: 135.5, lat: 34.7 }];
  const { dir, src } = makeFixture(nodes, [{ from: 1, to: 1, cost_m: 1 }]);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const before = fs.readFileSync(path.join(src, 'nodes.ndjson'), 'utf8');
  assert.throws(() => runExtract(src, src, '135.4,34.6,135.6,34.8'));
  // 元ファイルが truncate されていないこと
  assert.equal(fs.readFileSync(path.join(src, 'nodes.ndjson'), 'utf8'), before);
});

test('抽出: bbox が不正なら異常終了する', (t) => {
  const { dir, src, dst } = makeFixture([{ id: 1, lon: 135.5, lat: 34.7 }], []);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  assert.throws(() => runExtract(src, dst, '135.4,,135.6,34.8'));
});
