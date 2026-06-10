// M5 — Visual Query Builder modal.
//
// Form-based interface that emits parametrised SQL (via the pure
// emitter in `src/core/query-builder.ts`). On Generate, the SQL is
// dropped into a new SQL cell via the callback the caller wires up;
// the user clicks Run themselves (Hard NOT #4 — never auto-execute).
//
// Scope (handoff §M5): single table + optional single JOIN + filter
// (AND-joined) + ORDER BY (single column) + LIMIT + GROUP BY +
// aggregates (SUM/AVG/COUNT/MIN/MAX). NO nested subqueries, NO
// window functions, NO multi-join.

import {
  type QueryBuilderSpec,
  type QueryColumnSpec,
  type QueryColumnType,
  type QueryFilter,
  emitSql,
  emptySpec,
} from '../core/query-builder.ts';
import { iconSvg } from '../tokens/icons.ts';
import { restoreModalFocus } from './modal-focus.ts';

let _modalEl: HTMLElement | null = null;
let _onKey: ((ev: KeyboardEvent) => void) | null = null;
let _previouslyFocused: HTMLElement | null = null;

export interface QueryBuilderTable {
  name: string;
  columns: ReadonlyArray<QueryColumnSpec>;
}

export interface QueryBuilderDescriptor {
  /** Tables the user can pick from. The first is the default source. */
  tables: ReadonlyArray<QueryBuilderTable>;
}

const COMPARISON_OPS: ReadonlyArray<QueryFilter['op']> = [
  '=',
  '!=',
  '>',
  '<',
  '>=',
  '<=',
  'LIKE',
  'IS NULL',
  'IS NOT NULL',
];

const AGG_FNS = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'] as const;

export function openQueryBuilderModal(
  desc: QueryBuilderDescriptor,
  onGenerate: (sql: string) => void,
): void {
  if (_modalEl) return;
  if (desc.tables.length === 0) {
    return;
  }
  _previouslyFocused = (document.activeElement as HTMLElement) ?? null;
  let spec: QueryBuilderSpec = emptySpec(desc.tables[0]!.name);
  const overlay = renderModal(desc, spec);
  document.body.append(overlay);
  _modalEl = overlay;

  const rerender = (): void => {
    const fresh = renderModal(desc, spec);
    overlay.replaceWith(fresh);
    _modalEl = fresh;
    wireHandlers(
      fresh,
      desc,
      () => spec,
      (next) => {
        spec = next;
      },
      onGenerate,
      rerender,
    );
  };
  wireHandlers(
    overlay,
    desc,
    () => spec,
    (next) => {
      spec = next;
    },
    onGenerate,
    rerender,
  );

  overlay.querySelector<HTMLElement>('[data-action="qb-cancel"]')?.focus();
}

export function closeQueryBuilderModal(): void {
  if (_modalEl?.parentElement) _modalEl.parentElement.removeChild(_modalEl);
  _modalEl = null;
  if (_onKey) {
    document.removeEventListener('keydown', _onKey);
    _onKey = null;
  }
  restoreModalFocus(_previouslyFocused);
  _previouslyFocused = null;
}

function wireHandlers(
  overlay: HTMLElement,
  desc: QueryBuilderDescriptor,
  getSpec: () => QueryBuilderSpec,
  setSpec: (next: QueryBuilderSpec) => void,
  onGenerate: (sql: string) => void,
  rerender: () => void,
): void {
  overlay.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target === overlay) return closeQueryBuilderModal();
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'qb-cancel' || action === 'qb-close') return closeQueryBuilderModal();
    if (action === 'qb-add-filter') {
      const spec = getSpec();
      const fromCol = lookupTable(desc, spec.fromTable)?.columns[0];
      if (!fromCol) return;
      setSpec({
        ...spec,
        filters: [
          ...spec.filters,
          {
            table: spec.fromTable,
            column: fromCol.name,
            columnType: fromCol.type,
            op: '=',
            value: '',
          },
        ],
      });
      rerender();
    }
    if (action === 'qb-remove-filter') {
      const idx = Number(target.closest<HTMLElement>('[data-filter-idx]')?.dataset.filterIdx);
      const spec = getSpec();
      setSpec({ ...spec, filters: spec.filters.filter((_, i) => i !== idx) });
      rerender();
    }
    if (action === 'qb-add-agg') {
      const spec = getSpec();
      const fromCol =
        lookupTable(desc, spec.fromTable)?.columns.find((c) => c.type === 'numeric') ??
        lookupTable(desc, spec.fromTable)?.columns[0];
      if (!fromCol) return;
      setSpec({
        ...spec,
        aggregates: [
          ...spec.aggregates,
          {
            fn: 'SUM',
            table: spec.fromTable,
            column: fromCol.name,
            alias: `${fromCol.name}_sum`,
          },
        ],
      });
      rerender();
    }
    if (action === 'qb-remove-agg') {
      const idx = Number(target.closest<HTMLElement>('[data-agg-idx]')?.dataset.aggIdx);
      const spec = getSpec();
      setSpec({ ...spec, aggregates: spec.aggregates.filter((_, i) => i !== idx) });
      rerender();
    }
    if (action === 'qb-generate') {
      let sql: string;
      try {
        sql = emitSql(getSpec());
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = overlay.querySelector<HTMLElement>('[data-region="qb-status"]');
        if (status) status.textContent = msg;
        return;
      }
      closeQueryBuilderModal();
      onGenerate(sql);
    }
  });
  overlay.addEventListener('change', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    const action = target.dataset.action;
    const spec = getSpec();
    if (action === 'qb-from-table') {
      const newTable = (target as HTMLSelectElement).value;
      // Filters carry over with column re-validation (handoff §M5 gate).
      const newTbl = lookupTable(desc, newTable);
      const newCols = new Set(newTbl?.columns.map((c) => c.name) ?? []);
      const carriedFilters = spec.filters
        .filter((f) => f.table === spec.fromTable && newCols.has(f.column))
        .map((f) => ({ ...f, table: newTable }));
      setSpec({ ...emptySpec(newTable), filters: carriedFilters });
      rerender();
    }
    if (action === 'qb-limit') {
      const n = Number((target as HTMLInputElement).value);
      if (Number.isFinite(n) && n >= 1) {
        setSpec({ ...spec, limit: Math.floor(n) });
      }
    }
    if (action === 'qb-filter-column') {
      const idx = Number(target.closest<HTMLElement>('[data-filter-idx]')?.dataset.filterIdx);
      const newCol = (target as HTMLSelectElement).value;
      const colSpec = lookupTable(desc, spec.fromTable)?.columns.find((c) => c.name === newCol);
      if (!colSpec) return;
      setSpec({
        ...spec,
        filters: spec.filters.map((f, i) =>
          i === idx ? { ...f, column: newCol, columnType: colSpec.type } : f,
        ),
      });
    }
    if (action === 'qb-filter-op') {
      const idx = Number(target.closest<HTMLElement>('[data-filter-idx]')?.dataset.filterIdx);
      const op = (target as HTMLSelectElement).value as QueryFilter['op'];
      setSpec({
        ...spec,
        filters: spec.filters.map((f, i) => (i === idx ? { ...f, op } : f)),
      });
    }
    if (action === 'qb-filter-value') {
      const idx = Number(target.closest<HTMLElement>('[data-filter-idx]')?.dataset.filterIdx);
      const value = (target as HTMLInputElement).value;
      setSpec({
        ...spec,
        filters: spec.filters.map((f, i) => (i === idx ? { ...f, value } : f)),
      });
    }
    if (action === 'qb-agg-fn') {
      const idx = Number(target.closest<HTMLElement>('[data-agg-idx]')?.dataset.aggIdx);
      const fn = (target as HTMLSelectElement).value as (typeof AGG_FNS)[number];
      setSpec({
        ...spec,
        aggregates: spec.aggregates.map((a, i) => (i === idx ? { ...a, fn } : a)),
      });
    }
    if (action === 'qb-agg-column') {
      const idx = Number(target.closest<HTMLElement>('[data-agg-idx]')?.dataset.aggIdx);
      const column = (target as HTMLSelectElement).value;
      setSpec({
        ...spec,
        aggregates: spec.aggregates.map((a, i) =>
          i === idx ? { ...a, column, alias: `${column}_${a.fn.toLowerCase()}` } : a,
        ),
      });
    }
  });
  _onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeQueryBuilderModal();
  };
  document.addEventListener('keydown', _onKey);
}

function lookupTable(desc: QueryBuilderDescriptor, name: string): QueryBuilderTable | undefined {
  return desc.tables.find((t) => t.name === name);
}

function renderModal(desc: QueryBuilderDescriptor, spec: QueryBuilderSpec): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'schema-graph-overlay qb-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'qb-title');

  const fromTable = lookupTable(desc, spec.fromTable);
  let livePreview = '';
  try {
    livePreview = emitSql(spec);
  } catch (err) {
    livePreview = err instanceof Error ? `(${err.message})` : String(err);
  }

  overlay.innerHTML = `
    <div class="schema-graph-modal qb-modal" role="document"
         style="width:min(800px,100%);height:auto;max-height:min(90vh,860px);display:flex;flex-direction:column;">
      <header class="schema-graph-header">
        <h2 id="qb-title" style="margin:0;font-size:var(--text-md,15px);display:flex;align-items:center;gap:6px;">
          ${iconSvg('chart', 14)} Visual query builder
        </h2>
        <button class="btn btn-ghost schema-graph-close" data-action="qb-close" aria-label="Close">
          ${iconSvg('x', 14)}
        </button>
      </header>
      <div class="qb-body" style="padding:var(--space-3) var(--space-4);overflow:auto;flex:1;min-height:0;">
        <div class="qb-row" style="margin-bottom:var(--space-3);">
          <label style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);">From table</label>
          <select data-action="qb-from-table" style="margin-left:6px;">
            ${desc.tables.map((t) => `<option value="${escapeAttr(t.name)}" ${t.name === spec.fromTable ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
          </select>
        </div>

        <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin:var(--space-3) 0 var(--space-1) 0;">Filters (AND-joined)</h3>
        <div class="qb-filters">
          ${spec.filters.map((f, i) => renderFilterRow(f, i, fromTable)).join('')}
        </div>
        <button class="btn btn-ghost" data-action="qb-add-filter" style="margin-top:6px;">${iconSvg('plus', 12)} <span>Add filter</span></button>

        <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin:var(--space-3) 0 var(--space-1) 0;">Aggregates</h3>
        <div class="qb-aggs">
          ${spec.aggregates.map((a, i) => renderAggRow(a, i, fromTable)).join('')}
        </div>
        <button class="btn btn-ghost" data-action="qb-add-agg" style="margin-top:6px;">${iconSvg('plus', 12)} <span>Add aggregate</span></button>

        <div style="display:flex;gap:var(--space-3);margin-top:var(--space-3);align-items:baseline;">
          <label style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);">Limit</label>
          <input type="number" data-action="qb-limit" value="${spec.limit}" min="1" max="1000000" style="width:90px;" />
        </div>

        <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin:var(--space-3) 0 var(--space-1) 0;">SQL preview</h3>
        <pre style="background:var(--surface-subtle,#f9fafb);padding:var(--space-2) var(--space-3);border-radius:4px;font-size:11px;line-height:1.5;color:var(--text);white-space:pre-wrap;overflow:auto;border:1px solid var(--border);">${escapeHtml(livePreview)}</pre>
        <div data-region="qb-status" style="color:#b91c1c;font-size:12px;margin-top:6px;"></div>
      </div>
      <footer style="display:flex;gap:var(--space-2);justify-content:flex-end;padding:var(--space-3) var(--space-4);border-top:1px solid var(--border);">
        <button class="btn btn-ghost" data-action="qb-cancel">Cancel</button>
        <button class="btn btn-primary" data-action="qb-generate">Insert as SQL cell</button>
      </footer>
    </div>
  `;
  return overlay;
}

function renderFilterRow(
  f: QueryFilter,
  idx: number,
  table: QueryBuilderTable | undefined,
): string {
  const cols = table?.columns ?? [];
  const valueDisabled = f.op === 'IS NULL' || f.op === 'IS NOT NULL';
  return `
    <div class="qb-filter-row" data-filter-idx="${idx}" style="display:flex;gap:6px;margin-bottom:4px;align-items:center;">
      <select data-action="qb-filter-column">
        ${cols
          .map(
            (c) =>
              `<option value="${escapeAttr(c.name)}" ${c.name === f.column ? 'selected' : ''}>${escapeHtml(c.name)} (${c.type})</option>`,
          )
          .join('')}
      </select>
      <select data-action="qb-filter-op">
        ${COMPARISON_OPS.map((o) => `<option value="${o}" ${o === f.op ? 'selected' : ''}>${o}</option>`).join('')}
      </select>
      <input type="text" data-action="qb-filter-value" value="${escapeAttr(f.value)}" ${valueDisabled ? 'disabled' : ''} placeholder="${valueDisabled ? '(no value)' : 'value…'}" style="flex:1;min-width:80px;" />
      <button class="btn btn-ghost" data-action="qb-remove-filter" aria-label="Remove filter">${iconSvg('x', 12)}</button>
    </div>
  `;
}

function renderAggRow(
  a: { fn: (typeof AGG_FNS)[number]; column: string; alias: string },
  idx: number,
  table: QueryBuilderTable | undefined,
): string {
  const cols = table?.columns ?? [];
  return `
    <div class="qb-agg-row" data-agg-idx="${idx}" style="display:flex;gap:6px;margin-bottom:4px;align-items:center;">
      <select data-action="qb-agg-fn">
        ${AGG_FNS.map((fn) => `<option value="${fn}" ${fn === a.fn ? 'selected' : ''}>${fn}</option>`).join('')}
      </select>
      <select data-action="qb-agg-column">
        ${cols
          .map(
            (c) =>
              `<option value="${escapeAttr(c.name)}" ${c.name === a.column ? 'selected' : ''}>${escapeHtml(c.name)} (${c.type})</option>`,
          )
          .join('')}
      </select>
      <span style="font-size:11px;color:var(--text-muted);">AS</span>
      <code style="font-size:11px;background:var(--surface-subtle,#f9fafb);padding:2px 6px;border-radius:3px;">${escapeHtml(a.alias)}</code>
      <button class="btn btn-ghost" data-action="qb-remove-agg" aria-label="Remove aggregate">${iconSvg('x', 12)}</button>
    </div>
  `;
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

/** Re-exported for the convenience of the dispatcher. */
export type { QueryColumnType };
