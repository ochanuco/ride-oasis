'use strict';

const { classifyWay } = require('./tag_classifier');
const RouteMath = require('../../frontend/route_math.js');

const { pointToPointDistanceMeters } = RouteMath;

function edgesForWay(way, nodeCoords) {
  const result = {
    edges: [],
    excluded: false,
    skippedMissingNode: 0,
    skippedZeroLength: 0
  };
  const cls = classifyWay(way && way.tags);
  if (!cls.allowed) {
    result.excluded = true;
    return result;
  }
  const refs = (way && way.refs) || [];
  if (refs.length < 2) return result;

  for (let i = 1; i < refs.length; i += 1) {
    // OSM oneway=-1 は way の refs 逆順を一方通行とする慣習。
    // 双方向 or 順方向 oneway は (refs[i-1] → refs[i]) を出力、
    // 逆方向 oneway は (refs[i] → refs[i-1]) を出力する。
    const fromId = cls.reversed ? refs[i] : refs[i - 1];
    const toId = cls.reversed ? refs[i - 1] : refs[i];
    if (fromId === toId) continue;
    const fromCoord = nodeCoords.get(fromId);
    const toCoord = nodeCoords.get(toId);
    if (!fromCoord || !toCoord) {
      result.skippedMissingNode += 1;
      continue;
    }
    const lengthM = pointToPointDistanceMeters(fromCoord, toCoord);
    if (!Number.isFinite(lengthM) || lengthM <= 0) {
      result.skippedZeroLength += 1;
      continue;
    }
    result.edges.push({
      from: fromId,
      to: toId,
      way_id: way.id,
      length_m: lengthM,
      cost_m: lengthM * cls.costFactor,
      kind: cls.kind,
      oneway: cls.oneway
    });
  }
  return result;
}

function buildEdges(ways, nodeCoords) {
  const stats = {
    waysTotal: ways.length,
    waysEligible: 0,
    waysExcluded: 0,
    edges: 0,
    skippedMissingNode: 0,
    skippedZeroLength: 0
  };
  const edges = [];
  for (const way of ways) {
    const r = edgesForWay(way, nodeCoords);
    if (r.excluded) {
      stats.waysExcluded += 1;
      continue;
    }
    stats.waysEligible += 1;
    stats.skippedMissingNode += r.skippedMissingNode;
    stats.skippedZeroLength += r.skippedZeroLength;
    for (const e of r.edges) edges.push(e);
    stats.edges += r.edges.length;
  }
  return { edges, stats };
}

function collectReferencedNodeIds(ways) {
  const ids = new Set();
  for (const way of ways) {
    const cls = classifyWay(way && way.tags);
    if (!cls.allowed) continue;
    const refs = (way && way.refs) || [];
    for (const r of refs) ids.add(r);
  }
  return ids;
}

module.exports = {
  edgesForWay,
  buildEdges,
  collectReferencedNodeIds
};
