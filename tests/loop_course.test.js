'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  generateLoopCourses,
  generateLoopCourse,
  generateExtendedCourse,
  generateOutAndBackCourse,
  generateRouteCandidate,
  petalCountFor,
  SINGLE_LOOP_MAX_KM,
  haversineKm,
  destinationPoint,
  polylineLengthKm,
  buildLoopVertices,
  splitLongLegs,
  chooseVertexCount,
  clampNumber,
  clampInt,
  MAX_TARGET_KM,
  MAX_LEG_KM
} = require('../frontend/loop_course.js');

// 大阪駅付近を中心に使う（任意の地点で良い）。
const CENTER = [135.4959, 34.7024];

/**
 * テスト用のモック routeLeg。2 点を直線（haversine）で密に補間して返す。
 * 実ルーターの代わりに使うことで、収束ロジックを WASM/R2 なしで検証できる。
 * 道なりの迂回がないぶん経路は最短になるが、収束（ρ *= target/total）の
 * 妥当性確認には十分。
 */
function straightLineRouteLeg(stepKm = 1) {
  return async (from, to) => {
    const d = haversineKm(from, to);
    const n = Math.max(1, Math.ceil(d / stepKm));
    const coords = [];
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      coords.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
    }
    return { coordinates: coords };
  };
}

test('haversineKm: 既知距離（緯度 1 度 ≈ 111km）を概算できる', () => {
  const d = haversineKm([135, 34], [135, 35]);
  assert.ok(Math.abs(d - 111.2) < 1, `expected ~111km, got ${d}`);
});

test('destinationPoint: 北へ 10km 進むと緯度が約 0.09 度増える', () => {
  const p = destinationPoint([135, 34], 0, 10);
  assert.ok(Math.abs(p[0] - 135) < 0.01, '経度はほぼ不変');
  assert.ok(p[1] > 34.08 && p[1] < 34.1, `緯度が増える: ${p[1]}`);
});

test('buildLoopVertices: 先頭と末尾が center でループが閉じる', () => {
  const verts = buildLoopVertices(CENTER, 5, 8, 0, 1);
  assert.deepEqual(verts[0], CENTER);
  assert.deepEqual(verts[verts.length - 1], CENTER);
  assert.equal(verts.length, 9); // center + (vertexCount-1) + center
});

test('chooseVertexCount: 半径が大きいほど頂点が増える（脚を短く保つ）', () => {
  const small = chooseVertexCount(2, MAX_LEG_KM);
  const large = chooseVertexCount(25, MAX_LEG_KM);
  assert.ok(large > small, `${large} > ${small}`);
  assert.ok(small >= 6, '最小頂点数は 6');
});

test('splitLongLegs: 長い脚が MAX_LEG_KM 以下に分割される', () => {
  // 中心からまっすぐ 50km 先まで（1 脚 50km）。
  const far = destinationPoint(CENTER, 90, 50);
  const split = splitLongLegs([CENTER, far], MAX_LEG_KM);
  for (let i = 1; i < split.length; i += 1) {
    assert.ok(
      haversineKm(split[i - 1], split[i]) <= MAX_LEG_KM + 1e-6,
      `脚 ${i} が上限超: ${haversineKm(split[i - 1], split[i])}`
    );
  }
});

test('generateLoopCourse: 目標 40km に ±10% で収束する', async () => {
  const r = await generateLoopCourse(CENTER, 40, {}, straightLineRouteLeg());
  assert.ok(r, '結果が返る');
  assert.ok(r.converged, `収束する: errRatio=${r.errRatio}, dist=${r.distanceKm}`);
  assert.ok(Math.abs(r.distanceKm - 40) / 40 <= 0.1, `距離が目標近傍: ${r.distanceKm}`);
});

test('generateLoopCourse: 始点と終点が center 付近に戻る（周回）', async () => {
  const r = await generateLoopCourse(CENTER, 60, {}, straightLineRouteLeg());
  const start = r.coordinates[0];
  const end = r.coordinates[r.coordinates.length - 1];
  assert.ok(haversineKm(start, CENTER) < 0.1, '始点が center');
  // 出発点付近（±5km）に戻る要件を満たす。
  assert.ok(haversineKm(end, CENTER) < 5, `終点が出発点付近: ${haversineKm(end, CENTER)}km`);
});

test('generateLoopCourses: 既定で 3 本生成し、目標距離に近い順に並ぶ', async () => {
  const out = await generateLoopCourses(CENTER, 80, 3, straightLineRouteLeg());
  assert.equal(out.courses.length, 3);
  assert.equal(out.target_km, 80);
  for (let i = 1; i < out.courses.length; i += 1) {
    assert.ok(out.courses[i - 1].errRatio <= out.courses[i].errRatio, '誤差昇順');
  }
});

test('generateLoopCourses: 作り分けた本数ぶん別方位になる', async () => {
  const out = await generateLoopCourses(CENTER, 80, 3, straightLineRouteLeg());
  const offsets = new Set(out.courses.map((c) => c.bearingOffsetDeg));
  assert.ok(offsets.size >= 2, '少なくとも 2 種類の方位');
});

test('generateLoopCourses: km が 160 超なら 160 にクランプされる', async () => {
  const out = await generateLoopCourses(CENTER, 500, 2, straightLineRouteLeg());
  assert.equal(out.target_km, MAX_TARGET_KM);
});

test('generateLoopCourses: n は 1〜3 にクランプされる', async () => {
  const tooMany = await generateLoopCourses(CENTER, 40, 10, straightLineRouteLeg());
  assert.equal(tooMany.requested, 3);
  const tooFew = await generateLoopCourses(CENTER, 40, 0, straightLineRouteLeg());
  assert.equal(tooFew.requested, 1);
});

test('generateLoopCourses: 全脚が失敗する routeLeg では 0 本を返す', async () => {
  const failing = async () => ({ error: 'no_nearby_node_from' });
  const out = await generateLoopCourses(CENTER, 40, 3, failing);
  assert.equal(out.courses.length, 0);
});

test('generateLoopCourses: routeLegFactory が変種ごとに 1 回だけ呼ばれる', async () => {
  let factoryCalls = 0;
  const routeLegFactory = async ({ bearingOffsetDeg }) => {
    factoryCalls += 1;
    // 変種ごとの routeLeg。bearingOffsetDeg を見て変種を区別できる。
    assert.equal(typeof bearingOffsetDeg, 'number');
    return straightLineRouteLeg();
  };
  const out = await generateLoopCourses(CENTER, 60, 3, null, { routeLegFactory });
  assert.equal(out.courses.length, 3);
  // 予備候補を使わずに済めば本数ぶん（3 回）だけ factory が呼ばれる。
  assert.equal(factoryCalls, 3);
});

test('generateLoopCourses: factory が throw した変種は捨てられる', async () => {
  const routeLegFactory = async () => {
    throw new Error('csr build failed');
  };
  const out = await generateLoopCourses(CENTER, 40, 3, null, { routeLegFactory });
  assert.equal(out.courses.length, 0);
});

test('petalCountFor: 距離が大きいほど花びら枚数が増える', () => {
  assert.equal(petalCountFor(60), 1, '小さい距離は単一ループ');
  assert.equal(petalCountFor(SINGLE_LOOP_MAX_KM), 1, '閾値ちょうどは 1 枚');
  assert.ok(petalCountFor(160) >= 2, '160km は複数花びら');
});

test('generateExtendedCourse: 小距離は単一ループ（petals 未設定 or 1）', async () => {
  const r = await generateExtendedCourse(CENTER, 40, {}, straightLineRouteLeg());
  assert.ok(r, '結果が返る');
  assert.ok(!r.petals || r.petals === 1, '単一ループ');
  assert.ok(Math.abs(r.distanceKm - 40) / 40 <= 0.1, '目標近傍');
});

test('generateExtendedCourse: 160km は複数花びらで総距離が目標に収束する', async () => {
  const r = await generateExtendedCourse(CENTER, 160, {}, straightLineRouteLeg());
  assert.ok(r, '結果が返る');
  assert.ok(r.petals >= 2, `複数花びら: ${r.petals}`);
  assert.ok(Math.abs(r.distanceKm - 160) / 160 <= 0.1, `総距離が目標近傍: ${r.distanceKm}`);
});

test('generateExtendedCourse: 花びら型でも始点・終点が中心に戻る', async () => {
  const r = await generateExtendedCourse(CENTER, 160, {}, straightLineRouteLeg());
  const start = r.coordinates[0];
  const end = r.coordinates[r.coordinates.length - 1];
  assert.ok(haversineKm(start, CENTER) < 0.1, '始点が中心');
  assert.ok(haversineKm(end, CENTER) < 5, `終点が出発点付近: ${haversineKm(end, CENTER)}km`);
});

test('generateExtendedCourse: 花びらの最大到達距離は単一円より小さい', async () => {
  // 同じ 160km を、単一円ループ(参考)と花びらで比べると、花びらの方が中心から
  // 遠ざからない（被覆内に収めやすい）。
  const petal = await generateExtendedCourse(CENTER, 160, {}, straightLineRouteLeg());
  const maxReachKm = Math.max(...petal.coordinates.map((c) => haversineKm(CENTER, c)));
  // 単一円ループの最大到達は直径相当 ≈ 160/π/... ≈ 50km。花びらはその半分以下。
  assert.ok(maxReachKm < 30, `花びらの最大到達が小さい: ${maxReachKm.toFixed(1)}km`);
});

test('generateOutAndBackCourse: 総距離が目標に収束し往復で中心に戻る', async () => {
  const r = await generateOutAndBackCourse(CENTER, 40, {}, straightLineRouteLeg());
  assert.ok(r, '結果が返る');
  assert.equal(r.kind, 'out-and-back');
  assert.ok(Math.abs(r.distanceKm - 40) / 40 <= 0.1, `目標近傍: ${r.distanceKm}`);
  const start = r.coordinates[0];
  const end = r.coordinates[r.coordinates.length - 1];
  assert.ok(haversineKm(start, CENTER) < 0.1, '始点が中心');
  assert.ok(haversineKm(end, CENTER) < 0.1, '終点が中心（往復なのでぴったり戻る）');
});

test('generateRouteCandidate: ループが組めれば loop を返す', async () => {
  // 直線 routeLeg ではループも往復も成立するが、収束ループを優先する。
  const r = await generateRouteCandidate(CENTER, 40, {}, straightLineRouteLeg());
  assert.ok(r, '結果が返る');
  assert.equal(r.kind, 'loop');
});

test('generateRouteCandidate: ループ不可なら往復にフォールバックする', async () => {
  // 1 方位（東 = bearing 90 付近）にしか道がない状況を模す routeLeg。
  // 東向きの脚だけ直線を返し、それ以外は失敗させる。ループは全方位の脚が要る
  // ので失敗 → 一直線に伸ばせる往復が返るはず。
  const eastOnlyLeg = async (from, to) => {
    const dLon = to[0] - from[0];
    const dLat = to[1] - from[1];
    // ほぼ東西方向の脚のみ許可
    if (Math.abs(dLat) > Math.abs(dLon) * 0.5) return { error: 'no_road' };
    const n = Math.max(1, Math.ceil(haversineKm(from, to)));
    const coords = [];
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      coords.push([from[0] + dLon * t, from[1] + dLat * t]);
    }
    return { coordinates: coords };
  };
  const r = await generateRouteCandidate(CENTER, 40, { bearingOffsetDeg: 90 }, eastOnlyLeg);
  assert.ok(r, '結果が返る');
  assert.equal(r.kind, 'out-and-back', `往復になる: ${r.kind}`);
});

test('clampNumber/clampInt: 異常値は fallback / 範囲内に倒す', () => {
  assert.equal(clampNumber('abc', 1, 160, 1), 1, 'NaN は fallback');
  assert.equal(clampNumber(200, 1, 160, 1), 160, '上限クランプ');
  assert.equal(clampNumber(-5, 1, 160, 1), 1, '下限クランプ');
  assert.equal(clampInt(2.9, 1, 3, 3), 2, '整数化（切り捨て）');
  assert.equal(clampInt('x', 1, 3, 3), 3, 'NaN は fallback');
});

test('polylineLengthKm: 区間の合計と一致する', () => {
  const a = [135, 34];
  const b = destinationPoint(a, 90, 3);
  const c = destinationPoint(b, 90, 4);
  const total = polylineLengthKm([a, b, c]);
  assert.ok(Math.abs(total - 7) < 0.05, `≈7km: ${total}`);
});
