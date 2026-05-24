'use strict';

// CSR-based CH query. Operates on typed-array CSR (lib/cycling/ch_csr.js)
// instead of Map<id, edge[]> view. Algorithm is identical to chQueryOnView
// (bidirectional Dijkstra with upward-only relax + core-core lateral relax)
// but adjacency lookups go through Uint32Array offsets, and node id ↔ index
// uses CSR.idToIdx (snap) / CSR.ids (path-time osm id recovery).
//
// Distance/parent/settled state uses TypedArrays of length nodeCount, not
// Maps. This keeps the per-query allocation O(nodeCount) bytes instead of
// O(settled) JS Map entries.

const { MinHeap } = require('./min_heap');
const { UNKNOWN_LEVEL } = require('./ch_csr');

const INF = Infinity;

/**
 * @param {object} csr  buildCsr() の戻り値
 * @param {number} startIdx  local node index (CSR.idToIdx.get(osmId))
 * @param {number} goalIdx
 * @param {object} [opts]
 * @param {number} [opts.settledCap=20000]
 * @param {number} [opts.popsCap=80000]
 * @param {number} [opts.timeBudgetMs=1500]
 * @returns {{ distance, pathIdx, settled }}
 *   pathIdx は local-index 配列。caller が CSR.ids で OSM id に戻す。
 *   shortcut の展開はここでは行わず caller 側 (unpackChEdgeCsr) で行う。
 */
function chQueryCsr(csr, startIdx, goalIdx, opts) {
  const settledCap = opts?.settledCap ?? 20000;
  const popsCap = opts?.popsCap ?? 80000;
  const timeBudgetMs = opts?.timeBudgetMs ?? 1500;

  const n = csr.nodeCount;
  if (startIdx === goalIdx) {
    return { distance: 0, pathIdx: [startIdx], settled: 0, terminated: 'same' };
  }
  if (startIdx < 0 || goalIdx < 0 || startIdx >= n || goalIdx >= n) {
    return { distance: INF, pathIdx: [], settled: 0, terminated: 'oob' };
  }

  // Float64 for precision (Float32 で 16-bit precision loss が累積誤差 → 経路選択差)
  const distF = new Float64Array(n);
  const distB = new Float64Array(n);
  distF.fill(INF);
  distB.fill(INF);
  distF[startIdx] = 0;
  distB[goalIdx] = 0;

  // parent stores predecessor index (or -1). Edge index NOT stored; for
  // shortcut expansion we re-lookup the via via fwdViaId/revViaId at output.
  const parentF = new Int32Array(n);
  const parentB = new Int32Array(n);
  parentF.fill(-1);
  parentB.fill(-1);

  const settledF = new Uint8Array(n);
  const settledB = new Uint8Array(n);

  const heapF = new MinHeap();
  const heapB = new MinHeap();
  heapF.push(0, startIdx);
  heapB.push(0, goalIdx);

  let best = INF;
  let meeting = -1;
  const tryMeet = (u, df, db) => {
    const sum = df + db;
    if (sum < best) {
      best = sum;
      meeting = u;
    }
  };

  const t0 = Date.now();
  let pops = 0;
  let settledCount = 0;

  const { levels, cores, fwdOffsets, fwdTo, fwdCost, revOffsets, revFrom, revCost } = csr;

  while (heapF.size > 0 || heapB.size > 0) {
    if (settledCount > settledCap || pops > popsCap) {
      return { distance: INF, pathIdx: [], settled: settledCount, terminated: 'cap' };
    }
    if ((pops & 0x3FF) === 0 && (Date.now() - t0) > timeBudgetMs) {
      return { distance: INF, pathIdx: [], settled: settledCount, terminated: 'time' };
    }
    pops += 1;

    const topF = heapF.size > 0 ? heapF.peek().key : INF;
    const topB = heapB.size > 0 ? heapB.peek().key : INF;
    if (topF >= best && topB >= best) break;
    const expandF = topF < best && (topB >= best || topF <= topB);

    if (expandF) {
      const { key: d, val: u } = heapF.pop();
      if (settledF[u]) continue;
      if (d > distF[u]) continue;
      settledF[u] = 1;
      settledCount += 1;
      if (distB[u] !== INF) tryMeet(u, d, distB[u]);
      const uLevel = levels[u];
      const uIsCore = cores[u] === 1;
      const startOff = fwdOffsets[u];
      const endOff = fwdOffsets[u + 1];
      for (let e = startOff; e < endOff; e += 1) {
        const v = fwdTo[e];
        const vLevel = levels[v];
        // view-base chQueryOnView の `levels.get(v) === undefined` 相当:
        // cross-tile target など level 不明な node への relax は禁止。
        if (vLevel === UNKNOWN_LEVEL) continue;
        const coreCoreLateral = uIsCore && cores[v] === 1;
        if (!coreCoreLateral && vLevel <= uLevel) continue;
        const nd = d + fwdCost[e];
        if (nd < distF[v]) {
          distF[v] = nd;
          parentF[v] = u;
          heapF.push(nd, v);
          if (distB[v] !== INF) tryMeet(v, nd, distB[v]);
        }
      }
    } else {
      const { key: d, val: u } = heapB.pop();
      if (settledB[u]) continue;
      if (d > distB[u]) continue;
      settledB[u] = 1;
      settledCount += 1;
      if (distF[u] !== INF) tryMeet(u, distF[u], d);
      const uLevel = levels[u];
      const uIsCore = cores[u] === 1;
      const startOff = revOffsets[u];
      const endOff = revOffsets[u + 1];
      for (let e = startOff; e < endOff; e += 1) {
        const v = revFrom[e];
        const vLevel = levels[v];
        if (vLevel === UNKNOWN_LEVEL) continue;
        const coreCoreLateral = uIsCore && cores[v] === 1;
        if (!coreCoreLateral && vLevel <= uLevel) continue;
        const nd = d + revCost[e];
        if (nd < distB[v]) {
          distB[v] = nd;
          parentB[v] = u;
          heapB.push(nd, v);
          if (distF[v] !== INF) tryMeet(v, distF[v], nd);
        }
      }
    }
  }

  if (meeting < 0 || !Number.isFinite(best)) {
    return { distance: INF, pathIdx: [], settled: settledCount, terminated: 'noMeet' };
  }

  // Reconstruct path (local idx). forward chain start → meeting + backward
  // chain meeting → goal. Shortcut expansion done by caller.
  const fwdChain = [meeting];
  for (let cur = meeting; parentF[cur] !== -1; cur = parentF[cur]) fwdChain.push(parentF[cur]);
  fwdChain.reverse();
  const backChain = [];
  for (let cur = meeting; parentB[cur] !== -1; cur = parentB[cur]) backChain.push(parentB[cur]);
  const pathIdx = fwdChain.concat(backChain);
  return { distance: best, pathIdx, settled: settledCount, terminated: 'ok' };
}

/**
 * Walk a (uIdx → vIdx) edge in CSR and expand any shortcut via recursively.
 * Pushes intermediate node indices (excluding uIdx) into `out`.
 * If a (uIdx, vIdx) edge is not found (cross-corridor leak), pushes vIdx
 * directly as a fallback so the path stays continuous.
 */
function unpackChEdgeCsr(csr, uIdx, vIdx, out) {
  const { fwdOffsets, fwdTo, fwdViaId, NO_VIA: noVia } = csr;
  const stack = [[uIdx, vIdx]];
  let safety = 0;
  while (stack.length > 0) {
    if (++safety > 1_000_000) break;
    const [a, b] = stack.pop();
    // Linear scan in CSR (degree is small, O(few))
    let foundViaIdx = -2; // -2 = not found; -1 = original; >=0 = via idx
    const startOff = fwdOffsets[a];
    const endOff = fwdOffsets[a + 1];
    for (let e = startOff; e < endOff; e += 1) {
      if (fwdTo[e] === b) {
        const v = fwdViaId[e];
        foundViaIdx = (v === noVia) ? -1 : v;
        break;
      }
    }
    if (foundViaIdx === -1 || foundViaIdx === -2) {
      // original edge or edge not found in CSR; output b directly
      out.push(b);
      continue;
    }
    // shortcut: (a, via, b) → push reversed so (a→via) processed first
    stack.push([foundViaIdx, b]);
    stack.push([a, foundViaIdx]);
  }
}

module.exports = {
  chQueryCsr,
  unpackChEdgeCsr
};
