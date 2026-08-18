import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Parser, Store } from 'n3';
import SHACLValidator from 'rdf-validate-shacl';
import { describe, expect, it } from 'vitest';
import type { CanonicalInterchangeV1 } from '../src/core/standards/interchange.ts';
import {
  MAX_SHACL_BYTES,
  SHACL_IRI,
  XSD_IRI,
  acceptShaclProposals,
  evaluateShaclRows,
  exportShaclTurtle,
  importShaclTurtle,
  projectRowsToRdfTurtle,
} from '../src/core/standards/shacl.ts';

const fixture = readFixture<CanonicalInterchangeV1>('../s0/canonical-v1.json');
const positiveRows = readFixture<Array<Record<string, unknown>>>('positive-rows.json');
const negativeRows = readFixture<Array<Record<string, unknown>>>('negative-rows.json');

describe('SHACL 2017 Core bounded constraint profile', () => {
  it('exports deterministic strict Turtle for every supported constraint kind', async () => {
    const document = expandedFixture();
    const first = await exportShaclTurtle(document);
    const second = await exportShaclTurtle(structuredClone(document));
    expect(first.profile).toBe('naklidata-shacl-2017-core-v1');
    expect(first.turtle).toBe(second.turtle);
    expect(first.tripleCount).toBe(36);

    const parsed = new Parser({ format: 'text/turtle' }).parse(first.turtle);
    expect(parsed).toHaveLength(first.tripleCount);
    for (const localName of [
      'minCount',
      'maxCount',
      'datatype',
      'minInclusive',
      'maxInclusive',
      'pattern',
      'in',
    ]) {
      expect(parsed.some((item) => item.predicate.value === `${SHACL_IRI}${localName}`)).toBe(true);
    }
  });

  it('matches an independent validator on positive and negative fixtures', async () => {
    const document = expandedFixture();
    const shapes = await exportShaclTurtle(document);
    const validator = new SHACLValidator(new Store(new Parser().parse(shapes.turtle)));

    for (const [rows, conforms, violationCount] of [
      [positiveRows, true, 0],
      [negativeRows, false, 4],
    ] as const) {
      const local = evaluateShaclRows(document, 'nd:table:invoices', rows);
      const data = await projectRowsToRdfTurtle(document, 'nd:table:invoices', rows);
      const reference = await validator.validate(new Store(new Parser().parse(data)));
      expect(local.conforms).toBe(conforms);
      expect(reference.conforms).toBe(conforms);
      expect(local.violations).toHaveLength(violationCount);
      expect(reference.results).toHaveLength(violationCount);
      expect(local.violations.every((item) => item.valueFingerprint.startsWith('fnv64-'))).toBe(
        true,
      );
    }
  });

  it('imports supported shapes as editable un-run proposals with explicit acceptance', async () => {
    const exported = await exportShaclTurtle(fixture);
    const imported = importShaclTurtle(exported.turtle, fixture);
    const before = structuredClone(imported);
    expect(imported.accepted).toBe(false);
    expect(imported.losses).toEqual([]);
    expect(imported.proposals).toHaveLength(3);
    expect(imported.proposals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'nd:assertion:vendor-id-required',
          editable: true,
          status: 'un-run',
        }),
      ]),
    );
    expect(
      imported.proposals.every((proposal) => proposal.sql.includes('-- naklidata-shacl:')),
    ).toBe(true);

    const selected = imported.proposals[0];
    if (!selected) throw new Error('fixture proposal missing');
    const accepted = acceptShaclProposals(imported, [selected.id]);
    expect(accepted.constraints).toEqual([selected.constraint]);
    expect(accepted.assertions).toEqual([
      expect.objectContaining({ id: selected.id, status: 'un-run' }),
    ]);
    expect(imported).toEqual(before);
  });

  it('reports unsupported constructs and datatypes without proposals', () => {
    const turtle = `
      @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
      @prefix sh: <${SHACL_IRI}> .
      @prefix xsd: <${XSD_IRI}> .
      @prefix data: <${fixture.namespace.baseIri}> .
      @prefix shape: <${fixture.namespace.baseIri}shape/> .
      shape:Invoices a sh:NodeShape;
        sh:targetClass <${fixture.namespace.baseIri}nd:table:invoices>;
        sh:or ( [ sh:class data:Unsupported ] );
        sh:property shape:VendorCode .
      shape:VendorCode a sh:PropertyShape;
        sh:path <${fixture.namespace.baseIri}nd:field:invoices-vendor-id>;
        sh:datatype xsd:duration .
    `;
    const imported = importShaclTurtle(turtle, fixture);
    expect(imported.proposals).toEqual([]);
    expect(imported.losses.map((item) => item.code)).toEqual(
      expect.arrayContaining(['shacl.unsupported_constraint', 'shacl.unsupported_datatype']),
    );
  });

  it('rejects unsafe patterns, malformed RDF lists, and oversized artifacts', () => {
    const prefix = `
      @prefix sh: <${SHACL_IRI}> .
      @prefix data: <${fixture.namespace.baseIri}> .
      @prefix shape: <${fixture.namespace.baseIri}shape/> .
      shape:Invoices a sh:NodeShape; sh:targetClass <${fixture.namespace.baseIri}nd:table:invoices>;
        sh:property shape:VendorCode .
      shape:VendorCode a sh:PropertyShape;
        sh:path <${fixture.namespace.baseIri}nd:field:invoices-vendor-id>;
    `;
    const unsafe = importShaclTurtle(`${prefix} sh:pattern "(a+)+$" .`, fixture);
    expect(unsafe.losses).toContainEqual(
      expect.objectContaining({ code: 'shacl.unsafe_pattern', severity: 'error' }),
    );
    const malformed = importShaclTurtle(
      `${prefix} sh:in [ <http://www.w3.org/1999/02/22-rdf-syntax-ns#first> "x" ] .`,
      fixture,
    );
    expect(malformed.losses).toContainEqual(
      expect.objectContaining({ code: 'shacl.invalid_list', severity: 'error' }),
    );
    expect(() => importShaclTurtle('x'.repeat(MAX_SHACL_BYTES + 1), fixture)).toThrow(/exceeds/);
  });
});

function expandedFixture(): CanonicalInterchangeV1 {
  const document = structuredClone(fixture);
  document.fields.push({
    id: 'nd:field:invoices-amount',
    tableId: 'nd:table:invoices',
    name: 'amount',
    dataType: 'DOUBLE',
    conceptIds: [],
  });
  document.constraints.push(
    {
      id: 'nd:assertion:vendor-id-single',
      targetId: 'nd:field:invoices-vendor-id',
      kind: 'max_count',
      value: 1,
      execution: 'explicit',
    },
    {
      id: 'nd:assertion:vendor-id-pattern',
      targetId: 'nd:field:invoices-vendor-id',
      kind: 'pattern',
      value: '^V-[0-9]+$',
      execution: 'explicit',
    },
    {
      id: 'nd:assertion:amount-minimum',
      targetId: 'nd:field:invoices-amount',
      kind: 'min_inclusive',
      value: 0,
      execution: 'explicit',
    },
    {
      id: 'nd:assertion:amount-maximum',
      targetId: 'nd:field:invoices-amount',
      kind: 'max_inclusive',
      value: 100,
      execution: 'explicit',
    },
  );
  return document;
}

function readFixture<T>(name: string): T {
  const path = fileURLToPath(new URL(`fixtures/standards/s2/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
