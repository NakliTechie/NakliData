// Override-rules management modal. Lists "always treat columns named X
// as type Y" rules created via the "Remember" affordance on the
// post-Override toast. Each row can be removed; removal does NOT
// rewind already-applied assignments (rules are forward-acting only).
//
// Theme 4 wave 2 (B3). See DECISIONS 2026-05-21 for the rationale.

import type { OverrideRule, UserType } from '../core/workbook.ts';
import type { TaxonomyBundle } from '../taxonomy/types.ts';
import { iconSvg } from '../tokens/icons.ts';

let _modalEl: HTMLElement | null = null;
let _keyHandler: ((ev: KeyboardEvent) => void) | null = null;
let _previouslyFocused: HTMLElement | null = null;

export interface OverrideRulesModalState {
  rules: OverrideRule[];
  bundle: TaxonomyBundle | null;
  userTypes: UserType[];
}

export interface OverrideRulesModalHandlers {
  onRemove: (columnName: string) => void;
}

/** Resolve a typeId to its display name. */
function friendlyType(
  typeId: string,
  bundle: TaxonomyBundle | null,
  userTypes: UserType[],
): string {
  return (
    bundle?.types.find((t) => t.id === typeId)?.display_name ??
    userTypes.find((t) => t.id === typeId)?.display_name ??
    typeId
  );
}

export function openOverrideRulesModal(
  initial: OverrideRulesModalState,
  handlers: OverrideRulesModalHandlers,
): void {
  if (_modalEl && document.body.contains(_modalEl)) {
    // Already open — re-render contents with the latest state instead of
    // stacking. Callers can re-open with fresh rules to refresh the list.
    renderList(_modalEl, initial, handlers);
    return;
  }
  _previouslyFocused = (document.activeElement as HTMLElement) ?? null;
  const overlay = document.createElement('div');
  overlay.className = 'override-rules-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Override rules');
  overlay.innerHTML = `
    <div class="override-rules-modal" data-region="override-rules-modal">
      <div class="override-rules-header">
        <strong>Override rules</strong>
        <button class="btn btn-ghost override-rules-close" data-action="close-override-rules" aria-label="Close">
          ${iconSvg('x', 14)}
        </button>
      </div>
      <p class="override-rules-help">
        "Always treat columns named X as type Y" — applied to future mounts
        and to newly-classified columns. Manual accepts on a specific
        column override these rules.
      </p>
      <div class="override-rules-list" data-region="override-rules-list"></div>
    </div>
  `;
  overlay.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target === overlay) closeOverrideRulesModal();
    if (target.closest('[data-action="close-override-rules"]')) closeOverrideRulesModal();
  });
  _keyHandler = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeOverrideRulesModal();
  };
  document.addEventListener('keydown', _keyHandler);
  document.body.append(overlay);
  _modalEl = overlay;
  injectOverrideRulesCss();
  renderList(overlay, initial, handlers);
  // Move focus to the close button so keyboard users can interact +
  // dismiss without Tab gymnastics.
  overlay.querySelector<HTMLElement>('[data-action="close-override-rules"]')?.focus();
}

export function closeOverrideRulesModal(): void {
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
 * Re-render the rules list inside an already-open modal. Used by
 * `openOverrideRulesModal` for both initial mount and refresh-on-reopen.
 * Caller is responsible for closing the modal when the rule list
 * empties (we keep the modal open to show the empty state instead).
 */
export function refreshOverrideRulesModal(
  state: OverrideRulesModalState,
  handlers: OverrideRulesModalHandlers,
): void {
  if (!_modalEl) return;
  renderList(_modalEl, state, handlers);
}

function renderList(
  overlay: HTMLElement,
  state: OverrideRulesModalState,
  handlers: OverrideRulesModalHandlers,
): void {
  const listEl = overlay.querySelector<HTMLElement>('[data-region="override-rules-list"]');
  if (!listEl) return;
  if (state.rules.length === 0) {
    listEl.innerHTML = `<p class="override-rules-empty">No rules yet. Override a column and click "Remember" on the toast to add one.</p>`;
    return;
  }
  // Sort by created descending so the most recently added shows first —
  // matches how the user remembers having added the rule.
  const sorted = [...state.rules].sort((a, b) => (b.created < a.created ? -1 : 1));
  listEl.innerHTML = sorted
    .map((rule) => {
      const target = friendlyType(rule.typeId, state.bundle, state.userTypes);
      return `
        <div class="override-rules-row" data-column="${escapeHtml(rule.columnName)}">
          <div class="override-rules-text">
            <code>${escapeHtml(rule.columnName)}</code>
            <span class="override-rules-arrow" aria-hidden="true">→</span>
            <span class="override-rules-target">${escapeHtml(target)}</span>
          </div>
          <button class="btn btn-ghost" data-action="remove-rule" data-column="${escapeHtml(rule.columnName)}" aria-label="Remove rule for ${escapeHtml(rule.columnName)}">
            ${iconSvg('x', 12)} Remove
          </button>
        </div>
      `;
    })
    .join('');
  for (const btn of listEl.querySelectorAll<HTMLButtonElement>('[data-action="remove-rule"]')) {
    btn.addEventListener('click', () => {
      const col = btn.dataset.column;
      if (!col) return;
      handlers.onRemove(col);
    });
  }
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
function injectOverrideRulesCss(): void {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement('style');
  style.textContent = OVERRIDE_RULES_CSS;
  document.head.appendChild(style);
}

const OVERRIDE_RULES_CSS = `
.override-rules-overlay {
  position: fixed; inset: 0;
  background: rgba(31, 27, 22, 0.42);
  display: flex; align-items: center; justify-content: center;
  z-index: 9000;
}
.override-rules-modal {
  background: var(--surface-card, #FFFCF6);
  color: var(--text-default, #1F1B16);
  border-radius: 8px;
  width: min(560px, calc(100vw - 32px));
  max-height: calc(100vh - 64px);
  display: flex; flex-direction: column;
  box-shadow: 0 16px 48px rgba(31, 27, 22, 0.32);
  overflow: hidden;
}
.override-rules-header {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-muted, rgba(31, 27, 22, 0.12));
}
.override-rules-header strong { flex: 1; font-size: 14px; }
.override-rules-help {
  margin: 0;
  padding: 12px 16px;
  font-size: 12px;
  color: var(--text-muted, rgba(31, 27, 22, 0.6));
  border-bottom: 1px solid var(--border-muted, rgba(31, 27, 22, 0.12));
}
.override-rules-list {
  padding: 8px 12px;
  overflow-y: auto;
  display: flex; flex-direction: column; gap: 4px;
}
.override-rules-empty {
  margin: 12px 4px;
  font-size: 12px;
  color: var(--text-muted, rgba(31, 27, 22, 0.6));
}
.override-rules-row {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 12px;
  border-radius: 6px;
}
.override-rules-row:hover { background: rgba(31, 27, 22, 0.04); }
.override-rules-text {
  flex: 1;
  display: flex; align-items: center; gap: 8px;
  font-size: 13px;
}
.override-rules-text code {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
  background: rgba(31, 27, 22, 0.06);
  padding: 2px 6px;
  border-radius: 4px;
}
.override-rules-arrow { color: var(--text-muted, rgba(31, 27, 22, 0.6)); }
.override-rules-target {
  font-weight: 600;
}
`;
