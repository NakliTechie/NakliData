// Help modal + first-run welcome splash.
//
// Two entry points, one surface:
//   - openHelpModal()          — the header "Help" button; orientation +
//                                keyboard shortcuts + a link to the full guide.
//   - maybeOpenWelcomeSplash() — shown once, on a genuine first visit (no
//                                restored session), gated on a localStorage
//                                flag; a warm 3-step welcome + a "browse
//                                example data" CTA + the same guide link.
//
// Both reuse the shared `.schema-graph-overlay` / `.schema-graph-modal`
// surface (like confirm-modal) and both point at the illustrated field guide.
// The guide is a separate build artifact (guide/index.html); it sits next to
// the app when deployed, so we open it with a RELATIVE URL that resolves both
// locally (served from the same root) and on the Cloudflare deploy.

import { iconSvg } from '../tokens/icons.ts';
import { restoreModalFocus } from './modal-focus.ts';

type IconName = Parameters<typeof iconSvg>[0];

// Relative to the app origin. `guide/regenerate.sh` mirrors the guide into
// dist/guide/ so `wrangler deploy` ships it alongside index.html. If you host
// the guide elsewhere, this is the one line to change.
const GUIDE_URL = 'guide/index.html';

// localStorage flag — a benign first-run UI preference (not data, not a
// credential), so it's outside the "no persistent storage" rule for those.
const WELCOME_KEY = 'naklidata.welcomed';

let _open = false;

function hasSeenWelcome(): boolean {
  try {
    return localStorage.getItem(WELCOME_KEY) === '1';
  } catch {
    return false;
  }
}

function markWelcomeSeen(): void {
  try {
    localStorage.setItem(WELCOME_KEY, '1');
  } catch {
    // Private mode / storage disabled — the splash just shows again next time.
  }
}

/**
 * Mount an overlay with the given inner HTML for the modal card. Wires
 * Escape + backdrop-click + `[data-close]` to close, stashes/restores focus,
 * and calls `onClose` after teardown. Returns the overlay so callers can wire
 * extra buttons before it's shown.
 */
function mountOverlay(
  cardInner: string,
  opts: { labelId: string; onClose?: () => void; extraWidth?: string },
): HTMLElement | null {
  if (_open) return null;
  _open = true;
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const overlay = document.createElement('div');
  overlay.className = 'schema-graph-overlay help-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', opts.labelId);
  overlay.innerHTML = `
    <div class="schema-graph-modal help-modal" role="document"
         style="width:min(${opts.extraWidth ?? '560px'},100%);height:auto;max-height:100%;overflow:auto;">
      ${cardInner}
    </div>
  `;

  const close = (): void => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    _open = false;
    restoreModalFocus(previouslyFocused);
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  overlay.addEventListener('click', (e) => {
    const t = e.target as HTMLElement | null;
    if (t === overlay || t?.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  // Expose the closer for callers that need to close before running an action.
  (overlay as HTMLElement & { _close?: () => void })._close = close;
  return overlay;
}

// Shared header + guide-link fragments so both surfaces read identically.
function guideCta(label: string): string {
  return `
    <a class="btn btn-primary help-guide-link" href="${GUIDE_URL}" target="_blank" rel="noopener"
       style="text-decoration:none;justify-content:center;">
      ${iconSvg('chart', 14)} ${label}
    </a>`;
}

function closeButton(): string {
  return `
    <button class="btn btn-ghost schema-graph-close" data-close aria-label="Close">
      ${iconSvg('x', 16)}
    </button>`;
}

/** The header "Help" button — orientation + shortcuts + guide link. */
export function openHelpModal(): void {
  const surfaces: ReadonlyArray<[IconName, string, string]> = [
    [
      'folder',
      'Sources',
      'Mount a folder, file, public URL, or remote store. Your data never leaves the tab.',
    ],
    [
      'table',
      'Schema panel',
      'Every column is auto-classified into a semantic type with a confidence score — accept or override any guess.',
    ],
    [
      'plus',
      'Notebook',
      'Run SQL (locally, in DuckDB-wasm), chart results, and add cells. Nothing runs until you press Run.',
    ],
    [
      'link',
      'Resolve',
      'Cluster near-duplicates, define measures / dimensions / segments, and export a golden table.',
    ],
    ['chart', 'Facet', 'Visual view-types — plot rows as a 2-D embedding scatter.'],
    [
      'info',
      'AI sidecar',
      'Opt-in, bring-your-own-key. Writes SQL from plain English, summarises a result, proposes a chart. Never auto-runs.',
    ],
  ];
  const surfacesHtml = surfaces
    .map(
      ([icon, name, desc]) => `
      <li style="display:flex;gap:var(--space-3);align-items:flex-start;">
        <span aria-hidden="true" style="color:var(--accent);flex:0 0 auto;margin-top:1px;">${iconSvg(icon, 16)}</span>
        <span><strong>${name}.</strong> ${desc}</span>
      </li>`,
    )
    .join('');

  const shortcuts: ReadonlyArray<[string, string]> = [
    ['Ctrl / ⌘ + K', 'Search'],
    ['Ctrl / ⌘ + S', 'Save workbook (.naklidata)'],
    ['Ctrl / ⌘ + Shift + Enter', 'Run all cells'],
    ['Esc', 'Close a dialog'],
  ];
  const shortcutsHtml = shortcuts
    .map(
      ([keys, what]) => `
      <div style="display:flex;justify-content:space-between;gap:var(--space-4);padding:2px 0;">
        <span style="color:var(--text-muted);">${what}</span>
        <kbd style="font-family:var(--font-mono);font-size:11px;background:var(--surface-alt);border:1px solid var(--border);border-radius:4px;padding:1px 6px;white-space:nowrap;">${keys}</kbd>
      </div>`,
    )
    .join('');

  const inner = `
    <div class="schema-graph-header">
      <span aria-hidden="true" style="color:var(--accent);">${iconSvg('question', 18)}</span>
      <strong id="help-title" style="font-size:var(--text-lg,15px);">Help &amp; orientation</strong>
      <span style="margin-left:auto;"></span>
      ${closeButton()}
    </div>
    <div style="padding:var(--space-4) var(--space-5);display:flex;flex-direction:column;gap:var(--space-4);">
      <p style="margin:0;font-size:13px;line-height:1.5;color:var(--text);">
        <strong>NakliData</strong> is a browser-native semantic data workbench — it runs entirely in this tab,
        with no server, no upload, and no account. Here's the lay of the land:
      </p>
      <ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-3);font-size:13px;line-height:1.45;">
        ${surfacesHtml}
      </ul>
      <div>
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:6px;">Keyboard shortcuts</div>
        <div style="font-size:12px;">${shortcutsHtml}</div>
      </div>
      <div style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap;padding-top:var(--space-2);border-top:1px solid var(--border);">
        ${guideCta('Open the full illustrated guide')}
        <span style="color:var(--text-muted);font-size:12px;">Every screen, captioned and searchable — opens in a new tab.</span>
      </div>
    </div>
  `;
  mountOverlay(inner, { labelId: 'help-title', extraWidth: '600px' });
}

/**
 * Show the first-run welcome splash, but only on a genuine first visit and
 * only once (localStorage-gated). `onBrowseExamples` is invoked (and the
 * splash closed) if the user takes the "browse example data" CTA — main.ts
 * passes the same handler the empty-state button uses.
 */
export function maybeOpenWelcomeSplash(opts: { onBrowseExamples: () => void }): void {
  if (hasSeenWelcome()) return;

  const steps: ReadonlyArray<[IconName, string, string]> = [
    [
      'folder',
      'Bring your data in',
      'A folder, a file, a public URL, or a remote store — read in-tab, and it never leaves.',
    ],
    [
      'table',
      'Read the schema',
      'Columns are auto-typed (Vendor name, GSTIN, PAN, …) with confidence scores you can accept or override.',
    ],
    [
      'plus',
      'Query & build',
      'Run SQL locally, chart it, resolve messy entities, and export — all without a backend.',
    ],
  ];
  const stepsHtml = steps
    .map(
      ([icon, title, desc], i) => `
      <li style="display:flex;gap:var(--space-3);align-items:flex-start;">
        <span aria-hidden="true" style="flex:0 0 auto;width:28px;height:28px;border-radius:50%;background:var(--surface-alt);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;color:var(--accent);font-weight:600;font-size:12px;">${i + 1}</span>
        <span style="padding-top:3px;"><strong>${title}.</strong> ${desc}
          <span aria-hidden="true" style="color:var(--text-muted);margin-left:4px;">${iconSvg(icon, 13)}</span>
        </span>
      </li>`,
    )
    .join('');

  const inner = `
    <div class="schema-graph-header">
      <span aria-hidden="true" style="color:var(--accent);">${iconSvg('search', 18)}</span>
      <strong id="welcome-title" style="font-size:var(--text-lg,15px);">Welcome to NakliData</strong>
      <span style="margin-left:auto;"></span>
      ${closeButton()}
    </div>
    <div style="padding:var(--space-4) var(--space-5);display:flex;flex-direction:column;gap:var(--space-4);">
      <p style="margin:0;font-size:13px;line-height:1.5;color:var(--text);">
        A semantic data workbench that runs entirely in your browser — no server, no upload, no account.
        Three steps to your first result:
      </p>
      <ol style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-3);font-size:13px;line-height:1.45;">
        ${stepsHtml}
      </ol>
      <div style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap;padding-top:var(--space-2);border-top:1px solid var(--border);">
        <button class="btn btn-primary" data-welcome-examples style="justify-content:center;">
          ${iconSvg('table', 14)} Browse example data
        </button>
        <a class="btn btn-ghost" href="${GUIDE_URL}" target="_blank" rel="noopener" style="text-decoration:none;">
          ${iconSvg('chart', 14)} Open the full guide
        </a>
        <button class="btn btn-ghost" data-close style="margin-left:auto;">Start exploring</button>
      </div>
    </div>
  `;

  const overlay = mountOverlay(inner, {
    labelId: 'welcome-title',
    extraWidth: '560px',
    onClose: markWelcomeSeen,
  });
  if (!overlay) return;
  // The "browse example data" CTA closes the splash, then runs the same action
  // the empty-state button does (help-modal stays decoupled from main.ts).
  overlay.querySelector<HTMLElement>('[data-welcome-examples]')?.addEventListener('click', () => {
    (overlay as HTMLElement & { _close?: () => void })._close?.();
    opts.onBrowseExamples();
  });
  // Focus the primary CTA for keyboard users.
  overlay.querySelector<HTMLElement>('[data-welcome-examples]')?.focus();
}
