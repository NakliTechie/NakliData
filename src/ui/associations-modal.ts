// v1.3 M1 Phase 2 — Associations modal.
//
// Hybrid authoring (DECISIONS — user choice): auto-SUGGEST links between
// columns that look like the same field (shared taxonomy type or name),
// PLUS a manual form to link any two columns. Linked columns cross-filter
// each other — a selection in one greys non-co-occurring values in the
// other (the propagation lives in core/associations.ts; this is just the
// editor over the store).

import {
  type AssocColumn,
  type Association,
  getAssociationsStore,
  suggestAssociations,
} from '../core/associations.ts';
import { iconSvg } from '../tokens/icons.ts';
import { restoreModalFocus } from './modal-focus.ts';

/** One linkable column, as gathered by the caller from the notebook +
 *  workbook (cell result columns + their resolved taxonomy type). */
export interface AssocColumnOption {
  /** Selection-store table key — `cell_<id>`. */
  table: string;
  /** Human label for the owning cell (name or `cell_<id>`). */
  cellLabel: string;
  column: string;
  typeId: string | null;
}

let _modalEl: HTMLElement | null = null;
let _onKey: ((ev: KeyboardEvent) => void) | null = null;
let _previouslyFocused: HTMLElement | null = null;
let _options: AssocColumnOption[] = [];

export function openAssociationsModal(options: AssocColumnOption[]): void {
  if (_modalEl) return;
  _options = options;
  _previouslyFocused = (document.activeElement as HTMLElement) ?? null;
  const overlay = renderModal();
  document.body.append(overlay);
  _modalEl = overlay;
  overlay.querySelector<HTMLElement>('[data-action="close-assoc"]')?.focus();
}

export function closeAssociationsModal(): void {
  if (_modalEl?.parentElement) _modalEl.parentElement.removeChild(_modalEl);
  _modalEl = null;
  if (_onKey) {
    document.removeEventListener('keydown', _onKey);
    _onKey = null;
  }
  restoreModalFocus(_previouslyFocused);
  _previouslyFocused = null;
}

function labelFor(table: string, column: string): string {
  const opt = _options.find((o) => o.table === table && o.column === column);
  return `${opt?.cellLabel ?? table}.${column}`;
}

function toAssocColumns(): AssocColumn[] {
  return _options.map((o) => ({ table: o.table, column: o.column, typeId: o.typeId }));
}

function renderModal(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'schema-graph-overlay assoc-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'assoc-title');
  overlay.innerHTML = `
    <div class="schema-graph-modal assoc-modal" role="document"
         style="width:min(720px,100%);height:auto;max-height:min(85vh,720px);display:flex;flex-direction:column;">
      <header class="schema-graph-header">
        <h2 id="assoc-title" style="margin:0;font-size:var(--text-md,15px);display:flex;align-items:center;gap:6px;">
          ${iconSvg('link', 14)} Associations
        </h2>
        <button class="btn btn-ghost schema-graph-close" data-action="close-assoc" aria-label="Close" style="margin-left:auto;">
          ${iconSvg('x', 14)}
        </button>
      </header>
      <div class="assoc-body" data-region="assoc-body">${renderBody()}</div>
    </div>
  `;
  overlay.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target === overlay || target.closest('[data-action="close-assoc"]')) {
      closeAssociationsModal();
      return;
    }
    handleClick(target);
  });
  _onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeAssociationsModal();
  };
  document.addEventListener('keydown', _onKey);
  return overlay;
}

function renderBody(): string {
  const store = getAssociationsStore();
  const active = store.list();

  if (_options.length < 2) {
    return `<p class="assoc-empty">Run at least two SQL cells with results, then link their columns here to cross-filter across cells.</p>`;
  }

  // Manual link form.
  const opts = _options
    .map(
      (o, i) =>
        `<option value="${i}">${escapeHtml(o.cellLabel)}.${escapeHtml(o.column)}${o.typeId ? ` · ${escapeHtml(o.typeId)}` : ''}</option>`,
    )
    .join('');
  const manual = `
    <section class="assoc-section">
      <h3 class="assoc-h">Link two columns</h3>
      <div class="assoc-form">
        <select data-region="assoc-a" aria-label="First column">${opts}</select>
        <span class="assoc-link-glyph">${iconSvg('link', 12)}</span>
        <select data-region="assoc-b" aria-label="Second column">${opts}</select>
        <button class="btn btn-primary" data-action="assoc-link">Link</button>
      </div>
    </section>`;

  // Suggestions (exclude already-linked).
  const suggestions = suggestAssociations(toAssocColumns(), active);
  const suggestionRows = suggestions.length
    ? suggestions.map((l) => row(l, 'add')).join('')
    : `<p class="assoc-empty">No suggestions — no unlinked columns share a type or name across cells.</p>`;
  const suggested = `
    <section class="assoc-section">
      <h3 class="assoc-h">Suggested <span class="assoc-count">${suggestions.length}</span></h3>
      <ul class="assoc-list">${suggestionRows}</ul>
    </section>`;

  // Active links.
  const activeRows = active.length
    ? active.map((l) => row(l, 'remove')).join('')
    : `<p class="assoc-empty">No active links yet.</p>`;
  const activeSection = `
    <section class="assoc-section">
      <h3 class="assoc-h">Active links <span class="assoc-count">${active.length}</span></h3>
      <ul class="assoc-list">${activeRows}</ul>
    </section>`;

  return manual + suggested + activeSection;
}

/** A link row with an Add (suggested) or Unlink (active) action. */
function row(l: Association, mode: 'add' | 'remove'): string {
  const attrs = `data-a-table="${escapeAttr(l.a.table)}" data-a-col="${escapeAttr(l.a.column)}" data-b-table="${escapeAttr(l.b.table)}" data-b-col="${escapeAttr(l.b.column)}"`;
  const btn =
    mode === 'add'
      ? `<button class="btn btn-ghost assoc-add" data-action="assoc-add" ${attrs}>Link</button>`
      : `<button class="btn btn-ghost assoc-unlink" data-action="assoc-remove" ${attrs}>Unlink</button>`;
  return `<li class="assoc-row">
    <span class="assoc-pair">${escapeHtml(labelFor(l.a.table, l.a.column))} <span class="assoc-link-glyph">${iconSvg('link', 11)}</span> ${escapeHtml(labelFor(l.b.table, l.b.column))}</span>
    ${btn}
  </li>`;
}

function rerenderBody(): void {
  const body = _modalEl?.querySelector<HTMLElement>('[data-region="assoc-body"]');
  if (body) body.innerHTML = renderBody();
}

function handleClick(target: HTMLElement): void {
  const store = getAssociationsStore();

  const linkBtn = target.closest('[data-action="assoc-link"]');
  if (linkBtn) {
    const a = _modalEl?.querySelector<HTMLSelectElement>('[data-region="assoc-a"]');
    const b = _modalEl?.querySelector<HTMLSelectElement>('[data-region="assoc-b"]');
    const oa = _options[Number(a?.value)];
    const ob = _options[Number(b?.value)];
    if (oa && ob) {
      store.add({ table: oa.table, column: oa.column }, { table: ob.table, column: ob.column });
      rerenderBody();
    }
    return;
  }

  const add = target.closest<HTMLElement>('[data-action="assoc-add"]');
  if (add) {
    applyFromAttrs(add, (a, b) => store.add(a, b));
    rerenderBody();
    return;
  }

  const remove = target.closest<HTMLElement>('[data-action="assoc-remove"]');
  if (remove) {
    applyFromAttrs(remove, (a, b) => store.remove(a, b));
    rerenderBody();
  }
}

function applyFromAttrs(
  el: HTMLElement,
  fn: (a: { table: string; column: string }, b: { table: string; column: string }) => void,
): void {
  const aTable = el.dataset.aTable;
  const aCol = el.dataset.aCol;
  const bTable = el.dataset.bTable;
  const bCol = el.dataset.bCol;
  if (aTable && aCol && bTable && bCol) {
    fn({ table: aTable, column: aCol }, { table: bTable, column: bCol });
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
