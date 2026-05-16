// SQL cell: a tab-aware monospace textarea + run button + result preview.
//
// First-cut editor — a CodeMirror 6 integration is pending and tracked in
// DECISIONS.md (lazy-loaded so it doesn't blow the 600 KB shell budget).
// Spec §1 recommends CM6; this is intentionally a placeholder.

import { iconSvg } from '../../tokens/icons.ts';
import type { ColumnAssignment } from '../schema-panel.ts';
import { SINKS, blockReasonFor } from '../sinks/sinks.ts';
import type { CellHandlers, SqlCellState } from './types.ts';

export interface SqlCellExtra {
  /** Schema assignments for the columns of this cell's result. */
  assignmentsFor: (cellId: string) => ColumnAssignment[];
  onSendTo: (cellId: string, sinkId: string) => void;
}

export function renderSqlCell(
  cell: SqlCellState,
  handlers: CellHandlers,
  extra?: SqlCellExtra,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cell';
  el.dataset.cellId = cell.id;
  el.dataset.cellKind = 'sql';
  if (cell.status === 'running') el.classList.add('running');
  if (cell.lastError) el.classList.add('errored');

  el.innerHTML = `
    <div class="cell-head">
      <span class="cell-kind">SQL</span>
      <input class="cell-name" data-region="cell-name" value="${escapeAttr(cell.name ?? '')}"
             placeholder="@name (optional)" aria-label="Cell name" style="border:0;background:transparent;width:140px;outline:none;" />
      <div class="cell-actions">
        <button class="btn btn-primary" data-action="cell-run" title="Run (Ctrl+Enter)">
          ${iconSvg('play', 12)} Run
        </button>
        <button class="btn btn-ghost" data-action="cell-delete" title="Delete cell" aria-label="Delete cell">
          ${iconSvg('trash', 12)}
        </button>
      </div>
    </div>
    <div class="cell-editor" data-region="cell-editor"></div>
    <div class="cell-output" data-region="cell-output"></div>
  `;

  const editorMount = el.querySelector<HTMLElement>('[data-region="cell-editor"]');
  const ta = document.createElement('textarea');
  ta.value = cell.code;
  ta.placeholder = 'SELECT * FROM invoices LIMIT 10';
  ta.spellcheck = false;
  ta.setAttribute('aria-label', 'SQL editor');
  ta.addEventListener('input', () => handlers.onChange(cell.id, { code: ta.value }));
  ta.addEventListener('keydown', (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
      ev.preventDefault();
      handlers.onRun(cell.id, { code: ta.value });
    }
    if (ev.key === 'Tab') {
      ev.preventDefault();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      ta.value = `${ta.value.slice(0, start)}  ${ta.value.slice(end)}`;
      ta.selectionStart = ta.selectionEnd = start + 2;
      handlers.onChange(cell.id, { code: ta.value });
    }
  });
  editorMount?.append(ta);

  const nameInput = el.querySelector<HTMLInputElement>('[data-region="cell-name"]');
  nameInput?.addEventListener('change', () => {
    const v = nameInput.value.trim() || null;
    handlers.onChange(cell.id, { name: v });
  });

  el.querySelector('[data-action="cell-run"]')?.addEventListener('click', () =>
    handlers.onRun(cell.id, { code: ta.value }),
  );
  el.querySelector('[data-action="cell-delete"]')?.addEventListener('click', () =>
    handlers.onDelete(cell.id),
  );

  const out = el.querySelector<HTMLElement>('[data-region="cell-output"]');
  if (out) renderSqlOutput(out, cell);

  if (cell.lastResult && extra) {
    el.append(renderSendToBar(cell, extra));
  }

  return el;
}

function renderSendToBar(cell: SqlCellState, extra: SqlCellExtra): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'display:flex;gap:6px;align-items:center;padding:6px 12px;border-top:1px dashed var(--border);font-size:11px;color:var(--text-muted);background:var(--surface);';
  wrap.innerHTML = '<span>Send result to:</span>';
  const assignments = extra.assignmentsFor(cell.id);
  for (const sink of SINKS) {
    const reason = blockReasonFor(
      sink,
      cell.lastResult as NonNullable<typeof cell.lastResult>,
      assignments,
    );
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost';
    btn.style.cssText = 'padding:2px 6px;font-size:11px;';
    btn.textContent = sink.name;
    if (reason) {
      btn.disabled = true;
      btn.title = reason;
      btn.style.opacity = '0.5';
    } else {
      btn.title = sink.description;
      btn.addEventListener('click', () => extra.onSendTo(cell.id, sink.id));
    }
    wrap.append(btn);
  }
  return wrap;
}

function renderSqlOutput(container: HTMLElement, cell: SqlCellState): void {
  container.innerHTML = '';
  if (cell.status === 'running') {
    container.innerHTML = `<div class="cell-output-empty">Running…</div>`;
    return;
  }
  if (cell.lastError) {
    const div = document.createElement('div');
    div.className = 'cell-output-error';
    div.textContent = cell.lastError;
    container.append(div);
    return;
  }
  if (!cell.lastResult) {
    container.innerHTML = `<div class="cell-output-empty">Run to see results. ${cell.code.trim() ? '' : '(Editor is empty.)'}</div>`;
    return;
  }
  const { columns, rows, rowCount, elapsedMs } = cell.lastResult;
  if (rows.length === 0) {
    container.innerHTML = `<div class="cell-output-empty">No rows.</div>`;
  } else {
    const table = document.createElement('table');
    table.className = 'result-table';
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const col of columns) {
      const th = document.createElement('th');
      th.textContent = col;
      headRow.appendChild(th);
    }
    head.appendChild(headRow);
    table.appendChild(head);
    const body = document.createElement('tbody');
    const previewRows = rows.slice(0, 50);
    for (const r of previewRows) {
      const tr = document.createElement('tr');
      for (const col of columns) {
        const td = document.createElement('td');
        const v = r[col];
        const display = formatCell(v);
        td.textContent = display.text;
        if (display.numeric) td.classList.add('numeric');
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    table.appendChild(body);
    container.append(table);
  }
  const meta = document.createElement('div');
  meta.className = 'cell-result-meta';
  meta.innerHTML = `
    <span>${rowCount.toLocaleString()} row${rowCount === 1 ? '' : 's'}</span>
    <span>${elapsedMs.toFixed(0)} ms</span>
    ${rows.length > 50 ? '<span>showing first 50</span>' : ''}
  `;
  container.append(meta);
}

function formatCell(v: unknown): { text: string; numeric: boolean } {
  if (v === null || v === undefined) return { text: '∅', numeric: false };
  if (typeof v === 'number') return { text: String(v), numeric: true };
  if (typeof v === 'bigint') return { text: v.toString(), numeric: true };
  if (typeof v === 'boolean') return { text: v ? '✓' : '×', numeric: false };
  if (typeof v === 'object') {
    try {
      return { text: JSON.stringify(v), numeric: false };
    } catch {
      return { text: String(v), numeric: false };
    }
  }
  return { text: String(v), numeric: false };
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
