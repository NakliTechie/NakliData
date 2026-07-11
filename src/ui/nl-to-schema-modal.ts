// Ask-sidecar-for-a-schema modal — Wave 7 W7.2.
//
// Sidecar Job 10: NL → schema. The user describes a dataset in plain
// English; we ship the description + the known semantic-type vocabulary
// (no row data — there's no data yet); the model returns a typed schema.
// We render it as a reviewable spec (columns × SQL type × semantic type
// × note) and a CREATE TABLE preview. "Insert as CREATE TABLE cell"
// drops the DDL into a new SQL cell, UN-RUN (Hard NOT #4 — the user
// clicks Run).
//
// The bigset "describe-a-dataset" idea, narrowed to schema scaffolding:
// no web scraping, no population, no auto-execute.

import { loadSettings } from '../core/settings.ts';
import { buildCreateTableDdl, dispatchOntologyJob } from '../core/sidecar/ontology-jobs.ts';
import { type NlToSchemaResponse, SidecarError } from '../core/sidecar/types.ts';
import { iconSvg } from '../tokens/icons.ts';
import { restoreModalFocus } from './modal-focus.ts';

let _modalEl: HTMLElement | null = null;
let _previouslyFocused: HTMLElement | null = null;
let _onKey: ((ev: KeyboardEvent) => void) | null = null;
// Last successfully-inferred schema, kept so "Insert" can build the DDL
// from the structured response (not by re-parsing the rendered DOM).
let _lastSchema: NlToSchemaResponse | null = null;

export interface OpenNlToSchemaOpts {
  /** Semantic types the model may map columns to (bundle + user types). */
  knownTypes: Array<{ typeId: string; displayName: string }>;
  /** Called with the generated CREATE TABLE DDL when the user accepts. */
  onInsert: (ddl: string) => void;
}

export function openNlToSchemaModal(opts: OpenNlToSchemaOpts): void {
  if (_modalEl && document.body.contains(_modalEl)) return;
  _previouslyFocused = (document.activeElement as HTMLElement) ?? null;
  _lastSchema = null;
  const overlay = renderModal(opts);
  document.body.append(overlay);
  _modalEl = overlay;
  overlay.querySelector<HTMLTextAreaElement>('[data-nls-field="description"]')?.focus();
}

export function closeNlToSchemaModal(): void {
  if (_modalEl?.parentElement) _modalEl.parentElement.removeChild(_modalEl);
  _modalEl = null;
  _lastSchema = null;
  if (_onKey) {
    document.removeEventListener('keydown', _onKey);
    _onKey = null;
  }
  restoreModalFocus(_previouslyFocused);
  _previouslyFocused = null;
}

function renderModal(opts: OpenNlToSchemaOpts): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'schema-graph-overlay nl-to-schema-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Describe a dataset to infer its schema');
  const typesNote = opts.knownTypes.length
    ? `${opts.knownTypes.length} known semantic types available for mapping`
    : '(no taxonomy loaded — columns will be SQL types only)';
  overlay.innerHTML = `
    <div class="schema-graph-modal nl-to-schema-modal">
      <div class="schema-graph-header">
        <strong>Infer a schema from a description</strong>
        <span class="schema-graph-status" data-region="nls-status" role="status" aria-live="polite">${escapeHtml(typesNote)}</span>
        <button class="btn btn-ghost schema-graph-close" data-action="close-nl-to-schema" aria-label="Close">
          ${iconSvg('x', 14)}
        </button>
      </div>
      <div class="nl-to-schema-body">
        <div class="settings-field">
          <label for="nl-to-schema-desc">Describe the dataset</label>
          <textarea id="nl-to-schema-desc" data-nls-field="description" rows="3" placeholder="Customer support tickets: subject, priority, status, the customer's email, created and resolved timestamps, and the assigned agent"></textarea>
        </div>
        <div class="settings-field">
          <label for="nl-to-schema-name">Table name (optional)</label>
          <input type="text" id="nl-to-schema-name" data-nls-field="tableName" placeholder="support_tickets" />
        </div>
        <div class="settings-actions" style="margin-top:8px;">
          <button class="btn btn-primary" data-action="nls-generate">
            ${iconSvg('info', 12)} Infer schema
          </button>
        </div>
        <div class="settings-field" style="margin-top:12px;">
          <label>Inferred schema (review before inserting)</label>
          <div data-region="nls-result" role="region" aria-live="polite" aria-label="Inferred schema output" class="nls-result-empty">(nothing yet — describe a dataset and click Infer schema)</div>
        </div>
        <div class="settings-actions" style="margin-top:8px;">
          <button class="btn btn-primary" data-action="nls-insert" disabled>Insert as CREATE TABLE cell</button>
          <button class="btn btn-ghost" data-action="close-nl-to-schema">Cancel</button>
        </div>
      </div>
    </div>
  `;
  injectCss();

  overlay.addEventListener('click', async (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target === overlay) return closeNlToSchemaModal();
    const actionEl = target.closest<HTMLElement>('[data-action]');
    const action = actionEl?.dataset.action;
    if (!action) return;
    if (action === 'close-nl-to-schema') return closeNlToSchemaModal();
    if (action === 'nls-generate') return runGenerate(overlay, opts);
    if (action === 'nls-insert') return runInsert(opts);
  });
  _onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeNlToSchemaModal();
  };
  document.addEventListener('keydown', _onKey);
  return overlay;
}

async function runGenerate(overlay: HTMLElement, opts: OpenNlToSchemaOpts): Promise<void> {
  const status = overlay.querySelector<HTMLElement>('[data-region="nls-status"]');
  const generateBtn = overlay.querySelector<HTMLButtonElement>('[data-action="nls-generate"]');
  const insertBtn = overlay.querySelector<HTMLButtonElement>('[data-action="nls-insert"]');
  const result = overlay.querySelector<HTMLElement>('[data-region="nls-result"]');
  const description = (
    overlay.querySelector<HTMLTextAreaElement>('[data-nls-field="description"]')?.value ?? ''
  ).trim();
  const tableName = (
    overlay.querySelector<HTMLInputElement>('[data-nls-field="tableName"]')?.value ?? ''
  ).trim();
  if (!description) {
    if (status) status.textContent = 'Describe the dataset first.';
    return;
  }
  if (status) status.textContent = 'Asking the sidecar…';
  if (generateBtn) generateBtn.disabled = true;
  if (insertBtn) insertBtn.disabled = true;
  _lastSchema = null;
  try {
    const settings = await loadSettings();
    const response = await dispatchOntologyJob(
      {
        kind: 'nl-to-schema',
        description,
        ...(tableName ? { tableName } : {}),
        knownTypes: opts.knownTypes,
      },
      {
        provider: settings.sidecarProvider,
        model: settings.sidecarModel,
        ...(settings.sidecarProvider === 'custom' && settings.sidecarCustomEndpoint
          ? { customEndpoint: settings.sidecarCustomEndpoint }
          : {}),
      },
    );
    if (response.kind !== 'nl-to-schema') throw new Error('Unexpected response kind');
    if (response.columns.length === 0) {
      if (result) {
        result.className = 'nls-result-empty';
        result.textContent =
          'No schema produced. The sidecar returned no usable columns. Try a more concrete description.';
      }
      if (status) status.textContent = 'Sidecar response rejected by the parser.';
      return;
    }
    _lastSchema = response;
    if (result) {
      result.className = '';
      result.innerHTML = renderSchema(response, opts.knownTypes);
    }
    if (insertBtn) insertBtn.disabled = false;
    if (status)
      status.textContent = `Inferred ${response.columns.length} columns via ${settings.sidecarProvider} · ${settings.sidecarModel}.`;
  } catch (err) {
    const msg =
      err instanceof SidecarError ? err.message : err instanceof Error ? err.message : String(err);
    if (status) status.textContent = `Sidecar: ${msg}`;
    if (result) {
      result.className = 'nls-result-empty';
      result.textContent = '(no schema — error)';
    }
  } finally {
    if (generateBtn) generateBtn.disabled = false;
  }
}

function runInsert(opts: OpenNlToSchemaOpts): void {
  if (!_lastSchema) return;
  const ddl = buildCreateTableDdl(_lastSchema);
  if (!ddl) return;
  opts.onInsert(ddl);
  closeNlToSchemaModal();
}

function renderSchema(
  schema: NlToSchemaResponse,
  knownTypes: Array<{ typeId: string; displayName: string }>,
): string {
  const labelFor = (id: string | null): string => {
    if (!id) return '<span class="nls-unmapped">—</span>';
    const display = knownTypes.find((t) => t.typeId === id)?.displayName ?? id;
    return `${escapeHtml(display)} <code>${escapeHtml(id)}</code>`;
  };
  const rows = schema.columns
    .map(
      (c) => `
      <tr>
        <td><code>${escapeHtml(c.name)}</code></td>
        <td class="nls-sqltype">${escapeHtml(c.sqlType)}</td>
        <td>${labelFor(c.semanticTypeId)}</td>
        <td class="nls-note">${escapeHtml(c.description)}</td>
      </tr>`,
    )
    .join('');
  const ddl = buildCreateTableDdl(schema);
  return `
    <div class="nls-table-name"><code>${escapeHtml(schema.tableName)}</code> · ${schema.columns.length} columns</div>
    <table class="nls-schema-table">
      <thead><tr><th>Column</th><th>SQL type</th><th>Semantic type</th><th>Note</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <label class="nls-ddl-label">CREATE TABLE (inserted un-run — click Run yourself)</label>
    <pre class="nls-ddl">${escapeHtml(ddl)}</pre>
  `;
}

function injectCss(): void {
  if (document.getElementById('naklidata-nls-css')) return;
  const tag = document.createElement('style');
  tag.id = 'naklidata-nls-css';
  tag.textContent = `
    .nls-result-empty {
      color: var(--text-muted);
      font-size: 12px;
      background: var(--surface-alt);
      border-radius: 4px;
      padding: 8px 12px;
      min-height: 60px;
    }
    .nls-table-name { font-size: 12px; color: var(--text-muted); margin-bottom: 6px; }
    .nls-schema-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-bottom: 12px;
    }
    .nls-schema-table th {
      text-align: left;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      padding: 4px 8px;
      border-bottom: 1px solid var(--border);
    }
    .nls-schema-table td {
      padding: 4px 8px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    .nls-schema-table code {
      font-family: var(--font-mono);
      font-size: 11px;
    }
    .nls-sqltype { color: var(--text-muted); text-transform: lowercase; }
    .nls-note { color: var(--text-muted); }
    .nls-unmapped { color: var(--text-muted); }
    .nls-ddl-label {
      display: block;
      font-size: 11px;
      color: var(--text-muted);
      margin-bottom: 4px;
    }
    .nls-ddl {
      white-space: pre-wrap;
      font-family: var(--font-mono);
      font-size: 12px;
      background: var(--surface-alt);
      border-left: 3px solid var(--accent);
      padding: 8px 12px;
      border-radius: 4px;
      margin: 0;
    }
  `;
  document.head.appendChild(tag);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
