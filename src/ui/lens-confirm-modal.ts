// Lens-link confirmation modal — gate auto-mount of remote sources.
//
// Forward-pass H1 (2026-06-02): a `?lens=<base64gzip>` share link
// decodes a list of PersistedSource entries. For local sources
// (example-bundle, fsa-folder), there's no network footprint and
// auto-restore is fine. For remote sources (http, s3-endpoint,
// iceberg-table, iceberg-catalog, compute-bridge,
// compute-bridge-catalog), the engine will silently fetch from
// every host enumerated by the link. A malicious link can use the
// victim's browser to:
//   - probe internal networks (`http://10.0.0.5:8080/`)
//   - access intranet resources the attacker can't reach directly
//   - replay any persisted bearer token against attacker-controlled
//     URLs
//
// This modal interrupts auto-mount, lists every host the link will
// reach out to, and requires an explicit Continue click. Cancel
// strips the lens param and falls back to the saved session.

import { iconSvg } from '../tokens/icons.ts';
import { restoreModalFocus } from './modal-focus.ts';

let _modalEl: HTMLElement | null = null;
let _onKey: ((ev: KeyboardEvent) => void) | null = null;

export interface LensConfirmDescriptor {
  /** Source label as it will appear in the workbook. */
  label: string;
  /** Host the engine will fetch from (`example.com`, `10.0.0.1`, …). */
  host: string;
  /** Human-readable kind (`Public URL`, `Iceberg catalog`, …). */
  kind: string;
}

export function openLensConfirmModal(
  remotes: LensConfirmDescriptor[],
  notebookTitle: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (_modalEl) {
      // Defensive: don't stack modals. Treat a second call as cancel.
      resolve(false);
      return;
    }
    const previouslyFocused = (document.activeElement as HTMLElement) ?? null;
    const overlay = render(remotes, notebookTitle);
    document.body.append(overlay);
    _modalEl = overlay;

    const close = (proceed: boolean): void => {
      if (_modalEl?.parentElement) _modalEl.parentElement.removeChild(_modalEl);
      _modalEl = null;
      if (_onKey) {
        document.removeEventListener('keydown', _onKey);
        _onKey = null;
      }
      restoreModalFocus(previouslyFocused);
      resolve(proceed);
    };

    overlay.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      // Backdrop click = cancel
      if (target === overlay) {
        close(false);
        return;
      }
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'lens-confirm-continue') close(true);
      else if (action === 'lens-confirm-cancel') close(false);
    });

    _onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') close(false);
    };
    document.addEventListener('keydown', _onKey);

    // Focus the Cancel button — defaulting focus to "Continue" would
    // make Enter-key dismissals proceed with the fetch, which is the
    // opposite of what this modal exists to prevent.
    overlay.querySelector<HTMLElement>('[data-action="lens-confirm-cancel"]')?.focus();
  });
}

function render(remotes: LensConfirmDescriptor[], notebookTitle: string): HTMLElement {
  const overlay = document.createElement('div');
  // Reuse the codebase's shared modal classes (see shell.css.ts).
  overlay.className = 'schema-graph-overlay lens-confirm-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'lens-confirm-title');
  // Deduplicate hosts in the bullet list; show one row per unique host.
  // The user cares about WHERE the fetches go, not how many sources
  // share a host.
  const byHost = new Map<string, LensConfirmDescriptor[]>();
  for (const r of remotes) {
    const list = byHost.get(r.host) ?? [];
    list.push(r);
    byHost.set(r.host, list);
  }
  const rows: string[] = [];
  for (const [host, sources] of byHost) {
    const kinds = [...new Set(sources.map((s) => s.kind))].join(', ');
    const labels = sources.map((s) => escapeHtml(s.label)).join(', ');
    rows.push(`
      <li class="lens-confirm-row" style="background:var(--surface-alt);border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:12px;">
        <strong class="lens-confirm-host" style="font-family:var(--font-mono);color:var(--text);">${escapeHtml(host)}</strong>
        <span class="lens-confirm-meta" style="color:var(--text-muted);display:block;margin-top:2px;">${escapeHtml(kinds)} — ${labels}</span>
      </li>`);
  }
  overlay.innerHTML = `
    <div class="schema-graph-modal lens-confirm-modal" role="document" style="width:min(620px,100%);height:auto;max-height:min(80vh,720px);">
      <header class="schema-graph-header" style="gap:var(--space-2);">
        <h2 id="lens-confirm-title" style="margin:0;font-size:var(--text-md,15px);display:flex;align-items:center;gap:6px;">${iconSvg('warning', 14)} Confirm shared-link mount</h2>
      </header>
      <div class="lens-confirm-body" style="padding:var(--space-4) var(--space-5);overflow:auto;flex:1;min-height:0;">
        <p style="margin-top:0;">
          The shared notebook <strong>${escapeHtml(notebookTitle)}</strong>
          asks NakliData to fetch data from
          <strong>${remotes.length}</strong>
          remote source${remotes.length === 1 ? '' : 's'}:
        </p>
        <ul class="lens-confirm-list" style="list-style:none;padding:0;margin:var(--space-3) 0;display:flex;flex-direction:column;gap:var(--space-2);">${rows.join('')}</ul>
        <p class="lens-confirm-note" style="color:var(--text-muted);font-size:12px;line-height:1.5;">
          Your browser will issue requests to each host above. Only
          continue if you trust the sender — a malicious link could
          probe internal networks visible from this machine, or replay
          stored credentials against attacker-controlled URLs.
        </p>
        <p class="lens-confirm-note" style="color:var(--text-muted);font-size:12px;line-height:1.5;">
          Local sources (example data, folders you'd already opened)
          are not affected.
        </p>
      </div>
      <footer style="display:flex;gap:var(--space-2);justify-content:flex-end;padding:var(--space-3) var(--space-5);border-top:1px solid var(--border);">
        <button class="btn btn-ghost" data-action="lens-confirm-cancel">Cancel — use my saved state</button>
        <button class="btn btn-primary" data-action="lens-confirm-continue">Continue and fetch</button>
      </footer>
    </div>
  `;
  return overlay;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
