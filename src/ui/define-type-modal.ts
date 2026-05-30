// Define-new-type modal — sidecar wave 3.
//
// Open per column. Shows the column header + samples, a "Suggest with
// sidecar" button that calls the define-type job, an editable
// {id / display_name / category / regex} form, and Save / Cancel.
//
// Save → workbook.addUserType + applies the new type to the column
// (origin = 'user_override' via the existing overrideAssignment path).

import { getEngine } from '../core/engine.ts';
import { loadSettings } from '../core/settings.ts';
import { dispatchJob } from '../core/sidecar/client.ts';
import { SidecarError } from '../core/sidecar/types.ts';
import { type UserType, getWorkbook } from '../core/workbook.ts';
import { iconSvg } from '../tokens/icons.ts';
import { assignmentKey } from './schema-panel.ts';

let _modalEl: HTMLElement | null = null;
let _previouslyFocused: HTMLElement | null = null;
let _onKey: ((ev: KeyboardEvent) => void) | null = null;

export interface OpenDefineTypeOpts {
  sourceId: string;
  tableId: string;
  /** Engine table name for re-sampling values. */
  tableName: string;
  columnName: string;
  sqlType: string;
}

export async function openDefineTypeModal(opts: OpenDefineTypeOpts): Promise<void> {
  if (_modalEl && document.body.contains(_modalEl)) return;
  _previouslyFocused = (document.activeElement as HTMLElement) ?? null;
  const overlay = renderModal(opts);
  document.body.append(overlay);
  _modalEl = overlay;
  // Pre-populate id slot with a snake_case guess from the column name.
  setField(overlay, 'id', defaultIdFromColumn(opts.columnName));
  setField(overlay, 'display_name', humaniseColumn(opts.columnName));
  // Focus the first user-editable field (the id input) so keyboard
  // users can start typing immediately.
  overlay.querySelector<HTMLInputElement>('[data-define-field="id"]')?.focus();
}

export function closeDefineTypeModal(): void {
  if (_modalEl?.parentElement) _modalEl.parentElement.removeChild(_modalEl);
  _modalEl = null;
  if (_onKey) {
    document.removeEventListener('keydown', _onKey);
    _onKey = null;
  }
  _previouslyFocused?.focus();
  _previouslyFocused = null;
}

function defaultIdFromColumn(column: string): string {
  const cleaned = column
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'user_type';
}

function humaniseColumn(column: string): string {
  return column
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function setField(overlay: HTMLElement, name: string, value: string): void {
  const input = overlay.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[data-define-field="${name}"]`,
  );
  if (input) input.value = value;
}

function getField(overlay: HTMLElement, name: string): string {
  const input = overlay.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[data-define-field="${name}"]`,
  );
  return input?.value.trim() ?? '';
}

function renderModal(opts: OpenDefineTypeOpts): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'schema-graph-overlay define-type-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Define new semantic type');
  overlay.dataset.sourceId = opts.sourceId;
  overlay.dataset.tableId = opts.tableId;
  overlay.dataset.tableName = opts.tableName;
  overlay.dataset.column = opts.columnName;
  overlay.dataset.sqlType = opts.sqlType;
  overlay.innerHTML = `
    <div class="schema-graph-modal define-type-modal">
      <div class="schema-graph-header">
        <strong>Define new type — ${escapeHtml(opts.columnName)}</strong>
        <span class="schema-graph-status" data-region="define-status">Edit by hand, or ask the sidecar to suggest.</span>
        <button class="btn btn-ghost schema-graph-close" data-action="close-define-type" aria-label="Close">
          ${iconSvg('x', 14)}
        </button>
      </div>
      <div class="define-type-body">
        <div class="define-type-context">
          <div class="settings-field">
            <span>Column</span>
            <input type="text" value="${escapeHtml(opts.columnName)}" disabled />
          </div>
          <div class="settings-field">
            <span>SQL type</span>
            <input type="text" value="${escapeHtml(opts.sqlType)}" disabled />
          </div>
          <div class="settings-field">
            <span>Sample values (re-sampled from the engine)</span>
            <textarea data-region="define-samples" disabled rows="5"></textarea>
          </div>
        </div>
        <div class="define-type-form">
          <button class="btn btn-primary" data-action="define-suggest">
            ${iconSvg('info', 12)} Suggest with sidecar
          </button>
          <div class="settings-field">
            <span>id (snake_case)</span>
            <input type="text" data-define-field="id" placeholder="employee_id" />
          </div>
          <div class="settings-field">
            <span>display_name</span>
            <input type="text" data-define-field="display_name" placeholder="Employee ID" />
          </div>
          <div class="settings-field">
            <span>category</span>
            <input type="text" data-define-field="category" placeholder="Identifier" />
          </div>
          <div class="settings-field">
            <span>regex</span>
            <textarea data-define-field="regex" rows="2" placeholder="^[A-Z]{2}-[0-9]{6}$"></textarea>
          </div>
          <div class="settings-actions">
            <button class="btn btn-primary" data-action="define-save">Save + apply</button>
            <button class="btn btn-ghost" data-action="close-define-type">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Re-sample column values via the engine and populate the samples textarea.
  void resampleColumn(overlay, opts);

  overlay.addEventListener('click', async (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target === overlay) return closeDefineTypeModal();
    const actionEl = target.closest<HTMLElement>('[data-action]');
    const action = actionEl?.dataset.action;
    if (!action) return;
    if (action === 'close-define-type') return closeDefineTypeModal();
    if (action === 'define-suggest') return runSuggest(overlay, opts);
    if (action === 'define-save') return runSave(overlay, opts);
  });
  // Stash at module scope so closeDefineTypeModal() can detach it
  // regardless of which path closed the modal (X / backdrop / Escape).
  // The previous inline self-removing handler leaked when the user
  // closed via Cancel / X — same bug fixed in schema-graph (W1.11).
  _onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeDefineTypeModal();
  };
  document.addEventListener('keydown', _onKey);
  return overlay;
}

async function resampleColumn(overlay: HTMLElement, opts: OpenDefineTypeOpts): Promise<void> {
  const region = overlay.querySelector<HTMLTextAreaElement>('[data-region="define-samples"]');
  if (!region) return;
  try {
    const stats = await getEngine().sampleColumn(opts.tableName, opts.columnName);
    const samples = stats.values.slice(0, 20);
    region.value = samples.join('\n');
  } catch (err) {
    region.value = `(re-sampling failed: ${err instanceof Error ? err.message : String(err)})`;
  }
}

async function runSuggest(overlay: HTMLElement, opts: OpenDefineTypeOpts): Promise<void> {
  const status = overlay.querySelector<HTMLElement>('[data-region="define-status"]');
  const suggestBtn = overlay.querySelector<HTMLButtonElement>('[data-action="define-suggest"]');
  if (status) status.textContent = 'Asking the sidecar…';
  if (suggestBtn) suggestBtn.disabled = true;
  try {
    const samplesText = overlay.querySelector<HTMLTextAreaElement>(
      '[data-region="define-samples"]',
    );
    const samples = (samplesText?.value ?? '').split('\n').filter((l) => l.trim().length > 0);
    const settings = await loadSettings();
    const result = await dispatchJob(
      {
        kind: 'define-type',
        columnName: opts.columnName,
        sqlType: opts.sqlType,
        samples,
      },
      {
        provider: settings.sidecarProvider,
        model: settings.sidecarModel,
        ...(settings.sidecarProvider === 'custom' && settings.sidecarCustomEndpoint
          ? { customEndpoint: settings.sidecarCustomEndpoint }
          : {}),
      },
    );
    if (result.kind !== 'define-type') throw new Error('Unexpected response kind');
    setField(overlay, 'id', result.suggestion.id);
    setField(overlay, 'display_name', result.suggestion.display_name);
    setField(overlay, 'category', result.suggestion.category);
    setField(overlay, 'regex', result.suggestion.regex);
    if (status) status.textContent = 'Suggestion ready — review and Save, or edit further.';
  } catch (err) {
    const msg =
      err instanceof SidecarError ? err.message : err instanceof Error ? err.message : String(err);
    if (status) status.textContent = `Sidecar: ${msg}`;
  } finally {
    if (suggestBtn) suggestBtn.disabled = false;
  }
}

async function runSave(overlay: HTMLElement, opts: OpenDefineTypeOpts): Promise<void> {
  const status = overlay.querySelector<HTMLElement>('[data-region="define-status"]');
  const id = getField(overlay, 'id');
  const display_name = getField(overlay, 'display_name');
  const category = getField(overlay, 'category');
  const regex = getField(overlay, 'regex');
  if (!id || !display_name || !category || !regex) {
    if (status) status.textContent = 'All four fields are required.';
    return;
  }
  if (!/^[a-z][a-z0-9_]*$/.test(id)) {
    if (status)
      status.textContent =
        'id must be snake_case (lowercase letters, digits, underscores; starts with a letter).';
    return;
  }
  try {
    new RegExp(regex);
  } catch (err) {
    if (status)
      status.textContent = `regex is invalid: ${err instanceof Error ? err.message : String(err)}`;
    return;
  }
  const workbook = getWorkbook();
  // Reject id clashes with existing user types (the workbook would otherwise replace).
  if (workbook.get().userTypes.some((t) => t.id === id)) {
    if (status)
      status.textContent = `A user type with id "${id}" already exists. Pick a different id.`;
    return;
  }
  const userType: UserType = {
    id,
    display_name,
    category,
    regex,
    created: new Date().toISOString(),
    note: `Seeded from ${opts.tableName}.${opts.columnName}`,
  };
  workbook.addUserType(userType);
  // Apply to the column via the existing override path.
  const key = assignmentKey(opts.sourceId, opts.tableId, opts.columnName);
  const a = workbook.get().assignments[key];
  if (a) {
    workbook.setAssignment(key, {
      ...a,
      // Add the user type as a synthetic candidate so the row's UI reflects it.
      candidates: [
        ...a.candidates,
        { typeId: id, displayName: display_name, confidence: 1, evidence: ['user-defined'] },
      ],
      assigned: { typeId: id, origin: 'user_override', confidence: 1 },
    });
  }
  closeDefineTypeModal();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
