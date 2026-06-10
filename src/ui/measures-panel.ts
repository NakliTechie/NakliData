// v1.3 M2 — Measures panel.
//
// Single modal: list of measures + create/edit/delete + the "this is
// used by N cells" indicator (via the M2 lineage graph + the
// `findReferencedMeasures` pure helper).

import { getMeasuresStore } from '../core/measures-store.ts';
import {
  type MeasureDefinition,
  type MeasureFormat,
  findReferencedMeasures,
  validateMeasureExpression,
  validateMeasureName,
} from '../core/measures.ts';
import { iconSvg } from '../tokens/icons.ts';
import { restoreModalFocus } from './modal-focus.ts';

let _modalEl: HTMLElement | null = null;
let _onKey: ((ev: KeyboardEvent) => void) | null = null;
let _previouslyFocused: HTMLElement | null = null;
let _onChange: (() => void) | null = null;

const FORMATS: ReadonlyArray<{ value: MeasureFormat; label: string }> = [
  { value: 'number', label: 'Number' },
  { value: 'currency_inr', label: 'Currency (INR)' },
  { value: 'currency_usd', label: 'Currency (USD)' },
  { value: 'currency_eur', label: 'Currency (EUR)' },
  { value: 'percent', label: 'Percent' },
  { value: 'count', label: 'Count' },
];

export interface MeasuresPanelDescriptor {
  /** SQL of every cell — used to compute "this measure is used by N
   *  cells." Caller pulls from the notebook. */
  cellSqls: ReadonlyArray<{ id: string; name: string | null; sql: string }>;
}

export function openMeasuresPanel(desc: MeasuresPanelDescriptor, onChange: () => void): void {
  if (_modalEl) return;
  _previouslyFocused = (document.activeElement as HTMLElement) ?? null;
  _onChange = onChange;
  const overlay = renderModal(desc);
  document.body.append(overlay);
  _modalEl = overlay;
  overlay.querySelector<HTMLElement>('[data-action="measures-close"]')?.focus();
}

export function closeMeasuresPanel(): void {
  if (_modalEl?.parentElement) _modalEl.parentElement.removeChild(_modalEl);
  _modalEl = null;
  if (_onKey) {
    document.removeEventListener('keydown', _onKey);
    _onKey = null;
  }
  restoreModalFocus(_previouslyFocused);
  _previouslyFocused = null;
  _onChange = null;
}

function rerender(desc: MeasuresPanelDescriptor): void {
  if (!_modalEl) return;
  const fresh = renderModal(desc);
  _modalEl.replaceWith(fresh);
  _modalEl = fresh;
  _onChange?.();
}

function renderModal(desc: MeasuresPanelDescriptor): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'schema-graph-overlay measures-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'measures-title');

  const store = getMeasuresStore();
  const measures = store.list();

  // Compute usage per measure.
  const usageByName = new Map<string, Array<{ id: string; name: string | null }>>();
  for (const cell of desc.cellSqls) {
    for (const ref of findReferencedMeasures(cell.sql)) {
      const list = usageByName.get(ref) ?? [];
      list.push({ id: cell.id, name: cell.name });
      usageByName.set(ref, list);
    }
  }

  const rowsHtml = measures.map((m) => renderRow(m, usageByName.get(m.name) ?? [])).join('');

  overlay.innerHTML = `
    <div class="schema-graph-modal measures-modal" role="document"
         style="width:min(820px,100%);height:auto;max-height:min(90vh,860px);display:flex;flex-direction:column;">
      <header class="schema-graph-header">
        <h2 id="measures-title" style="margin:0;font-size:var(--text-md,15px);display:flex;align-items:center;gap:6px;">
          ${iconSvg('chart', 14)} Measures
        </h2>
        <button class="btn btn-ghost schema-graph-close" data-action="measures-close" aria-label="Close">
          ${iconSvg('x', 14)}
        </button>
      </header>
      <div class="measures-body" style="padding:var(--space-3) var(--space-4);overflow:auto;flex:1;min-height:0;">
        ${measures.length === 0 ? renderEmptyState() : `<ul class="measures-list" style="list-style:none;padding:0;margin:0;">${rowsHtml}</ul>`}
        ${renderNewForm()}
      </div>
      <footer style="display:flex;gap:var(--space-2);justify-content:flex-end;padding:var(--space-3) var(--space-4);border-top:1px solid var(--border);">
        <button class="btn btn-ghost" data-action="measures-close">Close</button>
      </footer>
    </div>
  `;

  wireHandlers(overlay, desc);
  return overlay;
}

function renderEmptyState(): string {
  return `
    <p style="color:var(--text-muted);font-size:var(--text-sm,13px);margin:0 0 var(--space-3) 0;">
      No measures defined yet. Use the form below to add one, then reference it from any SQL cell with <code>MEASURE(name)</code>.
    </p>
  `;
}

function renderRow(
  m: MeasureDefinition,
  usage: Array<{ id: string; name: string | null }>,
): string {
  const usageNote =
    usage.length > 0
      ? `<span class="measures-usage" style="font-size:11px;color:#2563eb;">used by ${usage.length} cell${usage.length === 1 ? '' : 's'}</span>`
      : `<span class="measures-usage" style="font-size:11px;color:var(--text-muted);">unused</span>`;
  return `
    <li class="measures-row" data-name="${escapeAttr(m.name)}" style="border:1px solid var(--border);border-radius:6px;padding:var(--space-2) var(--space-3);margin-bottom:6px;">
      <div style="display:flex;align-items:center;gap:var(--space-2);">
        <strong>${escapeHtml(m.name)}</strong>
        <span style="font-size:11px;color:var(--text-muted);text-transform:uppercase;">${escapeHtml(m.format)}</span>
        ${usageNote}
        <span style="flex:1;"></span>
        <button class="btn btn-ghost" data-action="measure-delete" data-name="${escapeAttr(m.name)}" title="Delete measure">${iconSvg('x', 12)}</button>
      </div>
      ${m.description ? `<p style="margin:4px 0 4px 0;font-size:12px;color:var(--text);">${escapeHtml(m.description)}</p>` : ''}
      <code style="display:block;background:var(--surface-subtle,#f9fafb);padding:4px 6px;border-radius:3px;font-size:11px;white-space:pre-wrap;">${escapeHtml(m.expression)}</code>
    </li>
  `;
}

function renderNewForm(): string {
  return `
    <div class="measures-new" style="margin-top:var(--space-3);padding:var(--space-3);background:var(--surface-subtle,#f9fafb);border-radius:6px;">
      <h3 style="margin:0 0 var(--space-2) 0;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);">Define a measure</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);margin-bottom:var(--space-2);">
        <label style="font-size:12px;">
          Name (snake_case)
          <input type="text" data-region="m-name" placeholder="revenue" style="width:100%;display:block;margin-top:2px;" />
        </label>
        <label style="font-size:12px;">
          Format
          <select data-region="m-format" style="width:100%;display:block;margin-top:2px;">
            ${FORMATS.map((f) => `<option value="${f.value}">${f.label}</option>`).join('')}
          </select>
        </label>
      </div>
      <label style="font-size:12px;">
        Expression (SQL fragment for SELECT-list slot)
        <textarea data-region="m-expression" rows="2" placeholder="SUM(amount) FILTER (WHERE status = 'completed')" style="width:100%;display:block;margin-top:2px;font-family:monospace;font-size:11px;"></textarea>
      </label>
      <label style="font-size:12px;display:block;margin-top:var(--space-2);">
        Description (optional)
        <input type="text" data-region="m-description" placeholder="Total revenue from completed orders" style="width:100%;display:block;margin-top:2px;" />
      </label>
      <div data-region="m-error" style="color:#b91c1c;font-size:12px;margin-top:6px;"></div>
      <button class="btn btn-primary" data-action="measure-add" style="margin-top:var(--space-2);">Add measure</button>
    </div>
  `;
}

function wireHandlers(overlay: HTMLElement, desc: MeasuresPanelDescriptor): void {
  overlay.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target === overlay) return closeMeasuresPanel();
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'measures-close') return closeMeasuresPanel();
    if (action === 'measure-delete') {
      const name = target.closest<HTMLElement>('[data-action="measure-delete"]')?.dataset.name;
      if (!name) return;
      const store = getMeasuresStore();
      // Check usage before deleting — defence in depth; the UI also
      // surfaces this. Simple JS confirm is enough for v1.
      const usageCount = desc.cellSqls.filter((c) =>
        findReferencedMeasures(c.sql).includes(name),
      ).length;
      const proceed =
        usageCount === 0 ||
        window.confirm(
          `"${name}" is referenced by ${usageCount} cell${usageCount === 1 ? '' : 's'}. Delete anyway? Those cells will fail until you remove the references.`,
        );
      if (!proceed) return;
      store.remove(name);
      rerender(desc);
    }
    if (action === 'measure-add') {
      const errorRegion = overlay.querySelector<HTMLElement>('[data-region="m-error"]');
      const name =
        overlay.querySelector<HTMLInputElement>('[data-region="m-name"]')?.value.trim() ?? '';
      const expression =
        overlay.querySelector<HTMLTextAreaElement>('[data-region="m-expression"]')?.value.trim() ??
        '';
      const description =
        overlay.querySelector<HTMLInputElement>('[data-region="m-description"]')?.value.trim() ??
        '';
      const format = (overlay.querySelector<HTMLSelectElement>('[data-region="m-format"]')?.value ??
        'number') as MeasureFormat;
      const nameErr = validateMeasureName(name);
      if (nameErr) {
        if (errorRegion) errorRegion.textContent = nameErr;
        return;
      }
      const exprErr = validateMeasureExpression(expression);
      if (exprErr) {
        if (errorRegion) errorRegion.textContent = exprErr;
        return;
      }
      if (getMeasuresStore().get(name)) {
        if (errorRegion)
          errorRegion.textContent = `Measure "${name}" already exists. Delete it first to redefine.`;
        return;
      }
      getMeasuresStore().set({ name, expression, format, description, version: 1 });
      rerender(desc);
    }
  });
  _onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeMeasuresPanel();
  };
  document.addEventListener('keydown', _onKey);
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
