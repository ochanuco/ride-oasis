'use strict';

const { MinHeap } = require('./min_heap');

function bidirectionalDijkstra(graph, startId, goalId) {
  if (startId === goalId) {
    return { distance: 0, path: [startId], settled: 0 };
  }

  const distF = new Map();
  const distB = new Map();
  const parentF = new Map();
  const parentB = new Map();
  const settledF = new Set();
  const settledB = new Set();

  distF.set(startId, 0);
  distB.set(goalId, 0);

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

  while (heapF.size > 0 && heapB.size > 0) {
    if (heapF.peek().key + heapB.peek().key >= best) break;

    if (heapF.peek().key <= heapB.peek().key) {
      const { key: d, val: u } = heapF.pop();
      if (settledF.has(u)) continue;
      if (d > (distF.get(u) ?? Infinity)) continue;
      settledF.add(u);

      const db = distB.get(u);
      if (db !== undefined) tryMeet(u, d, db);

      for (const { to, cost } of graph.neighbors(u)) {
        if (settledF.has(to)) continue;
        const nd = d + cost;
        if (nd < (distF.get(to) ?? Infinity)) {
          distF.set(to, nd);
          parentF.set(to, u);
          heapF.push(nd, to);
          const dbTo = distB.get(to);
          if (dbTo !== undefined) tryMeet(to, nd, dbTo);
        }
      }
    } else {
      const { key: d, val: u } = heapB.pop();
      if (settledB.has(u)) continue;
      if (d > (distB.get(u) ?? Infinity)) continue;
      settledB.add(u);

      const df = distF.get(u);
      if (df !== undefined) tryMeet(u, df, d);

      for (const { from, cost } of graph.predecessors(u)) {
        if (settledB.has(from)) continue;
        const nd = d + cost;
        if (nd < (distB.get(from) ?? Infinity)) {
          distB.set(from, nd);
          parentB.set(from, u);
          heapB.push(nd, from);
          const dfFrom = distF.get(from);
          if (dfFrom !== undefined) tryMeet(from, dfFrom, nd);
        }
      }
    }
  }

  if (meeting === null || !Number.isFinite(best)) {
    return { distance: Infinity, path: [], settled: settledF.size + settledB.size };
  }

  const pathF = [];
  let cur = meeting;
  while (cur !== undefined) {
    pathF.push(cur);
    cur = parentF.get(cur);
  }
  pathF.reverse();

  const pathB = [];
  cur = parentB.get(meeting);
  while (cur !== undefined) {
    pathB.push(cur);
    cur = parentB.get(cur);
  }

  return {
    distance: best,
    path: pathF.concat(pathB),
    settled: settledF.size + settledB.size
  };
}

module.exports = { bidirectionalDijkstra };
