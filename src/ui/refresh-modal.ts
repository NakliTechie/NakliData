// M3 — Refresh result modal.
//
// User clicks "Check for updates" → orchestrator runs → this modal
// shows the diff. User can:
//   - Re-run stale cells (which fires the existing notebook re-run
//     path; the orchestrator persists the fresh fingerprints when
//     the user confirms).
//   - Close — nothing is re-run; fingerprints are NOT persisted
//     (so the next check still reports stale).

import { iconSvg } from '../tokens/icons.ts';
import { restoreModalFocus } from './modal-focus.ts';

let _modalEl: HTMLElement | null = null;
let _onKey: ((ev: KeyboardEvent) => void) | null = null;
let _previouslyFocused: HTMLElement | null = null;

export interface RefreshModalDescriptor {
  scanned: number;
  staleSourceLabels: string[];
  staleCellLabels: string[];
  uncheckableSourceLabels: string[];
}

export function openRefreshModal(desc: RefreshModalDescriptor, onConfirm: () => void): void {
  if (_modalEl) return;
  _previouslyFocused = (document.activeElement as HTMLElement) ?? null;
  const overlay = renderModal(desc, onConfirm);
  document.body.append(overlay);
  _modalEl = overlay;
  overlay.querySelector<HTMLElement>('[data-action="refresh-close"]')?.focus();
}

export function closeRefreshModal(): void {
  if (_modalEl?.parentElement) _modalEl.parentElement.removeChild(_modalEl);
  _modalEl = null;
  if (_onKey) {
    document.removeEventListener('keydown', _onKey);
    _onKey = null;
  }
  restoreModalFocus(_previouslyFocused);
  _previouslyFocused = null;
}

function renderModal(desc: RefreshModalDescriptor, onConfirm: () => void): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'schema-graph-overlay refresh-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'refresh-title');

  const allClean = desc.staleSourceLabels.length === 0 && desc.uncheckableSourceLabels.length === 0;

  overlay.innerHTML = `
    <div class="schema-graph-modal refresh-modal" role="document"
         style="width:min(640px,100%);height:auto;max-height:min(85vh,720px);">
      <header class="schema-graph-header">
        <h2 id="refresh-title" style="margin:0;font-size:var(--text-md,15px);display:flex;align-items:center;gap:6px;">
          ${iconSvg('download', 14)} Check for source updates
        </h2>
        <button class="btn btn-ghost schema-graph-close" data-action="refresh-close" aria-label="Close">
          ${iconSvg('x', 14)}
        </button>
      </header>
      <div class="refresh-body" style="padding:var(--space-4) var(--space-5);overflow:auto;">
        <p class="refresh-summary" style="margin:0 0 var(--space-3) 0;color:var(--text-muted);font-size:var(--text-sm,13px);">
          Scanned <strong>${desc.scanned}</strong> source${desc.scanned === 1 ? '' : 's'}.
        </p>
        ${allClean ? renderCleanBody() : renderDiffBody(desc)}
      </div>
      <footer style="display:flex;gap:var(--space-2);justify-content:flex-end;padding:var(--space-3) var(--space-5);border-top:1px solid var(--border);">
        ${desc.staleCellLabels.length > 0 ? `<button class="btn btn-primary" data-action="refresh-confirm">Re-run ${desc.staleCellLabels.length} stale cell${desc.staleCellLabels.length === 1 ? '' : 's'}</button>` : ''}
        <button class="btn btn-ghost" data-action="refresh-close">Close</button>
      </footer>
    </div>
  `;
  overlay.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target === overlay) return closeRefreshModal();
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'refresh-close') closeRefreshModal();
    if (action === 'refresh-confirm') {
      closeRefreshModal();
      onConfirm();
    }
  });
  _onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeRefreshModal();
  };
  document.addEventListener('keydown', _onKey);
  return overlay;
}

function renderCleanBody(): string {
  return `
    <div class="refresh-clean" style="text-align:center;padding:var(--space-4);">
      ${iconSvg('check', 32)}
      <p style="font-size:var(--text-md,15px);margin:var(--space-2) 0 0 0;color:var(--text);">
        All sources are up to date.
      </p>
    </div>
  `;
}

function renderDiffBody(desc: RefreshModalDescriptor): string {
  // Dedupe each label list so the same source/cell never renders twice
  // (forward-pass L4).
  const sources = [...new Set(desc.staleSourceLabels)];
  const cells = [...new Set(desc.staleCellLabels)];
  const unchecked = [...new Set(desc.uncheckableSourceLabels)];
  const sourceList =
    sources.length > 0
      ? `<ul class="refresh-list" style="margin:0 0 var(--space-3) 0;padding:0;list-style:none;">${sources
          .map(
            (l) =>
              `<li style="padding:6px 8px;background:#fef3c7;border-left:3px solid #f59e0b;margin-bottom:4px;font-size:13px;color:#92400e;border-radius:3px;">${escapeHtml(l)}</li>`,
          )
          .join('')}</ul>`
      : '';
  const cellList =
    cells.length > 0
      ? `<ul class="refresh-list" style="margin:0 0 var(--space-3) 0;padding:0;list-style:none;">${cells
          .map(
            (l) =>
              `<li style="padding:6px 8px;background:#eff6ff;border-left:3px solid #3b82f6;margin-bottom:4px;font-size:13px;color:#1e40af;border-radius:3px;">${escapeHtml(l)}</li>`,
          )
          .join('')}</ul>`
      : '';
  const uncheckList =
    unchecked.length > 0
      ? `<h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin:var(--space-2) 0 var(--space-1) 0;">Couldn't check (permission revoked or HEAD failed)</h3><ul class="refresh-list" style="margin:0 0 var(--space-3) 0;padding:0;list-style:none;">${unchecked
          .map(
            (l) =>
              `<li style="padding:6px 8px;background:#f3f4f6;border-left:3px solid #6b7280;margin-bottom:4px;font-size:13px;color:#374151;border-radius:3px;">${escapeHtml(l)}</li>`,
          )
          .join('')}</ul>`
      : '';
  return `
    ${
      sourceList
        ? `<h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin:0 0 var(--space-1) 0;">Sources that changed</h3>${sourceList}`
        : ''
    }
    ${
      cellList
        ? `<h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin:0 0 var(--space-1) 0;">Affected cells (cascaded via lineage)</h3>${cellList}`
        : ''
    }
    ${uncheckList}
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
