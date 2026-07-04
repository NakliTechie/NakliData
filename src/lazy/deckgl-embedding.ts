// Lazy chunk — deck.gl scatter for the Embedding / semantic-map view (Facet
// track). Unlike deckgl-points.ts (a MapboxOverlay on a MapLibre basemap), this
// is a STANDALONE deck.gl `Deck` on an `OrthographicView` — an abstract 2-D
// plane, no geography — for precomputed (x, y) embedding coordinates. Loaded
// only when an embedding cell actually renders; deck.gl never touches the shell.

import { Deck, OrthographicView } from '@deck.gl/core';
import { ScatterplotLayer } from '@deck.gl/layers';

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

// Mirrors the deckgl-points.ts / maplibre-map.ts categorical palette so the
// visual identity is shared across every deck.gl surface.
const ACCENT_RGB: [number, number, number] = [0xb5, 0x37, 0x1c];
const PALETTE_RGB: Array<[number, number, number]> = [
  [0xb5, 0x37, 0x1c],
  [0x6f, 0x7e, 0x76],
  [0xd6, 0xa2, 0x4e],
  [0x3c, 0x5a, 0x6b],
  [0x8c, 0x6f, 0x4a],
  [0x4f, 0x7b, 0x6e],
  [0xa5, 0x6a, 0x8c],
  [0x9c, 0x52, 0x30],
  [0x5b, 0x7f, 0x9b],
  [0x7b, 0x6f, 0xb1],
  [0x50, 0x66, 0x50],
  [0xa7, 0x7e, 0x5f],
];

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
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
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
      canvas.remove();
    },
  };
}
