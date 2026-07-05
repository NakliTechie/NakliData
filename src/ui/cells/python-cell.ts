// Python cell renderer — Polyglot-Workbench Fork 2. The compute lives in the
// lazy `pyodide-runtime` chunk (off the shell budget); this is render-only.
//
// Bound to an upstream result cell via `inputCell`. On Run the input table is
// handed (as Parquet) to the vendored Pyodide runtime, the user's Python
// mutates a pandas `df`, and the result re-registers as `cell_<id>` — queryable
// downstream. See DECISIONS CE + src/lazy/pyodide-runtime.ts.

import { iconSvg } from '../../tokens/icons.ts';
import type { CellHandlers, PythonCellState } from './types.ts';

const STARTER_CODE = `# 'df' is the input as a pandas DataFrame; the final 'df' becomes this cell's table.
df = df.head(100)`;

export function renderPythonCell(
  cell: PythonCellState,
  sqlCells: ReadonlyArray<{ id: string; name: string | null }>,
  handlers: CellHandlers,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'cell cell-python';
  wrap.dataset.cellId = cell.id;
  wrap.dataset.cellKind = 'python';

  const options = sqlCells
    .map(
      (c) =>
        `<option value="${esc(c.id)}" ${c.id === cell.inputCell ? 'selected' : ''}>${esc(c.name ?? c.id)}</option>`,
    )
    .join('');
  const busy = cell.status === 'running' || cell.status === 'loading';

  wrap.innerHTML = `
    <div class="cell-head">
      <span class="cell-kind">${iconSvg('file', 12)} python</span>
      <input class="cell-name-input" placeholder="name (optional)" value="${cell.name ? esc(cell.name) : ''}" data-action="cell-name-edit" />
      <select data-action="python-input" aria-label="Input cell" style="font-size:12px;">
        <option value="" ${cell.inputCell ? '' : 'selected'}>(pick input)</option>
        ${options}
      </select>
      <span style="flex:1;"></span>
      <button class="btn btn-ghost" data-action="run-python" data-cell-id="${cell.id}" title="Run Python" ${busy ? 'disabled' : ''}>${iconSvg('play', 12)} <span>Run</span></button>
      <button class="btn btn-ghost" data-action="cell-delete" data-cell-id="${cell.id}" aria-label="Delete cell">${iconSvg('x', 12)}</button>
    </div>
    <textarea class="python-code" data-action="python-code" spellcheck="false">${esc(cell.code || STARTER_CODE)}</textarea>
    <div class="cell-output">${renderBody(cell)}</div>
  `;

  wrap
    .querySelector<HTMLInputElement>('[data-action="cell-name-edit"]')
    ?.addEventListener('change', (ev) => {
      handlers.onChange(cell.id, { name: (ev.target as HTMLInputElement).value.trim() || null });
    });
  wrap
    .querySelector<HTMLSelectElement>('[data-action="python-input"]')
    ?.addEventListener('change', (ev) => {
      handlers.onChange(cell.id, { inputCell: (ev.target as HTMLSelectElement).value || null });
    });
  const ta = wrap.querySelector<HTMLTextAreaElement>('[data-action="python-code"]');
  ta?.addEventListener('change', (ev) => {
    // Silent — persist the code WITHOUT re-rendering. A re-render on blur would
    // detach the Run button as it's being clicked, dropping the click.
    handlers.onChangeSilent(cell.id, { code: (ev.target as HTMLTextAreaElement).value });
  });
  ta?.addEventListener('keydown', (ev) => {
    // Tab inserts two spaces instead of moving focus.
    if (ev.key === 'Tab') {
      ev.preventDefault();
      const t = ev.target as HTMLTextAreaElement;
      const s = t.selectionStart;
      t.value = `${t.value.slice(0, s)}  ${t.value.slice(t.selectionEnd)}`;
      t.selectionStart = t.selectionEnd = s + 2;
    }
  });
  return wrap;
}

function renderBody(cell: PythonCellState): string {
  if (cell.status === 'loading') {
    return `<div class="cell-output-loading">${esc(cell.loadPhase ?? 'Downloading Python…')}</div>`;
  }
  if (cell.status === 'running') {
    return `<div class="cell-output-loading">Running Python…</div>`;
  }
  if (cell.status === 'error') {
    return `<div class="cell-output-error">Python error: ${esc(cell.lastError ?? 'unknown error')}</div>`;
  }
  if (!cell.preview) {
    return `<div class="cell-output-empty">Pick an input cell and Run. First run downloads Python (~33 MB, cached).</div>`;
  }
  const p = cell.preview;
  const head = `<tr>${p.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;
  const body = p.rows
    .map((r) => `<tr>${p.columns.map((c) => `<td>${esc(fmt(r[c]))}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="python-shape">${p.rowCount.toLocaleString()} rows × ${p.columns.length} cols</div>
    <div style="overflow-x:auto;"><table class="result-table">${head}${body}</table></div>`;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
