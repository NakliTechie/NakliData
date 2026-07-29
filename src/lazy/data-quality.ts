import {
  type DataQualityCheck,
  type SuggestDataQualityInput,
  encodeDataQualityAssertion,
  exportDataQualityContract,
  parseDataQualityAssertion,
  suggestDataQualityChecks,
} from '../core/data-quality.ts';

export interface QualityAssertionSummary {
  id: string;
  name: string | null;
  code: string;
  status: 'idle' | 'running' | 'success' | 'error';
  rowCount: number | null;
  lastError: string | null;
}

export interface DataQualityDialogOptions {
  contractName: string;
  suggestionInput: SuggestDataQualityInput;
  assertions: QualityAssertionSummary[];
  onInsert: (artifact: { name: string; code: string }) => QualityAssertionSummary;
  onRun: (ids: string[]) => Promise<QualityAssertionSummary[]>;
  saveText: (
    text: string,
    suggestedName: string,
    options: { mime: string; description: string; extensions: string[] },
  ) => Promise<string>;
  notify: (message: string) => void;
}

let dialog: HTMLElement | null = null;
let keyHandler: ((event: KeyboardEvent) => void) | null = null;
let previousFocus: HTMLElement | null = null;

export function openDataQualityDialog(options: DataQualityDialogOptions): void {
  if (dialog) return;
  const overlay = document.createElement('div');
  overlay.className = 'schema-graph-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'data-quality-title');
  previousFocus = document.activeElement as HTMLElement | null;
  const suggestions = suggestDataQualityChecks(options.suggestionInput);
  let assertions = [...options.assertions];

  const render = (): void => {
    const existing = taggedAssertions(assertions);
    const existingIds = new Set(existing.map((item) => item.check.id));
    const available = suggestions.filter((check) => !existingIds.has(check.id));
    overlay.innerHTML = `
      <div class="schema-graph-modal" role="document" style="width:min(900px,100%);max-height:min(90vh,900px);display:flex;flex-direction:column;">
        <header class="schema-graph-header">
          <div>
            <h2 id="data-quality-title" style="margin:0;font-size:var(--text-md,15px);">Data quality</h2>
            <p style="margin:3px 0 0;color:var(--text-muted);font-size:11px;">Portable data quality checks · Databricks alias: Expectation · Snowflake alias: DMF / expectation</p>
          </div>
          <button class="btn btn-ghost schema-graph-close" data-action="quality-close" aria-label="Close">×</button>
        </header>
        <div style="padding:var(--space-3) var(--space-4);overflow:auto;display:grid;gap:var(--space-4);">
          <section>
            <div style="display:flex;align-items:center;gap:var(--space-2);">
              <h3 style="margin:0;font-size:var(--text-sm,13px);">Contract checks</h3>
              <span style="font-size:11px;color:var(--text-muted);">${existing.length} saved in assertion cells</span>
              <span style="flex:1;"></span>
              <button class="btn btn-ghost" data-action="quality-export"${existing.length ? '' : ' disabled'}>Save contract</button>
              <button class="btn btn-primary" data-action="quality-run"${existing.length ? '' : ' disabled'}>Run checks</button>
            </div>
            <p style="margin:6px 0;color:var(--text-muted);font-size:11px;">Checks run only when you click Run checks or run their notebook assertion. No monitoring or background polling.</p>
            ${existing.length ? `<ul style="list-style:none;padding:0;margin:0;">${existing.map(renderExisting).join('')}</ul>` : renderEmpty('No contract checks yet. Add a deterministic suggestion below.')}
          </section>
          <section>
            <div style="display:flex;align-items:center;gap:var(--space-2);">
              <h3 style="margin:0;font-size:var(--text-sm,13px);">Deterministic suggestions</h3>
              <span style="font-size:11px;color:var(--text-muted);">${available.length} available</span>
            </div>
            <p style="margin:6px 0;color:var(--text-muted);font-size:11px;">Derived from semantic type constraints, likely grain identifiers, and explicit relationships. Adding a check creates an editable, un-run assertion cell.</p>
            ${available.length ? `<ul style="list-style:none;padding:0;margin:0;">${available.map(renderSuggestion).join('')}</ul>` : renderEmpty('All current suggestions are already in the contract.')}
          </section>
          <div data-region="quality-error" role="alert" style="min-height:16px;color:var(--danger);font-size:11px;"></div>
        </div>
        <footer style="display:flex;justify-content:flex-end;padding:var(--space-3) var(--space-4);border-top:1px solid var(--border);">
          <button class="btn btn-ghost" data-action="quality-close">Close</button>
        </footer>
      </div>
    `;

    for (const button of overlay.querySelectorAll<HTMLElement>('[data-action="quality-close"]')) {
      button.addEventListener('click', closeDataQualityDialog);
    }
    for (const button of overlay.querySelectorAll<HTMLButtonElement>(
      '[data-action="quality-add"]',
    )) {
      button.addEventListener('click', () => {
        const check = suggestions.find((candidate) => candidate.id === button.dataset.checkId);
        if (!check) return;
        try {
          assertions.push(
            options.onInsert({
              name: check.name,
              code: encodeDataQualityAssertion(check),
            }),
          );
          options.notify(`Added data quality check "${check.name}" as an un-run assertion.`);
          render();
        } catch (error) {
          showError(overlay, error);
        }
      });
    }
    overlay
      .querySelector<HTMLButtonElement>('[data-action="quality-export"]')
      ?.addEventListener('click', (event) => {
        const button = event.currentTarget as HTMLButtonElement;
        button.disabled = true;
        const text = exportDataQualityContract(options.contractName, assertions);
        const name = `${portableName(options.contractName) || 'data_quality'}.naklidata-contract.json`;
        void options
          .saveText(text, name, {
            mime: 'application/json',
            description: 'NakliData data quality contract',
            extensions: ['.json'],
          })
          .then((written) => {
            if (written) options.notify(`Saved ${written}.`);
          })
          .catch((error) => showError(overlay, error))
          .finally(() => {
            button.disabled = false;
          });
      });
    overlay
      .querySelector<HTMLButtonElement>('[data-action="quality-run"]')
      ?.addEventListener('click', (event) => {
        const button = event.currentTarget as HTMLButtonElement;
        button.disabled = true;
        button.textContent = 'Running…';
        void options
          .onRun(existing.map((item) => item.assertion.id))
          .then((updated) => {
            const updates = new Map(updated.map((item) => [item.id, item]));
            assertions = assertions.map((item) => updates.get(item.id) ?? item);
            const failed = updated.filter(
              (item) =>
                item.status === 'error' || (item.status === 'success' && item.rowCount !== 0),
            );
            options.notify(
              failed.length
                ? `${failed.length} data quality check${failed.length === 1 ? '' : 's'} failed.`
                : `${updated.length} data quality check${updated.length === 1 ? '' : 's'} passed.`,
            );
            render();
          })
          .catch((error) => {
            showError(overlay, error);
            button.disabled = false;
            button.textContent = 'Run checks';
          });
      });
  };

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeDataQualityDialog();
  });
  keyHandler = (event) => {
    if (event.key === 'Escape') closeDataQualityDialog();
  };
  document.addEventListener('keydown', keyHandler);
  document.body.append(overlay);
  dialog = overlay;
  render();
  overlay.querySelector<HTMLElement>('[data-action="quality-close"]')?.focus();
}

export function closeDataQualityDialog(): void {
  dialog?.remove();
  dialog = null;
  if (keyHandler) {
    document.removeEventListener('keydown', keyHandler);
    keyHandler = null;
  }
  previousFocus?.focus();
  previousFocus = null;
}

function taggedAssertions(assertions: ReadonlyArray<QualityAssertionSummary>): Array<{
  assertion: QualityAssertionSummary;
  check: DataQualityCheck;
}> {
  return assertions.flatMap((assertion) => {
    try {
      const artifact = parseDataQualityAssertion(assertion.code);
      return artifact ? [{ assertion, check: artifact.check }] : [];
    } catch {
      return [];
    }
  });
}

function renderExisting(item: {
  assertion: QualityAssertionSummary;
  check: DataQualityCheck;
}): string {
  const status = statusLabel(item.assertion);
  return `
    <li style="border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-2) var(--space-3);margin-bottom:6px;display:flex;gap:var(--space-3);align-items:flex-start;">
      <div style="flex:1;min-width:0;">
        <div style="display:flex;gap:var(--space-2);align-items:center;">
          <strong style="font-size:12px;">${escapeText(item.check.name)}</strong>
          <code style="font-size:10px;">${escapeText(kindLabel(item.check.kind))}</code>
        </div>
        <p style="margin:4px 0 0;color:var(--text-muted);font-size:11px;">${escapeText(item.check.description)}</p>
      </div>
      <span style="font-size:11px;color:${status.color};white-space:nowrap;">${escapeText(status.label)}</span>
    </li>
  `;
}

function renderSuggestion(check: DataQualityCheck): string {
  return `
    <li style="border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-2) var(--space-3);margin-bottom:6px;display:flex;gap:var(--space-3);align-items:flex-start;">
      <div style="flex:1;min-width:0;">
        <div style="display:flex;gap:var(--space-2);align-items:center;">
          <strong style="font-size:12px;">${escapeText(check.table)}.${escapeText(check.column)}</strong>
          <code style="font-size:10px;">${escapeText(kindLabel(check.kind))}</code>
        </div>
        <p style="margin:4px 0 0;color:var(--text-muted);font-size:11px;">${escapeText(check.description)}</p>
      </div>
      <button class="btn btn-ghost" data-action="quality-add" data-check-id="${escapeAttribute(check.id)}">Add check</button>
    </li>
  `;
}

function statusLabel(assertion: QualityAssertionSummary): { label: string; color: string } {
  if (assertion.status === 'error') {
    return { label: 'ERROR', color: 'var(--danger)' };
  }
  if (assertion.status !== 'success' || assertion.rowCount === null) {
    return {
      label: assertion.status === 'running' ? 'RUNNING' : 'NOT RUN',
      color: 'var(--text-muted)',
    };
  }
  return assertion.rowCount === 0
    ? { label: 'PASS', color: 'var(--success)' }
    : { label: `FAIL · ${assertion.rowCount}`, color: 'var(--danger)' };
}

function kindLabel(kind: DataQualityCheck['kind']): string {
  const labels: Record<DataQualityCheck['kind'], string> = {
    completeness: 'Completeness / not null',
    uniqueness: 'Uniqueness',
    accepted_values: 'Accepted values',
    valid_range: 'Valid range',
    format: 'Format validation',
    referential_validity: 'Referential validity',
    semantic_drift: 'Semantic drift',
  };
  return labels[kind];
}

function renderEmpty(message: string): string {
  return `<p style="margin:var(--space-2) 0 0;padding:var(--space-3);border:1px dashed var(--border);color:var(--text-muted);font-size:11px;">${escapeText(message)}</p>`;
}

function showError(root: HTMLElement, error: unknown): void {
  const region = root.querySelector<HTMLElement>('[data-region="quality-error"]');
  if (region) region.textContent = error instanceof Error ? error.message : String(error);
}

function portableName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9]/, '_$&')
    .slice(0, 64);
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/'/g, '&#39;');
}
