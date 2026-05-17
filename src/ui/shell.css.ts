// Inlined CSS string. esbuild bundles this with the TS so the shell HTML
// references one stylesheet; no external CSS file in production.

import { Neutral } from '../tokens/colors.ts';
import { Radius, Shadow, Space, Type } from '../tokens/spacing.ts';

export const shellCss = `
:root {
  color-scheme: light;
  --bg: ${Neutral.bg};
  --surface: ${Neutral.surface};
  --surface-alt: ${Neutral.surfaceAlt};
  --border: ${Neutral.border};
  --border-strong: ${Neutral.borderStrong};
  --text: ${Neutral.text};
  --text-muted: ${Neutral.textMuted};
  --accent: ${Neutral.accent};
  --focus: ${Neutral.focus};
  --danger: ${Neutral.danger};
  --success: ${Neutral.success};
  --warning: ${Neutral.warning};
  --font: ${Type.family};
  --font-mono: ${Type.familyMono};
  --shadow-sm: ${Shadow.sm};
  --shadow-md: ${Shadow.md};
  --shadow-lg: ${Shadow.lg};
  --space-1: ${Space['1']};
  --space-2: ${Space['2']};
  --space-3: ${Space['3']};
  --space-4: ${Space['4']};
  --space-5: ${Space['5']};
  --space-6: ${Space['6']};
  --space-7: ${Space['7']};
  --space-8: ${Space['8']};
  --radius-sm: ${Radius.sm};
  --radius-md: ${Radius.md};
  --radius-lg: ${Radius.lg};
}

*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }
body {
  font-family: var(--font);
  font-size: ${Type.size.md};
  line-height: ${Type.lineHeight.normal};
  color: var(--text);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
}
button {
  font: inherit;
  color: inherit;
}
*:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Shell layout */
#app, .shell {
  display: grid;
  grid-template-rows: auto 1fr auto;
  grid-template-columns: 1fr;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}
.shell-header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-5);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  height: 44px;
}
.shell-header .brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-weight: ${Type.weight.semibold};
  letter-spacing: 0.01em;
}
.shell-header .brand-mark {
  color: var(--accent);
  display: inline-flex;
}
.shell-header .crumb {
  color: var(--text-muted);
  font-size: ${Type.size.sm};
}
.shell-header .right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.shell-body {
  display: grid;
  grid-template-columns: 240px 1fr 320px;
  overflow: hidden;
  min-height: 0;
}
.panel {
  background: var(--surface);
  border-right: 1px solid var(--border);
  overflow: auto;
  display: flex;
  flex-direction: column;
}
.panel:last-child {
  border-right: 0;
  border-left: 1px solid var(--border);
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border);
  font-weight: ${Type.weight.semibold};
  font-size: ${Type.size.sm};
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}
.panel-body {
  padding: var(--space-4) var(--space-5);
  flex: 1;
  overflow: auto;
}
.center {
  background: var(--bg);
  overflow: auto;
}

.shell-footer {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-5);
  background: var(--surface);
  border-top: 1px solid var(--border);
  font-size: ${Type.size.xs};
  color: var(--text-muted);
  height: 28px;
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: ${Type.size.md};
  transition: background 80ms ease, border-color 80ms ease;
}
.btn:hover { background: var(--surface-alt); border-color: var(--border-strong); }
.btn[disabled] { opacity: 0.5; cursor: not-allowed; }
.btn-primary {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}
.btn-primary:hover { background: #963115; border-color: #963115; }
.btn-ghost { background: transparent; border-color: transparent; }
.btn-ghost:hover { background: var(--surface-alt); }

.btn-stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-8);
  text-align: center;
  gap: var(--space-5);
  max-width: 560px;
  margin: 0 auto;
  margin-top: var(--space-9);
}
.empty-state h1 {
  font-size: ${Type.size.xxl};
  margin: 0;
  font-weight: ${Type.weight.semibold};
}
.empty-state p {
  color: var(--text-muted);
  margin: 0;
  max-width: 440px;
}
.empty-state .options {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-4);
  width: 100%;
  margin-top: var(--space-4);
}
.empty-state .opt {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-6) var(--space-4);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: background 80ms ease, border-color 80ms ease, transform 80ms ease;
}
.empty-state .opt:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
}
.empty-state .opt .label { font-weight: ${Type.weight.semibold}; }
.empty-state .opt .hint { color: var(--text-muted); font-size: ${Type.size.sm}; }
.empty-state .examples-link {
  margin-top: var(--space-4);
  color: var(--text-muted);
  font-size: ${Type.size.sm};
}
.empty-state .examples-link button {
  background: none; border: 0; color: var(--accent); cursor: pointer;
  text-decoration: underline; padding: 0; font: inherit;
}

/* Status dots */
.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
}
.status-dot.ready { background: var(--success); }
.status-dot.busy { background: var(--warning); }
.status-dot.error { background: var(--danger); }

/* Sources list */
.source-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px dashed var(--border);
}
.source-row:last-child { border-bottom: 0; }
.source-row .label {
  flex: 1;
  font-size: ${Type.size.sm};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Banner */
.banner {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-5);
  background: #FDECE3;
  color: var(--text);
  border-bottom: 1px solid var(--border);
}
.banner.danger { background: #F6D6D3; }
.banner button { margin-left: auto; }

/* Session switcher (header dropdown) */
.session-switcher {
  position: relative;
}
.session-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);
}
.session-trigger .session-name {
  font-weight: ${Type.weight.semibold};
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 280px;
  max-width: 360px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  padding: var(--space-2);
  display: none;
  z-index: 50;
}
.session-menu[data-open] { display: block; }
.session-menu .session-new {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font: inherit;
  text-align: left;
  color: var(--accent);
}
.session-menu .session-new:hover { background: var(--surface-alt); }
.session-menu ul {
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: var(--space-2) 0 0;
  border-top: 1px solid var(--border);
}
.session-menu .session-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.session-menu .session-row.active .name { font-weight: ${Type.weight.semibold}; }
.session-menu .session-pick {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 1;
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font: inherit;
  text-align: left;
  color: inherit;
  min-width: 0;
}
.session-menu .session-pick:hover { background: var(--surface-alt); }
.session-menu .session-pick .name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-menu .session-pick .dot { color: var(--success); display: inline-flex; }
.session-menu .session-pick .dot-empty { width: 12px; height: 12px; }
.session-menu .session-row-action {
  padding: var(--space-1);
  color: var(--text-muted);
}
.session-menu .session-row-action:hover { color: var(--text); }

/* Schema-graph modal (Cytoscape-rendered type relationships) */
.schema-graph-overlay {
  position: fixed;
  inset: 0;
  background: rgba(31, 27, 22, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: var(--space-5);
}
.schema-graph-modal {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  width: min(1080px, 100%);
  height: min(720px, 100%);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.schema-graph-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-5);
  border-bottom: 1px solid var(--border);
}
.schema-graph-status {
  color: var(--text-muted);
  font-size: ${Type.size.sm};
  margin-right: auto;
}
.schema-graph-close {
  padding: var(--space-1);
}
.schema-graph-canvas {
  flex: 1;
  min-height: 0;
  background: var(--bg);
}
`;
