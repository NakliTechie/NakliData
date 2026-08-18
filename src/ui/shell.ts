import { maskLabel } from '../core/demo-mode.ts';
import type { MountedSource } from '../core/mount.ts';
import {
  PRIVACY_POSTURE_COPY,
  SOURCE_GROUPS,
  SOURCE_OPTIONS,
} from '../core/product-capabilities.ts';
import type { SessionsIndex } from '../core/sessions.ts';
import { provenanceSummary } from '../core/source-provenance.ts';
import { iconSvg } from '../tokens/icons.ts';
import { shellCss } from './shell.css.ts';

export interface ShellState {
  buildVersion: string;
  engineStatus: 'idle' | 'booting' | 'ready' | 'error';
  engineMessage?: string;
  hasMounts: boolean;
}

export function mountShell(root: HTMLElement, state: ShellState): void {
  injectStyles();
  root.classList.add('shell');
  root.innerHTML = '';
  root.append(renderHeader(state), renderBody(state), renderFooter(state));
}

function injectStyles(): void {
  if (document.getElementById('naklidata-shell-css')) return;
  const tag = document.createElement('style');
  tag.id = 'naklidata-shell-css';
  tag.textContent = shellCss;
  document.head.appendChild(tag);
}

function renderHeader(state: ShellState): HTMLElement {
  const el = document.createElement('header');
  el.className = 'shell-header';
  el.setAttribute('role', 'banner');
  el.innerHTML = `
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">${iconSvg('search', 18)}</span>
      <span>NakliData</span>
      <span class="crumb" title="Release tag and build revision">${escapeHtml(state.buildVersion)}</span>
    </div>
    <div class="session-switcher" data-region="session-switcher"></div>
    <div class="selections-bar" data-region="selections-bar" hidden></div>
    <div class="right">
      <!-- S5: the Search/spotlight affordance is not implemented — the button
           and its Ctrl+K binding toasted "not wired yet". Removed until built. -->
      <button class="btn btn-ghost" data-action="load" title="Open .naklidata">
        ${iconSvg('folder', 14)} <span>Open</span>
      </button>
      <button class="btn btn-ghost" data-action="save" aria-keyshortcuts="Control+S" title="Save .naklidata (Ctrl+S)">
        ${iconSvg('download', 14)} <span>Save</span>
      </button>
      <details class="header-menu" data-header-menu="workbook">
        <summary class="btn btn-ghost">${iconSvg('file', 14)} Workbook ${iconSvg('caret', 11)}</summary>
        <div class="header-menu-panel">
          <button class="btn btn-ghost" data-action="export-html" title="Export the notebook as a self-contained HTML file (markdown + charts + tables, no engine).">
            ${iconSvg('download', 14)} <span>Export HTML</span>
          </button>
          <button class="btn btn-ghost" data-action="embed-snippet" title="Get a sandboxed iframe snippet to embed this notebook read-only in a wiki or intranet.">
            ${iconSvg('link', 14)} <span>Embed read-only</span>
          </button>
          <button class="btn btn-ghost" data-action="share-link" title="Copy a data-free workbook-description link">
            ${iconSvg('link', 14)} <span>Copy data-free link</span>
          </button>
        </div>
      </details>
      <details class="header-menu" data-header-menu="explore">
        <summary class="btn btn-ghost">${iconSvg('chart', 14)} Explore ${iconSvg('caret', 11)}</summary>
        <div class="header-menu-panel">
          <button class="btn btn-ghost" data-action="open-query-builder" title="Visual query builder — filter, sort, group, and aggregate without writing SQL">
            ${iconSvg('plus', 14)} <span>Build query</span>
          </button>
          <button class="btn btn-ghost" data-action="open-lineage" title="Where does this number come from?">
            ${iconSvg('chart', 14)} <span>Lineage / impact</span>
          </button>
          <button class="btn btn-ghost" data-action="check-source-updates" title="Check whether mounted sources changed since the last successful check">
            ${iconSvg('download', 14)} <span>Check changes</span>
          </button>
        </div>
      </details>
      <details class="header-menu" data-header-menu="model">
        <summary class="btn btn-ghost">${iconSvg('table', 14)} Model ${iconSvg('caret', 11)}</summary>
        <div class="header-menu-panel">
          <button class="btn btn-ghost" data-action="open-measures" title="Measures, dimensions, and segments for SQL cells">
            ${iconSvg('table', 14)} <span>Semantic model</span>
          </button>
          <button class="btn btn-ghost" data-action="open-associations" title="Link columns so selections cross-filter related results">
            ${iconSvg('link', 14)} <span>Relationships</span>
          </button>
          <button class="btn btn-ghost" data-action="open-data-quality" title="Suggest, save, and explicitly run reusable data quality checks">
            ${iconSvg('check', 14)} <span>Data quality</span>
          </button>
        </div>
      </details>
      <button class="btn btn-ghost" data-action="open-settings" title="Connections, privacy, AI sidecar, and advanced settings">
        ${iconSvg('info', 14)} <span>Settings</span>
      </button>
      <button class="btn btn-ghost" data-action="open-help" title="Help &amp; orientation — key surfaces, keyboard shortcuts, and the full illustrated guide">
        ${iconSvg('question', 14)} <span>Help</span>
      </button>
      <button class="btn btn-primary present-exit" data-action="exit-presentation" title="Exit presentation mode and return to the workbench">
        ${iconSvg('x', 14)} <span>Exit presentation</span>
      </button>
    </div>
  `;
  return el;
}

/**
 * v1.3 M1 — render the selections bar in the shell header. Shown
 * only when at least one selection is active; clicking the Clear
 * button drops every selection via the action handler.
 */
export function renderSelectionsBar(
  root: HTMLElement,
  entries: ReadonlyArray<{ table: string; column: string; values: ReadonlyArray<string> }>,
): void {
  const mount = root.querySelector<HTMLElement>('[data-region="selections-bar"]');
  if (!mount) return;
  if (entries.length === 0) {
    mount.hidden = true;
    mount.innerHTML = '';
    return;
  }
  const chipsHtml = entries
    .map((e) => {
      const tail = e.values.length > 3 ? `, +${e.values.length - 3}` : '';
      const head = e.values.slice(0, 3).map(escapeHtml).join(', ');
      return `<span class="selection-chip">${escapeHtml(e.column)}: ${head}${tail}</span>`;
    })
    .join('');
  mount.hidden = false;
  // Styling lives in shell.css.ts (token-derived; forward-pass L6 — the
  // amber palette was hardcoded hex here, violating the tokens-only rule).
  mount.innerHTML = `
    <div class="selections-bar-inner">
      <strong class="selections-bar-label">Selection</strong>
      <div class="selection-chips">${chipsHtml}</div>
      <button class="btn btn-ghost" data-action="selections-clear" title="Clear all selections" style="font-size:11px;">Clear all</button>
    </div>
  `;
}

export function renderSessionSwitcher(root: HTMLElement, idx: SessionsIndex): void {
  const mount = root.querySelector<HTMLElement>('[data-region="session-switcher"]');
  if (!mount) return;
  const active = idx.sessions.find((s) => s.id === idx.activeId);
  const sorted = [...idx.sessions].sort((a, b) =>
    a.id === idx.activeId ? -1 : b.id === idx.activeId ? 1 : b.modified.localeCompare(a.modified),
  );
  const items = sorted
    .map((s) => {
      const isActive = s.id === idx.activeId;
      return `
        <li class="session-row ${isActive ? 'active' : ''}">
          <button class="session-pick" data-action="session-switch" data-session-id="${s.id}" title="Switch to this session">
            ${isActive ? `<span class="dot" aria-hidden="true">${iconSvg('check', 12)}</span>` : '<span class="dot dot-empty" aria-hidden="true"></span>'}
            <span class="name">${escapeHtml(s.name)}</span>
          </button>
          <button class="btn btn-ghost session-row-action" data-action="session-rename" data-session-id="${s.id}" title="Rename" aria-label="Rename">
            ${iconSvg('file', 12)}
          </button>
          <button class="btn btn-ghost session-row-action" data-action="session-delete" data-session-id="${s.id}" title="Delete" aria-label="Delete">
            ${iconSvg('x', 12)}
          </button>
        </li>`;
    })
    .join('');
  mount.innerHTML = `
    <button class="btn btn-ghost session-trigger" data-action="session-menu" aria-haspopup="menu" title="Switch session">
      <span class="session-name">${escapeHtml(active?.name ?? 'Untitled')}</span>
      ${iconSvg('caret', 12)}
    </button>
    <div class="session-menu" data-region="session-menu" role="menu">
      <button class="session-new" data-action="session-new">
        ${iconSvg('plus', 12)} <span>New session</span>
      </button>
      <ul>${items}</ul>
    </div>
  `;
}

function renderBody(state: ShellState): HTMLElement {
  const el = document.createElement('main');
  el.className = 'shell-body';
  el.setAttribute('role', 'main');
  el.append(renderSourcesPanel(), renderCenter(state), renderSchemaPanel());
  return el;
}

function renderSourcesPanel(): HTMLElement {
  const el = document.createElement('aside');
  el.className = 'panel sources-panel';
  el.setAttribute('aria-label', 'Sources');
  el.innerHTML = `
    <div class="panel-header">
      <button class="btn btn-ghost rail-toggle" data-action="toggle-sources-rail" title="Collapse Sources rail" aria-label="Collapse Sources rail" aria-expanded="true">${iconSvg('caret', 12)}</button>
      <span class="rail-title">Sources</span>
      <button class="btn btn-ghost rail-secondary" data-action="add-source" title="Add source">${iconSvg('plus', 14)}</button>
    </div>
    <div class="panel-body" data-region="sources-list">
      <p style="color: var(--text-muted); font-size: 12px; margin: 0;">No sources yet.</p>
    </div>
  `;
  return el;
}

function renderCenter(state: ShellState): HTMLElement {
  const el = document.createElement('section');
  el.className = 'center';
  el.setAttribute('aria-label', 'Notebook');
  renderCenterInner(el, state.hasMounts);
  return el;
}

function renderCenterInner(el: HTMLElement, hasMounts: boolean): void {
  // Only swap to empty state when there are no mounts. Once mounted, leave
  // the center alone so the notebook DOM survives subsequent re-renders.
  if (!hasMounts) {
    el.innerHTML = '';
    el.append(renderEmptyState());
    return;
  }
  if (!el.querySelector('[data-region="notebook"]')) {
    el.innerHTML = '';
    const mount = document.createElement('div');
    mount.setAttribute('data-region', 'notebook');
    el.append(mount);
  }
}

/**
 * The readiness-grouped mount options plus the "Try the demo" link. Shared
 * by the first-run empty state
 * AND the "+ Add source" modal (main.ts `openAddSourceModal`) so the two
 * offer an identical set of mount choices and never drift.
 */
export function mountOptionsHtml(): string {
  const groups = SOURCE_GROUPS.map((group) => {
    const options = SOURCE_OPTIONS.filter((option) => option.group === group.id)
      .map((option) => {
        const unavailable = option.readiness === 'unavailable';
        return `
          <button class="opt" data-action="${option.action}" data-readiness="${option.readiness}"
            title="${escapeHtml(option.title)}"${unavailable ? ' disabled aria-disabled="true"' : ''}>
            ${iconSvg(option.group === 'local' ? (option.id === 'folder' ? 'folder' : 'file') : 'link', 24)}
            <span class="label">${escapeHtml(option.label)}</span>
            <span class="hint">${escapeHtml(option.hint)}</span>
          </button>`;
      })
      .join('');
    return `
      <section class="source-option-group" aria-labelledby="source-group-${group.id}">
        <h2 id="source-group-${group.id}">${escapeHtml(group.label)}</h2>
        <p>${escapeHtml(group.description)}</p>
        <div class="options">${options}</div>
      </section>`;
  }).join('');
  return `
    <div class="source-option-groups">${groups}</div>
    <div class="examples-link">
      New here? <button data-action="browse-examples">Try the demo</button>.
    </div>
  `;
}

function renderEmptyState(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'empty-state';
  el.innerHTML = `
    <span aria-hidden="true" style="color: var(--accent);">${iconSvg('search', 36)}</span>
    <h1>What do you have?</h1>
    <p>Inspect local data, connect object storage, or try a deterministic demo. Remote connections are always explicit.</p>
    ${mountOptionsHtml()}
  `;
  return el;
}

function renderSchemaPanel(): HTMLElement {
  const el = document.createElement('aside');
  el.className = 'panel schema-panel-rail';
  el.setAttribute('aria-label', 'Schema');
  el.innerHTML = `
    <div class="panel-header">
      <button class="btn btn-ghost rail-toggle" data-action="toggle-schema-rail" title="Collapse Schema rail" aria-label="Collapse Schema rail" aria-expanded="true">${iconSvg('caret', 12)}</button>
      <span class="rail-title">Schema</span>
      <button class="btn btn-ghost rail-secondary" data-action="open-schema-graph" title="Show type relationships graph" aria-label="Show type relationships graph">
        ${iconSvg('chart', 12)}
      </button>
    </div>
    <div class="panel-body" data-region="schema-panel">
      <p style="color: var(--text-muted); font-size: 12px; margin: 0;">Mount a source to see types.</p>
    </div>
    <div class="templates-panel-header">
      <span>Suggested reports</span>
    </div>
    <div class="panel-body" data-region="templates-panel" style="flex: 0 0 auto;">
      <p style="color: var(--text-muted); font-size: 12px; margin: 0;">No mounts yet.</p>
    </div>
  `;
  return el;
}

function renderFooter(state: ShellState): HTMLElement {
  const el = document.createElement('footer');
  el.className = 'shell-footer';
  el.setAttribute('role', 'contentinfo');
  // Escape engineLabel at the innerHTML site here; subsequent updates via
  // `updateEngineStatus` assign the raw label to `.textContent`, which
  // would render escape entities literally if engineLabel pre-escaped.
  // (Forward-pass L6, 2026-06-02.)
  el.innerHTML = `
    <span class="status-dot ${state.engineStatus === 'ready' ? 'ready' : state.engineStatus === 'error' ? 'error' : 'busy'}" aria-hidden="true"></span>
    <span data-region="engine-status">${escapeHtml(engineLabel(state))}</span>
    <button class="btn btn-ghost storage-warning" data-region="storage-warning" data-action="save" hidden>Local changes not saved · Export now</button>
    <span class="privacy-summary" title="${escapeHtml(PRIVACY_POSTURE_COPY)}">Browser-local by default · remote and cloud actions are explicit</span>
  `;
  return el;
}

function engineLabel(state: ShellState): string {
  // Returns RAW text (no HTML escaping). Callers escape at the boundary:
  // innerHTML interpolations wrap with `escapeHtml(...)`; textContent
  // assignments use the value directly. See L6 in
  // plan/forward-pass-2026-06-02.md.
  switch (state.engineStatus) {
    case 'idle':
      return 'Engine: idle';
    case 'booting':
      return 'Engine: booting…';
    case 'ready':
      return 'Engine: ready';
    case 'error':
      return `Engine: error${state.engineMessage ? ` — ${state.engineMessage}` : ''}`;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderSourcesList(root: HTMLElement, sources: MountedSource[]): void {
  const region = root.querySelector<HTMLElement>('[data-region="sources-list"]');
  if (!region) return;
  if (sources.length === 0) {
    region.innerHTML = `<p style="color: var(--text-muted); font-size: 12px; margin: 0;">No sources yet.</p>`;
    return;
  }
  region.innerHTML = '';
  for (const src of sources) {
    region.append(renderSourceCard(src));
  }
}

function renderSourceCard(src: MountedSource): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'source-card';
  wrap.dataset.sourceId = src.id;
  // Demo mode (Theme 4 wave 2): mask source label, table names, and
  // the origin path tooltip so screenshots don't leak file paths or
  // user-defined names.
  const sourceLabel = maskLabel('source', src.label);
  const tableRows = src.tables
    .map(
      (t) => `
        <div class="source-row" data-table-id="${t.id}">
          <span aria-hidden="true">${iconSvg('table', 14)}</span>
          <span class="label" title="${escapeHtml(maskLabel('origin', t.origin))}">${escapeHtml(maskLabel('table', t.name))}</span>
          <span style="color: var(--text-muted); font-size: 11px;">${t.rowCount.toLocaleString()} row${t.rowCount === 1 ? '' : 's'}</span>
        </div>`,
    )
    .join('');
  wrap.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
      <span aria-hidden="true" style="color: var(--text-muted);">${iconSvg(src.kind === 'example-bundle' ? 'database' : src.kind === 'fsa-folder' ? 'folder' : 'file', 14)}</span>
      <strong style="font-size: 12px;" title="${escapeHtml(maskLabel('origin', provenanceSummary(src)))}">${escapeHtml(sourceLabel)}</strong>
      <button class="btn btn-ghost" data-action="remove-source" data-source-id="${src.id}" title="Remove source" style="margin-left:auto;padding:2px 4px;">${iconSvg('x', 12)}</button>
    </div>
    ${tableRows}
  `;
  return wrap;
}

export function setHasMounts(root: HTMLElement, hasMounts: boolean): void {
  const center = root.querySelector<HTMLElement>('.center');
  if (!center) return;
  renderCenterInner(center, hasMounts);
}

export function updateEngineStatus(
  root: HTMLElement,
  status: ShellState['engineStatus'],
  message?: string,
): void {
  const region = root.querySelector<HTMLElement>('[data-region="engine-status"]');
  const dot = root.querySelector<HTMLElement>('.shell-footer .status-dot');
  if (region) {
    region.textContent = engineLabel({
      buildVersion: '',
      engineStatus: status,
      ...(message !== undefined ? { engineMessage: message } : {}),
      hasMounts: false,
    });
  }
  if (dot) {
    dot.classList.remove('ready', 'busy', 'error');
    if (status === 'ready') dot.classList.add('ready');
    else if (status === 'error') dot.classList.add('error');
    else dot.classList.add('busy');
  }
}

export function updateStorageWarning(root: HTMLElement, visible: boolean): void {
  const warning = root.querySelector<HTMLElement>('[data-region="storage-warning"]');
  if (warning) warning.hidden = !visible;
}
