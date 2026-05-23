'use strict';

class TileLoader {
  constructor(fetcher) {
    this.fetcher = fetcher;
    this.cache = new Map();
    this.inflight = new Map();
    this.misses = new Set();
  }

  has(key) {
    return this.cache.has(key);
  }

  cached() {
    return this.cache;
  }

  async load(key) {
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.misses.has(key)) return null;
    let p = this.inflight.get(key);
    if (!p) {
      p = (async () => {
        try {
          const text = await this.fetcher(key);
          if (text == null) {
            this.misses.add(key);
            return null;
          }
          const parsed = parseTile(text);
          this.cache.set(key, parsed);
          return parsed;
        } finally {
          this.inflight.delete(key);
        }
      })();
      this.inflight.set(key, p);
    }
    return p;
  }

  async loadMany(keys) {
    const results = await Promise.all(keys.map((k) => this.load(k)));
    return results.filter((r) => r != null);
  }
}

function parseTile(text) {
  const nodes = [];
  const edges = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const item = JSON.parse(line);
    if (item.t === 'n') nodes.push(item);
    else if (item.t === 'e') edges.push(item);
  }
  return { nodes, edges };
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

module.exports = { TileLoader, parseTile, makeR2Fetcher, makeFsFetcher };
