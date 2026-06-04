#!/usr/bin/env node
// Probe — verify the postinstall hash-pin enforcement (H6 + adversarial-
// review on-disk re-verification) works end-to-end.
//
// Strategy: pick one vendored file, mutate one byte in-place, run the
// fetch script, expect exit 1 + "supply-chain alert" in stderr. Then
// restore the byte and verify the script exits 0 on the restored file.
//
// This is a probe, NOT a vitest case — the assertion is "did the script
// reject the tampered file?", which means actually running the script.
// Run from the repo root: `node scripts/probe-hash-mismatch.mjs`.
//
// Exit code: 0 if the probe passes (mismatch detected); 1 if any
// scenario fails as we expect mismatch detection to fail.

import { spawnSync } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const FALLBACK_FILE = resolve('public/duckdb-fallback/duckdb-eh.wasm');

async function fileExists(p) {
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

function runScript(name) {
  return spawnSync('node', [`scripts/${name}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function main() {
  console.log('[probe] hash-mismatch end-to-end probe (H6 + adversarial-review fix)');
  console.log('---');

  if (!(await fileExists(FALLBACK_FILE))) {
    console.error(
      `[probe] FAIL: ${FALLBACK_FILE} not present. Run \`npm install\` to vendor the bytes first.`,
    );
    process.exit(1);
  }

  // --- Step 1: baseline. Confirm clean state passes.
  console.log('[probe] Step 1: baseline — script with untampered bytes should pass.');
  const baseline = runScript('fetch-duckdb-fallback.mjs');
  if (baseline.status !== 0) {
    console.error(`[probe] FAIL: baseline run exited ${baseline.status} — bytes already drift?`);
    console.error(`[probe]   stdout: ${baseline.stdout}`);
    console.error(`[probe]   stderr: ${baseline.stderr}`);
    process.exit(1);
  }
  console.log(`[probe]   ✓ baseline exits 0 ("vendored DuckDB-wasm already present")`);

  // --- Step 2: snapshot the original byte, mutate one byte, confirm the
  // script now exits 1 with a "supply-chain alert" message.
  console.log('[probe] Step 2: mutate one byte → expect exit 1 + supply-chain alert.');
  const original = new Uint8Array(await readFile(FALLBACK_FILE));
  const tampered = new Uint8Array(original);
  // Flip the byte at offset 100 (deterministic, well past any plausible
  // header where WASM might happen to tolerate junk).
  tampered[100] = (tampered[100] ?? 0) ^ 0xff;
  await writeFile(FALLBACK_FILE, tampered);

  try {
    const mismatch = runScript('fetch-duckdb-fallback.mjs');
    const combined = `${mismatch.stdout}\n${mismatch.stderr}`;
    if (mismatch.status === 0) {
      console.error(`[probe]   ✗ FAIL: tampered run exited 0 (expected 1).`);
      console.error(`[probe]   stdout: ${mismatch.stdout}`);
      console.error(`[probe]   stderr: ${mismatch.stderr}`);
      process.exit(1);
    }
    if (!combined.includes('supply-chain alert')) {
      console.error(`[probe]   ✗ FAIL: exit non-zero but no "supply-chain alert" in output.`);
      console.error(`[probe]   stdout: ${mismatch.stdout}`);
      console.error(`[probe]   stderr: ${mismatch.stderr}`);
      process.exit(1);
    }
    console.log(
      `[probe]   ✓ tampered run exits ${mismatch.status} with "supply-chain alert" message`,
    );
  } finally {
    // --- Step 3: restore original bytes. Always run, even on failure
    // above, so we don't leave a tampered file on disk.
    await writeFile(FALLBACK_FILE, original);
    console.log('[probe] Step 3: original bytes restored.');
  }

  // --- Step 4: post-restore run should pass again (no lingering state).
  console.log('[probe] Step 4: post-restore run should pass.');
  const restored = runScript('fetch-duckdb-fallback.mjs');
  if (restored.status !== 0) {
    console.error(`[probe]   ✗ FAIL: post-restore run exited ${restored.status}.`);
    console.error(`[probe]   stdout: ${restored.stdout}`);
    console.error(`[probe]   stderr: ${restored.stderr}`);
    process.exit(1);
  }
  console.log(`[probe]   ✓ post-restore run exits 0`);

  console.log('---');
  console.log('[probe] ALL STEPS PASSED. Hash-pin enforcement working end-to-end.');
}

main().catch((err) => {
  console.error(`[probe] uncaught error: ${err.message}`);
  process.exit(1);
});
