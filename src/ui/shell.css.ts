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

/* Settings modal — reuses .schema-graph-overlay + .schema-graph-modal
   with .settings-overlay / .settings-modal modifiers for layout tweaks. */
.settings-modal {
  width: min(720px, 100%);
  height: auto;
  max-height: 90vh;
}
.settings-body {
  padding: var(--space-5);
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
.settings-section h2 {
  margin: 0 0 var(--space-3);
  font-size: ${Type.size.md};
  font-weight: ${Type.weight.semibold};
}
.settings-radio-row {
  display: flex;
  gap: var(--space-5);
  margin-bottom: var(--space-3);
}
.settings-radio-row label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  cursor: pointer;
}
.settings-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}
.settings-field span {
  font-size: ${Type.size.sm};
  color: var(--text-muted);
}
.settings-field input {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font: inherit;
  background: var(--surface);
}
.settings-remember {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  cursor: pointer;
  font-size: ${Type.size.sm};
  margin: var(--space-2) 0;
}
.settings-provider-block {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  margin-bottom: var(--space-3);
  background: var(--surface);
}
.settings-provider-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
}
.settings-active-pill {
  font-size: ${Type.size.xs};
  background: var(--accent);
  color: white;
  padding: 2px 8px;
  border-radius: 999px;
}
.settings-provider-status {
  font-size: ${Type.size.sm};
  color: var(--text-muted);
  margin-bottom: var(--space-3);
}
.settings-hint {
  font-size: ${Type.size.xs};
  color: var(--text-muted);
  margin: var(--space-2) 0 0;
}
.settings-actions {
  display: flex;
  gap: var(--space-3);
  margin-top: var(--space-3);
}

/* Sidecar — Explain-this-error UI on errored SQL cells.
   Hidden by default; shown when the app root has .app-sidecar-enabled. */
.cell-output-error-actions {
  margin-top: var(--space-2);
  display: flex;
  gap: var(--space-2);
}
.cell-sidecar-trigger {
  font-size: ${Type.size.sm};
  display: none;
}
.app-sidecar-enabled .cell-sidecar-trigger {
  display: inline-flex;
}
.cell-sidecar-result {
  margin-top: var(--space-3);
}
.cell-sidecar-result:empty {
  display: none;
}
.cell-sidecar-loading {
  color: var(--text-muted);
  font-size: ${Type.size.sm};
}
.cell-sidecar-explanation {
  background: var(--surface-alt);
  border-left: 3px solid var(--accent);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-sm);
  font-size: ${Type.size.sm};
  line-height: 1.55;
  white-space: pre-wrap;
}
.cell-sidecar-suggested {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: var(--space-3);
  margin: var(--space-3) 0 var(--space-2);
  overflow: auto;
  font-size: ${Type.size.sm};
  font-family: var(--font-mono);
}
.cell-sidecar-footnote {
  color: var(--text-muted);
  font-size: ${Type.size.xs};
  margin-top: var(--space-2);
}
.cell-sidecar-error {
  background: #F6D6D3;
  color: var(--text);
  border-radius: var(--radius-sm);
  padding: var(--space-3);
  font-size: ${Type.size.sm};
}

/* Define-new-type modal — reuses .schema-graph-overlay + .schema-graph-modal
   with a column-split body (sample context on the left, form on the right). */
.define-type-modal {
  width: min(880px, 100%);
  height: auto;
  max-height: 90vh;
}
.define-type-body {
  padding: var(--space-5);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-5);
  overflow: auto;
}
.define-type-context,
.define-type-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.define-type-context textarea,
.define-type-form textarea,
.define-type-context input,
.define-type-form input {
  font-family: var(--font-mono);
  font-size: ${Type.size.sm};
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.define-type-context input:disabled,
.define-type-context textarea:disabled {
  background: var(--surface-alt);
  color: var(--text-muted);
}

/* Wave 2 slice 1 — Mount URL modal. Compact form: label + URL +
   help + actions. Reuses .schema-graph-overlay + .schema-graph-modal. */
.mount-url-modal {
  width: min(540px, 100%);
  height: auto;
  max-height: 90vh;
}
.mount-url-body {
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.mount-url-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: ${Type.size.sm};
}
.mount-url-field span {
  color: var(--text-muted);
}
.mount-url-field em {
  color: var(--text-muted);
  font-style: normal;
}
.mount-url-field input,
.mount-url-field textarea {
  font-family: var(--font-mono);
  font-size: ${Type.size.sm};
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.mount-url-field textarea {
  resize: vertical;
  line-height: 1.4;
}
.mount-url-hint {
  margin: 0;
  font-size: ${Type.size.sm};
  color: var(--text-muted);
  line-height: 1.5;
}
.mount-url-hint code {
  font-family: var(--font-mono);
  background: var(--surface-alt);
  padding: 0 var(--space-1);
  border-radius: var(--radius-sm);
}
.mount-url-error {
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-3);
  font-size: ${Type.size.sm};
  color: var(--danger);
}
.mount-url-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
}

/* Wave 2 slice 2 — Mount S3-compatible bucket modal. Wider than
   mount-url to fit the two-column field rows. Same base styles. */
.mount-s3-modal {
  width: min(720px, 100%);
  height: auto;
  max-height: 90vh;
}
.mount-s3-body {
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  overflow: auto;
}
.mount-s3-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}
.mount-s3-row .mount-url-field {
  min-width: 0;
}
.mount-url-field select {
  font-family: inherit;
  font-size: ${Type.size.sm};
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.mount-s3-remember {
  flex-direction: row;
  align-items: flex-start;
  gap: var(--space-2);
}
.mount-s3-remember input[type="checkbox"] {
  flex: 0 0 auto;
  margin-top: 4px;
}
.mount-s3-remember span {
  color: var(--text);
  font-size: ${Type.size.sm};
  line-height: 1.4;
}
.mount-s3-remember em {
  display: block;
  margin-top: 2px;
  color: var(--text-muted);
  font-style: normal;
}

/* Settings — Test connection (custom endpoint). Inline button + result
   row beneath the URL input. */
.settings-test-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
.settings-test-result {
  font-size: ${Type.size.sm};
  color: var(--text-muted);
}
.settings-test-result[data-state='ok'] {
  color: var(--ok, #5a8f4a);
}
.settings-test-result[data-state='error'] {
  color: var(--danger);
}
.settings-test-result[data-state='pending'] {
  color: var(--text-muted);
  font-style: italic;
}
/* Forward-pass M3 (2026-06-02): inline host + warning under the
   custom-endpoint URL field. Host chip is green (matches the inline
   "ok" cue elsewhere); warning is red and stays visible until the
   URL is valid. */
.settings-endpoint-host {
  margin-top: var(--space-2);
  font-size: ${Type.size.xs};
  color: var(--ok, #5a8f4a);
  font-family: var(--font-mono);
  word-break: break-all;
}
.settings-endpoint-warn {
  margin-top: var(--space-2);
  font-size: ${Type.size.xs};
  color: var(--danger);
}
/* W3.2 slice B chunk 3: local-model picker + cache UI. */
.settings-local-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
.settings-local-option {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 4px);
  cursor: pointer;
}
.settings-local-option strong {
  display: block;
  font-size: ${Type.size.sm};
}
.settings-local-option em {
  display: block;
  margin-top: 2px;
  font-style: normal;
  font-size: ${Type.size.xs};
  color: var(--text-muted);
}
.settings-local-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
.settings-local-status {
  margin-top: var(--space-2);
  padding: var(--space-2);
  background: var(--surface-alt);
  border-radius: var(--radius-md, 4px);
  font-size: ${Type.size.xs};
  font-family: var(--font-mono);
  color: var(--text-muted);
}
.settings-local-cache {
  margin-top: var(--space-3);
}
.settings-local-cache-empty {
  margin: 0;
  font-size: ${Type.size.xs};
  color: var(--text-muted);
  font-style: italic;
}
.settings-local-cache-header {
  font-size: ${Type.size.xs};
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: var(--space-2);
}
.settings-local-cache-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.settings-local-cache-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  background: var(--surface-alt);
  border-radius: var(--radius-md, 4px);
  font-size: ${Type.size.xs};
}
.settings-local-cache-id {
  font-family: var(--font-mono);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.settings-local-cache-size {
  color: var(--text-muted);
  white-space: nowrap;
}

/* Wave 2 slice 3a — Mount Iceberg table. Same modal width as
   mount-url-modal (fewer fields than mount-s3); body uses .mount-s3-body
   so we can share the row + remember styles. */
.mount-iceberg-modal {
  width: min(620px, 100%);
  height: auto;
  max-height: 90vh;
}

/* Wave 3 W3.4b — Compute Bridge catalog table picker. Row layout:
   checkbox + table name + column summary on the left, row-cap input on
   the right. Reuses .mount-iceberg-modal width via shared class. */
.mount-url-divider {
  border: none;
  border-top: 1px solid var(--border);
  margin: var(--space-3) 0 0;
}
.mount-bridge-catalog-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  max-height: 320px;
  overflow: auto;
  padding: var(--space-2) 0;
}
.mount-bridge-catalog-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-alt);
}
.mount-bridge-catalog-pick {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-direction: row;
  min-width: 0;
  flex: 1 1 auto;
}
.mount-bridge-catalog-pick input[type='checkbox'] {
  flex: 0 0 auto;
}
.mount-bridge-catalog-name {
  font-size: ${Type.size.sm};
  color: var(--text);
}
.mount-bridge-catalog-cols {
  font-size: ${Type.size.xs};
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1 1 auto;
}
.mount-bridge-catalog-cap {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex: 0 0 auto;
}
.mount-bridge-catalog-cap span {
  font-size: ${Type.size.xs};
  color: var(--text-muted);
}
.mount-bridge-catalog-cap input[type='number'] {
  width: 96px;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: ${Type.size.sm};
  background: var(--surface);
}

/* ────────────────────────────────────────────────────────────────────
   W6.2 — Presentation mode (?present=1). Hex app-publish pattern.
   .app-present-mode toggles a read-only "deck" view: SQL/cohort/
   assertion cells, sidebars, the notebook toolbar, the cell-add row,
   and per-cell edit/delete chrome are hidden. Markdown + chart +
   pivot + map cells keep rendering their output.
   ──────────────────────────────────────────────────────────────────── */

/* The Exit-presentation pill is the inverse of every other affordance:
   shown ONLY in presentation mode, hidden by default. */
.present-exit {
  display: none;
}
.app-present-mode .present-exit {
  display: inline-flex;
}

.app-present-mode {
  /* Center the notebook in a wider column — the side panels are gone. */
}
.app-present-mode .shell-header .right > *:not(.present-exit) {
  display: none;
}
.app-present-mode .shell-header .session-switcher {
  display: none;
}
.app-present-mode .shell-body > aside.panel {
  display: none;
}
.app-present-mode .shell-body {
  /* Recentre the body when both side panels are hidden. */
  grid-template-columns: 1fr;
}
.app-present-mode .center {
  max-width: 960px;
  margin: 0 auto;
  padding: 0 var(--space-5);
}
.app-present-mode .notebook-toolbar {
  display: none;
}
.app-present-mode .cell-add-row {
  display: none;
}
.app-present-mode .cell[data-cell-kind='sql'],
.app-present-mode .cell[data-cell-kind='cohort'],
.app-present-mode .cell[data-cell-kind='assertion'] {
  display: none;
}
.app-present-mode .cell .cell-head {
  display: none;
}
.app-present-mode .cell .cell-editor {
  display: none;
}
.app-present-mode .cell .cell-result-meta {
  display: none;
}
.app-present-mode .cell .cell-output-error,
.app-present-mode .cell .cell-output-error-actions,
.app-present-mode .cell .cell-sidecar-result {
  display: none;
}
/* The send-to bar lives at the bottom of SQL cell renders (also used
   by cohort/assertion via the wrapper). Hide it on chart/pivot/map
   cells that don't render it anyway. The .cell selector keeps the
   rule scoped. */
.app-present-mode .cell > div:last-child:has(.btn-ghost[title*='Send result']) {
  display: none;
}
/* Markdown cells: hide the textarea (edit mode) and keep the preview.
   The markdown cell auto-renders preview when code is non-empty. */
.app-present-mode .cell[data-cell-kind='markdown'] textarea {
  display: none;
}
/* The cell border + background look heavy in presentation. Strip down
   to just the content; let the markdown/chart shine. */
.app-present-mode .cell {
  border: 0;
  background: transparent;
  box-shadow: none;
}

/* M2 — Cell Lineage panel.
   Two-column layout: accessible list on the left, SVG enhancement
   on the right. Reuses .schema-graph-overlay + .schema-graph-modal
   for the chrome. */
.lineage-section-h {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  margin: var(--space-3) 0 var(--space-1) 0;
}
.lineage-section {
  list-style: none;
  margin: 0 0 var(--space-2) 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.lineage-row {
  list-style: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: var(--space-2) var(--space-3);
  background: var(--surface);
}
.lineage-row:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.lineage-row-head {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  justify-content: space-between;
}
.lineage-row-name {
  font-size: 13px;
  color: var(--text);
}
.lineage-row-ref {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
  word-break: break-all;
}
.lineage-kind-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 600;
}
.lineage-kind-source {
  background: #eff6ff;
  color: #1e40af;
}
.lineage-kind-cell {
  background: #fffbeb;
  color: #92400e;
}
.lineage-kind-sink {
  background: #f0fdf4;
  color: #166534;
}
.lineage-edges {
  list-style: none;
  margin: var(--space-1) 0 0 0;
  padding: 0 0 0 var(--space-3);
  font-size: 12px;
  color: var(--text-muted);
}
.lineage-edge {
  list-style: none;
  display: flex;
  gap: var(--space-1);
  align-items: center;
  padding: 1px 0;
}
.lineage-arrow {
  color: var(--accent);
  font-weight: bold;
}
.lineage-edge-low .lineage-arrow {
  color: var(--text-muted);
}
.lineage-low {
  font-size: 10px;
  color: var(--text-muted);
  font-style: italic;
}
.lineage-empty {
  font-style: italic;
  color: var(--text-muted);
  list-style: none;
}
.lineage-svg-node:focus rect {
  stroke-width: 2;
}
/* v1.3 M6 Phase 2 — lineage edit mode. */
.lineage-edit-hint {
  margin: 0 0 var(--space-3) 0;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--surface-alt);
  border-left: 2px solid var(--accent);
  padding: 6px 8px;
  border-radius: 4px;
}
.lineage-del-btn {
  margin-left: auto;
  padding: 2px 6px;
  color: var(--text-muted);
}
.lineage-del-btn:hover { color: var(--danger); }
.lineage-del-confirm {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 11px;
  color: var(--danger);
}
.lineage-del-msg { color: var(--text); }
.lineage-del-confirm .btn { font-size: 11px; padding: 2px 8px; }
.lineage-del-go { color: var(--danger); border-color: var(--danger); }
.lineage-insert {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 8px;
}
.lineage-insert-kind { font-size: 11px; }
.lineage-insert-go { font-size: 11px; padding: 1px 6px; color: var(--accent); }
/* v1.3 M1 Phase 2 — associations modal. */
.assoc-body { padding: var(--space-4) var(--space-5); overflow: auto; }
.assoc-section { margin-bottom: var(--space-4); }
.assoc-h {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  margin: 0 0 var(--space-2) 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.assoc-count {
  background: var(--surface-alt);
  border-radius: 999px;
  padding: 0 7px;
  font-size: 10px;
  color: var(--text-muted);
}
.assoc-form { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.assoc-form select { font-size: 12px; flex: 1 1 200px; min-width: 0; }
.assoc-link-glyph { color: var(--text-muted); display: inline-flex; }
.assoc-list { list-style: none; margin: 0; padding: 0; }
.assoc-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.assoc-pair { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.assoc-row .btn { margin-left: auto; font-size: 11px; padding: 2px 10px; }
.assoc-add { color: var(--accent); }
.assoc-unlink { color: var(--text-muted); }
.assoc-unlink:hover { color: var(--danger); }
.assoc-empty { color: var(--text-muted); font-size: 12px; margin: var(--space-1) 0; }
/* v1.3 M1 — selections bar (forward-pass L6: token-derived, was hardcoded amber). */
.selections-bar-inner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 12px;
  background: color-mix(in srgb, var(--warning) 12%, var(--surface));
  border-top: 1px solid color-mix(in srgb, var(--warning) 40%, var(--surface));
  border-bottom: 1px solid color-mix(in srgb, var(--warning) 40%, var(--surface));
}
.selections-bar-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
  color: color-mix(in srgb, var(--warning) 65%, var(--text));
}
.selection-chips { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.selection-chip {
  background: color-mix(in srgb, var(--warning) 26%, var(--surface));
  color: var(--text);
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 11px;
  margin-right: 6px;
}
`;
