import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type CanonicalInterchangeV0,
  type CanonicalInterchangeV1,
  type LossRecord,
  NAKLIDATA_VOCABULARY_IRI,
  appendLoss,
  canonicalId,
  canonicalIri,
  migrateCanonicalInterchange,
  resourceKindOf,
  serializeCanonicalInterchange,
  validateCanonicalInterchange,
} from '../src/core/standards/interchange.ts';
import {
  MAX_STANDARDS_MESSAGE_BYTES,
  handleStandardsWorkerRequest,
} from '../src/workers/standards-interchange-worker.ts';

const fixture = readFixture<CanonicalInterchangeV1>('canonical-v1.json');
const invalidFixture = readFixture<CanonicalInterchangeV1>('invalid-references-v1.json');

describe('canonical standards interchange foundation', () => {
  it('validates the canonical aliases, mapping, cardinality, constraints, and derivation fixture', () => {
    expect(validateCanonicalInterchange(fixture)).toEqual([]);
    expect(fixture.concepts[1]?.alternateLabels).toHaveLength(2);
    expect(fixture.concepts[1]?.mappings[0]?.kind).toBe('close');
    expect(fixture.relationships[0]?.cardinality).toBe('many_to_one');
    expect(fixture.constraints.map((constraint) => constraint.kind)).toEqual([
      'min_count',
      'datatype',
      'enumeration',
    ]);
    expect(fixture.provenance.relations.map((relation) => relation.kind)).toEqual([
      'used',
      'was_generated_by',
      'was_derived_from',
      'was_associated_with',
    ]);
    expect(fixture.losses[0]?.construct).toBe('sh:or');
  });

  it('creates reversible, kind-scoped identifiers and absolute resource IRIs', () => {
    const id = canonicalId('field', 'source-7::table-2::Invoice Total');
    expect(id).toBe('nd:field:source-7%3A%3Atable-2%3A%3AInvoice%20Total');
    expect(resourceKindOf(id)).toBe('field');
    expect(resourceKindOf('nd:field:bad value')).toBeNull();
    expect(canonicalIri(fixture.namespace, id)).toBe(`${fixture.namespace.baseIri}${id}`);
  });

  it('rejects dangling references and relationship field ownership drift', () => {
    const issues = validateCanonicalInterchange(invalidFixture);
    expect(issues).toContainEqual({
      code: 'unknown_reference',
      path: 'tables[0].sourceId',
      message: 'unknown identifier nd:source:missing.',
    });

    const changed = structuredClone(fixture);
    const pair = changed.relationships[0]?.columnPairs[0];
    if (!pair) throw new Error('fixture relationship pair missing');
    pair.fromFieldId = 'nd:field:vendors-vendor-id';
    expect(validateCanonicalInterchange(changed)).toContainEqual({
      code: 'field_ownership',
      path: 'relationships[0].columnPairs[0].fromFieldId',
      message: 'field does not belong to fromTableId.',
    });
  });

  it('rejects unrecognized mapping, provenance, and loss vocabulary', () => {
    const changed = structuredClone(fixture) as unknown as Record<string, unknown>;
    const concepts = changed.concepts as Array<Record<string, unknown>>;
    const mappings = concepts[1]?.mappings as Array<Record<string, unknown>>;
    const provenance = changed.provenance as Record<string, unknown>;
    const relations = provenance.relations as Array<Record<string, unknown>>;
    const losses = changed.losses as Array<Record<string, unknown>>;
    if (!mappings[0] || !relations[0] || !losses[0]) throw new Error('fixture records missing');
    mappings[0].kind = 'sameAs';
    relations[0].kind = 'influenced';
    losses[0].severity = 'notice';
    const issues = validateCanonicalInterchange(changed as unknown as CanonicalInterchangeV1);
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['mapping_kind', 'provenance_relation_kind', 'loss_severity']),
    );
  });

  it('migrates the pre-release namespace shape and records the transformation', () => {
    const { namespace, losses: _losses, ...rest } = structuredClone(fixture);
    const v0: CanonicalInterchangeV0 = {
      ...rest,
      version: 0,
      baseIri: namespace.baseIri,
      prefixes: namespace.prefixes,
    };
    const migrated = migrateCanonicalInterchange(v0);
    expect(migrated.fromVersion).toBe(0);
    expect(migrated.document.version).toBe(1);
    expect(migrated.document.namespace.prefixes.nd).toBe(NAKLIDATA_VOCABULARY_IRI);
    expect(migrated.losses).toEqual([
      expect.objectContaining({ code: 'migration.v0.namespace_wrapped', severity: 'information' }),
    ]);
    expect(validateCanonicalInterchange(migrated.document)).toEqual([]);
  });

  it('serializes objects canonically and preserves contract-significant array order', () => {
    const reordered = {
      losses: fixture.losses,
      provenance: fixture.provenance,
      constraints: fixture.constraints,
      relationships: fixture.relationships,
      concepts: fixture.concepts,
      fields: fixture.fields,
      tables: fixture.tables,
      sources: fixture.sources,
      workbook: fixture.workbook,
      namespace: fixture.namespace,
      version: fixture.version,
      format: fixture.format,
    } satisfies CanonicalInterchangeV1;
    expect(serializeCanonicalInterchange(reordered)).toBe(serializeCanonicalInterchange(fixture));
  });

  it('deduplicates loss records by adapter code, path, and construct', () => {
    const first = fixture.losses[0];
    if (!first) throw new Error('fixture loss missing');
    const replacement: LossRecord = { ...first, message: 'Updated disclosure.' };
    expect(appendLoss(fixture.losses, replacement)).toEqual([replacement]);
  });

  it('keeps validation and migration behind a bounded worker request surface', () => {
    expect(
      handleStandardsWorkerRequest({ id: 'v1', operation: 'validate', document: fixture }),
    ).toMatchObject({
      id: 'v1',
      ok: true,
      operation: 'validate',
      issues: [],
    });
    expect(
      handleStandardsWorkerRequest({
        id: 'oversize',
        operation: 'validate',
        document: { payload: 'x'.repeat(MAX_STANDARDS_MESSAGE_BYTES + 1) },
      }),
    ).toEqual({
      id: 'oversize',
      ok: false,
      error: `Standards artifact exceeds ${MAX_STANDARDS_MESSAGE_BYTES} bytes.`,
    });
  });
});

function readFixture<T>(name: string): T {
  const path = fileURLToPath(new URL(`fixtures/standards/s0/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
