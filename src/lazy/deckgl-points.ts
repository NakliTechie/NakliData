// Lazy chunk — deck.gl scatterplot overlay for map cells with many
// points. Wave 2 W2.6.
//
// Loaded ADDITIVELY on top of the existing MapLibre map only when the
// point count exceeds a threshold (see ui/cells/map-cell.ts). The
// MapLibre chunk stays small + always-loaded; deck.gl is the heavier
// dependency we only pay for when we need GPU-accelerated scatter
// rendering.
//
// Integration shape: @deck.gl/mapbox provides `MapboxOverlay`, a
// `maplibre-gl.IControl` that attaches via `map.addControl(overlay)`.
// We default to interleaved mode (deck.gl layers between MapLibre
// layers) for a clean visual blend on top of the basemap when one is
// enabled (A13).

import { ScatterplotLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';

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
