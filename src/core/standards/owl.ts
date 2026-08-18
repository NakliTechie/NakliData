import type { Quad, Term } from '@rdfjs/types';
import { DataFactory, Parser, Store, Writer } from 'n3';
import {
  type CanonicalId,
  type CanonicalInterchangeV1,
  type LossRecord,
  appendLoss,
  assertCanonicalInterchange,
  canonicalId,
  canonicalIri,
  resourceKindOf,
} from './interchange.ts';

const { blankNode, literal, namedNode, quad } = DataFactory;

export const OWL_IRI = 'http://www.w3.org/2002/07/owl#';
export const RDF_IRI = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
export const RDFS_IRI = 'http://www.w3.org/2000/01/rdf-schema#';
export const XSD_IRI = 'http://www.w3.org/2001/XMLSchema#';
export const MAX_OWL_BYTES = 1_000_000;
export const MAX_OWL_QUADS = 50_000;
export const MAX_OWL_RESOURCES = 10_000;
export const MAX_OWL_AXIOMS = 20_000;

const RDF_TYPE = `${RDF_IRI}type`;
const RDFS_LABEL = `${RDFS_IRI}label`;
const RDFS_SUBCLASS = `${RDFS_IRI}subClassOf`;
const RDFS_DOMAIN = `${RDFS_IRI}domain`;
const RDFS_RANGE = `${RDFS_IRI}range`;
const OWL_ONTOLOGY = `${OWL_IRI}Ontology`;
const OWL_CLASS = `${OWL_IRI}Class`;
const OWL_OBJECT_PROPERTY = `${OWL_IRI}ObjectProperty`;
const OWL_DATATYPE_PROPERTY = `${OWL_IRI}DatatypeProperty`;
const OWL_RESTRICTION = `${OWL_IRI}Restriction`;
const OWL_ON_PROPERTY = `${OWL_IRI}onProperty`;
const OWL_MAX_CARDINALITY = `${OWL_IRI}maxCardinality`;
const OWL_EQUIVALENT_CLASS = `${OWL_IRI}equivalentClass`;
const OWL_DISJOINT_WITH = `${OWL_IRI}disjointWith`;
const OWL_VERSION_INFO = `${OWL_IRI}versionInfo`;
const OWL_NOTHING = `${OWL_IRI}Nothing`;

const SUPPORTED_OWL_PREDICATES = new Set([
  OWL_ON_PROPERTY,
  OWL_MAX_CARDINALITY,
  OWL_EQUIVALENT_CLASS,
  OWL_DISJOINT_WITH,
  OWL_VERSION_INFO,
]);

export interface OwlNamedClassAxiom {
  classId: CanonicalId;
  target: CanonicalId | string;
}

export interface OwlApprovedAxioms {
  subClassOf: ReadonlyArray<OwlNamedClassAxiom>;
  equivalentClass: ReadonlyArray<OwlNamedClassAxiom>;
  disjointWith: ReadonlyArray<OwlNamedClassAxiom>;
}

export interface OwlExportOptions {
  axioms?: Partial<OwlApprovedAxioms>;
}

export interface OwlExportResult {
  format: 'text/turtle';
  profile: 'naklidata-owl-2-rl-v1';
  turtle: string;
  tripleCount: number;
  losses: LossRecord[];
  stats: {
    classes: number;
    datatypeProperties: number;
    objectProperties: number;
    restrictions: number;
  };
}

export interface OwlClassProposal {
  sourceIri: string;
  suggestedId: CanonicalId;
  label: string | null;
}

export interface OwlPropertyProposal {
  kind: 'datatype' | 'object';
  sourceIri: string;
  suggestedId: CanonicalId;
  label: string | null;
  domainIri: string;
  rangeIri: string;
}

export interface OwlNamedAxiomProposal {
  kind: 'subclass' | 'equivalent' | 'disjoint';
  classIri: string;
  targetIri: string;
}

export interface OwlRestrictionProposal {
  classIri: string;
  propertyIri: string;
  kind: 'max_cardinality';
  value: 0 | 1;
}

export interface OwlImportResult {
  format: 'naklidata-owl-import';
  version: 1;
  profile: 'naklidata-owl-2-rl-v1';
  accepted: false;
  classes: OwlClassProposal[];
  properties: OwlPropertyProposal[];
  axioms: OwlNamedAxiomProposal[];
  restrictions: OwlRestrictionProposal[];
  losses: LossRecord[];
  stats: { bytes: number; quads: number; resources: number; axioms: number };
}

export interface OwlAcceptedProposal {
  classes: OwlClassProposal[];
  properties: OwlPropertyProposal[];
  axioms: OwlNamedAxiomProposal[];
  restrictions: OwlRestrictionProposal[];
}

export async function exportOwlTurtle(
  document: CanonicalInterchangeV1,
  options: OwlExportOptions = {},
): Promise<OwlExportResult> {
  assertCanonicalInterchange(document);
  const quads: Quad[] = [];
  let losses = [...document.losses];
  const ontology = namedNode(
    `${document.namespace.baseIri}ontology/${encodeURIComponent(document.workbook.id)}`,
  );
  quads.push(quad(ontology, namedNode(RDF_TYPE), namedNode(OWL_ONTOLOGY)));
  quads.push(quad(ontology, namedNode(OWL_VERSION_INFO), literal('naklidata-owl-2-rl-v1')));
  const classIds = new Set<CanonicalId>();
  for (const table of [...document.tables].sort((left, right) => left.id.localeCompare(right.id))) {
    addClass(quads, canonicalIri(document.namespace, table.id), table.label ?? table.name);
    classIds.add(table.id);
  }
  for (const concept of [...document.concepts].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (concept.kind !== 'concept') continue;
    addClass(
      quads,
      canonicalIri(document.namespace, concept.id),
      preferredLabel(concept.preferredLabels) ?? concept.id,
    );
    classIds.add(concept.id);
    for (const mapping of concept.mappings) {
      if (mapping.kind !== 'exact') continue;
      losses = appendLoss(
        losses,
        loss(
          'information',
          'owl.skos_exact_not_equivalence',
          concept.id,
          'skos:exactMatch',
          'SKOS exact match was not promoted to OWL class equivalence.',
        ),
      );
    }
    if (concept.broaderIds.length > 0) {
      losses = appendLoss(
        losses,
        loss(
          'information',
          'owl.skos_broader_not_subclass',
          concept.id,
          'skos:broader',
          'SKOS broader links were not promoted to OWL subclass axioms.',
        ),
      );
    }
  }

  let datatypeProperties = 0;
  const fieldById = new Map(document.fields.map((field) => [field.id, field]));
  for (const field of [...document.fields].sort((left, right) => left.id.localeCompare(right.id))) {
    const iri = canonicalIri(document.namespace, field.id);
    const range = owlRlDatatype(field.dataType);
    quads.push(quad(namedNode(iri), namedNode(RDF_TYPE), namedNode(OWL_DATATYPE_PROPERTY)));
    quads.push(quad(namedNode(iri), namedNode(RDFS_LABEL), literal(field.name)));
    quads.push(
      quad(
        namedNode(iri),
        namedNode(RDFS_DOMAIN),
        namedNode(canonicalIri(document.namespace, field.tableId)),
      ),
    );
    quads.push(
      quad(namedNode(iri), namedNode(RDFS_RANGE), namedNode(range ?? `${RDFS_IRI}Literal`)),
    );
    if (!range) {
      losses = appendLoss(
        losses,
        loss(
          'warning',
          'owl.unsupported_datatype',
          field.id,
          'rdfs:range',
          `Physical type ${field.dataType} has no faithful OWL 2 RL datatype mapping.`,
        ),
      );
    }
    datatypeProperties += 1;
  }

  let objectProperties = 0;
  for (const relationship of [...document.relationships].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    const iri = canonicalIri(document.namespace, relationship.id);
    quads.push(quad(namedNode(iri), namedNode(RDF_TYPE), namedNode(OWL_OBJECT_PROPERTY)));
    quads.push(quad(namedNode(iri), namedNode(RDFS_LABEL), literal(relationship.id)));
    quads.push(
      quad(
        namedNode(iri),
        namedNode(RDFS_DOMAIN),
        namedNode(canonicalIri(document.namespace, relationship.fromTableId)),
      ),
    );
    quads.push(
      quad(
        namedNode(iri),
        namedNode(RDFS_RANGE),
        namedNode(canonicalIri(document.namespace, relationship.toTableId)),
      ),
    );
    objectProperties += 1;
  }

  let restrictions = 0;
  for (const constraint of [...document.constraints].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (constraint.kind !== 'max_count') continue;
    const field = fieldById.get(constraint.targetId);
    if (!field || (constraint.value !== 0 && constraint.value !== 1)) {
      losses = appendLoss(
        losses,
        loss(
          'warning',
          'owl.unsupported_cardinality',
          constraint.id,
          'owl:maxCardinality',
          'OWL 2 RL superclass cardinality is limited to zero or one.',
        ),
      );
      continue;
    }
    const restriction = blankNode(`restriction_${stableHash(constraint.id)}`);
    const owner = namedNode(canonicalIri(document.namespace, field.tableId));
    quads.push(quad(owner, namedNode(RDFS_SUBCLASS), restriction));
    quads.push(quad(restriction, namedNode(RDF_TYPE), namedNode(OWL_RESTRICTION)));
    quads.push(
      quad(
        restriction,
        namedNode(OWL_ON_PROPERTY),
        namedNode(canonicalIri(document.namespace, field.id)),
      ),
    );
    quads.push(
      quad(
        restriction,
        namedNode(OWL_MAX_CARDINALITY),
        literal(String(constraint.value), namedNode(`${XSD_IRI}nonNegativeInteger`)),
      ),
    );
    restrictions += 1;
  }

  const approved = {
    subClassOf: options.axioms?.subClassOf ?? [],
    equivalentClass: options.axioms?.equivalentClass ?? [],
    disjointWith: options.axioms?.disjointWith ?? [],
  };
  addApprovedAxioms(quads, document, classIds, approved.subClassOf, RDFS_SUBCLASS);
  addApprovedAxioms(quads, document, classIds, approved.equivalentClass, OWL_EQUIVALENT_CLASS);
  addApprovedAxioms(quads, document, classIds, approved.disjointWith, OWL_DISJOINT_WITH);

  const unique = dedupeQuads(quads);
  assertNamedClassAcyclic(unique);
  const writer = new Writer({
    prefixes: { owl: OWL_IRI, rdf: RDF_IRI, rdfs: RDFS_IRI, xsd: XSD_IRI },
  });
  writer.addQuads(unique);
  return {
    format: 'text/turtle',
    profile: 'naklidata-owl-2-rl-v1',
    turtle: await endWriter(writer),
    tripleCount: unique.length,
    losses,
    stats: {
      classes: classIds.size,
      datatypeProperties,
      objectProperties,
      restrictions,
    },
  };
}

export function importOwlTurtle(turtle: string, document: CanonicalInterchangeV1): OwlImportResult {
  assertCanonicalInterchange(document);
  const bytes = new TextEncoder().encode(turtle).byteLength;
  if (bytes > MAX_OWL_BYTES) throw new RangeError(`OWL artifact exceeds ${MAX_OWL_BYTES} bytes.`);
  const quads: Quad[] = new Parser({
    baseIRI: document.namespace.baseIri,
    format: 'text/turtle',
  }).parse(turtle);
  if (quads.length > MAX_OWL_QUADS)
    throw new RangeError(`OWL artifact exceeds ${MAX_OWL_QUADS} quads.`);
  const store = new Store(quads);
  const classIris = typedNamedSubjects(store, OWL_CLASS);
  const objectPropertyIris = typedNamedSubjects(store, OWL_OBJECT_PROPERTY);
  const datatypePropertyIris = typedNamedSubjects(store, OWL_DATATYPE_PROPERTY);
  const resources = classIris.length + objectPropertyIris.length + datatypePropertyIris.length;
  if (resources > MAX_OWL_RESOURCES) {
    throw new RangeError(`OWL artifact exceeds ${MAX_OWL_RESOURCES} resources.`);
  }
  rejectAmbiguousResourceTypes(classIris, objectPropertyIris, datatypePropertyIris);
  assertNamedClassAcyclic(quads);
  assertNoDisjointInstanceConflict(store, classIris);
  let losses: LossRecord[] = [];
  for (const item of quads) {
    if (
      item.predicate.value.startsWith(OWL_IRI) &&
      !SUPPORTED_OWL_PREDICATES.has(item.predicate.value)
    ) {
      losses = appendLoss(
        losses,
        loss(
          'warning',
          'owl.unsupported_term',
          item.subject.value,
          item.predicate.value,
          'OWL term is outside the supported NakliData profile.',
        ),
      );
    }
  }

  const classes = classIris.map((iri) => ({
    sourceIri: iri,
    suggestedId: idFromIri(document, iri, 'concept'),
    label: oneLiteral(store, iri, RDFS_LABEL, false),
  }));
  const properties: OwlPropertyProposal[] = [
    ...datatypePropertyIris.map((iri) => propertyProposal(store, document, iri, 'datatype')),
    ...objectPropertyIris.map((iri) => propertyProposal(store, document, iri, 'object')),
  ].sort((left, right) => left.sourceIri.localeCompare(right.sourceIri));
  const axioms: OwlNamedAxiomProposal[] = [];
  const restrictions: OwlRestrictionProposal[] = [];
  for (const classIri of classIris) {
    for (const item of store.getQuads(namedNode(classIri), namedNode(RDFS_SUBCLASS), null, null)) {
      if (item.object.termType === 'NamedNode') {
        axioms.push({ kind: 'subclass', classIri, targetIri: item.object.value });
      } else {
        restrictions.push(parseRestriction(store, classIri, item.object));
      }
    }
    for (const target of namedObjects(store, classIri, OWL_EQUIVALENT_CLASS)) {
      axioms.push({ kind: 'equivalent', classIri, targetIri: target });
    }
    for (const target of namedObjects(store, classIri, OWL_DISJOINT_WITH)) {
      axioms.push({ kind: 'disjoint', classIri, targetIri: target });
    }
  }
  if (axioms.length + restrictions.length > MAX_OWL_AXIOMS) {
    throw new RangeError(`OWL artifact exceeds ${MAX_OWL_AXIOMS} axioms.`);
  }
  return {
    format: 'naklidata-owl-import',
    version: 1,
    profile: 'naklidata-owl-2-rl-v1',
    accepted: false,
    classes,
    properties,
    axioms: sortAxioms(axioms),
    restrictions: restrictions.sort((left, right) =>
      restrictionKey(left).localeCompare(restrictionKey(right)),
    ),
    losses,
    stats: { bytes, quads: quads.length, resources, axioms: axioms.length + restrictions.length },
  };
}

export function acceptOwlProposals(imported: OwlImportResult): OwlAcceptedProposal {
  return {
    classes: structuredClone(imported.classes),
    properties: structuredClone(imported.properties),
    axioms: structuredClone(imported.axioms),
    restrictions: structuredClone(imported.restrictions),
  };
}

function addClass(quads: Quad[], iri: string, label: string): void {
  quads.push(quad(namedNode(iri), namedNode(RDF_TYPE), namedNode(OWL_CLASS)));
  quads.push(quad(namedNode(iri), namedNode(RDFS_LABEL), literal(label)));
}

function addApprovedAxioms(
  quads: Quad[],
  document: CanonicalInterchangeV1,
  classIds: ReadonlySet<CanonicalId>,
  axioms: ReadonlyArray<OwlNamedClassAxiom>,
  predicate: string,
): void {
  for (const axiom of [...axioms].sort((left, right) =>
    axiomKey(left).localeCompare(axiomKey(right)),
  )) {
    if (!classIds.has(axiom.classId)) throw new TypeError(`Unknown OWL class ${axiom.classId}.`);
    const target = classReferenceIri(document, classIds, axiom.target);
    quads.push(
      quad(
        namedNode(canonicalIri(document.namespace, axiom.classId)),
        namedNode(predicate),
        namedNode(target),
      ),
    );
  }
}

function classReferenceIri(
  document: CanonicalInterchangeV1,
  classIds: ReadonlySet<CanonicalId>,
  value: CanonicalId | string,
): string {
  if (classIds.has(value as CanonicalId))
    return canonicalIri(document.namespace, value as CanonicalId);
  if (!isAbsoluteIri(value))
    throw new TypeError(`OWL class target must be a known class or absolute IRI: ${value}`);
  return value;
}

function propertyProposal(
  store: Store,
  document: CanonicalInterchangeV1,
  iri: string,
  kind: OwlPropertyProposal['kind'],
): OwlPropertyProposal {
  const domainIri = oneNamedObject(store, iri, RDFS_DOMAIN, true);
  const rangeIri = oneNamedObject(store, iri, RDFS_RANGE, true);
  if (!domainIri || !rangeIri)
    throw new TypeError(`OWL property ${iri} is missing domain or range.`);
  return {
    kind,
    sourceIri: iri,
    suggestedId: idFromIri(document, iri, kind === 'datatype' ? 'field' : 'relationship'),
    label: oneLiteral(store, iri, RDFS_LABEL, false),
    domainIri,
    rangeIri,
  };
}

function parseRestriction(store: Store, classIri: string, term: Term): OwlRestrictionProposal {
  if (term.termType !== 'BlankNode') throw new TypeError('OWL restriction must use a blank node.');
  if (store.countQuads(term, namedNode(RDF_TYPE), namedNode(OWL_RESTRICTION), null) !== 1) {
    throw new TypeError('OWL subclass blank node is not a supported restriction.');
  }
  const properties = store.getQuads(term, namedNode(OWL_ON_PROPERTY), null, null);
  const cardinalities = store.getQuads(term, namedNode(OWL_MAX_CARDINALITY), null, null);
  if (
    properties.length !== 1 ||
    properties[0]?.object.termType !== 'NamedNode' ||
    cardinalities.length !== 1 ||
    cardinalities[0]?.object.termType !== 'Literal'
  ) {
    throw new TypeError('OWL restriction requires one named property and one max cardinality.');
  }
  const value = Number(cardinalities[0].object.value);
  if (value !== 0 && value !== 1) {
    throw new TypeError('OWL 2 RL maximum cardinality must be zero or one.');
  }
  return {
    classIri,
    propertyIri: properties[0].object.value,
    kind: 'max_cardinality',
    value,
  };
}

function assertNamedClassAcyclic(quads: ReadonlyArray<Quad>): void {
  const edges = new Map<string, string[]>();
  for (const item of quads) {
    if (
      item.predicate.value !== RDFS_SUBCLASS ||
      item.subject.termType !== 'NamedNode' ||
      item.object.termType !== 'NamedNode'
    ) {
      continue;
    }
    const next = edges.get(item.subject.value) ?? [];
    next.push(item.object.value);
    edges.set(item.subject.value, next);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (iri: string): void => {
    if (visiting.has(iri)) throw new TypeError('OWL named subclass graph contains a cycle.');
    if (visited.has(iri)) return;
    visiting.add(iri);
    for (const next of edges.get(iri) ?? []) visit(next);
    visiting.delete(iri);
    visited.add(iri);
  };
  for (const iri of edges.keys()) visit(iri);
}

function assertNoDisjointInstanceConflict(store: Store, classIris: ReadonlyArray<string>): void {
  const disjointPairs = new Set<string>();
  for (const item of store.getQuads(null, namedNode(OWL_DISJOINT_WITH), null, null)) {
    if (item.subject.termType !== 'NamedNode' || item.object.termType !== 'NamedNode') continue;
    disjointPairs.add(unorderedPair(item.subject.value, item.object.value));
  }
  const classes = new Set(classIris);
  const typesByIndividual = new Map<string, string[]>();
  for (const item of store.getQuads(null, namedNode(RDF_TYPE), null, null)) {
    if (item.subject.termType !== 'NamedNode' || item.object.termType !== 'NamedNode') continue;
    if (!classes.has(item.object.value) || classes.has(item.subject.value)) continue;
    const types = typesByIndividual.get(item.subject.value) ?? [];
    types.push(item.object.value);
    typesByIndividual.set(item.subject.value, types);
  }
  for (const [individual, types] of typesByIndividual) {
    for (let left = 0; left < types.length; left += 1) {
      for (let right = left + 1; right < types.length; right += 1) {
        const first = types[left];
        const second = types[right];
        if (first && second && disjointPairs.has(unorderedPair(first, second))) {
          throw new TypeError(`OWL individual ${individual} instantiates disjoint classes.`);
        }
      }
    }
    if (types.includes(OWL_NOTHING)) {
      throw new TypeError(`OWL individual ${individual} instantiates owl:Nothing.`);
    }
  }
}

function rejectAmbiguousResourceTypes(
  classes: ReadonlyArray<string>,
  objectProperties: ReadonlyArray<string>,
  datatypeProperties: ReadonlyArray<string>,
): void {
  const counts = new Map<string, number>();
  for (const iri of [...classes, ...objectProperties, ...datatypeProperties]) {
    counts.set(iri, (counts.get(iri) ?? 0) + 1);
  }
  const ambiguous = [...counts.entries()].find(([, count]) => count > 1);
  if (ambiguous) throw new TypeError(`OWL resource ${ambiguous[0]} has ambiguous core types.`);
}

function owlRlDatatype(dataType: string): string | null {
  const upper = dataType.toUpperCase();
  if (upper.includes('CHAR') || upper.includes('TEXT') || upper === 'STRING')
    return `${XSD_IRI}string`;
  if (upper === 'BOOLEAN' || upper === 'BOOL') return `${XSD_IRI}boolean`;
  if (upper.includes('INT')) return `${XSD_IRI}integer`;
  if (upper.includes('DECIMAL') || upper.includes('NUMERIC')) return `${XSD_IRI}decimal`;
  if (upper.includes('FLOAT') || upper.includes('REAL')) return `${XSD_IRI}float`;
  if (upper.includes('DOUBLE')) return `${XSD_IRI}double`;
  if (upper.includes('TIMESTAMP') || upper === 'DATETIME') return `${XSD_IRI}dateTime`;
  return null;
}

function preferredLabel(
  labels: ReadonlyArray<{ value: string; language: string | null }>,
): string | null {
  return (
    [...labels].sort((left, right) => {
      const language = (left.language ?? '').localeCompare(right.language ?? '');
      return language || left.value.localeCompare(right.value);
    })[0]?.value ?? null
  );
}

function idFromIri(
  document: CanonicalInterchangeV1,
  iri: string,
  fallbackKind: 'concept' | 'field' | 'relationship',
): CanonicalId {
  if (iri.startsWith(document.namespace.baseIri)) {
    const candidate = decodeURIComponent(iri.slice(document.namespace.baseIri.length));
    if (resourceKindOf(candidate) === fallbackKind || resourceKindOf(candidate) === 'table') {
      return candidate as CanonicalId;
    }
  }
  return canonicalId(fallbackKind, `owl-import-${stableHash(iri)}`);
}

function typedNamedSubjects(store: Store, typeIri: string): string[] {
  return sortedUnique(
    store
      .getQuads(null, namedNode(RDF_TYPE), namedNode(typeIri), null)
      .filter((item) => item.subject.termType === 'NamedNode')
      .map((item) => item.subject.value),
  );
}

function namedObjects(store: Store, subject: string, predicate: string): string[] {
  return sortedUnique(
    store
      .getQuads(namedNode(subject), namedNode(predicate), null, null)
      .filter((item) => item.object.termType === 'NamedNode')
      .map((item) => item.object.value),
  );
}

function oneNamedObject(
  store: Store,
  subject: string,
  predicate: string,
  required: boolean,
): string | null {
  const values = store.getQuads(namedNode(subject), namedNode(predicate), null, null);
  if (values.length === 0 && !required) return null;
  if (values.length !== 1 || values[0]?.object.termType !== 'NamedNode') {
    throw new TypeError(`${predicate} requires exactly one named IRI.`);
  }
  return values[0].object.value;
}

function oneLiteral(
  store: Store,
  subject: string,
  predicate: string,
  required: boolean,
): string | null {
  const values = store.getQuads(namedNode(subject), namedNode(predicate), null, null);
  if (values.length === 0 && !required) return null;
  if (values.length !== 1 || values[0]?.object.termType !== 'Literal') {
    throw new TypeError(`${predicate} requires exactly one literal.`);
  }
  return values[0].object.value;
}

function sortAxioms(axioms: ReadonlyArray<OwlNamedAxiomProposal>): OwlNamedAxiomProposal[] {
  return [...axioms].sort((left, right) => {
    const leftKey = `${left.kind}\u0000${left.classIri}\u0000${left.targetIri}`;
    const rightKey = `${right.kind}\u0000${right.classIri}\u0000${right.targetIri}`;
    return leftKey.localeCompare(rightKey);
  });
}

function restrictionKey(item: OwlRestrictionProposal): string {
  return `${item.classIri}\u0000${item.propertyIri}\u0000${item.kind}\u0000${item.value}`;
}

function axiomKey(item: OwlNamedClassAxiom): string {
  return `${item.classId}\u0000${item.target}`;
}

function unorderedPair(left: string, right: string): string {
  return left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`;
}

function isAbsoluteIri(value: string): boolean {
  try {
    return Boolean(new URL(value).protocol);
  } catch {
    return false;
  }
}

function dedupeQuads(quads: Quad[]): Quad[] {
  const seen = new Set<string>();
  return quads.filter((item) => {
    const suffix =
      item.object.termType === 'Literal'
        ? `\u0000${item.object.language}\u0000${item.object.datatype.value}`
        : '';
    const key = `${item.subject.value}\u0000${item.predicate.value}\u0000${item.object.termType}\u0000${item.object.value}${suffix}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortedUnique<T extends string>(values: ReadonlyArray<T>): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function endWriter(writer: Writer): Promise<string> {
  return new Promise((resolve, reject) => {
    writer.end((error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

function loss(
  severity: LossRecord['severity'],
  code: string,
  path: string,
  construct: string,
  message: string,
): LossRecord {
  return { severity, code, path, construct, message };
}
