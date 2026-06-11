import { maskLabel } from '../core/demo-mode.ts';
import type { MountedSource } from '../core/mount.ts';
import type { SessionsIndex } from '../core/sessions.ts';
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
      <span class="crumb">v${state.buildVersion}</span>
    </div>
    <div class="session-switcher" data-region="session-switcher"></div>
    <div class="selections-bar" data-region="selections-bar" hidden></div>
    <div class="right">
      <button class="btn btn-ghost" data-action="spotlight" aria-keyshortcuts="Control+K" title="Search (Ctrl+K)">
        ${iconSvg('search', 14)} <span>Search</span>
      </button>
      <button class="btn btn-ghost" data-action="load" title="Open .naklidata">
        ${iconSvg('folder', 14)} <span>Open</span>
      </button>
      <button class="btn btn-ghost" data-action="save" aria-keyshortcuts="Control+S" title="Save .naklidata (Ctrl+S)">
        ${iconSvg('download', 14)} <span>Save</span>
      </button>
      <button class="btn btn-ghost" data-action="export-html" title="Export the notebook as a self-contained HTML file (markdown + charts + tables, no engine).">
        ${iconSvg('download', 14)} <span>Export HTML</span>
      </button>
      <button class="btn btn-ghost" data-action="share-link" title="Copy share link (no data, just the workbook description)">
        ${iconSvg('link', 14)} <span>Share</span>
      </button>
      <button class="btn btn-ghost" data-action="open-lineage" title="Where does this number come from? — cell lineage panel">
        ${iconSvg('chart', 14)} <span>Lineage</span>
      </button>
      <button class="btn btn-ghost" data-action="check-source-updates" title="Check whether mounted sources have changed since last save">
        ${iconSvg('download', 14)} <span>Refresh</span>
      </button>
      <button class="btn btn-ghost" data-action="open-query-builder" title="Visual query builder — filter, sort, group, aggregate without writing SQL">
        ${iconSvg('plus', 14)} <span>Build query</span>
      </button>
      <button class="btn btn-ghost" data-action="open-measures" title="Manage named measures — referenceable via MEASURE(name) in SQL cells">
        ${iconSvg('table', 14)} <span>Measures</span>
      </button>
      <button class="btn btn-ghost" data-action="open-associations" title="Link columns across cells so a selection in one cross-filters the others (associative model)">
        ${iconSvg('link', 14)} <span>Associations</span>
      </button>
      <button class="btn btn-ghost" data-action="open-settings" title="Settings — sidecar provider + BYOK keys">
        ${iconSvg('info', 14)} <span>Settings</span>
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
      return `<span class="selection-chip" style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:3px;font-size:11px;margin-right:6px;">${escapeHtml(e.column)}: ${head}${tail}</span>`;
    })
    .join('');
  mount.hidden = false;
  mount.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 12px;background:#fefce8;border-top:1px solid #fde68a;border-bottom:1px solid #fde68a;font-size:12px;">
      <strong style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#92400e;">Selection</strong>
      <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${chipsHtml}</div>
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
  el.className = 'panel';
  el.setAttribute('aria-label', 'Sources');
  el.innerHTML = `
    <div class="panel-header">
      <span>Sources</span>
      <button class="btn btn-ghost" data-action="add-source" title="Add source">${iconSvg('plus', 14)}</button>
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

function renderEmptyState(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'empty-state';
  el.innerHTML = `
    <span aria-hidden="true" style="color: var(--accent);">${iconSvg('search', 36)}</span>
    <h1>What do you have?</h1>
    <p>Point NakliData at a folder, a file, or paste a public data URL. Your data never leaves the tab.</p>
    <div class="options">
      <button class="opt" data-action="mount-folder">
        ${iconSvg('folder', 28)}
        <span class="label">Add folder</span>
        <span class="hint">Multi-file. Recommended.</span>
      </button>
      <button class="opt" data-action="mount-file">
        ${iconSvg('file', 28)}
        <span class="label">Add file</span>
        <span class="hint">Single CSV, Parquet, .xlsx, or SQLite.</span>
      </button>
      <button class="opt" data-action="mount-url" title="Mount a public HTTPS URL (CSV / TSV / JSONL / Parquet)">
        ${iconSvg('link', 28)}
        <span class="label">Paste URL</span>
        <span class="hint">Public CSV / Parquet over HTTPS.</span>
      </button>
      <button class="opt" data-action="mount-s3" title="Mount an S3-compatible bucket (AWS / R2 / B2 / MinIO / Wasabi)">
        ${iconSvg('link', 28)}
        <span class="label">Mount bucket</span>
        <span class="hint">S3-compatible. Keys session-default.</span>
      </button>
      <button class="opt" data-action="mount-iceberg" title="Mount an Apache Iceberg table by metadata URL (Bearer auth optional)">
        ${iconSvg('link', 28)}
        <span class="label">Iceberg table</span>
        <span class="hint">By metadata URL. Bearer optional.</span>
      </button>
      <button class="opt" data-action="mount-iceberg-catalog" title="Mount via an Apache Iceberg REST Catalog (Bearer auth)">
        ${iconSvg('link', 28)}
        <span class="label">Iceberg catalog</span>
        <span class="hint">REST + namespace.table.</span>
      </button>
      <button class="opt" data-action="mount-compute-bridge" title="Run SQL against a Compute Bridge in your VPC; result lands as a local DuckDB table">
        ${iconSvg('link', 28)}
        <span class="label">Compute Bridge</span>
        <span class="hint">SQL in-VPC, Arrow result.</span>
      </button>
      <button class="opt" data-action="mount-compute-bridge-catalog" title="Pick multiple tables from a Compute Bridge catalog; each becomes a local DuckDB table">
        ${iconSvg('link', 28)}
        <span class="label">Bridge catalog</span>
        <span class="hint">Browse + pick tables.</span>
      </button>
    </div>
    <div class="examples-link">
      Or <button data-action="browse-examples">browse example data</button>.
    </div>
  `;
  return el;
}

function renderSchemaPanel(): HTMLElement {
  const el = document.createElement('aside');
  el.className = 'panel';
  el.setAttribute('aria-label', 'Schema');
  el.innerHTML = `
    <div class="panel-header">
      <span>Schema</span>
      <button class="btn btn-ghost" data-action="open-schema-graph" title="Show type relationships graph" aria-label="Show type relationships graph">
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
    <span style="margin-left: auto;">Your data never leaves the tab.</span>
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
      <strong style="font-size: 12px;">${escapeHtml(sourceLabel)}</strong>
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
