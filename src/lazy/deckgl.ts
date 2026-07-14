// Lazy chunk — the single deck.gl surface for every Facet view renderer.
//
// This chunk hosts all three deck.gl renderers behind separate exports:
//   - mountEmbeddingScatter — standalone Deck (OrthographicView) scatter for
//     the Embedding / semantic-map cell (precomputed x,y, no geography).
//   - mountNetworkGraph     — standalone Deck (OrthographicView) force-graph
//     (LineLayer edges + ScatterplotLayer nodes) for the Network cell.
//   - mountDeckGlPoints     — a MapboxOverlay ScatterplotLayer loaded
//     ADDITIVELY onto the MapLibre map cell above a point-count threshold.
//
// Why one chunk (DECISIONS BT follow-up, superseding the earlier three
// deckgl-* chunks): each renderer used to be its own lazy chunk, so esbuild
// bundled a full copy of deck.gl + luma.gl into every one — ~600 KB duplicated
// per chunk, and when two views loaded in a session luma.gl logged a benign
// "This version of luma.gl has already been initialized" warning (two module
// copies each running their global init). Folding them into ONE chunk bundles
// deck.gl once and inits luma once, with no warning.
//
// NB: this is deliberately a single self-contained chunk, NOT esbuild
// code-splitting across separate deckgl-* entries. Splitting deck.gl +
// luma.gl's circular module graph into shared chunks reordered their
// initialization and corrupted the GPU picking path (find-similar /
// find-neighbours picked nothing or asserted). One self-contained module keeps
// the init order identical to a normal single-entry bundle. The chunk stays
// budget-exempt (spec A34), so bundling all three renderers together — and the
// @deck.gl/mapbox adapter that only the points renderer needs — costs nothing
// gated; the win is the dedup + the removed warning.

import { Deck, OrthographicView } from '@deck.gl/core';
import { LineLayer, ScatterplotLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ACCENT_RGB, CATEGORICAL_RGB, assignCategoryColors } from '../core/categorical-palette.ts';

// Categorical palette is shared from core/categorical-palette.ts (single source
// so a cell's legend swatches match what the chunk draws). ACCENT_RGB is the
// single-accent / hub color; CATEGORICAL_RGB cycles for distinct values.
const PALETTE_RGB = CATEGORICAL_RGB;

// H7: loop-based min/max. `Math.min(...xs)` spreads one argument per point, and
// V8 throws RangeError (call-stack overflow) above ~125k args — SQL results are
// uncapped, so a large embedding/network scatter crashed at mount.
function minOf(a: readonly number[]): number {
  let m = Number.POSITIVE_INFINITY;
  for (const v of a) if (v < m) m = v;
  return m;
}
function maxOf(a: readonly number[]): number {
  let m = Number.NEGATIVE_INFINITY;
  for (const v of a) if (v > m) m = v;
  return m;
}

// `deck.finalize()` (→ luma.gl `device.destroy()`) frees GL *resources* but does
// NOT release the canvas's WebGL *context* — the browser only reclaims that on
// GC, which lags far behind the notebook's create-on-every-re-render churn and
// lets contexts pile up past the ~16 cap ("Too many active WebGL contexts.
// Oldest context will be lost." + GPU stalls). Force the release deterministically
// via WEBGL_lose_context after finalize, so a disposed cell frees its context now.
function releaseGlContext(canvas: HTMLCanvasElement): void {
  try {
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    (gl as WebGL2RenderingContext | WebGLRenderingContext | null)
      ?.getExtension('WEBGL_lose_context')
      ?.loseContext();
  } catch {
    // Context already lost / never created — nothing to release.
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Embedding scatter — standalone Deck on an OrthographicView (abstract 2-D
// plane, no geography) for precomputed (x, y) embedding coordinates.
// ─────────────────────────────────────────────────────────────────────────

export interface EmbeddingPoint {
  position: [number, number];
  /** Categorical value driving color (null → single accent). */
  colorValue: string | null;
  /** Hover label. */
  label: string;
}

export interface EmbeddingScatterOpts {
  container: HTMLElement;
  points: EmbeddingPoint[];
  /** Called on hover with the point's label, or null when leaving a point. */
  onHover?: (label: string | null) => void;
  /**
   * Called on click with the point's index into `points`, or null when the
   * click hit empty background (the cell uses null to clear a selection).
   */
  onClick?: (index: number | null) => void;
}

export interface EmbeddingScatterHandle {
  /**
   * Highlight a selected point + its neighbours: selection gets an accent
   * ring-read (larger radius), neighbours keep full colour, everything else
   * dims. Pass (null, []) to clear.
   */
  setHighlight: (selected: number | null, neighbors: readonly number[]) => void;
  /**
   * Automation seam (smoke test + future agent verbs): pick at canvas pixel
   * (x, y) with deck's real GPU picking and fire the same onClick callback a
   * pointer click would. Returns the picked point index, or null for
   * background. A synthetic PointerEvent can't drive deck's input manager
   * (untrusted events are ignored), so tests aim through here instead.
   */
  simulateClick: (x: number, y: number, radius?: number) => number | null;
  destroy: () => void;
}

/**
 * Mount a standalone deck.gl scatter of embedding points into `container`.
 * The container must have a non-zero size (the caller sets an explicit height
 * and defers to a microtask, like map-cell.ts). Returns a handle whose
 * `destroy()` finalizes the Deck and removes the canvas.
 */
export function mountEmbeddingScatter(opts: EmbeddingScatterOpts): EmbeddingScatterHandle {
  const { container, points, onHover, onClick } = opts;

  // Categorical color map over the distinct colorValues (cap at the palette
  // length so we never wrap into visual ambiguity for the legend-worthy set).
  const distinct = Array.from(
    new Set(points.map((p) => p.colorValue).filter((v): v is string => v != null && v !== '')),
  ).slice(0, PALETTE_RGB.length);
  const lookup = new Map<string, [number, number, number]>();
  distinct.forEach((v, i) => lookup.set(v, PALETTE_RGB[i % PALETTE_RGB.length] ?? ACCENT_RGB));
  const colorFor = (v: string | null): [number, number, number] =>
    v && lookup.has(v) ? (lookup.get(v) as [number, number, number]) : ACCENT_RGB;

  const xs = points.map((p) => p.position[0]);
  const ys = points.map((p) => p.position[1]);
  const cx = (minOf(xs) + maxOf(xs)) / 2;
  const cy = (minOf(ys) + maxOf(ys)) / 2;
  const span = Math.max(maxOf(xs) - minOf(xs), maxOf(ys) - minOf(ys)) || 1;
  const width = container.clientWidth || 600;
  const height = container.clientHeight || 420;
  const zoom = Math.log2(Math.min(width, height) / span) - 0.2;

  const canvas = document.createElement('canvas');
  // Size the drawing buffer explicitly — deck.gl v9 leaves an explicit canvas at
  // the HTML default (300x150) and CSS-stretches it, blurring the scatter.
  // (deck.gl's useDevicePixels then scales the buffer for HiDPI on top of this.)
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  canvas.style.cssText = 'width:100%;height:100%;display:block';
  container.appendChild(canvas);

  // Highlight state lives in the closure; setHighlight swaps the layer.
  // A `version` counter drives updateTriggers so deck.gl re-evaluates the
  // colour/radius accessors instead of reusing cached attribute buffers.
  let selected: number | null = null;
  let neighborSet: ReadonlySet<number> = new Set();
  let version = 0;

  const makeLayer = () =>
    new ScatterplotLayer<EmbeddingPoint>({
      id: 'embedding-points',
      data: points,
      getPosition: (p) => [p.position[0], p.position[1], 0],
      getFillColor: (p, { index }) => {
        const [r, g, b] = colorFor(p.colorValue);
        if (selected === null) return [r, g, b, 255];
        if (index === selected || neighborSet.has(index)) return [r, g, b, 255];
        return [r, g, b, 40]; // dim the non-neighbours while a selection is active
      },
      getRadius: (_p, { index }) => (index === selected ? 6 : neighborSet.has(index) ? 4.5 : 3),
      radiusUnits: 'pixels',
      // Selection reads as a dark outline ring on the picked point.
      stroked: true,
      getLineColor: (_p, { index }) =>
        index === selected ? [0x1a, 0x1a, 0x1a, 255] : [0, 0, 0, 0],
      getLineWidth: (_p, { index }) => (index === selected ? 1.5 : 0),
      lineWidthUnits: 'pixels',
      updateTriggers: {
        getFillColor: version,
        getRadius: version,
        getLineColor: version,
        getLineWidth: version,
      },
      pickable: Boolean(onHover || onClick),
      ...(onHover
        ? { onHover: (info: { object?: EmbeddingPoint }) => onHover(info.object?.label ?? null) }
        : {}),
      ...(onClick
        ? {
            onClick: (info: { object?: EmbeddingPoint; index: number }) => {
              onClick(info.object ? info.index : null);
            },
          }
        : {}),
    });

  const deck = new Deck({
    canvas,
    width,
    height,
    views: new OrthographicView({}),
    initialViewState: { target: [cx, cy, 0], zoom },
    controller: true,
    layers: [makeLayer()],
    // Background clicks don't hit the layer's onClick — catch them at the
    // deck level so the cell can clear its selection.
    ...(onClick
      ? { onClick: (info: { index: number }) => (info.index < 0 ? onClick(null) : undefined) }
      : {}),
  });

  return {
    simulateClick(x, y, radius = 6) {
      const info = deck.pickObject({ x, y, radius });
      const idx = info && info.index >= 0 ? info.index : null;
      onClick?.(idx);
      return idx;
    },
    setHighlight(sel, neighbors) {
      selected = sel;
      neighborSet = new Set(neighbors);
      version++;
      deck.setProps({ layers: [makeLayer()] });
    },
    destroy() {
      try {
        deck.finalize();
      } catch {
        /* already finalized */
      }
      releaseGlContext(canvas);
      canvas.remove();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Network force-graph — standalone Deck (OrthographicView) with a LineLayer
// for edges + a ScatterplotLayer for nodes (size + colour by degree). The
// layout is computed in core/force-layout.ts (synchronous, CSP-clean,
// dependency-free Fruchterman) and passed in already-positioned, so this is
// render-only.
// ─────────────────────────────────────────────────────────────────────────

// Node palette by degree — hubs read hot, leaves cool. The hub color IS the
// shared deck.gl categorical accent; mid/leaf are degree-specific picks.
const HUB_RGB: [number, number, number] = ACCENT_RGB;
const MID_RGB: [number, number, number] = [0xd6, 0xa2, 0x4e];
const LEAF_RGB: [number, number, number] = [0x3c, 0x5a, 0x6b];

export interface NetworkRenderNode {
  id: string;
  position: [number, number];
  degree: number;
  /**
   * Continuous metric driving colour + size (degree / pagerank / betweenness).
   * Defaults to `degree` when absent — so existing callers keep the degree ramp.
   */
  metricValue?: number;
  /**
   * Louvain community index → categorical colour (overrides the metric ramp).
   * null/absent → colour by `metricValue`.
   */
  community?: number | null;
  /** Extra hover text (e.g. "pagerank 0.031"); appended after the degree label. */
  metricLabel?: string | null;
}
export interface NetworkRenderEdge {
  sourcePosition: [number, number];
  targetPosition: [number, number];
  /** Optional categorical edge type (Knowledge-graph view — drives colour). */
  colorValue?: string | null;
  /** Optional numeric edge weight (Weighted view — drives line width). */
  weight?: number | null;
}

/** One legend row for a categorical edge type. */
export interface EdgeLegendEntry {
  value: string;
  rgb: [number, number, number];
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
  /** Filter to one edge type (others dim). Pass null to clear the filter. */
  setEdgeTypeFilter: (type: string | null) => void;
  /** Distinct edge types + their colours, for the cell to render a legend. */
  edgeLegend: () => EdgeLegendEntry[];
  /** Automation seam — real GPU pick at canvas (x, y); fires onClick. */
  simulateClick: (x: number, y: number, radius?: number) => number | null;
  destroy: () => void;
}

/** Hot→cool ramp on a value's ratio to the max (degree/pagerank/betweenness). */
function rampColor(value: number, max: number): [number, number, number] {
  if (max <= 0) return MID_RGB;
  const r = value / max;
  if (r > 0.5) return HUB_RGB;
  if (r > 0.15) return MID_RGB;
  return LEAF_RGB;
}

/** Categorical colour for a Louvain community index (cycles the palette). */
function communityColor(community: number): [number, number, number] {
  return PALETTE_RGB[community % PALETTE_RGB.length] ?? ACCENT_RGB;
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
  const cx = (minOf(xs) + maxOf(xs)) / 2;
  const cy = (minOf(ys) + maxOf(ys)) / 2;
  const span = Math.max(maxOf(xs) - minOf(xs), maxOf(ys) - minOf(ys)) || 1;
  const width = container.clientWidth || 600;
  const height = container.clientHeight || 420;
  const zoom = Math.log2(Math.min(width, height) / span) - 0.2;
  // Metric that drives colour + size — `metricValue` when set (pagerank /
  // betweenness), else degree. Max is the ramp denominator + size normaliser.
  const metricAt = (n: NetworkRenderNode): number => n.metricValue ?? n.degree;
  const maxMetric = nodes.reduce((m, n) => Math.max(m, metricAt(n)), 0) || 1;

  const canvas = document.createElement('canvas');
  // Explicit drawing-buffer size — deck.gl v9 leaves a bare canvas at 300×150
  // and CSS-stretches it, blurring the graph (same fix as the embedding scatter).
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  canvas.style.cssText = 'width:100%;height:100%;display:block';
  container.appendChild(canvas);

  let selected: number | null = null;
  let neighborSet: ReadonlySet<number> = new Set();
  let edgeTypeFilter: string | null = null;
  let version = 0;

  // Categorical edge colours (Knowledge-graph view) — assigned over the edge
  // sequence so a legend built from the same sequence matches exactly.
  const edgeColorMap = assignCategoryColors(edges.map((e) => e.colorValue ?? null));
  const hasEdgeColor = edgeColorMap.size > 0;
  // Edge width scaling (Weighted view) — normalize finite weights to [1, 6] px.
  const weights = edges.map((e) => e.weight).filter((w): w is number => Number.isFinite(w));
  const wMin = weights.length ? minOf(weights) : 0;
  const wMax = weights.length ? maxOf(weights) : 0;
  const hasEdgeWidth = weights.length > 0 && wMax > wMin;
  const edgeWidthFor = (w: number | null | undefined): number => {
    if (!hasEdgeWidth || !Number.isFinite(w)) return 1;
    return 1 + (((w as number) - wMin) / (wMax - wMin)) * 5;
  };
  const edgeColorFor = (e: NetworkRenderEdge): [number, number, number, number] => {
    const base: [number, number, number] =
      hasEdgeColor && e.colorValue
        ? (edgeColorMap.get(e.colorValue) ?? ACCENT_RGB)
        : [0x6f, 0x7e, 0x76];
    // Dim edges that don't match the active type filter.
    const alpha =
      edgeTypeFilter !== null && e.colorValue !== edgeTypeFilter ? 12 : hasEdgeColor ? 170 : 60;
    return [base[0], base[1], base[2], alpha];
  };

  const nodeLayer = () =>
    new ScatterplotLayer<NetworkRenderNode>({
      id: 'network-nodes',
      data: nodes,
      getPosition: (n) => [n.position[0], n.position[1], 0],
      getFillColor: (n, { index }) => {
        const [r, g, b] =
          n.community != null ? communityColor(n.community) : rampColor(metricAt(n), maxMetric);
        if (selected === null || index === selected || neighborSet.has(index)) {
          return [r, g, b, 255];
        }
        return [r, g, b, 40];
      },
      getRadius: (n, { index }) => {
        // Bounded 2–8 px, scaled by the metric's ratio to the max (so tiny
        // pagerank/betweenness fractions still spread across the size range).
        const ratio = Math.max(0, Math.min(1, metricAt(n) / maxMetric));
        const base = 2 + 6 * Math.sqrt(ratio);
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
                info.object?.id != null
                  ? `${info.object.id} · degree ${info.object.degree}${
                      info.object.metricLabel ? ` · ${info.object.metricLabel}` : ''
                    }`
                  : null,
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
      getColor: (e) => edgeColorFor(e),
      getWidth: (e) => edgeWidthFor(e.weight),
      widthUnits: 'pixels',
      updateTriggers: { getColor: version, getWidth: version },
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
    setEdgeTypeFilter(type) {
      edgeTypeFilter = type;
      version++;
      deck.setProps({ layers: [edgeLayer(), nodeLayer()] });
    },
    edgeLegend() {
      return [...edgeColorMap.entries()].map(([value, rgb]) => ({ value, rgb }));
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
      releaseGlContext(canvas);
      canvas.remove();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Map-cell points overlay — a MapboxOverlay ScatterplotLayer attached to the
// live MapLibre map (interleaved with the basemap). Loaded additively above a
// point-count threshold; the MapLibre chunk stays small + always-loaded, and
// deck.gl is the heavier dep we only pay for when GPU-accelerated scatter is
// needed. @deck.gl/mapbox's MapboxOverlay is a maplibre-gl.IControl attached
// via map.addControl(overlay).
// ─────────────────────────────────────────────────────────────────────────

export interface DeckGlPointsOpts {
  /** The live MapLibre map instance the overlay attaches to. */
  map: {
    addControl: (control: unknown) => unknown;
    removeControl: (control: unknown) => unknown;
  };
  /** Point features from the upstream GeoJSON FeatureCollection. */
  features: GeoJSON.Feature[];
  /** Optional categorical property name driving the colour. */
  colorBy?: string | null;
}

export interface DeckGlOverlayHandle {
  destroy: () => void;
}

export function mountDeckGlPoints({
  map,
  features,
  colorBy,
}: DeckGlPointsOpts): DeckGlOverlayHandle {
  // Flatten to plain (lng, lat, props) records for ScatterplotLayer.
  type ScatterDatum = { position: [number, number]; properties: Record<string, unknown> };
  const data: ScatterDatum[] = [];
  for (const f of features) {
    if (!f.geometry) continue;
    if (f.geometry.type === 'Point') {
      const c = f.geometry.coordinates;
      data.push({ position: [c[0] as number, c[1] as number], properties: f.properties ?? {} });
    } else if (f.geometry.type === 'MultiPoint') {
      for (const c of f.geometry.coordinates) {
        data.push({ position: [c[0] as number, c[1] as number], properties: f.properties ?? {} });
      }
    }
  }

  // Categorical color map (matches the maplibre-map.ts native-circle
  // palette so visual identity is preserved on the threshold flip).
  let valueToColor: ((value: unknown) => [number, number, number]) | null = null;
  if (colorBy) {
    const vals = Array.from(
      new Set(data.map((d) => String(d.properties?.[colorBy] ?? '')).filter((v) => v !== '')),
    ).slice(0, 12);
    if (vals.length > 1) {
      const lookup = new Map<string, [number, number, number]>();
      vals.forEach((v, i) => {
        lookup.set(v, PALETTE_RGB[i % PALETTE_RGB.length] ?? ACCENT_RGB);
      });
      valueToColor = (raw: unknown) => lookup.get(String(raw ?? '')) ?? ACCENT_RGB;
    }
  }

  const scatter = new ScatterplotLayer<ScatterDatum>({
    id: 'deckgl-points',
    data,
    getPosition: (d) => d.position,
    getRadius: 4,
    radiusUnits: 'pixels',
    getFillColor: (d) =>
      valueToColor && colorBy
        ? [...valueToColor(d.properties?.[colorBy]), 230]
        : [...ACCENT_RGB, 230],
    getLineColor: [0x1f, 0x1b, 0x16, 200],
    lineWidthMinPixels: 0.75,
    stroked: true,
    pickable: false,
  });

  const overlay = new MapboxOverlay({
    interleaved: true,
    layers: [scatter],
  });
  // MapLibre's `addControl` accepts deck.gl's overlay (it implements
  // IControl). The narrow Map type above keeps the chunk free of
  // a hard maplibre-gl import — the caller (map-cell.ts) injects the
  // live map instance.
  map.addControl(overlay);

  return {
    destroy: () => {
      try {
        map.removeControl(overlay);
      } catch {
        // Already detached — safe.
      }
    },
  };
}
