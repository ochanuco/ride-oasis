'use strict';

const { MinHeap } = require('./min_heap');
const {
  neighborhoodKeys,
  corridorKeys
} = require('./tile_partition');

const MAX_SNAP_METERS = 500;
// Beyond ~15km straight-line, bidirectional Dijkstra on the un-contracted
// tile graph blows past the Workers CPU budget (1102) before completing.
// We bail out early so the frontend can show a clear message instead of a
// generic 503. Lift this only after CH is wired into the tiled query path.
const MAX_STRAIGHT_LINE_METERS = 15000;
// Defense in depth against pathological inputs: even within the straight-line
// cap, padding/cellDeg combinations or future config changes shouldn't allow
// thousands of tiles to be fetched per request.
const MAX_CORRIDOR_TILES = 64;

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
    const r = bidiDijkstraOnView(view, fromSnap.id, toSnap.id);
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
  bidiDijkstraOnView,
  straightLineMeters
};
