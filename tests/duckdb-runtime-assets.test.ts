import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const PACKAGE_VERSION = '1.32.0';
const DUCKDB_REVISION = 'v1.4.3';
const CORE = {
  'duckdb-browser-eh.worker.js':
    'sha384-a2Q5wPfMJHriw96D3xhtkym83ST11xUIm6e27q9d3v4ykPqSzeY7WCXK6CTlJFwb',
  'duckdb-browser-mvp.worker.js':
    'sha384-ABB4QFgUoQqfiMRv4Eme20RCo+rO//OBEOJfiUbiZFBRH/4T4xy8Vcu4hLXgPxQ0',
  'duckdb-eh.wasm': 'sha384-hw3GjeJZY5QapQ8mwqMHXBPVmTLO+jKm5dlDwkGsEfjyu/HcXx1d0Rwlr/ZAShjq',
  'duckdb-mvp.wasm': 'sha384-aPxDmtovNQyMTy8S7zolNUiHoQNvtkLGOWJdPtQpW1T52DQuqeGutmEdb0ycBoNs',
} as const;
const PLATFORMS = ['wasm_eh', 'wasm_mvp'] as const;
const REQUIRED_EXTENSIONS = [
  'json.duckdb_extension.wasm',
  'sqlite_scanner.duckdb_extension.wasm',
  'sqlite.duckdb_extension.wasm',
  'parquet.duckdb_extension.wasm',
  'spatial.duckdb_extension.wasm',
  'httpfs.duckdb_extension.wasm',
  'iceberg.duckdb_extension.wasm',
  'avro.duckdb_extension.wasm',
] as const;

function sri(bytes: Uint8Array): string {
  return `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
}

describe('checked-in DuckDB runtime assets', () => {
  it('pins the approved package and lockfile integrity', async () => {
    const packageJson = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
    const packageLock = JSON.parse(await readFile(resolve(ROOT, 'package-lock.json'), 'utf8'));
    expect(packageJson.dependencies['@duckdb/duckdb-wasm']).toBe(PACKAGE_VERSION);
    expect(packageLock.packages['node_modules/@duckdb/duckdb-wasm']).toMatchObject({
      version: PACKAGE_VERSION,
      integrity:
        'sha512-IewXTNYEjsZCPE9weUWgtjGxUlMRo7qhX0GF6tq/KjK8bnY+RAl4cyUdYUfcdzbyb4b9ZxPC+FOsCcxgaKFWMg==',
    });
  });

  it('matches all EH and MVP core bytes to the committed manifest', async () => {
    const manifest = JSON.parse(
      await readFile(resolve(ROOT, 'public/duckdb-fallback/integrity.json'), 'utf8'),
    );
    expect(manifest.version).toBe(PACKAGE_VERSION);
    expect(manifest.files).toEqual(CORE);
    for (const [filename, expected] of Object.entries(CORE)) {
      const bytes = new Uint8Array(
        await readFile(resolve(ROOT, 'public/duckdb-fallback', filename)),
      );
      expect(sri(bytes), filename).toBe(expected);
    }
  });

  for (const platform of PLATFORMS) {
    it(`matches the complete ${platform} extension repository to its manifest`, async () => {
      const directory = resolve(ROOT, 'public/duckdb-extensions', DUCKDB_REVISION, platform);
      const manifest = JSON.parse(await readFile(resolve(directory, 'integrity.json'), 'utf8'));
      expect(manifest).toMatchObject({ revision: DUCKDB_REVISION, platform });
      expect(Object.keys(manifest.files).sort()).toEqual([...REQUIRED_EXTENSIONS].sort());
      for (const filename of REQUIRED_EXTENSIONS) {
        const bytes = new Uint8Array(await readFile(resolve(directory, filename)));
        expect(sri(bytes), `${platform}/${filename}`).toBe(manifest.files[filename]);
      }
    });
  }

  it('detects in-memory core and extension tampering', async () => {
    const core = new Uint8Array(
      await readFile(resolve(ROOT, 'public/duckdb-fallback/duckdb-browser-eh.worker.js')),
    );
    const extension = new Uint8Array(
      await readFile(
        resolve(ROOT, 'public/duckdb-extensions/v1.4.3/wasm_eh/iceberg.duckdb_extension.wasm'),
      ),
    );
    core[0] = (core[0] ?? 0) ^ 0xff;
    extension[0] = (extension[0] ?? 0) ^ 0xff;
    expect(sri(core)).not.toBe(CORE['duckdb-browser-eh.worker.js']);
    const manifest = JSON.parse(
      await readFile(
        resolve(ROOT, 'public/duckdb-extensions/v1.4.3/wasm_eh/integrity.json'),
        'utf8',
      ),
    );
    expect(sri(extension)).not.toBe(manifest.files['iceberg.duckdb_extension.wasm']);
  });
});
