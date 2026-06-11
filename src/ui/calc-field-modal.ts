// v1.4 F4/F5 — Calculated-field modal.
//
// Add a derived column to a result without hand-writing the query. Two
// modes: a free **Expression** (column chips help build it) and a
// **Window** (LOD-style) builder (fn + column + optional partition).
// Live SQL preview; "Insert as SQL cell" emits a new cell the user runs
// (Hard NOT #4). The emit + injection-safety live in core/calc-field.ts.

import {
  type WindowFn,
  emitCalculatedField,
  emitWindowExpression,
  validateCalcAlias,
} from '../core/calc-field.ts';
import { iconSvg } from '../tokens/icons.ts';
import { restoreModalFocus } from './modal-focus.ts';

export interface CalcFieldDescriptor {
  /** The upstream SQL cell's code — wrapped as a subquery. */
  upstreamSql: string;
  /** Result columns, for the chips + window builder. */
  columns: ReadonlyArray<string>;
}

let _modalEl: HTMLElement | null = null;
let _onKey: ((ev: KeyboardEvent) => void) | null = null;
let _prevFocus: HTMLElement | null = null;
let _onInsert: ((sql: string) => void) | null = null;
let _desc: CalcFieldDescriptor | null = null;
let _mode: 'expression' | 'window' = 'expression';

const WINDOW_FNS: ReadonlyArray<WindowFn> = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'];

export function openCalcFieldModal(
  desc: CalcFieldDescriptor,
  onInsert: (sql: string) => void,
): void {
  if (_modalEl) return;
  _desc = desc;
  _onInsert = onInsert;
  _mode = 'expression';
  _prevFocus = (document.activeElement as HTMLElement) ?? null;
  const overlay = render();
  document.body.append(overlay);
  _modalEl = overlay;
  _modalEl.querySelector<HTMLElement>('[data-region="cf-alias"]')?.focus();
}

export function closeCalcFieldModal(): void {
  if (_modalEl?.parentElement) _modalEl.parentElement.removeChild(_modalEl);
  _modalEl = null;
  if (_onKey) {
    document.removeEventListener('keydown', _onKey);
    _onKey = null;
  }
  restoreModalFocus(_prevFocus);
  _prevFocus = null;
  _onInsert = null;
  _desc = null;
}

/** Current expression from the active mode. */
function currentExpr(): string {
  if (!_modalEl) return '';
  if (_mode === 'window') {
    const fn = (_modalEl.querySelector<HTMLSelectElement>('[data-region="cf-fn"]')?.value ??
      'SUM') as WindowFn;
    const col = _modalEl.querySelector<HTMLSelectElement>('[data-region="cf-col"]')?.value ?? '';
    const part = _modalEl.querySelector<HTMLSelectElement>('[data-region="cf-part"]')?.value ?? '';
    if (!col) return '';
    try {
      return emitWindowExpression(fn, col, part ? [part] : []);
    } catch {
      return '';
    }
  }
  return _modalEl.querySelector<HTMLTextAreaElement>('[data-region="cf-expr"]')?.value ?? '';
}

function refreshPreview(): void {
  if (!_modalEl || !_desc) return;
  const alias = _modalEl.querySelector<HTMLInputElement>('[data-region="cf-alias"]')?.value ?? '';
  const preview = _modalEl.querySelector<HTMLElement>('[data-region="cf-preview"]');
  const expr = currentExpr();
  if (!preview) return;
  if (!alias.trim() || !expr.trim()) {
    preview.textContent = '(enter a column name + expression)';
    return;
  }
  try {
    preview.textContent = emitCalculatedField(_desc.upstreamSql, alias, expr);
  } catch (e) {
    preview.textContent = `⚠ ${e instanceof Error ? e.message : String(e)}`;
  }
}

function render(): HTMLElement {
  const desc = _desc as CalcFieldDescriptor;
  const overlay = document.createElement('div');
  overlay.className = 'schema-graph-overlay calc-field-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'cf-title');

  const colOptions = desc.columns
    .map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`)
    .join('');
  const chips = desc.columns
    .map(
      (c) =>
        `<button class="btn btn-ghost cf-chip" data-col="${escapeAttr(c)}">${escapeHtml(c)}</button>`,
    )
    .join('');

  const exprPane = `
    <div data-region="cf-pane-expression" ${_mode === 'window' ? 'hidden' : ''}>
      <label style="font-size:12px;">Expression (uses the result's columns)
        <textarea data-region="cf-expr" rows="2" placeholder="cgst + sgst + igst" style="width:100%;display:block;margin-top:2px;font-family:var(--font-mono);font-size:11px;"></textarea></label>
      <div class="cf-chips" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">${chips}</div>
    </div>`;
  const windowPane = `
    <div data-region="cf-pane-window" ${_mode === 'expression' ? 'hidden' : ''} style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;">
      <label style="font-size:12px;">Function
        <select data-region="cf-fn" style="display:block;margin-top:2px;">${WINDOW_FNS.map((f) => `<option>${f}</option>`).join('')}</select></label>
      <label style="font-size:12px;">Of column
        <select data-region="cf-col" style="display:block;margin-top:2px;"><option value="">—</option>${colOptions}</select></label>
      <label style="font-size:12px;">Partitioned by (optional)
        <select data-region="cf-part" style="display:block;margin-top:2px;"><option value="">(whole result)</option>${colOptions}</select></label>
    </div>`;

  overlay.innerHTML = `
    <div class="schema-graph-modal calc-field-modal" role="document"
         style="width:min(640px,100%);height:auto;max-height:min(88vh,720px);display:flex;flex-direction:column;">
      <header class="schema-graph-header">
        <h2 id="cf-title" style="margin:0;font-size:var(--text-md,15px);display:flex;align-items:center;gap:6px;">
          ${iconSvg('plus', 14)} Calculated field
        </h2>
        <button class="btn btn-ghost schema-graph-close" data-action="cf-close" aria-label="Close" style="margin-left:auto;">${iconSvg('x', 14)}</button>
      </header>
      <div style="padding:var(--space-3) var(--space-4);overflow:auto;flex:1;min-height:0;">
        <label style="font-size:12px;">New column name
          <input type="text" data-region="cf-alias" placeholder="tax_total" style="width:100%;display:block;margin-top:2px;" /></label>
        <div class="cf-mode" role="group" aria-label="Field mode" style="display:inline-flex;gap:2px;margin:var(--space-2) 0;">
          <button class="btn btn-ghost ${_mode === 'expression' ? 'is-active' : ''}" data-action="cf-mode-expression" aria-pressed="${_mode === 'expression'}" style="font-size:11px;">Expression</button>
          <button class="btn btn-ghost ${_mode === 'window' ? 'is-active' : ''}" data-action="cf-mode-window" aria-pressed="${_mode === 'window'}" style="font-size:11px;">Window (LOD)</button>
        </div>
        ${exprPane}
        ${windowPane}
        <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin:var(--space-3) 0 var(--space-1) 0;">Preview</h3>
        <pre data-region="cf-preview" style="white-space:pre-wrap;font-family:var(--font-mono);background:var(--surface-alt);border-left:3px solid var(--accent);padding:8px 12px;border-radius:4px;font-size:11px;margin:0;">(enter a column name + expression)</pre>
      </div>
      <footer style="display:flex;gap:var(--space-2);justify-content:flex-end;padding:var(--space-3) var(--space-4);border-top:1px solid var(--border);">
        <button class="btn btn-ghost" data-action="cf-close">Cancel</button>
        <button class="btn btn-primary" data-action="cf-insert">Insert as SQL cell</button>
      </footer>
    </div>
  `;

  overlay.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target === overlay || target.closest('[data-action="cf-close"]'))
      return closeCalcFieldModal();
    const chip = target.closest<HTMLElement>('.cf-chip');
    if (chip) {
      insertAtCursor(chip.dataset.col ?? '');
      return;
    }
    if (target.closest('[data-action="cf-mode-expression"]')) {
      _mode = 'expression';
      return rerender();
    }
    if (target.closest('[data-action="cf-mode-window"]')) {
      _mode = 'window';
      return rerender();
    }
    if (target.closest('[data-action="cf-insert"]')) {
      handleInsert();
    }
  });
  overlay.addEventListener('input', refreshPreview);
  overlay.addEventListener('change', refreshPreview);

  _onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeCalcFieldModal();
  };
  document.addEventListener('keydown', _onKey);
  return overlay;
}

function rerender(): void {
  if (!_modalEl) return;
  const alias = _modalEl.querySelector<HTMLInputElement>('[data-region="cf-alias"]')?.value ?? '';
  const fresh = render();
  _modalEl.replaceWith(fresh);
  _modalEl = fresh;
  const aliasInput = _modalEl.querySelector<HTMLInputElement>('[data-region="cf-alias"]');
  if (aliasInput) aliasInput.value = alias; // preserve the alias across a mode switch
  refreshPreview();
}

function insertAtCursor(col: string): void {
  const ta = _modalEl?.querySelector<HTMLTextAreaElement>('[data-region="cf-expr"]');
  if (!ta) return;
  const quoted = `"${col.replace(/"/g, '""')}"`;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, start) + quoted + ta.value.slice(end);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = start + quoted.length;
  refreshPreview();
}

function handleInsert(): void {
  if (!_desc) return;
  const alias = _modalEl?.querySelector<HTMLInputElement>('[data-region="cf-alias"]')?.value ?? '';
  const preview = _modalEl?.querySelector<HTMLElement>('[data-region="cf-preview"]');
  const aliasErr = validateCalcAlias(alias);
  if (aliasErr) {
    if (preview) preview.textContent = `⚠ ${aliasErr}`;
    return;
  }
  const expr = currentExpr();
  let sql: string;
  try {
    sql = emitCalculatedField(_desc.upstreamSql, alias, expr);
  } catch (e) {
    if (preview) preview.textContent = `⚠ ${e instanceof Error ? e.message : String(e)}`;
    return;
  }
  _onInsert?.(sql);
  closeCalcFieldModal();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
