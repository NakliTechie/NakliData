// Tier-3 UniversalTerm layer — validation, resolvers, and the sensitivity
// PARITY CONTRACT (decision #4). Loads the REAL taxonomy/v0.1/universal bundle
// so this also validates the shipped JSONL parses + is structurally sound.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultStrategyForSensitivity } from '../src/core/anonymize.ts';
import type { TaxonomyBundle, TypeSensitivity, TypeSpec } from '../src/taxonomy/types.ts';
import {
  hasSensitivityLayer,
  parseUniversalLayer,
  roleFamilyForType,
  sensitivityForType,
  universalTermForType,
  validateUniversalLayer,
} from '../src/taxonomy/universal.ts';

const BASE = join(process.cwd(), 'taxonomy', 'v0.1');
const types: TypeSpec[] = readFileSync(join(BASE, 'types.jsonl'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => JSON.parse(l) as TypeSpec);
const layer = parseUniversalLayer(
  readFileSync(join(BASE, 'universal', 'universal-terms.jsonl'), 'utf8'),
  readFileSync(join(BASE, 'universal', 'crosswalk.jsonl'), 'utf8'),
);
const bundle: TaxonomyBundle = {
  version: '0.1',
  released: '2026-05-15',
  domains: [],
  types,
  universal: layer,
};

const golden: Record<string, TypeSensitivity> = JSON.parse(
  readFileSync(join(process.cwd(), 'tests', 'fixtures', 'sensitivity-parity.json'), 'utf8'),
);

describe('universal layer — structural validity', () => {
  it('the shipped layer passes validation with zero errors', () => {
    expect(validateUniversalLayer(layer, types)).toEqual([]);
  });
  it('every one of the shipped types has a crosswalk entry', () => {
    const roles = new Set(layer.crosswalk.map((c) => c.role));
    expect(types.every((t) => roles.has(t.id))).toBe(true);
    expect(layer.crosswalk.length).toBe(types.length);
  });
  it('every term is ut:-prefixed and every crosswalk target exists', () => {
    expect(layer.terms.every((t) => t.id.startsWith('ut:'))).toBe(true);
    const termIds = new Set(layer.terms.map((t) => t.id));
    expect(layer.crosswalk.every((c) => termIds.has(c.universalTerm))).toBe(true);
  });
});

describe('universal layer — validator catches breakage', () => {
  it('flags an unmapped type', () => {
    const errs = validateUniversalLayer(
      { terms: layer.terms, crosswalk: layer.crosswalk.filter((c) => c.role !== 'amount') },
      types,
    );
    expect(errs.some((e) => e.includes('amount'))).toBe(true);
  });
  it('flags a broader cycle', () => {
    const errs = validateUniversalLayer(
      {
        terms: [
          {
            id: 'ut:a',
            prefLabel: 'A',
            broader: ['ut:b'],
            roleFamily: 'dimension',
            sensitivity: 'public',
          },
          {
            id: 'ut:b',
            prefLabel: 'B',
            broader: ['ut:a'],
            roleFamily: 'dimension',
            sensitivity: 'public',
          },
        ],
        crosswalk: [],
      },
      [],
    );
    expect(errs.some((e) => e.includes('cycle'))).toBe(true);
  });
  it('flags a crosswalk pointing at an undefined term', () => {
    const errs = validateUniversalLayer(
      { terms: layer.terms, crosswalk: [{ role: 'amount', universalTerm: 'ut:nonexistent' }] },
      types,
    );
    expect(errs.some((e) => e.includes('ut:nonexistent'))).toBe(true);
  });
  it('rejects a report_slot smuggled onto a term (decision #5 — placement is the report engine)', () => {
    const errs = validateUniversalLayer(
      {
        terms: [
          {
            id: 'ut:x',
            prefLabel: 'X',
            roleFamily: 'measure',
            sensitivity: 'public',
            reportSlot: 'kpi.total',
          } as never,
        ],
        crosswalk: [],
      },
      [],
    );
    expect(errs.some((e) => e.includes('report_slot'))).toBe(true);
  });
});

describe('universal layer — resolvers', () => {
  it('universalTermForType resolves a mapped role', () => {
    expect(universalTermForType(bundle, 'amount')?.id).toBe('ut:monetary_amount');
    expect(universalTermForType(bundle, 'not_a_type')).toBeNull();
  });
  it('roleFamilyForType returns the analytical family', () => {
    expect(roleFamilyForType(bundle, 'amount')).toBe('measure'); // monetary → measure
    expect(roleFamilyForType(bundle, 'customer_id')).toBe('entity'); // id → entity
    expect(roleFamilyForType(bundle, 'state_region')).toBe('dimension');
    expect(roleFamilyForType(bundle, 'percentage')).toBe('metric');
  });
  it('sensitivityForType applies per-role overrides over the concept default', () => {
    // host_id maps to ut:person_identifier (pii) but overrides to public
    expect(universalTermForType(bundle, 'host_id')?.id).toBe('ut:person_identifier');
    expect(sensitivityForType(bundle, 'host_id')).toBe('public');
    // card_last4 maps to ut:payment_card (financial) but overrides to secret
    expect(sensitivityForType(bundle, 'card_last4')).toBe('secret');
  });
  it('resolvers fall back safely with no layer', () => {
    const bare: TaxonomyBundle = { version: '0.1', released: 'x', domains: [], types };
    expect(sensitivityForType(bare, 'amount')).toBe('public');
    expect(roleFamilyForType(bare, 'amount')).toBeNull();
    expect(universalTermForType(bare, 'amount')).toBeNull();
  });
});

describe('anonymize FAIL-CLOSED guard (security — no plaintext leak on missing layer)', () => {
  it('hasSensitivityLayer is false without the layer → the sink must refuse to export', () => {
    // With the layer, exports are allowed; without it (independent fetch failure),
    // sensitivityForType degrades to public→keep, so the sink refuses instead.
    expect(hasSensitivityLayer(bundle)).toBe(true);
    expect(hasSensitivityLayer({ version: '0.1', released: 'x', domains: [], types })).toBe(false);
    expect(hasSensitivityLayer(null)).toBe(false);
  });
  it('documents the failure mode this guards: no layer makes every column look public', () => {
    const bare: TaxonomyBundle = { version: '0.1', released: 'x', domains: [], types };
    // api_key is secret WITH the layer, but 'public' without it — the exact
    // degradation ('public' → keep → plaintext) the sink guard exists to catch.
    expect(sensitivityForType(bundle, 'api_key')).toBe('secret');
    expect(sensitivityForType(bare, 'api_key')).toBe('public');
  });
});

describe('universal layer — SENSITIVITY PARITY CONTRACT (decision #4)', () => {
  it('sensitivityForType matches the pre-migration types.jsonl value for ALL 145 types', () => {
    const mismatches: string[] = [];
    for (const t of types) {
      const got = sensitivityForType(bundle, t.id);
      const want = golden[t.id] ?? 'public';
      if (got !== want) mismatches.push(`${t.id}: got ${got}, want ${want}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('the anonymize STRATEGY is unchanged for every type (crosswalk → default strategy)', () => {
    // The anonymize sink now resolves sensitivity via sensitivityForType (the
    // migrated seam). Prove the strategy each column gets is identical to what
    // the pre-migration sensitivity produced — the real risk of decision #4.
    const mismatches: string[] = [];
    for (const t of types) {
      const migrated = defaultStrategyForSensitivity(sensitivityForType(bundle, t.id));
      const pre = defaultStrategyForSensitivity(golden[t.id] ?? 'public');
      if (migrated !== pre) mismatches.push(`${t.id}: ${migrated} != ${pre}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('exemplar sensitive columns still drive the right anonymize strategy', () => {
    // secret→redact, pii→hash, financial→bucket, public→keep — end to end.
    expect(defaultStrategyForSensitivity(sensitivityForType(bundle, 'api_key'))).toBe('redact');
    expect(defaultStrategyForSensitivity(sensitivityForType(bundle, 'patient_id'))).toBe('redact');
    expect(defaultStrategyForSensitivity(sensitivityForType(bundle, 'email'))).toBe('hash');
    expect(defaultStrategyForSensitivity(sensitivityForType(bundle, 'amount'))).toBe('bucket');
    expect(defaultStrategyForSensitivity(sensitivityForType(bundle, 'card_last4'))).toBe('redact');
    expect(defaultStrategyForSensitivity(sensitivityForType(bundle, 'room_type'))).toBe('keep');
  });
});
