'use strict';

// Binary tile format v1
// -----------------------------------------------------------------------------
// Header (16 bytes, little endian):
//   0..3  magic        "RIDE" (ASCII)
//   4     version      u8 = 1
//   5     flags        u8 (reserved, 0)
//   6..7  padding      u16
//   8..11 nodeCount    u32
//   12..15 edgeCount   u32
//
// Nodes section (nodeCount * 16 bytes):
//   0..7  id           Float64 (JS-safe integer)
//   8..11 lon          Float32
//   12..15 lat         Float32
//
// Edges section (edgeCount * 28 bytes):
//   0..7  from         Float64
//   8..15 to           Float64
//   16..19 toLon       Float32
//   20..23 toLat       Float32
//   24..27 cost        Float32
//
// `kind` を意図的に除外: ルーティングロジックは事前計算済 cost_m しか使わない。

const MAGIC = 0x45444952; // "RIDE" little-endian
const VERSION = 1;
const HEADER_BYTES = 16;
const NODE_BYTES = 16;
const EDGE_BYTES = 28;

function encodeTile(nodes, edges) {
  const total =
    HEADER_BYTES + nodes.length * NODE_BYTES + edges.length * EDGE_BYTES;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);

  dv.setUint32(0, MAGIC, true);
  dv.setUint8(4, VERSION);
  dv.setUint8(5, 0);
  dv.setUint16(6, 0, true);
  dv.setUint32(8, nodes.length, true);
  dv.setUint32(12, edges.length, true);

  let off = HEADER_BYTES;
  for (const n of nodes) {
    dv.setFloat64(off, n.id, true);
    dv.setFloat32(off + 8, n.lon, true);
    dv.setFloat32(off + 12, n.lat, true);
    off += NODE_BYTES;
  }
  for (const e of edges) {
    dv.setFloat64(off, e.from, true);
    dv.setFloat64(off + 8, e.to, true);
    dv.setFloat32(off + 16, e.toLon, true);
    dv.setFloat32(off + 20, e.toLat, true);
    dv.setFloat32(off + 24, e.cost, true);
    off += EDGE_BYTES;
  }
  return buf;
}

function decodeTile(arrayBuffer) {
  if (arrayBuffer.byteLength < HEADER_BYTES) {
    throw new Error('tile too small');
  }
  const dv = new DataView(arrayBuffer);
  const magic = dv.getUint32(0, true);
  if (magic !== MAGIC) throw new Error('tile magic mismatch');
  const version = dv.getUint8(4);
  if (version !== VERSION) throw new Error(`unsupported tile version ${version}`);
  const nodeCount = dv.getUint32(8, true);
  const edgeCount = dv.getUint32(12, true);

  const expected =
    HEADER_BYTES + nodeCount * NODE_BYTES + edgeCount * EDGE_BYTES;
  if (arrayBuffer.byteLength !== expected) {
    throw new Error(
      `tile size mismatch: got ${arrayBuffer.byteLength} expected ${expected}`
    );
  }

  const nodes = new Array(nodeCount);
  let off = HEADER_BYTES;
  for (let i = 0; i < nodeCount; i += 1) {
    nodes[i] = {
      id: dv.getFloat64(off, true),
      lon: dv.getFloat32(off + 8, true),
      lat: dv.getFloat32(off + 12, true)
    };
    off += NODE_BYTES;
  }
  const edges = new Array(edgeCount);
  for (let i = 0; i < edgeCount; i += 1) {
    edges[i] = {
      from: dv.getFloat64(off, true),
      to: dv.getFloat64(off + 8, true),
      toLon: dv.getFloat32(off + 16, true),
      toLat: dv.getFloat32(off + 20, true),
      cost: dv.getFloat32(off + 24, true)
    };
    off += EDGE_BYTES;
  }
  return { nodes, edges };
}

module.exports = {
  MAGIC,
  VERSION,
  HEADER_BYTES,
  NODE_BYTES,
  EDGE_BYTES,
  encodeTile,
  decodeTile
};
