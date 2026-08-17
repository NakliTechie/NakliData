#!/usr/bin/env node
// Vendor DuckDB extensions into a same-origin repository for both selectable
// WASM variants. Each platform owns an integrity manifest. A first migration
// may bootstrap a new revision only when ALLOW_DUCKDB_EXT_BOOTSTRAP=1 is set;
// every later run verifies both downloaded and existing bytes fail-closed.

import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const REVISION = 'v1.4.3';
const PLATFORMS = ['wasm_eh', 'wasm_mvp'];
const DEST = resolve('public/duckdb-extensions');
const REMOTE_ROOT = 'https://extensions.duckdb.org';

// Keep the browser's complete local extension surface available after the
// runtime migration. The Iceberg data-plane closure is httpfs + iceberg +
// parquet + avro. json/sqlite/spatial preserve existing source mounts.
const EXTENSIONS = [
  { name: 'json', aliasFrom: [] },
  { name: 'sqlite_scanner', aliasFrom: ['sqlite'] },
  { name: 'parquet', aliasFrom: [] },
  { name: 'spatial', aliasFrom: [] },
  { name: 'httpfs', aliasFrom: [] },
  { name: 'iceberg', aliasFrom: [] },
  { name: 'avro', aliasFrom: [] },
];

// Candidate-spike hashes are independent anchors for the Iceberg closure.
// They are checked in addition to each platform's committed SRI manifest.
const CANDIDATE_HEX = {
  wasm_eh: {
    httpfs:
      '82cf73b3c093f2cda14c843dd4561d07479f6169f14fa95d2adc47dc0cdd46116fd6e92dd2be00b8e2539510f7d261ad',
    iceberg:
      'e1fee67dd6bbce713fb30cc60be0e2784b794dc50d1415ceadb082ad18394abdb8c940a65c0120228ee7165bd4284db6',
    parquet:
      '04e43345195622506c82e462338947dcdbc0f869756827d82752233a3c9a503d39eba483ecde89a384e74f42e6295bec',
    avro: '9c22895b0aac67d7eaebbcb1c0b22bc3b145c053ab3f1c950eaedb8f92e5a0902a2b09c5043f9c2cab097e075829d016',
  },
  wasm_mvp: {
    httpfs:
      '90285ab5ee27cc9e2581af5ae70c2617dddb3eaa63f6c51960aa72446e7ca3ca75776fd5d4e4882c66afa8202a56babf',
    iceberg:
      '558d3624b6f5240c63ff857f44488077130229b3d213997c4d9279695ada500a85de9ae7ebfd73608b4e525095b3d771',
    parquet:
      '62fe0eb44ff51278846bd4dfc0abb86f309e8dddf7c5fa05d542329e1e52dc82bb75641f3758c7866141d7655187d5fd',
    avro: '8ced489ba9f0e60a8ece59d2952066857edaa46caef7843b91abaa3100bfbd24c722341b76953800c209dbb0c46ec95c',
  },
};

async function fileExists(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function hashes(bytes) {
  return {
    hex: createHash('sha384').update(bytes).digest('hex'),
    sri: `sha384-${createHash('sha384').update(bytes).digest('base64')}`,
  };
}

async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > 32 * 1024 * 1024) {
    throw new Error(`${url} declares ${declared} bytes, above the 32 MiB ceiling`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 32 * 1024 * 1024) {
    throw new Error(`${url} exceeded the 32 MiB ceiling`);
  }
  return bytes;
}

async function loadManifest(platform) {
  const path = resolve(DEST, REVISION, platform, 'integrity.json');
  if (!(await fileExists(path))) return null;
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  if (
    parsed?.revision !== REVISION ||
    parsed?.platform !== platform ||
    !parsed.files ||
    typeof parsed.files !== 'object'
  ) {
    throw new Error(`invalid extension integrity manifest: ${path}`);
  }
  return parsed;
}

function filenamesFor(extension) {
  return [
    `${extension.name}.duckdb_extension.wasm`,
    ...extension.aliasFrom.map((alias) => `${alias}.duckdb_extension.wasm`),
  ];
}

async function verifyExisting(platform, manifest) {
  const directory = resolve(DEST, REVISION, platform);
  for (const extension of EXTENSIONS) {
    for (const filename of filenamesFor(extension)) {
      const path = resolve(directory, filename);
      if (!(await fileExists(path))) return false;
      const expected = manifest.files[filename];
      if (!expected) throw new Error(`integrity manifest has no entry for ${platform}/${filename}`);
      const actual = hashes(new Uint8Array(await readFile(path))).sri;
      if (actual !== expected) {
        throw new Error(
          `on-disk hash mismatch for ${platform}/${filename}\n  expected: ${expected}\n  got:      ${actual}`,
        );
      }
    }
  }
  return true;
}

async function vendorPlatform(platform) {
  const directory = resolve(DEST, REVISION, platform);
  await mkdir(directory, { recursive: true });
  const manifest = await loadManifest(platform);
  const bootstrap = manifest === null;
  if (bootstrap && process.env.ALLOW_DUCKDB_EXT_BOOTSTRAP !== '1') {
    throw new Error(
      `no manifest for ${REVISION}/${platform}; set ALLOW_DUCKDB_EXT_BOOTSTRAP=1 for the reviewed migration`,
    );
  }
  if (
    process.env.FORCE_DUCKDB_EXT_FETCH !== '1' &&
    manifest &&
    (await verifyExisting(platform, manifest))
  ) {
    console.log(`[naklidata] vendored DuckDB extensions already present (${REVISION}/${platform})`);
    return;
  }

  const next = {
    revision: REVISION,
    platform,
    generated: bootstrap ? new Date().toISOString() : 'pinned',
    files: {},
  };
  for (const extension of EXTENSIONS) {
    const filename = `${extension.name}.duckdb_extension.wasm`;
    const url = `${REMOTE_ROOT}/${REVISION}/${platform}/${filename}`;
    const bytes = await fetchBytes(url);
    const actual = hashes(bytes);
    const candidate = CANDIDATE_HEX[platform]?.[extension.name];
    if (candidate && actual.hex !== candidate) {
      throw new Error(
        `candidate hash mismatch for ${platform}/${filename}\n  expected: ${candidate}\n  got:      ${actual.hex}`,
      );
    }
    if (manifest) {
      const expected = manifest.files[filename];
      if (!expected) throw new Error(`integrity manifest has no entry for ${platform}/${filename}`);
      if (actual.sri !== expected) {
        throw new Error(
          `download hash mismatch for ${platform}/${filename}\n  expected: ${expected}\n  got:      ${actual.sri}`,
        );
      }
    }
    await writeFile(resolve(directory, filename), bytes);
    next.files[filename] = actual.sri;
    for (const alias of extension.aliasFrom) {
      const aliasName = `${alias}.duckdb_extension.wasm`;
      const expectedAlias = manifest?.files[aliasName];
      if (manifest && expectedAlias !== actual.sri) {
        throw new Error(`integrity manifest alias mismatch for ${platform}/${aliasName}`);
      }
      await writeFile(resolve(directory, aliasName), bytes);
      next.files[aliasName] = actual.sri;
    }
    console.log(
      `  ${platform}/${filename} (${(bytes.byteLength / 1024).toFixed(0)} KiB) ${actual.sri.slice(0, 24)}...`,
    );
  }
  if (bootstrap) {
    await writeFile(resolve(directory, 'integrity.json'), `${JSON.stringify(next, null, 2)}\n`);
    console.log(`  ${platform}/integrity.json (${Object.keys(next.files).length} hashes)`);
  }
}

async function main() {
  if (process.env.SKIP_DUCKDB_EXT_FETCH === '1') {
    console.log('[naklidata] SKIP_DUCKDB_EXT_FETCH=1 - skipping vendored extensions');
    return;
  }
  for (const platform of PLATFORMS) await vendorPlatform(platform);
}

main().catch((error) => {
  console.error(`[naklidata] extension vendoring failed: ${error.message}`);
  process.exit(1);
});
