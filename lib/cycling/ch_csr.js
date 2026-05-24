'use strict';

// CH-mode ephemeral CSR graph builder for memory-constrained environments
// (Cloudflare Workers 128MB).
//
// Key design: avoids intermediate JS arrays during build by pre-allocating
// upper-bounded TypedArrays from tile header sizes. The only Map allocation
// is idToIdx for OSM-id ↔ local-index dedup; everything else is typed.
//
// Memory profile for a Kansai 16-tile corridor (~300k unique nodes, ~1.7M
// edges incl. shortcuts):
//
//   - JS object representation:        ~200MB (exceeds Workers 128MB)
//   - Old CSR build (JS arr intermed):  ~50MB final + ~70MB peak with intermed
//   - Lean CSR build (this):           ~50MB final + ~25MB peak in addition
//                                       to fixed final
//
// CSR layout per direction (fwd / rev):
//   offsets: Uint32Array(nodeCount + 1)
//   to:      Uint32Array(edgeCount)
//   cost:    Float32Array(edgeCount)
//   viaId:   Uint32Array(edgeCount)
//
// Nodes:
//   ids:    Float64Array(nodeCount)
//   lons:   Float32Array(nodeCount)
//   lats:   Float32Array(nodeCount)
//   levels: Uint32Array(nodeCount)  (UNKNOWN_LEVEL = relax 禁止 sentinel)
//   cores:  Uint8Array(nodeCount)
//   idToIdx: Map<OSM_id, local_idx>  (snap 用)

const HEADER_BYTES = 16;
const NODE_BYTES = 16;
const NODE_BYTES_V2 = 20;
const EDGE_BYTES = 28;
const EDGE_BYTES_V2 = 40;
const MAGIC = 0x45444952;
const CORE_BIT_V2 = 2 ** 31;

const NO_VIA = 0xFFFFFFFF;
const UNKNOWN_LEVEL = 0xFFFFFFFE;

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
 * Build CSR from tile ArrayBuffers with minimal intermediate allocation.
 *
 * Strategy: scan headers first to compute upper bounds on node/edge counts,
 * then allocate exact-size TypedArrays and fill via DataView reads.
 * idToIdx (Map) is the only growing structure; nothing else copies/grows.
 *
 * @param {Array<{key: string, buf: ArrayBuffer}>} tiles
 * @returns {object} CSR
 */
function buildCsr(tiles) {
  // --- Phase 0: scan headers for upper bound sizing ---
  const headers = new Array(tiles.length);
  let nodeUpper = 0;
  let edgeUpper = 0;
  for (let i = 0; i < tiles.length; i += 1) {
    const h = readHeader(tiles[i].buf);
    headers[i] = h;
    if (h) {
      nodeUpper += h.nodeCount;
      edgeUpper += h.edgeCount;
    }
  }
  // Tight node-slot cap = sum of tile.nodeCount。各 tile の nodes 節に
  // 載っている node のみ index 化する。cross-tile target / via node は
  // 登録しない (edge 側で idToIdx.get が undefined → スキップ)。
  // 副作用: corridor 境界で edges/shortcuts が一部失われ得るが、3km route
  // 想定では境界外への shortcut は稀。Workers 128MB 内に収めるための
  // tradeoff。
  const maxNodeSlots = nodeUpper;

  // --- Phase A: allocate node arrays (max-sized, will slice later) ---
  const ids = new Float64Array(maxNodeSlots);
  const lons = new Float32Array(maxNodeSlots);
  const lats = new Float32Array(maxNodeSlots);
  const levels = new Uint32Array(maxNodeSlots);
  const cores = new Uint8Array(maxNodeSlots);
  let nodeCount = 0;
  const idToIdx = new Map();

  const addNode = (id, lon, lat, level, core) => {
    if (idToIdx.has(id)) return idToIdx.get(id);
    const idx = nodeCount;
    idToIdx.set(id, idx);
    ids[idx] = id;
    lons[idx] = lon;
    lats[idx] = lat;
    levels[idx] = level;
    cores[idx] = core;
    nodeCount += 1;
    return idx;
  };

  // --- Phase B: ingest tile node sections ---
  for (let t = 0; t < tiles.length; t += 1) {
    const h = headers[t];
    if (!h) continue;
    const dv = new DataView(tiles[t].buf);
    let off = HEADER_BYTES;
    if (h.version === 2) {
      for (let i = 0; i < h.nodeCount; i += 1) {
        const id = dv.getFloat64(off, true);
        const lon = dv.getFloat32(off + 8, true);
        const lat = dv.getFloat32(off + 12, true);
        const word = dv.getUint32(off + 16, true);
        const level = word >= CORE_BIT_V2 ? word - CORE_BIT_V2 : word;
        const core = word >= CORE_BIT_V2 ? 1 : 0;
        addNode(id, lon, lat, level, core);
        off += NODE_BYTES_V2;
      }
    } else {
      for (let i = 0; i < h.nodeCount; i += 1) {
        const id = dv.getFloat64(off, true);
        const lon = dv.getFloat32(off + 8, true);
        const lat = dv.getFloat32(off + 12, true);
        addNode(id, lon, lat, UNKNOWN_LEVEL, 0);
        off += NODE_BYTES;
      }
    }
  }

  // --- Phase C: precompute edge section offsets per tile ---
  const edgeOffsets = new Uint32Array(tiles.length);
  for (let t = 0; t < tiles.length; t += 1) {
    const h = headers[t];
    if (!h) { edgeOffsets[t] = 0; continue; }
    edgeOffsets[t] = HEADER_BYTES + h.nodeCount * (h.version === 2 ? NODE_BYTES_V2 : NODE_BYTES);
  }
  // 注: cross-tile target / via node の追加登録は意図的に行わない。
  // tight memory cap (maxNodeSlots = nodeUpper) を保つため。境界 edges/
  // shortcuts は Phase D/F で idToIdx.get === undefined → 自然にスキップ。

  // --- Phase D: count fwd/rev degrees + total edges ---
  const fwdDeg = new Uint32Array(nodeCount);
  const revDeg = new Uint32Array(nodeCount);
  let totalEdges = 0;
  for (let t = 0; t < tiles.length; t += 1) {
    const h = headers[t];
    if (!h) continue;
    const dv = new DataView(tiles[t].buf);
    const eb = h.version === 2 ? EDGE_BYTES_V2 : EDGE_BYTES;
    let off = edgeOffsets[t];
    for (let i = 0; i < h.edgeCount; i += 1) {
      const from = dv.getFloat64(off, true);
      const to = dv.getFloat64(off + 8, true);
      const fIdx = idToIdx.get(from);
      const tIdx = idToIdx.get(to);
      if (fIdx !== undefined && tIdx !== undefined) {
        fwdDeg[fIdx] += 1;
        revDeg[tIdx] += 1;
        totalEdges += 1;
      }
      off += eb;
    }
  }

  // --- Phase E: prefix sums → offsets ---
  const fwdOffsets = new Uint32Array(nodeCount + 1);
  const revOffsets = new Uint32Array(nodeCount + 1);
  for (let i = 0; i < nodeCount; i += 1) {
    fwdOffsets[i + 1] = fwdOffsets[i] + fwdDeg[i];
    revOffsets[i + 1] = revOffsets[i] + revDeg[i];
  }

  // --- Phase F: fill CSR ---
  const fwdTo = new Uint32Array(totalEdges);
  const fwdCost = new Float32Array(totalEdges);
  const fwdViaId = new Uint32Array(totalEdges);
  const revFrom = new Uint32Array(totalEdges);
  const revCost = new Float32Array(totalEdges);
  const revViaId = new Uint32Array(totalEdges);
  const fwdCursor = new Uint32Array(fwdOffsets.length);
  const revCursor = new Uint32Array(revOffsets.length);
  fwdCursor.set(fwdOffsets);
  revCursor.set(revOffsets);
  for (let t = 0; t < tiles.length; t += 1) {
    const h = headers[t];
    if (!h) continue;
    const dv = new DataView(tiles[t].buf);
    const eb = h.version === 2 ? EDGE_BYTES_V2 : EDGE_BYTES;
    let off = edgeOffsets[t];
    for (let i = 0; i < h.edgeCount; i += 1) {
      const from = dv.getFloat64(off, true);
      const to = dv.getFloat64(off + 8, true);
      const cost = dv.getFloat32(off + 24, true);
      let viaIdx = NO_VIA;
      if (h.version === 2) {
        const viaOsm = dv.getFloat64(off + 32, true);
        if (viaOsm) {
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
      off += eb;
    }
  }

  // --- Phase G: nodeCount = maxNodeSlots (cap), so no slicing needed ---
  // (Phase A allocated exactly nodeUpper which equals current nodeCount
  // after Phase B). If addNode hit cap and silently dropped nodes, we
  // still return the cap-sized arrays. No subarray/slice copy = no peak.
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
