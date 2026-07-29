// Lazy row-to-GeoJSON preparation shared by both Map cell modes. Keeping this
// off the inlined shell preserves the 768 KB startup budget; it loads only
// after a map has both an upstream result and a complete binding.

import { loadChunk } from '../core/lazy-loader.ts';
import { coordinatePoint, inferCoordinateColumns } from '../core/map-coordinates.ts';
import { loadSettings } from '../core/settings.ts';

export { inferCoordinateColumns };

export interface MapDataInput {
  rows: Array<Record<string, unknown>>;
  columns: string[];
  mapMode: 'geometry' | 'coordinates';
  geometryCol: string | null;
  latitudeCol: string | null;
  longitudeCol: string | null;
}

export interface PreparedMapData {
  features: GeoJSON.Feature[];
  invalidCoordinateRows: number;
  pointCount: number;
}

export interface MapCellRenderInput extends MapDataInput {
  container: HTMLElement;
  colorBy: string | null;
}

export function prepareMapData(input: MapDataInput): PreparedMapData {
  const features: GeoJSON.Feature[] = [];
  let invalidCoordinateRows = 0;
  for (const row of input.rows) {
    let geometry: GeoJSON.Geometry | null = null;
    if (input.mapMode === 'coordinates') {
      const point = coordinatePoint(row[input.latitudeCol ?? ''], row[input.longitudeCol ?? '']);
      if (!point) {
        invalidCoordinateRows++;
        continue;
      }
      geometry = { type: 'Point', coordinates: point };
    } else {
      const raw = row[input.geometryCol ?? ''];
      if (raw == null) continue;
      if (typeof raw === 'string') {
        try {
          geometry = JSON.parse(raw) as GeoJSON.Geometry;
        } catch {
          continue;
        }
      } else if (typeof raw === 'object') {
        geometry = raw as GeoJSON.Geometry;
      }
    }
    if (!geometry?.type) continue;
    const properties: Record<string, unknown> = {};
    for (const column of input.columns) {
      if (input.mapMode === 'geometry' && column === input.geometryCol) continue;
      properties[column] = row[column];
    }
    features.push({ type: 'Feature', geometry, properties });
  }
  const pointCount = features.reduce((count, feature) => {
    if (feature.geometry.type === 'Point') return count + 1;
    if (feature.geometry.type === 'MultiPoint') {
      return count + feature.geometry.coordinates.length;
    }
    return count;
  }, 0);
  return { features, invalidCoordinateRows, pointCount };
}

export async function renderMapData(input: MapCellRenderInput): Promise<{
  destroy: () => void;
} | null> {
  const { features, invalidCoordinateRows, pointCount } = prepareMapData(input);
  if (!input.container.isConnected) return null;
  if (features.length === 0) {
    showEmpty(
      input.container,
      input.mapMode === 'geometry'
        ? `No valid GeoJSON geometries in "${input.geometryCol ?? ''}".`
        : 'No valid coordinate pairs. Latitude must be −90…90 and longitude −180…180.',
    );
    return null;
  }

  const { mapBasemap } = await loadSettings();
  const mapModule = await loadChunk('maplibre-map');
  if (!input.container.isConnected) return null;
  input.container.innerHTML = '';
  input.container.style.height = '420px';
  const useDeckGl = pointCount >= 5_000;
  const handle = mapModule.mountMap({
    container: input.container,
    data: { type: 'FeatureCollection', features },
    colorBy: input.colorBy,
    basemap: mapBasemap,
    skipNativePoints: useDeckGl,
    deckGlPoints: useDeckGl,
  });
  input.container.setAttribute('role', 'img');
  input.container.setAttribute(
    'aria-label',
    `Map: ${features.length.toLocaleString()} geographic features.${
      invalidCoordinateRows > 0
        ? ` ${invalidCoordinateRows.toLocaleString()} row${invalidCoordinateRows === 1 ? '' : 's'} omitted for invalid coordinates.`
        : ''
    }`,
  );
  return handle;
}

function showEmpty(container: HTMLElement, message: string): void {
  container.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'cell-output-empty';
  empty.textContent = message;
  container.append(empty);
}
