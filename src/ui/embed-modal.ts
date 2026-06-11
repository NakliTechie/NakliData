// v1.4 F9 — Embed snippet modal.
//
// Shows the sandboxed `<iframe srcdoc>` snippet (built from the
// self-contained Export-HTML doc) for the user to copy into a wiki /
// intranet page. A height input rebuilds the snippet live. Read-only +
// server-free; the embed carries no scripts (empty sandbox).

import { buildEmbedSnippet } from '../core/embed.ts';
import { iconSvg } from '../tokens/icons.ts';
import { restoreModalFocus } from './modal-focus.ts';

let _modalEl: HTMLElement | null = null;
let _onKey: ((ev: KeyboardEvent) => void) | null = null;
let _prevFocus: HTMLElement | null = null;
let _html = '';

export function openEmbedModal(standaloneHtml: string): void {
  if (_modalEl) return;
  _html = standaloneHtml;
  _prevFocus = (document.activeElement as HTMLElement) ?? null;
  const overlay = render();
  document.body.append(overlay);
  _modalEl = overlay;
  refresh();
  overlay.querySelector<HTMLElement>('[data-action="embed-copy"]')?.focus();
}

export function closeEmbedModal(): void {
  if (_modalEl?.parentElement) _modalEl.parentElement.removeChild(_modalEl);
  _modalEl = null;
  if (_onKey) {
    document.removeEventListener('keydown', _onKey);
    _onKey = null;
  }
  restoreModalFocus(_prevFocus);
  _prevFocus = null;
  _html = '';
}

function currentSnippet(): string {
  const h = Number(
    _modalEl?.querySelector<HTMLInputElement>('[data-region="embed-height"]')?.value,
  );
  return buildEmbedSnippet(_html, { height: Number.isFinite(h) ? h : 600 });
}

function refresh(): void {
  const ta = _modalEl?.querySelector<HTMLTextAreaElement>('[data-region="embed-snippet"]');
  if (ta) ta.value = currentSnippet();
}

function render(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'schema-graph-overlay embed-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'embed-title');
  overlay.innerHTML = `
    <div class="schema-graph-modal embed-modal" role="document"
         style="width:min(680px,100%);height:auto;max-height:min(88vh,720px);display:flex;flex-direction:column;">
      <header class="schema-graph-header">
        <h2 id="embed-title" style="margin:0;font-size:var(--text-md,15px);display:flex;align-items:center;gap:6px;">
          ${iconSvg('link', 14)} Embed notebook
        </h2>
        <button class="btn btn-ghost schema-graph-close" data-action="embed-close" aria-label="Close" style="margin-left:auto;">${iconSvg('x', 14)}</button>
      </header>
      <div style="padding:var(--space-3) var(--space-4);overflow:auto;flex:1;min-height:0;">
        <p style="color:var(--text-muted);font-size:12px;margin:0 0 var(--space-2) 0;">
          A self-contained, read-only snapshot (markdown + charts + tables, no scripts, no engine) wrapped in a sandboxed <code>&lt;iframe&gt;</code>. Paste it into any wiki / intranet page — no server, no data fetch. Reflects the notebook as it is right now.
        </p>
        <label style="font-size:12px;display:inline-flex;align-items:center;gap:6px;margin-bottom:var(--space-2);">
          Height (px)
          <input type="number" data-region="embed-height" value="600" min="120" max="4000" style="width:90px;" />
        </label>
        <textarea data-region="embed-snippet" rows="10" readonly spellcheck="false" style="width:100%;font-family:var(--font-mono);font-size:11px;white-space:pre;"></textarea>
      </div>
      <footer style="display:flex;gap:var(--space-2);justify-content:flex-end;padding:var(--space-3) var(--space-4);border-top:1px solid var(--border);">
        <button class="btn btn-ghost" data-action="embed-close">Close</button>
        <button class="btn btn-primary" data-action="embed-copy">Copy snippet</button>
      </footer>
    </div>
  `;
  overlay.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target === overlay || target.closest('[data-action="embed-close"]'))
      return closeEmbedModal();
    if (target.closest('[data-action="embed-copy"]')) {
      const snippet = currentSnippet();
      const done = (msg: string) =>
        globalThis.dispatchEvent(new CustomEvent('naklidata:toast', { detail: { message: msg } }));
      navigator.clipboard?.writeText(snippet).then(
        () => done('Embed snippet copied to clipboard.'),
        () => {
          // Clipboard blocked — select the textarea so the user can copy manually.
          _modalEl?.querySelector<HTMLTextAreaElement>('[data-region="embed-snippet"]')?.select();
          done('Press ⌘/Ctrl-C to copy the selected snippet.');
        },
      );
    }
  });
  overlay.addEventListener('input', refresh);
  _onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeEmbedModal();
  };
  document.addEventListener('keydown', _onKey);
  return overlay;
}
