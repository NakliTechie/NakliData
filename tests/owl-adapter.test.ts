import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Parser } from 'n3';
import { describe, expect, it } from 'vitest';
import type { CanonicalInterchangeV1 } from '../src/core/standards/interchange.ts';
import {
  MAX_OWL_BYTES,
  OWL_IRI,
  RDFS_IRI,
  acceptOwlProposals,
  exportOwlTurtle,
  importOwlTurtle,
} from '../src/core/standards/owl.ts';

const fixture = readFixture<CanonicalInterchangeV1>('canonical-v1.json');

describe('OWL 2 RL bounded ontology profile', () => {
  it('exports deterministic classes, properties, domains, ranges, and approved axioms', async () => {
    const document = restrictedFixture();
    const options = {
      axioms: {
        subClassOf: [
          {
            classId: 'nd:table:invoices' as const,
            target: 'https://example.test/ontology/BillingRecord',
          },
        ],
        equivalentClass: [
          {
            classId: 'nd:concept:vendor' as const,
            target: 'https://example.test/ontology/Supplier',
          },
        ],
        disjointWith: [
          { classId: 'nd:table:invoices' as const, target: 'nd:table:vendors' as const },
        ],
      },
    };
    const first = await exportOwlTurtle(document, options);
    const second = await exportOwlTurtle(structuredClone(document), options);
    expect(first.profile).toBe('naklidata-owl-2-rl-v1');
    expect(first.turtle).toBe(second.turtle);
    expect(first.stats).toEqual({
      classes: 3,
      datatypeProperties: 3,
      objectProperties: 1,
      restrictions: 1,
    });
    expect(first.losses).toContainEqual(
      expect.objectContaining({ code: 'owl.skos_exact_not_equivalence' }),
    );
    expect(first.turtle).not.toContain('https://example.test/vocabulary/VendorClass');

    const independent = new Parser({ format: 'text/turtle' }).parse(first.turtle);
    expect(independent).toHaveLength(first.tripleCount);
    for (const predicate of [
      `${RDFS_IRI}subClassOf`,
      `${RDFS_IRI}domain`,
      `${RDFS_IRI}range`,
      `${OWL_IRI}equivalentClass`,
      `${OWL_IRI}disjointWith`,
      `${OWL_IRI}maxCardinality`,
    ]) {
      expect(independent.some((item) => item.predicate.value === predicate)).toBe(true);
    }
  });

  it('round-trips the supported profile as review-only proposals', async () => {
    const document = restrictedFixture();
    const exported = await exportOwlTurtle(document, {
      axioms: {
        subClassOf: [
          {
            classId: 'nd:table:invoices',
            target: 'https://example.test/ontology/BillingRecord',
          },
        ],
        equivalentClass: [
          {
            classId: 'nd:concept:vendor',
            target: 'https://example.test/ontology/Supplier',
          },
        ],
        disjointWith: [{ classId: 'nd:table:invoices', target: 'nd:table:vendors' }],
      },
    });
    const imported = importOwlTurtle(exported.turtle, fixture);
    expect(imported.accepted).toBe(false);
    expect(imported.classes.map((item) => item.suggestedId)).toEqual([
      'nd:concept:vendor',
      'nd:table:invoices',
      'nd:table:vendors',
    ]);
    expect(imported.properties).toHaveLength(4);
    expect(imported.axioms.map((item) => item.kind).sort()).toEqual([
      'disjoint',
      'equivalent',
      'subclass',
    ]);
    expect(imported.restrictions).toEqual([
      expect.objectContaining({ kind: 'max_cardinality', value: 1 }),
    ]);
    const before = structuredClone(imported);
    expect(acceptOwlProposals(imported)).toMatchObject({
      classes: imported.classes,
      properties: imported.properties,
      axioms: imported.axioms,
      restrictions: imported.restrictions,
    });
    expect(imported).toEqual(before);
  });

  it('uses rdfs:Literal and a loss record when a physical type is outside OWL 2 RL', async () => {
    const document = structuredClone(fixture);
    const field = document.fields[0];
    if (!field) throw new Error('field fixture missing');
    field.dataType = 'DATE';
    const exported = await exportOwlTurtle(document);
    expect(exported.turtle).toContain('rdfs:Literal');
    expect(exported.losses).toContainEqual(
      expect.objectContaining({ code: 'owl.unsupported_datatype', path: field.id }),
    );
    expect(() => importOwlTurtle(exported.turtle, fixture)).not.toThrow();
  });

  it('loss-reports unsupported OWL constructs', () => {
    const turtle = readOwlFixture('unsupported.ttl');
    const imported = importOwlTurtle(turtle, fixture);
    expect(imported.losses).toContainEqual(
      expect.objectContaining({ code: 'owl.unsupported_term', construct: `${OWL_IRI}unionOf` }),
    );
  });

  it('rejects cyclic, inconsistent, malformed-restriction, and ambiguous fixtures', () => {
    const cyclic = readOwlFixture('cyclic.ttl');
    expect(() => importOwlTurtle(cyclic, fixture)).toThrow(/cycle/);

    const inconsistent = readOwlFixture('inconsistent.ttl');
    expect(() => importOwlTurtle(inconsistent, fixture)).toThrow(/disjoint classes/);

    const malformedRestriction = `
      @prefix owl: <${OWL_IRI}> . @prefix rdfs: <${RDFS_IRI}> .
      <https://external.test/A> a owl:Class; rdfs:subClassOf [
        a owl:Restriction; owl:onProperty <https://external.test/p>; owl:maxCardinality 2
      ] .
    `;
    expect(() => importOwlTurtle(malformedRestriction, fixture)).toThrow(/zero or one/);

    const ambiguous = `
      @prefix owl: <${OWL_IRI}> .
      <https://external.test/mixed> a owl:Class, owl:ObjectProperty .
    `;
    expect(() => importOwlTurtle(ambiguous, fixture)).toThrow(/ambiguous core types/);
  });

  it('enforces artifact ceilings and explicit axiom ownership', async () => {
    expect(() => importOwlTurtle('x'.repeat(MAX_OWL_BYTES + 1), fixture)).toThrow(/exceeds/);
    await expect(
      exportOwlTurtle(fixture, {
        axioms: {
          subClassOf: [
            {
              classId: 'nd:concept:missing',
              target: 'https://external.test/Class',
            },
          ],
        },
      }),
    ).rejects.toThrow(/Unknown OWL class/);
  });

  it('accepts the exact satisfiable fixture used by the independent OWL-RL gate', () => {
    const imported = importOwlTurtle(readOwlFixture('satisfiable.ttl'), fixture);
    expect(imported.classes).toHaveLength(3);
    expect(imported.properties).toHaveLength(1);
    expect(imported.axioms).toHaveLength(2);
  });
});

function restrictedFixture(): CanonicalInterchangeV1 {
  const document = structuredClone(fixture);
  const vendor = document.concepts.find((item) => item.id === 'nd:concept:vendor');
  if (!vendor) throw new Error('vendor concept fixture missing');
  vendor.mappings.push({
    kind: 'exact',
    targetIri: 'https://example.test/vocabulary/VendorClass',
  });
  document.constraints.push({
    id: 'nd:assertion:vendor-id-single',
    targetId: 'nd:field:invoices-vendor-id',
    kind: 'max_count',
    value: 1,
    execution: 'explicit',
  });
  return document;
}

function readFixture<T>(name: string): T {
  const path = fileURLToPath(new URL(`fixtures/standards/s0/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function readOwlFixture(name: string): string {
  const path = fileURLToPath(new URL(`fixtures/standards/s4/${name}`, import.meta.url));
  return readFileSync(path, 'utf8');
}
