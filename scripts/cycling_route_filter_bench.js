'use strict';

// Bench: pointToRouteDistanceMeters (JS) vs route_distances (Rust WASM).
// ブルベ規模の synthetic data で M = 1000 shops × N = 5000 route segments を
// 1 回 batch 計算し、wall time を比較する。
//
// 期待: WASM が JS 比 5-10x 速い。

const { route_distances } = require('../vendor/wasm/nodejs/router_wasm.js');
const path = require('path');

// JS 版 (frontend/route_math.js と同じ実装)
function toRadians(v) { return (v * Math.PI) / 180; }
const EARTH_R = 6371008.8;
function project(lon, lat, refLat) {
  const cosRef = Math.cos(toRadians(refLat));
  return [EARTH_R * toRadians(lon) * cosRef, EARTH_R * toRadians(lat)];
}
function pointToSegment(p, a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const ab2 = abx * abx + aby * aby;
  if (ab2 === 0) {
    const dx = p[0] - a[0], dy = p[1] - a[1];
    return Math.hypot(dx, dy);
  }
  const apx = p[0] - a[0];
  const apy = p[1] - a[1];
  let t = (apx * abx + apy * aby) / ab2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = a[0] + abx * t;
  const cy = a[1] + aby * t;
  return Math.hypot(p[0] - cx, p[1] - cy);
}
function jsRouteDistances(routeLL, shopLL) {
  const n = routeLL.length;
  const m = shopLL.length;
  let latSum = 0;
  for (const c of routeLL) latSum += c[1];
  const refLat = latSum / n;
  const projRoute = routeLL.map(([lon, lat]) => project(lon, lat, refLat));
  const out = new Float32Array(m);
  for (let k = 0; k < m; k += 1) {
    const p = project(shopLL[k][0], shopLL[k][1], refLat);
    let minD = Infinity;
    for (let i = 1; i < n; i += 1) {
      const d = pointToSegment(p, projRoute[i - 1], projRoute[i]);
      if (d < minD) minD = d;
    }
    out[k] = minD;
  }
  return out;
}

function makeRoute(n) {
  // 200km route 模擬: 大阪→京都 (約 50km 直線) を n 点で
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    out.push([135.5 + 0.5 * t, 34.7 + 0.5 * t]);
  }
  return out;
}
function makeShops(m, seed = 12345) {
  let s = seed;
  const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff;
  const out = [];
  for (let i = 0; i < m; i += 1) {
    out.push([135.5 + 0.5 * rand(), 34.7 + 0.5 * rand()]);
  }
  return out;
}

function flatten(arr) {
  const out = new Float64Array(arr.length * 2);
  for (let i = 0; i < arr.length; i += 1) {
    out[i * 2] = arr[i][0];
    out[i * 2 + 1] = arr[i][1];
  }
  return out;
}

function bench(label, fn, iters = 3) {
  // warmup
  fn();
  const times = [];
  for (let i = 0; i < iters; i += 1) {
    const t0 = process.hrtime.bigint();
    fn();
    const t1 = process.hrtime.bigint();
    times.push(Number(t1 - t0) / 1e6);
  }
  const min = Math.min(...times);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`[${label}] min=${min.toFixed(1)}ms avg=${avg.toFixed(1)}ms (n=${iters})`);
  return min;
}

function main() {
  const scenarios = [
    [500, 300],   // small (3km route, 300 shops)
    [1000, 500],  // medium
    [3000, 1000], // brevet (200km route, 1000 shops)
    [5000, 1000], // brevet long
  ];
  console.log('| scenario        | JS (ms) | WASM (ms) | speedup | max diff (m) |');
  console.log('|-----------------|---------|-----------|---------|--------------|');
  for (const [n, m] of scenarios) {
    const route = makeRoute(n);
    const shops = makeShops(m);
    const routeFlat = flatten(route);
    const shopFlat = flatten(shops);

    let jsOut, wasmOut;
    const jsMs = bench(`${n}x${m} JS`, () => { jsOut = jsRouteDistances(route, shops); }, 3);
    const wasmMs = bench(`${n}x${m} WASM`, () => { wasmOut = route_distances(routeFlat, shopFlat); }, 3);

    // diff check (Float32 precision)。長さ不一致を見落とすと検証が崩れる
    // ので最初に明示チェック (CodeRabbit PR #89 指摘)。
    if (!wasmOut || jsOut.length !== wasmOut.length) {
      throw new Error(`Output length mismatch: js=${jsOut?.length} wasm=${wasmOut?.length}`);
    }
    let maxDiff = 0;
    for (let i = 0; i < jsOut.length; i += 1) {
      const d = Math.abs(jsOut[i] - wasmOut[i]);
      if (d > maxDiff) maxDiff = d;
    }
    const speedup = (jsMs / wasmMs).toFixed(1);
    console.log(`| ${(n + 'x' + m).padEnd(15)} | ${jsMs.toFixed(0).padStart(7)} | ${wasmMs.toFixed(0).padStart(9)} | ${speedup.padStart(6)}x | ${maxDiff.toFixed(2).padStart(11)} |`);
  }
}

main();
