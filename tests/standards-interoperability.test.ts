import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type CanonicalInterchangeV0,
  type CanonicalInterchangeV1,
  migrateCanonicalInterchange,
} from '../src/core/standards/interchange.ts';
import { acceptOwlProposals, exportOwlTurtle, importOwlTurtle } from '../src/core/standards/owl.ts';
import {
  acceptProvProposal,
  exportProvTurtle,
  importProvTurtle,
} from '../src/core/standards/prov.ts';
import { runBoundedReasoning } from '../src/core/standards/reasoning.ts';
import {
  acceptShaclProposals,
  exportShaclTurtle,
  importShaclTurtle,
} from '../src/core/standards/shacl.ts';
import {
  acceptSkosProposals,
  exportSkosTurtle,
  importSkosTurtle,
} from '../src/core/standards/skos.ts';

const fixture = readFixture<CanonicalInterchangeV1>('s0/canonical-v1.json');

describe('standards cross-profile interoperability gate', () => {
  it('preserves namespace and explicit edits through detached import/export proposals', async () => {
    const skosFirst = await exportSkosTurtle(fixture, { basePrefix: 'business' });
    const skosImported = importSkosTurtle(skosFirst.turtle, fixture.namespace.baseIri);
    const skosAccepted = acceptSkosProposals(
      skosImported,
      skosImported.concepts.map((item) => item.sourceIri),
    );
    const editedConcept = skosAccepted.concepts[0];
    if (!editedConcept) throw new Error('SKOS accepted concept missing');
    editedConcept.alternateLabels.push({ value: 'Trading partner', language: 'en' });
    const skosDocument = structuredClone(fixture);
    skosDocument.concepts = [...skosAccepted.schemes, ...skosAccepted.concepts];
    const skosSecond = await exportSkosTurtle(skosDocument, { basePrefix: 'business' });
    const skosRoundTrip = importSkosTurtle(skosSecond.turtle, fixture.namespace.baseIri);
    expect(skosSecond.turtle).toContain(`@prefix business: <${fixture.namespace.baseIri}>`);
    expect(skosRoundTrip.concepts[0]?.alternateLabels).toContainEqual({
      value: 'Trading partner',
      language: 'en',
    });

    const shaclFirst = await exportShaclTurtle(fixture);
    const shaclImported = importShaclTurtle(shaclFirst.turtle, fixture);
    const shaclAccepted = acceptShaclProposals(
      shaclImported,
      shaclImported.proposals.map((item) => item.id),
    );
    const minimum = shaclAccepted.constraints.find((item) => item.kind === 'min_count');
    if (!minimum) throw new Error('SHACL minimum-count proposal missing');
    minimum.value = 2;
    const shaclDocument = structuredClone(fixture);
    shaclDocument.constraints = shaclAccepted.constraints;
    const shaclSecond = await exportShaclTurtle(shaclDocument);
    expect(importShaclTurtle(shaclSecond.turtle, fixture).proposals).toContainEqual(
      expect.objectContaining({
        constraint: expect.objectContaining({ kind: 'min_count', value: 2 }),
      }),
    );

    const provFirst = await exportProvTurtle(fixture, identities());
    const provImported = importProvTurtle(provFirst.turtle, fixture);
    const provAccepted = acceptProvProposal(provImported);
    const software = provAccepted.agents[0];
    if (!software) throw new Error('PROV agent proposal missing');
    software.label = 'NakliData interoperability gate';
    const provDocument = structuredClone(fixture);
    provDocument.provenance = provAccepted;
    const provSecond = await exportProvTurtle(provDocument, identities());
    expect(importProvTurtle(provSecond.turtle, fixture).provenance.agents[0]?.label).toBe(
      'NakliData interoperability gate',
    );

    const owlDocument = structuredClone(fixture);
    const table = owlDocument.tables[0];
    if (!table) throw new Error('OWL table fixture missing');
    table.label = 'Edited invoices class';
    const owlFirst = await exportOwlTurtle(owlDocument, {
      axioms: {
        subClassOf: [{ classId: table.id, target: 'https://example.test/ontology/BillingRecord' }],
      },
    });
    const owlImported = importOwlTurtle(owlFirst.turtle, fixture);
    const owlAccepted = acceptOwlProposals(owlImported);
    expect(owlAccepted.classes).toContainEqual(
      expect.objectContaining({ suggestedId: table.id, label: 'Edited invoices class' }),
    );
    expect(owlAccepted.axioms).toContainEqual(
      expect.objectContaining({
        kind: 'subclass',
        targetIri: 'https://example.test/ontology/BillingRecord',
      }),
    );
  });

  it('reports excluded terms and contains malformed input at every RDF boundary', () => {
    const base = fixture.namespace.baseIri;
    const skos = importSkosTurtle(
      `@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
       <${base}scheme> a skos:ConceptScheme; skos:prefLabel "Scheme" .
       <${base}concept> a skos:Concept; skos:inScheme <${base}scheme>;
         skos:prefLabel "Concept"; skos:notation "X" .`,
      base,
    );
    expect(skos.losses).toContainEqual(expect.objectContaining({ code: 'skos.unsupported_term' }));

    const shacl = importShaclTurtle(
      `@prefix sh: <http://www.w3.org/ns/shacl#> .
       <${base}shape> a sh:NodeShape; sh:targetClass <${base}nd:table:invoices>;
         sh:closed true .`,
      fixture,
    );
    expect(shacl.losses).toContainEqual(
      expect.objectContaining({ code: 'shacl.unsupported_constraint' }),
    );

    const prov = importProvTurtle(
      `@prefix prov: <http://www.w3.org/ns/prov#> .
       <${base}nd:entity:external> a prov:Entity; prov:specializationOf <${base}other> .`,
      fixture,
    );
    expect(prov.losses).toContainEqual(expect.objectContaining({ code: 'prov.unsupported_term' }));

    const owl = importOwlTurtle(
      `@prefix owl: <http://www.w3.org/2002/07/owl#> .
       <${base}External> a owl:Class; owl:unionOf () .`,
      fixture,
    );
    expect(owl.losses).toContainEqual(expect.objectContaining({ code: 'owl.unsupported_term' }));

    expect(() => importSkosTurtle('@prefix', base)).toThrow();
    expect(() => importShaclTurtle('@prefix', fixture)).toThrow();
    expect(() => importProvTurtle('@prefix', fixture)).toThrow();
    expect(() => importOwlTurtle('@prefix', fixture)).toThrow();
  });

  it('migrates the only legacy contract and cancels reasoning without applying output', async () => {
    const { namespace, losses: _losses, ...rest } = structuredClone(fixture);
    const legacy: CanonicalInterchangeV0 = {
      ...rest,
      version: 0,
      baseIri: namespace.baseIri,
      prefixes: namespace.prefixes,
    };
    const migrated = migrateCanonicalInterchange(legacy);
    expect(migrated.document.namespace).toEqual(namespace);
    expect(migrated.losses).toContainEqual(
      expect.objectContaining({ code: 'migration.v0.namespace_wrapped' }),
    );

    const controller = new AbortController();
    controller.abort();
    await expect(
      runBoundedReasoning(
        {
          workspaceId: 's6-workspace',
          workspaceRevision: 1,
          expectedWorkspaceId: 's6-workspace',
          expectedWorkspaceRevision: 1,
          facts: [{ id: 'a-b', kind: 'owl_subclass', subject: 'owl:A', object: 'owl:B' }],
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

function identities() {
  return { buildIdentity: 's6-test-build', taxonomyIdentity: 'taxonomy-test' };
}

function readFixture<T>(name: string): T {
  const path = fileURLToPath(new URL(`fixtures/standards/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
