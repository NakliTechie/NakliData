// Map cell. Renders an upstream SQL cell's geometry column on a
// MapLibre canvas. Geometry values may be GeoJSON objects (when the
// upstream did `SELECT geometry FROM ...` over a JSON column) or
// strings (when the upstream used `ST_AsGeoJSON(geom)`). Both
// parse via JSON.parse at the cell boundary.
//
// MapLibre lives in a lazy chunk; nothing loads until a map cell
// actually renders.

import { loadChunk } from '../../core/lazy-loader.ts';
import { loadSettings } from '../../core/settings.ts';
import { iconSvg } from '../../tokens/icons.ts';
import { registerGlSurface } from './gl-surface.ts';
import type { CellHandlers, MapCellState, ResultRefCell } from './types.ts';

export function renderMapCell(
  cell: MapCellState,
  upstreamCells: ResultRefCell[],
  handlers: CellHandlers,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cell';
  el.dataset.cellId = cell.id;
  el.dataset.cellKind = 'map';

  const input = upstreamCells.find((c) => c.id === cell.inputCell);
  const cols = input?.lastResult?.columns ?? [];

  el.innerHTML = `
    <div class="cell-head">
      <span class="cell-kind">MAP</span>
      <input class="cell-name" data-region="cell-name" value="${escapeHtml(cell.name ?? '')}"
             placeholder="@name (optional)" aria-label="Map cell name"
             style="border:0;background:transparent;width:140px;outline:none;font-family:var(--font-mono);font-size:11px;" />
      <span style="color: var(--text-muted); font-size:11px;">of</span>
      <select data-action="map-input" aria-label="Input cell" style="font-size:12px;">
        <option value="">— pick a SQL cell —</option>
        ${upstreamCells
          .map(
            (c) =>
              `<option value="${c.id}" ${c.id === cell.inputCell ? 'selected' : ''}>${escapeHtml(c.name ?? c.id)}</option>`,
          )
          .join('')}
      </select>
      ${cols.length > 0 ? renderPickers(cell, cols) : ''}
      <div class="cell-actions">
        <button class="btn btn-ghost" data-action="cell-delete" title="Delete cell" aria-label="Delete cell">
          ${iconSvg('trash', 12)}
        </button>
      </div>
    </div>
    <div class="cell-output cell-output-map" data-region="map-canvas">
      ${input?.lastResult ? '' : '<div class="cell-output-empty">Pick a SQL cell that has a geometry column.</div>'}
    </div>
  `;

  // Forward-pass M10 (2026-06-02): expose the cell-name input so
  // dashboards can reference map cells by @name (same fix as
  // pivot-cell.ts).
  const nameInput = el.querySelector<HTMLInputElement>('[data-region="cell-name"]');
  nameInput?.addEventListener('change', () => {
    handlers.onChange(cell.id, { name: nameInput.value.trim() || null });
  });

  for (const sel of el.querySelectorAll<HTMLSelectElement>('select')) {
    sel.addEventListener('change', () => {
      const patch: Record<string, unknown> = {};
      switch (sel.dataset.action) {
        case 'map-input':
          patch.inputCell = sel.value || null;
          break;
        case 'map-geometry':
          patch.geometryCol = sel.value || null;
          break;
        case 'map-color':
          patch.colorBy = sel.value || null;
          break;
      }
      handlers.onChange(cell.id, patch);
    });
  }

  el.querySelector('[data-action="cell-delete"]')?.addEventListener('click', () =>
    handlers.onDelete(cell.id),
  );

  if (input?.lastResult && cell.geometryCol) {
    const mount = el.querySelector<HTMLElement>('[data-region="map-canvas"]');
    if (mount) {
      // Defer to next microtask so layout settles + map gets non-zero size.
      queueMicrotask(() => renderMap(mount, cell, input.lastResult ?? null));
    }
  } else if (input?.lastResult) {
    const mount = el.querySelector<HTMLElement>('[data-region="map-canvas"]');
    if (mount) {
      mount.innerHTML = '<div class="cell-output-empty">Pick a geometry column.</div>';
    }
  }

  return el;
}

function renderPickers(cell: MapCellState, cols: string[]): string {
  const pick = (label: string, action: string, current: string | null | undefined) => `
    <label style="font-size:11px;color:var(--text-muted);display:inline-flex;align-items:center;gap:4px;">
      ${label}
      <select data-action="${action}" style="font-size:12px;">
        <option value="">—</option>
        ${cols
          .map(
            (c) =>
              `<option value="${escapeHtml(c)}" ${current === c ? 'selected' : ''}>${escapeHtml(c)}</option>`,
          )
          .join('')}
      </select>
    </label>`;
  return pick('geom', 'map-geometry', cell.geometryCol) + pick('color', 'map-color', cell.colorBy);
}

async function renderMap(
  mount: HTMLElement,
  cell: MapCellState,
  result: { rows: Array<Record<string, unknown>>; columns: string[] } | null,
): Promise<void> {
  if (!result || !cell.geometryCol) return;
  mount.innerHTML = '<div class="cell-output-empty">Loading map…</div>';

  // Parse geometry column. Accept GeoJSON object (already parsed by
  // DuckDB-wasm for JSON columns) or string (ST_AsGeoJSON output).
  const features: GeoJSON.Feature[] = [];
  for (const row of result.rows) {
    const raw = row[cell.geometryCol];
    if (raw == null) continue;
    let geom: GeoJSON.Geometry | null = null;
    if (typeof raw === 'string') {
      try {
        geom = JSON.parse(raw) as GeoJSON.Geometry;
      } catch {
        continue;
      }
    } else if (typeof raw === 'object') {
      geom = raw as GeoJSON.Geometry;
    }
    if (!geom || !geom.type) continue;
    const properties: Record<string, unknown> = {};
    for (const c of result.columns) {
      if (c === cell.geometryCol) continue;
      properties[c] = row[c];
    }
    features.push({ type: 'Feature', geometry: geom, properties });
  }

  if (features.length === 0) {
    mount.innerHTML = `<div class="cell-output-empty">No valid GeoJSON geometries in "${escapeHtml(cell.geometryCol)}".</div>`;
    return;
  }

  mount.innerHTML = '';
  // MapLibre needs an explicit-sized container.
  mount.style.height = '420px';
  // Wave 2 W2.6 — count points up-front. Above the threshold we hand
  // point rendering off to deck.gl (GPU-accelerated scatter); below it
  // the native MapLibre circle layer is fine and cheaper.
  const pointCount = features.reduce((n, f) => {
    if (f.geometry?.type === 'Point') return n + 1;
    if (f.geometry?.type === 'MultiPoint') {
      return n + (f.geometry.coordinates?.length ?? 0);
    }
    return n;
  }, 0);
  const useDeckGl = pointCount >= MANY_POINTS_THRESHOLD;
  try {
    // Read the basemap preference per-render — `mapBasemap` is a global
    // user setting; flipping it in Settings takes effect on the next
    // map cell render (we don't watch the change live).
    const { mapBasemap } = await loadSettings();
    const mod = await loadChunk('maplibre-map');
    // A fast follow-up re-render may already have replaced the notebook DOM
    // while we awaited settings + the chunk; mounting a map on the now-detached
    // container would leak an unreachable WebGL context. Bail — the live render
    // mounts it.
    if (!mount.isConnected) return;
    const handle = mod.mountMap({
      container: mount,
      data: { type: 'FeatureCollection', features },
      colorBy: cell.colorBy ?? null,
      basemap: mapBasemap,
      skipNativePoints: useDeckGl,
    });
    // Release the MapLibre (and any deck.gl overlay) WebGL context when the
    // notebook re-renders or this cell is deleted (gl-surface.ts). The overlay
    // handle is captured below once it attaches; both are torn down here.
    let overlayDestroy: (() => void) | null = null;
    registerGlSurface(cell.id, () => {
      overlayDestroy?.();
      handle.destroy();
    });
    if (useDeckGl) {
      // Defer deck.gl until the map's GL context is alive — otherwise
      // the overlay attaches before the map has a canvas to interleave
      // with, and the scatter doesn't appear.
      handle.map.on('load', () => {
        void loadChunk('deckgl')
          .then((deck) => {
            const overlay = deck.mountDeckGlPoints({
              map: handle.map as unknown as {
                addControl: (c: unknown) => unknown;
                removeControl: (c: unknown) => unknown;
              },
              features,
              colorBy: cell.colorBy ?? null,
            });
            overlayDestroy = () => overlay.destroy();
          })
          .catch((err) => {
            console.warn(
              '[naklidata-map] deck.gl overlay failed; the native point layer is suppressed at this density',
              err,
            );
          });
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    mount.innerHTML = `<div class="cell-output-empty">Couldn't render map: ${escapeHtml(msg)}</div>`;
  }
}

/**
 * Point-count threshold for switching from MapLibre native circles to a
 * deck.gl ScatterplotLayer overlay (W2.6). 5_000 is a soft heuristic:
 * below it native circles render fast enough on commodity laptops;
 * above it the GPU-accelerated batch is meaningfully faster + visually
 * cleaner under zoom.
 */
const MANY_POINTS_THRESHOLD = 5_000;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
