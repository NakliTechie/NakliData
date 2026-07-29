#!/usr/bin/env node
// Enforce the repository rule that concrete UI colors live in
// src/tokens/colors.ts. Components may interpolate tokens or consume the
// CSS custom properties declared by shell.css.ts, but may not introduce
// their own hex/RGB literals.

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const ROOT = 'src';
const EXCLUDED_DIRECTORIES = new Set(['src/tokens', 'src/vendor']);
const SOURCE_EXTENSIONS = new Set(['.css', '.html', '.ts']);
const COLOR_PATTERNS = [
  { name: 'hex color', regex: /#[0-9A-Fa-f]{3,8}\b/g },
  { name: 'numeric rgb()/rgba()', regex: /\brgba?\s*\(\s*\d/gi },
  {
    name: 'named color',
    regex:
      /\b(?:color|background(?:-color)?|border-color)\s*:\s*(?:white|black|red|blue|green|orange|purple|gray|grey)\b/gi,
  },
];

function collectSourceFiles(directory) {
  if (EXCLUDED_DIRECTORIES.has(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(path);
    return entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  });
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

const violations = [];
for (const path of collectSourceFiles(ROOT)) {
  const source = stripComments(readFileSync(path, 'utf8'));
  for (const { name, regex } of COLOR_PATTERNS) {
    regex.lastIndex = 0;
    for (const match of source.matchAll(regex)) {
      const line = source.slice(0, match.index).split('\n').length;
      violations.push(`${path}:${line} ${name}: ${match[0]}`);
    }
  }
}

if (violations.length > 0) {
  console.error('[color-tokens] FAILED: concrete colors must come from src/tokens/colors.ts.');
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}

console.log('[color-tokens] OK: no concrete color literals outside src/tokens/colors.ts.');
