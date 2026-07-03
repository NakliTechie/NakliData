import { ForceAtlas2Layout, ForceLayout, FruchtermanLayout } from '@antv/layout';
import { readFileSync } from 'node:fs';

const g = JSON.parse(readFileSync('/tmp/cite-graph.json', 'utf8'));
const mkData = () => ({
  nodes: g.nodes.map((n) => ({ id: n.id, data: {} })),
  edges: g.edges.map((e, i) => ({ id: `e${i}`, source: e.source, target: e.target, data: {} })),
});
console.log(`graph: ${g.nodes.length} nodes, ${g.edges.length} edges\n`);

for (const [name, Layout, opts] of [
  ['ForceAtlas2', ForceAtlas2Layout, { maxIteration: 100, kr: 20, kg: 5 }],
  ['Force', ForceLayout, { maxIteration: 100 }],
  ['Fruchterman', FruchtermanLayout, { maxIteration: 200 }],
]) {
  try {
    const layout = new Layout(opts);
    const t0 = performance.now();
    await layout.execute(mkData());
    const pts = [];
    layout.forEachNode((n) => pts.push([n.x, n.y]));
    const ms = Math.round(performance.now() - t0);
    const finite = pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    const xs = pts.map((p) => p[0]);
    const spread = Math.round(Math.max(...xs) - Math.min(...xs));
    console.log(`  ${name.padEnd(12)} ${String(ms).padStart(6)}ms · ${pts.length} pts · finite=${finite} · x-spread=${spread}`);
  } catch (e) {
    console.log(`  ${name}: ERROR ${e.message.slice(0, 140)}`);
  }
}
