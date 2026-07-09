// Schema panel renderer. Per spec §3.2 Phase 3 and handoff §9 this is the
// single most important surface — disproportionate care goes here.
//
// Per column we show: name + SQL type + assigned semantic type + confidence
// bar + expandable evidence + accept/override/define-new actions.

import { maskLabel } from '../core/demo-mode.ts';
import type { ColumnProfile } from '../core/engine.ts';
import type { MountedSource, MountedTable } from '../core/mount.ts';
import type { OverrideRule, UserType } from '../core/workbook.ts';
import type { TaxonomyBundle, TypeSpec } from '../taxonomy/types.ts';
import { Monsoon, Neutral } from '../tokens/colors.ts';
import { iconSvg } from '../tokens/icons.ts';
import type { CellState } from './cells/types.ts';
import { getQuickActions } from './quick-aggregations.ts';

export interface ColumnAssignment {
  columnName: string;
  sqlType: string;
  /** Once classified, the full ranked candidate list. */
  candidates: Array<{
    typeId: string;
    displayName: string;
    confidence: number;
    evidence: string[];
  }>;
  /** Resolution kind from the classifier. */
  resolution: { kind: 'auto_accept' | 'ambiguous' | 'unknown' };
  /** Current assignment — assigned by detector at mount, mutable by user. */
  assigned: {
    typeId: string | null; // null = unknown
    origin: 'detector' | 'user_accept' | 'user_override' | 'unknown';
    confidence: number;
  };
  /** Status while classification is in flight. */
  status: 'pending' | 'classified';
}

export interface SchemaPanelState {
  sources: MountedSource[];
  /** sourceId.tableId.columnName -> ColumnAssignment */
  assignments: Record<string, ColumnAssignment>;
  bundle: TaxonomyBundle | null;
  /** Threshold for "bulk accept all >= n" action (default 0.9). */
  autoAcceptThreshold: number;
  /** User-defined types from the workbook (per-`.naklidata`). */
  userTypes: UserType[];
  /**
   * Column profiles loaded via `engine.profileColumn`, keyed by
   * `assignmentKey(sourceId, tableId, columnName)`. Presence in this
   * map means the profile panel is expanded for that column; absence
   * means collapsed. main.ts owns the map and re-renders on change.
   */
  profiles: Record<string, ColumnProfile>;
  /**
   * Per-workspace override rules ("always treat columns named X as
   * type Y"). Theme 4 wave 2 (B3). Used by the toolbar to surface a
   * "Manage rules" button when the list is non-empty.
   */
  overrideRules: OverrideRule[];
}

export interface SchemaPanelHandlers {
  onAccept: (sourceId: string, tableId: string, columnName: string) => void;
  onOverride: (
    sourceId: string,
    tableId: string,
    columnName: string,
    typeId: string | null,
  ) => void;
  onBulkAccept: (threshold: number) => void;
  onChangeThreshold: (threshold: number) => void;
  /** Re-run classification across all mounted sources. Wired only when user types exist. */
  onReclassify: () => void;
  /** Open the "Override rules" management modal. Theme 4 wave 2 (B3). */
  onManageOverrideRules: () => void;
  /** Open the "Compare tables" modal. Theme 4 wave 2 (B2). */
  onCompareTables: () => void;
  /**
   * W5.3 — drop a list of cell partials into the notebook. Used by
   * the per-column "Quick chart" affordance; cells come from
   * `getQuickActions` in `quick-aggregations.ts`. Same shape the
   * templates panel emits.
   */
  onAddCells?: (cells: Array<Omit<CellState, 'order' | 'id'>>, sourceLabel: string) => void;
  /**
   * W5.3 — full per-table column-type map. Lets the column row's
   * quick-action menu know about partner columns (e.g., "sum amount
   * by vendor_name" needs both columns in the same table).
   */
  partnersByTable?: Map<string, Array<{ column: string; typeId: string | null }>>;
}

export function assignmentKey(sourceId: string, tableId: string, columnName: string): string {
  return `${sourceId}::${tableId}::${columnName}`;
}

export function renderSchemaPanel(
  root: HTMLElement,
  state: SchemaPanelState,
  handlers: SchemaPanelHandlers,
): void {
  injectSchemaCss();
  const region = root.querySelector<HTMLElement>('[data-region="schema-panel"]');
  if (!region) return;
  region.innerHTML = '';

  if (state.sources.length === 0) {
    region.innerHTML = `<p style="color: var(--text-muted); font-size: 12px; margin: 0;">Mount a source to see types.</p>`;
    return;
  }

  region.append(renderToolbar(state, handlers));

  for (const src of state.sources) {
    for (const table of src.tables) {
      region.append(renderTableBlock(src, table, state, handlers));
    }
  }
}

function renderToolbar(state: SchemaPanelState, handlers: SchemaPanelHandlers): HTMLElement {
  const el = document.createElement('div');
  el.className = 'schema-toolbar';
  const t = state.autoAcceptThreshold.toFixed(2);
  // Re-classify button only renders when there are user-defined types — that's
  // the case where re-running classification actually changes the result.
  const reclassifyHtml =
    state.userTypes.length > 0
      ? `<button class="btn btn-ghost" data-action="reclassify" style="width: 100%; margin-top: 4px; justify-content: center;" title="Re-run classification with the current user types">
           Re-classify with user types
         </button>`
      : '';
  // Manage-rules button only renders when at least one rule exists. Rules
  // get created via the "Remember" affordance on the post-Override toast;
  // the toolbar is just the management entry-point.
  const manageRulesHtml =
    state.overrideRules.length > 0
      ? `<button class="btn btn-ghost" data-action="manage-override-rules" style="width: 100%; margin-top: 4px; justify-content: center;" title="Manage 'always treat column X as type Y' rules">
           ${iconSvg('pencil', 12)} Override rules (${state.overrideRules.length})
         </button>`
      : '';
  // Compare-tables button only renders when there are ≥2 tables mounted —
  // a one-table workbook has nothing to compare against. Two tables in
  // the same source counts (e.g., examples/finance vendors + invoices).
  const totalTables = state.sources.reduce((sum, s) => sum + s.tables.length, 0);
  const compareTablesHtml =
    totalTables >= 2
      ? `<button class="btn btn-ghost" data-action="compare-tables" style="width: 100%; margin-top: 4px; justify-content: center;" title="Compare two tables side-by-side using a shared semantic-type column as the join key">
           ${iconSvg('table', 12)} Compare tables…
         </button>`
      : '';
  el.innerHTML = `
    <label style="font-size: 12px; color: var(--text-muted); display: block;">
      Auto-accept threshold
      <span class="schema-threshold-value" data-region="threshold-value">${t}</span>
    </label>
    <input type="range" min="0.5" max="1" step="0.01" value="${state.autoAcceptThreshold}"
           data-action="threshold-slider" aria-label="Auto-accept threshold"
           style="width: 100%; margin-top: 4px;" />
    <button class="btn" data-action="bulk-accept" style="width: 100%; margin-top: 8px; justify-content: center;">
      ${iconSvg('check', 14)} Bulk accept ≥ <span data-region="bulk-threshold">${t}</span>
    </button>
    ${reclassifyHtml}
    ${manageRulesHtml}
    ${compareTablesHtml}
  `;
  el.querySelector<HTMLInputElement>('[data-action="threshold-slider"]')?.addEventListener(
    'input',
    (ev) => {
      const v = Number((ev.target as HTMLInputElement).value);
      for (const n of el.querySelectorAll(
        '[data-region="threshold-value"], [data-region="bulk-threshold"]',
      )) {
        n.textContent = v.toFixed(2);
      }
      handlers.onChangeThreshold(v);
    },
  );
  el.querySelector('[data-action="bulk-accept"]')?.addEventListener('click', () => {
    handlers.onBulkAccept(state.autoAcceptThreshold);
  });
  el.querySelector('[data-action="reclassify"]')?.addEventListener('click', () => {
    handlers.onReclassify();
  });
  el.querySelector('[data-action="manage-override-rules"]')?.addEventListener('click', () => {
    handlers.onManageOverrideRules();
  });
  el.querySelector('[data-action="compare-tables"]')?.addEventListener('click', () => {
    handlers.onCompareTables();
  });
  return el;
}

function renderTableBlock(
  src: MountedSource,
  table: MountedTable,
  state: SchemaPanelState,
  handlers: SchemaPanelHandlers,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'schema-table';
  el.innerHTML = `
    <div class="schema-table-header">
      <span aria-hidden="true">${iconSvg('table', 14)}</span>
      <strong>${escapeHtml(maskLabel('table', table.name))}</strong>
      <span class="schema-table-rowcount">${table.rowCount.toLocaleString()} rows</span>
    </div>
    <ul class="schema-columns" role="list"></ul>
  `;
  const ul = el.querySelector('ul') as HTMLUListElement;
  // We rely on the controller to populate assignments per column. If we
  // don't yet have any assignments for this table, render a "classifying…"
  // placeholder.
  const prefix = assignmentKey(src.id, table.id, '');
  const myKeys = Object.keys(state.assignments).filter((k) => k.startsWith(prefix));
  if (myKeys.length === 0) {
    ul.innerHTML = `<li class="schema-pending">Classifying columns…</li>`;
    return el;
  }
  for (const key of myKeys) {
    const a = state.assignments[key];
    if (!a) continue;
    ul.append(
      renderColumnRow(
        src.id,
        table.id,
        table.name,
        a,
        state.bundle,
        state.userTypes,
        state.profiles[key] ?? null,
        handlers,
      ),
    );
  }
  return el;
}

function renderColumnRow(
  sourceId: string,
  tableId: string,
  tableName: string,
  a: ColumnAssignment,
  bundle: TaxonomyBundle | null,
  userTypes: UserType[],
  profile: ColumnProfile | null,
  handlers: SchemaPanelHandlers,
): HTMLElement {
  const li = document.createElement('li');
  li.className = 'schema-column';
  li.dataset.column = a.columnName;
  li.dataset.assignedType = a.assigned.typeId ?? '';
  li.dataset.origin = a.assigned.origin;

  const assignedLabel = a.assigned.typeId
    ? (bundle?.types.find((t) => t.id === a.assigned.typeId)?.display_name ??
      userTypes.find((t) => t.id === a.assigned.typeId)?.display_name ??
      a.assigned.typeId)
    : `unknown<${a.sqlType}>`;
  // W5.4 — Sensitivity label badge. Renders only for non-public types.
  // PII / financial / secret each get their own muted-color chip; the
  // title attribute carries the long-form explanation for hover.
  const assignedSensitivity = a.assigned.typeId
    ? (bundle?.types.find((t) => t.id === a.assigned.typeId)?.sensitivity ?? null)
    : null;
  const sensitivityBadge = renderSensitivityBadge(assignedSensitivity);
  const confidencePct = (a.assigned.confidence * 100).toFixed(0);
  const confidenceColor = confidenceToColor(a.assigned.confidence);
  const originBadge = renderOriginBadge(a.assigned.origin);
  // W5.3 — Quick chart actions per column. Computed lazily from the
  // assigned type + partner-column type map. Returns an empty array
  // for types we don't have suggestions for; the affordance hides
  // entirely in that case.
  const partners = handlers.partnersByTable?.get(tableName) ?? [];
  const quickActions = getQuickActions(a, tableName, partners);

  // M18: the column name is untrusted file data — a `"` in it would break out
  // of the id/aria-controls attributes and inject markup into the schema panel.
  // escapeHtml both interpolation sites (the panel itself is found by class, so
  // the exact id value only needs to be consistent + attribute-safe).
  const detailsId = escapeHtml(`evidence-${sourceId}-${tableId}-${a.columnName}`);

  li.innerHTML = `
    <div class="schema-column-head">
      <div class="schema-col-name">
        <span class="col-name">${escapeHtml(maskLabel('column', a.columnName))}</span>
        <span class="col-sql-type">${escapeHtml(a.sqlType)}</span>
        ${sensitivityBadge}
      </div>
      <div class="schema-col-type">
        <span class="type-pill" data-confidence-pill>
          <span class="confidence-dot" style="background:${confidenceColor}" aria-hidden="true"></span>
          <span>${escapeHtml(assignedLabel)}</span>
          ${originBadge}
        </span>
        <span class="confidence-pct" title="Confidence">${confidencePct}%</span>
      </div>
    </div>
    <div class="confidence-bar" aria-hidden="true">
      <div class="confidence-fill" style="width:${confidencePct}%; background:${confidenceColor};"></div>
    </div>
    <div class="schema-col-actions">
      <button class="btn btn-ghost" data-action="accept" aria-label="Accept type for ${escapeHtml(a.columnName)}" ${a.assigned.origin === 'user_accept' ? 'disabled' : ''}>
        ${iconSvg('check', 12)} Accept
      </button>
      <details class="schema-override">
        <summary class="btn btn-ghost" aria-label="Override type for ${escapeHtml(a.columnName)}">${iconSvg('pencil', 12)} Override</summary>
        <div class="override-menu" data-region="override-menu"></div>
      </details>
      ${
        quickActions.length > 0
          ? `<details class="schema-quick-chart">
        <summary class="btn btn-ghost" aria-label="Quick chart for ${escapeHtml(a.columnName)}">${iconSvg('chart', 12)} Quick chart</summary>
        <div class="quick-chart-menu" data-region="quick-chart-menu">
          ${quickActions
            .map(
              (q, i) =>
                `<button class="btn btn-ghost quick-chart-item" data-quick-idx="${i}">${escapeHtml(q.label)}</button>`,
            )
            .join('')}
        </div>
      </details>`
          : ''
      }
      <button class="btn btn-ghost" data-action="evidence" aria-controls="${detailsId}" aria-expanded="false">
        ${iconSvg('info', 12)} Evidence
      </button>
      <button class="btn btn-ghost" data-action="show-profile" data-source-id="${escapeHtml(sourceId)}" data-table-id="${escapeHtml(tableId)}" data-column="${escapeHtml(a.columnName)}" aria-pressed="${profile ? 'true' : 'false'}">
        ${iconSvg('chart', 12)} Profile
      </button>
      <button class="btn btn-ghost" data-action="cluster-column" data-source-id="${escapeHtml(sourceId)}" data-table-id="${escapeHtml(tableId)}" data-column="${escapeHtml(a.columnName)}" title="Cluster variant spellings of this column into a canonical value">
        ${iconSvg('link', 12)} Cluster values
      </button>
      ${isAmbiguous(a) ? renderAskSidecarButton(sourceId, tableId, a) : ''}
    </div>
    <div id="${detailsId}" class="schema-evidence" hidden>${renderEvidence(a)}</div>
    <div class="schema-profile-pane" ${profile ? '' : 'hidden'}>${profile ? renderProfilePanel(profile) : ''}</div>
  `;

  li.querySelector('[data-action="accept"]')?.addEventListener('click', () => {
    handlers.onAccept(sourceId, tableId, a.columnName);
  });
  // W5.3 — Quick chart menu clicks dispatch into the notebook via the
  // onAddCells handler. Picking an action collapses the <details>.
  for (const btn of li.querySelectorAll<HTMLButtonElement>('.quick-chart-item')) {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.quickIdx);
      const action = quickActions[idx];
      if (!action || !handlers.onAddCells) return;
      handlers.onAddCells(action.generate(), action.label);
      const details = btn.closest<HTMLDetailsElement>('details.schema-quick-chart');
      if (details) details.open = false;
    });
  }
  li.querySelector('[data-action="evidence"]')?.addEventListener('click', (ev) => {
    const btn = ev.currentTarget as HTMLButtonElement;
    const panel = li.querySelector<HTMLElement>('.schema-evidence');
    if (!panel) return;
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!expanded));
    panel.hidden = expanded;
  });

  // Lazily populate the override menu on first open.
  const details = li.querySelector<HTMLDetailsElement>('details.schema-override');
  details?.addEventListener('toggle', () => {
    if (!details.open) return;
    const menu = details.querySelector<HTMLElement>('[data-region="override-menu"]');
    if (menu && menu.childElementCount === 0 && bundle) {
      menu.append(
        renderOverrideMenu(bundle, userTypes, a, sourceId, tableId, (typeId) => {
          details.open = false;
          handlers.onOverride(sourceId, tableId, a.columnName, typeId);
        }),
      );
    }
  });

  return li;
}

/**
 * Render the column-profile panel from a ColumnProfile. Inline HTML —
 * not a full template, just a small set of rows + the top-k list.
 */
function renderProfilePanel(p: ColumnProfile): string {
  const pct = (n: number, total: number) =>
    total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '—';
  const fmtNum = (n: number | null): string =>
    n === null ? '—' : Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1);
  const nullPct = pct(p.nullCount, p.totalRows);
  const distinctPct = pct(p.distinctCount, p.totalRows);
  const lengthLine =
    p.lengthMin === null || p.lengthMax === null
      ? '—'
      : `${fmtNum(p.lengthMin)} – ${fmtNum(p.lengthMax)} (avg ${fmtNum(p.lengthAvg)})`;
  const topRows = p.topK
    .map(
      (entry) => `
        <li class="schema-profile-topk-row">
          <code>${escapeHtml(entry.value.length > 60 ? `${entry.value.slice(0, 57)}…` : entry.value)}</code>
          <span class="schema-profile-topk-count">×${entry.count.toLocaleString()}</span>
        </li>`,
    )
    .join('');
  return `
    <div class="schema-profile-grid">
      <div class="schema-profile-row">
        <span class="schema-profile-label">Rows</span>
        <span class="schema-profile-value">${p.totalRows.toLocaleString()}</span>
      </div>
      <div class="schema-profile-row">
        <span class="schema-profile-label">Distinct</span>
        <span class="schema-profile-value">${p.distinctCount.toLocaleString()} <span class="schema-profile-pct">(${distinctPct})</span></span>
      </div>
      <div class="schema-profile-row">
        <span class="schema-profile-label">Null</span>
        <span class="schema-profile-value">${p.nullCount.toLocaleString()} <span class="schema-profile-pct">(${nullPct})</span></span>
      </div>
      <div class="schema-profile-row">
        <span class="schema-profile-label">Length</span>
        <span class="schema-profile-value">${lengthLine}</span>
      </div>
      ${
        p.numeric
          ? `<div class="schema-profile-row">
        <span class="schema-profile-label">Distribution</span>
        <span class="schema-profile-value">min ${fmtNum(p.numeric.min)} · q1 ${fmtNum(p.numeric.q1)} · med ${fmtNum(p.numeric.median)} · q3 ${fmtNum(p.numeric.q3)} · max ${fmtNum(p.numeric.max)}</span>
      </div>
      <div class="schema-profile-row">
        <span class="schema-profile-label">Outliers</span>
        <span class="schema-profile-value">${p.numeric.outliers.toLocaleString()} <span class="schema-profile-pct">(IQR rule)</span></span>
      </div>`
          : ''
      }
    </div>
    ${
      p.topK.length > 0
        ? `<div class="schema-profile-topk">
            <div class="schema-profile-topk-head">Top values</div>
            <ul>${topRows}</ul>
          </div>`
        : ''
    }
  `;
}

/**
 * A column qualifies for sidecar disambiguation when the classifier
 * picked a candidate but isn't confident: two-or-more candidates and
 * the assigned confidence sits in [0.5, 0.9). Once the user has
 * accepted or overridden, the column is no longer ambiguous.
 */
function isAmbiguous(a: ColumnAssignment): boolean {
  if (a.assigned.origin !== 'detector') return false;
  if (a.candidates.length < 2) return false;
  return a.assigned.confidence >= 0.5 && a.assigned.confidence < 0.9;
}

function renderAskSidecarButton(sourceId: string, tableId: string, a: ColumnAssignment): string {
  return `
    <button
      class="btn btn-ghost schema-sidecar-ask"
      data-action="ask-sidecar-disambiguate"
      data-source-id="${escapeHtml(sourceId)}"
      data-table-id="${escapeHtml(tableId)}"
      data-column="${escapeHtml(a.columnName)}"
      title="Let the sidecar pick a type from the candidates"
      aria-label="Ask sidecar to disambiguate type for ${escapeHtml(a.columnName)}"
    >
      ${iconSvg('info', 12)} Ask sidecar
    </button>`;
}

function renderOriginBadge(origin: ColumnAssignment['assigned']['origin']): string {
  if (origin === 'detector') return '';
  const map: Record<'user_accept' | 'user_override' | 'unknown', [string, string]> = {
    user_accept: ['accepted', 'var(--success)'],
    user_override: ['overridden', 'var(--accent)'],
    unknown: ['unknown', 'var(--text-muted)'],
  };
  const entry = map[origin];
  if (!entry) return '';
  const [label, color] = entry;
  return `<span class="origin-badge" style="color:${color}">· ${label}</span>`;
}

/**
 * W5.4 — Sensitivity chip per the type's classification. Public (or
 * absent) returns ''; PII / financial / secret each get a small
 * muted-color chip with a hover title. The chip sits next to
 * `col-sql-type` so it travels with the column-name cluster.
 */
function renderSensitivityBadge(sensitivity: string | null): string {
  if (!sensitivity || sensitivity === 'public') return '';
  const map: Record<string, { label: string; title: string; color: string }> = {
    pii: {
      label: 'PII',
      title: 'Personally identifiable information — handle with care.',
      color: 'var(--accent)',
    },
    financial: {
      label: 'financial',
      title: 'Financial values or identifiers (money, GST IDs, account numbers).',
      color: 'var(--text-muted)',
    },
    secret: {
      label: 'secret',
      title: 'Credentials, tokens, keys — should never be persisted in clear.',
      color: 'var(--danger)',
    },
  };
  const entry = map[sensitivity];
  if (!entry) return '';
  return `<span class="sensitivity-badge" style="color:${entry.color}" title="${escapeHtml(entry.title)}">${escapeHtml(entry.label)}</span>`;
}

function renderEvidence(a: ColumnAssignment): string {
  if (a.candidates.length === 0) {
    return `<p style="color: var(--text-muted); font-size: 12px; margin: 0;">No detectors fired above the floor.</p>`;
  }
  const rows = a.candidates
    .map((c) => {
      const pct = (c.confidence * 100).toFixed(0);
      return `
        <div class="evidence-row">
          <div class="evidence-row-head">
            <strong>${escapeHtml(c.displayName)}</strong>
            <span style="color: var(--text-muted);">${pct}%</span>
          </div>
          <ul class="evidence-bullets">
            ${c.evidence.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}
          </ul>
        </div>`;
    })
    .join('');
  return rows;
}

function renderOverrideMenu(
  bundle: TaxonomyBundle,
  userTypes: UserType[],
  a: ColumnAssignment,
  sourceId: string,
  tableId: string,
  onPick: (typeId: string | null) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;padding:4px;';
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Filter types…';
  search.style.cssText =
    'padding:6px;border:1px solid var(--border);border-radius:4px;margin-bottom:4px;';
  search.setAttribute('aria-label', 'Filter types');
  wrap.append(search);

  const list = document.createElement('div');
  list.style.cssText = 'max-height:240px;overflow:auto;display:flex;flex-direction:column;gap:1px;';
  wrap.append(list);

  // "Set to unknown" first.
  const unknownBtn = document.createElement('button');
  unknownBtn.className = 'btn btn-ghost';
  unknownBtn.style.cssText = 'justify-content:flex-start;padding:4px 8px;font-size:12px;';
  unknownBtn.textContent = 'unknown';
  unknownBtn.addEventListener('click', () => onPick(null));
  list.append(unknownBtn);

  // User-defined types — always first since they're scoped to this workbook.
  if (userTypes.length > 0) {
    const hdr = document.createElement('div');
    hdr.textContent = 'User types';
    hdr.style.cssText =
      'font-size:11px;color:var(--accent);padding:4px 8px;text-transform:uppercase;letter-spacing:0.05em;';
    list.append(hdr);
    for (const t of userTypes) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-ghost type-option';
      btn.style.cssText = 'justify-content:flex-start;padding:4px 8px;font-size:12px;';
      btn.dataset.typeId = t.id;
      btn.dataset.label = t.display_name.toLowerCase();
      btn.innerHTML = `${escapeHtml(t.display_name)} <span style="color:var(--text-muted);margin-left:auto;font-size:10px;">${escapeHtml(t.id)}</span>`;
      btn.addEventListener('click', () => onPick(t.id));
      list.append(btn);
    }
  }

  const compatible = bundle.types.filter((t) =>
    t.sql_compat.some((c) => a.sqlType.toUpperCase().includes(c.toUpperCase())),
  );
  const incompatible = bundle.types.filter((t) => !compatible.includes(t));
  const groups: Array<[string, TypeSpec[]]> = [
    ['Compatible types', compatible],
    ['Other types', incompatible],
  ];
  for (const [label, items] of groups) {
    if (items.length === 0) continue;
    const hdr = document.createElement('div');
    hdr.textContent = label;
    hdr.style.cssText =
      'font-size:11px;color:var(--text-muted);padding:4px 8px;text-transform:uppercase;letter-spacing:0.05em;';
    list.append(hdr);
    for (const t of items) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-ghost type-option';
      btn.style.cssText = 'justify-content:flex-start;padding:4px 8px;font-size:12px;';
      btn.dataset.typeId = t.id;
      btn.dataset.label = t.display_name.toLowerCase();
      btn.innerHTML = `${escapeHtml(t.display_name)} <span style="color:var(--text-muted);margin-left:auto;font-size:10px;">${escapeHtml(t.id)}</span>`;
      btn.addEventListener('click', () => onPick(t.id));
      list.append(btn);
    }
  }

  // "Define new type from this column…" at the bottom. Bubbles a data-
  // action up to main.ts, which opens the modal.
  const defineBtn = document.createElement('button');
  defineBtn.className = 'btn btn-ghost define-new-type-trigger';
  defineBtn.dataset.action = 'define-new-type';
  defineBtn.dataset.sourceId = sourceId;
  defineBtn.dataset.tableId = tableId;
  defineBtn.dataset.column = a.columnName;
  defineBtn.dataset.sqlType = a.sqlType;
  defineBtn.style.cssText =
    'justify-content:flex-start;padding:6px 8px;font-size:12px;color:var(--accent);margin-top:6px;border-top:1px dashed var(--border);';
  defineBtn.innerHTML = '+ Define new type from this column…';
  list.append(defineBtn);

  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    for (const b of list.querySelectorAll<HTMLElement>('.type-option')) {
      const label = b.dataset.label ?? '';
      const id = b.dataset.typeId ?? '';
      const match = !q || label.includes(q) || id.includes(q);
      b.style.display = match ? '' : 'none';
    }
  });

  setTimeout(() => search.focus(), 0);
  return wrap;
}

function confidenceToColor(conf: number): string {
  // S11: sourced from tokens/colors.ts (was hardcoded copies of these values).
  if (conf >= 0.9) return Neutral.success; // strong
  if (conf >= 0.7) return Monsoon[3]; // storm
  if (conf >= 0.5) return Monsoon[2]; // drizzle
  if (conf > 0) return Monsoon[1]; // mist
  return Neutral.textMuted;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function injectSchemaCss(): void {
  if (document.getElementById('naklidata-schema-css')) return;
  const tag = document.createElement('style');
  tag.id = 'naklidata-schema-css';
  tag.textContent = SCHEMA_CSS;
  document.head.appendChild(tag);
}

const SCHEMA_CSS = `
.schema-toolbar {
  padding: 8px 0 12px;
  border-bottom: 1px dashed var(--border);
  margin-bottom: 12px;
}
.schema-threshold-value {
  color: var(--text);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.schema-table { margin-bottom: 16px; }
.schema-table-header {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
  padding: 4px 0;
  border-bottom: 1px solid var(--border);
}
.schema-table-rowcount {
  margin-left: auto;
  font-weight: 400;
  color: var(--text-muted);
  font-size: 11px;
}
.schema-columns {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex; flex-direction: column;
  gap: 4px;
}
.schema-pending {
  color: var(--text-muted);
  font-size: 12px;
  padding: 4px 0;
}
.schema-column {
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--surface-alt);
  border: 1px solid transparent;
}
.schema-column:hover {
  border-color: var(--border);
  background: var(--surface);
}
.schema-column-head {
  display: flex; justify-content: space-between; align-items: flex-start;
  gap: 8px;
}
.schema-col-name { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.col-name {
  font-family: var(--font-mono);
  font-size: 12px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.col-sql-type {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: lowercase;
}
.sensitivity-badge {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 5px;
  border: 1px solid currentColor;
  border-radius: 999px;
  opacity: 0.75;
  white-space: nowrap;
  cursor: help;
}
.schema-col-type { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.type-pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 1px 6px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 11px;
}
.confidence-dot {
  width: 6px; height: 6px; border-radius: 50%;
}
.confidence-pct {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  min-width: 32px;
  text-align: right;
}
.origin-badge {
  font-size: 10px;
  font-style: italic;
}
.confidence-bar {
  height: 2px;
  background: var(--border);
  border-radius: 1px;
  margin-top: 4px;
  overflow: hidden;
}
.confidence-fill {
  height: 100%;
  transition: width 200ms ease;
}
.schema-col-actions {
  display: flex;
  gap: 4px;
  margin-top: 6px;
}
.schema-col-actions .btn {
  padding: 2px 6px;
  font-size: 11px;
}
.schema-override summary {
  list-style: none;
  cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
}
.schema-override summary::-webkit-details-marker { display: none; }
.schema-override[open] .override-menu {
  position: absolute;
  margin-top: 4px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  box-shadow: var(--shadow-md);
  z-index: 50;
  min-width: 240px;
}
.schema-quick-chart {
  position: relative;
  display: inline-block;
}
.schema-quick-chart summary {
  list-style: none;
  cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
}
.schema-quick-chart summary::-webkit-details-marker { display: none; }
.schema-quick-chart[open] .quick-chart-menu {
  position: absolute;
  margin-top: 4px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  box-shadow: var(--shadow-md);
  z-index: 50;
  min-width: 280px;
  padding: 4px;
  display: flex;
  flex-direction: column;
}
.quick-chart-item {
  width: 100%;
  justify-content: flex-start;
  text-align: left;
  font-size: 12px;
  padding: 6px 8px;
}
.schema-evidence {
  margin-top: 6px;
  padding: 8px;
  background: var(--surface);
  border-radius: 4px;
  border: 1px solid var(--border);
}
.evidence-row { margin-bottom: 8px; }
.evidence-row:last-child { margin-bottom: 0; }
.evidence-row-head {
  display: flex; justify-content: space-between;
  font-size: 12px;
  margin-bottom: 2px;
}
.evidence-bullets {
  margin: 0;
  padding-left: 16px;
  font-size: 11px;
  color: var(--text-muted);
}
.evidence-bullets li { margin: 1px 0; }

/* Sidecar "Ask sidecar" trigger on ambiguous columns.
   Rendered only when the column qualifies (origin='detector' + 2+
   candidates + confidence in [0.5, 0.9)), and only visible when the
   app root has .app-sidecar-enabled. */
.schema-sidecar-ask {
  font-size: 11px;
  color: var(--accent);
  display: none;
}
.app-sidecar-enabled .schema-sidecar-ask {
  display: inline-flex;
}
.schema-sidecar-ask:disabled {
  opacity: 0.6;
  cursor: progress;
}

/* Column-profile pane (Theme 4 wave 1) — rendered inline below the
   row when a profile has been loaded. Hidden until the user clicks
   the Profile button. */
.schema-profile-pane {
  margin-top: 6px;
  padding: 8px 10px;
  background: var(--surface);
  border-radius: 4px;
  border: 1px solid var(--border);
  font-size: 11px;
}
.schema-profile-pane[hidden] { display: none; }
.schema-profile-pane.schema-profile-loading {
  color: var(--text-muted);
  font-style: italic;
}
.schema-profile-pane.schema-profile-error {
  background: #F6D6D3;
  color: var(--text);
}
.schema-profile-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 6px 12px;
  margin-bottom: 8px;
}
.schema-profile-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.schema-profile-label {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.schema-profile-value {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}
.schema-profile-pct {
  color: var(--text-muted);
  font-weight: normal;
  margin-left: 2px;
}
.schema-profile-topk {
  border-top: 1px dashed var(--border);
  padding-top: 6px;
}
.schema-profile-topk-head {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 4px;
}
.schema-profile-topk ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.schema-profile-topk-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 2px 0;
}
.schema-profile-topk-row code {
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--surface-alt);
  padding: 1px 4px;
  border-radius: 2px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.schema-profile-topk-count {
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}
`;
