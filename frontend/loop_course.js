/* eslint-disable no-await-in-loop */
// 現在地を中心に、総距離が目標 km（最大 160km）の「周回ルート」を 2〜3 本
// 自動生成する純粋ロジック。実際のルーティング（2 点間最短経路）は
// `routeLeg(from, to)` を注入する形にして、ブラウザ / Node の両方から使える
// ようにしている（UMD）。
//
// なぜブラウザ側で動かすか:
//   1 ループは多数の脚（2 点間ルート）からなり、広域（160km）だとグラフが
//   大きい。これを 1 つの Cloudflare Worker リクエストで解くと 128MB/30s の
//   isolate 上限に当たる（単一の大 CSR は exceededMemory、脚ごと逐次 R2 は
//   30s 超）。そこで「脚 = /api/route の 1 リクエスト」とし、ブラウザから脚を
//   並列に投げる。各 /api/route は別 isolate・独立予算・小さな corridor CSR で
//   走るため、広域でも安全かつ高速。
//
// 設計の要点:
//  - 真の周回にするため、円の幾何中心を現在地から基準方位へ半径 ρ だけずらし、
//    現在地が円周上に乗るように配置する（中心⇄円周のスポーク往復が出ない）。
//  - 1 脚が長すぎると corridor 上限（約 25km）を破るので、弦長 <= MAX_LEG_KM に
//    なるよう頂点数を決め、長脚は中間点で分割する。
//  - 目標距離との収束は、返ってきた座標列の haversine 幾何長で測る（重み付き
//    cost に依存しない）。ρ *= target/total で数回反復。
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.LoopCourse = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EARTH_R_KM = 6371.0088; // mean earth radius (km)

  const MAX_TARGET_KM = 160; // 仕様上の上限
  const MIN_TARGET_KM = 1; // これ未満は退化するので下限クランプ
  const DEFAULT_COUNT = 3;
  const MAX_COUNT = 3;
  const MIN_COUNT = 1;
  // 1 脚の直線距離の上限。/api/route は長い脚（≳18km）だと山間部など corridor が
  // 大きい方向で 1102(exceededMemory) になることがある。実測で 12km なら全方位で
  // 安定したため 12km にする（脚は増えるが各リクエストが軽く・速く・安全になる）。
  const MAX_LEG_KM = 12;
  const DEFAULT_TOLERANCE = 0.1; // ±10%
  const MAX_ITERATIONS = 3;
  // 道なりは直線円より長くなる（実測で routed/円 ≈ 1.2〜1.3）。初期半径をその
  // ぶん小さめに置くと、ρ *= target/total の補正が少回数で収束する。
  const INITIAL_RADIUS_FACTOR = 0.82;
  const MIN_VERTEX_COUNT = 6;
  // 1 本の円ループはこの距離を超えると直径（≈ km/π）が大きくなりすぎて、海・山・
  // データ被覆端に当たって生成できない方位が増える。これを超える総距離は「花びら
  // (petal)」に分割し、中心から小さめのループを複数方向に出して中心で繋ぐ
  // （クローバー状）。中心からの最大距離を小さく保ったまま総距離を伸ばせる。
  const SINGLE_LOOP_MAX_KM = 70;
  // petal が割り当て方位で作れないとき、方位を回して再挑戦する順序（度）。
  const PETAL_BEARING_JITTERS = [0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180];
  // 円ループ各頂点の角度・半径のゆらぎ幅（毎回・同じ場所でもルートを変えるため）。
  const DEFAULT_JITTER_FRAC = 0.18;

  // 決定的な擬似乱数 (mulberry32)。seed を変えれば別のルート、同じ seed なら
  // 再現する（テスト用）。Math.random は使わず seed 駆動にしてある。
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // opts.rng があればそれを、なければ opts.seed と salt（方位など）から rng を作る。
  function makeRng(opts, salt) {
    if (opts && typeof opts.rng === 'function') return opts.rng;
    const base = opts && Number.isFinite(opts.seed) ? Math.floor(opts.seed) : 1;
    let s = (base ^ Math.round((salt || 0) * 1000)) >>> 0;
    if (s === 0) s = 1;
    return mulberry32(s);
  }

  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }
  function toDeg(rad) {
    return (rad * 180) / Math.PI;
  }

  /** haversine 距離（km）。点は [lon, lat]。 */
  function haversineKm(a, b) {
    const dLat = toRad(b[1] - a[1]);
    const dLon = toRad(b[0] - a[0]);
    const la1 = toRad(a[1]);
    const la2 = toRad(b[1]);
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /**
   * 始点 [lon, lat] から方位 bearingDeg（北を 0°、時計回り）へ distKm 進んだ
   * 地点を返す。球面の順方向計算。
   */
  function destinationPoint(start, bearingDeg, distKm) {
    const dr = distKm / EARTH_R_KM;
    const br = toRad(bearingDeg);
    const lat1 = toRad(start[1]);
    const lon1 = toRad(start[0]);
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(dr) +
        Math.cos(lat1) * Math.sin(dr) * Math.cos(br)
    );
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(br) * Math.sin(dr) * Math.cos(lat1),
        Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2)
      );
    return [toDeg(lon2), toDeg(lat2)];
  }

  /** 座標列（[[lon,lat],...]）の総延長（km）。 */
  function polylineLengthKm(coords) {
    let total = 0;
    for (let i = 1; i < coords.length; i += 1) {
      total += haversineKm(coords[i - 1], coords[i]);
    }
    return total;
  }

  function clampNumber(value, min, max, fallback) {
    const v = Number(value);
    if (!Number.isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, v));
  }

  function clampInt(value, min, max, fallback) {
    const v = Number(value);
    if (!Number.isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(v)));
  }

  /**
   * 弦長が maxLegKm を超えないために必要な円周上の頂点数を決める。
   * 弦長 = 2*r*sin(π/K) <= maxLegKm を満たす最小の K（ただし下限あり）。
   */
  function chooseVertexCount(radiusKm, maxLegKm) {
    if (radiusKm <= 0) return MIN_VERTEX_COUNT;
    const ratio = maxLegKm / (2 * radiusKm);
    if (ratio >= 1) return MIN_VERTEX_COUNT; // 小さいループは最小頂点で足りる
    const k = Math.ceil(Math.PI / Math.asin(Math.min(1, ratio)));
    return Math.max(MIN_VERTEX_COUNT, k);
  }

  /**
   * 現在地 center を円周上に乗せた周回ループの頂点列を作る。
   * 円の幾何中心を center から基準方位へ radiusKm ずらすことで、center が
   * 円周上の 1 点になる（往復スポークが出ない真の周回）。
   * 返り値の先頭と末尾は center（ループを閉じる）。
   *
   * rng（0..1）と jitterFrac を渡すと、各頂点の角度・半径に ±jitterFrac の
   * ゆらぎを与える。完全な円ではなく不規則な形になり、seed を変えれば毎回
   * 違うルートになる（飽きを防ぐのが目的）。
   */
  function buildLoopVertices(center, radiusKm, vertexCount, bearingOffsetDeg, direction, rng, jitterFrac) {
    const circleCenter = destinationPoint(center, bearingOffsetDeg, radiusKm);
    // 円中心から見た center の方位 ≈ bearingOffsetDeg + 180（この縮尺では十分）。
    const startAngle = bearingOffsetDeg + 180;
    const jf = rng ? (jitterFrac || 0) : 0;
    const stepDeg = 360 / vertexCount;
    const verts = [center.slice()];
    for (let i = 1; i < vertexCount; i += 1) {
      let angle = startAngle + direction * (stepDeg * i);
      let r = radiusKm;
      if (jf > 0) {
        angle += (rng() * 2 - 1) * stepDeg * jf; // ±jf ステップぶん角度をずらす
        r = radiusKm * (1 + (rng() * 2 - 1) * jf); // ±jf 半径を伸縮
      }
      verts.push(destinationPoint(circleCenter, angle, r));
    }
    verts.push(center.slice());
    return verts;
  }

  /** 隣接頂点間が maxLegKm を超える脚を、線形補間した中間点で分割する。 */
  function splitLongLegs(verts, maxLegKm) {
    const out = [verts[0]];
    for (let i = 1; i < verts.length; i += 1) {
      const a = verts[i - 1];
      const b = verts[i];
      const d = haversineKm(a, b);
      const segments = Math.max(1, Math.ceil(d / maxLegKm));
      for (let k = 1; k <= segments; k += 1) {
        const t = k / segments;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return out;
  }

  /**
   * 連続する頂点ペアを routeLeg で結ぶ。脚は互いに独立なので並列に解く
   * （ブラウザからは /api/route への並列リクエストになる）。1 脚でも失敗したら
   * null を返してこの変種を捨てる。
   */
  async function routeAllLegs(waypoints, routeLeg) {
    const pairs = [];
    for (let i = 1; i < waypoints.length; i += 1) {
      pairs.push([waypoints[i - 1], waypoints[i]]);
    }
    const legs = await Promise.all(
      pairs.map(([a, b]) => routeLeg(a, b).catch(() => ({ error: 'route_failed' })))
    );
    for (const leg of legs) {
      if (!leg || leg.error || !Array.isArray(leg.coordinates) || leg.coordinates.length < 2) {
        return null;
      }
    }
    return legs;
  }

  /** 各脚の座標列を連結する（脚の継ぎ目で重複する先頭点を 1 つ落とす）。 */
  function stitchCoordinates(legs) {
    const out = [];
    for (let i = 0; i < legs.length; i += 1) {
      const c = legs[i].coordinates;
      const start = i === 0 ? 0 : 1;
      for (let j = start; j < c.length; j += 1) {
        out.push(c[j]);
      }
    }
    return out;
  }

  /**
   * 1 本の周回ループを生成する。ρ（円半径）を ρ *= target/total で反復補正し、
   * 目標距離 ±tolerance に収束させる。収束しなくても最良の試行を返す。
   * 全反復でルーティングに失敗した場合は null。
   */
  async function generateLoopCourse(center, targetKm, opts, routeLeg) {
    const {
      bearingOffsetDeg = 0,
      direction = 1,
      tolerance = DEFAULT_TOLERANCE,
      maxLegKm = MAX_LEG_KM,
      maxIterations = MAX_ITERATIONS,
      routeLegFactory,
      jitterFrac = DEFAULT_JITTER_FRAC
    } = opts || {};
    const rng = makeRng(opts, bearingOffsetDeg);

    // routeLegFactory が与えられた場合、この変種専用の routeLeg を 1 回だけ作る。
    let leg = routeLeg;
    if (typeof routeLegFactory === 'function') {
      try {
        leg = await routeLegFactory({ center, targetKm, bearingOffsetDeg, direction });
      } catch (_) {
        return null;
      }
    }
    if (typeof leg !== 'function') return null;

    let radiusKm = (targetKm / (2 * Math.PI)) * INITIAL_RADIUS_FACTOR;
    let best = null;

    for (let iter = 0; iter < maxIterations; iter += 1) {
      const vertexCount = chooseVertexCount(radiusKm, maxLegKm);
      const rim = buildLoopVertices(center, radiusKm, vertexCount, bearingOffsetDeg, direction, rng, jitterFrac);
      const waypoints = splitLongLegs(rim, maxLegKm);
      const legs = await routeAllLegs(waypoints, leg);
      if (!legs) {
        radiusKm *= 0.8;
        continue;
      }
      const coordinates = stitchCoordinates(legs);
      const distanceKm = polylineLengthKm(coordinates);
      const errRatio = targetKm > 0 ? Math.abs(distanceKm - targetKm) / targetKm : Infinity;
      if (!best || errRatio < best.errRatio) {
        best = {
          coordinates,
          distanceKm,
          waypoints,
          errRatio,
          iterations: iter + 1,
          bearingOffsetDeg,
          direction,
          converged: errRatio <= tolerance
        };
      }
      if (errRatio <= tolerance) {
        return best;
      }
      const factor = clampNumber(targetKm / distanceKm, 0.5, 2, 1);
      radiusKm *= factor;
    }
    return best;
  }

  /** 総距離 targetKm を何枚の花びらに分けるか（1 枚 = 単一円ループ）。 */
  function petalCountFor(targetKm) {
    return Math.max(1, Math.ceil(targetKm / SINGLE_LOOP_MAX_KM));
  }

  /**
   * 総距離 targetKm の周回ルートを 1 本生成する。targetKm が大きいときは複数の
   * 花びら（petal）に分割し、中心から各方位へ小ループを出して中心で繋ぐ
   * （クローバー状）。各 petal は中心↔中心の小ループで、繋ぐと出発点に戻る。
   * 花びらにすることで中心からの最大距離を小さく保て、被覆内で長距離を作れる。
   * targetKm が小さい場合は従来どおり単一の円ループ。
   */
  async function generateExtendedCourse(center, targetKm, opts, routeLeg) {
    const o = opts || {};
    const petals = petalCountFor(targetKm);
    if (petals === 1) {
      return generateLoopCourse(center, targetKm, o, routeLeg);
    }
    const { bearingOffsetDeg = 0, direction = 1, tolerance = DEFAULT_TOLERANCE } = o;
    const petalKm = targetKm / petals;
    const step = 360 / petals;
    const coordsAll = [];
    let total = 0;
    const used = [];

    for (let k = 0; k < petals; k += 1) {
      let petal = null;
      // 割り当て方位で作れなければ方位を回してリトライ（海・山方向を避ける）。
      for (const jitter of PETAL_BEARING_JITTERS) {
        const b = bearingOffsetDeg + step * k + jitter;
        // eslint-disable-next-line no-await-in-loop
        petal = await generateLoopCourse(center, petalKm, { ...o, bearingOffsetDeg: b, direction }, routeLeg);
        if (petal) {
          used.push(((b % 360) + 360) % 360);
          break;
        }
      }
      if (!petal) return null; // どの方位でもこの petal を作れない地点 → 変種失敗
      const c = petal.coordinates;
      if (coordsAll.length === 0) {
        for (let i = 0; i < c.length; i += 1) coordsAll.push(c[i]);
      } else {
        // 直前の petal 終端と今 petal 始点はどちらも中心なので 1 個飛ばし
        for (let i = 1; i < c.length; i += 1) coordsAll.push(c[i]);
      }
      total += petal.distanceKm;
    }

    const errRatio = targetKm > 0 ? Math.abs(total - targetKm) / targetKm : Infinity;
    return {
      coordinates: coordsAll,
      distanceKm: total,
      errRatio,
      converged: errRatio <= tolerance,
      bearingOffsetDeg,
      direction,
      iterations: petals,
      petals,
      petalBearings: used
    };
  }

  /**
   * 往復（out-and-back）ルートを 1 本生成する。中心から基準方位へ「片道 ≈
   * targetKm/2」のスパーク（複数脚に分割）を出して折り返す。復路は完全な
   * 逆走（ピンポン）ではなく、横にふくらませた別の道を通す（行き帰りで景色が
   * 変わるように）。膨らませた復路が組めない場合のみ逆走にフォールバック。
   * その方向に道さえあれば成立するので、海沿い・山際などループが組めない地点
   * でも目標距離を満たしやすい。往路 spoke 長を反復補正して総距離 ±tolerance に
   * 収束させる。作れない場合は null。
   */
  async function generateOutAndBackCourse(center, targetKm, opts, routeLeg) {
    const {
      bearingOffsetDeg = 0,
      direction = 1,
      tolerance = DEFAULT_TOLERANCE,
      maxLegKm = MAX_LEG_KM,
      maxIterations = MAX_ITERATIONS,
      routeLegFactory
    } = opts || {};

    // generateLoopCourse と同様、factory があればこの変種専用の routeLeg を作る。
    let leg = routeLeg;
    if (typeof routeLegFactory === 'function') {
      try {
        leg = await routeLegFactory({ center, targetKm, bearingOffsetDeg, direction });
      } catch (_) {
        return null;
      }
    }
    if (typeof leg !== 'function') return null;

    const rng = makeRng(opts, bearingOffsetDeg + 7); // ループと違う salt
    const side = rng() < 0.5 ? 1 : -1; // 復路をどちら側にふくらませるか
    const lateralFrac = 0.18 + rng() * 0.2; // 片道に対する横ふくらみ（0.18〜0.38）

    // 復路がふくらむぶん総距離は往路の 2 倍より少し長い。spoke を控えめに置く。
    let spokeKm = (targetKm / 2) * INITIAL_RADIUS_FACTOR * 0.92;
    let best = null;

    for (let iter = 0; iter < maxIterations; iter += 1) {
      const turnaround = destinationPoint(center, bearingOffsetDeg, spokeKm);
      const outWaypoints = splitLongLegs([center.slice(), turnaround], maxLegKm);
      // eslint-disable-next-line no-await-in-loop
      const outLegs = await routeAllLegs(outWaypoints, leg);
      if (!outLegs) {
        spokeKm *= 0.8;
        continue;
      }
      const outCoords = stitchCoordinates(outLegs);

      // 復路: spoke の中点を直交方向へずらした点を経由（= 横にふくらむ別ルート）。
      const mid = [(center[0] + turnaround[0]) / 2, (center[1] + turnaround[1]) / 2];
      const bow = destinationPoint(mid, bearingOffsetDeg + 90 * side, spokeKm * lateralFrac);
      const retWaypoints = splitLongLegs([turnaround, bow, center.slice()], maxLegKm);
      // eslint-disable-next-line no-await-in-loop
      const retLegs = await routeAllLegs(retWaypoints, leg);

      let coordinates;
      if (retLegs) {
        // 往路 + ふくらんだ復路（折り返し点の重複を 1 個飛ばす）。
        coordinates = outCoords.concat(stitchCoordinates(retLegs).slice(1));
      } else {
        // ふくらみ復路が作れない方向は逆走にフォールバック。
        coordinates = outCoords.concat(outCoords.slice(0, -1).reverse());
      }
      const totalKm = polylineLengthKm(coordinates);
      const errRatio = targetKm > 0 ? Math.abs(totalKm - targetKm) / targetKm : Infinity;
      if (!best || errRatio < best.errRatio) {
        best = {
          coordinates,
          distanceKm: totalKm,
          errRatio,
          iterations: iter + 1,
          bearingOffsetDeg,
          direction,
          converged: errRatio <= tolerance,
          kind: 'out-and-back'
        };
      }
      if (errRatio <= tolerance) return best;
      spokeKm *= clampNumber(targetKm / totalKm, 0.5, 2, 1);
    }
    return best;
  }

  /**
   * 1 本の候補を生成する。まず周回ループ（必要なら花びら）を試し、収束しなければ
   * 往復も試して、目標距離に近い／収束した方を返す。どちらも作れなければ null。
   * 返り値に kind ('loop' | 'out-and-back') を含む。
   */
  async function generateRouteCandidate(center, targetKm, opts, routeLeg) {
    const loop = await generateExtendedCourse(center, targetKm, opts, routeLeg);
    if (loop && loop.converged) return { ...loop, kind: 'loop' };
    const oab = await generateOutAndBackCourse(center, targetKm, opts, routeLeg);
    const cands = [];
    if (loop) cands.push({ ...loop, kind: 'loop' });
    if (oab) cands.push(oab);
    if (cands.length === 0) return null;
    // 収束しているものを優先、その中で誤差が小さい順。
    cands.sort((a, b) => {
      if (!!a.converged !== !!b.converged) return a.converged ? -1 : 1;
      return a.errRatio - b.errRatio;
    });
    return cands[0];
  }

  /**
   * 周回ルートを count 本生成する。基準方位を 360/count ずつ回転し、周回方向を
   * 交互に振って作り分ける。失敗に備えて余分な候補（半ステップずらし）を用意し、
   * 成功したものから count 本選ぶ。目標距離に近い順に並べて返す。
   * 変種どうしは独立なので並列に生成する。
   */
  async function generateLoopCourses(center, targetKm, count, routeLeg, opts) {
    const tgt = clampNumber(targetKm, MIN_TARGET_KM, MAX_TARGET_KM, MIN_TARGET_KM);
    const wanted = clampInt(count, MIN_COUNT, MAX_COUNT, DEFAULT_COUNT);
    const cfg = opts || {};
    const baseStep = 360 / wanted;

    const primary = [];
    for (let i = 0; i < wanted; i += 1) {
      primary.push({ bearingOffsetDeg: i * baseStep, direction: i % 2 === 0 ? 1 : -1 });
    }
    // 予備候補（一部が失敗したとき用に半ステップずらす）。
    const fallback = [];
    for (let i = 0; i < wanted; i += 1) {
      fallback.push({
        bearingOffsetDeg: i * baseStep + baseStep / 2,
        direction: i % 2 === 0 ? -1 : 1
      });
    }

    const run = (c) => generateRouteCandidate(center, tgt, { ...cfg, ...c }, routeLeg);

    // まず本命を並列実行。足りなければ予備を足す。
    let courses = (await Promise.all(primary.map(run))).filter(Boolean);
    if (courses.length < wanted) {
      const more = (await Promise.all(fallback.map(run))).filter(Boolean);
      courses = courses.concat(more);
    }

    courses.sort((a, b) => a.errRatio - b.errRatio);
    return {
      target_km: tgt,
      requested: wanted,
      courses: courses.slice(0, wanted)
    };
  }

  return {
    generateLoopCourses,
    generateLoopCourse,
    generateExtendedCourse,
    generateOutAndBackCourse,
    generateRouteCandidate,
    petalCountFor,
    haversineKm,
    destinationPoint,
    polylineLengthKm,
    buildLoopVertices,
    splitLongLegs,
    chooseVertexCount,
    stitchCoordinates,
    clampNumber,
    clampInt,
    MAX_TARGET_KM,
    MIN_TARGET_KM,
    DEFAULT_COUNT,
    MAX_COUNT,
    MIN_COUNT,
    MAX_LEG_KM,
    DEFAULT_TOLERANCE,
    SINGLE_LOOP_MAX_KM
  };
});
