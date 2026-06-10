// M1 — Anonymized Export dialog.
//
// Per-column strategy override + salt display/override + Export click.
// Returns the finalised AnonColumnPlan[] + salt, or null on Cancel.
// Self-contained: own overlay, own keydown listener, focus restored
// via the shared `restoreModalFocus` helper.

import { iconSvg } from '../../tokens/icons.ts';
import { restoreModalFocus } from '../modal-focus.ts';
import type { AnonColumnPlan, AnonStrategy } from './anonymize.ts';

let _modalEl: HTMLElement | null = null;
let _onKey: ((ev: KeyboardEvent) => void) | null = null;

export interface AnonymizeModalResult {
  plan: AnonColumnPlan[];
  salt: string;
  /** Whether the user pasted a custom salt instead of accepting the
   *  generated one. Recorded in the manifest's `saltUsed` flag context. */
  saltOrigin: 'generated' | 'pasted';
}

const STRATEGY_OPTIONS: ReadonlyArray<{ value: AnonStrategy; label: string; hint: string }> = [
  { value: 'keep', label: 'Keep (verbatim)', hint: 'Column appears unchanged in the export.' },
  {
    value: 'hash',
    label: 'Hash',
    hint: 'md5(value || salt) — irreversible without the salt.',
  },
  {
    value: 'redact',
    label: 'Redact',
    hint: 'Replace every value with the literal "[REDACTED]".',
  },
  {
    value: 'bucket',
    label: 'Bucket (generalise)',
    hint: 'Numerics floor to nearest 100; dates truncate to month.',
  },
  { value: 'drop', label: 'Drop (omit column)', hint: 'Column is excluded from the export.' },
];

export function openAnonymizeModal(opts: {
  initialPlan: AnonColumnPlan[];
  generatedSalt: string;
}): Promise<AnonymizeModalResult | null> {
  return new Promise((resolve) => {
    if (_modalEl) {
      resolve(null);
      return;
    }
    const previouslyFocused = (document.activeElement as HTMLElement) ?? null;
    // Mutable working copy of the plan; the modal's selects mutate this
    // before resolving.
    const plan: AnonColumnPlan[] = opts.initialPlan.map((c) => ({ ...c }));
    let salt = opts.generatedSalt;
    let saltOrigin: 'generated' | 'pasted' = 'generated';

    const overlay = renderModal(plan, salt);
    document.body.append(overlay);
    _modalEl = overlay;

    const close = (result: AnonymizeModalResult | null): void => {
      if (_modalEl?.parentElement) _modalEl.parentElement.removeChild(_modalEl);
      _modalEl = null;
      if (_onKey) {
        document.removeEventListener('keydown', _onKey);
        _onKey = null;
      }
      restoreModalFocus(previouslyFocused);
      resolve(result);
    };

    overlay.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      if (target === overlay) return close(null);
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'anon-cancel') return close(null);
      if (action === 'anon-export') {
        return close({ plan, salt, saltOrigin });
      }
      if (action === 'anon-copy-salt') {
        try {
          void navigator.clipboard?.writeText(salt);
          const btn = overlay.querySelector<HTMLButtonElement>('[data-action="anon-copy-salt"]');
          if (btn) {
            const orig = btn.textContent ?? '';
            btn.textContent = 'Copied!';
            setTimeout(() => {
              btn.textContent = orig;
            }, 1500);
          }
        } catch {
          /* clipboard may be unavailable in test contexts; non-fatal */
        }
      }
      if (action === 'anon-regen-salt') {
        // Re-generate locally; matches generateSalt() in anonymize.ts.
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        let hex = '';
        for (let i = 0; i < bytes.length; i++) hex += (bytes[i] ?? 0).toString(16).padStart(2, '0');
        salt = hex;
        saltOrigin = 'generated';
        const saltInput = overlay.querySelector<HTMLInputElement>('[data-region="anon-salt"]');
        if (saltInput) saltInput.value = salt;
      }
    });
    overlay.addEventListener('change', (ev) => {
      const target = ev.target as HTMLSelectElement | HTMLInputElement | null;
      if (!target) return;
      if (
        target instanceof HTMLSelectElement &&
        target.dataset.action === 'anon-strategy' &&
        target.dataset.column
      ) {
        const col = plan.find((c) => c.columnName === target.dataset.column);
        if (col) col.strategy = target.value as AnonStrategy;
      }
      if (target instanceof HTMLInputElement && target.dataset.region === 'anon-salt') {
        // User pasted / typed a custom salt. Validate hex-only.
        const v = target.value.trim();
        if (/^[0-9a-fA-F]+$/.test(v) && v.length >= 8) {
          salt = v;
          saltOrigin = 'pasted';
        }
      }
    });

    _onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') close(null);
    };
    document.addEventListener('keydown', _onKey);

    // Focus Cancel by default — Enter-dismiss is safe, the dangerous
    // action (Export) requires intent.
    overlay.querySelector<HTMLElement>('[data-action="anon-cancel"]')?.focus();
  });
}

function renderModal(plan: AnonColumnPlan[], salt: string): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'schema-graph-overlay anonymize-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'anon-title');

  const badgedCount = plan.filter((p) => p.sensitivity && p.sensitivity !== 'public').length;
  const rowsHtml = plan
    .map((col) => {
      const badge = col.sensitivity ? sensitivityBadge(col.sensitivity) : '';
      const typeLabel = col.typeId
        ? `<span class="anon-type">${escapeHtml(col.typeId)}</span>`
        : '';
      const options = STRATEGY_OPTIONS.map(
        (o) =>
          `<option value="${o.value}" ${o.value === col.strategy ? 'selected' : ''} title="${escapeHtml(o.hint)}">${escapeHtml(o.label)}</option>`,
      ).join('');
      return `
        <li class="anon-row">
          <div class="anon-row-head">
            <span class="anon-colname">${escapeHtml(col.columnName)}</span>
            ${badge}
            ${typeLabel}
          </div>
          <select data-action="anon-strategy" data-column="${escapeHtml(col.columnName)}" aria-label="Strategy for ${escapeHtml(col.columnName)}">
            ${options}
          </select>
        </li>`;
    })
    .join('');

  const noBadgesNote =
    badgedCount === 0
      ? `<p class="anon-empty-note">No columns are badged sensitive in this result. You can still anonymise any column by changing its strategy below — or cancel and use the regular CSV/Parquet sink to export verbatim.</p>`
      : `<p class="anon-empty-note">${badgedCount} column${badgedCount === 1 ? '' : 's'} ${badgedCount === 1 ? 'is' : 'are'} badged sensitive by the taxonomy. Default strategies are pre-selected; change any below.</p>`;

  overlay.innerHTML = `
    <div class="schema-graph-modal anonymize-modal" role="document" style="width:min(720px,100%);height:auto;max-height:min(85vh,820px);">
      <header class="schema-graph-header">
        <h2 id="anon-title" style="margin:0;font-size:var(--text-md,15px);display:flex;align-items:center;gap:6px;">${iconSvg('warning', 14)} Export anonymized</h2>
      </header>
      <div class="anon-body" style="padding:var(--space-4) var(--space-5);overflow:auto;flex:1;min-height:0;">
        ${noBadgesNote}
        <div class="anon-salt-row">
          <label>
            <span>Per-export salt (hex)</span>
            <input type="text" data-region="anon-salt" value="${escapeHtml(salt)}" autocomplete="off" spellcheck="false" />
          </label>
          <button class="btn btn-ghost" data-action="anon-copy-salt" title="Copy salt to clipboard — save this if you want to re-run with the same hashed values later">Copy</button>
          <button class="btn btn-ghost" data-action="anon-regen-salt" title="Generate a new random salt">Regenerate</button>
        </div>
        <p class="anon-salt-note">The salt is never persisted — save it now if you want a same-hash re-export later. Empty / short / non-hex pastes are ignored.</p>
        <ul class="anon-list">${rowsHtml}</ul>
      </div>
      <footer style="display:flex;gap:var(--space-2);justify-content:flex-end;padding:var(--space-3) var(--space-5);border-top:1px solid var(--border);">
        <button class="btn btn-ghost" data-action="anon-cancel">Cancel</button>
        <button class="btn btn-primary" data-action="anon-export">Export anonymized</button>
      </footer>
    </div>
  `;
  return overlay;
}

function sensitivityBadge(s: NonNullable<AnonColumnPlan['sensitivity']>): string {
  // Badge colours match the schema-panel convention; not theming-aware
  // here to keep the modal CSS-self-contained.
  const map: Record<typeof s, { bg: string; fg: string; label: string }> = {
    pii: { bg: '#fee2e2', fg: '#991b1b', label: 'PII' },
    financial: { bg: '#fef3c7', fg: '#92400e', label: 'Financial' },
    secret: { bg: '#fce7f3', fg: '#9d174d', label: 'Secret' },
    public: { bg: '#e0e7ff', fg: '#1e40af', label: 'Public' },
  };
  const m = map[s];
  return `<span class="anon-badge" style="background:${m.bg};color:${m.fg};font-size:10px;padding:1px 6px;border-radius:3px;font-weight:600;">${m.label}</span>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
