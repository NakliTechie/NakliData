// Sensitive-data domain pack (PII / secrets) — from the Purview/GCP/Presidio
// detector families. Loads the REAL taxonomy/v0.1 bundle and asserts each type
// classifies + carries the right sensitivity (which drives the anonymize sink:
// secret→redact, pii→hash, financial→bucket).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyColumn } from '../src/taxonomy/classify.ts';
import type { ColumnSample, TaxonomyBundle, TypeSpec } from '../src/taxonomy/types.ts';
import { parseUniversalLayer, sensitivityForType } from '../src/taxonomy/universal.ts';

const types: TypeSpec[] = readFileSync(
  join(process.cwd(), 'taxonomy', 'v0.1', 'types.jsonl'),
  'utf8',
)
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => JSON.parse(l) as TypeSpec);
const BASE = join(process.cwd(), 'taxonomy', 'v0.1');
const universal = parseUniversalLayer(
  readFileSync(join(BASE, 'universal', 'universal-terms.jsonl'), 'utf8'),
  readFileSync(join(BASE, 'universal', 'crosswalk.jsonl'), 'utf8'),
);
const BUNDLE: TaxonomyBundle = {
  version: '0.1',
  released: '2026-05-15',
  domains: [],
  types,
  universal,
};

function sample(columnName: string, values: string[], sqlType = 'VARCHAR'): ColumnSample {
  return {
    tableName: 't',
    columnName,
    sqlType,
    values,
    totalSampled: values.length,
    nullCount: 0,
    distinctCount: new Set(values).size,
  };
}
const top = (name: string, values: string[]): string | null =>
  classifyColumn(BUNDLE, sample(name, values)).candidates[0]?.typeId ?? null;
const sens = (id: string) => sensitivityForType(BUNDLE, id);

describe('sensitive-data — secrets classify by value pattern', () => {
  it('JWT (by value — neutral header so it does not tie with credential_secret)', () => {
    expect(
      top('raw_value', [
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-DEF_123',
        'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIyIn0.xyz_QRS-456',
      ]),
    ).toBe('jwt');
  });
  it('AWS access key id', () => {
    expect(top('key', ['AKIAIOSFODNN7EXAMPLE', 'AKIA1234567890ABCDEF'])).toBe('aws_access_key_id');
  });
  it('private key PEM', () => {
    expect(top('k', ['-----BEGIN RSA PRIVATE KEY-----', '-----BEGIN EC PRIVATE KEY-----'])).toBe(
      'private_key_pem',
    );
  });
  it('credential/api_key by header', () => {
    expect(top('password', ['hunter2', 's3cr3t!', 'p@ssw0rd'])).toBe('credential_secret');
    expect(top('api_key', ['abc123', 'def456', 'ghi789'])).toBe('api_key');
  });
});

describe('sensitive-data — financial + PII', () => {
  it('credit card by value', () => {
    expect(top('cc', ['4111111111111111', '5500005555555559', '340000000000009'])).toBe(
      'credit_card_number',
    );
  });
  it('SSN', () => {
    expect(top('ssn', ['123-45-6789', '001-23-4567'])).toBe('ssn');
  });
  it('MAC address', () => {
    expect(top('device', ['3D:F2:C9:A6:B3:4F', '00-1B-44-11-3A-B7'])).toBe('mac_address');
  });
  it('crypto wallet (ETH)', () => {
    expect(
      top('wallet', [
        '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        '0x0000000000000000000000000000000000000000',
      ]),
    ).toBe('crypto_wallet_address');
  });
  it('DOB by header + date', () => {
    expect(top('dob', ['1990-05-14', '1985-11-02', '2001-01-30'])).toBe('date_of_birth');
  });
  it('passport by header', () => {
    expect(top('passport_no', ['X1234567', 'A9876543'])).toBe('passport_number');
  });
});

describe('sensitive-data — sensitivity drives anonymize defaults', () => {
  it('secrets are sensitivity=secret (→ redact)', () => {
    for (const id of [
      'credential_secret',
      'api_key',
      'jwt',
      'private_key_pem',
      'aws_access_key_id',
    ])
      expect(sens(id)).toBe('secret');
  });
  it('personal ids are sensitivity=pii (→ hash); cards financial (→ bucket)', () => {
    for (const id of ['ssn', 'date_of_birth', 'passport_number', 'mac_address', 'national_id'])
      expect(sens(id)).toBe('pii');
    expect(sens('credit_card_number')).toBe('financial');
  });
});

describe('sensitive-data — no false positives on plain values', () => {
  it('a plain 16-digit id is not a credit card; a phone is not an SSN', () => {
    expect(top('order_ref', ['1234567890123456', '2345678901234567'])).not.toBe(
      'credit_card_number',
    );
    expect(top('phone', ['555-1234', '555-9876'])).not.toBe('ssn');
  });
});
