// Embedding / semantic-map cell (Facet track). Renders an upstream SQL cell's
// precomputed (x, y) coordinate columns as a deck.gl scatter on an abstract
// plane — the "x, y (precomputed) → embedding map" view type. Colour by an
// optional categorical column; hover shows an optional label column.
//
// deck.gl lives in the `deckgl-embedding` lazy chunk; nothing loads until an
// embedding cell actually renders. Mirrors map-cell.ts's shape.

import { loadChunk } from '../../core/lazy-loader.ts';
import { iconSvg } from '../../tokens/icons.ts';
import type { CellHandlers, EmbeddingCellState, SqlCellState } from './types.ts';

export function renderEmbeddingCell(
  cell: EmbeddingCellState,
  upstreamCells: SqlCellState[],
  handlers: CellHandlers,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cell';
  el.dataset.cellId = cell.id;
  el.dataset.cellKind = 'embedding';

  const input = upstreamCells.find((c) => c.id === cell.inputCell);
  const cols = input?.lastResult?.columns ?? [];

  el.innerHTML = `
    <div class="cell-head">
      <span class="cell-kind">EMBED</span>
      <input class="cell-name" data-region="cell-name" value="${escapeHtml(cell.name ?? '')}"
             placeholder="@name (optional)" aria-label="Embedding cell name"
             style="border:0;background:transparent;width:140px;outline:none;font-family:var(--font-mono);font-size:11px;" />
      <span style="color: var(--text-muted); font-size:11px;">of</span>
      <select data-action="embed-input" aria-label="Input cell" style="font-size:12px;">
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
    <div class="cell-output cell-output-map" data-region="embed-canvas">
      ${input?.lastResult ? '' : '<div class="cell-output-empty">Pick a SQL cell with precomputed x / y coordinate columns.</div>'}
    </div>
    <div data-region="embed-tip" style="font-size:11px;color:var(--text-muted);padding:2px 4px;min-height:15px;"></div>
  `;

  const nameInput = el.querySelector<HTMLInputElement>('[data-region="cell-name"]');
  nameInput?.addEventListener('change', () => {
    handlers.onChange(cell.id, { name: nameInput.value.trim() || null });
  });

  for (const sel of el.querySelectorAll<HTMLSelectElement>('select')) {
    sel.addEventListener('change', () => {
      const patch: Record<string, unknown> = {};
      switch (sel.dataset.action) {
        case 'embed-input':
          patch.inputCell = sel.value || null;
          break;
        case 'embed-x':
          patch.xCol = sel.value || null;
          break;
        case 'embed-y':
          patch.yCol = sel.value || null;
          break;
        case 'embed-color':
          patch.colorBy = sel.value || null;
          break;
        case 'embed-label':
          patch.labelCol = sel.value || null;
          break;
      }
      handlers.onChange(cell.id, patch);
    });
  }

  el.querySelector('[data-action="cell-delete"]')?.addEventListener('click', () =>
    handlers.onDelete(cell.id),
  );

  const mount = el.querySelector<HTMLElement>('[data-region="embed-canvas"]');
  const tip = el.querySelector<HTMLElement>('[data-region="embed-tip"]');
  if (mount) {
    if (input?.lastResult && cell.xCol && cell.yCol) {
      // Defer to next microtask so layout settles + the canvas gets non-zero size.
      queueMicrotask(() => renderScatter(mount, tip, cell, input.lastResult ?? null));
    } else if (input?.lastResult) {
      mount.innerHTML = '<div class="cell-output-empty">Pick x and y columns.</div>';
    }
  }

  return el;
}

function renderPickers(cell: EmbeddingCellState, cols: string[]): string {
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
  return (
    pick('x', 'embed-x', cell.xCol) +
    pick('y', 'embed-y', cell.yCol) +
    pick('color', 'embed-color', cell.colorBy) +
    pick('label', 'embed-label', cell.labelCol)
  );
}

async function renderScatter(
  mount: HTMLElement,
  tip: HTMLElement | null,
  cell: EmbeddingCellState,
  result: { rows: Array<Record<string, unknown>>; columns: string[] } | null,
): Promise<void> {
  if (!result || !cell.xCol || !cell.yCol) return;
  mount.innerHTML = '<div class="cell-output-empty">Loading map…</div>';

  const points: Array<{ position: [number, number]; colorValue: string | null; label: string }> =
    [];
  for (const row of result.rows) {
    const x = Number(row[cell.xCol]);
    const y = Number(row[cell.yCol]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push({
      position: [x, y],
      colorValue: cell.colorBy ? String(row[cell.colorBy] ?? '') : null,
      label: cell.labelCol ? String(row[cell.labelCol] ?? '') : '',
    });
  }

  if (points.length === 0) {
    mount.innerHTML = `<div class="cell-output-empty">No finite (x, y) points in "${escapeHtml(cell.xCol)}" / "${escapeHtml(cell.yCol)}".</div>`;
    return;
  }

  mount.innerHTML = '';
  mount.style.height = '420px';
  try {
    const mod = await loadChunk('deckgl-embedding');
    mod.mountEmbeddingScatter({
      container: mount,
      points,
      onHover: (label) => {
        if (tip) tip.textContent = label ?? '';
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    mount.innerHTML = `<div class="cell-output-empty">Couldn't render embedding map: ${escapeHtml(msg)}</div>`;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
