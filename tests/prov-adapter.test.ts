import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Parser } from 'n3';
import { describe, expect, it } from 'vitest';
import type { CanonicalInterchangeV1 } from '../src/core/standards/interchange.ts';
import {
  MAX_PROV_BYTES,
  PROV_IRI,
  acceptProvProposal,
  assertProvGraphIntegrity,
  exportProvTurtle,
  importProvTurtle,
  projectLineageToProvenance,
  provenanceRelationKey,
} from '../src/core/standards/prov.ts';

const fixture = readFixture<CanonicalInterchangeV1>('canonical-v1.json');

describe('PROV-O 2013 bounded provenance profile', () => {
  it('exports deterministic strict Turtle with observed and annotated relations separated', async () => {
    const document = expandedFixture();
    const annotated = document.provenance.relations.find((item) => !item.observed);
    if (!annotated) throw new Error('annotated relation fixture missing');
    const options = {
      buildIdentity: 'naklidata@00c6485',
      taxonomyIdentity: 'taxonomy@0.1',
      sourceReferences: {
        'nd:entity:invoice-source': 'mount:finance-source/invoices',
        'nd:entity:vendor-summary': 'protected:must-not-serialize',
      },
      relationConfidence: { [provenanceRelationKey(annotated)]: 'low' as const },
    };
    const first = await exportProvTurtle(document, options);
    const second = await exportProvTurtle(structuredClone(document), options);
    expect(first.profile).toBe('naklidata-prov-o-2013-v1');
    expect(first.turtle).toBe(second.turtle);
    expect(first.observedRelations).toBe(4);
    expect(first.annotatedRelations).toBe(1);
    expect(first.turtle).toContain('mount:finance-source/invoices');
    expect(first.turtle).not.toContain('protected:must-not-serialize');
    expect(first.losses).toContainEqual(
      expect.objectContaining({ code: 'prov.redacted_source_reference' }),
    );

    const independent = new Parser({ format: 'text/turtle' }).parse(first.turtle);
    expect(independent).toHaveLength(first.tripleCount);
    expect(independent.some((item) => item.predicate.value === `${PROV_IRI}used`)).toBe(true);
  });

  it('round-trips entities, activities, agents, relations, identity, confidence, and redaction', async () => {
    const document = expandedFixture();
    const annotated = document.provenance.relations.find((item) => !item.observed);
    if (!annotated) throw new Error('annotated relation fixture missing');
    const exported = await exportProvTurtle(document, {
      buildIdentity: 'naklidata@00c6485',
      taxonomyIdentity: 'taxonomy@0.1',
      sourceReferences: { 'nd:entity:invoice-source': 'mount:finance-source/invoices' },
      relationConfidence: { [provenanceRelationKey(annotated)]: 'low' },
    });
    const imported = importProvTurtle(exported.turtle, fixture);
    expect(imported.accepted).toBe(false);
    expect(imported.buildIdentity).toBe('naklidata@00c6485');
    expect(imported.taxonomyIdentity).toBe('taxonomy@0.1');
    expect(imported.sourceReferences).toEqual({
      'nd:entity:invoice-source': 'mount:finance-source/invoices',
    });
    expect(imported.provenance.entities).toEqual(
      [...document.provenance.entities].sort((left, right) => left.id.localeCompare(right.id)),
    );
    expect(imported.provenance.activities).toEqual(
      [...document.provenance.activities].sort((left, right) => left.id.localeCompare(right.id)),
    );
    expect(imported.provenance.agents).toEqual(
      [...document.provenance.agents].sort((left, right) => left.id.localeCompare(right.id)),
    );
    expect(relationKeys(imported.provenance.relations)).toEqual(
      relationKeys(document.provenance.relations),
    );
    expect(imported.relationEvidence).toContainEqual({
      key: provenanceRelationKey(annotated),
      observed: false,
      confidence: 'low',
    });
    const before = structuredClone(imported);
    expect(acceptProvProposal(imported)).toEqual(imported.provenance);
    expect(imported).toEqual(before);
  });

  it('treats external relations without NakliData evidence as annotations', () => {
    const turtle = `
      @prefix prov: <${PROV_IRI}> .
      <https://external.test/activity> a prov:Activity; prov:used <https://external.test/entity> .
      <https://external.test/entity> a prov:Entity .
    `;
    const imported = importProvTurtle(turtle, fixture);
    expect(imported.provenance.relations).toEqual([
      expect.objectContaining({ kind: 'used', observed: false }),
    ]);
    expect(imported.relationEvidence).toEqual([
      expect.objectContaining({ observed: false, confidence: 'low' }),
    ]);
  });

  it('projects sources, cells, results, exports, confidence, and visual annotations', () => {
    const projected = projectLineageToProvenance(
      {
        version: 1,
        nodes: [
          { id: 'source:invoices', kind: 'source', label: 'Invoices', ref: 'mount:invoices' },
          { id: 'cell:query', kind: 'cell', label: 'Vendor summary' },
          {
            id: 'cell:visual',
            kind: 'cell',
            label: 'Visual annotation',
            cellKind: 'chart',
          },
          { id: 'sink:export', kind: 'sink', label: 'HTML export' },
        ],
        edges: [
          { from: 'source:invoices', to: 'cell:query', confidence: 'high' },
          { from: 'cell:query', to: 'cell:visual', confidence: 'low' },
          { from: 'cell:visual', to: 'sink:export', confidence: 'high' },
        ],
      },
      {
        softwareAgentLabel: 'NakliData test build',
        resourceIdsByNode: { 'source:invoices': 'nd:source:finance-source' },
        activityTimes: {
          'cell:query': {
            startedAt: '2026-08-18T00:00:00Z',
            endedAt: '2026-08-18T00:00:01Z',
          },
        },
      },
    );
    expect(projected.provenance.entities.map((item) => item.kind).sort()).toEqual([
      'export',
      'result',
      'result',
      'source',
    ]);
    expect(projected.provenance.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'query', startedAt: '2026-08-18T00:00:00Z' }),
        expect.objectContaining({ kind: 'annotation', startedAt: null }),
      ]),
    );
    expect(projected.provenance.agents).toEqual([
      expect.objectContaining({ kind: 'software', label: 'NakliData test build' }),
    ]);
    expect(Object.keys(projected.sourceReferences)).toEqual([
      expect.stringContaining('nd:entity:'),
    ]);
    expect(Object.values(projected.sourceReferences)).toEqual(['mount:invoices']);
    expect(projected.provenance.relations.some((item) => !item.observed)).toBe(true);
    expect(Object.values(projected.relationConfidence)).toContain('low');

    expect(() =>
      projectLineageToProvenance(
        {
          version: 1,
          nodes: [
            { id: 'a', kind: 'cell', label: 'A' },
            { id: 'b', kind: 'cell', label: 'B' },
          ],
          edges: [
            { from: 'a', to: 'b', confidence: 'high' },
            { from: 'b', to: 'a', confidence: 'high' },
          ],
        },
        { softwareAgentLabel: 'NakliData test build' },
      ),
    ).toThrow(/cycle/);
  });

  it('loss-reports excluded PROV-O terms', () => {
    const turtle = `
      @prefix prov: <${PROV_IRI}> .
      <https://external.test/a> a prov:Agent; prov:actedOnBehalfOf <https://external.test/b> .
      <https://external.test/b> a prov:Agent .
    `;
    const imported = importProvTurtle(turtle, fixture);
    expect(imported.losses).toContainEqual(
      expect.objectContaining({
        code: 'prov.unsupported_term',
        construct: `${PROV_IRI}actedOnBehalfOf`,
      }),
    );
  });

  it('rejects dangling, cyclic, and ownership-ambiguous provenance', () => {
    const dangling = `
      @prefix prov: <${PROV_IRI}> .
      <https://external.test/activity> a prov:Activity; prov:used <https://external.test/missing> .
    `;
    expect(() => importProvTurtle(dangling, fixture)).toThrow(/dangling/);

    const cyclic = structuredClone(fixture.provenance);
    cyclic.relations.push({
      kind: 'was_derived_from',
      fromId: 'nd:entity:invoice-source',
      toId: 'nd:entity:vendor-summary',
      observed: true,
    });
    expect(() => assertProvGraphIntegrity(cyclic)).toThrow(/cycle/);

    const ambiguous = structuredClone(fixture.provenance);
    ambiguous.activities.push({
      id: 'nd:activity:alternate-query',
      kind: 'query',
      startedAt: null,
      endedAt: null,
    });
    ambiguous.relations.push({
      kind: 'was_generated_by',
      fromId: 'nd:entity:vendor-summary',
      toId: 'nd:activity:alternate-query',
      observed: false,
    });
    expect(() => assertProvGraphIntegrity(ambiguous)).toThrow(/ambiguous/);

    const ambiguousType = `
      @prefix prov: <${PROV_IRI}> .
      <https://external.test/mixed> a prov:Entity, prov:Activity .
    `;
    expect(() => importProvTurtle(ambiguousType, fixture)).toThrow(/ambiguous core types/);
  });

  it('enforces artifact and source-reference ceilings', async () => {
    expect(() => importProvTurtle('x'.repeat(MAX_PROV_BYTES + 1), fixture)).toThrow(/exceeds/);
    await expect(
      exportProvTurtle(fixture, {
        buildIdentity: 'build',
        taxonomyIdentity: 'taxonomy',
        sourceReferences: { 'nd:entity:invoice-source': 'line\nbreak' },
      }),
    ).rejects.toThrow(/printable/);
  });
});

function expandedFixture(): CanonicalInterchangeV1 {
  const document = structuredClone(fixture);
  document.provenance.entities.push({
    id: 'nd:entity:annotated-export',
    kind: 'export',
    label: 'Annotated export',
    resourceId: null,
    redacted: false,
  });
  document.provenance.relations.push({
    kind: 'was_derived_from',
    fromId: 'nd:entity:annotated-export',
    toId: 'nd:entity:vendor-summary',
    observed: false,
  });
  return document;
}

function relationKeys(relations: CanonicalInterchangeV1['provenance']['relations']): string[] {
  return relations
    .map((item) => `${provenanceRelationKey(item)}\u0000${item.observed}`)
    .sort((left, right) => left.localeCompare(right));
}

function readFixture<T>(name: string): T {
  const path = fileURLToPath(new URL(`fixtures/standards/s0/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
