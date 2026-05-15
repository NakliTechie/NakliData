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
  if (document.getElementById('naklios-shell-css')) return;
  const tag = document.createElement('style');
  tag.id = 'naklios-shell-css';
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
      <span>naklios</span>
      <span class="crumb">v${state.buildVersion}</span>
    </div>
    <div class="right">
      <button class="btn btn-ghost" data-action="spotlight" aria-keyshortcuts="Control+K" title="Search (Ctrl+K)">
        ${iconSvg('search', 14)} <span>Search</span>
      </button>
      <button class="btn btn-ghost" data-action="save" aria-keyshortcuts="Control+S" title="Save .naklilens (Ctrl+S)" disabled>
        ${iconSvg('download', 14)} <span>Save</span>
      </button>
    </div>
  `;
  return el;
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
  if (!state.hasMounts) {
    el.append(renderEmptyState());
  } else {
    const ph = document.createElement('div');
    ph.style.padding = '24px';
    ph.innerHTML = `
      <p style="color: var(--text-muted);">Notebook will appear here. Click "+ SQL" to start, or pick a report template.</p>
    `;
    el.append(ph);
  }
  return el;
}

function renderEmptyState(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'empty-state';
  el.innerHTML = `
    <span aria-hidden="true" style="color: var(--accent);">${iconSvg('search', 36)}</span>
    <h1>What do you have?</h1>
    <p>Point naklios at a folder, a file, or paste a public data URL. Your data never leaves the tab.</p>
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
    </div>
    <div class="panel-body" data-region="schema-panel">
      <p style="color: var(--text-muted); font-size: 12px; margin: 0;">Mount a source to see types.</p>
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
      return `Engine: error${state.engineMessage ? ` — ${escape(state.engineMessage)}` : ''}`;
  }
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
