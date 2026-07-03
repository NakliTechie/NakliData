// Precompute force-layout positions for the deck.gl Network spike (one-time;
// JS Fruchterman ~7s at 2.6k nodes — the accel path is a separate browser test).
import { FruchtermanLayout } from '@antv/layout';
import { readFileSync, writeFileSync } from 'node:fs';
const g = JSON.parse(readFileSync('/tmp/cite-graph-meta.json', 'utf8'));
const idx = new Map(g.nodes.map((n, i) => [n.id, i]));
const layout = new FruchtermanLayout({ maxIteration: 400, gravity: 8, speed: 3 });
const t0 = performance.now();
await layout.execute({
  nodes: g.nodes.map((n) => ({ id: n.id, data: {} })),
  edges: g.edges.map((e, i) => ({ id: `e${i}`, source: e.source, target: e.target, data: {} })),
});
const pos = new Map();
layout.forEachNode((n) => pos.set(n.id, [n.x, n.y]));
console.log(`layout: ${Math.round(performance.now() - t0)}ms`);
const nodes = g.nodes.map((n) => ({ x: pos.get(n.id)[0], y: pos.get(n.id)[1], indeg: n.indeg, title: n.title }));
// edges as [srcIndex, tgtIndex] for compact deck.gl LineLayer
const edges = g.edges.map((e) => [idx.get(e.source), idx.get(e.target)]).filter((e) => e[0] != null && e[1] != null);
writeFileSync('eval/spikes/network-data.json', JSON.stringify({ nodes, edges }));
console.log(`wrote eval/spikes/network-data.json — ${nodes.length} nodes, ${edges.length} edges`);
