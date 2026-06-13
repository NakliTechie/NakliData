// A small promise-based confirmation modal — an on-brand replacement for
// window.confirm() when prompting from inside one of our own modals/panels,
// where a native confirm is visually jarring and (per the audit) can be
// suppressed under stricter UA settings. Resolves true on confirm, false on
// cancel / Escape / backdrop click. (forward-pass M10.)
//
// Reuses the shared `.schema-graph-overlay` / `.schema-graph-modal` /
// `.btn` classes so it matches the rest of the modal surface.

let _open = false;

export interface ConfirmModalOptions {
  confirmLabel?: string;
  cancelLabel?: string;
}

export function confirmModal(message: string, opts?: ConfirmModalOptions): Promise<boolean> {
  // Guard against stacking — if one is already up, treat as a cancel.
  if (_open) return Promise.resolve(false);
  _open = true;
  const confirmLabel = opts?.confirmLabel ?? 'Confirm';
  const cancelLabel = opts?.cancelLabel ?? 'Cancel';

  return new Promise<boolean>((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'schema-graph-overlay confirm-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
      <div class="schema-graph-modal" role="document"
           style="width:min(440px,100%);height:auto;display:flex;flex-direction:column;gap:var(--space-3);padding:var(--space-4);">
        <p style="margin:0;font-size:var(--text-sm,13px);line-height:1.5;">${escapeText(message)}</p>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn btn-ghost" data-confirm="no">${escapeText(cancelLabel)}</button>
          <button class="btn btn-primary" data-confirm="yes">${escapeText(confirmLabel)}</button>
        </div>
      </div>
    `;

    const done = (val: boolean): void => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      _open = false;
      resolve(val);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') done(false);
      else if (e.key === 'Enter') done(true);
    };
    overlay.addEventListener('click', (e) => {
      const t = e.target as HTMLElement | null;
      if (t === overlay) return done(false);
      const ans = t?.closest<HTMLElement>('[data-confirm]')?.dataset.confirm;
      if (ans === 'yes') done(true);
      else if (ans === 'no') done(false);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    overlay.querySelector<HTMLElement>('[data-confirm="yes"]')?.focus();
  });
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
