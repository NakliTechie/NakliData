// SRI scenario coverage (W1.3b carryover audit). Verifies that the
// vendored DuckDB-wasm bytes round-trip the hashes declared in
// integrity.json — i.e., nobody has hand-edited the bytes since the
// postinstall fetcher ran. The CDN-path SRI verification is delegated
// to the browser's native `fetch({integrity})` machinery; this test
// guards the manifest that feeds it.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const FALLBACK_DIR = path.resolve(__dirname, '../public/duckdb-fallback');
const INTEGRITY_FILE = path.join(FALLBACK_DIR, 'integrity.json');

interface IntegrityManifest {
  version: string;
  generated: string;
  files: Record<string, string>;
}

async function loadManifest(): Promise<IntegrityManifest> {
  const text = await readFile(INTEGRITY_FILE, 'utf8');
  return JSON.parse(text) as IntegrityManifest;
}

function sriHash(bytes: Buffer, algo: 'sha256' | 'sha384' | 'sha512'): string {
  return `${algo}-${createHash(algo).update(bytes).digest('base64')}`;
}

describe('DuckDB-wasm SRI manifest (integrity.json) ↔ vendored bytes', () => {
  it('declares hashes for the four bundles the engine needs', async () => {
    const man = await loadManifest();
    expect(man.files['duckdb-mvp.wasm']).toMatch(/^sha384-/);
    expect(man.files['duckdb-eh.wasm']).toMatch(/^sha384-/);
    expect(man.files['duckdb-browser-mvp.worker.js']).toMatch(/^sha384-/);
    expect(man.files['duckdb-browser-eh.worker.js']).toMatch(/^sha384-/);
  });

  it('each declared hash matches the vendored bytes byte-for-byte', async () => {
    const man = await loadManifest();
    for (const [fname, declared] of Object.entries(man.files)) {
      const bytes = await readFile(path.join(FALLBACK_DIR, fname));
      const algo = declared.split('-', 1)[0] as 'sha256' | 'sha384' | 'sha512';
      const recomputed = sriHash(bytes, algo);
      expect(recomputed).toBe(declared);
    }
  });

  it('detects a tampered file (negative test — mutate then re-hash)', async () => {
    const man = await loadManifest();
    const fname = 'duckdb-browser-eh.worker.js';
    const declared = man.files[fname];
    expect(declared).toBeDefined();
    const bytes = await readFile(path.join(FALLBACK_DIR, fname));
    // Flip one byte in-memory (don't write back) and confirm the hash drifts.
    const tampered = Buffer.from(bytes);
    tampered[0] = tampered[0] === 0 ? 1 : 0;
    const recomputed = sriHash(tampered, 'sha384');
    expect(recomputed).not.toBe(declared);
  });
});
