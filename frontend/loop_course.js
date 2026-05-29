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
  // 1 脚の直線距離の上限（ルーターの corridor/segment 上限 25km より余裕を持たせる）
  const MAX_LEG_KM = 18;
  const DEFAULT_TOLERANCE = 0.1; // ±10%
  const MAX_ITERATIONS = 3;
  const MIN_VERTEX_COUNT = 6;

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
   */
  function buildLoopVertices(center, radiusKm, vertexCount, bearingOffsetDeg, direction) {
    const circleCenter = destinationPoint(center, bearingOffsetDeg, radiusKm);
    // 円中心から見た center の方位 ≈ bearingOffsetDeg + 180（この縮尺では十分）。
    const startAngle = bearingOffsetDeg + 180;
    const verts = [center.slice()];
    for (let i = 1; i < vertexCount; i += 1) {
      const angle = startAngle + direction * ((360 * i) / vertexCount);
      verts.push(destinationPoint(circleCenter, angle, radiusKm));
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
      routeLegFactory
    } = opts || {};

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

    let radiusKm = targetKm / (2 * Math.PI);
    let best = null;

    for (let iter = 0; iter < maxIterations; iter += 1) {
      const vertexCount = chooseVertexCount(radiusKm, maxLegKm);
      const rim = buildLoopVertices(center, radiusKm, vertexCount, bearingOffsetDeg, direction);
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

    const run = (c) => generateLoopCourse(center, tgt, { ...cfg, ...c }, routeLeg);

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
    DEFAULT_TOLERANCE
  };
});
