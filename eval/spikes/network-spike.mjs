// Facet Network view — deck.gl render spike (explicit-canvas variant).
import { Deck, OrthographicView } from '@deck.gl/core';
import { LineLayer, ScatterplotLayer } from '@deck.gl/layers';

try {
  const { nodes, edges } = await fetch('./network-data.json').then((r) => r.json());
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const spanX = Math.max(...xs) - Math.min(...xs) || 1;
  const spanY = Math.max(...ys) - Math.min(...ys) || 1;

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  document.getElementById('graph').appendChild(canvas);
  const zoom = Math.log2(Math.min(canvas.width / spanX, canvas.height / spanY)) - 0.3;
  window.__SPIKE_DEBUG__ = { nodes: nodes.length, edges: edges.length, spanX: Math.round(spanX), spanY: Math.round(spanY), zoom: +zoom.toFixed(2) };

  const t0 = performance.now();
  window.__DECK__ = new Deck({
    canvas,
    width: canvas.width,
    height: canvas.height,
    views: new OrthographicView(),
    initialViewState: { target: [cx, cy, 0], zoom },
    controller: true,
    onError: (e) => { window.__SPIKE_ERR__ = String(e?.message || e); },
    onAfterRender: () => {
      if (!window.__SPIKE_READY__) { window.__SPIKE_READY__ = true; window.__SPIKE_MS__ = Math.round(performance.now() - t0); }
    },
    layers: [
      new LineLayer({ id: 'edges', data: edges,
        getSourcePosition: (e) => [nodes[e[0]].x, nodes[e[0]].y],
        getTargetPosition: (e) => [nodes[e[1]].x, nodes[e[1]].y],
        getColor: [120, 125, 150, 45], getWidth: 1 }),
      new ScatterplotLayer({ id: 'nodes', data: nodes,
        getPosition: (n) => [n.x, n.y], getRadius: (n) => 2 + Math.sqrt(n.indeg), radiusUnits: 'pixels',
        getFillColor: (n) => (n.indeg > 50 ? [222, 90, 60] : n.indeg > 5 ? [235, 170, 60] : [70, 120, 200]),
        pickable: true,
        onHover: (info) => { document.getElementById('tip').textContent = info.object ? `${info.object.title}  (cited by ${info.object.indeg} in-set)` : ''; } }),
    ],
  });
} catch (e) {
  window.__SPIKE_ERR__ = String(e?.stack || e);
}
