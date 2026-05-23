'use strict';

const { MinHeap } = require('./min_heap');
const {
  neighborhoodKeys,
  corridorKeys
} = require('./tile_partition');

const MAX_SNAP_METERS = 500;
// Forward A* で旧 bidi Dijkstra より settled は ~1.7x 減 (3km: 19k → 11k)。
// ただし MIN_COST_FACTOR (0.7) を使う admissible heuristic は primary 道路
// (factor 1.6) で 44% しか効かないため、実機の cap は実測で 15km のまま
// (16km 以上は 1102)。CH 本格統合まではこの cap を維持し、cold path 短縮
// 効果 (~25%) のみ取りに行く。
const MAX_STRAIGHT_LINE_METERS = 15000;
const MAX_CORRIDOR_TILES = 64;

// COST_FACTOR の最小値 (cycleway = 0.7) を A* heuristic の係数に使う。
// 任意の道路エッジで cost >= length * 0.7 が保証されるため、heuristic
// haversine * 0.7 は admissible で consistent (= 最適性を保証する)。
const MIN_COST_FACTOR = 0.7;

function straightLineMeters(fromLon, fromLat, toLon, toLat) {
  const refLat = (fromLat + toLat) / 2;
  const cosLat = Math.cos((refLat * Math.PI) / 180);
  const dxm = (toLon - fromLon) * cosLat * 111320;
  const dym = (toLat - fromLat) * 110540;
  return Math.hypot(dxm, dym);
}

class TiledRouter {
  constructor(tileLoader, opts = {}) {
    this.tileLoader = tileLoader;
    this.maxSnapMeters = opts.maxSnapMeters ?? MAX_SNAP_METERS;
    this.maxStraightLineMeters = opts.maxStraightLineMeters ?? MAX_STRAIGHT_LINE_METERS;
    this.maxCorridorTiles = opts.maxCorridorTiles ?? MAX_CORRIDOR_TILES;
    this.corridorPadding = opts.corridorPadding ?? 1;
    this.snapNeighborhoodRadius = opts.snapNeighborhoodRadius ?? 1;
  }

  async _snap(lon, lat) {
    await this.tileLoader.loadMany(
      neighborhoodKeys(lon, lat, this.snapNeighborhoodRadius)
    );
    return this.tileLoader.grid.nearest(lon, lat, 8);
  }

  async route(fromLon, fromLat, toLon, toLat) {
    const straightLine = straightLineMeters(fromLon, fromLat, toLon, toLat);
    if (straightLine > this.maxStraightLineMeters) {
      return {
        error: 'too_far',
        straight_line_m: straightLine,
        max_straight_line_m: this.maxStraightLineMeters
      };
    }

    const corridor = corridorKeys(fromLon, fromLat, toLon, toLat, this.corridorPadding);
    if (corridor.length > this.maxCorridorTiles) {
      return {
        error: 'corridor_too_large',
        corridor_tiles: corridor.length,
        max_corridor_tiles: this.maxCorridorTiles
      };
    }
    await this.tileLoader.loadMany(corridor);

    const fromSnap = await this._snap(fromLon, fromLat);
    if (!fromSnap || fromSnap.distanceMeters > this.maxSnapMeters) {
      return { error: 'no_nearby_node_from' };
    }
    const toSnap = await this._snap(toLon, toLat);
    if (!toSnap || toSnap.distanceMeters > this.maxSnapMeters) {
      return { error: 'no_nearby_node_to' };
    }

    const view = this.tileLoader.view;
    const r = aStarOnView(view, fromSnap.id, toSnap.id);
    if (!Number.isFinite(r.distance)) {
      return {
        error: 'unreachable_in_corridor',
        from_node: fromSnap.id,
        to_node: toSnap.id,
        loaded_tiles: this.tileLoader.loaded.size
      };
    }
    const coordinates = r.path.map((id) => view.nodes.get(id)).filter(Boolean);
    return {
      distance_cost: r.distance,
      node_count: r.path.length,
      settled: r.settled,
      snap_from_m: fromSnap.distanceMeters,
      snap_to_m: toSnap.distanceMeters,
      loaded_tiles: this.tileLoader.loaded.size,
      coordinates
    };
  }
}

/**
 * Forward A* on the loaded tile view. Heuristic は直線距離 (緯度補正済
 * Euclidean 近似) × 最小コスト係数 (cycleway の 0.7) で admissible + consistent。
 * Kansai スケールでは球面 haversine との差は無視できる範囲。
 *
 * 内部状態 (dist/parent/settled) は Map/Set ではなく typed array で持つ。
 * ノード ID は密でないため view.nodeIdToIndex で連続インデックスに射影し、
 * Float64Array(N) / Int32Array(N) / Uint8Array(N) を確保する。算術コスト
 * は同じだが、Map.set/get の per-entry GC アロケーションが消えて isolate
 * 内の GC 圧 + warm path レイテンシが下がる。
 */
function aStarOnView(view, startId, goalId) {
  if (startId === goalId) {
    return { distance: 0, path: [startId], settled: 0 };
  }
  const goalCoord = view.nodes.get(goalId);
  if (!goalCoord) {
    return { distance: Infinity, path: [], settled: 0 };
  }
  // 公開関数として旧形式 view (sidecar 未設定) でも落ちないようフォールバック。
  // TileLoader 経由なら 0 コスト (既に同期構築済)。手作り view では view.nodes
  // から都度生成する。
  let idToIdx = view.nodeIdToIndex;
  let idxToId = view.indexToNodeId;
  if (!(idToIdx instanceof Map) || !Array.isArray(idxToId)) {
    idToIdx = new Map();
    idxToId = [];
    for (const id of view.nodes.keys()) {
      idToIdx.set(id, idxToId.length);
      idxToId.push(id);
    }
  }
  const startIdx = idToIdx.get(startId);
  const goalIdx = idToIdx.get(goalId);
  if (startIdx === undefined || goalIdx === undefined) {
    return { distance: Infinity, path: [], settled: 0 };
  }
  const N = idxToId.length;
  const goalLat = goalCoord[1];
  const goalLon = goalCoord[0];

  const dist = new Float64Array(N);
  dist.fill(Infinity);
  const parent = new Int32Array(N);
  parent.fill(-1);
  const settled = new Uint8Array(N);
  const heap = new MinHeap();

  const heuristic = (id) => {
    const c = view.nodes.get(id);
    if (!c) return 0;
    const refLat = (c[1] + goalLat) / 2;
    const cosLat = Math.cos((refLat * Math.PI) / 180);
    const dxm = (goalLon - c[0]) * cosLat * 111320;
    const dym = (goalLat - c[1]) * 110540;
    return Math.hypot(dxm, dym) * MIN_COST_FACTOR;
  };

  dist[startIdx] = 0;
  heap.push(heuristic(startId), startIdx);
  let settledCount = 0;

  while (heap.size > 0) {
    const { val: uIdx } = heap.pop();
    if (settled[uIdx]) continue;
    settled[uIdx] = 1;
    settledCount += 1;
    if (uIdx === goalIdx) break;

    const u = idxToId[uIdx];
    const g = dist[uIdx];
    for (const e of view.fwd.get(u) || []) {
      const vIdx = idToIdx.get(e.to);
      if (vIdx === undefined || settled[vIdx]) continue;
      const ng = g + e.cost;
      if (ng < dist[vIdx]) {
        dist[vIdx] = ng;
        parent[vIdx] = uIdx;
        heap.push(ng + heuristic(e.to), vIdx);
      }
    }
  }

  if (!Number.isFinite(dist[goalIdx])) {
    return { distance: Infinity, path: [], settled: settledCount };
  }

  const path = [];
  let curIdx = goalIdx;
  while (curIdx !== -1) {
    path.push(idxToId[curIdx]);
    curIdx = parent[curIdx];
  }
  path.reverse();

  return { distance: dist[goalIdx], path, settled: settledCount };
}

function bidiDijkstraOnView(view, startId, goalId) {
  if (startId === goalId) {
    return { distance: 0, path: [startId], settled: 0 };
  }
  const distF = new Map([[startId, 0]]);
  const distB = new Map([[goalId, 0]]);
  const parentF = new Map();
  const parentB = new Map();
  const settledF = new Set();
  const settledB = new Set();
  const heapF = new MinHeap();
  const heapB = new MinHeap();
  heapF.push(0, startId);
  heapB.push(0, goalId);
  let best = Infinity;
  let meeting = null;
  const tryMeet = (u, df, db) => {
    const sum = df + db;
    if (sum < best) {
      best = sum;
      meeting = u;
    }
  };
  while (heapF.size > 0 && heapB.size > 0) {
    if (heapF.peek().key + heapB.peek().key >= best) break;
    if (heapF.peek().key <= heapB.peek().key) {
      const { key: d, val: u } = heapF.pop();
      if (settledF.has(u)) continue;
      if (d > (distF.get(u) ?? Infinity)) continue;
      settledF.add(u);
      const db = distB.get(u);
      if (db !== undefined) tryMeet(u, d, db);
      for (const e of view.fwd.get(u) || []) {
        if (settledF.has(e.to)) continue;
        const nd = d + e.cost;
        if (nd < (distF.get(e.to) ?? Infinity)) {
          distF.set(e.to, nd);
          parentF.set(e.to, u);
          heapF.push(nd, e.to);
          const dbTo = distB.get(e.to);
          if (dbTo !== undefined) tryMeet(e.to, nd, dbTo);
        }
      }
    } else {
      const { key: d, val: u } = heapB.pop();
      if (settledB.has(u)) continue;
      if (d > (distB.get(u) ?? Infinity)) continue;
      settledB.add(u);
      const df = distF.get(u);
      if (df !== undefined) tryMeet(u, df, d);
      for (const e of view.rev.get(u) || []) {
        if (settledB.has(e.from)) continue;
        const nd = d + e.cost;
        if (nd < (distB.get(e.from) ?? Infinity)) {
          distB.set(e.from, nd);
          parentB.set(e.from, u);
          heapB.push(nd, e.from);
          const dfFrom = distF.get(e.from);
          if (dfFrom !== undefined) tryMeet(e.from, dfFrom, nd);
        }
      }
    }
  }
  if (meeting === null || !Number.isFinite(best)) {
    return { distance: Infinity, path: [], settled: settledF.size + settledB.size };
  }
  const pathF = [];
  let cur = meeting;
  while (cur !== undefined) {
    pathF.push(cur);
    cur = parentF.get(cur);
  }
  pathF.reverse();
  const pathB = [];
  cur = parentB.get(meeting);
  while (cur !== undefined) {
    pathB.push(cur);
    cur = parentB.get(cur);
  }
  return {
    distance: best,
    path: pathF.concat(pathB),
    settled: settledF.size + settledB.size
  };
}

module.exports = {
  TiledRouter,
  MAX_SNAP_METERS,
  MAX_STRAIGHT_LINE_METERS,
  MAX_CORRIDOR_TILES,
  MIN_COST_FACTOR,
  aStarOnView,
  bidiDijkstraOnView,
  straightLineMeters
};
