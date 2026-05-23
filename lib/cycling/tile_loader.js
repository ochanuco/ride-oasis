'use strict';

const { SpatialGrid } = require('./spatial_grid');

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
          const text = await this.fetcher(key);
          if (text == null) {
            // Bounded miss set: drop arbitrary entries when full so we don't
            // grow indefinitely from probes / out-of-region requests.
            if (this.misses.size >= this.maxMisses) {
              const it = this.misses.values().next();
              if (!it.done) this.misses.delete(it.value);
            }
            this.misses.add(key);
            return false;
          }
          this._mergeText(text);
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

  _mergeText(text) {
    const { nodes, fwd, rev } = this.view;
    const grid = this.grid;
    let start = 0;
    while (start < text.length) {
      const end = text.indexOf('\n', start);
      const line = end === -1 ? text.slice(start) : text.slice(start, end);
      start = end === -1 ? text.length : end + 1;
      if (!line) continue;
      const item = JSON.parse(line);
      if (item.t === 'n') {
        if (!nodes.has(item.id)) {
          nodes.set(item.id, [item.lon, item.lat]);
          grid.add(item.id, item.lon, item.lat);
        }
      } else if (item.t === 'e') {
        let f = fwd.get(item.from);
        if (!f) {
          f = [];
          fwd.set(item.from, f);
        }
        f.push(item);
        let r = rev.get(item.to);
        if (!r) {
          r = [];
          rev.set(item.to, r);
        }
        r.push(item);
        if (!nodes.has(item.to)) {
          nodes.set(item.to, [item.toLon, item.toLat]);
          grid.add(item.to, item.toLon, item.toLat);
        }
      }
    }
  }
}

function makeR2Fetcher(bucket, prefix = 'tiles/') {
  return async (key) => {
    const obj = await bucket.get(`${prefix}${key}.ndjson`);
    if (!obj) return null;
    return obj.text();
  };
}

function makeFsFetcher(dir) {
  const fs = require('fs');
  const path = require('path');
  return async (key) => {
    const p = path.join(dir, 'tiles', `${key}.ndjson`);
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, 'utf8');
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
