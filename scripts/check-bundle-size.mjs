#!/usr/bin/env node
// Bundle-size gate. Spec §7.1 budgets `dist/index.html` at ≤ 600 KB.
// Runs as the last step of `npm run check`; fails the gate if the
// built shell exceeds the budget.
//
// If `dist/index.html` doesn't exist, the gate is skipped with a note
// (running `npm run build` first wires it back in). This keeps `check`
// fast during active editing while still catching regressions on any
// CI / pre-release path that builds before checking.

import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const BUNDLE_PATH = resolve('dist/index.html');
const BUDGET_BYTES = 600 * 1024; // 600 KB, spec §7.1

const fmtKB = (n) => `${(n / 1024).toFixed(1)} KB`;

try {
  const st = await stat(BUNDLE_PATH);
  const used = st.size;
  const remaining = BUDGET_BYTES - used;
  if (used > BUDGET_BYTES) {
    console.error(
      `[bundle-size] FAIL: dist/index.html is ${fmtKB(used)} — exceeds ${fmtKB(
        BUDGET_BYTES,
      )} budget by ${fmtKB(used - BUDGET_BYTES)}.`,
    );
    console.error(
      '[bundle-size] Spec §7.1 caps the shell at 600 KB. Move new logic into a lazy chunk.',
    );
    process.exit(1);
  }
  const pct = ((used / BUDGET_BYTES) * 100).toFixed(1);
  console.log(
    `[bundle-size] OK: ${fmtKB(used)} / ${fmtKB(BUDGET_BYTES)} (${pct}%); ${fmtKB(
      remaining,
    )} headroom`,
  );
} catch (err) {
  if (err && err.code === 'ENOENT') {
    console.log(
      '[bundle-size] skip: no dist/index.html. Run `npm run build` first to enable the gate.',
    );
    process.exit(0);
  }
  console.error('[bundle-size] error while stat-ing dist/index.html:', err);
  process.exit(1);
}
