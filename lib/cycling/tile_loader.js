'use strict';

const { SpatialGrid } = require('./spatial_grid');
const { decodeTile } = require('./tile_binary');

const DEFAULT_MAX_TILES = 128;
const DEFAULT_MAX_MISSES = 1024;
const DEFAULT_LOAD_CONCURRENCY = 8;

class TileLoader {
  constructor(fetcher, opts = {}) {
    this.fetcher = fetcher;
    this.maxTiles = opts.maxTiles ?? DEFAULT_MAX_TILES;
    this.maxMisses = opts.maxMisses ?? DEFAULT_MAX_MISSES;
    this.loadConcurrency = opts.loadConcurrency ?? DEFAULT_LOAD_CONCURRENCY;
    this._reset();
  }

  _reset() {
    this.loaded = new Set();
    this.misses = new Set();
    this.inflight = new Map();
    this.view = {
      nodes: new Map(),
      fwd: new Map(),
      rev: new Map()
    };
    this.grid = new SpatialGrid();
  }

  has(key) {
    return this.loaded.has(key);
  }

  async load(key) {
    if (this.loaded.has(key)) return true;
    if (this.misses.has(key)) return false;
    let p = this.inflight.get(key);
    if (!p) {
      // Capacity guard runs BEFORE we add ourselves to inflight, so the
      // `inflight.size === 0` check accurately reflects "no concurrent loads
      // are mid-merge". When the cache is full but another load is in flight,
      // we skip this one (return false) rather than reset and wipe its work
      // mid-batch; a future call after inflight drains will reset cleanly.
      if (this.loaded.size >= this.maxTiles) {
        if (this.inflight.size > 0) return false;
        this._reset();
      }
      p = (async () => {
        try {
          const buf = await this.fetcher(key);
          if (buf == null) {
            // Bounded miss set: drop arbitrary entries when full so we don't
            // grow indefinitely from probes / out-of-region requests.
            if (this.misses.size >= this.maxMisses) {
              const it = this.misses.values().next();
              if (!it.done) this.misses.delete(it.value);
            }
            this.misses.add(key);
            return false;
          }
          this._mergeBinary(buf);
          this.loaded.add(key);
          return true;
        } finally {
          this.inflight.delete(key);
        }
      })();
      this.inflight.set(key, p);
    }
    return p;
  }

  async loadMany(keys) {
    const results = new Array(keys.length);
    let next = 0;
    const worker = async () => {
      while (true) {
        const i = next++;
        if (i >= keys.length) break;
        results[i] = await this.load(keys[i]);
      }
    };
    const pool = Math.min(this.loadConcurrency, Math.max(keys.length, 1));
    await Promise.all(Array.from({ length: pool }, worker));
    return results;
  }

  _mergeBinary(arrayBuffer) {
    const { nodes, fwd, rev } = this.view;
    const grid = this.grid;
    const { nodes: tileNodes, edges: tileEdges } = decodeTile(arrayBuffer);
    for (const n of tileNodes) {
      if (!nodes.has(n.id)) {
        nodes.set(n.id, [n.lon, n.lat]);
        grid.add(n.id, n.lon, n.lat);
      }
    }
    for (const e of tileEdges) {
      let f = fwd.get(e.from);
      if (!f) {
        f = [];
        fwd.set(e.from, f);
      }
      f.push(e);
      let r = rev.get(e.to);
      if (!r) {
        r = [];
        rev.set(e.to, r);
      }
      r.push(e);
      if (!nodes.has(e.to)) {
        nodes.set(e.to, [e.toLon, e.toLat]);
        grid.add(e.to, e.toLon, e.toLat);
      }
    }
  }
}

function makeR2Fetcher(bucket, prefix = 'tiles/') {
  return async (key) => {
    const obj = await bucket.get(`${prefix}${key}.bin`);
    if (!obj) return null;
    return obj.arrayBuffer();
  };
}

function makeFsFetcher(dir) {
  const fs = require('fs');
  const path = require('path');
  return async (key) => {
    const p = path.join(dir, 'tiles', `${key}.bin`);
    if (!fs.existsSync(p)) return null;
    const buf = fs.readFileSync(p);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  };
}

module.exports = {
  TileLoader,
  makeR2Fetcher,
  makeFsFetcher,
  DEFAULT_MAX_TILES,
  DEFAULT_MAX_MISSES,
  DEFAULT_LOAD_CONCURRENCY
};
