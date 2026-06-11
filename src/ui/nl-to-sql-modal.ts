// Ask-sidecar-in-natural-language modal — Wave 5 W5.1.
//
// Sidecar Job 5: NL → SQL. The user types a question; we ship the
// workbook schema (tables + columns) to the configured provider; the
// generated SQL is previewed in a read-only block; clicking
// "Insert as new SQL cell" creates a new SQL cell with the code
// pre-filled. We never auto-execute (Hard NOT #4 — the user clicks
// Run).
//
// Privacy posture: no row data is shipped. Just table names + column
// names + the user's question.

import { loadSettings } from '../core/settings.ts';
import { dispatchJob } from '../core/sidecar/client.ts';
import { SidecarError } from '../core/sidecar/types.ts';
import { iconSvg } from '../tokens/icons.ts';
import { restoreModalFocus } from './modal-focus.ts';

let _modalEl: HTMLElement | null = null;
let _previouslyFocused: HTMLElement | null = null;
let _onKey: ((ev: KeyboardEvent) => void) | null = null;

export interface OpenNlToSqlOpts {
  /** Workbook schema — list of `{ table, columns }` shipped to the sidecar. */
  tables: Array<{ name: string; columns: string[] }>;
  /** Called when the user accepts the generated SQL. Receives the SQL
   *  body; caller is expected to insert it as a new cell + focus it. */
  onInsert: (sql: string) => void;
}

export function openNlToSqlModal(opts: OpenNlToSqlOpts): void {
  if (_modalEl && document.body.contains(_modalEl)) return;
  _previouslyFocused = (document.activeElement as HTMLElement) ?? null;
  let overlay: HTMLElement | null = null;
  try {
    overlay = renderModal(opts);
    document.body.append(overlay);
    _modalEl = overlay;
    // Focus the question textarea so keyboard users can type immediately.
    overlay.querySelector<HTMLTextAreaElement>('[data-nl-field="question"]')?.focus();
  } catch (err) {
    // A half-opened modal leaks the keydown listener renderModal()
    // registered AND strands the `_modalEl` singleton, which would block
    // every future open. Tear down on failure (forward-pass H16).
    if (overlay?.parentElement) overlay.parentElement.removeChild(overlay);
    _modalEl = null;
    if (_onKey) {
      document.removeEventListener('keydown', _onKey);
      _onKey = null;
    }
    restoreModalFocus(_previouslyFocused);
    _previouslyFocused = null;
    throw err;
  }
}

export function closeNlToSqlModal(): void {
  if (_modalEl?.parentElement) _modalEl.parentElement.removeChild(_modalEl);
  _modalEl = null;
  if (_onKey) {
    document.removeEventListener('keydown', _onKey);
    _onKey = null;
  }
  restoreModalFocus(_previouslyFocused);
  _previouslyFocused = null;
}

function renderModal(opts: OpenNlToSqlOpts): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'schema-graph-overlay nl-to-sql-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Ask the sidecar to write SQL');
  const tableSummary = opts.tables.length
    ? opts.tables.map((t) => `${t.name} (${t.columns.length} cols)`).join(' · ')
    : '(no tables mounted yet — mount one first)';
  overlay.innerHTML = `
    <div class="schema-graph-modal nl-to-sql-modal">
      <div class="schema-graph-header">
        <strong>Ask the sidecar to write SQL</strong>
        <span class="schema-graph-status" data-region="nl-status" role="status" aria-live="polite">${escapeHtml(tableSummary)}</span>
        <button class="btn btn-ghost schema-graph-close" data-action="close-nl-to-sql" aria-label="Close">
          ${iconSvg('x', 14)}
        </button>
      </div>
      <div class="nl-to-sql-body">
        <div class="settings-field">
          <label for="nl-to-sql-question">Question</label>
          <textarea id="nl-to-sql-question" data-nl-field="question" rows="3" placeholder="Top vendors by total amount last quarter"></textarea>
        </div>
        <div class="settings-actions" style="margin-top:8px;">
          <button class="btn btn-primary" data-action="nl-generate" ${opts.tables.length === 0 ? 'disabled' : ''}>
            ${iconSvg('info', 12)} Generate SQL
          </button>
        </div>
        <div class="settings-field" style="margin-top:12px;">
          <label for="nl-to-sql-result">Generated SQL (review before running)</label>
          <pre id="nl-to-sql-result" data-region="nl-result" role="region" aria-live="polite" aria-label="Generated SQL output" style="white-space:pre-wrap;font-family:var(--font-mono);background:var(--surface-alt);border-left:3px solid var(--accent);padding:8px 12px;border-radius:4px;min-height:80px;margin:0;">(nothing yet — click Generate)</pre>
        </div>
        <div class="settings-actions" style="margin-top:8px;">
          <button class="btn btn-primary" data-action="nl-insert" disabled>Insert as new SQL cell</button>
          <button class="btn btn-ghost" data-action="close-nl-to-sql">Cancel</button>
        </div>
      </div>
    </div>
  `;

  overlay.addEventListener('click', async (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target === overlay) return closeNlToSqlModal();
    const actionEl = target.closest<HTMLElement>('[data-action]');
    const action = actionEl?.dataset.action;
    if (!action) return;
    if (action === 'close-nl-to-sql') return closeNlToSqlModal();
    if (action === 'nl-generate') return runGenerate(overlay, opts);
    if (action === 'nl-insert') return runInsert(overlay, opts);
  });
  _onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeNlToSqlModal();
  };
  document.addEventListener('keydown', _onKey);
  return overlay;
}

async function runGenerate(overlay: HTMLElement, opts: OpenNlToSqlOpts): Promise<void> {
  const status = overlay.querySelector<HTMLElement>('[data-region="nl-status"]');
  const generateBtn = overlay.querySelector<HTMLButtonElement>('[data-action="nl-generate"]');
  const insertBtn = overlay.querySelector<HTMLButtonElement>('[data-action="nl-insert"]');
  const result = overlay.querySelector<HTMLElement>('[data-region="nl-result"]');
  const question = (
    overlay.querySelector<HTMLTextAreaElement>('[data-nl-field="question"]')?.value ?? ''
  ).trim();
  if (!question) {
    if (status) status.textContent = 'Type a question first.';
    return;
  }
  if (status) status.textContent = 'Asking the sidecar…';
  if (generateBtn) generateBtn.disabled = true;
  if (insertBtn) insertBtn.disabled = true;
  try {
    const settings = await loadSettings();
    const response = await dispatchJob(
      {
        kind: 'nl-to-sql',
        question,
        tables: opts.tables,
        dialect: 'duckdb',
      },
      {
        provider: settings.sidecarProvider,
        model: settings.sidecarModel,
        ...(settings.sidecarProvider === 'custom' && settings.sidecarCustomEndpoint
          ? { customEndpoint: settings.sidecarCustomEndpoint }
          : {}),
      },
    );
    if (response.kind !== 'nl-to-sql') throw new Error('Unexpected response kind');
    if (!response.sql) {
      // Parser dropped the response (write statement, unknown table, junk, …).
      if (result)
        result.textContent =
          'No SQL produced. The sidecar emitted a write/DDL statement, referenced unknown tables, or returned junk. Try rephrasing.';
      if (status) status.textContent = 'Sidecar response rejected by the safety parser.';
      return;
    }
    if (result) result.textContent = response.sql;
    if (insertBtn) insertBtn.disabled = false;
    if (status)
      status.textContent = `Generated via ${settings.sidecarProvider} · ${settings.sidecarModel} — review before running.`;
  } catch (err) {
    const msg =
      err instanceof SidecarError ? err.message : err instanceof Error ? err.message : String(err);
    if (status) status.textContent = `Sidecar: ${msg}`;
    if (result) result.textContent = '(no SQL — error)';
  } finally {
    if (generateBtn) generateBtn.disabled = false;
  }
}

function runInsert(overlay: HTMLElement, opts: OpenNlToSqlOpts): void {
  const result = overlay.querySelector<HTMLElement>('[data-region="nl-result"]');
  const sql = result?.textContent ?? '';
  if (!sql || sql.startsWith('(')) return;
  opts.onInsert(sql);
  closeNlToSqlModal();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
