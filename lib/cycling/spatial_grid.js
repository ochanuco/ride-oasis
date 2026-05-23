'use strict';

const DEFAULT_CELL_DEG = 0.005;

class SpatialGrid {
  constructor(cellDeg = DEFAULT_CELL_DEG) {
    this.cellDeg = cellDeg;
    this.cells = new Map();
    this._size = 0;
  }

  get size() {
    return this._size;
  }

  _key(cx, cy) {
    return `${cx},${cy}`;
  }

  _cellOf(lon, lat) {
    return [Math.floor(lon / this.cellDeg), Math.floor(lat / this.cellDeg)];
  }

  add(id, lon, lat) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    const [cx, cy] = this._cellOf(lon, lat);
    const k = this._key(cx, cy);
    let arr = this.cells.get(k);
    if (!arr) {
      arr = [];
      this.cells.set(k, arr);
    }
    arr.push(id, lon, lat);
    this._size += 1;
  }

  nearest(lon, lat, maxRings = 16) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    const [cx, cy] = this._cellOf(lon, lat);
    let best = null;
    let bestDistSq = Infinity;
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const scaleLon = cosLat * 111320;
    const scaleLat = 110540;

    // クエリは中心セル内のどこに居るか分からないため、ring 1 (隣接 8 セル)
    // までは常に走査して "セル境界をまたぐ最近傍" を取りこぼさない。ring k>=2
    // の任意のセルの最近点はクエリから最低 (k-1)*cellMeters は離れているので、
    // それ以上の半径しか期待値が無いと分かったら打ち切る。
    const cellMeters = this.cellDeg * Math.min(scaleLon, scaleLat);
    for (let ring = 0; ring <= maxRings; ring += 1) {
      if (best !== null && ring >= 2) {
        const ringInnerMeters = (ring - 1) * cellMeters;
        if (ringInnerMeters * ringInnerMeters > bestDistSq) break;
      }
      for (let dy = -ring; dy <= ring; dy += 1) {
        for (let dx = -ring; dx <= ring; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const arr = this.cells.get(this._key(cx + dx, cy + dy));
          if (!arr) continue;
          for (let i = 0; i < arr.length; i += 3) {
            const id = arr[i];
            const nlon = arr[i + 1];
            const nlat = arr[i + 2];
            const dxm = (nlon - lon) * scaleLon;
            const dym = (nlat - lat) * scaleLat;
            const d2 = dxm * dxm + dym * dym;
            if (d2 < bestDistSq) {
              bestDistSq = d2;
              best = id;
            }
          }
        }
      }
    }
    if (best === null) return null;
    return { id: best, distanceMeters: Math.sqrt(bestDistSq) };
  }
}

module.exports = { SpatialGrid, DEFAULT_CELL_DEG };
