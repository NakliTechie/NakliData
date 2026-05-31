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

export interface ExportOpts {
  /** Notebook root node (the element with `[data-region="notebook"]`). */
  notebookRoot: HTMLElement;
  /** Human-readable name for the doc title + filename suggestion. */
  title?: string;
  /** ISO timestamp string for the "Exported on" footer. Default: now. */
  exportedAt?: string;
}

export function buildStandaloneHtml(opts: ExportOpts): string {
  const title = (opts.title?.trim() || 'NakliData notebook').slice(0, 200);
  const exportedAt = opts.exportedAt ?? new Date().toISOString();

  // Walk cells in document order. Each cell becomes one <section>.
  const cells = Array.from(opts.notebookRoot.querySelectorAll<HTMLElement>('.cell'));
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
      const preview = cell.querySelector('.markdown-preview');
      // Use innerHTML directly — the markdown renderer already
      // escape-htmls user content. (See src/ui/cells/markdown-cell.ts.)
      cellHtml.push(
        `<section class="cell md">${heading}<div class="md-body">${preview?.innerHTML ?? ''}</div></section>`,
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
    if (kind === 'sql' || kind === 'cohort' || kind === 'assertion') {
      const sql =
        cell.querySelector('.cm-content')?.textContent ??
        cell.querySelector('textarea')?.textContent ??
        '';
      const resultTable = cell.querySelector('.result-table');
      const meta = cell.querySelector('.cell-result-meta')?.textContent?.trim() ?? '';
      const summary = `${kind.toUpperCase()}${name ? ` · ${esc(name)}` : ''}${meta ? ` · ${esc(meta.replace(/\s+/g, ' '))}` : ''}`;
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
</style>
</head>
<body>
<main>
<header>
<h1>${esc(title)}</h1>
<div class="meta">${esc(summaryLine || 'Empty notebook')} · Exported ${esc(exportedAt.slice(0, 19).replace('T', ' '))}</div>
</header>
${cellHtml.join('\n')}
<footer>Exported from NakliData — browser-native data workbench. Your data never left the tab.</footer>
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
