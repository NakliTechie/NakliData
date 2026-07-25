// Fetch the large, diverse public datasets that `realdata-drive.mjs` mounts.
// Writes to `.realdata/` (gitignored, ~96 MB) — the data is deliberately NOT
// committed; this script is the reproducible way to get it.
//
//   node scripts/realdata-fetch.mjs
//
// All sources are public and need no credentials. Kaggle was the original ask,
// but its downloads require an authenticated session (and its API 404s
// unauthenticated), so these are equivalent public datasets chosen for the same
// property: they exercise the semantic layer across clinical/PII, sensitive
// demographics, geo+temporal+money at scale, and HR — in both CSV and parquet.

import { existsSync, mkdirSync } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const DATA = resolve('.realdata');

const SOURCES = [
  {
    file: 'healthcare.csv',
    url: 'https://huggingface.co/datasets/Nicolybgs/healthcare_data/resolve/main/healthcare_data.csv',
    why: 'clinical + PII columns (doctor_name, patientid, Age, gender, Insurance, Admission_Deposit)',
    approxMb: 44,
  },
  {
    file: 'adult_census.csv',
    url: 'https://huggingface.co/datasets/scikit-learn/adult-census-income/resolve/main/adult.csv',
    why: 'sensitive demographics (race, sex, marital.status, capital.gain)',
    approxMb: 4,
  },
  {
    file: 'nyc_taxi_2024_01.parquet',
    url: 'https://d37ci6vzurychx.cloudfront.net/trip-data/yellow_tripdata_2024-01.parquet',
    why: '~3M rows: geo + temporal + money, as parquet',
    approxMb: 48,
  },
  {
    file: 'employee_attrition.parquet',
    url: 'https://huggingface.co/datasets/eduvance/employee_attrition/resolve/main/data/train-00000-of-00001.parquet',
    why: 'HR attributes',
    approxMb: 1,
  },
];

const log = (...a) => console.log('[realdata-fetch]', ...a);

async function main() {
  if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });
  let failures = 0;
  for (const s of SOURCES) {
    const dest = join(DATA, s.file);
    if (existsSync(dest)) {
      const st = await stat(dest);
      if (st.size > 1024) {
        log(`skip ${s.file} (already have ${(st.size / 1048576).toFixed(1)} MB)`);
        continue;
      }
    }
    log(`fetching ${s.file} (~${s.approxMb} MB) — ${s.why}`);
    try {
      const res = await fetch(s.url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(dest, buf);
      log(`✓ ${s.file} — ${(buf.length / 1048576).toFixed(1)} MB`);
    } catch (err) {
      failures++;
      log(`✗ ${s.file}: ${String(err).slice(0, 120)}`);
    }
  }
  if (failures > 0) {
    log(`${failures} source(s) failed — a public URL may have moved. Update SOURCES.`);
    process.exit(1);
  }
  log('all datasets present in .realdata/');
}

main().catch((e) => {
  console.error('[realdata-fetch] FAIL:', e);
  process.exit(1);
});
