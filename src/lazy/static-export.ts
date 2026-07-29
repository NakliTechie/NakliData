// W6.3 — Static-HTML export builder, loaded only when export/embed is requested.
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
import { Neutral, StatusColor } from '../tokens/colors.ts';
import { renderMarkdownToHtml } from '../ui/cells/markdown-cell.ts';

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

export interface StaticExportManifestCell {
  kind: string;
  name: string;
  status: 'rendered' | 'placeholder';
  reason: string | null;
}

export interface StaticExportManifest {
  totalCells: number;
  includedCells: number;
  renderedCells: number;
  omittedCells: number;
  cells: StaticExportManifestCell[];
}

export interface StaticExportResult {
  html: string;
  manifest: StaticExportManifest;
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

export function buildStandaloneExport(opts: ExportOpts): StaticExportResult {
  const title = (opts.title?.trim() || 'NakliData notebook').slice(0, 200);
  const exportedAt = opts.exportedAt ?? new Date().toISOString();
  const notebookContainer =
    opts.notebookRoot.querySelector<HTMLElement>('.notebook') ?? opts.notebookRoot;
  const cells = Array.from(notebookContainer.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('cell'),
  );
  const cellHtml: string[] = [];
  const manifestCells: StaticExportManifestCell[] = [];

  const add = (
    kind: string,
    name: string,
    body: string,
    status: StaticExportManifestCell['status'] = 'rendered',
    reason: string | null = null,
  ): void => {
    cellHtml.push(body);
    manifestCells.push({ kind, name, status, reason });
  };
  const placeholder = (heading: string, reason: string): string =>
    `<div class="placeholder-note" role="note">${heading}<strong>Static placeholder:</strong> ${esc(reason)}</div>`;

  for (const cell of cells) {
    const kind = cell.dataset.cellKind ?? 'unknown';
    const name =
      cell
        .querySelector<HTMLInputElement>(
          '[data-region="cell-name"], [data-action="cell-name-edit"]',
        )
        ?.value?.trim() || '';
    const heading = name ? `<h3 class="cell-name">${esc(name)}</h3>` : '';
    if (kind === 'markdown') {
      const preview = cell.querySelector('.markdown-preview');
      const textarea = cell.querySelector<HTMLTextAreaElement>('textarea');
      const body = preview?.innerHTML ?? renderMarkdownToHtml(textarea?.value ?? '');
      add(
        kind,
        name,
        `<section class="cell md" data-export-kind="${kind}">${heading}<div class="md-body">${body}</div></section>`,
      );
      continue;
    }
    if (kind === 'chart') {
      const visual = cell.querySelector<SVGElement | HTMLTableElement>('svg, table');
      if (visual) {
        add(
          kind,
          name,
          `<section class="cell chart" data-export-kind="${kind}">${heading}${visual.outerHTML}</section>`,
        );
      } else {
        add(
          kind,
          name,
          `<section class="cell placeholder" data-export-kind="${kind}">${placeholder(heading, 'Chart was not rendered before export.')}</section>`,
          'placeholder',
          'Chart was not rendered before export.',
        );
      }
      continue;
    }
    if (kind === 'pivot') {
      const table = cell.querySelector('.pivot-table, table');
      if (table) {
        add(
          kind,
          name,
          `<section class="cell pivot" data-export-kind="${kind}">${heading}${table.outerHTML}</section>`,
        );
      } else {
        add(
          kind,
          name,
          `<section class="cell placeholder" data-export-kind="${kind}">${placeholder(heading, 'Pivot result was not rendered before export.')}</section>`,
          'placeholder',
          'Pivot result was not rendered before export.',
        );
      }
      continue;
    }
    if (kind === 'map' || kind === 'embedding' || kind === 'network') {
      const reason = `${kind[0]?.toUpperCase()}${kind.slice(1)} uses an interactive WebGL canvas that cannot be serialized safely.`;
      add(
        kind,
        name,
        `<section class="cell placeholder" data-export-kind="${kind}">${placeholder(heading, reason)}</section>`,
        'placeholder',
        reason,
      );
      continue;
    }
    if (kind === 'dashboard') {
      const grid = cell.querySelector<HTMLElement>('.dashboard-grid');
      const cols = grid ? window.getComputedStyle(grid).gridTemplateColumns.split(' ').length : 2;
      const slots = grid ? Array.from(grid.querySelectorAll<HTMLElement>('.dashboard-slot')) : [];
      const slotHtml: string[] = [];
      let unavailableSlots = 0;
      for (const slot of slots) {
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
          unavailableSlots++;
          const noteText = slot.textContent?.trim() ?? '';
          slotHtml.push(
            `<div class="dashboard-slot empty">${placeholder('', noteText || 'Dashboard slot was unavailable.')}</div>`,
          );
        }
      }
      const reason =
        slots.length === 0
          ? 'Dashboard had no serializable slots.'
          : unavailableSlots > 0
            ? `${unavailableSlots} of ${slots.length} dashboard slots were unavailable.`
            : null;
      add(
        kind,
        name,
        `<section class="cell dashboard${reason ? ' placeholder' : ''}" data-export-kind="${kind}">${heading}<div class="dashboard-grid" style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:12px;">${slotHtml.join('')}</div></section>`,
        reason ? 'placeholder' : 'rendered',
        reason,
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
      add(
        kind,
        name,
        `<section class="cell input-note" data-export-kind="${kind}">${heading}<div class="note"><strong>${esc(label)}</strong> ${esc(value)}</div></section>`,
      );
      continue;
    }
    if (kind === 'sql' || kind === 'cohort' || kind === 'assertion') {
      const cm = cell.querySelector<HTMLElement>('.cm-content');
      const ta = cell.querySelector<HTMLTextAreaElement>('textarea');
      const sql = cm?.textContent ?? ta?.value ?? '';
      const resultTable = cell.querySelector('.result-table');
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
      add(
        kind,
        name,
        `<section class="cell sql" data-export-kind="${kind}"><details><summary>${esc(summary)}</summary>${inner}</details></section>`,
      );
      continue;
    }
    if (kind === 'report') {
      const report = cell.querySelector<HTMLElement>('.report-paper');
      if (report) {
        add(
          kind,
          name,
          `<section class="cell report" data-export-kind="${kind}">${heading}${report.outerHTML}</section>`,
        );
      } else {
        add(
          kind,
          name,
          `<section class="cell placeholder" data-export-kind="${kind}">${placeholder(heading, 'Report layout was unavailable.')}</section>`,
          'placeholder',
          'Report layout was unavailable.',
        );
      }
      continue;
    }
    if (kind === 'stats') {
      const output = cell.querySelector<HTMLElement>('.cell-output');
      const table = output?.querySelector('table');
      if (output && table) {
        add(
          kind,
          name,
          `<section class="cell stats" data-export-kind="${kind}">${heading}${output.outerHTML}</section>`,
        );
      } else {
        add(
          kind,
          name,
          `<section class="cell placeholder" data-export-kind="${kind}">${placeholder(heading, 'Statistics were not computed before export.')}</section>`,
          'placeholder',
          'Statistics were not computed before export.',
        );
      }
      continue;
    }
    if (kind === 'python' || kind === 'r') {
      const code =
        cell.querySelector<HTMLElement>('.cm-content')?.textContent ??
        cell.querySelector<HTMLTextAreaElement>('textarea')?.value ??
        '';
      const preview = cell.querySelector<HTMLTableElement>('.cell-output .result-table');
      const codeHtml = code ? `<pre class="sql"><code>${esc(code)}</code></pre>` : '';
      if (preview) {
        add(
          kind,
          name,
          `<section class="cell language" data-export-kind="${kind}">${heading}${codeHtml}${preview.outerHTML}</section>`,
        );
      } else {
        const reason = `${kind === 'python' ? 'Python' : 'R'} result was not available before export.`;
        add(
          kind,
          name,
          `<section class="cell language placeholder" data-export-kind="${kind}">${heading}${codeHtml}${placeholder('', reason)}</section>`,
          'placeholder',
          reason,
        );
      }
      continue;
    }
    if (kind === 'temporal' || kind === 'distribution') {
      const svg = cell.querySelector<SVGElement>('.cell-output svg');
      if (svg) {
        add(
          kind,
          name,
          `<section class="cell chart" data-export-kind="${kind}">${heading}${svg.outerHTML}</section>`,
        );
      } else {
        const reason = `${kind === 'temporal' ? 'Timeline' : 'Distribution'} was not rendered before export.`;
        add(
          kind,
          name,
          `<section class="cell placeholder" data-export-kind="${kind}">${placeholder(heading, reason)}</section>`,
          'placeholder',
          reason,
        );
      }
      continue;
    }
    const reason = `Cell kind "${kind}" has no static renderer.`;
    add(
      kind,
      name,
      `<section class="cell placeholder" data-export-kind="${kind}">${placeholder(heading, reason)}</section>`,
      'placeholder',
      reason,
    );
  }

  const renderedCells = manifestCells.filter((cell) => cell.status === 'rendered').length;
  const manifest: StaticExportManifest = {
    totalCells: cells.length,
    includedCells: manifestCells.length,
    renderedCells,
    omittedCells: manifestCells.length - renderedCells,
    cells: manifestCells,
  };
  const summaryLine =
    manifest.totalCells === 0
      ? 'Empty notebook'
      : `${manifest.totalCells} cells · ${manifest.renderedCells} rendered · ${manifest.omittedCells} placeholders`;
  const manifestItems = manifest.cells
    .map(
      (cell, index) =>
        `<li><strong>${esc(cell.name || `${cell.kind} ${index + 1}`)}</strong> · ${esc(cell.kind)} · ${cell.status}${cell.reason ? ` — ${esc(cell.reason)}` : ''}</li>`,
    )
    .join('');
  const manifestHtml = `<section class="export-manifest"><details open><summary>Export manifest — ${manifest.renderedCells} rendered, ${manifest.omittedCells} placeholders</summary><p>All ${manifest.includedCells} of ${manifest.totalCells} notebook cells are represented below.</p><ol>${manifestItems}</ol></details></section>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--ink:${Neutral.textStrong};--muted:${Neutral.textCoolMuted};--surface:${Neutral.surfaceSubtle};--border:${Neutral.borderLight};--accent:${Neutral.accent};--paper:${Neutral.surface};--manifest:${StatusColor.warningBg}}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;padding:48px 24px;background:var(--paper);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased}
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
.cell.placeholder{padding:16px;background:var(--surface);border:1px dashed var(--border);border-radius:6px}
.placeholder-note{color:var(--muted);font-size:13px}
.placeholder-note strong{color:var(--ink)}
.cell .note{color:var(--muted);font-style:italic;font-size:13px}
.cell table{width:100%;border-collapse:collapse;font-size:13px;background:var(--paper)}
.cell th,.cell td{border:1px solid var(--border);padding:6px 10px;text-align:left;vertical-align:top}
.cell th{background:var(--surface);font-weight:600}
.cell td.numeric{text-align:right;font-variant-numeric:tabular-nums}
.cell.sql details{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:0 12px}
.cell.sql summary{cursor:pointer;padding:10px 0;font-size:13px;color:var(--muted);font-weight:500}
.cell.sql summary::-webkit-details-marker{color:var(--muted)}
.cell pre.sql{background:var(--paper);border:1px solid var(--border);border-radius:4px;padding:8px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px;overflow:auto;margin:8px 0}
.cell.sql .result-table{margin:8px 0 12px;font-size:12.5px}
.cell.report .report-paper{box-shadow:none!important;max-width:none!important;margin:0!important}
.export-manifest{margin:0 0 32px;padding:12px 16px;background:var(--manifest);border:1px solid var(--border);border-radius:6px;font-size:13px}
.export-manifest summary{font-weight:600;cursor:pointer}
.export-manifest p{margin:8px 0;color:var(--muted)}
.export-manifest ol{margin:8px 0;padding-left:22px}
.export-manifest li{margin:3px 0}
footer{margin-top:48px;padding-top:16px;border-top:1px solid var(--border);color:var(--muted);font-size:12px;text-align:center}
footer a{color:var(--accent);text-decoration:none}
.provenance{margin:0 0 32px;padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:6px}
.provenance h2{margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.provenance .src-list{margin:0;padding-left:18px;font-size:13px}
.provenance .src-list>li{margin:4px 0}
.provenance .src-kind{color:var(--muted);font-size:12px}
.provenance code{background:var(--paper);padding:1px 4px;border-radius:3px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;word-break:break-all}
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
${manifestHtml}
${cellHtml.join('\n')}
<footer>Prepared in NakliData — browser-native data workbench. Local data is processed in this browser; remote sources and cloud sidecar actions are explicit.</footer>
</main>
</body>
</html>
`;
  return { html, manifest };
}

export function buildStandaloneHtml(opts: ExportOpts): string {
  return buildStandaloneExport(opts).html;
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
