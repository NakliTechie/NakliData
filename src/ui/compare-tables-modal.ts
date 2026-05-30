// Compare-tables modal — Theme 4 wave 2 (B2). Pick two tables, run
// `Engine.compareTables` with an auto-detected join key drawn from
// taxonomy assignments, render bucket counts + a column-level diff
// sample. The modal is ephemeral; the user can copy the SQL the modal
// builds (TODO future) but the result is not persisted.

import type { Engine, TableComparison } from '../core/engine.ts';
import type { MountedSource, MountedTable } from '../core/mount.ts';
import { iconSvg } from '../tokens/icons.ts';
import type { ColumnAssignment } from './schema-panel.ts';
import { assignmentKey } from './schema-panel.ts';

let _modalEl: HTMLElement | null = null;
let _keyHandler: ((ev: KeyboardEvent) => void) | null = null;
let _previouslyFocused: HTMLElement | null = null;

export interface CompareTablesModalInput {
  sources: MountedSource[];
  assignments: Record<string, ColumnAssignment>;
  /** Live engine, used to run the comparison. */
  engine: Engine;
}

/**
 * Candidate join keys for a pair of tables, derived from the column
 * assignments. Each candidate is a typeId both tables have at least
 * one column assigned to, plus the first such column-name on each
 * side. Tied candidates favour bundled types over user_types via the
 * caller's ordering of assignments.
 */
export interface JoinKeyCandidate {
  typeId: string;
  /** Display name of the type (from the candidate's evidence). */
  typeLabel: string;
  /** Column name in table A. */
  columnA: string;
  /** Column name in table B. */
  columnB: string;
}

/**
 * Find candidate join keys for a pair of tables given the workbook's
 * column assignments. A "candidate" is any typeId both tables have at
 * least one assigned column for. Returns one candidate per typeId
 * (first matching column on each side wins). Public for unit tests.
 */
export function findJoinKeyCandidates(
  assignments: Record<string, ColumnAssignment>,
  sourceA: MountedSource,
  tableA: MountedTable,
  sourceB: MountedSource,
  tableB: MountedTable,
): JoinKeyCandidate[] {
  const prefixA = assignmentKey(sourceA.id, tableA.id, '');
  const prefixB = assignmentKey(sourceB.id, tableB.id, '');
  // Build maps typeId → first column-name for each table.
  const aByType = new Map<string, { columnName: string; displayName: string }>();
  const bByType = new Map<string, { columnName: string; displayName: string }>();
  for (const [key, a] of Object.entries(assignments)) {
    if (!a.assigned.typeId) continue;
    const typeId = a.assigned.typeId;
    const displayName = a.candidates.find((c) => c.typeId === typeId)?.displayName ?? typeId;
    if (key.startsWith(prefixA) && !aByType.has(typeId)) {
      aByType.set(typeId, { columnName: a.columnName, displayName });
    }
    if (key.startsWith(prefixB) && !bByType.has(typeId)) {
      bByType.set(typeId, { columnName: a.columnName, displayName });
    }
  }
  const out: JoinKeyCandidate[] = [];
  for (const [typeId, rowA] of aByType) {
    const rowB = bByType.get(typeId);
    if (!rowB) continue;
    out.push({
      typeId,
      typeLabel: rowA.displayName,
      columnA: rowA.columnName,
      columnB: rowB.columnName,
    });
  }
  return out;
}

export function openCompareTablesModal(input: CompareTablesModalInput): void {
  if (_modalEl && document.body.contains(_modalEl)) return;
  _previouslyFocused = (document.activeElement as HTMLElement) ?? null;
  injectCompareCss();
  const overlay = document.createElement('div');
  overlay.className = 'compare-tables-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Compare tables');
  overlay.innerHTML = `
    <div class="compare-tables-modal" data-region="compare-tables-modal">
      <div class="compare-tables-header">
        <strong>Compare tables</strong>
        <button class="btn btn-ghost compare-tables-close" data-action="close-compare-tables" aria-label="Close">
          ${iconSvg('x', 14)}
        </button>
      </div>
      <div class="compare-tables-body" data-region="compare-tables-body"></div>
    </div>
  `;
  overlay.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target === overlay) closeCompareTablesModal();
    if (target.closest('[data-action="close-compare-tables"]')) closeCompareTablesModal();
  });
  _keyHandler = (ev) => {
    if (ev.key === 'Escape') closeCompareTablesModal();
  };
  document.addEventListener('keydown', _keyHandler);
  document.body.append(overlay);
  _modalEl = overlay;
  renderPickerStep(overlay, input);
  // Move focus to the close button (the picker dropdowns are render-
  // step content; landing on the close button is safe + predictable).
  overlay.querySelector<HTMLElement>('[data-action="close-compare-tables"]')?.focus();
}

export function closeCompareTablesModal(): void {
  if (_keyHandler) {
    document.removeEventListener('keydown', _keyHandler);
    _keyHandler = null;
  }
  if (_modalEl?.parentElement) {
    _modalEl.parentElement.removeChild(_modalEl);
  }
  _modalEl = null;
  _previouslyFocused?.focus();
  _previouslyFocused = null;
}

/**
 * Flat list of {source, table, label} for the pickers. Used by the
 * dropdowns + the lookup helper.
 */
function flattenTables(
  sources: MountedSource[],
): Array<{ source: MountedSource; table: MountedTable; value: string; label: string }> {
  const out: Array<{ source: MountedSource; table: MountedTable; value: string; label: string }> =
    [];
  for (const s of sources) {
    for (const t of s.tables) {
      out.push({
        source: s,
        table: t,
        value: `${s.id}::${t.id}`,
        label: `${s.label} / ${t.name}`,
      });
    }
  }
  return out;
}

function renderPickerStep(overlay: HTMLElement, input: CompareTablesModalInput): void {
  const body = overlay.querySelector<HTMLElement>('[data-region="compare-tables-body"]');
  if (!body) return;
  const flat = flattenTables(input.sources);
  if (flat.length < 2) {
    body.innerHTML = `<p class="compare-tables-empty">Mount at least two tables to compare.</p>`;
    return;
  }
  const options = flat
    .map((f) => `<option value="${f.value}">${escapeHtml(f.label)}</option>`)
    .join('');
  body.innerHTML = `
    <div class="compare-tables-pickers">
      <label>
        <span class="compare-tables-label">Table A</span>
        <select data-region="table-a">${options}</select>
      </label>
      <label>
        <span class="compare-tables-label">Table B</span>
        <select data-region="table-b">${options}</select>
      </label>
    </div>
    <div class="compare-tables-keys" data-region="key-picker"></div>
    <div class="compare-tables-controls">
      <button class="btn" data-action="run-compare" disabled>${iconSvg('check', 14)} Run comparison</button>
    </div>
    <div class="compare-tables-result" data-region="result"></div>
  `;
  const selA = body.querySelector<HTMLSelectElement>('[data-region="table-a"]');
  const selB = body.querySelector<HTMLSelectElement>('[data-region="table-b"]');
  // Default A and B to the first two distinct entries so the user can
  // hit Run without picking from scratch.
  if (selA && selB && flat.length >= 2) {
    selA.value = flat[0]?.value ?? '';
    selB.value = flat[1]?.value ?? '';
  }
  const refreshKeyPicker = () => updateKeyPicker(overlay, input, flat);
  selA?.addEventListener('change', refreshKeyPicker);
  selB?.addEventListener('change', refreshKeyPicker);
  refreshKeyPicker();

  body
    .querySelector<HTMLButtonElement>('[data-action="run-compare"]')
    ?.addEventListener('click', () => {
      void runComparison(overlay, input, flat);
    });
}

function updateKeyPicker(
  overlay: HTMLElement,
  input: CompareTablesModalInput,
  flat: ReturnType<typeof flattenTables>,
): void {
  const body = overlay.querySelector<HTMLElement>('[data-region="compare-tables-body"]');
  if (!body) return;
  const keyHolder = body.querySelector<HTMLElement>('[data-region="key-picker"]');
  const runBtn = body.querySelector<HTMLButtonElement>('[data-action="run-compare"]');
  const selA = body.querySelector<HTMLSelectElement>('[data-region="table-a"]');
  const selB = body.querySelector<HTMLSelectElement>('[data-region="table-b"]');
  if (!keyHolder || !runBtn || !selA || !selB) return;
  const a = flat.find((f) => f.value === selA.value);
  const b = flat.find((f) => f.value === selB.value);
  if (!a || !b || a.value === b.value) {
    keyHolder.innerHTML = `<p class="compare-tables-hint">Pick two different tables.</p>`;
    runBtn.disabled = true;
    return;
  }
  const candidates = findJoinKeyCandidates(input.assignments, a.source, a.table, b.source, b.table);
  if (candidates.length === 0) {
    keyHolder.innerHTML = `<p class="compare-tables-hint">No shared semantic types between these tables. Accept types on both sides first.</p>`;
    runBtn.disabled = true;
    return;
  }
  const opts = candidates
    .map(
      (c, i) =>
        `<option value="${i}">${escapeHtml(c.typeLabel)} — <code>${escapeHtml(c.columnA)}</code> ↔ <code>${escapeHtml(c.columnB)}</code></option>`,
    )
    .join('');
  keyHolder.innerHTML = `
    <label>
      <span class="compare-tables-label">Join key</span>
      <select data-region="key-select">${opts}</select>
    </label>
  `;
  runBtn.disabled = false;
}

async function runComparison(
  overlay: HTMLElement,
  input: CompareTablesModalInput,
  flat: ReturnType<typeof flattenTables>,
): Promise<void> {
  const body = overlay.querySelector<HTMLElement>('[data-region="compare-tables-body"]');
  if (!body) return;
  const selA = body.querySelector<HTMLSelectElement>('[data-region="table-a"]');
  const selB = body.querySelector<HTMLSelectElement>('[data-region="table-b"]');
  const keySel = body.querySelector<HTMLSelectElement>('[data-region="key-select"]');
  const runBtn = body.querySelector<HTMLButtonElement>('[data-action="run-compare"]');
  const resultEl = body.querySelector<HTMLElement>('[data-region="result"]');
  if (!selA || !selB || !resultEl || !runBtn) return;
  const a = flat.find((f) => f.value === selA.value);
  const b = flat.find((f) => f.value === selB.value);
  if (!a || !b) return;
  const candidates = findJoinKeyCandidates(input.assignments, a.source, a.table, b.source, b.table);
  const chosenIdx = Number(keySel?.value ?? '0');
  const cand = candidates[chosenIdx] ?? candidates[0];
  if (!cand) return;
  runBtn.disabled = true;
  resultEl.innerHTML = `<p class="compare-tables-hint">Comparing…</p>`;
  try {
    const cmp = await input.engine.compareTables(
      a.table.name,
      b.table.name,
      cand.columnA,
      cand.columnB,
    );
    resultEl.innerHTML = renderComparison(a.label, b.label, cand, cmp);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    resultEl.innerHTML = `<p class="compare-tables-error">Comparison failed: ${escapeHtml(msg)}</p>`;
  } finally {
    runBtn.disabled = false;
  }
}

function renderComparison(
  labelA: string,
  labelB: string,
  key: JoinKeyCandidate,
  c: TableComparison,
): string {
  const sample =
    c.differingSample.length === 0
      ? `<p class="compare-tables-hint" data-region="diff-empty">No differing rows in this sample.</p>`
      : `
        <table class="compare-tables-diff">
          <thead><tr><th>Key</th><th>Column</th><th>A</th><th>B</th></tr></thead>
          <tbody>
            ${c.differingSample
              .flatMap((row) =>
                row.diffs.map(
                  (d) => `
                  <tr>
                    <td><code>${escapeHtml(row.key)}</code></td>
                    <td>${escapeHtml(d.column)}</td>
                    <td><code>${escapeHtml(d.valueA ?? '∅')}</code></td>
                    <td><code>${escapeHtml(d.valueB ?? '∅')}</code></td>
                  </tr>
                `,
                ),
              )
              .join('')}
          </tbody>
        </table>
      `;
  return `
    <div class="compare-tables-summary" data-region="summary">
      <div class="compare-tables-summary-line">
        Joined <strong>${escapeHtml(labelA)}</strong> ↔ <strong>${escapeHtml(labelB)}</strong>
        on <code>${escapeHtml(key.columnA)}</code> = <code>${escapeHtml(key.columnB)}</code>
        (${escapeHtml(key.typeLabel)}).
      </div>
      <div class="compare-tables-buckets">
        <span><strong>${c.rowsA.toLocaleString()}</strong> rows in A</span>
        <span><strong>${c.rowsB.toLocaleString()}</strong> rows in B</span>
        <span data-region="only-a">Only in A: <strong>${c.onlyInA.toLocaleString()}</strong></span>
        <span data-region="only-b">Only in B: <strong>${c.onlyInB.toLocaleString()}</strong></span>
        <span data-region="matched">Matched: <strong>${c.matched.toLocaleString()}</strong></span>
        <span data-region="differing">Differing: <strong>${c.differing.toLocaleString()}</strong></span>
      </div>
      <div class="compare-tables-meta">
        Compared columns: ${
          c.comparedColumns.length === 0
            ? '<em>none (no overlap besides the key)</em>'
            : c.comparedColumns.map((s) => `<code>${escapeHtml(s)}</code>`).join(', ')
        }
      </div>
    </div>
    ${sample}
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

let _cssInjected = false;
function injectCompareCss(): void {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement('style');
  style.textContent = COMPARE_CSS;
  document.head.appendChild(style);
}

const COMPARE_CSS = `
.compare-tables-overlay {
  position: fixed; inset: 0;
  background: rgba(31, 27, 22, 0.42);
  display: flex; align-items: center; justify-content: center;
  z-index: 9000;
}
.compare-tables-modal {
  background: var(--surface-card, #FFFCF6);
  color: var(--text-default, #1F1B16);
  border-radius: 8px;
  width: min(720px, calc(100vw - 32px));
  max-height: calc(100vh - 64px);
  display: flex; flex-direction: column;
  box-shadow: 0 16px 48px rgba(31, 27, 22, 0.32);
  overflow: hidden;
}
.compare-tables-header {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-muted, rgba(31, 27, 22, 0.12));
}
.compare-tables-header strong { flex: 1; font-size: 14px; }
.compare-tables-body {
  padding: 16px;
  overflow-y: auto;
  display: flex; flex-direction: column; gap: 12px;
}
.compare-tables-pickers {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
}
.compare-tables-pickers label,
.compare-tables-keys label {
  display: flex; flex-direction: column; gap: 4px;
  font-size: 12px;
}
.compare-tables-pickers select,
.compare-tables-keys select {
  padding: 6px 8px;
  border: 1px solid var(--border-muted, rgba(31, 27, 22, 0.16));
  border-radius: 4px;
  background: var(--surface-card, #FFFCF6);
  font: inherit;
  font-size: 13px;
}
.compare-tables-label {
  color: var(--text-muted, rgba(31, 27, 22, 0.6));
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.compare-tables-controls {
  display: flex; gap: 8px;
}
.compare-tables-controls .btn {
  min-width: 160px;
}
.compare-tables-empty,
.compare-tables-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted, rgba(31, 27, 22, 0.6));
}
.compare-tables-error {
  margin: 0;
  font-size: 12px;
  color: var(--accent-warn, #A8453F);
}
.compare-tables-summary {
  background: rgba(31, 27, 22, 0.04);
  border-radius: 6px;
  padding: 10px 12px;
  display: flex; flex-direction: column; gap: 6px;
  font-size: 12px;
}
.compare-tables-summary-line code,
.compare-tables-summary code,
.compare-tables-meta code,
.compare-tables-diff code {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
  background: rgba(31, 27, 22, 0.06);
  padding: 1px 4px;
  border-radius: 3px;
}
.compare-tables-buckets {
  display: flex; flex-wrap: wrap; gap: 12px;
  font-size: 12px;
}
.compare-tables-buckets strong { font-variant-numeric: tabular-nums; }
.compare-tables-meta {
  font-size: 11px;
  color: var(--text-muted, rgba(31, 27, 22, 0.6));
}
.compare-tables-diff {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.compare-tables-diff th,
.compare-tables-diff td {
  text-align: left;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border-muted, rgba(31, 27, 22, 0.08));
  vertical-align: top;
}
.compare-tables-diff th {
  color: var(--text-muted, rgba(31, 27, 22, 0.6));
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
`;
