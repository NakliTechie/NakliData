// Embedding / semantic-map cell (Facet track). Renders an upstream SQL cell's
// rows as a deck.gl scatter on an abstract plane. Two position sources:
//   * precomputed (x, y) coordinate columns, or
//   * an embedding column (FLOAT[dim]) auto-projected to 2-D with PCA
//     (core/project2d.ts) — no offline precompute needed.
// With an embedding column set, clicking a point finds its nearest
// neighbours by cosine over the in-memory vectors (core/embed-search.ts's
// rankBySimilarity — no model download, no engine round-trip) and
// highlights them; clicking the background clears.
//
// deck.gl lives in the shared `deckgl` lazy chunk; nothing loads until an
// embedding cell actually renders. Mirrors map-cell.ts's shape.

import { rankBySimilarity } from '../../core/embed-search.ts';
import { loadChunk } from '../../core/lazy-loader.ts';
import { coerceVector, pcaProject2D } from '../../core/project2d.ts';
import { iconSvg } from '../../tokens/icons.ts';
import { registerGlSurface } from './gl-surface.ts';
import type { CellHandlers, EmbeddingCellState, ResultRefCell } from './types.ts';

/** Neighbours highlighted per find-similar click (excluding the clicked point). */
const SIMILAR_K = 10;

export function renderEmbeddingCell(
  cell: EmbeddingCellState,
  upstreamCells: ResultRefCell[],
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
        case 'embed-emb':
          patch.embCol = sel.value || null;
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
    const hasXY = Boolean(cell.xCol && cell.yCol);
    const hasEmb = Boolean(cell.embCol ?? null); // older files lack the key
    if (input?.lastResult && (hasXY || hasEmb)) {
      // Defer to next microtask so layout settles + the canvas gets non-zero size.
      queueMicrotask(() => renderScatter(mount, tip, cell, input.lastResult ?? null));
    } else if (input?.lastResult) {
      mount.innerHTML =
        '<div class="cell-output-empty">Pick x and y columns — or an embedding column (emb) to auto-project.</div>';
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
    pick('label', 'embed-label', cell.labelCol) +
    pick('emb', 'embed-emb', cell.embCol ?? null)
  );
}

async function renderScatter(
  mount: HTMLElement,
  tip: HTMLElement | null,
  cell: EmbeddingCellState,
  result: { rows: Array<Record<string, unknown>>; columns: string[] } | null,
): Promise<void> {
  const embCol = cell.embCol ?? null;
  const hasXY = Boolean(cell.xCol && cell.yCol);
  if (!result || (!hasXY && !embCol)) return;
  mount.innerHTML = '<div class="cell-output-empty">Loading map…</div>';

  const points: Array<{ position: [number, number]; colorValue: string | null; label: string }> =
    [];
  // Vector per point (same index as `points`); null where the row has no
  // usable embedding. Only populated when an embedding column is set.
  const vectors: Array<Float32Array | null> = [];

  if (hasXY) {
    // Precomputed coordinates; embeddings (if any) ride along for find-similar.
    const xCol = cell.xCol as string;
    const yCol = cell.yCol as string;
    for (const row of result.rows) {
      const x = Number(row[xCol]);
      const y = Number(row[yCol]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push({
        position: [x, y],
        colorValue: cell.colorBy ? String(row[cell.colorBy] ?? '') : null,
        label: cell.labelCol ? String(row[cell.labelCol] ?? '') : '',
      });
      vectors.push(embCol ? coerceVector(row[embCol]) : null);
    }
    if (points.length === 0) {
      mount.innerHTML = `<div class="cell-output-empty">No finite (x, y) points in "${escapeHtml(xCol)}" / "${escapeHtml(yCol)}".</div>`;
      return;
    }
  } else if (embCol) {
    // PCA path: project the embedding column to 2-D in-browser.
    const kept: Array<{ vec: Float32Array; colorValue: string | null; label: string }> = [];
    let dim: number | null = null;
    for (const row of result.rows) {
      const vec = coerceVector(row[embCol]);
      if (!vec || vec.length === 0) continue;
      if (dim === null) dim = vec.length;
      if (vec.length !== dim) continue; // ignore stray mixed-dim rows
      kept.push({
        vec,
        colorValue: cell.colorBy ? String(row[cell.colorBy] ?? '') : null,
        label: cell.labelCol ? String(row[cell.labelCol] ?? '') : '',
      });
    }
    if (kept.length === 0) {
      mount.innerHTML = `<div class="cell-output-empty">No embedding vectors in "${escapeHtml(embCol)}" — expected a FLOAT[dim] array column.</div>`;
      return;
    }
    mount.innerHTML = `<div class="cell-output-empty">Projecting ${kept.length.toLocaleString()} vectors to 2-D (PCA)…</div>`;
    let projected: Array<[number, number]>;
    try {
      // Yield to the event loop only after ~32ms of uninterrupted compute —
      // large projections stay responsive, small ones never yield at all.
      // (Yielding every iteration via setTimeout(0) hangs in a backgrounded
      // tab, where browsers throttle timers to ≥1s per tick.)
      let lastYield = performance.now();
      projected = await pcaProject2D(
        kept.map((k) => k.vec),
        {
          onIteration: () => {
            if (performance.now() - lastYield < 32) return Promise.resolve();
            lastYield = performance.now();
            return new Promise((r) => setTimeout(r, 0));
          },
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mount.innerHTML = `<div class="cell-output-empty">Couldn't project "${escapeHtml(embCol)}": ${escapeHtml(msg)}</div>`;
      return;
    }
    for (let i = 0; i < kept.length; i++) {
      const k = kept[i] as (typeof kept)[number];
      points.push({
        position: projected[i] as [number, number],
        colorValue: k.colorValue,
        label: k.label,
      });
      vectors.push(k.vec);
    }
  }

  const similarEnabled = embCol !== null && vectors.some((v) => v !== null);
  const corpus = similarEnabled
    ? vectors.flatMap((v, i) => (v ? [{ id: String(i), vec: v }] : []))
    : [];

  mount.innerHTML = '';
  mount.style.height = '420px';
  try {
    const mod = await loadChunk('deckgl');
    // A fast follow-up re-render may already have replaced the notebook DOM
    // while we awaited the chunk; building a Deck on the now-detached mount
    // would leak an unreachable WebGL context. Bail — the live render mounts it.
    if (!mount.isConnected) return;
    type MountWithSeam = HTMLElement & { __embedScatter?: unknown };
    const handle = mod.mountEmbeddingScatter({
      container: mount,
      points,
      onHover: (label) => {
        if (tip && !tip.dataset.pinned) tip.textContent = label ?? '';
      },
      ...(similarEnabled
        ? {
            onClick: (index: number | null) => {
              if (index === null || !vectors[index]) {
                handle.setHighlight(null, []);
                if (tip) {
                  delete tip.dataset.pinned;
                  tip.textContent = '';
                }
                return;
              }
              const queryVec = vectors[index] as Float32Array;
              // +1 then drop self — the clicked point always ranks first.
              const neighbors = rankBySimilarity(queryVec, corpus, SIMILAR_K + 1)
                .map((n) => Number(n.id))
                .filter((i) => i !== index)
                .slice(0, SIMILAR_K);
              handle.setHighlight(index, neighbors);
              if (tip) {
                const label = points[index]?.label;
                const named = neighbors
                  .map((i) => points[i]?.label)
                  .filter((l): l is string => Boolean(l))
                  .slice(0, 3);
                tip.dataset.pinned = '1';
                const subject = label ? `“${label}”` : 'selection';
                const list = named.length > 0 ? `: ${named.join(' · ')}…` : '';
                tip.textContent = `${neighbors.length} similar to ${subject}${list} — click background to clear`;
              }
            },
          }
        : {}),
    });
    // Automation seam — the smoke test (and future agent verbs) drive
    // find-similar through handle.simulateClick, since synthetic pointer
    // events can't reach deck.gl's input manager.
    (mount as MountWithSeam).__embedScatter = handle;
    // A11y (Chunk 6): the scatter is WebGL — invisible to the accessibility tree.
    // Describe it so a DOM/ARIA-driving agent knows what's here (the seam above
    // stays the interactive hook).
    mount.setAttribute('role', 'img');
    mount.setAttribute(
      'aria-label',
      `Embedding scatter plot: ${points.length.toLocaleString()} points.`,
    );
    // Release the deck.gl WebGL context when the notebook re-renders or this
    // cell is deleted — otherwise every re-render leaks a context (gl-surface.ts).
    registerGlSurface(cell.id, () => handle.destroy());
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
