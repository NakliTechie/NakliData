// Lazy chunk for MapLibre GL JS — renders a GeoJSON FeatureCollection
// on a tile-less canvas (default) or atop an OpenStreetMap raster
// basemap (W1.6 opt-in; spec amendment A13). When the basemap is on,
// MapLibre fetches `https://tile.openstreetmap.org/{z}/{x}/{y}.png` —
// the only host the CSP `img-src` lets through. Off by default;
// honours the user's settings.mapBasemap.
//
// Loaded only when a map cell tries to render — keeps MapLibre + its
// dependencies (a sizable lazy chunk) out of the inlined shell.
//
// MapLibre's own CSS is not imported — it only matters for popups,
// zoom/attribution controls, and the cooperative-gesture overlay,
// none of which we use. Adding it would require an esbuild type
// declaration shim; not worth it for the minimal-controls map.

import maplibre from 'maplibre-gl';

export type MapBasemap = 'none' | 'osm';

export interface MapRenderOpts {
  container: HTMLElement;
  /** GeoJSON FeatureCollection or single Feature. */
  data: GeoJSON.FeatureCollection | GeoJSON.Feature;
  /** Property name to drive the fill / circle color (categorical). */
  colorBy?: string | null;
  /** Optional raster basemap. Default `'none'` — tile-less canvas. */
  basemap?: MapBasemap;
  /**
   * When true, skip the native MapLibre `points` layer. Used when
   * caller is going to attach a deck.gl ScatterplotLayer overlay
   * instead (W2.6). Polygon + line layers still render natively.
   */
  skipNativePoints?: boolean;
}

export interface MapHandle {
  destroy: () => void;
  /**
   * The live MapLibre `Map` instance. Exposed for additive overlays
   * (W2.6 deck.gl pairing). Treat as read-mostly — the lazy chunk
   * keeps responsibility for the layers it added.
   */
  map: maplibre.Map;
}

const ACCENT = '#B5371C';
const BACKGROUND = '#FAF7F0';

const EMPTY_STYLE: maplibre.StyleSpecification = {
  version: 8,
  glyphs: '', // No tile basemap → no glyph fetches needed.
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': BACKGROUND },
    },
  ],
};

/**
 * Style preset for the OpenStreetMap raster basemap. The CSP `img-src`
 * directive carves out `https://tile.openstreetmap.org` (and only that
 * host). Per OSM tile usage policy, attribution is required — the map
 * cell renders a small "© OpenStreetMap contributors" link beneath the
 * canvas (see ui/cells/map-cell.ts).
 *
 * Subdomains a/b/c are deprecated as of ~2022; the single-host URL is
 * the modern path. We do not run any glyph or sprite fetches — labels
 * are baked into the tile.
 */
const OSM_STYLE: maplibre.StyleSpecification = {
  version: 8,
  glyphs: '',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

export function mountMap({
  container,
  data,
  colorBy,
  basemap,
  skipNativePoints,
}: MapRenderOpts): MapHandle {
  const features = data.type === 'FeatureCollection' ? data.features : [data];
  const collection: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features,
  };
  const useOsm = basemap === 'osm';
  const map = new maplibre.Map({
    container,
    style: useOsm ? OSM_STYLE : EMPTY_STYLE,
    // OSM tile usage policy: attribution is required. Render it via the
    // MapLibre built-in control when the basemap is on.
    attributionControl: useOsm ? { compact: true } : false,
  });

  map.on('load', () => {
    map.addSource('features', { type: 'geojson', data: collection });

    // Categorical color expression — if `colorBy` is set and that property
    // exists with > 1 distinct value, map values → palette stops. Otherwise
    // just use the accent. We assemble a MapLibre `match` expression as a
    // plain array; the runtime accepts the well-known shape even though
    // the static type for matches is strictly typed.
    let fillColor: unknown = ACCENT;
    if (colorBy) {
      const vals = Array.from(
        new Set(features.map((f) => String(f.properties?.[colorBy] ?? '')).filter((v) => v !== '')),
      ).slice(0, 12);
      if (vals.length > 1) {
        const palette = [
          '#B5371C',
          '#6F7E76',
          '#D6A24E',
          '#3C5A6B',
          '#8C6F4A',
          '#4F7B6E',
          '#A56A8C',
          '#9C5230',
          '#5B7F9B',
          '#7B6FB1',
          '#506650',
          '#A77E5F',
        ];
        const stops: Array<string> = [];
        vals.forEach((v, i) => {
          stops.push(v, palette[i % palette.length] ?? ACCENT);
        });
        fillColor = ['match', ['to-string', ['get', colorBy]], ...stops, ACCENT];
      }
    }
    // Cast to the MapLibre paint-property type at the call site.
    const fillColorPaint = fillColor as maplibre.ExpressionSpecification | string;

    map.addLayer({
      id: 'polygons',
      type: 'fill',
      source: 'features',
      filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
      paint: { 'fill-color': fillColorPaint, 'fill-opacity': 0.65 },
    });
    map.addLayer({
      id: 'lines',
      type: 'line',
      source: 'features',
      filter: ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]],
      paint: { 'line-color': fillColorPaint, 'line-width': 2 },
    });
    if (!skipNativePoints) {
      map.addLayer({
        id: 'points',
        type: 'circle',
        source: 'features',
        filter: ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]],
        paint: {
          'circle-color': fillColorPaint,
          'circle-radius': 5,
          'circle-stroke-color': '#1F1B16',
          'circle-stroke-width': 0.75,
        },
      });
    }
    map.addLayer({
      id: 'polygons-outline',
      type: 'line',
      source: 'features',
      filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
      paint: { 'line-color': '#1F1B16', 'line-width': 0.5 },
    });

    // Fit bounds to data.
    try {
      const bounds = new maplibre.LngLatBounds();
      for (const f of features) {
        extendBounds(bounds, f.geometry);
      }
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 24, animate: false, maxZoom: 14 });
      }
    } catch (err) {
      console.warn('[naklidata-map] bounds fit failed', err);
    }
  });

  return { destroy: () => map.remove(), map };
}

function extendBounds(bounds: maplibre.LngLatBounds, geom: GeoJSON.Geometry | null): void {
  if (!geom) return;
  switch (geom.type) {
    case 'Point':
      bounds.extend(geom.coordinates as [number, number]);
      break;
    case 'MultiPoint':
    case 'LineString':
      for (const c of geom.coordinates) bounds.extend(c as [number, number]);
      break;
    case 'MultiLineString':
    case 'Polygon':
      for (const ring of geom.coordinates) {
        for (const c of ring) bounds.extend(c as [number, number]);
      }
      break;
    case 'MultiPolygon':
      for (const poly of geom.coordinates) {
        for (const ring of poly) {
          for (const c of ring) bounds.extend(c as [number, number]);
        }
      }
      break;
    case 'GeometryCollection':
      for (const g of geom.geometries) extendBounds(bounds, g);
      break;
  }
}
