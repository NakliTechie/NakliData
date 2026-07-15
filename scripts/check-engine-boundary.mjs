#!/usr/bin/env node
// v1.3 M0 — Extraction-readiness lint boundary.
//
// Enforces the standing rule from the v1.3 handoff:
//
//   "Engine-layer modules — taxonomy, measures, lineage, cell model,
//    anonymization, chart-config schema — must contain no DOM, FSA,
//    or browser-global imports; UI binds to them, never the reverse."
//
// Rationale (handoff §M0): these modules are slated for extraction
// as shared packages consumed by a future server-side sibling. Keep
// the boundary clean now — retrofitting later is not cheap.
//
// Files in the watched set may not reference any of:
//   - `document.` / `window.` / `navigator.` / `location.`
//   - DOM types: `HTMLElement`, `Element`, `Node`, `Document`
//   - FSA: `FileSystemHandle`, `showOpenFilePicker`, `showSaveFilePicker`
//   - Browser APIs: `localStorage`, `sessionStorage`, `indexedDB`,
//     `fetch` (engine modules use injection where they need I/O),
//     `URL.createObjectURL`, `Blob`, `File`
//
// One exception: `crypto` (subtle / getRandomValues) is allowed
// because it's available in Node.js, Workers, AND the browser — it's
// already the engine-shape we want.

import { readFileSync } from 'node:fs';

const WATCHED_PATHS = [
  // v1.3 explicitly-named engine modules:
  'src/taxonomy/types.ts',
  'src/taxonomy/detectors.ts',
  'src/taxonomy/checksums.ts',
  'src/taxonomy/load.ts',
  'src/core/lineage.ts',
  'src/core/lineage-store.ts',
  'src/core/anonymize.ts',
  'src/core/chart-config.ts',
  'src/core/query-builder.ts', // v1.2 M5 pure emitter
  'src/core/refresh.ts', // v1.2 M3 pure types + cascade
  // v1.3 modules added in subsequent milestones (M2/M4) will land
  // here as files are created. The presence check below catches
  // missing files so the watched-set drift is loud.
];

// Optional v1.3 modules — checked when present.
const WATCHED_OPTIONAL = [
  'src/core/measures.ts', // v1.3 M2 (created later)
  'src/core/selections.ts', // v1.3 M1
  'src/core/stats.ts', // v1.3 M4
  'src/core/report-layout.ts', // v1.3 M3
  'src/core/chart-shelves.ts', // v1.3 M5 — shelf-based chart authoring
  'src/core/lineage-edit.ts', // v1.3 M6 — lineage edit mode (pure ops)
  'src/core/clustering.ts', // Resolve M1 — fuzzy-merge core (pure)
  'src/core/segments.ts', // Resolve M2 — segment primitive (pure)
  'src/core/golden.ts', // Resolve M3 — golden-table survivorship (pure)
  'src/core/embed-search.ts', // Facet — embedSearch VSS + ranking (pure)
  // Facet graph analytics. These two are load-bearing here, not aspirational:
  // they run INSIDE the graph-metrics worker, where `document`/`window` don't
  // exist at all — a browser-global creeping in is a runtime crash, not just a
  // future extraction problem.
  'src/core/graph-metrics.ts',
  'src/core/graph-metrics-protocol.ts',
];

const FORBIDDEN_PATTERNS = [
  // DOM
  { name: 'document.', regex: /\bdocument\./ },
  { name: 'window.', regex: /\bwindow\./ },
  { name: 'navigator.', regex: /\bnavigator\./ },
  { name: 'location.', regex: /\blocation\./ },
  // DOM types
  { name: 'HTMLElement', regex: /\bHTMLElement\b/ },
  { name: 'Document type', regex: /:\s*Document\b/ },
  { name: 'Element type', regex: /:\s*Element\b/ },
  { name: 'Node type', regex: /:\s*Node\b/ },
  // FSA
  { name: 'FileSystemHandle', regex: /\bFileSystemHandle\b/ },
  { name: 'showOpenFilePicker', regex: /\bshowOpenFilePicker\b/ },
  { name: 'showSaveFilePicker', regex: /\bshowSaveFilePicker\b/ },
  // Browser persistence (engine uses injection or pure types)
  { name: 'localStorage', regex: /\blocalStorage\b/ },
  { name: 'sessionStorage', regex: /\bsessionStorage\b/ },
  { name: 'indexedDB', regex: /\bindexedDB\b/ },
  // Browser blobs / URLs
  { name: 'URL.createObjectURL', regex: /URL\.createObjectURL/ },
  { name: 'createElement', regex: /\bcreateElement\b/ },
  { name: 'querySelector', regex: /\bquerySelector\b/ },
  // I/O — engine modules use injection; UI passes a fetcher in
  { name: 'fetch(', regex: /\bfetch\s*\(/ },
];

let violations = 0;

function checkFile(path) {
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch (err) {
    // For required paths only — optional misses are OK.
    return { exists: false };
  }
  // Strip block + line comments before matching so `// fetches X`
  // in a comment doesn't trip the lint.
  const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const issues = [];
  for (const { name, regex } of FORBIDDEN_PATTERNS) {
    if (regex.test(stripped)) {
      issues.push(name);
    }
  }
  return { exists: true, issues };
}

for (const path of WATCHED_PATHS) {
  const { exists, issues } = checkFile(path);
  if (!exists) {
    console.error(`[engine-boundary] MISSING required path: ${path}`);
    violations++;
    continue;
  }
  if (issues.length > 0) {
    console.error(`[engine-boundary] ${path} uses forbidden browser globals: ${issues.join(', ')}`);
    violations++;
  }
}

for (const path of WATCHED_OPTIONAL) {
  const { exists, issues } = checkFile(path);
  if (!exists) continue;
  if (issues.length > 0) {
    console.error(`[engine-boundary] ${path} uses forbidden browser globals: ${issues.join(', ')}`);
    violations++;
  }
}

if (violations > 0) {
  console.error(
    `[engine-boundary] FAILED: ${violations} violation(s). Engine modules must stay extractable — move DOM/FSA/browser-global code into a UI module or inject it through a function parameter.`,
  );
  process.exit(1);
}

console.log(
  `[engine-boundary] OK: ${WATCHED_PATHS.length} required + ${
    WATCHED_OPTIONAL.filter((p) => {
      try {
        readFileSync(p, 'utf8');
        return true;
      } catch {
        return false;
      }
    }).length
  } optional engine modules clean.`,
);
