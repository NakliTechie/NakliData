// M5 + v1.4 F6 — Visual Query Builder modal ("ask a question").
//
// Form-based interface that emits parametrised SQL (via the pure emitter
// in `src/core/query-builder.ts`). On Generate, the SQL is dropped into a
// new SQL cell via the callback; the user clicks Run (Hard NOT #4).
//
// Scope: a source table + ZERO-OR-MORE JOINs (F6 — was single-join),
// filters (AND-joined, table-qualified), aggregates (table-qualified
// SUM/AVG/COUNT/MIN/MAX), ORDER BY, LIMIT. Still NO nested subqueries, NO
// window functions (those are the calc-field cell's job). Every column
// picker spans the in-scope tables (fromTable + joined tables).

import {
  type DerivedFilter,
  type DerivedStep,
  type QueryBuilderSpec,
  type QueryColumnSpec,
  type QueryColumnType,
  type QueryFilter,
  emitPipeline,
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
  if (desc.tables.length === 0) return;
  _previouslyFocused = (document.activeElement as HTMLElement) ?? null;
  let spec: QueryBuilderSpec = emptySpec(desc.tables[0]!.name);
  let steps: DerivedStep[] = [];
  const rerender = (): void => {
    const fresh = renderModal(desc, spec, steps);
    _modalEl?.replaceWith(fresh);
    _modalEl = fresh;
    wire(fresh);
  };
  function wire(overlay: HTMLElement): void {
    wireHandlers(
      overlay,
      desc,
      () => spec,
      (next) => {
        spec = next;
      },
      () => steps,
      (next) => {
        steps = next;
      },
      onGenerate,
      rerender,
    );
  }
  const overlay = renderModal(desc, spec, steps);
  document.body.append(overlay);
  _modalEl = overlay;
  wire(overlay);
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

function lookupTable(desc: QueryBuilderDescriptor, name: string): QueryBuilderTable | undefined {
  return desc.tables.find((t) => t.name === name);
}

function colsOf(desc: QueryBuilderDescriptor, table: string): ReadonlyArray<QueryColumnSpec> {
  return lookupTable(desc, table)?.columns ?? [];
}

/** Tables in scope for column pickers: the source + every joined table. */
function inScopeTables(spec: QueryBuilderSpec): string[] {
  return [spec.fromTable, ...spec.joins.map((j) => j.table)];
}

function wireHandlers(
  overlay: HTMLElement,
  desc: QueryBuilderDescriptor,
  getSpec: () => QueryBuilderSpec,
  setSpec: (next: QueryBuilderSpec) => void,
  getSteps: () => DerivedStep[],
  setSteps: (next: DerivedStep[]) => void,
  onGenerate: (sql: string) => void,
  rerender: () => void,
): void {
  const idxOf = (target: HTMLElement, attr: string, sel: string): number =>
    Number(target.closest<HTMLElement>(sel)?.dataset[attr]);
  // Columns available to derived step `k` = the output of the stage before
  // it (base output, or the prior step's output).
  const stageInputCols = (k: number): QueryColumnSpec[] =>
    stageInputs(desc, getSpec(), getSteps())[k] ?? [];

  overlay.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target === overlay) return closeQueryBuilderModal();
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    const spec = getSpec();

    if (action === 'qb-cancel' || action === 'qb-close') return closeQueryBuilderModal();

    if (action === 'qb-add-join') {
      // Attach a NOT-yet-joined table to the source on first columns.
      const used = new Set(inScopeTables(spec));
      const next = desc.tables.find((t) => !used.has(t.name));
      if (!next) return;
      const left = colsOf(desc, spec.fromTable)[0];
      const right = next.columns[0];
      if (!left || !right) return;
      setSpec({
        ...spec,
        joins: [
          ...spec.joins,
          {
            table: next.name,
            leftTable: spec.fromTable,
            leftColumn: left.name,
            rightColumn: right.name,
          },
        ],
      });
      return rerender();
    }
    if (action === 'qb-remove-join') {
      const idx = idxOf(target, 'joinIdx', '[data-join-idx]');
      // Dropping a join also drops later joins that depended on it +
      // resets filters/aggregates (they may reference a removed table).
      const kept = spec.joins.filter((_, i) => i < idx);
      setSpec({ ...emptySpec(spec.fromTable), joins: kept });
      return rerender();
    }
    if (action === 'qb-add-filter') {
      const col = colsOf(desc, spec.fromTable)[0];
      if (!col) return;
      setSpec({
        ...spec,
        filters: [
          ...spec.filters,
          { table: spec.fromTable, column: col.name, columnType: col.type, op: '=', value: '' },
        ],
      });
      return rerender();
    }
    if (action === 'qb-remove-filter') {
      const idx = idxOf(target, 'filterIdx', '[data-filter-idx]');
      setSpec({ ...spec, filters: spec.filters.filter((_, i) => i !== idx) });
      return rerender();
    }
    if (action === 'qb-add-agg') {
      const col =
        colsOf(desc, spec.fromTable).find((c) => c.type === 'numeric') ??
        colsOf(desc, spec.fromTable)[0];
      if (!col) return;
      setSpec({
        ...spec,
        aggregates: [
          ...spec.aggregates,
          { fn: 'SUM', table: spec.fromTable, column: col.name, alias: `${col.name}_sum` },
        ],
      });
      return rerender();
    }
    if (action === 'qb-remove-agg') {
      const idx = idxOf(target, 'aggIdx', '[data-agg-idx]');
      setSpec({ ...spec, aggregates: spec.aggregates.filter((_, i) => i !== idx) });
      return rerender();
    }
    if (action === 'qb-generate') {
      let sql: string;
      try {
        sql = emitPipeline(getSpec(), getSteps());
      } catch (err) {
        const status = overlay.querySelector<HTMLElement>('[data-region="qb-status"]');
        if (status) status.textContent = err instanceof Error ? err.message : String(err);
        return;
      }
      closeQueryBuilderModal();
      onGenerate(sql);
    }

    // ── Derived steps (F6 pipelines) ──
    if (action === 'qb-step-add') {
      // Seed an empty filter-only step over the prior stage's output.
      setSteps([...getSteps(), { filters: [], groupBy: [], aggregates: [] }]);
      return rerender();
    }
    if (action === 'qb-step-remove') {
      const k = idxOf(target, 'stepIdx', '[data-step-idx]');
      // Removing a step also drops the steps after it (their column pickers
      // were resolved against this step's now-gone output).
      setSteps(getSteps().filter((_, i) => i < k));
      return rerender();
    }
    if (action === 'qb-step-add-filter') {
      const k = idxOf(target, 'stepIdx', '[data-step-idx]');
      const col = stageInputCols(k)[0];
      if (!col) return;
      setSteps(
        getSteps().map((s, i) =>
          i === k
            ? {
                ...s,
                filters: [
                  ...s.filters,
                  { column: col.name, columnType: col.type, op: '=', value: '' },
                ],
              }
            : s,
        ),
      );
      return rerender();
    }
    if (action === 'qb-step-remove-filter') {
      const k = idxOf(target, 'stepIdx', '[data-step-idx]');
      const fi = idxOf(target, 'sfilterIdx', '[data-sfilter-idx]');
      setSteps(
        getSteps().map((s, i) =>
          i === k ? { ...s, filters: s.filters.filter((_, j) => j !== fi) } : s,
        ),
      );
      return rerender();
    }
    if (action === 'qb-step-add-agg') {
      const k = idxOf(target, 'stepIdx', '[data-step-idx]');
      const cols = stageInputCols(k);
      const col = cols.find((c) => c.type === 'numeric') ?? cols[0];
      if (!col) return;
      setSteps(
        getSteps().map((s, i) =>
          i === k
            ? {
                ...s,
                aggregates: [
                  ...s.aggregates,
                  { fn: 'SUM', column: col.name, alias: `${col.name}_sum` },
                ],
              }
            : s,
        ),
      );
      return rerender();
    }
    if (action === 'qb-step-remove-agg') {
      const k = idxOf(target, 'stepIdx', '[data-step-idx]');
      const ai = idxOf(target, 'saggIdx', '[data-sagg-idx]');
      setSteps(
        getSteps().map((s, i) =>
          i === k ? { ...s, aggregates: s.aggregates.filter((_, j) => j !== ai) } : s,
        ),
      );
      return rerender();
    }
  });

  overlay.addEventListener('change', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    const action = target.dataset.action;
    const spec = getSpec();
    const val = (target as HTMLSelectElement | HTMLInputElement).value;
    const fIdx = idxOf(target, 'filterIdx', '[data-filter-idx]');
    const aIdx = idxOf(target, 'aggIdx', '[data-agg-idx]');
    const jIdx = idxOf(target, 'joinIdx', '[data-join-idx]');

    if (action === 'qb-from-table') {
      const newCols = new Set(colsOf(desc, val).map((c) => c.name));
      const carriedFilters = spec.filters
        .filter((f) => f.table === spec.fromTable && newCols.has(f.column))
        .map((f) => ({ ...f, table: val }));
      setSpec({ ...emptySpec(val), filters: carriedFilters });
      return rerender();
    }
    if (action === 'qb-limit') {
      const n = Number(val);
      if (Number.isFinite(n) && n >= 1) {
        setSpec({ ...spec, limit: Math.floor(n) });
        return;
      }
      // Invalid (empty / NaN / < 1): re-render so the field snaps back to
      // the current valid limit, making the rejection visible instead of
      // silently ignored (forward-pass L3).
      return rerender();
    }
    // ── Joins ──
    if (action === 'qb-join-table') {
      const right = colsOf(desc, val)[0];
      setSpec({
        ...spec,
        joins: spec.joins.map((j, i) =>
          i === jIdx ? { ...j, table: val, rightColumn: right?.name ?? j.rightColumn } : j,
        ),
      });
      return rerender();
    }
    if (action === 'qb-join-rightcol') {
      setSpec({
        ...spec,
        joins: spec.joins.map((j, i) => (i === jIdx ? { ...j, rightColumn: val } : j)),
      });
      return;
    }
    if (action === 'qb-join-lefttable') {
      const left = colsOf(desc, val)[0];
      setSpec({
        ...spec,
        joins: spec.joins.map((j, i) =>
          i === jIdx ? { ...j, leftTable: val, leftColumn: left?.name ?? j.leftColumn } : j,
        ),
      });
      return rerender();
    }
    if (action === 'qb-join-leftcol') {
      setSpec({
        ...spec,
        joins: spec.joins.map((j, i) => (i === jIdx ? { ...j, leftColumn: val } : j)),
      });
      return;
    }
    // ── Filters (table-qualified) ──
    if (action === 'qb-filter-table') {
      const col = colsOf(desc, val)[0];
      setSpec({
        ...spec,
        filters: spec.filters.map((f, i) =>
          i === fIdx
            ? { ...f, table: val, column: col?.name ?? '', columnType: col?.type ?? 'string' }
            : f,
        ),
      });
      return rerender();
    }
    if (action === 'qb-filter-column') {
      const f = spec.filters[fIdx];
      const colSpec = f && colsOf(desc, f.table).find((c) => c.name === val);
      if (!colSpec) return;
      setSpec({
        ...spec,
        filters: spec.filters.map((ff, i) =>
          i === fIdx ? { ...ff, column: val, columnType: colSpec.type } : ff,
        ),
      });
      return;
    }
    if (action === 'qb-filter-op') {
      setSpec({
        ...spec,
        filters: spec.filters.map((f, i) =>
          i === fIdx ? { ...f, op: val as QueryFilter['op'] } : f,
        ),
      });
      return;
    }
    if (action === 'qb-filter-value') {
      setSpec({
        ...spec,
        filters: spec.filters.map((f, i) => (i === fIdx ? { ...f, value: val } : f)),
      });
      return;
    }
    // ── Aggregates (table-qualified) ──
    if (action === 'qb-agg-table') {
      const col = colsOf(desc, val)[0];
      setSpec({
        ...spec,
        aggregates: spec.aggregates.map((a, i) =>
          i === aIdx
            ? {
                ...a,
                table: val,
                column: col?.name ?? '',
                alias: `${col?.name ?? 'x'}_${a.fn.toLowerCase()}`,
              }
            : a,
        ),
      });
      return rerender();
    }
    if (action === 'qb-agg-fn') {
      setSpec({
        ...spec,
        aggregates: spec.aggregates.map((a, i) =>
          i === aIdx ? { ...a, fn: val as (typeof AGG_FNS)[number] } : a,
        ),
      });
      return;
    }
    if (action === 'qb-agg-column') {
      setSpec({
        ...spec,
        aggregates: spec.aggregates.map((a, i) =>
          i === aIdx ? { ...a, column: val, alias: `${val}_${a.fn.toLowerCase()}` } : a,
        ),
      });
      return;
    }

    // ── Derived-step change handlers (F6) ──
    const STEP_ACTIONS = new Set([
      'qb-step-filter-column',
      'qb-step-filter-op',
      'qb-step-filter-value',
      'qb-step-agg-fn',
      'qb-step-agg-column',
      'qb-step-gb',
    ]);
    if (action && STEP_ACTIONS.has(action)) {
      const sk = idxOf(target, 'stepIdx', '[data-step-idx]');
      const sfi = idxOf(target, 'sfilterIdx', '[data-sfilter-idx]');
      const sai = idxOf(target, 'saggIdx', '[data-sagg-idx]');
      const steps = getSteps();
      const step = steps[sk];
      if (!step) return;
      const commit = (next: DerivedStep): void => {
        setSteps(steps.map((s, j) => (j === sk ? next : s)));
      };
      if (action === 'qb-step-filter-column') {
        const colType = stageInputCols(sk).find((c) => c.name === val)?.type ?? 'string';
        commit({
          ...step,
          filters: step.filters.map((f, j) =>
            j === sfi ? { ...f, column: val, columnType: colType } : f,
          ),
        });
        return;
      }
      if (action === 'qb-step-filter-op') {
        commit({
          ...step,
          filters: step.filters.map((f, j) =>
            j === sfi ? { ...f, op: val as QueryFilter['op'] } : f,
          ),
        });
        return rerender(); // op change toggles the value field's disabled state
      }
      if (action === 'qb-step-filter-value') {
        commit({
          ...step,
          filters: step.filters.map((f, j) => (j === sfi ? { ...f, value: val } : f)),
        });
        return;
      }
      if (action === 'qb-step-agg-fn') {
        commit({
          ...step,
          aggregates: step.aggregates.map((a, j) =>
            j === sai ? { ...a, fn: val as DerivedStep['aggregates'][number]['fn'] } : a,
          ),
        });
        return;
      }
      if (action === 'qb-step-agg-column') {
        commit({
          ...step,
          aggregates: step.aggregates.map((a, j) =>
            j === sai ? { ...a, column: val, alias: `${val}_${a.fn.toLowerCase()}` } : a,
          ),
        });
        return rerender(); // alias derives from the column — reflect it
      }
      if (action === 'qb-step-gb') {
        const checked = (target as HTMLInputElement).checked;
        const nextGb = checked ? [...step.groupBy, val] : step.groupBy.filter((c) => c !== val);
        commit({ ...step, groupBy: nextGb });
        return;
      }
    }
  });

  _onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeQueryBuilderModal();
  };
  document.addEventListener('keydown', _onKey);
}

function tableSelect(action: string, tables: string[], current: string): string {
  return `<select data-action="${action}">${tables
    .map(
      (t) =>
        `<option value="${escapeAttr(t)}" ${t === current ? 'selected' : ''}>${escapeHtml(t)}</option>`,
    )
    .join('')}</select>`;
}

function colSelect(
  desc: QueryBuilderDescriptor,
  action: string,
  table: string,
  current: string,
  withType = false,
): string {
  return `<select data-action="${action}">${colsOf(desc, table)
    .map(
      (c) =>
        `<option value="${escapeAttr(c.name)}" ${c.name === current ? 'selected' : ''}>${escapeHtml(c.name)}${withType ? ` (${c.type})` : ''}</option>`,
    )
    .join('')}</select>`;
}

function renderModal(
  desc: QueryBuilderDescriptor,
  spec: QueryBuilderSpec,
  steps: DerivedStep[],
): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'schema-graph-overlay qb-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'qb-title');

  const scope = inScopeTables(spec);
  let livePreview = '';
  try {
    livePreview = emitPipeline(spec, steps);
  } catch (err) {
    livePreview = err instanceof Error ? `(${err.message})` : String(err);
  }

  const h3 =
    'font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin:var(--space-3) 0 var(--space-1) 0;';
  const canJoin = desc.tables.length > scope.length;
  // Typed columns available to each derived step (the prior stage's output).
  const stages = stageInputs(desc, spec, steps);

  overlay.innerHTML = `
    <div class="schema-graph-modal qb-modal" role="document"
         style="width:min(820px,100%);height:auto;max-height:min(90vh,860px);display:flex;flex-direction:column;">
      <header class="schema-graph-header">
        <h2 id="qb-title" style="margin:0;font-size:var(--text-md,15px);display:flex;align-items:center;gap:6px;">
          ${iconSvg('chart', 14)} Visual query builder
        </h2>
        <button class="btn btn-ghost schema-graph-close" data-action="qb-close" aria-label="Close">${iconSvg('x', 14)}</button>
      </header>
      <div class="qb-body" style="padding:var(--space-3) var(--space-4);overflow:auto;flex:1;min-height:0;">
        <div class="qb-row" style="margin-bottom:var(--space-2);">
          <label style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);">From table</label>
          ${tableSelect(
            'qb-from-table',
            desc.tables.map((t) => t.name),
            spec.fromTable,
          )}
        </div>

        <h3 style="${h3}">Joins</h3>
        <div class="qb-joins">${spec.joins.map((j, i) => renderJoinRow(desc, spec, j, i)).join('')}</div>
        ${canJoin ? `<button class="btn btn-ghost" data-action="qb-add-join" style="margin-top:6px;">${iconSvg('plus', 12)} <span>Add join</span></button>` : `<p style="font-size:11px;color:var(--text-muted);margin:4px 0;">Mount / project more than one table to join.</p>`}

        <h3 style="${h3}">Filters (AND-joined)</h3>
        <div class="qb-filters">${spec.filters.map((f, i) => renderFilterRow(desc, scope, f, i)).join('')}</div>
        <button class="btn btn-ghost" data-action="qb-add-filter" style="margin-top:6px;">${iconSvg('plus', 12)} <span>Add filter</span></button>

        <h3 style="${h3}">Aggregates</h3>
        <div class="qb-aggs">${spec.aggregates.map((a, i) => renderAggRow(desc, scope, a, i)).join('')}</div>
        <button class="btn btn-ghost" data-action="qb-add-agg" style="margin-top:6px;">${iconSvg('plus', 12)} <span>Add aggregate</span></button>

        <div style="display:flex;gap:var(--space-3);margin-top:var(--space-3);align-items:baseline;">
          <label style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);">Limit</label>
          <input type="number" data-action="qb-limit" value="${spec.limit}" min="1" max="1000000" style="width:90px;" />
        </div>

        <h3 style="${h3}">Derived steps (summarise the result further)</h3>
        <div class="qb-steps">${steps.map((s, i) => renderStepCard(s, i, stages[i] ?? [])).join('')}</div>
        <button class="btn btn-ghost" data-action="qb-step-add" style="margin-top:6px;">${iconSvg('plus', 12)} <span>Add derived step</span></button>

        <h3 style="${h3}">SQL preview</h3>
        <pre style="background:var(--surface-alt);padding:var(--space-2) var(--space-3);border-radius:4px;font-size:11px;line-height:1.5;color:var(--text);white-space:pre-wrap;overflow:auto;border:1px solid var(--border);">${escapeHtml(livePreview)}</pre>
        <div data-region="qb-status" style="color:var(--danger);font-size:12px;margin-top:6px;"></div>
      </div>
      <footer style="display:flex;gap:var(--space-2);justify-content:flex-end;padding:var(--space-3) var(--space-4);border-top:1px solid var(--border);">
        <button class="btn btn-ghost" data-action="qb-cancel">Cancel</button>
        <button class="btn btn-primary" data-action="qb-generate">Insert as SQL cell</button>
      </footer>
    </div>
  `;
  return overlay;
}

function renderJoinRow(
  desc: QueryBuilderDescriptor,
  spec: QueryBuilderSpec,
  j: QueryBuilderSpec['joins'][number],
  idx: number,
): string {
  // Left side can attach to the source or any EARLIER join's table.
  const leftTables = [spec.fromTable, ...spec.joins.slice(0, idx).map((x) => x.table)];
  return `
    <div class="qb-join-row" data-join-idx="${idx}" style="display:flex;gap:6px;margin-bottom:4px;align-items:center;flex-wrap:wrap;">
      ${tableSelect('qb-join-lefttable', leftTables, j.leftTable)}
      ${colSelect(desc, 'qb-join-leftcol', j.leftTable, j.leftColumn)}
      <span style="color:var(--text-muted);">=</span>
      <strong style="font-size:11px;">JOIN</strong>
      ${tableSelect(
        'qb-join-table',
        desc.tables.map((t) => t.name),
        j.table,
      )}
      ${colSelect(desc, 'qb-join-rightcol', j.table, j.rightColumn)}
      <button class="btn btn-ghost" data-action="qb-remove-join" aria-label="Remove join">${iconSvg('x', 12)}</button>
    </div>
  `;
}

function renderFilterRow(
  desc: QueryBuilderDescriptor,
  scope: string[],
  f: QueryFilter,
  idx: number,
): string {
  const valueDisabled = f.op === 'IS NULL' || f.op === 'IS NOT NULL';
  return `
    <div class="qb-filter-row" data-filter-idx="${idx}" style="display:flex;gap:6px;margin-bottom:4px;align-items:center;flex-wrap:wrap;">
      ${scope.length > 1 ? tableSelect('qb-filter-table', scope, f.table) : ''}
      ${colSelect(desc, 'qb-filter-column', f.table, f.column, true)}
      <select data-action="qb-filter-op">
        ${COMPARISON_OPS.map((o) => `<option value="${o}" ${o === f.op ? 'selected' : ''}>${o}</option>`).join('')}
      </select>
      <input type="text" data-action="qb-filter-value" value="${escapeAttr(f.value)}" ${valueDisabled ? 'disabled' : ''} placeholder="${valueDisabled ? '(no value)' : 'value…'}" style="flex:1;min-width:80px;" />
      <button class="btn btn-ghost" data-action="qb-remove-filter" aria-label="Remove filter">${iconSvg('x', 12)}</button>
    </div>
  `;
}

function renderAggRow(
  desc: QueryBuilderDescriptor,
  scope: string[],
  a: { fn: (typeof AGG_FNS)[number]; table: string; column: string; alias: string },
  idx: number,
): string {
  return `
    <div class="qb-agg-row" data-agg-idx="${idx}" style="display:flex;gap:6px;margin-bottom:4px;align-items:center;flex-wrap:wrap;">
      <select data-action="qb-agg-fn">
        ${AGG_FNS.map((fn) => `<option value="${fn}" ${fn === a.fn ? 'selected' : ''}>${fn}</option>`).join('')}
      </select>
      ${scope.length > 1 ? tableSelect('qb-agg-table', scope, a.table) : ''}
      ${colSelect(desc, 'qb-agg-column', a.table, a.column, true)}
      <span style="font-size:11px;color:var(--text-muted);">AS</span>
      <code style="font-size:11px;background:var(--surface-alt);padding:2px 6px;border-radius:3px;">${escapeHtml(a.alias)}</code>
      <button class="btn btn-ghost" data-action="qb-remove-agg" aria-label="Remove aggregate">${iconSvg('x', 12)}</button>
    </div>
  `;
}

// ── F6 derived-step helpers ──

/** Typed output columns of the base query (for the first step's pickers). */
function baseTypedOutput(desc: QueryBuilderDescriptor, spec: QueryBuilderSpec): QueryColumnSpec[] {
  const findType = (table: string, column: string): QueryColumnType =>
    colsOf(desc, table).find((c) => c.name === column)?.type ?? 'string';
  if (spec.aggregates.length > 0) {
    return [
      ...spec.groupBy.map((g) => ({ name: g.column, type: findType(g.table, g.column) })),
      ...spec.aggregates.map((a) => ({ name: a.alias, type: 'numeric' as QueryColumnType })),
    ];
  }
  if (spec.selectColumns.length > 0) {
    return spec.selectColumns.map((c) => ({ name: c.column, type: findType(c.table, c.column) }));
  }
  // SELECT * → every in-scope column.
  return inScopeTables(spec).flatMap((t) =>
    colsOf(desc, t).map((c) => ({ name: c.name, type: c.type })),
  );
}

/** Typed output of a derived step given its input columns. */
function derivedTypedOutput(step: DerivedStep, prior: QueryColumnSpec[]): QueryColumnSpec[] {
  if (step.aggregates.length > 0) {
    return [
      ...step.groupBy.map(
        (name) => prior.find((c) => c.name === name) ?? { name, type: 'string' as QueryColumnType },
      ),
      ...step.aggregates.map((a) => ({ name: a.alias, type: 'numeric' as QueryColumnType })),
    ];
  }
  return [...prior];
}

/** `stageInputs(...)[k]` = the typed columns available to derived step `k`. */
function stageInputs(
  desc: QueryBuilderDescriptor,
  spec: QueryBuilderSpec,
  steps: ReadonlyArray<DerivedStep>,
): QueryColumnSpec[][] {
  const out: QueryColumnSpec[][] = [];
  let prev = baseTypedOutput(desc, spec);
  for (const step of steps) {
    out.push(prev);
    prev = derivedTypedOutput(step, prev);
  }
  return out;
}

function colSelectFromList(
  action: string,
  cols: ReadonlyArray<QueryColumnSpec>,
  current: string,
  withType = false,
): string {
  return `<select data-action="${action}">${cols
    .map(
      (c) =>
        `<option value="${escapeAttr(c.name)}" ${c.name === current ? 'selected' : ''}>${escapeHtml(c.name)}${withType ? ` (${c.type})` : ''}</option>`,
    )
    .join('')}</select>`;
}

function renderStepFilterRow(
  stepIdx: number,
  fi: number,
  f: DerivedFilter,
  cols: QueryColumnSpec[],
): string {
  const valueDisabled = f.op === 'IS NULL' || f.op === 'IS NOT NULL';
  return `
    <div class="qb-sfilter-row" data-sfilter-idx="${fi}" style="display:flex;gap:6px;margin-bottom:4px;align-items:center;flex-wrap:wrap;">
      ${colSelectFromList('qb-step-filter-column', cols, f.column, true)}
      <select data-action="qb-step-filter-op">
        ${COMPARISON_OPS.map((o) => `<option value="${o}" ${o === f.op ? 'selected' : ''}>${o}</option>`).join('')}
      </select>
      <input type="text" data-action="qb-step-filter-value" value="${escapeAttr(f.value)}" ${valueDisabled ? 'disabled' : ''} placeholder="${valueDisabled ? '(no value)' : 'value…'}" style="flex:1;min-width:70px;" />
      <button class="btn btn-ghost" data-action="qb-step-remove-filter" data-step-idx="${stepIdx}" aria-label="Remove filter">${iconSvg('x', 12)}</button>
    </div>`;
}

function renderStepAggRow(
  stepIdx: number,
  ai: number,
  a: DerivedStep['aggregates'][number],
  cols: QueryColumnSpec[],
): string {
  return `
    <div class="qb-sagg-row" data-sagg-idx="${ai}" style="display:flex;gap:6px;margin-bottom:4px;align-items:center;flex-wrap:wrap;">
      <select data-action="qb-step-agg-fn">
        ${AGG_FNS.map((fn) => `<option value="${fn}" ${fn === a.fn ? 'selected' : ''}>${fn}</option>`).join('')}
      </select>
      ${colSelectFromList('qb-step-agg-column', cols, a.column, true)}
      <span style="font-size:11px;color:var(--text-muted);">AS</span>
      <code style="font-size:11px;background:var(--surface-alt);padding:2px 6px;border-radius:3px;">${escapeHtml(a.alias)}</code>
      <button class="btn btn-ghost" data-action="qb-step-remove-agg" data-step-idx="${stepIdx}" aria-label="Remove aggregate">${iconSvg('x', 12)}</button>
    </div>`;
}

function renderStepCard(step: DerivedStep, idx: number, cols: QueryColumnSpec[]): string {
  const gbChecks = cols
    .map(
      (c) =>
        `<label style="font-size:12px;display:inline-flex;gap:4px;align-items:center;"><input type="checkbox" data-action="qb-step-gb" value="${escapeAttr(c.name)}" ${step.groupBy.includes(c.name) ? 'checked' : ''} /> ${escapeHtml(c.name)}</label>`,
    )
    .join('');
  return `
    <div class="qb-step" data-step-idx="${idx}" style="border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <strong style="font-size:12px;">Step ${idx + 1} — over the ${cols.length}-column result above</strong>
        <button class="btn btn-ghost" data-action="qb-step-remove" data-step-idx="${idx}" aria-label="Remove step">${iconSvg('x', 12)}</button>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin:4px 0 2px;">Filter</div>
      ${step.filters.map((f, fi) => renderStepFilterRow(idx, fi, f, cols)).join('')}
      <button class="btn btn-ghost" data-action="qb-step-add-filter" data-step-idx="${idx}" style="margin:2px 0;">${iconSvg('plus', 12)} <span>Add filter</span></button>
      <div style="font-size:11px;color:var(--text-muted);margin:6px 0 2px;">Group by</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">${gbChecks || '<span style="font-size:11px;color:var(--text-muted);">(no columns)</span>'}</div>
      <div style="font-size:11px;color:var(--text-muted);margin:6px 0 2px;">Aggregate</div>
      ${step.aggregates.map((a, ai) => renderStepAggRow(idx, ai, a, cols)).join('')}
      <button class="btn btn-ghost" data-action="qb-step-add-agg" data-step-idx="${idx}" style="margin:2px 0;">${iconSvg('plus', 12)} <span>Add aggregate</span></button>
    </div>`;
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
