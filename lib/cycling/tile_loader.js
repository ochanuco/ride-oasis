'use strict';

const { SpatialGrid } = require('./spatial_grid');

class TileLoader {
  constructor(fetcher) {
    this.fetcher = fetcher;
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
      p = (async () => {
        try {
          const text = await this.fetcher(key);
          if (text == null) {
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
    return Promise.all(keys.map((k) => this.load(k)));
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

module.exports = { TileLoader, makeR2Fetcher, makeFsFetcher };
