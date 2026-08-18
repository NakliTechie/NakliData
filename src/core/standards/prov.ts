import type { Quad, Term } from '@rdfjs/types';
import { DataFactory, Parser, Store, Writer } from 'n3';
import type { LineageGraph } from '../lineage-store.ts';
import {
  type CanonicalId,
  type CanonicalInterchangeV1,
  type LossRecord,
  NAKLIDATA_VOCABULARY_IRI,
  type ProvenanceActivityContract,
  type ProvenanceAgentContract,
  type ProvenanceContract,
  type ProvenanceEntityContract,
  type ProvenanceRelationContract,
  appendLoss,
  assertCanonicalInterchange,
  canonicalId,
  canonicalIri,
  resourceKindOf,
} from './interchange.ts';

const { literal, namedNode, quad } = DataFactory;

export const PROV_IRI = 'http://www.w3.org/ns/prov#';
export const RDF_IRI = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
export const RDFS_IRI = 'http://www.w3.org/2000/01/rdf-schema#';
export const XSD_IRI = 'http://www.w3.org/2001/XMLSchema#';
export const MAX_PROV_BYTES = 1_000_000;
export const MAX_PROV_QUADS = 50_000;
export const MAX_PROV_RECORDS = 10_000;
export const MAX_PROV_REFERENCE_LENGTH = 2_048;

const RDF_TYPE = `${RDF_IRI}type`;
const RDF_STATEMENT = `${RDF_IRI}Statement`;
const RDF_SUBJECT = `${RDF_IRI}subject`;
const RDF_PREDICATE = `${RDF_IRI}predicate`;
const RDF_OBJECT = `${RDF_IRI}object`;
const RDFS_LABEL = `${RDFS_IRI}label`;
const PROV_ENTITY = `${PROV_IRI}Entity`;
const PROV_ACTIVITY = `${PROV_IRI}Activity`;
const PROV_AGENT = `${PROV_IRI}Agent`;
const PROV_STARTED_AT = `${PROV_IRI}startedAtTime`;
const PROV_ENDED_AT = `${PROV_IRI}endedAtTime`;
const ND_KIND = `${NAKLIDATA_VOCABULARY_IRI}kind`;
const ND_RESOURCE = `${NAKLIDATA_VOCABULARY_IRI}resource`;
const ND_REDACTED = `${NAKLIDATA_VOCABULARY_IRI}redacted`;
const ND_OBSERVED = `${NAKLIDATA_VOCABULARY_IRI}observed`;
const ND_CONFIDENCE = `${NAKLIDATA_VOCABULARY_IRI}confidence`;
const ND_SOURCE_REFERENCE = `${NAKLIDATA_VOCABULARY_IRI}sourceReference`;
const ND_BUILD_IDENTITY = `${NAKLIDATA_VOCABULARY_IRI}buildIdentity`;
const ND_TAXONOMY_IDENTITY = `${NAKLIDATA_VOCABULARY_IRI}taxonomyIdentity`;

const RELATION_PREDICATES = {
  used: `${PROV_IRI}used`,
  was_generated_by: `${PROV_IRI}wasGeneratedBy`,
  was_derived_from: `${PROV_IRI}wasDerivedFrom`,
  was_associated_with: `${PROV_IRI}wasAssociatedWith`,
} as const;

const PREDICATE_RELATIONS = new Map<string, ProvenanceRelationContract['kind']>(
  Object.entries(RELATION_PREDICATES).map(([kind, iri]) => [
    iri,
    kind as ProvenanceRelationContract['kind'],
  ]),
);

const SUPPORTED_PROV_PREDICATES = new Set([
  ...Object.values(RELATION_PREDICATES),
  PROV_STARTED_AT,
  PROV_ENDED_AT,
]);

export interface ProvExportOptions {
  buildIdentity: string;
  taxonomyIdentity: string;
  sourceReferences?: Readonly<Record<CanonicalId, string>>;
  relationConfidence?: Readonly<Record<string, 'high' | 'low'>>;
}

export interface ProvRelationEvidence {
  key: string;
  observed: boolean;
  confidence: 'high' | 'low';
}

export interface ProvExportResult {
  format: 'text/turtle';
  profile: 'naklidata-prov-o-2013-v1';
  turtle: string;
  tripleCount: number;
  observedRelations: number;
  annotatedRelations: number;
  losses: LossRecord[];
}

export interface ProvImportResult {
  format: 'naklidata-prov-o-import';
  version: 1;
  accepted: false;
  provenance: ProvenanceContract;
  relationEvidence: ProvRelationEvidence[];
  buildIdentity: string | null;
  taxonomyIdentity: string | null;
  sourceReferences: Record<CanonicalId, string>;
  losses: LossRecord[];
  stats: { bytes: number; quads: number; records: number };
}

export interface ProvLineageProjectionOptions {
  resourceIdsByNode?: Readonly<Record<string, CanonicalId>>;
  redactedNodeIds?: ReadonlyArray<string>;
  activityTimes?: Readonly<Record<string, { startedAt: string | null; endedAt: string | null }>>;
  softwareAgentLabel: string;
}

export interface ProvLineageProjection {
  provenance: ProvenanceContract;
  sourceReferences: Record<CanonicalId, string>;
  relationConfidence: Record<string, 'high' | 'low'>;
}

/**
 * Projects the persisted workbook lineage graph into the canonical provenance
 * contract. Visual-only inserted cells carry `cellKind`; their activities and
 * relations remain annotations rather than observed runtime history.
 */
export function projectLineageToProvenance(
  graph: LineageGraph,
  options: ProvLineageProjectionOptions,
): ProvLineageProjection {
  const nodeById = new Map<string, (typeof graph.nodes)[number]>();
  for (const node of graph.nodes) {
    if (nodeById.has(node.id)) throw new TypeError(`Duplicate lineage node ${node.id}.`);
    nodeById.set(node.id, node);
  }
  for (const edge of graph.edges) {
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) {
      throw new TypeError(`Lineage edge ${edge.from} -> ${edge.to} has a dangling endpoint.`);
    }
  }
  const redacted = new Set(options.redactedNodeIds ?? []);
  const entities: ProvenanceEntityContract[] = [];
  const activities: ProvenanceActivityContract[] = [];
  const agents: ProvenanceAgentContract[] = [];
  const relations: ProvenanceRelationContract[] = [];
  const sourceReferences: Record<CanonicalId, string> = {};
  const relationConfidence: Record<string, 'high' | 'low'> = {};
  const entityByNode = new Map<string, CanonicalId>();
  const activityByNode = new Map<string, CanonicalId>();
  const resultByCell = new Map<string, CanonicalId>();
  const annotatedCells = new Set(
    graph.nodes.filter((node) => node.kind === 'cell' && node.cellKind).map((node) => node.id),
  );
  const softwareAgentId = canonicalId('agent', 'naklidata-lineage-projection');
  agents.push({ id: softwareAgentId, kind: 'software', label: options.softwareAgentLabel });

  for (const node of [...graph.nodes].sort((left, right) => left.id.localeCompare(right.id))) {
    const opaque = stableHash(node.id);
    if (node.kind === 'cell') {
      const activityId = canonicalId('activity', `lineage-cell-${opaque}`);
      const resultId = canonicalId('entity', `lineage-result-${opaque}`);
      activityByNode.set(node.id, activityId);
      resultByCell.set(node.id, resultId);
      const times = options.activityTimes?.[node.id];
      activities.push({
        id: activityId,
        kind: node.cellKind ? 'annotation' : 'query',
        startedAt: times?.startedAt ?? null,
        endedAt: times?.endedAt ?? null,
      });
      entities.push({
        id: resultId,
        kind: 'result',
        label: `${node.label} result`,
        resourceId: null,
        redacted: redacted.has(node.id),
      });
      addProjectedRelation(
        relations,
        relationConfidence,
        {
          kind: 'was_generated_by',
          fromId: resultId,
          toId: activityId,
          observed: !node.cellKind,
        },
        'high',
      );
      addProjectedRelation(
        relations,
        relationConfidence,
        {
          kind: 'was_associated_with',
          fromId: activityId,
          toId: softwareAgentId,
          observed: !node.cellKind,
        },
        'high',
      );
      continue;
    }
    const entityId = canonicalId('entity', `lineage-${node.kind}-${opaque}`);
    entityByNode.set(node.id, entityId);
    entities.push({
      id: entityId,
      kind: node.kind === 'source' ? 'source' : 'export',
      label: node.label,
      resourceId: options.resourceIdsByNode?.[node.id] ?? null,
      redacted: redacted.has(node.id),
    });
    if (node.kind === 'source' && node.ref && !redacted.has(node.id)) {
      validateSourceReference(node.ref);
      sourceReferences[entityId] = node.ref;
    }
  }

  for (const edge of graph.edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) throw new TypeError('Lineage edge endpoint disappeared during projection.');
    const observed = !annotatedCells.has(from.id) && !annotatedCells.has(to.id);
    if (to.kind === 'cell') {
      const activityId = activityByNode.get(to.id);
      const inputEntityId =
        from.kind === 'cell' ? resultByCell.get(from.id) : entityByNode.get(from.id);
      if (!activityId || !inputEntityId)
        throw new TypeError('Lineage input mapping is incomplete.');
      addProjectedRelation(
        relations,
        relationConfidence,
        { kind: 'used', fromId: activityId, toId: inputEntityId, observed },
        edge.confidence,
      );
      if (from.kind === 'cell') {
        const outputEntityId = resultByCell.get(to.id);
        if (!outputEntityId) throw new TypeError('Lineage result mapping is incomplete.');
        addProjectedRelation(
          relations,
          relationConfidence,
          {
            kind: 'was_derived_from',
            fromId: outputEntityId,
            toId: inputEntityId,
            observed,
          },
          edge.confidence,
        );
      }
    } else if (to.kind === 'sink' && from.kind === 'cell') {
      const sinkEntityId = entityByNode.get(to.id);
      const activityId = activityByNode.get(from.id);
      if (!sinkEntityId || !activityId) throw new TypeError('Lineage sink mapping is incomplete.');
      addProjectedRelation(
        relations,
        relationConfidence,
        { kind: 'was_generated_by', fromId: sinkEntityId, toId: activityId, observed },
        edge.confidence,
      );
    } else {
      throw new TypeError(`Unsupported lineage edge ${from.kind} -> ${to.kind}.`);
    }
  }
  const provenance: ProvenanceContract = {
    entities: sortedById(entities),
    activities: sortedById(activities),
    agents: sortedById(agents),
    relations: sortedRelations(relations),
  };
  assertProvGraphIntegrity(provenance);
  return { provenance, sourceReferences, relationConfidence };
}

export async function exportProvTurtle(
  document: CanonicalInterchangeV1,
  options: ProvExportOptions,
): Promise<ProvExportResult> {
  assertCanonicalInterchange(document);
  validateIdentity(options.buildIdentity, 'buildIdentity');
  validateIdentity(options.taxonomyIdentity, 'taxonomyIdentity');
  assertProvGraphIntegrity(document.provenance);
  const quads: Quad[] = [];
  let losses = [...document.losses];
  const workbook = namedNode(canonicalIri(document.namespace, document.workbook.id));
  quads.push(quad(workbook, namedNode(ND_BUILD_IDENTITY), literal(options.buildIdentity)));
  quads.push(quad(workbook, namedNode(ND_TAXONOMY_IDENTITY), literal(options.taxonomyIdentity)));

  for (const entity of sortedById(document.provenance.entities)) {
    const subject = namedNode(canonicalIri(document.namespace, entity.id));
    quads.push(quad(subject, namedNode(RDF_TYPE), namedNode(PROV_ENTITY)));
    quads.push(quad(subject, namedNode(RDFS_LABEL), literal(entity.label)));
    quads.push(quad(subject, namedNode(ND_KIND), literal(entity.kind)));
    quads.push(
      quad(
        subject,
        namedNode(ND_REDACTED),
        literal(String(entity.redacted), namedNode(`${XSD_IRI}boolean`)),
      ),
    );
    if (entity.resourceId) {
      quads.push(
        quad(
          subject,
          namedNode(ND_RESOURCE),
          namedNode(canonicalIri(document.namespace, entity.resourceId)),
        ),
      );
    }
    const sourceReference = options.sourceReferences?.[entity.id];
    if (sourceReference !== undefined) {
      validateSourceReference(sourceReference);
      if (entity.redacted) {
        losses = appendLoss(
          losses,
          loss(
            'information',
            'prov.redacted_source_reference',
            entity.id,
            'nd:sourceReference',
            'Source reference was omitted because the entity is redacted.',
          ),
        );
      } else {
        quads.push(quad(subject, namedNode(ND_SOURCE_REFERENCE), literal(sourceReference)));
      }
    }
  }

  for (const activity of sortedById(document.provenance.activities)) {
    const subject = namedNode(canonicalIri(document.namespace, activity.id));
    quads.push(quad(subject, namedNode(RDF_TYPE), namedNode(PROV_ACTIVITY)));
    quads.push(quad(subject, namedNode(ND_KIND), literal(activity.kind)));
    if (activity.startedAt) {
      quads.push(
        quad(
          subject,
          namedNode(PROV_STARTED_AT),
          literal(activity.startedAt, namedNode(`${XSD_IRI}dateTime`)),
        ),
      );
    }
    if (activity.endedAt) {
      quads.push(
        quad(
          subject,
          namedNode(PROV_ENDED_AT),
          literal(activity.endedAt, namedNode(`${XSD_IRI}dateTime`)),
        ),
      );
    }
  }

  for (const agent of sortedById(document.provenance.agents)) {
    const subject = namedNode(canonicalIri(document.namespace, agent.id));
    quads.push(quad(subject, namedNode(RDF_TYPE), namedNode(PROV_AGENT)));
    quads.push(quad(subject, namedNode(RDFS_LABEL), literal(agent.label)));
    quads.push(quad(subject, namedNode(ND_KIND), literal(agent.kind)));
  }

  for (const relation of sortedRelations(document.provenance.relations)) {
    const subject = namedNode(canonicalIri(document.namespace, relation.fromId));
    const predicate = namedNode(RELATION_PREDICATES[relation.kind]);
    const object = namedNode(canonicalIri(document.namespace, relation.toId));
    const key = provenanceRelationKey(relation);
    const statement = namedNode(`${document.namespace.baseIri}prov-relation/${stableHash(key)}`);
    quads.push(quad(subject, predicate, object));
    quads.push(quad(statement, namedNode(RDF_TYPE), namedNode(RDF_STATEMENT)));
    quads.push(quad(statement, namedNode(RDF_SUBJECT), subject));
    quads.push(quad(statement, namedNode(RDF_PREDICATE), predicate));
    quads.push(quad(statement, namedNode(RDF_OBJECT), object));
    quads.push(
      quad(
        statement,
        namedNode(ND_OBSERVED),
        literal(String(relation.observed), namedNode(`${XSD_IRI}boolean`)),
      ),
    );
    quads.push(
      quad(
        statement,
        namedNode(ND_CONFIDENCE),
        literal(options.relationConfidence?.[key] ?? (relation.observed ? 'high' : 'low')),
      ),
    );
  }

  const unique = dedupeQuads(quads);
  const writer = new Writer({
    prefixes: {
      nd: NAKLIDATA_VOCABULARY_IRI,
      prov: PROV_IRI,
      rdf: RDF_IRI,
      rdfs: RDFS_IRI,
      xsd: XSD_IRI,
    },
  });
  writer.addQuads(unique);
  return {
    format: 'text/turtle',
    profile: 'naklidata-prov-o-2013-v1',
    turtle: await endWriter(writer),
    tripleCount: unique.length,
    observedRelations: document.provenance.relations.filter((item) => item.observed).length,
    annotatedRelations: document.provenance.relations.filter((item) => !item.observed).length,
    losses,
  };
}

export function importProvTurtle(
  turtle: string,
  document: CanonicalInterchangeV1,
): ProvImportResult {
  assertCanonicalInterchange(document);
  const bytes = new TextEncoder().encode(turtle).byteLength;
  if (bytes > MAX_PROV_BYTES)
    throw new RangeError(`PROV artifact exceeds ${MAX_PROV_BYTES} bytes.`);
  const quads: Quad[] = new Parser({
    baseIRI: document.namespace.baseIri,
    format: 'text/turtle',
  }).parse(turtle);
  if (quads.length > MAX_PROV_QUADS) {
    throw new RangeError(`PROV artifact exceeds ${MAX_PROV_QUADS} quads.`);
  }
  const store = new Store(quads);
  const entityIris = typedNamedSubjects(store, PROV_ENTITY);
  const activityIris = typedNamedSubjects(store, PROV_ACTIVITY);
  const agentIris = typedNamedSubjects(store, PROV_AGENT);
  const records = entityIris.length + activityIris.length + agentIris.length;
  if (records > MAX_PROV_RECORDS) {
    throw new RangeError(`PROV artifact exceeds ${MAX_PROV_RECORDS} records.`);
  }
  rejectAmbiguousTypes(entityIris, activityIris, agentIris);
  let losses: LossRecord[] = [];
  for (const item of quads) {
    if (
      item.predicate.value.startsWith(PROV_IRI) &&
      !SUPPORTED_PROV_PREDICATES.has(item.predicate.value)
    ) {
      losses = appendLoss(
        losses,
        loss(
          'warning',
          'prov.unsupported_term',
          item.subject.value,
          item.predicate.value,
          'PROV-O term is outside the supported profile.',
        ),
      );
    }
  }

  const entityIds = new Map(entityIris.map((iri) => [iri, idFromIri(document, iri, 'entity')]));
  const activityIds = new Map(
    activityIris.map((iri) => [iri, idFromIri(document, iri, 'activity')]),
  );
  const agentIds = new Map(agentIris.map((iri) => [iri, idFromIri(document, iri, 'agent')]));
  const resourceByIri = new Map<string, CanonicalId>([
    ...document.sources.map(
      (item) => [canonicalIri(document.namespace, item.id), item.id] as const,
    ),
    ...document.tables.map((item) => [canonicalIri(document.namespace, item.id), item.id] as const),
    ...document.fields.map((item) => [canonicalIri(document.namespace, item.id), item.id] as const),
  ]);
  const sourceReferences: Record<CanonicalId, string> = {};
  const entities: ProvenanceEntityContract[] = entityIris.map((iri) => {
    const id = requiredMapValue(entityIds, iri);
    const resourceIri = oneNamedObject(store, iri, ND_RESOURCE, false);
    const resourceId = resourceIri ? (resourceByIri.get(resourceIri) ?? null) : null;
    if (resourceIri && !resourceId) {
      losses = appendLoss(
        losses,
        loss(
          'warning',
          'prov.unknown_resource',
          iri,
          'nd:resource',
          'Resource link does not identify a canonical source, table, or field.',
        ),
      );
    }
    const reference = oneLiteral(store, iri, ND_SOURCE_REFERENCE, false);
    if (reference !== null) {
      validateSourceReference(reference);
      sourceReferences[id] = reference;
    }
    return {
      id,
      kind: provenanceKind(store, iri, ['source', 'table', 'result', 'export'], 'result'),
      label: oneLiteral(store, iri, RDFS_LABEL, false) ?? iri,
      resourceId,
      redacted: oneBoolean(store, iri, ND_REDACTED, true),
    };
  });
  const activities: ProvenanceActivityContract[] = activityIris.map((iri) => ({
    id: requiredMapValue(activityIds, iri),
    kind: provenanceKind(
      store,
      iri,
      ['mount', 'classify', 'query', 'export', 'annotation'],
      'annotation',
    ),
    startedAt: oneLiteral(store, iri, PROV_STARTED_AT, false),
    endedAt: oneLiteral(store, iri, PROV_ENDED_AT, false),
  }));
  const agents: ProvenanceAgentContract[] = agentIris.map((iri) => ({
    id: requiredMapValue(agentIds, iri),
    kind: provenanceKind(store, iri, ['person', 'software', 'agent'], 'agent'),
    label: oneLiteral(store, iri, RDFS_LABEL, false) ?? iri,
  }));

  const relations: ProvenanceRelationContract[] = [];
  const relationEvidence: ProvRelationEvidence[] = [];
  for (const [predicateIri, kind] of PREDICATE_RELATIONS) {
    for (const item of store.getQuads(null, namedNode(predicateIri), null, null)) {
      if (item.subject.termType !== 'NamedNode' || item.object.termType !== 'NamedNode') {
        throw new TypeError(`PROV relation ${predicateIri} requires named endpoints.`);
      }
      const fromId = idForRelationEndpoint(kind, 'from', item.subject.value, {
        entities: entityIds,
        activities: activityIds,
        agents: agentIds,
      });
      const toId = idForRelationEndpoint(kind, 'to', item.object.value, {
        entities: entityIds,
        activities: activityIds,
        agents: agentIds,
      });
      if (!fromId || !toId) {
        throw new TypeError(`PROV relation ${predicateIri} has an untyped or dangling endpoint.`);
      }
      const statements = statementNodes(store, item.subject, item.predicate, item.object);
      if (statements.length > 1)
        throw new TypeError('PROV relation metadata ownership is ambiguous.');
      const statement = statements[0] ?? null;
      const observed = statement ? oneBoolean(store, statement, ND_OBSERVED, false) : false;
      const confidenceValue = statement ? oneLiteral(store, statement, ND_CONFIDENCE, false) : null;
      const confidence = confidenceValue === 'high' ? 'high' : 'low';
      const relation: ProvenanceRelationContract = { kind, fromId, toId, observed };
      relations.push(relation);
      relationEvidence.push({ key: provenanceRelationKey(relation), observed, confidence });
    }
  }
  const provenance: ProvenanceContract = {
    entities: sortedById(entities),
    activities: sortedById(activities),
    agents: sortedById(agents),
    relations: sortedRelations(relations),
  };
  assertProvGraphIntegrity(provenance);
  const workbookIri = canonicalIri(document.namespace, document.workbook.id);
  return {
    format: 'naklidata-prov-o-import',
    version: 1,
    accepted: false,
    provenance,
    relationEvidence: relationEvidence.sort((left, right) => left.key.localeCompare(right.key)),
    buildIdentity: oneLiteral(store, workbookIri, ND_BUILD_IDENTITY, false),
    taxonomyIdentity: oneLiteral(store, workbookIri, ND_TAXONOMY_IDENTITY, false),
    sourceReferences,
    losses,
    stats: { bytes, quads: quads.length, records },
  };
}

export function acceptProvProposal(imported: ProvImportResult): ProvenanceContract {
  return structuredClone(imported.provenance);
}

export function provenanceRelationKey(relation: ProvenanceRelationContract): string {
  return `${relation.kind}\u0000${relation.fromId}\u0000${relation.toId}`;
}

function addProjectedRelation(
  relations: ProvenanceRelationContract[],
  confidenceByKey: Record<string, 'high' | 'low'>,
  relation: ProvenanceRelationContract,
  confidence: 'high' | 'low',
): void {
  const key = provenanceRelationKey(relation);
  if (relations.some((item) => provenanceRelationKey(item) === key)) return;
  relations.push(relation);
  confidenceByKey[key] = confidence;
}

export function assertProvGraphIntegrity(provenance: ProvenanceContract): void {
  const relationKeys = new Set<string>();
  const generatedBy = new Map<CanonicalId, CanonicalId>();
  for (const relation of provenance.relations) {
    const key = provenanceRelationKey(relation);
    if (relationKeys.has(key)) throw new TypeError(`PROV relation ${key} is duplicated.`);
    relationKeys.add(key);
    if (relation.kind !== 'was_generated_by') continue;
    const existing = generatedBy.get(relation.fromId);
    if (existing && existing !== relation.toId) {
      throw new TypeError(`Entity ${relation.fromId} has ambiguous generating activities.`);
    }
    generatedBy.set(relation.fromId, relation.toId);
  }
  const derived = provenance.relations.filter((item) => item.kind === 'was_derived_from');
  const edges = new Map<CanonicalId, CanonicalId[]>();
  for (const relation of derived) {
    const next = edges.get(relation.fromId) ?? [];
    next.push(relation.toId);
    edges.set(relation.fromId, next);
  }
  const visiting = new Set<CanonicalId>();
  const visited = new Set<CanonicalId>();
  const visit = (id: CanonicalId): void => {
    if (visiting.has(id)) throw new TypeError('PROV derivation graph contains a cycle.');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of edges.get(id) ?? []) visit(next);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of edges.keys()) visit(id);
}

function rejectAmbiguousTypes(
  entities: ReadonlyArray<string>,
  activities: ReadonlyArray<string>,
  agents: ReadonlyArray<string>,
): void {
  const counts = new Map<string, number>();
  for (const iri of [...entities, ...activities, ...agents])
    counts.set(iri, (counts.get(iri) ?? 0) + 1);
  const ambiguous = [...counts.entries()].find(([, count]) => count > 1);
  if (ambiguous) throw new TypeError(`PROV resource ${ambiguous[0]} has ambiguous core types.`);
}

function idForRelationEndpoint(
  kind: ProvenanceRelationContract['kind'],
  side: 'from' | 'to',
  iri: string,
  maps: {
    entities: ReadonlyMap<string, CanonicalId>;
    activities: ReadonlyMap<string, CanonicalId>;
    agents: ReadonlyMap<string, CanonicalId>;
  },
): CanonicalId | null {
  if (kind === 'used')
    return side === 'from' ? (maps.activities.get(iri) ?? null) : (maps.entities.get(iri) ?? null);
  if (kind === 'was_generated_by')
    return side === 'from' ? (maps.entities.get(iri) ?? null) : (maps.activities.get(iri) ?? null);
  if (kind === 'was_derived_from') return maps.entities.get(iri) ?? null;
  return side === 'from' ? (maps.activities.get(iri) ?? null) : (maps.agents.get(iri) ?? null);
}

function statementNodes(store: Store, subject: Term, predicate: Term, object: Term): string[] {
  const candidates = store
    .getQuads(null, namedNode(RDF_SUBJECT), subject, null)
    .map((item) => item.subject)
    .filter((item) => item.termType === 'NamedNode');
  return sortedUnique(
    candidates
      .filter(
        (candidate) =>
          store.countQuads(candidate, namedNode(RDF_PREDICATE), predicate, null) === 1 &&
          store.countQuads(candidate, namedNode(RDF_OBJECT), object, null) === 1,
      )
      .map((item) => item.value),
  );
}

function provenanceKind<T extends string>(
  store: Store,
  subject: string,
  supported: ReadonlyArray<T>,
  fallback: T,
): T {
  const value = oneLiteral(store, subject, ND_KIND, false);
  return value !== null && supported.includes(value as T) ? (value as T) : fallback;
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
    throw new TypeError(`${predicate} requires exactly one literal value.`);
  }
  return values[0].object.value;
}

function oneBoolean(store: Store, subject: string, predicate: string, fallback: boolean): boolean {
  const value = oneLiteral(store, subject, predicate, false);
  if (value === null) return fallback;
  if (value !== 'true' && value !== 'false')
    throw new TypeError(`${predicate} requires a boolean.`);
  return value === 'true';
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

function typedNamedSubjects(store: Store, typeIri: string): string[] {
  return sortedUnique(
    store
      .getQuads(null, namedNode(RDF_TYPE), namedNode(typeIri), null)
      .filter((item) => item.subject.termType === 'NamedNode')
      .map((item) => item.subject.value),
  );
}

function idFromIri(
  document: CanonicalInterchangeV1,
  iri: string,
  kind: 'entity' | 'activity' | 'agent',
): CanonicalId {
  if (iri.startsWith(document.namespace.baseIri)) {
    const candidate = decodeURIComponent(iri.slice(document.namespace.baseIri.length));
    if (resourceKindOf(candidate) === kind) return candidate as CanonicalId;
  }
  return canonicalId(kind, `prov-import-${stableHash(iri)}`);
}

function validateIdentity(value: string, name: string): void {
  if (!value.trim() || value.length > 256)
    throw new TypeError(`${name} must contain 1..256 characters.`);
}

function validateSourceReference(value: string): void {
  const hasControlCharacter = [...value].some((character) => character.charCodeAt(0) < 32);
  if (!value.trim() || value.length > MAX_PROV_REFERENCE_LENGTH || hasControlCharacter) {
    throw new TypeError(
      `Source reference must contain 1..${MAX_PROV_REFERENCE_LENGTH} printable characters.`,
    );
  }
}

function sortedById<T extends { id: CanonicalId }>(items: ReadonlyArray<T>): T[] {
  return [...items].sort((left, right) => left.id.localeCompare(right.id));
}

function sortedRelations(
  items: ReadonlyArray<ProvenanceRelationContract>,
): ProvenanceRelationContract[] {
  return [...items].sort((left, right) =>
    provenanceRelationKey(left).localeCompare(provenanceRelationKey(right)),
  );
}

function requiredMapValue(map: ReadonlyMap<string, CanonicalId>, key: string): CanonicalId {
  const value = map.get(key);
  if (!value) throw new TypeError(`Missing canonical mapping for ${key}.`);
  return value;
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
