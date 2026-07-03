// Facet Embedding view — deck.gl semantic map. Renders the UMAP-2D projection of
// MiniLM embeddings of the citation corpus (1,964 papers), coloured by topic.
// Papers on similar topics should cluster — the visual test of the embedding path.
import { Deck, OrthographicView } from '@deck.gl/core';
import { ScatterplotLayer } from '@deck.gl/layers';

const PALETTE = {
  'super-res': [66, 165, 245], retinopathy: [239, 83, 80], 'brain-tumor': [171, 71, 188],
  skin: [255, 167, 38], detection: [38, 198, 218], segmentation: [156, 204, 101],
  GAN: [236, 64, 122], covid: [255, 238, 88], pose: [255, 112, 67], RL: [92, 107, 192],
  face: [38, 166, 154], hyperspectral: [141, 110, 99], 'point-cloud': [120, 144, 156],
  anomaly: [212, 225, 87], other: [70, 74, 92],
};

try {
  const pts = await fetch('./embedding-map-data.json').then((r) => r.json());
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  document.getElementById('graph').appendChild(canvas);
  const zoom = Math.log2(Math.min(canvas.width, canvas.height) / span) - 0.2;
  window.__SPIKE_DEBUG__ = { points: pts.length, span: Math.round(span), zoom: +zoom.toFixed(2) };

  window.__DECK__ = new Deck({
    canvas, width: canvas.width, height: canvas.height,
    views: new OrthographicView(),
    initialViewState: { target: [cx, cy, 0], zoom },
    controller: true,
    onError: (e) => { window.__SPIKE_ERR__ = String(e?.message || e); },
    onAfterRender: () => { window.__SPIKE_READY__ = true; },
    layers: [
      new ScatterplotLayer({
        id: 'papers', data: pts,
        getPosition: (p) => [p.x, p.y],
        getRadius: (p) => (p.topic === 'other' ? 2.5 : 4),
        radiusUnits: 'pixels',
        getFillColor: (p) => [...(PALETTE[p.topic] || PALETTE.other), p.topic === 'other' ? 120 : 235],
        pickable: true,
        onHover: (info) => { document.getElementById('tip').textContent = info.object ? `[${info.object.topic}] ${info.object.title}` : ''; },
      }),
    ],
  });
} catch (e) { window.__SPIKE_ERR__ = String(e?.stack || e); }
