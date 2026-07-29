// M3 — Refresh result modal.
//
// User clicks "Check for source changes" → orchestrator runs → this modal
// shows the diff. User can:
//   - Refresh changed source relations, then re-run affected cells.
//   - Close — changed fingerprints are NOT persisted.

import { Neutral, StatusColor } from '../tokens/colors.ts';
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
  baselineSourceLabels: string[];
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
          ${iconSvg('download', 14)} Check for source changes
        </h2>
        <button class="btn btn-ghost schema-graph-close" data-action="refresh-close" aria-label="Close">
          ${iconSvg('x', 14)}
        </button>
      </header>
      <div class="refresh-body" style="padding:var(--space-4) var(--space-5);overflow:auto;">
        <p class="refresh-summary" style="margin:0 0 var(--space-3) 0;color:var(--text-muted);font-size:var(--text-sm,13px);">
          Scanned <strong>${desc.scanned}</strong> source${desc.scanned === 1 ? '' : 's'}.
        </p>
        ${allClean ? renderCleanBody(desc.baselineSourceLabels.length) : renderDiffBody(desc)}
      </div>
      <footer style="display:flex;gap:var(--space-2);justify-content:flex-end;padding:var(--space-3) var(--space-5);border-top:1px solid var(--border);">
        ${desc.staleSourceLabels.length > 0 ? `<button class="btn btn-primary" data-action="refresh-confirm">Refresh ${desc.staleSourceLabels.length} changed source${desc.staleSourceLabels.length === 1 ? '' : 's'}${desc.staleCellLabels.length > 0 ? ` + ${desc.staleCellLabels.length} cell${desc.staleCellLabels.length === 1 ? '' : 's'}` : ''}</button>` : ''}
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

function renderCleanBody(baselineCount: number): string {
  return `
    <div class="refresh-clean" style="text-align:center;padding:var(--space-4);">
      ${iconSvg('check', 32)}
      <p style="font-size:var(--text-md,15px);margin:var(--space-2) 0 0 0;color:var(--text);">
        No detectable source changes.
      </p>
      ${
        baselineCount > 0
          ? `<p style="font-size:var(--text-sm,13px);margin:var(--space-1) 0 0 0;color:var(--text-muted);">Recorded the first change baseline for ${baselineCount} source${baselineCount === 1 ? '' : 's'}.</p>`
          : ''
      }
    </div>
  `;
}

function renderDiffBody(desc: RefreshModalDescriptor): string {
  // Dedupe each label list so the same source/cell never renders twice
  // (forward-pass L4).
  const sources = [...new Set(desc.staleSourceLabels)];
  const cells = [...new Set(desc.staleCellLabels)];
  const unchecked = [...new Set(desc.uncheckableSourceLabels)];
  const baselined = [...new Set(desc.baselineSourceLabels)];
  const sourceList =
    sources.length > 0
      ? `<ul class="refresh-list" style="margin:0 0 var(--space-3) 0;padding:0;list-style:none;">${sources
          .map(
            (l) =>
              `<li style="padding:6px 8px;background:${StatusColor.financialBg};border-left:3px solid ${StatusColor.warningAccent};margin-bottom:4px;font-size:13px;color:${StatusColor.warningText};border-radius:3px;">${escapeHtml(l)}</li>`,
          )
          .join('')}</ul>`
      : '';
  const cellList =
    cells.length > 0
      ? `<ul class="refresh-list" style="margin:0 0 var(--space-3) 0;padding:0;list-style:none;">${cells
          .map(
            (l) =>
              `<li style="padding:6px 8px;background:${StatusColor.infoBg};border-left:3px solid ${StatusColor.infoAccent};margin-bottom:4px;font-size:13px;color:${StatusColor.infoText};border-radius:3px;">${escapeHtml(l)}</li>`,
          )
          .join('')}</ul>`
      : '';
  const uncheckList =
    unchecked.length > 0
      ? `<h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin:var(--space-2) 0 var(--space-1) 0;">Couldn't check (permission, network, or validator unavailable)</h3><ul class="refresh-list" style="margin:0 0 var(--space-3) 0;padding:0;list-style:none;">${unchecked
          .map(
            (l) =>
              `<li style="padding:6px 8px;background:${Neutral.surfaceCool};border-left:3px solid ${Neutral.textCoolMuted};margin-bottom:4px;font-size:13px;color:${Neutral.textCool};border-radius:3px;">${escapeHtml(l)}</li>`,
          )
          .join('')}</ul>`
      : '';
  const baselineList =
    baselined.length > 0
      ? `<h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin:var(--space-2) 0 var(--space-1) 0;">First change baseline recorded</h3><ul class="refresh-list" style="margin:0 0 var(--space-3) 0;padding:0;list-style:none;">${baselined
          .map(
            (label) =>
              `<li style="padding:6px 8px;background:var(--surface-raised);border-left:3px solid var(--text-muted);margin-bottom:4px;font-size:13px;color:var(--text);border-radius:3px;">${escapeHtml(label)}</li>`,
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
    ${baselineList}
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
