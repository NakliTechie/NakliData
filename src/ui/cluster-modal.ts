// Resolve track M1 — clustering / fuzzy-merge modal.
//
// Detect variant spellings of a column's values and emit an additive
// CASE-rewrite SQL cell (`<col>__merged`) the user runs (Hard NOT #4). Two
// methods (key collision default, nearest neighbour opt-in); per-cluster
// editable canonical + accept/reject (rejected dim, not hidden); optional
// "Ask AI" affordance for borderline pairs (only when a provider is set).
// All compute + injection-safety lives in core/clustering.ts — this file is
// DOM only and assembles clusters with explicit canonicals (it never re-runs
// a user/AI-curated cluster through the deterministic canonical picker).

import {
  type Cluster,
  type ClusterMethod,
  NN_DEFAULT_THRESHOLD,
  NN_MAX_THRESHOLD,
  NN_MIN_THRESHOLD,
  type ValueCount,
  borderlinePairs,
  buildMergeCaseSql,
  cluster as runCluster,
} from '../core/clustering.ts';
import { iconSvg } from '../tokens/icons.ts';
import { restoreModalFocus } from './modal-focus.ts';

/** One validated AI merge decision (shape of a propose-merge response pair). */
export interface AiMergeDecision {
  a: string;
  b: string;
  merge: boolean;
  canonical: string;
}

export interface ClusterModalDescriptor {
  /** Columns the user can cluster (result columns, or a table's columns). */
  columns: ReadonlyArray<string>;
  /** Preselected column (the clicked one). */
  initialColumn: string;
  /** Upstream SQL wrapped as the CASE cell's subquery. */
  upstreamSql: string;
  /** Show the "Ask AI" affordance only when a sidecar provider is configured. */
  aiAvailable: boolean;
}

export interface ClusterModalCallbacks {
  /** Run the GROUP BY for a column → distinct values + row counts. */
  fetchValues: (column: string) => Promise<ValueCount[]>;
  /** Insert the emitted CASE SQL as a new cell. */
  onInsert: (sql: string) => void;
  /** Adjudicate borderline pairs via the sidecar (job #8). Returns decisions. */
  onAskAi?: (
    pairs: ReadonlyArray<{ a: string; b: string; aCount: number; bCount: number }>,
  ) => Promise<AiMergeDecision[]>;
}

interface ClusterRow {
  canonical: string;
  values: ValueCount[];
  accepted: boolean;
  /** Surfaced when the row came from the AI affordance rather than the deterministic pass. */
  fromAi: boolean;
}

let _modalEl: HTMLElement | null = null;
let _onKey: ((ev: KeyboardEvent) => void) | null = null;
let _prevFocus: HTMLElement | null = null;
let _desc: ClusterModalDescriptor | null = null;
let _cb: ClusterModalCallbacks | null = null;
let _column = '';
let _method: ClusterMethod = 'key-collision';
let _threshold = NN_DEFAULT_THRESHOLD;
let _values: ValueCount[] = [];
let _rows: ClusterRow[] = [];
let _tooMany = false;
let _busy = false;

export function openClusterModal(desc: ClusterModalDescriptor, cb: ClusterModalCallbacks): void {
  if (_modalEl) return;
  _desc = desc;
  _cb = cb;
  _column = desc.initialColumn || desc.columns[0] || '';
  _method = 'key-collision';
  _threshold = NN_DEFAULT_THRESHOLD;
  _values = [];
  _rows = [];
  _tooMany = false;
  _busy = true;
  _prevFocus = (document.activeElement as HTMLElement) ?? null;
  const overlay = renderOverlay();
  document.body.append(overlay);
  _modalEl = overlay;
  _onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeClusterModal();
  };
  document.addEventListener('keydown', _onKey);
  void fetchAndRecompute();
}

export function closeClusterModal(): void {
  if (_modalEl?.parentElement) _modalEl.parentElement.removeChild(_modalEl);
  _modalEl = null;
  if (_onKey) {
    document.removeEventListener('keydown', _onKey);
    _onKey = null;
  }
  restoreModalFocus(_prevFocus);
  _prevFocus = null;
  _desc = null;
  _cb = null;
  _values = [];
  _rows = [];
}

// ── State transitions ───────────────────────────────────────────────────

async function fetchAndRecompute(): Promise<void> {
  if (!_cb) return;
  _busy = true;
  rebuild();
  try {
    _values = await _cb.fetchValues(_column);
  } catch (e) {
    _values = [];
    toastBridge(`Couldn't read values: ${e instanceof Error ? e.message : String(e)}`);
  }
  _busy = false;
  recompute();
  rebuild();
}

function recompute(): void {
  const { clusters, tooMany } = runCluster(_values, _method, _threshold);
  _tooMany = tooMany;
  _rows = clusters.map((c) => clusterToRow(c, false));
}

function clusterToRow(c: Cluster, fromAi: boolean): ClusterRow {
  return { canonical: c.canonical, values: c.values, accepted: true, fromAi };
}

/** Accepted rows → Clusters for the emitter (canonical taken verbatim from the row). */
function acceptedClusters(): Cluster[] {
  return _rows
    .filter((r) => r.accepted && r.canonical.trim() !== '')
    .map((r) => ({ canonical: r.canonical, values: r.values }));
}

function previewSql(): string {
  if (!_desc) return '';
  return buildMergeCaseSql(_column, acceptedClusters(), _desc.upstreamSql, {
    aliasSuffix: pickSuffix(),
  });
}

/** A merged-column alias suffix that doesn't collide with an existing column. */
function pickSuffix(): string {
  const existing = new Set(_desc?.columns ?? []);
  if (!existing.has(`${_column}__merged`)) return '__merged';
  for (let i = 2; i < 50; i++) {
    if (!existing.has(`${_column}__merged_${i}`)) return `__merged_${i}`;
  }
  return '__merged';
}

async function handleAskAi(): Promise<void> {
  if (!_cb?.onAskAi) return;
  const pairs = borderlinePairs(_values, _threshold);
  if (pairs.length === 0) {
    toastBridge(
      'No borderline pairs to check — the deterministic pass already grouped what it could.',
    );
    return;
  }
  _busy = true;
  rebuild();
  try {
    const decisions = await _cb.onAskAi(pairs);
    foldAiDecisions(decisions);
  } catch (e) {
    toastBridge(`AI check failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  _busy = false;
  rebuild();
}

/** Fold accepted (merge=true) AI decisions in as new, user-reviewable clusters. */
function foldAiDecisions(decisions: ReadonlyArray<AiMergeDecision>): void {
  const countOf = (v: string): number => _values.find((x) => x.value === v)?.count ?? 0;
  let added = 0;
  for (const d of decisions) {
    if (!d.merge) continue;
    // Skip if either value is already shown in a row (avoid duplicate arms).
    const shown = new Set(_rows.flatMap((r) => r.values.map((v) => v.value)));
    if (shown.has(d.a) || shown.has(d.b)) continue;
    _rows.push({
      canonical: d.canonical,
      values: [
        { value: d.a, count: countOf(d.a) },
        { value: d.b, count: countOf(d.b) },
      ],
      accepted: true,
      fromAi: true,
    });
    added++;
  }
  toastBridge(
    added > 0
      ? `AI proposed ${added} additional merge${added === 1 ? '' : 's'} — review below.`
      : 'AI found no additional merges among the borderline pairs.',
  );
}

// ── Rendering ───────────────────────────────────────────────────────────

function rebuild(): void {
  if (!_modalEl) return;
  const fresh = renderOverlay();
  _modalEl.replaceWith(fresh);
  _modalEl = fresh;
}

function renderOverlay(): HTMLElement {
  const desc = _desc as ClusterModalDescriptor;
  const overlay = document.createElement('div');
  overlay.className = 'schema-graph-overlay cluster-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'cluster-title');

  const colOptions = desc.columns
    .map(
      (c) =>
        `<option value="${escapeAttr(c)}" ${c === _column ? 'selected' : ''}>${escapeHtml(c)}</option>`,
    )
    .join('');

  const thresholdPct = Math.round(_threshold * 100);
  const sliderRow =
    _method === 'nearest-neighbour'
      ? `<label style="font-size:12px;display:flex;align-items:center;gap:8px;margin-top:6px;">
           Similarity ≥ <strong>${thresholdPct}%</strong>
           <input type="range" data-region="cl-threshold" min="${Math.round(NN_MIN_THRESHOLD * 100)}" max="${Math.round(NN_MAX_THRESHOLD * 100)}" value="${thresholdPct}" style="flex:1;" />
         </label>`
      : '';

  overlay.innerHTML = `
    <div class="schema-graph-modal cluster-modal" role="document"
         style="width:min(680px,100%);height:auto;max-height:min(88vh,760px);display:flex;flex-direction:column;">
      <header class="schema-graph-header">
        <h2 id="cluster-title" style="margin:0;font-size:var(--text-md,15px);display:flex;align-items:center;gap:6px;">
          ${iconSvg('search', 14)} Cluster values
        </h2>
        <button class="btn btn-ghost schema-graph-close" data-action="cl-close" aria-label="Close" style="margin-left:auto;">${iconSvg('x', 14)}</button>
      </header>
      <div style="padding:var(--space-3) var(--space-4);overflow:auto;flex:1;min-height:0;">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;">
          <label style="font-size:12px;">Column
            <select data-region="cl-column" style="display:block;margin-top:2px;min-width:160px;">${colOptions}</select></label>
          <div class="cl-method" role="group" aria-label="Method" style="display:inline-flex;gap:2px;">
            <button class="btn btn-ghost ${_method === 'key-collision' ? 'is-active' : ''}" data-action="cl-method-key" aria-pressed="${_method === 'key-collision'}" style="font-size:11px;" title="Fingerprint: case/punctuation/word-order variants">Key collision</button>
            <button class="btn btn-ghost ${_method === 'nearest-neighbour' ? 'is-active' : ''}" data-action="cl-method-nn" aria-pressed="${_method === 'nearest-neighbour'}" style="font-size:11px;" title="Edit distance: catch typos (opt-in)">Nearest neighbour</button>
          </div>
        </div>
        ${sliderRow}
        <div data-region="cl-list" style="margin-top:var(--space-3);">${renderListBody()}</div>
        <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin:var(--space-3) 0 var(--space-1) 0;">Preview</h3>
        <pre data-region="cl-preview" style="white-space:pre-wrap;font-family:var(--font-mono);background:var(--surface-alt);border-left:3px solid var(--accent);padding:8px 12px;border-radius:4px;font-size:11px;margin:0;max-height:180px;overflow:auto;">${escapeHtml(previewSql())}</pre>
      </div>
      <footer style="display:flex;gap:var(--space-2);align-items:center;justify-content:flex-end;padding:var(--space-3) var(--space-4);border-top:1px solid var(--border);">
        ${
          desc.aiAvailable
            ? `<button class="btn btn-ghost" data-action="cl-ask-ai" ${_busy ? 'disabled' : ''} style="margin-right:auto;" title="Ask the sidecar to check borderline pairs the deterministic pass didn't group">${iconSvg('info', 12)} Ask AI to check ambiguous pairs</button>`
            : ''
        }
        <button class="btn btn-ghost" data-action="cl-close">Cancel</button>
        <button class="btn btn-primary" data-action="cl-insert" ${_busy ? 'disabled' : ''}>Insert as SQL cell</button>
      </footer>
    </div>
  `;

  wireOverlay(overlay);
  return overlay;
}

function renderListBody(): string {
  if (_busy) {
    return `<p style="font-size:12px;color:var(--text-muted);">Computing clusters…</p>`;
  }
  if (_tooMany) {
    return `<p style="font-size:12px;color:var(--warning);">Too many distinct values for nearest-neighbour — switch to key collision.</p>`;
  }
  if (_rows.length === 0) {
    const hint =
      _method === 'key-collision'
        ? 'No variants detected — try nearest neighbour to catch typos.'
        : 'No variants at this threshold — lower the similarity slider.';
    return `<p style="font-size:12px;color:var(--text-muted);">${escapeHtml(hint)}</p>`;
  }
  const rows = _rows
    .map((r, i) => {
      const variants = r.values
        .map(
          (v) =>
            `<span class="cl-variant" style="display:inline-flex;gap:3px;align-items:baseline;background:var(--surface-alt);border-radius:3px;padding:1px 6px;font-size:11px;">${escapeHtml(v.value)} <span style="color:var(--text-muted);">×${v.count}</span></span>`,
        )
        .join(' ');
      return `
      <div class="cl-row" data-idx="${i}" style="border:1px solid var(--border);border-radius:5px;padding:8px 10px;margin-bottom:8px;${r.accepted ? '' : 'opacity:.5;'}">
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="checkbox" data-region="cl-accept" data-idx="${i}" ${r.accepted ? 'checked' : ''} aria-label="Accept cluster ${i + 1}" />
          <label style="font-size:11px;color:var(--text-muted);">Canonical
            <input type="text" data-region="cl-canonical" data-idx="${i}" value="${escapeAttr(r.canonical)}" style="display:block;margin-top:2px;font-size:12px;min-width:220px;" /></label>
          ${r.fromAi ? `<span style="font-size:10px;color:var(--accent);text-transform:uppercase;letter-spacing:.05em;">AI</span>` : ''}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">${variants}</div>
      </div>`;
    })
    .join('');
  const accepted = _rows.filter((r) => r.accepted).length;
  return `<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">${_rows.length} cluster${_rows.length === 1 ? '' : 's'} found · ${accepted} accepted</div>${rows}`;
}

function wireOverlay(overlay: HTMLElement): void {
  overlay.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target === overlay || target.closest('[data-action="cl-close"]'))
      return closeClusterModal();
    if (target.closest('[data-action="cl-method-key"]')) {
      _method = 'key-collision';
      recompute();
      return rebuild();
    }
    if (target.closest('[data-action="cl-method-nn"]')) {
      _method = 'nearest-neighbour';
      recompute();
      return rebuild();
    }
    if (target.closest('[data-action="cl-ask-ai"]')) return void handleAskAi();
    if (target.closest('[data-action="cl-insert"]')) return handleInsert();
  });

  overlay.addEventListener('change', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target.matches('[data-region="cl-column"]')) {
      _column = (target as HTMLSelectElement).value;
      return void fetchAndRecompute();
    }
    if (target.matches('[data-region="cl-accept"]')) {
      const idx = Number((target as HTMLElement).dataset.idx);
      const row = _rows[idx];
      if (row) row.accepted = (target as HTMLInputElement).checked;
      return rebuild();
    }
  });

  overlay.addEventListener('input', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target.matches('[data-region="cl-threshold"]')) {
      _threshold = Number((target as HTMLInputElement).value) / 100;
      recompute();
      return rebuild();
    }
    if (target.matches('[data-region="cl-canonical"]')) {
      const idx = Number((target as HTMLElement).dataset.idx);
      const row = _rows[idx];
      if (row) row.canonical = (target as HTMLInputElement).value;
      // Surgical preview update — keep input focus.
      const preview = _modalEl?.querySelector<HTMLElement>('[data-region="cl-preview"]');
      if (preview) preview.textContent = previewSql();
    }
  });
}

function handleInsert(): void {
  if (!_cb) return;
  const accepted = acceptedClusters();
  if (accepted.length === 0) {
    toastBridge('No accepted clusters — nothing to merge. Accept at least one, or Cancel.');
    return;
  }
  _cb.onInsert(previewSql());
  closeClusterModal();
}

/** Surface a message via the app's window-event toast bridge (cells can't import the local toast). */
function toastBridge(message: string): void {
  window.dispatchEvent(new CustomEvent('naklidata:toast', { detail: { message } }));
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
