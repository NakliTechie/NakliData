#!/usr/bin/env node
// Copy the built field guide into dist/guide/ so it deploys alongside the app
// and the in-app "Open the full guide" links (help modal + welcome splash)
// resolve at the relative URL `guide/index.html`.
//
// Idempotent. No-op (with a warning) if the guide hasn't been generated yet —
// run `./guide/regenerate.sh` first. Copies only the shippable output
// (index.html + screenshots/), never the generator scripts.

import { access, cp, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUIDE = join(ROOT, 'guide');
const DEST = join(ROOT, 'dist', 'guide');

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(join(GUIDE, 'index.html')))) {
    console.warn(
      '[stage-guide] guide/index.html not found — run ./guide/regenerate.sh first. Skipping.',
    );
    return;
  }
  await mkdir(DEST, { recursive: true });
  await cp(join(GUIDE, 'index.html'), join(DEST, 'index.html'));
  if (await exists(join(GUIDE, 'screenshots'))) {
    await cp(join(GUIDE, 'screenshots'), join(DEST, 'screenshots'), { recursive: true });
  }
  console.log('[stage-guide] staged guide → dist/guide/');
}

main().catch((err) => {
  console.error('[stage-guide] failed:', err);
  process.exit(1);
});
