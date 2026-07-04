#!/usr/bin/env node
// guide/build.mjs — assembles guide/index.html from the captured screenshots +
// the caption/section DATA below. This is the prose source of truth: to change
// what the guide says, edit CAPTIONS / SECTIONS here and re-run — never hand-
// edit index.html (it's regenerated output; edits there are lost).
//
// Single-role app (no login), so the guide is organised by FEATURE AREA. The
// chrome is themed from NakliData's own design tokens (src/tokens) so it reads
// as part of the product.

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'screenshots');

// ── Theme (mirrors src/tokens/colors.ts + spacing.ts) ───────────────────────
const T = {
  bg: '#FAF8F3',
  surface: '#FFFFFF',
  surfaceAlt: '#F1ECE3',
  border: '#D9D2C4',
  borderStrong: '#A9A091',
  text: '#1F1B16',
  textMuted: '#6B6358',
  accent: '#B5371C',
  focus: '#436A8A',
  success: '#2F6E5A',
  font: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

// ── SECTIONS: the guide's shape. id → title, intro, ordered item slugs. ──────
// Each item is `<section-dir>/<file-slug>` (matches screenshots/<dir>/<slug>.png).
// Shots captured as a clip of a single narrow rail (not the full 1400px app)
// are only ~640px wide natively; stretching them to the full card width blurs
// and over-sizes them. These render centred at native scale on the card
// backdrop instead — reads as a "detail" shot of that panel.
const NARROW = new Set(['data-and-schema/02-schema-panel', 'data-and-schema/03-type-override']);

const SECTIONS = [
  {
    id: 'getting-started',
    title: 'Getting started — bring your data in',
    intro:
      'NakliData is a browser-native data workbench: everything runs in this tab, and your data never leaves it (there is no server, no upload, no account). You start by pointing it at data — a local folder or file, a public URL, or a remote store. If you just want to look around, use “browse example data”, which is what every screenshot in this guide is built on.',
    items: [
      'getting-started/00-welcome',
      'getting-started/01-empty-state',
      'getting-started/02-mount-url',
      'getting-started/03-mount-s3',
    ],
  },
  {
    id: 'data-and-schema',
    title: 'Your data & the schema panel',
    intro:
      'Once a source is mounted, the left rail lists your tables and the right rail — the Schema panel — is the heart of NakliData. It classifies every column into a semantic type (Vendor name, GSTIN, PAN, GST state code, bank account no., …) with a confidence score, tags PII / FINANCIAL columns, and lets you accept or override any guess. This is the single most important surface in the app: get the types right and everything downstream (templates, resolve, sinks) follows.',
    items: [
      'data-and-schema/01-sources-mounted',
      'data-and-schema/02-schema-panel',
      'data-and-schema/03-type-override',
    ],
  },
  {
    id: 'notebook',
    title: 'The notebook — query, chart, build',
    intro:
      'The centre column is a notebook of cells. Suggested reports (right rail) are one-click templates matched to your columns; adding one drops in Markdown + SQL + chart cells you can run and edit. SQL runs locally in DuckDB-wasm — nothing is auto-executed until you press Run. The add-cell row gives you every cell kind the workbench offers.',
    items: [
      'notebook/01-templates',
      'notebook/02-sql-cell-result',
      'notebook/03-chart-cell',
      'notebook/04-add-cell-row',
    ],
  },
  {
    id: 'reports',
    title: 'Reports from real datasets',
    intro:
      'The workbench earns its keep on real management data. Below are three board-ready cuts a junior analyst can produce in seconds — each mounted the way you would (“+ Add source” → Add file) from a different format: a Superstore orders CSV, Microsoft’s Financial Sample workbook (XLSX), and the Chinook business database (SQLite). Mount → the schema panel types the columns → one GROUP BY → a result you can chart, export, or drop into a report cell. SQLite is read in-browser via sql.js, so a whole .sqlite file becomes queryable tables with no server.',
    items: [
      'reports/01-superstore-region-margin',
      'reports/02-financial-segment-margin',
      'reports/03-chinook-revenue-country',
    ],
  },
  {
    id: 'resolve',
    title: 'Resolve — clean & unify entities',
    intro:
      'Resolve is NakliData’s entity-resolution toolkit for messy real-world data: cluster near-duplicate values (fuzzy merge), define reusable measures / dimensions / segments in the Semantic layer, and export a golden table that collapses to one row per canonical entity with survivorship rules. None of these mutate your source — they emit SQL you can read before running.',
    items: ['resolve/01-cluster-modal', 'resolve/02-semantic-panel', 'resolve/03-golden-table'],
  },
  {
    id: 'lineage',
    title: 'Lineage & provenance',
    intro:
      'Every cell records where its data came from. The Lineage panel shows the source→cell graph — which mounted tables feed which cells — so you can trace any result back to the files it was built from.',
    items: ['lineage/01-lineage-panel'],
  },
  {
    id: 'facet',
    title: 'Facet — visual exploration',
    intro:
      'Facet turns a query result into a visual view — pick a cell kind, point it at a SQL cell, choose the columns, and the view renders in-tab. One data shape, many views: an embedding column becomes a semantic map, an edge list becomes a force graph, a date column becomes a timeline. The Temporal and Distribution views (SVG) are shown fully rendered below. The Embedding and Network views draw with deck.gl (WebGL) and render live in your browser — the shots below show each one configured (input + columns picked), with the live scatter / graph painting into the canvas beneath the controls.',
    items: [
      'facet/01-embedding-map',
      'facet/02-network-graph',
      'facet/03-knowledge-graph',
      'facet/04-temporal-timeline',
      'facet/05-distribution',
    ],
  },
  {
    id: 'ai-sidecar',
    title: 'AI sidecar (bring your own key)',
    intro:
      'The optional AI sidecar does three narrow jobs — write SQL from a plain-English question, summarise a result in one line, and propose a chart — using your own API key (BYOK). It is off by default, keys live in session storage only, and it never auto-runs generated SQL: you always see and press Run yourself. Enable it in Settings; the per-result chips and the “Ask in plain English” entry point then appear.',
    items: [
      'ai-sidecar/01-settings-byok',
      'ai-sidecar/02-result-ai-chips',
      'ai-sidecar/03-nl-to-sql',
    ],
  },
  {
    id: 'more-cells',
    title: 'The full cell palette',
    intro:
      'Beyond SQL and charts, the notebook offers cells for parameterising, dashboarding, validating, and reporting on your data. Each renders inline and runs locally.',
    items: [
      'more-cells/01-input-cell',
      'more-cells/02-dashboard-cell',
      'more-cells/03-stats-cell',
      'more-cells/04-report-cell',
      'more-cells/05-assertion-cell',
      'more-cells/06-cohort-cell',
    ],
  },
];

// ── CAPTIONS: slug → { title, desc }. One honest line per screen. ───────────
const CAPTIONS = {
  'getting-started/00-welcome': {
    title: 'First-run welcome',
    desc: 'A one-time splash on your first visit — the three steps (bring data in, read the schema, query & build), a jump straight to the example data, and a link to this guide. It never appears again once dismissed.',
  },
  'getting-started/01-empty-state': {
    title: 'The arrival screen — “What do you have?”',
    desc: 'The first thing a new user sees. Eight ways in: a local folder or file, a pasted public URL, an S3 bucket, Iceberg table/catalog, or a Compute Bridge. “Browse example data” loads the demo dataset used throughout this guide.',
  },
  'getting-started/02-mount-url': {
    title: 'Mount a public URL',
    desc: 'Paste an HTTPS link to a CSV or Parquet file and NakliData reads it directly in-tab — no download step, no server round-trip.',
  },
  'getting-started/03-mount-s3': {
    title: 'Mount an S3-compatible bucket',
    desc: 'Point at object storage by bucket + path. Access keys are session-default (never persisted unless you opt in) — consistent with the “your data never leaves the tab” promise.',
  },
  'data-and-schema/01-sources-mounted': {
    title: 'Sources rail after mounting',
    desc: 'The demo mounts three source groups — SMB Finance (vendors, invoices, payments), Access logs, and Product events — each showing its tables and row counts. Click the × to unmount.',
  },
  'data-and-schema/02-schema-panel': {
    title: 'The Schema panel — classified columns',
    desc: 'Each column gets a semantic type + confidence % (e.g. GSTIN 100%, Vendor name 90%), a PII / FINANCIAL sensitivity tag, and Accept / Override / Quick-chart / Evidence / Profile actions. The auto-accept threshold slider + “Bulk accept” apply high-confidence guesses in one go.',
  },
  'data-and-schema/03-type-override': {
    title: 'Overriding a column’s type',
    desc: 'Click Override to open the type picker — filter by name and choose from Compatible Types (GSTIN, PAN, HSN/SAC code, IFSC, GST state code, …). An override is remembered and marks the column as user-set, not machine-guessed.',
  },
  'notebook/01-templates': {
    title: 'Suggested reports (templates)',
    desc: 'The right rail matches ready-made reports to your columns — AR aging, Vendor concentration, GSTIN spend by state, DAU, funnels. “Matched columns” shows why each was suggested; “+ Add” drops its cells into the notebook.',
  },
  'notebook/02-sql-cell-result': {
    title: 'A SQL cell and its result',
    desc: 'Templates expand into real, editable SQL running in DuckDB-wasm. Here “Vendor concentration” sums taxable_amount per vendor; the result table renders inline directly below the query.',
  },
  'notebook/03-chart-cell': {
    title: 'A chart cell',
    desc: 'Chart cells bind to a named SQL result and render locally. Pick the mark (bar/line/…) and the x / y shelves; the palette is NakliData’s Brickwork categorical colours.',
  },
  'notebook/04-add-cell-row': {
    title: 'The add-cell palette',
    desc: 'Every cell kind at a glance: SQL, Markdown, Chart, Pivot, Map, Embedding, Cohort, Assertion, Input, Dashboard, Stats, and Report.',
  },
  'reports/01-superstore-region-margin': {
    title: 'Superstore (CSV) — profit & margin by region',
    desc: 'A Superstore orders CSV mounted as one table, then aggregated: sales, profit, and profit-margin % per region, worst margin last. The classic exec cut — revenue is not profit — straight out of a raw CSV.',
  },
  'reports/02-financial-segment-margin': {
    title: 'Financial Sample (XLSX) — profit & margin by segment',
    desc: 'Microsoft’s Financial Sample workbook, parsed in-tab (SheetJS → the CSV path). The same report shape over a spreadsheet: profit and margin by business segment, so a loss-making segment jumps out at a glance.',
  },
  'reports/03-chinook-revenue-country': {
    title: 'Chinook (SQLite) — revenue by country',
    desc: 'The canonical Chinook SQLite database, read in-browser via sql.js (DuckDB-wasm can’t open a registered SQLite file), then a revenue-by-country ranking over its Invoice table. A whole .sqlite file becomes queryable tables — no server, no conversion.',
  },
  'resolve/01-cluster-modal': {
    title: 'Cluster (fuzzy merge)',
    desc: 'From any SQL result, “Cluster” groups near-duplicate values (e.g. vendor-name spelling variants) and emits a CASE expression aliased …__merged. You choose the column and the match method; the SQL preview updates live and is never auto-run.',
  },
  'resolve/02-semantic-panel': {
    title: 'The Semantic layer',
    desc: 'Define reusable measures, dimensions, and segments once and reference them across cells. Segments compile to a SEGMENT(name) macro; the add-forms let you build each without hand-writing the SQL.',
  },
  'resolve/03-golden-table': {
    title: 'Golden-table export',
    desc: 'Collapse a result to one row per canonical entity with survivorship rules (which value wins per column). Pick the entity key; the modal shows the GROUP BY survivorship SQL it will generate before you export.',
  },
  'lineage/01-lineage-panel': {
    title: 'The Lineage panel',
    desc: 'The provenance graph for the notebook: it shows which mounted sources (invoices, vendors, …) feed which cells, so any result is traceable back to its inputs.',
  },
  'facet/01-embedding-map': {
    title: 'Embedding map — semantic scatter',
    desc: 'The Embedding cell configured against a SQL result with an embedding (FLOAT[]) column — it projects the vectors to 2-D with in-browser PCA, colouring points by a category, and the deck.gl scatter paints into the canvas below the picker. Click a point in the live view to find its nearest neighbours; precomputed x / y columns are used directly when present.',
  },
  'facet/02-network-graph': {
    title: 'Network — force-directed graph',
    desc: 'The Network cell configured from an edge list (a source-id and target-id column): distinct ids become nodes sized by degree, laid out by an in-browser force simulation and drawn with deck.gl in the canvas below. Click a node in the live view to highlight its immediate neighbourhood.',
  },
  'facet/03-knowledge-graph': {
    title: 'Knowledge graph — typed & weighted edges',
    desc: 'The same Network cell with an edge-type column set to colour edges by relationship (with a legend — click a swatch to filter to that type) and a weight column to scale edge width — a typed, weighted knowledge graph.',
  },
  'facet/04-temporal-timeline': {
    title: 'Temporal — brushable timeline',
    desc: 'A date / timestamp column bucketed into a histogram over time. Drag across the timeline to brush a window; the readout reports the selected range and the number of rows inside it.',
  },
  'facet/05-distribution': {
    title: 'Distribution — histogram & category bars',
    desc: 'Summarize one column: numeric columns become an equal-width histogram, categorical columns become top-value bars. Click a bar to select it and read its share of rows.',
  },
  'ai-sidecar/01-settings-byok': {
    title: 'Settings — enable the sidecar (BYOK)',
    desc: 'The AI sidecar is opt-in. Toggle it on and paste your own provider key (Anthropic / OpenAI). Keys are held in session storage only and there is no telemetry — this is bring-your-own-key by design.',
  },
  'ai-sidecar/02-result-ai-chips': {
    title: 'AI chips on a result',
    desc: 'With the sidecar enabled, each SQL result grows Summarise (one-line observation) and Propose chart chips. They describe or suggest — they never mutate data or auto-run SQL.',
  },
  'ai-sidecar/03-nl-to-sql': {
    title: 'Ask in plain English (NL→SQL)',
    desc: 'Type a question in plain language and the sidecar drafts a SQL cell for it. The draft is inserted, not executed — you review it and press Run yourself.',
  },
  'more-cells/01-input-cell': {
    title: 'Input cell',
    desc: 'A named parameter widget (text / number / select) other cells can reference — turn a notebook into a small interactive tool without editing SQL each time.',
  },
  'more-cells/02-dashboard-cell': {
    title: 'Dashboard cell',
    desc: 'Compose a grid of existing chart/result cells by name into a single dashboard view for presenting or exporting.',
  },
  'more-cells/03-stats-cell': {
    title: 'Stats cell',
    desc: 'Run descriptive statistics over a result — distributions and summaries — with a single Run, rendered inline.',
  },
  'more-cells/04-report-cell': {
    title: 'Report cell',
    desc: 'A print-ready “paper” surface that assembles notebook output into a document, with Print-to-PDF for sharing offline.',
  },
  'more-cells/05-assertion-cell': {
    title: 'Assertion cell',
    desc: 'Data-quality checks that pass or fail against a result (e.g. “no null vendor”, “amounts ≥ 0”) — a lightweight test you can keep in the notebook.',
  },
  'more-cells/06-cohort-cell': {
    title: 'Cohort cell',
    desc: 'Build cohort / retention style breakdowns from an event stream, grouping rows into buckets over time.',
  },
};

// ── HTML assembly ───────────────────────────────────────────────────────────
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// Read a PNG's pixel dimensions from its IHDR chunk (bytes 16–24). Used to set
// intrinsic width/height so the browser reserves space (no layout shift, and
// loading="lazy" works even before the bytes arrive).
async function pngSize(p) {
  try {
    const buf = await readFile(p);
    if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch {
    return null;
  }
}

async function main() {
  // Only include items whose screenshot actually exists (scoped/failed captures
  // shouldn't emit broken <img> tags).
  const sectionsHtml = [];
  const tocHtml = [];
  let cardCount = 0;

  for (const section of SECTIONS) {
    const cards = [];
    for (const item of section.items) {
      const imgPath = join(SHOTS, `${item}.png`);
      if (!(await exists(imgPath))) {
        console.warn(`[guide] skip (no screenshot): ${item}`);
        continue;
      }
      const cap = CAPTIONS[item] ?? { title: item, desc: '' };
      const search = `${section.title} ${cap.title} ${cap.desc} ${item}`.toLowerCase();
      const cls = NARROW.has(item) ? 'card narrow' : 'card';
      const dim = await pngSize(imgPath);
      const dimAttr = dim ? ` width="${dim.w}" height="${dim.h}"` : '';
      cards.push(`
        <figure class="${cls}" data-search="${esc(search)}">
          <a class="shot" href="screenshots/${esc(item)}.png" target="_blank" rel="noopener">
            <img${dimAttr} src="screenshots/${esc(item)}.png" alt="${esc(cap.title)}">
          </a>
          <figcaption>
            <h3>${esc(cap.title)}</h3>
            <p>${esc(cap.desc)}</p>
          </figcaption>
        </figure>`);
      cardCount += 1;
    }
    if (!cards.length) continue;
    tocHtml.push(`<li><a href="#${section.id}">${esc(section.title)}</a></li>`);
    sectionsHtml.push(`
      <section id="${section.id}" class="guide-section">
        <h2>${esc(section.title)}</h2>
        <p class="section-intro">${esc(section.intro)}</p>
        <div class="cards">${cards.join('')}</div>
      </section>`);
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NakliData — Field Guide</title>
<style>
  :root {
    --bg:${T.bg}; --surface:${T.surface}; --surface-alt:${T.surfaceAlt};
    --border:${T.border}; --border-strong:${T.borderStrong};
    --text:${T.text}; --muted:${T.textMuted}; --accent:${T.accent};
    --focus:${T.focus}; --success:${T.success};
    --font:${T.font}; --mono:${T.mono};
  }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; font-family: var(--font); color: var(--text); background: var(--bg); line-height: 1.5; }
  * { box-sizing: border-box; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 0 24px 96px; }

  header.masthead { border-bottom: 1px solid var(--border); background: var(--surface); }
  .masthead-inner { max-width: 1080px; margin: 0 auto; padding: 28px 24px 22px; }
  .brand { display: flex; align-items: baseline; gap: 10px; }
  .brand-mark { font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
  .brand-mark .accent { color: var(--accent); }
  .brand-tag { color: var(--muted); font-size: 13px; }
  .masthead p.lede { margin: 12px 0 0; max-width: 70ch; color: var(--muted); font-size: 14px; }

  .searchbar { position: sticky; top: 0; z-index: 20; background: var(--bg); border-bottom: 1px solid var(--border); }
  .searchbar-inner { max-width: 1080px; margin: 0 auto; padding: 12px 24px; display: flex; align-items: center; gap: 12px; }
  #q {
    flex: 1; font: inherit; font-size: 14px; padding: 10px 14px; border: 1px solid var(--border-strong);
    border-radius: 8px; background: var(--surface); color: var(--text);
  }
  #q:focus { outline: 2px solid var(--focus); outline-offset: 1px; border-color: var(--focus); }
  .searchbar .hint { color: var(--muted); font-size: 12px; white-space: nowrap; }
  .searchbar kbd {
    font-family: var(--mono); font-size: 11px; background: var(--surface-alt);
    border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px;
  }

  nav.toc { margin: 28px 0 8px; }
  nav.toc h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 0 0 10px; }
  nav.toc ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
  nav.toc a {
    display: inline-block; text-decoration: none; color: var(--text); font-size: 13px;
    padding: 6px 12px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface);
  }
  nav.toc a:hover { border-color: var(--accent); color: var(--accent); }

  .guide-section { margin: 44px 0 0; scroll-margin-top: 68px; }
  .guide-section h2 { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 8px; padding-bottom: 8px; border-bottom: 2px solid var(--accent); display: inline-block; }
  .section-intro { max-width: 78ch; color: var(--text); font-size: 14px; margin: 8px 0 22px; }

  .cards { display: grid; grid-template-columns: 1fr; gap: 28px; }
  .card { margin: 0; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; background: var(--surface); box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
  .card .shot { display: block; background: var(--surface-alt); border-bottom: 1px solid var(--border); cursor: zoom-in; }
  .card img { display: block; width: 100%; height: auto; }
  /* Narrow rail clips: show near native size, centred on the backdrop. */
  .card.narrow .shot { padding: 28px 16px; text-align: center; }
  .card.narrow img { width: 340px; max-width: 100%; height: auto; margin: 0 auto; border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .card figcaption { padding: 16px 18px 18px; }
  .card figcaption h3 { margin: 0 0 6px; font-size: 15px; font-weight: 600; }
  .card figcaption p { margin: 0; color: var(--muted); font-size: 13.5px; }

  .card.hidden { display: none; }
  .guide-section.hidden { display: none; }
  #nomatch { display: none; margin: 48px 0; text-align: center; color: var(--muted); font-size: 14px; }
  #nomatch.show { display: block; }

  footer.foot { margin-top: 64px; padding-top: 20px; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px; }
  footer.foot a { color: var(--accent); }

  @media (min-width: 720px) { .card { display: grid; grid-template-columns: 1fr; } }

  /* ── Lightbox ────────────────────────────────────────────────────────── */
  .lightbox { position: fixed; inset: 0; z-index: 100; display: none; background: rgba(20,18,15,0.90); }
  .lightbox.open { display: flex; flex-direction: column; }
  .lb-stage { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 56px 68px 8px; overflow: auto; }
  .lb-stage img { max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; border-radius: 8px; box-shadow: 0 10px 44px rgba(0,0,0,0.5); background: var(--surface); }
  .lb-cap { padding: 12px 24px 22px; text-align: center; max-width: 82ch; margin: 0 auto; }
  .lb-cap h3 { margin: 0 0 4px; font-size: 15px; font-weight: 600; color: #f4efe6; }
  .lb-cap p { margin: 0; font-size: 13px; color: #cbc3b4; }
  .lb-btn { position: fixed; top: 50%; transform: translateY(-50%); width: 46px; height: 46px; border-radius: 50%;
    background: rgba(255,255,255,0.12); color: #fff; border: 1px solid rgba(255,255,255,0.28); font-size: 26px; line-height: 1;
    cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .lb-btn:hover { background: rgba(255,255,255,0.24); }
  .lb-prev { left: 16px; } .lb-next { right: 16px; }
  .lb-close { position: fixed; top: 16px; right: 18px; width: 40px; height: 40px; border-radius: 50%;
    background: rgba(255,255,255,0.12); color: #fff; border: 1px solid rgba(255,255,255,0.28); font-size: 18px; cursor: pointer; }
  .lb-close:hover { background: rgba(255,255,255,0.24); }
  .lb-counter { position: fixed; top: 22px; left: 22px; color: #cbc3b4; font-family: var(--mono); font-size: 12px; }
  .lb-hint { position: fixed; bottom: 10px; left: 0; right: 0; text-align: center; color: #9a927f; font-size: 11px; }
  @media (max-width: 640px) { .lb-stage { padding: 52px 12px 8px; } .lb-btn { width: 40px; height: 40px; font-size: 22px; } }
</style>
</head>
<body>

<header class="masthead">
  <div class="masthead-inner">
    <div class="brand">
      <span class="brand-mark"><span class="accent">Nakli</span>Data</span>
      <span class="brand-tag">field guide</span>
    </div>
    <p class="lede">A screen-by-screen tour of the browser-native semantic data workbench — how to bring data in, read the schema, drive the notebook, resolve entities, and use the AI sidecar. Every shot is captured from the running app. Search to jump to any feature; click any screenshot to zoom, then step through with <kbd>←</kbd>/<kbd>→</kbd> (or <kbd>↑</kbd>/<kbd>↓</kbd>).</p>
  </div>
</header>

<div class="searchbar">
  <div class="searchbar-inner">
    <input id="q" type="search" placeholder="Search features — try “schema”, “override”, “cluster”, “embedding”…" autocomplete="off" aria-label="Search the guide">
    <span class="hint"><kbd>/</kbd> focus · <kbd>Esc</kbd> clear</span>
  </div>
</div>

<div class="wrap">
  <nav class="toc">
    <h2>Contents</h2>
    <ul>${tocHtml.join('')}</ul>
  </nav>

  ${sectionsHtml.join('')}

  <p id="nomatch">No features match that search.</p>

  <div class="lightbox" id="lightbox" aria-hidden="true" role="dialog" aria-modal="true" aria-label="Screenshot viewer">
    <span class="lb-counter" id="lb-counter"></span>
    <button class="lb-close" id="lb-close" type="button" aria-label="Close (Esc)">✕</button>
    <button class="lb-btn lb-prev" id="lb-prev" type="button" aria-label="Previous (Left arrow)">‹</button>
    <div class="lb-stage" id="lb-stage"><img id="lb-img" src="" alt=""></div>
    <button class="lb-btn lb-next" id="lb-next" type="button" aria-label="Next (Right arrow)">›</button>
    <div class="lb-cap"><h3 id="lb-title"></h3><p id="lb-desc"></p></div>
    <div class="lb-hint">← → or ↑ ↓ to move · Esc to close</div>
  </div>

  <footer class="foot">
    ${cardCount} screens · generated from <code>guide/capture.mjs</code> + <code>guide/build.mjs</code> · this is a build artifact — edit the generator and re-run, don’t hand-edit this file.
  </footer>
</div>

<script>
(function () {
  var q = document.getElementById('q');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  var sections = Array.prototype.slice.call(document.querySelectorAll('.guide-section'));
  var noMatch = document.getElementById('nomatch');

  function apply() {
    var query = q.value.trim().toLowerCase();
    var anyVisible = false;
    cards.forEach(function (c) {
      var show = !query || (c.getAttribute('data-search') || '').indexOf(query) !== -1;
      c.classList.toggle('hidden', !show);
      if (show) anyVisible = true;
    });
    sections.forEach(function (s) {
      var visible = s.querySelectorAll('.card:not(.hidden)').length > 0;
      s.classList.toggle('hidden', !visible);
    });
    noMatch.classList.toggle('show', !anyVisible);
  }

  q.addEventListener('input', apply);
  document.addEventListener('keydown', function (e) {
    if (LB.isOpen()) return; // lightbox owns the keyboard while open
    if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); }
    else if (e.key === 'Escape' && document.activeElement === q) { q.value = ''; apply(); q.blur(); }
  });
})();

// ── Lightbox: click a shot to zoom; arrow keys step through visible shots. ──
var LB = (function () {
  var lb = document.getElementById('lightbox');
  var img = document.getElementById('lb-img');
  var titleEl = document.getElementById('lb-title');
  var descEl = document.getElementById('lb-desc');
  var counter = document.getElementById('lb-counter');
  var stage = document.getElementById('lb-stage');
  var current = -1;

  function visibleCards() {
    return Array.prototype.slice
      .call(document.querySelectorAll('.card'))
      .filter(function (c) { return !c.classList.contains('hidden'); });
  }
  function render(idx) {
    var cards = visibleCards();
    if (!cards.length) return;
    idx = (idx + cards.length) % cards.length; // wrap both ends
    current = idx;
    var card = cards[idx];
    var cImg = card.querySelector('.shot img');
    var h3 = card.querySelector('figcaption h3');
    var p = card.querySelector('figcaption p');
    img.setAttribute('src', cImg ? cImg.getAttribute('src') : '');
    img.setAttribute('alt', h3 ? h3.textContent : '');
    titleEl.textContent = h3 ? h3.textContent : '';
    descEl.textContent = p ? p.textContent : '';
    counter.textContent = (idx + 1) + ' / ' + cards.length;
    stage.scrollTop = 0;
  }
  function open(card) {
    var cards = visibleCards();
    var idx = cards.indexOf(card);
    render(idx === -1 ? 0 : idx);
    lb.classList.add('open');
    lb.setAttribute('aria-hidden', 'false');
  }
  function close() {
    lb.classList.remove('open');
    lb.setAttribute('aria-hidden', 'true');
    current = -1;
  }
  function step(delta) { if (current !== -1) render(current + delta); }

  Array.prototype.forEach.call(document.querySelectorAll('.card .shot'), function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); open(a.closest('.card')); });
  });
  document.getElementById('lb-close').addEventListener('click', close);
  document.getElementById('lb-prev').addEventListener('click', function () { step(-1); });
  document.getElementById('lb-next').addEventListener('click', function () { step(1); });
  lb.addEventListener('click', function (e) {
    // Backdrop / empty stage click closes; clicking the image or a button does not.
    if (e.target === lb || e.target === stage) close();
  });
  document.addEventListener('keydown', function (e) {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); step(1); }
  });

  return { isOpen: function () { return lb.classList.contains('open'); } };
})();
</script>
</body>
</html>`;

  await mkdir(HERE, { recursive: true });
  await writeFile(join(HERE, 'index.html'), html);
  console.log(
    `[guide] wrote guide/index.html (${cardCount} cards across ${sectionsHtml.length} sections)`,
  );
}

main().catch((err) => {
  console.error('[guide] build crashed:', err);
  process.exit(1);
});
