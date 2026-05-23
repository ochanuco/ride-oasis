// Benchmarks JS aStarOnView vs Rust/WASM astar() on synthetic graphs.
//
// Prereq: build the Rust crate first.
//   mise exec -- wasm-pack build --target nodejs --release \
//     --manifest-path rust-router/Cargo.toml
//
// Run:
//   node scripts/bench_wasm_vs_js.mjs

import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const { aStarOnView } = require('../lib/cycling/tiled_router');

// rust-router wasm-pack output (pkg/ folder)
const wasm = require('../rust-router/pkg/rust_router.js');

function buildGridView(W) {
  // W x W grid, lon/lat increments of 0.001° (~111m)
  const view = {
    nodes: new Map(),
    fwd: new Map(),
    rev: new Map(),
    nodeIdToIndex: new Map(),
    indexToNodeId: []
  };
  const addNode = (id, lon, lat) => {
    view.nodes.set(id, [lon, lat]);
    view.nodeIdToIndex.set(id, view.indexToNodeId.length);
    view.indexToNodeId.push(id);
  };
  const ensure = (m, k) => {
    let arr = m.get(k);
    if (!arr) { arr = []; m.set(k, arr); }
    return arr;
  };
  for (let y = 0; y < W; y += 1) {
    for (let x = 0; x < W; x += 1) {
      addNode(y * W + x, 135.0 + x * 0.001, 34.0 + y * 0.001);
    }
  }
  for (let y = 0; y < W; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const id = y * W + x;
      const link = (to, cost) => {
        ensure(view.fwd, id).push({ from: id, to, toLon: 0, toLat: 0, cost });
        ensure(view.rev, to).push({ from: id, to, cost });
        ensure(view.fwd, to).push({ from: to, to: id, toLon: 0, toLat: 0, cost });
        ensure(view.rev, id).push({ from: to, to: id, cost });
      };
      if (x + 1 < W) link(id + 1, 100 + (id % 7));
      if (y + 1 < W) link(id + W, 100 + (id % 5));
    }
  }
  return view;
}

function viewToTypedArrays(view) {
  // Flat node array: [lon, lat] per node, indexed by nodeIdToIndex
  const N = view.indexToNodeId.length;
  const nodeCoords = new Float64Array(N * 2);
  for (let i = 0; i < N; i += 1) {
    const c = view.nodes.get(view.indexToNodeId[i]);
    nodeCoords[i * 2] = c[0];
    nodeCoords[i * 2 + 1] = c[1];
  }
  // Flat edge array: [fromIdx, toIdx, cost] per edge
  const edges = [];
  for (const [fromId, list] of view.fwd.entries()) {
    const fromIdx = view.nodeIdToIndex.get(fromId);
    for (const e of list) {
      const toIdx = view.nodeIdToIndex.get(e.to);
      if (toIdx === undefined) continue;
      edges.push(fromIdx, toIdx, e.cost);
    }
  }
  return { nodeCoords, edgeData: new Float64Array(edges) };
}

function bench(label, fn, iters = 5) {
  // Warm
  fn();
  const start = performance.now();
  for (let i = 0; i < iters; i += 1) fn();
  const ms = (performance.now() - start) / iters;
  return { label, ms };
}

function runSize(W) {
  const view = buildGridView(W);
  const { nodeCoords, edgeData } = viewToTypedArrays(view);
  const startIdx = 0;
  const goalIdx = W * W - 1;
  const startId = view.indexToNodeId[startIdx];
  const goalId = view.indexToNodeId[goalIdx];

  const jsBench = bench('JS aStarOnView', () => aStarOnView(view, startId, goalId));
  const wasmBench = bench('WASM astar', () => wasm.astar(nodeCoords, edgeData, startIdx, goalIdx));

  // Sanity: distances must match
  const jsR = aStarOnView(view, startId, goalId);
  const wasmR = wasm.astar(nodeCoords, edgeData, startIdx, goalIdx);
  const jsDist = jsR.distance;
  const wasmDist = wasmR[0];
  const match = Math.abs(jsDist - wasmDist) < 1e-6;

  console.log(`\n=== ${W}x${W} grid (${W * W} nodes) ===`);
  console.log(`  JS    : ${jsBench.ms.toFixed(2)}ms (settled=${jsR.settled}, dist=${jsDist.toFixed(2)})`);
  console.log(`  WASM  : ${wasmBench.ms.toFixed(2)}ms (dist=${wasmDist.toFixed(2)})`);
  console.log(`  ratio : JS/WASM = ${(jsBench.ms / wasmBench.ms).toFixed(2)}x`);
  console.log(`  match : ${match ? '✓' : '✗ MISMATCH'}`);
}

console.log('Benchmark: JS aStarOnView vs Rust/WASM astar (forward A*)');
for (const W of [10, 20, 50, 100]) {
  runSize(W);
}
