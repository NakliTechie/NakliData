// W6.3 — Static-HTML export sink.
//
// Renders the active notebook as a single, self-contained .html file
// with no JS, no engine dependency. Evidence Dev's "publish to static
// site" pattern, minus the static site — one file the user can email,
// drop into a doc, or pin in a wiki.
//
// Strategy: walk the live notebook DOM (under [data-region="notebook"])
// and pull out each cell's RESULT portion — markdown preview, chart
// SVG, pivot HTML table, SQL result table. SQL/cohort/assertion cells
// are folded into <details> blocks (their queries are still useful
// context for a reviewer even though they're not the headline output).
// Map cells become a placeholder note ("interactive map omitted").
//
// Embedded CSS is hand-rolled and very small (~3 KB). We do NOT embed
// the shell.css.ts bundle — most of it is editor chrome that's
// pointless without the engine.

import type { MountedSource } from '../core/mount.ts';
import { describeSource } from '../core/source-provenance.ts';
import { renderMarkdownToHtml } from './cells/markdown-cell.ts';

export interface ExportOpts {
  /** Notebook root node (the element with `[data-region="notebook"]`). */
  notebookRoot: HTMLElement;
  /** Human-readable name for the doc title + filename suggestion. */
  title?: string;
  /** ISO timestamp string for the "Exported on" footer. Default: now. */
  exportedAt?: string;
  /** Mounted sources — rendered as a "Sources" provenance block (Tier-2 #11). */
  sources?: MountedSource[];
}

/** A "Sources" provenance section for the leadership-packet header. */
function buildSourcesHtml(sources: MountedSource[] | undefined): string {
  if (!sources || sources.length === 0) return '';
  const items = sources
    .map((src) => {
      const p = describeSource(src);
      const loc = p.location ? ` — <code>${esc(p.location)}</code>` : '';
      const tables = p.tables
        .map(
          (t) => `<li>${esc(t.name)} · ${esc(t.format)} · ${t.rowCount.toLocaleString()} rows</li>`,
        )
        .join('');
      return `<li><strong>${esc(p.label)}</strong> <span class="src-kind">${esc(p.kindLabel)}</span>${loc}<ul>${tables}</ul></li>`;
    })
    .join('');
  return `<section class="provenance"><h2>Sources</h2><ul class="src-list">${items}</ul></section>`;
}

export function buildStandaloneHtml(opts: ExportOpts): string {
  const title = (opts.title?.trim() || 'NakliData notebook').slice(0, 200);
  const exportedAt = opts.exportedAt ?? new Date().toISOString();

  // Walk TOP-LEVEL cells only — descendants of `.dashboard-slot` re-mount
  // their referenced cells inside the slot DOM (same `.cell` class), so a
  // naive `notebookRoot.querySelectorAll('.cell')` previously emitted those
  // embedded copies as separate sections AND dropped the dashboard grid
  // itself. (Codex review surfaced — 2026-05-31.)
  //
  // The notebook DOM is `[data-region="notebook"] > .notebook > {toolbar,
  // .cell..., .cell-add-row}`. So iterate children of `.notebook`.
  const notebookContainer =
    opts.notebookRoot.querySelector<HTMLElement>('.notebook') ?? opts.notebookRoot;
  const cells = Array.from(notebookContainer.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('cell'),
  );
  const cellHtml: string[] = [];
  let mdCount = 0;
  let chartCount = 0;
  let tableCount = 0;
  let sqlCount = 0;
  for (const cell of cells) {
    const kind = cell.dataset.cellKind ?? 'unknown';
    const name = cell.querySelector<HTMLInputElement>('[data-region="cell-name"]')?.value?.trim();
    const heading = name ? `<h3 class="cell-name">${esc(name)}</h3>` : '';
    if (kind === 'markdown') {
      // Preferred path: `.markdown-preview` is the rendered HTML and
      // already escape-htmls user content (see markdown-cell.ts).
      // Fall back to the textarea's `.value` if the cell is currently
      // in EDIT mode (no preview yet rendered) — re-run the same
      // markdown renderer the cell uses, so the export reflects what
      // the user has typed. (Codex review surfaced — 2026-05-31.)
      const preview = cell.querySelector('.markdown-preview');
      let body = '';
      if (preview) {
        body = preview.innerHTML;
      } else {
        const ta = cell.querySelector<HTMLTextAreaElement>('textarea');
        body = ta?.value ? renderMarkdownToHtml(ta.value) : '';
      }
      cellHtml.push(
        `<section class="cell md">${heading}<div class="md-body">${body}</div></section>`,
      );
      mdCount++;
      continue;
    }
    if (kind === 'chart') {
      const svg = cell.querySelector('svg');
      if (svg) {
        cellHtml.push(`<section class="cell chart">${heading}${svg.outerHTML}</section>`);
        chartCount++;
      } else {
        cellHtml.push(
          `<section class="cell chart-empty">${heading}<div class="note">(Chart not rendered.)</div></section>`,
        );
      }
      continue;
    }
    if (kind === 'pivot') {
      const table = cell.querySelector('.pivot-table, table');
      if (table) {
        cellHtml.push(`<section class="cell pivot">${heading}${table.outerHTML}</section>`);
        tableCount++;
      }
      continue;
    }
    if (kind === 'map') {
      cellHtml.push(
        `<section class="cell map-note">${heading}<div class="note">Interactive map omitted in static export.</div></section>`,
      );
      continue;
    }
    if (kind === 'dashboard') {
      // Walk the dashboard's slot children and serialise each. Each slot
      // contains a re-rendered copy of its referenced cell — pull the
      // inner SVG / markdown preview / table out and place it in a grid
      // slot of the exported HTML. Without this branch we'd silently
      // drop the dashboard from the export. (Codex review.)
      const grid = cell.querySelector<HTMLElement>('.dashboard-grid');
      const cols = grid ? window.getComputedStyle(grid).gridTemplateColumns.split(' ').length : 2;
      const slots = grid ? Array.from(grid.querySelectorAll<HTMLElement>('.dashboard-slot')) : [];
      const slotHtml: string[] = [];
      for (const slot of slots) {
        // Each slot embeds one cell; figure out what kind by sniffing.
        const innerSvg = slot.querySelector('svg');
        const innerPreview = slot.querySelector('.markdown-preview');
        const innerTable = slot.querySelector('table');
        if (innerPreview) {
          slotHtml.push(`<div class="dashboard-slot">${innerPreview.outerHTML}</div>`);
        } else if (innerSvg) {
          slotHtml.push(`<div class="dashboard-slot">${innerSvg.outerHTML}</div>`);
        } else if (innerTable) {
          slotHtml.push(`<div class="dashboard-slot">${innerTable.outerHTML}</div>`);
        } else {
          // Empty / not-yet-resolved slot — preserve the affordance text.
          const noteText = slot.textContent?.trim() ?? '';
          slotHtml.push(
            `<div class="dashboard-slot empty"><div class="note">${esc(noteText)}</div></div>`,
          );
        }
      }
      cellHtml.push(
        `<section class="cell dashboard">${heading}<div class="dashboard-grid" style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:12px;">${slotHtml.join('')}</div></section>`,
      );
      continue;
    }
    if (kind === 'input') {
      // Input cells are interactive parameters; in a static export
      // there's nothing to interact with. Surface the value as a
      // labelled chip so the reader knows what value the rest of the
      // notebook was computed against.
      const widget = cell.querySelector<HTMLInputElement | HTMLSelectElement>(
        '[data-region="input-widget"] input, [data-region="input-widget"] select',
      );
      const label =
        cell.querySelector<HTMLElement>('.cell-input-body label')?.textContent?.trim() ?? '';
      const value = widget?.value ?? '';
      cellHtml.push(
        `<section class="cell input-note">${heading}<div class="note"><strong>${esc(label)}</strong> ${esc(value)}</div></section>`,
      );
      continue;
    }
    if (kind === 'sql' || kind === 'cohort' || kind === 'assertion') {
      // CM6 stores live text in .cm-content (contenteditable). For the
      // textarea fallback we must read `.value` — `.textContent` on a
      // <textarea> returns the INITIAL/default content, not the user's
      // edits. (Audit-surfaced bug: previously read .textContent here
      // and silently embedded stale SQL in the exported HTML.)
      const cm = cell.querySelector<HTMLElement>('.cm-content');
      const ta = cell.querySelector<HTMLTextAreaElement>('textarea');
      const sql = cm?.textContent ?? ta?.value ?? '';
      const resultTable = cell.querySelector('.result-table');
      // The result-meta block contains the row-count + elapsed + a
      // "Summarise" button (when sidecar enabled). Strip out anything
      // inside a button so the exported <details> summary doesn't end
      // with a spurious "Summarise" word. (Audit follow-up.)
      const metaEl = cell.querySelector('.cell-result-meta');
      const metaParts: string[] = [];
      if (metaEl) {
        for (const span of metaEl.querySelectorAll('span')) {
          const t = span.textContent?.trim();
          if (t) metaParts.push(t);
        }
      }
      const meta = metaParts.join(' · ');
      const summary = `${kind.toUpperCase()}${name ? ` · ${esc(name)}` : ''}${meta ? ` · ${esc(meta)}` : ''}`;
      const inner = [
        sql ? `<pre class="sql"><code>${esc(sql)}</code></pre>` : '',
        resultTable ? resultTable.outerHTML : '',
      ].join('\n');
      cellHtml.push(
        `<section class="cell sql"><details><summary>${esc(summary)}</summary>${inner}</details></section>`,
      );
      if (resultTable) tableCount++;
      sqlCount++;
    }
  }

  const summaryLine = [
    mdCount && `${mdCount} markdown`,
    chartCount && `${chartCount} chart${chartCount === 1 ? '' : 's'}`,
    tableCount && `${tableCount} table${tableCount === 1 ? '' : 's'}`,
    sqlCount && `${sqlCount} SQL`,
  ]
    .filter(Boolean)
    .join(' · ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--ink:#101113;--muted:#6b6f76;--surface:#fafafa;--border:#e5e7eb;--accent:#0a66c2}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;padding:48px 24px;background:#fff;color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:880px;margin:0 auto}
header{margin-bottom:32px;padding-bottom:16px;border-bottom:1px solid var(--border)}
header h1{margin:0 0 4px;font-size:24px;font-weight:600}
header .meta{color:var(--muted);font-size:13px}
.cell{margin:24px 0}
.cell.md h1,.cell.md h2,.cell.md h3{margin-top:24px;margin-bottom:8px;font-weight:600}
.cell.md h1{font-size:22px}
.cell.md h2{font-size:18px}
.cell.md h3{font-size:16px}
.cell.md p{margin:8px 0}
.cell.md code{background:var(--surface);padding:1px 4px;border-radius:3px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px}
.cell.md pre{background:var(--surface);padding:12px;border-radius:6px;overflow:auto;font-size:13px}
.cell.md ul,.cell.md ol{margin:8px 0;padding-left:24px}
.cell .cell-name{margin:0 0 8px;font-size:13px;color:var(--muted);font-weight:500;letter-spacing:.02em;text-transform:uppercase}
.cell.chart svg{max-width:100%;height:auto;display:block}
.cell.chart-empty,.cell.map-note{padding:16px;background:var(--surface);border:1px dashed var(--border);border-radius:6px}
.cell .note{color:var(--muted);font-style:italic;font-size:13px}
.cell.pivot table,.cell.sql .result-table{width:100%;border-collapse:collapse;font-size:13px;background:#fff}
.cell.pivot th,.cell.pivot td,.cell.sql .result-table th,.cell.sql .result-table td{border:1px solid var(--border);padding:6px 10px;text-align:left;vertical-align:top}
.cell.pivot th,.cell.sql .result-table th{background:var(--surface);font-weight:600}
.cell.pivot td.numeric,.cell.sql .result-table td.numeric{text-align:right;font-variant-numeric:tabular-nums}
.cell.sql details{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:0 12px}
.cell.sql summary{cursor:pointer;padding:10px 0;font-size:13px;color:var(--muted);font-weight:500}
.cell.sql summary::-webkit-details-marker{color:var(--muted)}
.cell.sql pre.sql{background:#fff;border:1px solid var(--border);border-radius:4px;padding:8px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px;overflow:auto;margin:8px 0}
.cell.sql .result-table{margin:8px 0 12px;font-size:12.5px}
footer{margin-top:48px;padding-top:16px;border-top:1px solid var(--border);color:var(--muted);font-size:12px;text-align:center}
footer a{color:var(--accent);text-decoration:none}
.provenance{margin:0 0 32px;padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:6px}
.provenance h2{margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.provenance .src-list{margin:0;padding-left:18px;font-size:13px}
.provenance .src-list>li{margin:4px 0}
.provenance .src-kind{color:var(--muted);font-size:12px}
.provenance code{background:#fff;padding:1px 4px;border-radius:3px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;word-break:break-all}
.provenance ul ul{margin:2px 0;color:var(--muted);font-size:12px}
</style>
</head>
<body>
<main>
<header>
<h1>${esc(title)}</h1>
<div class="meta">${esc(summaryLine || 'Empty notebook')} · Exported ${esc(exportedAt.slice(0, 19).replace('T', ' '))}</div>
</header>
${buildSourcesHtml(opts.sources)}
${cellHtml.join('\n')}
<footer>Prepared in NakliData — browser-native data workbench. Data processed locally; it never left the tab.</footer>
</main>
</body>
</html>
`;
}

// Named `esc` rather than `escape` to avoid shadowing the deprecated
// global `escape()` function (biome lint/suspicious/noShadowRestrictedNames).
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Trigger a browser download of the given HTML string with the given
 * suggested filename. Uses FSA showSaveFilePicker when available
 * (cleaner UX — picker shows the path), falls back to an `<a download>`
 * click otherwise.
 */
export async function saveHtmlFile(html: string, suggestedName: string): Promise<string> {
  const bytes = new TextEncoder().encode(html);
  type Picker = (opts: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle>;
  const picker = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
  if (typeof picker === 'function') {
    try {
      const handle = await picker({
        suggestedName,
        types: [{ description: 'HTML', accept: { 'text/html': ['.html'] } }],
      });
      const w = await handle.createWritable();
      await w.write(new Blob([new Uint8Array(bytes)], { type: 'text/html' }));
      await w.close();
      return handle.name;
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return '';
      throw err;
    }
  }
  // Fallback: anchor download.
  const blob = new Blob([new Uint8Array(bytes)], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return suggestedName;
}
