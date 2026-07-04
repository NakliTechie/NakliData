// Lazy chunk — deck.gl force-graph renderer for the Facet Network view. A
// standalone `Deck` (OrthographicView) with a LineLayer for edges + a
// ScatterplotLayer for nodes (size + colour by degree). Mirrors
// deckgl-embedding.ts's canvas-sizing + palette. Loaded only when a Network
// cell renders; deck.gl never touches the shell.
//
// The layout itself is computed in core/force-layout.ts (a synchronous,
// CSP-clean, dependency-free Fruchterman — see that file's header for why not
// a library) and passed in already-positioned, so this chunk is render-only.

import { Deck, OrthographicView } from '@deck.gl/core';
import { LineLayer, ScatterplotLayer } from '@deck.gl/layers';

// Node palette by degree — hubs read hot, leaves cool (mirrors the spike +
// the shared deck.gl categorical accent).
const HUB_RGB: [number, number, number] = [0xb5, 0x37, 0x1c];
const MID_RGB: [number, number, number] = [0xd6, 0xa2, 0x4e];
const LEAF_RGB: [number, number, number] = [0x3c, 0x5a, 0x6b];
const EDGE_RGBA: [number, number, number, number] = [0x6f, 0x7e, 0x76, 60];

export interface NetworkRenderNode {
  id: string;
  position: [number, number];
  degree: number;
}
export interface NetworkRenderEdge {
  sourcePosition: [number, number];
  targetPosition: [number, number];
}

export interface NetworkGraphOpts {
  container: HTMLElement;
  nodes: NetworkRenderNode[];
  edges: NetworkRenderEdge[];
  /** Called on hover with the node's label (id + degree), or null on leave. */
  onHover?: (label: string | null) => void;
  /** Called on click with the node index, or null for background. */
  onClick?: (index: number | null) => void;
}

export interface NetworkGraphHandle {
  /** Highlight a node + its neighbours (dim the rest). Pass (null, []) to clear. */
  setHighlight: (selected: number | null, neighbors: readonly number[]) => void;
  /** Automation seam — real GPU pick at canvas (x, y); fires onClick. */
  simulateClick: (x: number, y: number, radius?: number) => number | null;
  destroy: () => void;
}

function degreeColor(degree: number, maxDegree: number): [number, number, number] {
  if (maxDegree <= 1) return MID_RGB;
  const r = degree / maxDegree;
  if (r > 0.5) return HUB_RGB;
  if (r > 0.15) return MID_RGB;
  return LEAF_RGB;
}

/**
 * Mount a deck.gl force-graph of laid-out nodes + edges into `container`. The
 * container must have non-zero size (the caller sets an explicit height + defers
 * a microtask, like the embedding cell). Returns a handle whose `destroy()`
 * finalizes the Deck and removes the canvas.
 */
export function mountNetworkGraph(opts: NetworkGraphOpts): NetworkGraphHandle {
  const { container, nodes, edges, onHover, onClick } = opts;

  const xs = nodes.map((n) => n.position[0]);
  const ys = nodes.map((n) => n.position[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
  const width = container.clientWidth || 600;
  const height = container.clientHeight || 420;
  const zoom = Math.log2(Math.min(width, height) / span) - 0.2;
  const maxDegree = nodes.reduce((m, n) => Math.max(m, n.degree), 1);

  const canvas = document.createElement('canvas');
  // Explicit drawing-buffer size — deck.gl v9 leaves a bare canvas at 300×150
  // and CSS-stretches it, blurring the graph (same fix as deckgl-embedding).
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  canvas.style.cssText = 'width:100%;height:100%;display:block';
  container.appendChild(canvas);

  let selected: number | null = null;
  let neighborSet: ReadonlySet<number> = new Set();
  let version = 0;

  const nodeLayer = () =>
    new ScatterplotLayer<NetworkRenderNode>({
      id: 'network-nodes',
      data: nodes,
      getPosition: (n) => [n.position[0], n.position[1], 0],
      getFillColor: (n, { index }) => {
        const [r, g, b] = degreeColor(n.degree, maxDegree);
        if (selected === null || index === selected || neighborSet.has(index)) {
          return [r, g, b, 255];
        }
        return [r, g, b, 40];
      },
      getRadius: (n, { index }) => {
        const base = 2 + Math.sqrt(n.degree);
        return index === selected ? base + 4 : neighborSet.has(index) ? base + 2 : base;
      },
      radiusUnits: 'pixels',
      stroked: true,
      getLineColor: (_n, { index }) =>
        index === selected ? [0x1a, 0x1a, 0x1a, 255] : [0, 0, 0, 0],
      getLineWidth: (_n, { index }) => (index === selected ? 1.5 : 0),
      lineWidthUnits: 'pixels',
      updateTriggers: {
        getFillColor: version,
        getRadius: version,
        getLineColor: version,
        getLineWidth: version,
      },
      pickable: Boolean(onHover || onClick),
      ...(onHover
        ? {
            onHover: (info: { object?: NetworkRenderNode }) =>
              onHover(
                info.object?.id != null ? `${info.object.id} · degree ${info.object.degree}` : null,
              ),
          }
        : {}),
      ...(onClick
        ? {
            onClick: (info: { object?: NetworkRenderNode; index: number }) => {
              onClick(info.object ? info.index : null);
            },
          }
        : {}),
    });

  const edgeLayer = () =>
    new LineLayer<NetworkRenderEdge>({
      id: 'network-edges',
      data: edges,
      getSourcePosition: (e) => [e.sourcePosition[0], e.sourcePosition[1], 0],
      getTargetPosition: (e) => [e.targetPosition[0], e.targetPosition[1], 0],
      getColor: EDGE_RGBA,
      getWidth: 1,
    });

  const deck = new Deck({
    canvas,
    width,
    height,
    views: new OrthographicView({}),
    initialViewState: { target: [cx, cy, 0], zoom },
    controller: true,
    // Edges under nodes.
    layers: [edgeLayer(), nodeLayer()],
    ...(onClick
      ? { onClick: (info: { index: number }) => (info.index < 0 ? onClick(null) : undefined) }
      : {}),
  });

  return {
    setHighlight(sel, neighbors) {
      selected = sel;
      neighborSet = new Set(neighbors);
      version++;
      deck.setProps({ layers: [edgeLayer(), nodeLayer()] });
    },
    simulateClick(x, y, radius = 6) {
      const info = deck.pickObject({ x, y, radius, layerIds: ['network-nodes'] });
      const idx = info && info.index >= 0 ? info.index : null;
      onClick?.(idx);
      return idx;
    },
    destroy() {
      try {
        deck.finalize();
      } catch {
        /* already finalized */
      }
      canvas.remove();
    },
  };
}
