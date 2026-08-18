import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Parser } from 'n3';
import { describe, expect, it } from 'vitest';
import type { CanonicalInterchangeV1 } from '../src/core/standards/interchange.ts';
import {
  MAX_SKOS_BYTES,
  RDF_IRI,
  SKOS_IRI,
  acceptSkosProposals,
  browseSkosVocabulary,
  buildTaxonomySkosConcepts,
  exportSkosTurtle,
  importSkosTurtle,
} from '../src/core/standards/skos.ts';

const fixture = readFixture<CanonicalInterchangeV1>('canonical-v1.json');

describe('SKOS 2009 bounded vocabulary profile', () => {
  it('exports deterministic Turtle that an independent strict RDF parser accepts', async () => {
    const first = await exportSkosTurtle(fixture, { basePrefix: 'finance' });
    const second = await exportSkosTurtle(structuredClone(fixture), { basePrefix: 'finance' });
    expect(first.turtle).toBe(second.turtle);
    expect(first.losses).toEqual(fixture.losses);
    expect(first.tripleCount).toBe(10);

    const independentlyParsed = new Parser({ format: 'text/turtle' }).parse(first.turtle);
    expect(independentlyParsed).toHaveLength(first.tripleCount);
    expect(
      independentlyParsed.some((item) => item.predicate.value === `${SKOS_IRI}prefLabel`),
    ).toBe(true);
    expect(independentlyParsed.some((item) => item.predicate.value === `${SKOS_IRI}broader`)).toBe(
      false,
    );
  });

  it('round-trips identifiers, labels, hierarchy, and mappings', async () => {
    const hierarchical = structuredClone(fixture);
    const child = hierarchical.concepts[1];
    if (!child) throw new Error('fixture concept missing');
    hierarchical.concepts.push({
      ...structuredClone(child),
      id: 'nd:concept:preferred-vendor',
      preferredLabels: [{ value: 'Preferred vendor', language: 'en' }],
      alternateLabels: [],
      broaderIds: [child.id],
      relatedIds: [child.id],
      mappings: [{ kind: 'exact', targetIri: 'https://example.test/vocabulary/PreferredSupplier' }],
    });
    const exported = await exportSkosTurtle(hierarchical);
    const imported = importSkosTurtle(exported.turtle, fixture.namespace.baseIri);
    expect(imported.losses).toEqual([]);
    expect(imported.concepts.map((concept) => concept.suggestedId)).toEqual([
      'nd:concept:preferred-vendor',
      'nd:concept:vendor',
    ]);
    const roundTrip = imported.concepts.find(
      (concept) => concept.suggestedId === 'nd:concept:preferred-vendor',
    );
    expect(roundTrip).toMatchObject({
      preferredLabels: [{ value: 'Preferred vendor', language: 'en' }],
      alternateLabels: [],
      broaderIris: [`${fixture.namespace.baseIri}nd:concept:vendor`],
      relatedIris: [`${fixture.namespace.baseIri}nd:concept:vendor`],
      mappings: [{ kind: 'exact', targetIri: 'https://example.test/vocabulary/PreferredSupplier' }],
    });
  });

  it('imports inverse narrower links and reports excluded constructs and label conflicts', () => {
    const turtle = `
      @prefix skos: <${SKOS_IRI}> .
      @prefix ex: <https://example.test/vocab/> .
      @prefix dct: <http://purl.org/dc/terms/> .
      ex:scheme a skos:ConceptScheme; skos:prefLabel "Scheme"@en .
      ex:parent a skos:Concept; skos:inScheme ex:scheme; skos:prefLabel "Parent"@en;
        skos:narrower ex:child; dct:creator "Owner" .
      ex:child a skos:Concept; skos:inScheme ex:scheme;
        skos:prefLabel "Child B"@en; skos:prefLabel "Child A"@en .
    `;
    const imported = importSkosTurtle(turtle, 'https://example.test/vocab/');
    const child = imported.concepts.find((concept) => concept.sourceIri.endsWith('/child'));
    expect(child?.broaderIris).toEqual(['https://example.test/vocab/parent']);
    expect(child?.preferredLabels).toEqual([{ value: 'Child A', language: 'en' }]);
    expect(imported.losses.map((item) => item.code)).toEqual(
      expect.arrayContaining(['skos.duplicate_preferred_language', 'skos.unsupported_term']),
    );
  });

  it('keeps browsing bounded and acceptance explicit and non-mutating', async () => {
    const exported = await exportSkosTurtle(fixture);
    const imported = importSkosTurtle(exported.turtle, fixture.namespace.baseIri);
    const before = structuredClone(imported);
    expect(browseSkosVocabulary(imported, 'supplier', 10)).toEqual([
      expect.objectContaining({
        kind: 'concept',
        label: 'Vendor',
        aliases: ['Supplier', 'Proveedor'],
      }),
    ]);
    const accepted = acceptSkosProposals(imported, [
      `${fixture.namespace.baseIri}nd:concept:vendor`,
    ]);
    expect(accepted.schemes).toHaveLength(1);
    expect(accepted.concepts).toEqual([
      expect.objectContaining({ id: 'nd:concept:vendor', schemeId: 'nd:concept:finance' }),
    ]);
    expect(imported).toEqual(before);
    expect(() => browseSkosVocabulary(imported, '', 201)).toThrow(/1\.\.200/);
  });

  it('fails closed on oversized, malformed, and scheme-less artifacts', () => {
    expect(() => importSkosTurtle('x'.repeat(MAX_SKOS_BYTES + 1), 'https://example.test/')).toThrow(
      /exceeds/,
    );
    expect(() => importSkosTurtle('@prefix bad', 'https://example.test/')).toThrow();
    const schemeLess = importSkosTurtle(
      `@prefix skos: <${SKOS_IRI}> . <https://example.test/orphan> a skos:Concept; skos:prefLabel "Orphan" .`,
      'https://example.test/',
    );
    expect(schemeLess.losses).toContainEqual(
      expect.objectContaining({ code: 'skos.missing_scheme', severity: 'error' }),
    );
  });

  it('honors selected prefixes while preserving reserved RDF and SKOS bindings', async () => {
    const exported = await exportSkosTurtle(fixture, {
      basePrefix: 'business',
      prefixes: { ext2: 'https://example.test/external/', skos: 'https://invalid.test/' },
    });
    expect(exported.turtle).toContain('@prefix business:');
    expect(exported.turtle).toContain(`@prefix skos: <${SKOS_IRI}>`);
    expect(exported.turtle).toContain(`@prefix rdf: <${RDF_IRI}>`);
    expect(exported.turtle).toContain('@prefix ext2: <https://example.test/external/>');
    await expect(exportSkosTurtle(fixture, { basePrefix: 'skos' })).rejects.toThrow(/reserved/);
  });

  it('projects bundled and workbook-local types into explicit schemes', () => {
    const projected = buildTaxonomySkosConcepts(
      {
        version: 'test-1',
        released: '2026-08-18',
        domains: [],
        types: [
          {
            id: 'vendor_name',
            display_name: 'Vendor name',
            domain: 'finance',
            sql_compat: ['VARCHAR'],
            detectors: [],
            confidence_floor: 0.5,
          },
        ],
        universal: {
          terms: [
            {
              id: 'ut:organization_name',
              prefLabel: 'Organization name',
              roleFamily: 'dimension',
              sensitivity: 'public',
              exactMatch: ['schema:Organization'],
            },
          ],
          crosswalk: [{ role: 'vendor_name', universalTerm: 'ut:organization_name' }],
        },
      },
      [
        {
          id: 'counterparty_tier',
          display_name: 'Counterparty tier',
          category: 'finance',
          regex: '^(gold|silver)$',
          sensitivity: 'financial',
          created: '2026-08-18T00:00:00Z',
        },
      ],
      { mappingPrefixes: { schema: 'https://schema.org/' } },
    );
    expect(projected.losses).toEqual([]);
    expect(projected.concepts.filter((concept) => concept.kind === 'scheme')).toHaveLength(2);
    expect(
      projected.concepts.find((concept) => concept.id.includes('type%3Avendor_name')),
    ).toMatchObject({
      preferredLabels: [{ value: 'Vendor name', language: 'en' }],
      broaderIds: [expect.stringContaining('universal%3Aut%3Aorganization_name')],
    });
    expect(
      projected.concepts.find((concept) => concept.id.includes('universal'))?.mappings,
    ).toEqual([{ kind: 'exact', targetIri: 'https://schema.org/Organization' }]);
    expect(
      projected.concepts.find((concept) => concept.id.includes('user%3Acounterparty_tier')),
    ).toMatchObject({
      preferredLabels: [{ value: 'Counterparty tier', language: 'en' }],
    });
  });
});

function readFixture<T>(name: string): T {
  const path = fileURLToPath(new URL(`fixtures/standards/s0/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
