-- Initial schema for the rideoasis-supply-points D1 database.
-- Mirrors the SQLite shape produced by `npm run export:map-db` so the Worker
-- and the Node dev server share the same column names and indexes.

CREATE TABLE IF NOT EXISTS supply_points (
  supply_point_id      TEXT PRIMARY KEY,
  chain                TEXT NOT NULL,
  store_id             TEXT NOT NULL,
  name                 TEXT NOT NULL,
  lat                  REAL NOT NULL,
  lng                  REAL NOT NULL,
  address_norm         TEXT,
  geocode_level        INTEGER,
  geocode_point_level  INTEGER,
  source_url           TEXT,
  updated_at           TEXT
);

CREATE INDEX IF NOT EXISTS idx_supply_points_chain
  ON supply_points(chain);

CREATE INDEX IF NOT EXISTS idx_supply_points_point_level
  ON supply_points(geocode_point_level);

CREATE INDEX IF NOT EXISTS idx_supply_points_lat_lng
  ON supply_points(lat, lng);
