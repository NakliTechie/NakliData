// Shared renderer for the language cells — Polyglot-Workbench Fork 2. One
// renderer serves both the `python` (Pyodide) and `r` (WebR) cells: they're
// structurally identical (input picker + code editor + Run + preview), differ
// only in label, starter code, and the run action. Compute lives in the lazy
// runtime chunks; this is render-only. (One shared renderer, not two, keeps the
// eager shell within budget.)

import { iconSvg } from '../../tokens/icons.ts';
import type { CellHandlers, PythonCellState, RCellState } from './types.ts';

type LangCell = PythonCellState | RCellState;

const LANG = {
  python: {
    label: 'python',
    action: 'run-python',
    size: '33 MB',
    starter:
      '# df: the input table (pandas DataFrame). The final df becomes this cell.\ndf = df.head(100)',
  },
  r: {
    label: 'r',
    action: 'run-r',
    size: '66 MB',
    starter:
      '# df: the input table (data.frame). The final df becomes this cell.\ndf <- head(df, 100)',
  },
} as const;

export function renderLanguageCell(
  cell: LangCell,
  sqlCells: ReadonlyArray<{ id: string; name: string | null }>,
  handlers: CellHandlers,
): HTMLElement {
  const lang = LANG[cell.kind];
  const wrap = document.createElement('div');
  wrap.className = `cell cell-${cell.kind}`;
  wrap.dataset.cellId = cell.id;
  wrap.dataset.cellKind = cell.kind;

  const options = sqlCells
    .map(
      (c) =>
        `<option value="${esc(c.id)}" ${c.id === cell.inputCell ? 'selected' : ''}>${esc(c.name ?? c.id)}</option>`,
    )
    .join('');
  const busy = cell.status === 'running' || cell.status === 'loading';

  wrap.innerHTML = `
    <div class="cell-head">
      <span class="cell-kind">${iconSvg('file', 12)} ${lang.label}</span>
      <input class="cell-name-input" placeholder="name (optional)" value="${cell.name ? esc(cell.name) : ''}" data-action="cell-name-edit" />
      <select data-action="lang-input" aria-label="Input cell" style="font-size:12px;">
        <option value="" ${cell.inputCell ? '' : 'selected'}>(pick input)</option>
        ${options}
      </select>
      <span style="flex:1;"></span>
      <button class="btn btn-ghost" data-action="${lang.action}" data-cell-id="${cell.id}" title="Run" ${busy ? 'disabled' : ''}>${iconSvg('play', 12)} <span>Run</span></button>
      <button class="btn btn-ghost" data-action="cell-delete" data-cell-id="${cell.id}" aria-label="Delete cell">${iconSvg('x', 12)}</button>
    </div>
    <textarea class="python-code" data-action="lang-code" spellcheck="false">${esc(cell.code || lang.starter)}</textarea>
    <div class="cell-output">${renderBody(cell, lang)}</div>
  `;

  wrap
    .querySelector<HTMLInputElement>('[data-action="cell-name-edit"]')
    ?.addEventListener('change', (ev) => {
      handlers.onChange(cell.id, { name: (ev.target as HTMLInputElement).value.trim() || null });
    });
  // H3: the global dispatcher skips cell-delete for cells that "attach their
  // own handlers" — this renderer didn't, so delete was a no-op. Attach it.
  wrap
    .querySelector<HTMLButtonElement>('[data-action="cell-delete"]')
    ?.addEventListener('click', () => handlers.onDelete(cell.id));
  wrap
    .querySelector<HTMLSelectElement>('[data-action="lang-input"]')
    ?.addEventListener('change', (ev) => {
      handlers.onChange(cell.id, { inputCell: (ev.target as HTMLSelectElement).value || null });
    });
  const ta = wrap.querySelector<HTMLTextAreaElement>('[data-action="lang-code"]');
  ta?.addEventListener('change', (ev) => {
    // Silent — a re-render on blur would detach the Run button mid-click.
    handlers.onChangeSilent(cell.id, { code: (ev.target as HTMLTextAreaElement).value });
  });
  ta?.addEventListener('keydown', (ev) => {
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

function renderBody(cell: LangCell, lang: (typeof LANG)[keyof typeof LANG]): string {
  if (cell.status === 'loading') {
    return `<div class="cell-output-loading">${esc(cell.loadPhase ?? 'Downloading…')}</div>`;
  }
  if (cell.status === 'running') {
    return `<div class="cell-output-loading">Running ${lang.label}…</div>`;
  }
  if (cell.status === 'error') {
    return `<div class="cell-output-error">${lang.label} error: ${esc(cell.lastError ?? 'unknown error')}</div>`;
  }
  if (!cell.preview) {
    return `<div class="cell-output-empty">Pick an input cell and Run. First run downloads ${lang.label} (~${lang.size}, cached).</div>`;
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
