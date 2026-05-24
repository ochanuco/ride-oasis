'use strict';

// CH-mode ephemeral CSR graph builder for memory-constrained environments
// (Cloudflare Workers 128MB).
//
// Background: the existing TileLoader.view holds edges as JS objects in
// Map<id, edge[]>, which works for NBA* (filter shortcuts, keeps view ~70MB)
// but exceeds 128MB once shortcut edges are included. The CH path needs
// shortcut edges, so we use a separate ephemeral representation:
//
//   - per-request build from ArrayBuffers (no persistent CH state across reqs)
//   - typed-array CSR (Compressed Sparse Row): single Uint32/Float32/Float64
//     allocations instead of millions of JS objects
//   - released right after chQuery (GC reclaims)
//
// Memory profile for a Kansai 16-tile corridor (~300k unique nodes, ~1.7M
// edges including shortcuts):
//
//   - JS object representation: ~200MB (exceeds Workers 128MB)
//   - Typed CSR (this module):  ~30-50MB (fits comfortably)
//
// CSR layout per direction (fwd / rev):
//   offsets: Uint32Array(nodeCount + 1)
//     for node-index i, its edges live in [offsets[i], offsets[i+1])
//   to:      Uint32Array(edgeCount)  // local node index of the other endpoint
//   cost:    Float32Array(edgeCount) // meters (within Float32 precision)
//   viaId:   Uint32Array(edgeCount)  // local index of via node, or 0xFFFFFFFF
//
// Nodes are stored as parallel arrays of Float64Array/Float32Array/Uint32Array
// + a Map<osmId, localIdx> for snap lookups.

const HEADER_BYTES = 16;
const NODE_BYTES = 16;          // v1
const NODE_BYTES_V2 = 20;       // v2 has level+coreBit word
const EDGE_BYTES = 28;          // v1
const EDGE_BYTES_V2 = 40;       // v2 has pad+viaId
const MAGIC = 0x45444952;
const CORE_BIT_V2 = 2 ** 31;
const LEVEL_MASK_V2 = CORE_BIT_V2 - 1;

const NO_VIA = 0xFFFFFFFF; // sentinel "no via" in local-index space
// Sentinel for "level unknown" (node only registered as cross-tile target,
// not in any loaded tile's nodes section). chQueryCsr must SKIP edges to/from
// such nodes — matching view-based chQueryOnView's `levels.get(id) === undefined`
// behavior. We can't use 0 (collides with real level 0) or 0xFFFFFFFF (= rev
// of "no via", and `vLevel <= uLevel` happens to be false but caller wants
// explicit skip semantic).
const UNKNOWN_LEVEL = 0xFFFFFFFE;

/**
 * Quickly read a tile's node-count and edge-count from its header without
 * decoding the body. Returns null on bad magic or unsupported version.
 */
function readHeader(buf) {
  if (!buf || buf.byteLength < HEADER_BYTES) return null;
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MAGIC) return null;
  const version = dv.getUint8(4);
  if (version !== 1 && version !== 2) return null;
  return {
    version,
    nodeCount: dv.getUint32(8, true),
    edgeCount: dv.getUint32(12, true)
  };
}

/**
 * Build a CSR from a set of tile ArrayBuffers.
 *
 * Streaming: never materializes JS edge objects. Each tile is read 3 times
 * via DataView (cheap, just byte access): once for nodes, twice for edges
 * (count degrees, then fill CSR). Total work O(N + E).
 *
 * @param {Array<{key: string, buf: ArrayBuffer}>} tiles
 * @returns {object} CSR
 */
function buildCsr(tiles) {
  // Pass A: nodes
  // Assign local Uint32 index to each unique OSM id. Track lon/lat/level/core.
  const idToIdx = new Map();
  // Use plain arrays during build (numbers boxed to doubles inside V8 for
  // OSM id range), then snapshot to TypedArrays at the end.
  const nodeOsmIds = [];   // pushed in encounter order
  const nodeLons = [];
  const nodeLats = [];
  const nodeLevels = [];
  const nodeCores = [];

  for (const { buf } of tiles) {
    const header = readHeader(buf);
    if (!header) continue;
    const dv = new DataView(buf);
    let off = HEADER_BYTES;
    if (header.version === 2) {
      for (let i = 0; i < header.nodeCount; i += 1) {
        const id = dv.getFloat64(off, true);
        const lon = dv.getFloat32(off + 8, true);
        const lat = dv.getFloat32(off + 12, true);
        const word = dv.getUint32(off + 16, true);
        const level = word >= CORE_BIT_V2 ? word - CORE_BIT_V2 : word;
        const core = word >= CORE_BIT_V2 ? 1 : 0;
        if (!idToIdx.has(id)) {
          idToIdx.set(id, nodeOsmIds.length);
          nodeOsmIds.push(id);
          nodeLons.push(lon);
          nodeLats.push(lat);
          nodeLevels.push(level);
          nodeCores.push(core);
        }
        off += NODE_BYTES_V2;
      }
    } else {
      // v1: no level, no core
      for (let i = 0; i < header.nodeCount; i += 1) {
        const id = dv.getFloat64(off, true);
        const lon = dv.getFloat32(off + 8, true);
        const lat = dv.getFloat32(off + 12, true);
        if (!idToIdx.has(id)) {
          idToIdx.set(id, nodeOsmIds.length);
          nodeOsmIds.push(id);
          nodeLons.push(lon);
          nodeLats.push(lat);
          // v1 タイルには level がない → unknown 扱いで relax をスキップさせる
          nodeLevels.push(UNKNOWN_LEVEL);
          nodeCores.push(0);
        }
        off += NODE_BYTES;
      }
    }
  }

  // Pass B: register target nodes from edges (so cross-tile targets get
  // a local index + coord). Also count fwd/rev degrees while we're here.
  // We deferred this to a second pass because we need final nodeCount
  // before allocating degree arrays.
  // First, collect tile edge specs.
  const tileEdgeSpecs = []; // { dv, off, edgeCount, edgeBytes }
  for (const { buf } of tiles) {
    const header = readHeader(buf);
    if (!header) { tileEdgeSpecs.push(null); continue; }
    const dv = new DataView(buf);
    const off = HEADER_BYTES + header.nodeCount * (header.version === 2 ? NODE_BYTES_V2 : NODE_BYTES);
    const edgeBytes = header.version === 2 ? EDGE_BYTES_V2 : EDGE_BYTES;
    tileEdgeSpecs.push({ dv, off, edgeCount: header.edgeCount, edgeBytes, version: header.version });
  }
  // Register cross-tile target nodes (one DataView pass; lightweight)
  for (const spec of tileEdgeSpecs) {
    if (!spec) continue;
    let off = spec.off;
    for (let i = 0; i < spec.edgeCount; i += 1) {
      const to = spec.dv.getFloat64(off + 8, true);
      if (!idToIdx.has(to)) {
        const toLon = spec.dv.getFloat32(off + 16, true);
        const toLat = spec.dv.getFloat32(off + 20, true);
        idToIdx.set(to, nodeOsmIds.length);
        nodeOsmIds.push(to);
        nodeLons.push(toLon);
        nodeLats.push(toLat);
        // cross-tile target (this tile に nodes 記載なし、別 tile も未ロード)
        // → level 不明として relax をスキップさせる
        nodeLevels.push(UNKNOWN_LEVEL);
        nodeCores.push(0);
      }
      off += spec.edgeBytes;
    }
  }
  // Also register via nodes (so shortcut expansion paths can find them).
  if (tileEdgeSpecs.some(s => s && s.version === 2)) {
    for (const spec of tileEdgeSpecs) {
      if (!spec || spec.version !== 2) continue;
      let off = spec.off;
      for (let i = 0; i < spec.edgeCount; i += 1) {
        const viaId = spec.dv.getFloat64(off + 32, true);
        if (viaId && viaId !== 0 && !idToIdx.has(viaId)) {
          // via node coords unknown (not in this tile). Use NaN coords;
          // grid/snap won't reach them but unpackChEdge needs the index.
          idToIdx.set(viaId, nodeOsmIds.length);
          nodeOsmIds.push(viaId);
          nodeLons.push(NaN);
          nodeLats.push(NaN);
          nodeLevels.push(UNKNOWN_LEVEL);
          nodeCores.push(0);
        }
        off += spec.edgeBytes;
      }
    }
  }

  const nodeCount = nodeOsmIds.length;

  // Snapshot node arrays to TypedArrays.
  const ids = new Float64Array(nodeOsmIds);
  const lons = new Float32Array(nodeLons);
  const lats = new Float32Array(nodeLats);
  const levels = new Uint32Array(nodeLevels);
  const cores = new Uint8Array(nodeCores);

  // Pass C: count fwd/rev degrees.
  const fwdDeg = new Uint32Array(nodeCount);
  const revDeg = new Uint32Array(nodeCount);
  let totalEdges = 0;
  for (const spec of tileEdgeSpecs) {
    if (!spec) continue;
    let off = spec.off;
    for (let i = 0; i < spec.edgeCount; i += 1) {
      const from = spec.dv.getFloat64(off, true);
      const to = spec.dv.getFloat64(off + 8, true);
      const fIdx = idToIdx.get(from);
      const tIdx = idToIdx.get(to);
      if (fIdx !== undefined && tIdx !== undefined) {
        fwdDeg[fIdx] += 1;
        revDeg[tIdx] += 1;
        totalEdges += 1;
      }
      off += spec.edgeBytes;
    }
  }

  // Prefix sums → offsets.
  const fwdOffsets = new Uint32Array(nodeCount + 1);
  const revOffsets = new Uint32Array(nodeCount + 1);
  for (let i = 0; i < nodeCount; i += 1) {
    fwdOffsets[i + 1] = fwdOffsets[i] + fwdDeg[i];
    revOffsets[i + 1] = revOffsets[i] + revDeg[i];
  }

  // Pass D: fill CSR arrays.
  const fwdTo = new Uint32Array(totalEdges);
  const fwdCost = new Float32Array(totalEdges);
  const fwdViaId = new Uint32Array(totalEdges); // 0 sentinel via NO_VIA for original edges
  const revFrom = new Uint32Array(totalEdges);
  const revCost = new Float32Array(totalEdges);
  const revViaId = new Uint32Array(totalEdges);
  // Cursors copy offsets so we can advance write positions per from/to.
  const fwdCursor = new Uint32Array(fwdOffsets.length);
  const revCursor = new Uint32Array(revOffsets.length);
  fwdCursor.set(fwdOffsets);
  revCursor.set(revOffsets);
  for (const spec of tileEdgeSpecs) {
    if (!spec) continue;
    let off = spec.off;
    for (let i = 0; i < spec.edgeCount; i += 1) {
      const from = spec.dv.getFloat64(off, true);
      const to = spec.dv.getFloat64(off + 8, true);
      const cost = spec.dv.getFloat32(off + 24, true);
      let viaIdx = NO_VIA;
      if (spec.version === 2) {
        const viaOsm = spec.dv.getFloat64(off + 32, true);
        if (viaOsm && viaOsm !== 0) {
          const vi = idToIdx.get(viaOsm);
          if (vi !== undefined) viaIdx = vi;
        }
      }
      const fIdx = idToIdx.get(from);
      const tIdx = idToIdx.get(to);
      if (fIdx !== undefined && tIdx !== undefined) {
        const fp = fwdCursor[fIdx]++;
        fwdTo[fp] = tIdx;
        fwdCost[fp] = cost;
        fwdViaId[fp] = viaIdx;
        const rp = revCursor[tIdx]++;
        revFrom[rp] = fIdx;
        revCost[rp] = cost;
        revViaId[rp] = viaIdx;
      }
      off += spec.edgeBytes;
    }
  }

  return {
    nodeCount,
    edgeCount: totalEdges,
    idToIdx,
    ids, lons, lats, levels, cores,
    fwdOffsets, fwdTo, fwdCost, fwdViaId,
    revOffsets, revFrom, revCost, revViaId,
    NO_VIA
  };
}

/**
 * Memory estimate (bytes) for a CSR view. Used by callers to log/observe.
 */
function csrMemoryBytes(csr) {
  const arrs = [
    csr.ids, csr.lons, csr.lats, csr.levels, csr.cores,
    csr.fwdOffsets, csr.fwdTo, csr.fwdCost, csr.fwdViaId,
    csr.revOffsets, csr.revFrom, csr.revCost, csr.revViaId
  ];
  return arrs.reduce((s, a) => s + (a ? a.byteLength : 0), 0);
}

module.exports = {
  buildCsr,
  csrMemoryBytes,
  NO_VIA,
  UNKNOWN_LEVEL,
  readHeader
};
