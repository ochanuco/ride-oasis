'use strict';

// DNF (Did Not Finish) pack: route + 周辺 supply-point を 1 リクエストで
// 返すための補助。スマホ・モバイル回線でリクエスト数を減らすことで
// TLS hello / TCP handshake / DNS の repeat を削減し、バッテリ・通信
// 時間を抑える。CH/A* で計算した route geometry に対し Douglas-Peucker
// で頂点を間引き、ペイロードを半分以下にする。

const EARTH_R = 6378137; // meters

/**
 * Haversine 距離 (m)。Cycling 用途では 100m 単位の精度で十分なので
 * 球面近似で OK。tile_loader と同じ式に揃えている。
 */
function haversineMeters(aLon, aLat, bLon, bLat) {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLon = (bLon - aLon) * toRad;
  const lat1 = aLat * toRad;
  const lat2 = bLat * toRad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(s));
}

/**
 * 点 P (pLon, pLat) と線分 (a, b) との垂直距離 (m)。equirectangular
 * projection (緯度補正済の x/y) で近似してから直線距離を求める。
 * 自転車スケール (せいぜい数 km) では haversine との誤差は無視できる。
 */
function perpendicularMeters(pLon, pLat, aLon, aLat, bLon, bLat) {
  // 局所平面近似: lat0 で経度を縮める
  const lat0 = (aLat + bLat) * 0.5 * (Math.PI / 180);
  const mPerDegLat = 111320;
  const mPerDegLon = mPerDegLat * Math.cos(lat0);
  const ax = aLon * mPerDegLon, ay = aLat * mPerDegLat;
  const bx = bLon * mPerDegLon, by = bLat * mPerDegLat;
  const px = pLon * mPerDegLon, py = pLat * mPerDegLat;
  const dx = bx - ax, dy = by - ay;
  const segLen2 = dx * dx + dy * dy;
  if (segLen2 === 0) return Math.hypot(px - ax, py - ay);
  // 投影パラメタ t を [0,1] にクランプ
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / segLen2));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}

/**
 * Douglas-Peucker 線分単純化 (反復実装、再帰スタック消費を避ける)。
 * tolerance_m は許容ズレ。cycling 用途では 5-10m が表示上自然な値。
 * 入力 coords は [[lon, lat], ...]。返り値は同形式の配列。
 * 入力が 2 点以下、もしくは tolerance <= 0 なら原配列をそのまま返す。
 */
function douglasPeucker(coords, toleranceMeters) {
  if (!Array.isArray(coords) || coords.length <= 2 || toleranceMeters <= 0) {
    return coords;
  }
  const n = coords.length;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  // [start, end] の区間スタック。両端含む。
  const stack = [[0, n - 1]];
  while (stack.length > 0) {
    const [s, e] = stack.pop();
    if (e - s < 2) continue;
    const [aLon, aLat] = coords[s];
    const [bLon, bLat] = coords[e];
    let maxD = -1;
    let maxIdx = -1;
    for (let i = s + 1; i < e; i += 1) {
      const [pLon, pLat] = coords[i];
      const d = perpendicularMeters(pLon, pLat, aLon, aLat, bLon, bLat);
      if (d > maxD) {
        maxD = d;
        maxIdx = i;
      }
    }
    if (maxD > toleranceMeters && maxIdx !== -1) {
      keep[maxIdx] = 1;
      stack.push([s, maxIdx]);
      stack.push([maxIdx, e]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i += 1) {
    if (keep[i]) out.push(coords[i]);
  }
  return out;
}

/**
 * coords (LineString 想定) の bbox + buffer_m。buffer は地表面で
 * メートル指定。緯度に応じて経度 buffer を補正する。bbox は
 * supply-points D1 クエリの :minLng/:maxLng/:minLat/:maxLat に直接渡す。
 */
function routeBBoxWithBuffer(coords, bufferMeters) {
  if (!Array.isArray(coords) || coords.length === 0) {
    return null;
  }
  let minLon = Infinity, maxLon = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;
  for (const c of coords) {
    if (c[0] < minLon) minLon = c[0];
    if (c[0] > maxLon) maxLon = c[0];
    if (c[1] < minLat) minLat = c[1];
    if (c[1] > maxLat) maxLat = c[1];
  }
  const meanLat = (minLat + maxLat) * 0.5;
  const latBuf = bufferMeters / 111320;
  const lonBuf = bufferMeters / (111320 * Math.max(0.01, Math.cos(meanLat * Math.PI / 180)));
  return {
    minLng: minLon - lonBuf,
    maxLng: maxLon + lonBuf,
    minLat: minLat - latBuf,
    maxLat: maxLat + latBuf
  };
}

module.exports = {
  haversineMeters,
  perpendicularMeters,
  douglasPeucker,
  routeBBoxWithBuffer
};
