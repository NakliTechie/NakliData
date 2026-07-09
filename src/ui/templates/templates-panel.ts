// "Suggested reports" — type-gated list of templates that surfaces when
// the required types are present in the workbook.

import { iconSvg } from '../../tokens/icons.ts';
import type { CellState } from '../cells/types.ts';
import type { ColumnAssignment } from '../schema-panel.ts';
import {
  ALL_TEMPLATES,
  type ColumnRef,
  type Template,
  findApplicableTemplates,
  indexByTypeWithCandidates,
} from './templates.ts';

export interface TemplatePanelState {
  sources: Array<{ tables: Array<{ id: string; name: string }> }>;
  assignments: Record<string, ColumnAssignment>;
  /** When true, the "Ask sidecar to rank" affordance is shown (Job 4). */
  sidecarEnabled?: boolean;
  /** Sidecar ranking: templateId → score (0..1). When present, cards sort by it. */
  ranking?: Record<string, number>;
}

export interface RankCandidate {
  templateId: string;
  name: string;
  description: string;
}

export interface TemplatePanelHandlers {
  onInstantiate: (cells: CellState[], templateId: string) => void;
  /** Job 4 — ask the sidecar to rank the applicable templates by fit. */
  onRank?: (candidates: RankCandidate[], typeSummary: string) => void;
}

let _idSeq = 1;
const genCellId = () => `tpl_${Date.now().toString(36)}_${_idSeq++}`;

export function renderTemplatePanel(
  root: HTMLElement,
  state: TemplatePanelState,
  handlers: TemplatePanelHandlers,
): void {
  injectCss();
  const region = root.querySelector<HTMLElement>('[data-region="templates-panel"]');
  if (!region) return;
  region.innerHTML = '';

  const { byType, perType } = indexByTypeWithCandidates(state.assignments, state.sources);
  const applicable = findApplicableTemplates(ALL_TEMPLATES, byType, perType);

  if (applicable.length === 0) {
    region.innerHTML = `<p style="color: var(--text-muted); font-size: 12px; margin: 0;">
      Mount sources with recognized columns (date, amount, vendor, etc.) to see suggested reports.
    </p>`;
    return;
  }

  // Job 4 — when the sidecar has ranked the templates, sort by score
  // (highest first); unranked templates fall to the end in their
  // original order.
  const ranking = state.ranking;
  const ordered = [...applicable];
  if (ranking) {
    ordered.sort((a, b) => {
      const sa = ranking[a.template.id];
      const sb = ranking[b.template.id];
      if (sa === undefined && sb === undefined) return 0;
      if (sa === undefined) return 1;
      if (sb === undefined) return -1;
      return sb - sa;
    });
  }

  // "Ask sidecar to rank" affordance — only when the sidecar is enabled,
  // a rank handler is wired, and there are at least two templates to
  // order. Structured output only (template-ids + scores); no prose.
  if (state.sidecarEnabled && handlers.onRank && applicable.length >= 2) {
    const bar = document.createElement('div');
    bar.className = 'templates-rank-bar';
    bar.innerHTML = `
      <button class="btn btn-ghost" data-action="rank-reports" style="font-size:11px;padding:3px 8px;">
        ${iconSvg('chart', 12)} Ask sidecar to rank
      </button>`;
    bar.querySelector('[data-action="rank-reports"]')?.addEventListener('click', () => {
      const candidates: RankCandidate[] = applicable.map(({ template }) => ({
        templateId: template.id,
        name: template.name,
        description: template.description,
      }));
      handlers.onRank?.(candidates, buildTypeSummary(state));
    });
    region.append(bar);
  }

  for (const { template, matched } of ordered) {
    const score = ranking ? ranking[template.id] : undefined;
    region.append(renderTemplateCard(template, matched, handlers, score));
  }
}

/**
 * Compact, row-data-free summary of the workbook's assigned column
 * types, grouped by table: "invoices: gstin, amount; payments: amount".
 * Shipped to the sidecar as Job 4 context.
 */
function buildTypeSummary(state: TemplatePanelState): string {
  const tableNameById: Record<string, string> = {};
  for (const s of state.sources) for (const t of s.tables) tableNameById[t.id] = t.name;
  const byTable = new Map<string, string[]>();
  for (const [key, a] of Object.entries(state.assignments)) {
    if (!a.assigned.typeId) continue;
    const [, tableId] = key.split('::');
    const tableName = tableId ? tableNameById[tableId] : undefined;
    if (!tableName) continue;
    const list = byTable.get(tableName) ?? [];
    if (!list.includes(a.assigned.typeId)) list.push(a.assigned.typeId);
    byTable.set(tableName, list);
  }
  return (
    [...byTable.entries()].map(([table, types]) => `${table}: ${types.join(', ')}`).join('; ') ||
    '(no recognized column types yet)'
  );
}

function renderTemplateCard(
  template: Template,
  matched: Record<string, ColumnRef | undefined>,
  handlers: TemplatePanelHandlers,
  score?: number,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'template-card';
  const usedCols = formatUsedColumnsHtml(matched);
  const badge =
    score !== undefined
      ? `<span class="template-score" title="Sidecar fit score">${Math.round(score * 100)}%</span>`
      : '';
  el.innerHTML = `
    <div class="template-head">
      <strong>${badge}${escapeHtml(template.name)}</strong>
      <button class="btn btn-primary" data-action="instantiate" style="font-size:11px;padding:2px 8px;">${iconSvg('plus', 12)} Add</button>
    </div>
    <p class="template-desc">${escapeHtml(template.description)}</p>
    <details>
      <summary style="font-size:11px;color:var(--text-muted);cursor:pointer;">Matched columns</summary>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px;line-height:1.5;">${usedCols}</div>
    </details>
  `;
  el.querySelector('[data-action="instantiate"]')?.addEventListener('click', () => {
    const cells = instantiateTemplate(template, matched);
    handlers.onInstantiate(cells, template.id);
  });
  return el;
}

function instantiateTemplate(
  template: Template,
  matched: Record<string, ColumnRef | undefined>,
): CellState[] {
  // Forward-pass H4 (2026-06-02): chart partials now carry an
  // internal `_intendedInputName` field documenting which named SQL
  // cell they should bind to. Resolve by name first; only fall back
  // to nearest-prev-named-SQL when no name was supplied. The old
  // nearest-prev-only heuristic bound every chart in
  // ERROR_FREQUENCY (md, sql:errors_by_service, sql:errors_over_time,
  // chart→errors_by_service, chart→errors_over_time) to
  // errors_over_time because that was the most-recent named cell at
  // every chart point.
  const partials = template.instantiate(matched) as Array<
    Omit<CellState, 'order'> & { _intendedInputName?: string | null }
  >;
  const idByName = new Map<string, string>();
  // First pass: assign IDs + index named SQL cells.
  const cells: Array<CellState & { _intendedInputName?: string | null }> = partials.map((p, i) => {
    const c = { ...p, id: genCellId(), order: i } as CellState & {
      _intendedInputName?: string | null;
    };
    if (c.kind === 'sql' && c.name) idByName.set(c.name, c.id);
    return c;
  });
  // Second pass: resolve chart bindings.
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (!c || c.kind !== 'chart' || c.inputCell !== null) continue;
    const wanted = c._intendedInputName ?? null;
    if (wanted) {
      const byName = idByName.get(wanted);
      if (byName) {
        c.inputCell = byName;
        continue;
      }
      // Intended-name didn't resolve (typo in template, or referenced
      // a non-existent SQL cell) — fall through to nearest-prev so
      // the chart still renders.
    }
    for (let j = i - 1; j >= 0; j--) {
      const prev = cells[j];
      if (prev?.kind === 'sql' && prev.name) {
        c.inputCell = prev.id;
        break;
      }
    }
  }
  // Strip the internal field before returning — keeps CellState clean
  // for persistence + notebook code that's never seen it.
  return cells.map(({ _intendedInputName: _stripped, ...rest }) => rest as CellState);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Builds the "Matched columns" line for a template card.
 *
 * Each piece (`ref.table`, `ref.column`, `typeId`) flows from MOUNTED
 * files — table and column names come from user-supplied xlsx / CSV /
 * parquet headers — and is therefore untrusted. Escape each before
 * concatenating into innerHTML.
 *
 * Forward-pass C1 (2026-06-02): a hostile xlsx with header
 * `<img src=x onerror=alert(1)>` would otherwise XSS as soon as the
 * classifier surfaced it in this card. XSS in NakliData reaches BYOK
 * keys in sessionStorage via the wide-open `connect-src https:`.
 *
 * Exported for unit-testing; see tests/templates-panel-xss.test.ts.
 */
export function formatUsedColumnsHtml(matched: Record<string, ColumnRef | undefined>): string {
  return Object.entries(matched)
    .filter((entry): entry is [string, ColumnRef] => entry[1] !== undefined)
    .map(
      ([typeId, ref]) =>
        `${escapeHtml(ref.table)}.${escapeHtml(ref.column)} → ${escapeHtml(typeId)}`,
    )
    .join('<br/>');
}

function injectCss(): void {
  if (document.getElementById('naklidata-templates-css')) return;
  const tag = document.createElement('style');
  tag.id = 'naklidata-templates-css';
  tag.textContent = `
.templates-panel-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--space-4) var(--space-5);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}
.template-card {
  padding: 8px;
  margin-top: 8px;
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.template-head {
  display: flex; justify-content: space-between; align-items: center;
  gap: 8px;
}
.template-desc {
  font-size: 11px;
  color: var(--text-muted);
  margin: 4px 0 6px;
  line-height: 1.4;
}
.templates-rank-bar {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}
.template-score {
  display: inline-block;
  min-width: 30px;
  margin-right: 6px;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--accent);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  text-align: center;
  vertical-align: middle;
}
`;
  document.head.appendChild(tag);
}
