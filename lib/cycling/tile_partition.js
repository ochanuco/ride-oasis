'use strict';

const TILE_DEG = 0.05;
const TILE_INV = 1 / TILE_DEG;

function tileXY(lon, lat) {
  return [Math.floor(lon * TILE_INV), Math.floor(lat * TILE_INV)];
}

function tileKey(lon, lat) {
  const [x, y] = tileXY(lon, lat);
  return `${x}_${y}`;
}

function tileKeyXY(x, y) {
  return `${x}_${y}`;
}

function parseTileKey(key) {
  const m = /^(-?\d+)_(-?\d+)$/.exec(key);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

function tileBboxXY(x, y) {
  return {
    west: x * TILE_DEG,
    south: y * TILE_DEG,
    east: (x + 1) * TILE_DEG,
    north: (y + 1) * TILE_DEG
  };
}

function neighborhoodKeys(lon, lat, radiusTiles = 1) {
  const [x, y] = tileXY(lon, lat);
  const keys = [];
  for (let dx = -radiusTiles; dx <= radiusTiles; dx += 1) {
    for (let dy = -radiusTiles; dy <= radiusTiles; dy += 1) {
      keys.push(tileKeyXY(x + dx, y + dy));
    }
  }
  return keys;
}

function corridorKeys(fromLon, fromLat, toLon, toLat, paddingTiles = 2) {
  const [fx, fy] = tileXY(fromLon, fromLat);
  const [tx, ty] = tileXY(toLon, toLat);
  const xMin = Math.min(fx, tx) - paddingTiles;
  const xMax = Math.max(fx, tx) + paddingTiles;
  const yMin = Math.min(fy, ty) - paddingTiles;
  const yMax = Math.max(fy, ty) + paddingTiles;
  const keys = [];
  for (let x = xMin; x <= xMax; x += 1) {
    for (let y = yMin; y <= yMax; y += 1) {
      keys.push(tileKeyXY(x, y));
    }
  }
  return keys;
}

module.exports = {
  TILE_DEG,
  tileXY,
  tileKey,
  tileKeyXY,
  parseTileKey,
  tileBboxXY,
  neighborhoodKeys,
  corridorKeys
};
