'use strict';

const { Graph } = require('./graph');
const { SpatialGrid } = require('./spatial_grid');
const { bidirectionalDijkstra } = require('./bidirectional_dijkstra');

const MAX_SNAP_METERS = 500;

class CyclingRouter {
  constructor() {
    this.graph = new Graph();
    this.grid = new SpatialGrid();
  }

  addNode(id, lon, lat) {
    this.graph.addNode(id, lon, lat);
    this.grid.add(id, lon, lat);
  }

  addEdge(edge) {
    this.graph.addEdge(edge);
  }

  loadFromNDJSON(nodesText, edgesText) {
    for (const line of nodesText.split('\n')) {
      if (!line) continue;
      const n = JSON.parse(line);
      this.addNode(n.id, n.lon, n.lat);
    }
    for (const line of edgesText.split('\n')) {
      if (!line) continue;
      this.addEdge(JSON.parse(line));
    }
  }

  route(fromLon, fromLat, toLon, toLat, opts = {}) {
    const maxSnap = opts.maxSnapMeters ?? MAX_SNAP_METERS;
    const fromNode = this.grid.nearest(fromLon, fromLat);
    const toNode = this.grid.nearest(toLon, toLat);
    if (!fromNode || fromNode.distanceMeters > maxSnap) {
      return { error: 'no_nearby_node_from' };
    }
    if (!toNode || toNode.distanceMeters > maxSnap) {
      return { error: 'no_nearby_node_to' };
    }
    const r = bidirectionalDijkstra(this.graph, fromNode.id, toNode.id);
    if (!Number.isFinite(r.distance)) {
      return {
        error: 'unreachable',
        from_node: fromNode.id,
        to_node: toNode.id
      };
    }
    const coordinates = r.path.map((id) => this.graph.coord(id)).filter(Boolean);
    return {
      distance_cost: r.distance,
      node_count: r.path.length,
      settled: r.settled,
      snap_from_m: fromNode.distanceMeters,
      snap_to_m: toNode.distanceMeters,
      coordinates
    };
  }

  get nodeCount() {
    return this.graph.nodeCount;
  }

  get edgeCount() {
    return this.graph.edgeCount;
  }
}

module.exports = { CyclingRouter, MAX_SNAP_METERS };
