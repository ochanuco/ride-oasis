'use strict';

// CSR-based spatial snap (nearest-node lookup). No persistent SpatialGrid.
// O(N) brute force over csr.lons/csr.lats per call (16-tile corridor ~ 320k
// nodes → ~3M ops, < 30ms in JS). For Workers we trade tiny CPU for big
// memory savings (no grid bucket structure).

const EARTH_R = 6378137;

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
 * Snap a lon/lat to the nearest node in CSR.
 * Returns { idx, id, distanceMeters } or null if no candidate.
 *
 * Equirectangular approximation for the comparison (avoids haversine cost
 * per node); final distance reported with haversine for accuracy.
 */
function snapCsr(csr, lon, lat) {
  const lonsArr = csr.lons;
  const latsArr = csr.lats;
  const n = csr.nodeCount;
  if (n === 0) return null;
  // Equirectangular projection scale (meters per degree at this lat)
  const cosLat = Math.cos(lat * Math.PI / 180);
  let bestIdx = -1;
  let bestSq = Infinity;
  for (let i = 0; i < n; i += 1) {
    const ln = lonsArr[i];
    if (ln !== ln) continue; // NaN (via node with unknown coords)
    const la = latsArr[i];
    const dlon = (ln - lon) * cosLat;
    const dlat = la - lat;
    const sq = dlon * dlon + dlat * dlat; // degrees^2 (no need for meters scale to compare)
    if (sq < bestSq) {
      bestSq = sq;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return null;
  const id = csr.ids[bestIdx];
  const distanceMeters = haversineMeters(lon, lat, lonsArr[bestIdx], latsArr[bestIdx]);
  return { idx: bestIdx, id, distanceMeters };
}

module.exports = { snapCsr, haversineMeters };
