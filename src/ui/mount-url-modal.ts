// Wave 2 slice 1 — "Paste URL" modal. Captures a label + URL and
// hands them back via the onMount callback. Keeps modal scope tight:
// label + URL only, no auth fields (S3 / Iceberg get their own modals
// in slices 2 + 3).

import { iconSvg } from '../tokens/icons.ts';

let _modalEl: HTMLElement | null = null;
let _previouslyFocused: HTMLElement | null = null;
let _onKey: ((ev: KeyboardEvent) => void) | null = null;

export function openMountUrlModal(opts: {
  onMount: (input: { label: string; url: string }) => Promise<void> | void;
}): void {
  // Singleton — clicking the trigger twice is a no-op.
  if (_modalEl && document.body.contains(_modalEl)) return;

  _previouslyFocused = (document.activeElement as HTMLElement) ?? null;

  const overlay = renderModal(opts);
  document.body.append(overlay);
  _modalEl = overlay;

  // Move focus to the URL input — the field the user is most likely
  // to type into immediately.
  overlay.querySelector<HTMLInputElement>('[data-region="url-input"]')?.focus();
}

export function closeMountUrlModal(): void {
  if (_modalEl?.parentElement) {
    _modalEl.parentElement.removeChild(_modalEl);
  }
  _modalEl = null;
  if (_onKey) {
    document.removeEventListener('keydown', _onKey);
    _onKey = null;
  }
  _previouslyFocused?.focus();
  _previouslyFocused = null;
}

function renderModal(opts: {
  onMount: (input: { label: string; url: string }) => Promise<void> | void;
}): HTMLElement {
  const overlay = document.createElement('div');
  // Compose the base overlay/modal styling with mount-url specifics —
  // same pattern as settings-modal.ts and define-type-modal.ts.
  overlay.className = 'schema-graph-overlay mount-url-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Mount remote URL');
  overlay.innerHTML = `
    <div class="schema-graph-modal mount-url-modal" data-region="mount-url-modal">
      <div class="schema-graph-header">
        <strong>Paste URL</strong>
        <button class="btn btn-ghost schema-graph-close" data-action="close-mount-url" aria-label="Close">
          ${iconSvg('x', 14)}
        </button>
      </div>
      <div class="mount-url-body">
        <label class="mount-url-field">
          <span>URL</span>
          <input type="url" data-region="url-input" placeholder="https://example.com/data.parquet" autocomplete="off" spellcheck="false">
        </label>
        <label class="mount-url-field">
          <span>Label <em>(optional)</em></span>
          <input type="text" data-region="label-input" placeholder="defaults to the filename" autocomplete="off" spellcheck="false">
        </label>
        <p class="mount-url-hint">
          Supports public <code>.csv</code> / <code>.tsv</code> / <code>.jsonl</code> /
          <code>.parquet</code> over HTTPS. Bytes go directly from the host to your
          browser; no third party in between. Authenticated S3 + Iceberg sources are
          coming next.
        </p>
        <div class="mount-url-error" data-region="error" hidden></div>
        <div class="mount-url-actions">
          <button class="btn btn-ghost" data-action="close-mount-url">Cancel</button>
          <button class="btn btn-primary" data-action="confirm-mount-url">Mount</button>
        </div>
      </div>
    </div>
  `;
  overlay.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target === overlay) closeMountUrlModal();
    if (target.closest('[data-action="close-mount-url"]')) closeMountUrlModal();
    if (target.closest('[data-action="confirm-mount-url"]')) void confirmMount(overlay, opts);
  });
  overlay.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT') {
        ev.preventDefault();
        void confirmMount(overlay, opts);
      }
    }
  });
  _onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeMountUrlModal();
  };
  document.addEventListener('keydown', _onKey);
  return overlay;
}

async function confirmMount(
  overlay: HTMLElement,
  opts: { onMount: (input: { label: string; url: string }) => Promise<void> | void },
): Promise<void> {
  const urlInput = overlay.querySelector<HTMLInputElement>('[data-region="url-input"]');
  const labelInput = overlay.querySelector<HTMLInputElement>('[data-region="label-input"]');
  const errEl = overlay.querySelector<HTMLElement>('[data-region="error"]');
  const url = urlInput?.value.trim() ?? '';
  const label = labelInput?.value.trim() ?? '';
  if (!url) {
    if (errEl) {
      errEl.textContent = 'URL is required.';
      errEl.hidden = false;
    }
    urlInput?.focus();
    return;
  }
  if (errEl) {
    errEl.textContent = '';
    errEl.hidden = true;
  }
  try {
    await opts.onMount({ label, url });
    closeMountUrlModal();
  } catch (err) {
    if (errEl) {
      errEl.textContent = err instanceof Error ? err.message : String(err);
      errEl.hidden = false;
    }
  }
}
