// Map cell. Renders an upstream SQL cell's geometry column on a
// MapLibre canvas. Geometry values may be GeoJSON objects (when the
// upstream did `SELECT geometry FROM ...` over a JSON column) or
// strings (when the upstream used `ST_AsGeoJSON(geom)`). Both
// parse via JSON.parse at the cell boundary.
//
// MapLibre lives in a lazy chunk; nothing loads until a map cell
// actually renders.

import { loadChunk } from '../../core/lazy-loader.ts';
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
  const mapMode = cell.mapMode ?? 'geometry';

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
      ${cols.length > 0 ? renderPickers(cell, cols, mapMode) : ''}
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
    sel.addEventListener('change', async () => {
      const patch: Record<string, unknown> = {};
      switch (sel.dataset.action) {
        case 'map-input': {
          const selectedId = sel.value;
          const selected = upstreamCells.find((candidate) => candidate.id === sel.value);
          const inferred = selected?.lastResult
            ? (await loadChunk('map-data')).inferCoordinateColumns(selected.lastResult)
            : null;
          if (!sel.isConnected || sel.value !== selectedId) return;
          patch.inputCell = sel.value || null;
          patch.geometryCol = null;
          patch.latitudeCol = inferred?.latitudeCol ?? null;
          patch.longitudeCol = inferred?.longitudeCol ?? null;
          patch.mapMode = inferred ? 'coordinates' : 'geometry';
          break;
        }
        case 'map-mode': {
          patch.mapMode = sel.value;
          if (sel.value === 'coordinates' && input?.lastResult) {
            const selectedMode = sel.value;
            const inferred = (await loadChunk('map-data')).inferCoordinateColumns(input.lastResult);
            if (!sel.isConnected || sel.value !== selectedMode) return;
            if (inferred) {
              patch.latitudeCol = inferred.latitudeCol;
              patch.longitudeCol = inferred.longitudeCol;
            }
          }
          break;
        }
        case 'map-geometry':
          patch.geometryCol = sel.value || null;
          break;
        case 'map-latitude':
          patch.latitudeCol = sel.value || null;
          break;
        case 'map-longitude':
          patch.longitudeCol = sel.value || null;
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

  const hasBinding =
    mapMode === 'geometry' ? !!cell.geometryCol : !!(cell.latitudeCol && cell.longitudeCol);
  if (input?.lastResult && hasBinding) {
    const mount = el.querySelector<HTMLElement>('[data-region="map-canvas"]');
    if (mount) {
      // Defer to next microtask so layout settles + map gets non-zero size.
      queueMicrotask(() => renderMap(mount, cell, input.lastResult ?? null));
    }
  } else if (input?.lastResult) {
    const mount = el.querySelector<HTMLElement>('[data-region="map-canvas"]');
    if (mount) {
      mount.innerHTML =
        mapMode === 'geometry'
          ? '<div class="cell-output-empty">Pick a geometry column.</div>'
          : '<div class="cell-output-empty">Pick latitude and longitude columns.</div>';
    }
  }

  return el;
}

function renderPickers(
  cell: MapCellState,
  cols: string[],
  mapMode: MapCellState['mapMode'],
): string {
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
  const mode = `
    <label style="font-size:11px;color:var(--text-muted);display:inline-flex;align-items:center;gap:4px;">
      mode
      <select data-action="map-mode" aria-label="Map coordinate mode" style="font-size:12px;">
        <option value="geometry" ${mapMode === 'geometry' ? 'selected' : ''}>Geometry</option>
        <option value="coordinates" ${mapMode === 'coordinates' ? 'selected' : ''}>Latitude + longitude</option>
      </select>
    </label>`;
  const binding =
    mapMode === 'geometry'
      ? pick('geom', 'map-geometry', cell.geometryCol)
      : pick('lat', 'map-latitude', cell.latitudeCol) +
        pick('lon', 'map-longitude', cell.longitudeCol);
  return mode + binding + pick('color', 'map-color', cell.colorBy);
}

async function renderMap(
  mount: HTMLElement,
  cell: MapCellState,
  result: { rows: Array<Record<string, unknown>>; columns: string[] } | null,
): Promise<void> {
  const mapMode = cell.mapMode ?? 'geometry';
  if (
    !result ||
    (mapMode === 'geometry' && !cell.geometryCol) ||
    (mapMode === 'coordinates' && (!cell.latitudeCol || !cell.longitudeCol))
  ) {
    return;
  }
  mount.innerHTML = '<div class="cell-output-empty">Loading map…</div>';

  try {
    const data = await loadChunk('map-data');
    const handle = await data.renderMapData({
      container: mount,
      rows: result.rows,
      columns: result.columns,
      mapMode,
      geometryCol: cell.geometryCol,
      latitudeCol: cell.latitudeCol,
      longitudeCol: cell.longitudeCol,
      colorBy: cell.colorBy,
    });
    if (!handle) return;
    if (!mount.isConnected) {
      handle.destroy();
      return;
    }
    registerGlSurface(cell.id, handle.destroy);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    mount.innerHTML = `<div class="cell-output-empty">Couldn't render map: ${escapeHtml(msg)}</div>`;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
