#!/usr/bin/env node
// Extraction-readiness lint boundary.
//
// Pure engine modules may not depend on DOM, FSA, persistence, or direct
// network globals. Directory discovery keeps newly-added taxonomy, agent,
// cleaning, and sidecar-pure modules inside the gate automatically. The
// small exception map names browser adapters explicitly and requires a
// reason, so an unreviewed file cannot silently escape the boundary.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED_ENGINE_FILES = [
  'src/core/lineage.ts',
  'src/core/lineage-store.ts',
  'src/core/anonymize.ts',
  'src/core/chart-config.ts',
  'src/core/query-builder.ts',
  'src/core/refresh.ts',
  'src/core/measures.ts',
  'src/core/selections.ts',
  'src/core/stats.ts',
  'src/core/report-layout.ts',
  'src/core/chart-shelves.ts',
  'src/core/lineage-edit.ts',
  'src/core/clustering.ts',
  'src/core/segments.ts',
  'src/core/golden.ts',
  'src/core/embed-search.ts',
  'src/core/graph-metrics.ts',
  'src/core/graph-metrics-protocol.ts',
];

const WATCHED_DIRECTORIES = [
  {
    path: 'src/taxonomy',
    exceptions: {
      'src/taxonomy/client.ts': 'browser worker URL/bootstrap adapter',
    },
  },
  { path: 'src/core/agent', exceptions: {} },
  { path: 'src/core/cleaning', exceptions: {} },
  {
    path: 'src/core/sidecar',
    exceptions: {
      'src/core/sidecar/byok.ts': 'browser credential-persistence adapter',
      'src/core/sidecar/local-cache.ts': 'OPFS cache adapter',
      'src/core/sidecar/providers/anthropic.ts': 'Anthropic network transport',
      'src/core/sidecar/providers/custom-openai.ts': 'custom OpenAI-compatible network transport',
      'src/core/sidecar/providers/openai.ts': 'OpenAI network transport',
    },
  },
];

const FORBIDDEN_PATTERNS = [
  { name: 'document.', regex: /\bdocument\./ },
  { name: 'window.', regex: /\bwindow\./ },
  { name: 'navigator.', regex: /\bnavigator\./ },
  { name: 'location.', regex: /\blocation\./ },
  { name: 'HTMLElement', regex: /\bHTMLElement\b/ },
  { name: 'Document type', regex: /:\s*Document\b/ },
  { name: 'Element type', regex: /:\s*Element\b/ },
  { name: 'Node type', regex: /:\s*Node\b/ },
  { name: 'FileSystemHandle', regex: /\bFileSystemHandle\b/ },
  { name: 'showOpenFilePicker', regex: /\bshowOpenFilePicker\b/ },
  { name: 'showSaveFilePicker', regex: /\bshowSaveFilePicker\b/ },
  { name: 'localStorage', regex: /\blocalStorage\b/ },
  { name: 'sessionStorage', regex: /\bsessionStorage\b/ },
  { name: 'indexedDB', regex: /\bindexedDB\b/ },
  { name: 'URL.createObjectURL', regex: /URL\.createObjectURL/ },
  { name: 'createElement', regex: /\bcreateElement\b/ },
  { name: 'querySelector', regex: /\bquerySelector\b/ },
  { name: 'fetch(', regex: /\bfetch\s*\(/ },
  { name: 'Blob', regex: /\bBlob\b/ },
  { name: 'File type', regex: /:\s*File\b/ },
];

function collectTypeScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(path);
    return entry.isFile() && path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function checkFile(path) {
  const source = stripComments(readFileSync(path, 'utf8'));
  return FORBIDDEN_PATTERNS.filter(({ regex }) => regex.test(source)).map(({ name }) => name);
}

let violations = 0;
const watched = new Set(REQUIRED_ENGINE_FILES);
let exceptionCount = 0;

for (const path of REQUIRED_ENGINE_FILES) {
  try {
    if (!statSync(path).isFile()) throw new Error('not a file');
  } catch {
    console.error(`[engine-boundary] MISSING required path: ${path}`);
    violations++;
  }
}

for (const directory of WATCHED_DIRECTORIES) {
  const discovered = collectTypeScriptFiles(directory.path);
  const discoveredSet = new Set(discovered);
  for (const [path, reason] of Object.entries(directory.exceptions)) {
    exceptionCount++;
    if (!reason.trim()) {
      console.error(`[engine-boundary] exception lacks a reason: ${path}`);
      violations++;
    }
    if (!discoveredSet.has(path)) {
      console.error(`[engine-boundary] stale exception does not resolve to a module: ${path}`);
      violations++;
    }
  }
  for (const path of discovered) {
    if (!(path in directory.exceptions)) watched.add(path);
  }
}

for (const path of watched) {
  let issues;
  try {
    issues = checkFile(path);
  } catch {
    continue;
  }
  if (issues.length > 0) {
    console.error(`[engine-boundary] ${path} uses forbidden browser globals: ${issues.join(', ')}`);
    violations++;
  }
}

if (violations > 0) {
  console.error(
    `[engine-boundary] FAILED: ${violations} violation(s). Move browser code into an explicit adapter or inject it through a function parameter.`,
  );
  process.exit(1);
}

console.log(
  `[engine-boundary] OK: ${watched.size} engine modules clean; ${exceptionCount} explicit browser adapters documented.`,
);
