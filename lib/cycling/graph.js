'use strict';

class Graph {
  constructor() {
    this.nodes = new Map();
    this.fwd = new Map();
    this.rev = new Map();
  }

  addNode(id, lon, lat) {
    this.nodes.set(id, [lon, lat]);
    if (!this.fwd.has(id)) this.fwd.set(id, []);
    if (!this.rev.has(id)) this.rev.set(id, []);
  }

  addEdge(edge) {
    const { from, to, cost_m: cost, oneway } = edge;
    if (!this.fwd.has(from)) this.fwd.set(from, []);
    if (!this.rev.has(to)) this.rev.set(to, []);
    this.fwd.get(from).push({ to, cost });
    this.rev.get(to).push({ from, cost });
    if (!oneway) {
      if (!this.fwd.has(to)) this.fwd.set(to, []);
      if (!this.rev.has(from)) this.rev.set(from, []);
      this.fwd.get(to).push({ to: from, cost });
      this.rev.get(from).push({ from: to, cost });
    }
  }

  neighbors(id) {
    return this.fwd.get(id) || [];
  }

  predecessors(id) {
    return this.rev.get(id) || [];
  }

  coord(id) {
    return this.nodes.get(id);
  }

  get nodeCount() {
    return this.nodes.size;
  }

  get edgeCount() {
    let n = 0;
    for (const adj of this.fwd.values()) n += adj.length;
    return n;
  }
}

function buildGraphFromArrays(nodes, edges) {
  const g = new Graph();
  for (const n of nodes) g.addNode(n.id, n.lon, n.lat);
  for (const e of edges) g.addEdge(e);
  return g;
}

module.exports = { Graph, buildGraphFromArrays };
