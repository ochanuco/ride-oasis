'use strict';

const { MinHeap } = require('./min_heap');

function buildAdjacency(edges) {
  const fwd = new Map();
  const rev = new Map();
  const allEdges = [];
  let edgeIdx = 0;

  const push = (m, k, v) => {
    let arr = m.get(k);
    if (!arr) {
      arr = [];
      m.set(k, arr);
    }
    arr.push(v);
  };

  const ensureNode = (id) => {
    if (!fwd.has(id)) fwd.set(id, []);
    if (!rev.has(id)) rev.set(id, []);
  };

  const addDirected = (from, to, cost, via, lowerIdx, upperIdx) => {
    ensureNode(from);
    ensureNode(to);
    const idx = edgeIdx++;
    allEdges.push({
      from,
      to,
      cost,
      via: via ?? null,
      lowerIdx: lowerIdx ?? null,
      upperIdx: upperIdx ?? null
    });
    push(fwd, from, idx);
    push(rev, to, idx);
    return idx;
  };

  for (const e of edges) {
    addDirected(e.from, e.to, e.cost_m, null);
    if (!e.oneway) addDirected(e.to, e.from, e.cost_m, null);
  }

  return { fwd, rev, allEdges, addDirected };
}

function activeOut(adj, node, contracted) {
  const out = [];
  for (const idx of adj.fwd.get(node) || []) {
    const e = adj.allEdges[idx];
    if (!contracted.has(e.to)) out.push({ idx, to: e.to, cost: e.cost });
  }
  return out;
}

function activeIn(adj, node, contracted) {
  const ins = [];
  for (const idx of adj.rev.get(node) || []) {
    const e = adj.allEdges[idx];
    if (!contracted.has(e.from)) ins.push({ idx, from: e.from, cost: e.cost });
  }
  return ins;
}

function witnessSearch(adj, u, excludedNode, targets, maxCost, hopLimit, contracted) {
  if (targets.size === 0) return new Map();
  const dist = new Map([[u, 0]]);
  const hops = new Map([[u, 0]]);
  const heap = new MinHeap();
  heap.push(0, u);
  const found = new Map();

  while (heap.size > 0) {
    const { key: d, val: x } = heap.pop();
    if (d > maxCost) break;
    if (d > (dist.get(x) ?? Infinity)) continue;

    if (targets.has(x) && x !== u) {
      found.set(x, d);
      if (found.size === targets.size) break;
    }

    const h = hops.get(x) ?? 0;
    if (h >= hopLimit) continue;

    for (const { to, cost } of activeOut(adj, x, contracted)) {
      if (to === excludedNode) continue;
      const nd = d + cost;
      if (nd > maxCost) continue;
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd);
        hops.set(to, h + 1);
        heap.push(nd, to);
      }
    }
  }
  return found;
}

function computeNodeOrder(adj) {
  const order = [];
  for (const id of adj.fwd.keys()) {
    const deg = (adj.fwd.get(id)?.length || 0) + (adj.rev.get(id)?.length || 0);
    order.push([id, deg]);
  }
  order.sort((a, b) => a[1] - b[1]);
  return order.map((o) => o[0]);
}

function buildContractionHierarchy(edges, opts = {}) {
  const hopLimit = opts.hopLimit ?? 5;
  const adj = buildAdjacency(edges);
  const order = computeNodeOrder(adj);
  const level = new Map();
  const shortcuts = [];
  const contracted = new Set();

  for (let i = 0; i < order.length; i += 1) {
    const v = order[i];
    level.set(v, i);

    const ins = activeIn(adj, v, contracted);
    const outs = activeOut(adj, v, contracted);
    if (ins.length === 0 || outs.length === 0) {
      contracted.add(v);
      continue;
    }

    for (const inE of ins) {
      const u = inE.from;
      const targets = new Set();
      let maxOut = 0;
      for (const oe of outs) {
        if (oe.to !== u) {
          targets.add(oe.to);
          if (oe.cost > maxOut) maxOut = oe.cost;
        }
      }
      if (targets.size === 0) continue;

      const upperBound = inE.cost + maxOut;
      const witnesses = witnessSearch(
        adj,
        u,
        v,
        targets,
        upperBound,
        hopLimit,
        contracted
      );

      for (const oe of outs) {
        const w = oe.to;
        if (u === w) continue;
        const shortcutCost = inE.cost + oe.cost;
        const witnessCost = witnesses.get(w);
        if (witnessCost !== undefined && witnessCost <= shortcutCost) continue;

        const idx = adj.addDirected(u, w, shortcutCost, v, inE.idx, oe.idx);
        shortcuts.push({
          from: u,
          to: w,
          cost: shortcutCost,
          via: v,
          edgeIdx: idx,
          lowerIdx: inE.idx,
          upperIdx: oe.idx
        });
      }
    }

    contracted.add(v);
  }

  return { level, shortcuts, adj };
}

module.exports = {
  buildAdjacency,
  buildContractionHierarchy,
  witnessSearch,
  computeNodeOrder
};
