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
      <button class="btn btn-ghost" data-action="share-link" title="Copy share link (no data, just the workbook description)">
        ${iconSvg('link', 14)} <span>Share</span>
      </button>
    </div>
  `;
  return el;
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
      <button class="opt" data-action="mount-url" disabled title="v1.1">
        ${iconSvg('link', 28)}
        <span class="label">Paste URL</span>
        <span class="hint">v1.1</span>
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
  el.innerHTML = `
    <span class="status-dot ${state.engineStatus === 'ready' ? 'ready' : state.engineStatus === 'error' ? 'error' : 'busy'}" aria-hidden="true"></span>
    <span data-region="engine-status">${engineLabel(state)}</span>
    <span style="margin-left: auto;">Your data never leaves the tab.</span>
  `;
  return el;
}

function engineLabel(state: ShellState): string {
  switch (state.engineStatus) {
    case 'idle':
      return 'Engine: idle';
    case 'booting':
      return 'Engine: booting…';
    case 'ready':
      return 'Engine: ready';
    case 'error':
      return `Engine: error${state.engineMessage ? ` — ${escapeHtml(state.engineMessage)}` : ''}`;
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
  const tableRows = src.tables
    .map(
      (t) => `
        <div class="source-row" data-table-id="${t.id}">
          <span aria-hidden="true">${iconSvg('table', 14)}</span>
          <span class="label" title="${escapeHtml(t.origin)}">${escapeHtml(t.name)}</span>
          <span style="color: var(--text-muted); font-size: 11px;">${t.rowCount.toLocaleString()} row${t.rowCount === 1 ? '' : 's'}</span>
        </div>`,
    )
    .join('');
  wrap.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
      <span aria-hidden="true" style="color: var(--text-muted);">${iconSvg(src.kind === 'example-bundle' ? 'database' : src.kind === 'fsa-folder' ? 'folder' : 'file', 14)}</span>
      <strong style="font-size: 12px;">${escapeHtml(src.label)}</strong>
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
