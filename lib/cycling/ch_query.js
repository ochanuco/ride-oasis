'use strict';

const { MinHeap } = require('./min_heap');

function chQuery(adj, level, startId, goalId) {
  if (startId === goalId) {
    return { distance: 0, path: [startId], settled: 0 };
  }
  if (!level.has(startId) || !level.has(goalId)) {
    return { distance: Infinity, path: [], settled: 0 };
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

  while (heapF.size > 0 || heapB.size > 0) {
    const topF = heapF.size > 0 ? heapF.peek().key : Infinity;
    const topB = heapB.size > 0 ? heapB.peek().key : Infinity;
    if (Math.min(topF, topB) >= best) break;

    if (topF <= topB && heapF.size > 0) {
      const { key: d, val: u } = heapF.pop();
      if (settledF.has(u)) continue;
      if (d > (distF.get(u) ?? Infinity)) continue;
      settledF.add(u);

      const db = distB.get(u);
      if (db !== undefined) tryMeet(u, d, db);

      const uLevel = level.get(u);
      for (const idx of adj.fwd.get(u) || []) {
        const e = adj.allEdges[idx];
        const vLevel = level.get(e.to);
        if (vLevel === undefined || vLevel <= uLevel) continue;
        const nd = d + e.cost;
        if (nd < (distF.get(e.to) ?? Infinity)) {
          distF.set(e.to, nd);
          parentF.set(e.to, idx);
          heapF.push(nd, e.to);
          const dbTo = distB.get(e.to);
          if (dbTo !== undefined) tryMeet(e.to, nd, dbTo);
        }
      }
    } else if (heapB.size > 0) {
      const { key: d, val: u } = heapB.pop();
      if (settledB.has(u)) continue;
      if (d > (distB.get(u) ?? Infinity)) continue;
      settledB.add(u);

      const df = distF.get(u);
      if (df !== undefined) tryMeet(u, df, d);

      const uLevel = level.get(u);
      for (const idx of adj.rev.get(u) || []) {
        const e = adj.allEdges[idx];
        const fromLevel = level.get(e.from);
        if (fromLevel === undefined || fromLevel <= uLevel) continue;
        const nd = d + e.cost;
        if (nd < (distB.get(e.from) ?? Infinity)) {
          distB.set(e.from, nd);
          parentB.set(e.from, idx);
          heapB.push(nd, e.from);
          const dfFrom = distF.get(e.from);
          if (dfFrom !== undefined) tryMeet(e.from, dfFrom, nd);
        }
      }
    } else break;
  }

  if (meeting === null || !Number.isFinite(best)) {
    return { distance: Infinity, path: [], settled: settledF.size + settledB.size };
  }

  const fwdEdgeChain = [];
  let cur = meeting;
  while (parentF.has(cur)) {
    const idx = parentF.get(cur);
    fwdEdgeChain.push(idx);
    cur = adj.allEdges[idx].from;
  }
  fwdEdgeChain.reverse();

  const backEdgeChain = [];
  cur = meeting;
  while (parentB.has(cur)) {
    const idx = parentB.get(cur);
    backEdgeChain.push(idx);
    cur = adj.allEdges[idx].to;
  }

  const unpacked = [];
  for (const idx of fwdEdgeChain) unpackEdge(adj, idx, unpacked);
  for (const idx of backEdgeChain) unpackEdge(adj, idx, unpacked);

  const path = [];
  if (unpacked.length === 0) {
    path.push(meeting);
  } else {
    path.push(adj.allEdges[unpacked[0]].from);
    for (const idx of unpacked) path.push(adj.allEdges[idx].to);
  }

  return {
    distance: best,
    path,
    settled: settledF.size + settledB.size
  };
}

function unpackEdge(adj, startIdx, out) {
  // Iterative pre-order walk. Deep CH ショートカット連鎖 (本番では数十段
  // になり得る) で再帰だと stack overflow するため、明示スタックを使う。
  // visited で自己参照ループを安全側で打ち切る (本来 CH は DAG だが防御的に)。
  const stack = [startIdx];
  const visited = new Set();
  while (stack.length > 0) {
    const idx = stack.pop();
    if (visited.has(idx)) continue;
    visited.add(idx);
    const e = adj.allEdges[idx];
    if (e.via === null || e.lowerIdx === null || e.upperIdx === null) {
      out.push(idx);
      continue;
    }
    // 元の再帰は lower → upper の順に出力するので、スタックには逆順で積む
    stack.push(e.upperIdx);
    stack.push(e.lowerIdx);
  }
}

module.exports = { chQuery, unpackEdge };
