'use strict';

// Binary tile formats
// -----------------------------------------------------------------------------
// Both versions share the 16-byte header; version byte differentiates layout.
//
// === v1 (original) ===
// Header (16 bytes, little endian):
//   0..3   magic        "RIDE"
//   4      version      u8 = 1
//   5      flags        u8
//   6..7   padding      u16
//   8..11  nodeCount    u32
//   12..15 edgeCount    u32
//
// Nodes section (nodeCount * 16 bytes):
//   0..7   id           Float64
//   8..11  lon          Float32
//   12..15 lat          Float32
//
// Edges section (edgeCount * 28 bytes):
//   0..7   from         Float64
//   8..15  to           Float64
//   16..19 toLon        Float32
//   20..23 toLat        Float32
//   24..27 cost         Float32
//
// === v2 (with CH metadata) ===
// Same header (version = 2). Nodes carry a CH level; edges carry a viaId
// (0 for original, nonzero for shortcut) plus the via node's coords so
// unpacking can render the shortcut without loading the via's tile.
//
// Nodes section (nodeCount * 20 bytes):
//   0..7   id           Float64
//   8..11  lon          Float32
//   12..15 lat          Float32
//   16..19 level        Uint32  (CH level; higher = contracted later = more important)
//
// Edges section (edgeCount * 40 bytes):
//   0..7   from         Float64
//   8..15  to           Float64
//   16..19 toLon        Float32
//   20..23 toLat        Float32
//   24..27 cost         Float32
//   28..31 padding      u32 (align via to 8-byte boundary)
//   32..39 viaId        Float64  (0 = original edge, nonzero = shortcut via)
//
// viaLon/viaLat are intentionally NOT stored. Unpacking walks parent edges
// found by (from=u, to=via) and (from=via, to=w) lookup in loaded tiles;
// if via's tile is not loaded, unpacking falls back to the inline (u,w)
// straight segment for rendering.

const MAGIC = 0x45444952;
const VERSION = 1;
const VERSION_CH = 2;
const HEADER_BYTES = 16;
const NODE_BYTES = 16;
const NODE_BYTES_V2 = 20;
const EDGE_BYTES = 28;
const EDGE_BYTES_V2 = 40;

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

function encodeTileV2(nodes, edges) {
  const total =
    HEADER_BYTES + nodes.length * NODE_BYTES_V2 + edges.length * EDGE_BYTES_V2;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);

  dv.setUint32(0, MAGIC, true);
  dv.setUint8(4, VERSION_CH);
  dv.setUint8(5, 0);
  dv.setUint16(6, 0, true);
  dv.setUint32(8, nodes.length, true);
  dv.setUint32(12, edges.length, true);

  let off = HEADER_BYTES;
  for (const n of nodes) {
    dv.setFloat64(off, n.id, true);
    dv.setFloat32(off + 8, n.lon, true);
    dv.setFloat32(off + 12, n.lat, true);
    dv.setUint32(off + 16, n.level >>> 0, true);
    off += NODE_BYTES_V2;
  }
  for (const e of edges) {
    dv.setFloat64(off, e.from, true);
    dv.setFloat64(off + 8, e.to, true);
    dv.setFloat32(off + 16, e.toLon, true);
    dv.setFloat32(off + 20, e.toLat, true);
    dv.setFloat32(off + 24, e.cost, true);
    dv.setUint32(off + 28, 0, true);
    dv.setFloat64(off + 32, e.viaId || 0, true);
    off += EDGE_BYTES_V2;
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
  if (version === VERSION) return decodeTileV1(arrayBuffer, dv);
  if (version === VERSION_CH) return decodeTileV2(arrayBuffer, dv);
  throw new Error(`unsupported tile version ${version}`);
}

function decodeTileV1(arrayBuffer, dv) {
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
      lat: dv.getFloat32(off + 12, true),
      level: 0
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
      cost: dv.getFloat32(off + 24, true),
      viaId: 0
    };
    off += EDGE_BYTES;
  }
  return { version: VERSION, nodes, edges };
}

function decodeTileV2(arrayBuffer, dv) {
  const nodeCount = dv.getUint32(8, true);
  const edgeCount = dv.getUint32(12, true);
  const expected =
    HEADER_BYTES + nodeCount * NODE_BYTES_V2 + edgeCount * EDGE_BYTES_V2;
  if (arrayBuffer.byteLength !== expected) {
    throw new Error(
      `tile v2 size mismatch: got ${arrayBuffer.byteLength} expected ${expected}`
    );
  }
  const nodes = new Array(nodeCount);
  let off = HEADER_BYTES;
  for (let i = 0; i < nodeCount; i += 1) {
    nodes[i] = {
      id: dv.getFloat64(off, true),
      lon: dv.getFloat32(off + 8, true),
      lat: dv.getFloat32(off + 12, true),
      level: dv.getUint32(off + 16, true)
    };
    off += NODE_BYTES_V2;
  }
  const edges = new Array(edgeCount);
  for (let i = 0; i < edgeCount; i += 1) {
    edges[i] = {
      from: dv.getFloat64(off, true),
      to: dv.getFloat64(off + 8, true),
      toLon: dv.getFloat32(off + 16, true),
      toLat: dv.getFloat32(off + 20, true),
      cost: dv.getFloat32(off + 24, true),
      viaId: dv.getFloat64(off + 32, true)
    };
    off += EDGE_BYTES_V2;
  }
  return { version: VERSION_CH, nodes, edges };
}

module.exports = {
  MAGIC,
  VERSION,
  VERSION_CH,
  HEADER_BYTES,
  NODE_BYTES,
  NODE_BYTES_V2,
  EDGE_BYTES,
  EDGE_BYTES_V2,
  encodeTile,
  encodeTileV2,
  decodeTile
};
