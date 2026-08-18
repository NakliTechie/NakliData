import type { NamedNode, Quad } from '@rdfjs/types';
import { DataFactory, Parser, Writer } from 'n3';
import type { TaxonomyBundle } from '../../taxonomy/types.ts';
import type { UserType } from '../workbook.ts';
import {
  type CanonicalId,
  type CanonicalInterchangeV1,
  type ConceptContract,
  type ConceptMappingContract,
  type LocalizedLabel,
  type LossRecord,
  appendLoss,
  assertCanonicalInterchange,
  canonicalId,
  canonicalIri,
  resourceKindOf,
} from './interchange.ts';

const { namedNode, literal, quad } = DataFactory;

export const SKOS_IRI = 'http://www.w3.org/2004/02/skos/core#';
export const RDF_IRI = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
export const MAX_SKOS_BYTES = 1_000_000;
export const MAX_SKOS_QUADS = 50_000;
export const MAX_SKOS_CONCEPTS = 5_000;
export const MAX_SKOS_LABELS = 20_000;

const RDF_TYPE = `${RDF_IRI}type`;
const SKOS_CONCEPT_SCHEME = `${SKOS_IRI}ConceptScheme`;
const SKOS_CONCEPT = `${SKOS_IRI}Concept`;
const SKOS_PREF_LABEL = `${SKOS_IRI}prefLabel`;
const SKOS_ALT_LABEL = `${SKOS_IRI}altLabel`;
const SKOS_IN_SCHEME = `${SKOS_IRI}inScheme`;
const SKOS_HAS_TOP_CONCEPT = `${SKOS_IRI}hasTopConcept`;
const SKOS_TOP_CONCEPT_OF = `${SKOS_IRI}topConceptOf`;
const SKOS_BROADER = `${SKOS_IRI}broader`;
const SKOS_NARROWER = `${SKOS_IRI}narrower`;
const SKOS_RELATED = `${SKOS_IRI}related`;

const MAPPING_PREDICATES = {
  exact: `${SKOS_IRI}exactMatch`,
  close: `${SKOS_IRI}closeMatch`,
  broad: `${SKOS_IRI}broadMatch`,
  narrow: `${SKOS_IRI}narrowMatch`,
  related: `${SKOS_IRI}relatedMatch`,
} as const;

const PREDICATE_TO_MAPPING = new Map<string, ConceptMappingContract['kind']>(
  Object.entries(MAPPING_PREDICATES).map(([kind, iri]) => [
    iri,
    kind as ConceptMappingContract['kind'],
  ]),
);

const SUPPORTED_PREDICATES = new Set([
  RDF_TYPE,
  SKOS_PREF_LABEL,
  SKOS_ALT_LABEL,
  SKOS_IN_SCHEME,
  SKOS_HAS_TOP_CONCEPT,
  SKOS_TOP_CONCEPT_OF,
  SKOS_BROADER,
  SKOS_NARROWER,
  SKOS_RELATED,
  ...Object.values(MAPPING_PREDICATES),
]);

export interface SkosExportOptions {
  /** Prefix used for the document base IRI. */
  basePrefix: string;
  /** Optional output-prefix overrides; `rdf`, `skos`, and `nd` remain reserved. */
  prefixes: Record<string, string>;
}

export interface SkosExportResult {
  format: 'text/turtle';
  profile: 'naklidata-skos-2009-v1';
  turtle: string;
  tripleCount: number;
  losses: LossRecord[];
}

export interface SkosSchemeProposal {
  sourceIri: string;
  suggestedId: CanonicalId;
  preferredLabels: LocalizedLabel[];
  topConceptIris: string[];
}

export interface SkosConceptProposal {
  sourceIri: string;
  suggestedId: CanonicalId;
  schemeIris: string[];
  preferredLabels: LocalizedLabel[];
  alternateLabels: LocalizedLabel[];
  broaderIris: string[];
  relatedIris: string[];
  mappings: ConceptMappingContract[];
}

export interface SkosImportResult {
  format: 'naklidata-skos-import';
  version: 1;
  accepted: false;
  prefixes: Record<string, string>;
  schemes: SkosSchemeProposal[];
  concepts: SkosConceptProposal[];
  losses: LossRecord[];
  stats: { bytes: number; quads: number; labels: number };
}

export interface SkosVocabularyRow {
  sourceIri: string;
  kind: 'scheme' | 'concept';
  label: string;
  aliases: string[];
  schemeIris: string[];
  mappingCount: number;
}

export interface AcceptedSkosProposals {
  schemes: ConceptContract[];
  concepts: ConceptContract[];
  losses: LossRecord[];
}

export interface TaxonomySkosOptions {
  mappingPrefixes: Record<string, string>;
}

export interface TaxonomySkosResult {
  concepts: ConceptContract[];
  losses: LossRecord[];
}

/** Project bundled and workbook-local types into two explicit concept schemes. */
export function buildTaxonomySkosConcepts(
  taxonomy: TaxonomyBundle,
  userTypes: ReadonlyArray<UserType>,
  options: Partial<TaxonomySkosOptions> = {},
): TaxonomySkosResult {
  let losses: LossRecord[] = [];
  const concepts: ConceptContract[] = [];
  const taxonomySchemeId = canonicalId('concept', `taxonomy:${taxonomy.version}:scheme`);
  const userSchemeId = canonicalId('concept', `taxonomy:${taxonomy.version}:user-types`);
  concepts.push(conceptScheme(taxonomySchemeId, `NakliData taxonomy ${taxonomy.version}`));
  if (userTypes.length) concepts.push(conceptScheme(userSchemeId, 'Workbook types'));

  const universalIds = new Map(
    (taxonomy.universal?.terms ?? []).map((term) => [
      term.id,
      canonicalId('concept', `taxonomy:${taxonomy.version}:universal:${term.id}`),
    ]),
  );
  for (const term of [...(taxonomy.universal?.terms ?? [])].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    const mappings: ConceptMappingContract[] = [];
    for (const target of term.exactMatch ?? []) {
      const expanded = expandCurie(target, options.mappingPrefixes ?? {});
      if (expanded) mappings.push({ kind: 'exact', targetIri: expanded });
      else {
        losses = appendLoss(
          losses,
          loss(
            'warning',
            'skos.unresolved_mapping_prefix',
            term.id,
            target,
            'Mapping prefix is absent from the explicit export registry.',
          ),
        );
      }
    }
    concepts.push({
      id: requireCanonicalId(universalIds, term.id),
      kind: 'concept',
      schemeId: taxonomySchemeId,
      preferredLabels: [{ value: term.prefLabel, language: 'en' }],
      alternateLabels: [],
      broaderIds: (term.broader ?? []).flatMap((parent) => {
        const id = universalIds.get(parent);
        if (id) return [id];
        losses = appendLoss(
          losses,
          loss(
            'error',
            'skos.unknown_broader',
            term.id,
            'skos:broader',
            `Unknown universal term ${parent}.`,
          ),
        );
        return [];
      }),
      relatedIds: [],
      mappings,
    });
  }

  const universalByRole = new Map(
    (taxonomy.universal?.crosswalk ?? []).map((entry) => [entry.role, entry.universalTerm]),
  );
  for (const type of [...taxonomy.types].sort((left, right) => left.id.localeCompare(right.id))) {
    const universalId = universalIds.get(universalByRole.get(type.id) ?? '');
    if (!universalId) {
      losses = appendLoss(
        losses,
        loss(
          'warning',
          'skos.unmapped_taxonomy_type',
          type.id,
          'skos:broader',
          'Taxonomy type has no universal-term mapping.',
        ),
      );
    }
    concepts.push({
      id: canonicalId('concept', `taxonomy:${taxonomy.version}:type:${type.id}`),
      kind: 'concept',
      schemeId: taxonomySchemeId,
      preferredLabels: [{ value: type.display_name, language: 'en' }],
      alternateLabels: [],
      broaderIds: universalId ? [universalId] : [],
      relatedIds: [],
      mappings: [],
    });
  }

  for (const type of [...userTypes].sort((left, right) => left.id.localeCompare(right.id))) {
    concepts.push({
      id: canonicalId('concept', `taxonomy:${taxonomy.version}:user:${type.id}`),
      kind: 'concept',
      schemeId: userSchemeId,
      preferredLabels: [{ value: type.display_name, language: 'en' }],
      alternateLabels: [],
      broaderIds: [],
      relatedIds: [],
      mappings: [],
    });
  }
  return { concepts, losses };
}

export async function exportSkosTurtle(
  document: CanonicalInterchangeV1,
  options: Partial<SkosExportOptions> = {},
): Promise<SkosExportResult> {
  assertCanonicalInterchange(document);
  const prefixes = exportPrefixes(document, options);
  const writer = new Writer({ prefixes });
  const quads = [];
  const concepts = [...document.concepts].sort((left, right) => left.id.localeCompare(right.id));
  const iriById = new Map(
    concepts.map((concept) => [concept.id, canonicalIri(document.namespace, concept.id)]),
  );

  for (const concept of concepts) {
    const subject = namedNode(requireIri(iriById, concept.id));
    quads.push(
      quad(
        subject,
        namedNode(RDF_TYPE),
        namedNode(concept.kind === 'scheme' ? SKOS_CONCEPT_SCHEME : SKOS_CONCEPT),
      ),
    );
    addLabels(quads, subject, SKOS_PREF_LABEL, concept.preferredLabels);
    addLabels(quads, subject, SKOS_ALT_LABEL, concept.alternateLabels);
    if (concept.kind === 'scheme') continue;
    if (!concept.schemeId) throw new TypeError(`${concept.id} has no concept scheme.`);
    const schemeIri = requireIri(iriById, concept.schemeId);
    quads.push(quad(subject, namedNode(SKOS_IN_SCHEME), namedNode(schemeIri)));
    if (concept.broaderIds.length === 0) {
      quads.push(quad(subject, namedNode(SKOS_TOP_CONCEPT_OF), namedNode(schemeIri)));
      quads.push(quad(namedNode(schemeIri), namedNode(SKOS_HAS_TOP_CONCEPT), subject));
    }
    for (const broaderId of sortedUnique(concept.broaderIds)) {
      const broader = namedNode(requireIri(iriById, broaderId));
      quads.push(quad(subject, namedNode(SKOS_BROADER), broader));
      quads.push(quad(broader, namedNode(SKOS_NARROWER), subject));
    }
    for (const relatedId of sortedUnique(concept.relatedIds)) {
      quads.push(quad(subject, namedNode(SKOS_RELATED), namedNode(requireIri(iriById, relatedId))));
    }
    for (const mapping of [...concept.mappings].sort(mappingOrder)) {
      quads.push(
        quad(subject, namedNode(MAPPING_PREDICATES[mapping.kind]), namedNode(mapping.targetIri)),
      );
    }
  }
  const uniqueQuads = dedupeQuads(quads);
  writer.addQuads(uniqueQuads);
  const turtle = await endWriter(writer);
  return {
    format: 'text/turtle',
    profile: 'naklidata-skos-2009-v1',
    turtle,
    tripleCount: uniqueQuads.length,
    losses: [...document.losses],
  };
}

export function importSkosTurtle(turtle: string, baseIri: string): SkosImportResult {
  const bytes = new TextEncoder().encode(turtle).byteLength;
  if (bytes > MAX_SKOS_BYTES)
    throw new RangeError(`SKOS artifact exceeds ${MAX_SKOS_BYTES} bytes.`);
  if (!isAbsoluteIri(baseIri)) throw new TypeError('SKOS base IRI must be absolute.');
  const parser = new Parser({ baseIRI: baseIri, format: 'text/turtle' });
  const quads: Quad[] = parser.parse(turtle);
  if (quads.length > MAX_SKOS_QUADS)
    throw new RangeError(`SKOS artifact exceeds ${MAX_SKOS_QUADS} quads.`);
  const prefixes = declaredPrefixes(turtle);
  const schemeIris = typedSubjects(quads, SKOS_CONCEPT_SCHEME);
  const conceptIris = typedSubjects(quads, SKOS_CONCEPT);
  if (conceptIris.length > MAX_SKOS_CONCEPTS) {
    throw new RangeError(`SKOS artifact exceeds ${MAX_SKOS_CONCEPTS} concepts.`);
  }
  let losses: LossRecord[] = [];
  const idOwners = new Map<string, string>();
  const idFor = (kind: 'scheme' | 'concept', iri: string): CanonicalId => {
    const local = iri.startsWith(baseIri) ? iri.slice(baseIri.length) : '';
    const preserved = resourceKindOf(local) === 'concept' ? (local as CanonicalId) : null;
    const id = preserved ?? canonicalId('concept', `import-${stableIriHash(iri)}`);
    const owner = idOwners.get(id);
    if (owner && owner !== iri) {
      losses = appendLoss(
        losses,
        loss(
          'error',
          'skos.duplicate_identifier',
          iri,
          kind,
          `Identifier collision with ${owner}.`,
        ),
      );
    } else {
      idOwners.set(id, iri);
    }
    return id;
  };

  const schemes = schemeIris.map((sourceIri) => ({
    sourceIri,
    suggestedId: idFor('scheme', sourceIri),
    preferredLabels: normalizedLabels(quads, sourceIri, SKOS_PREF_LABEL, (next) => {
      losses = appendLoss(losses, next);
    }),
    topConceptIris: namedObjects(quads, sourceIri, SKOS_HAS_TOP_CONCEPT),
  }));

  const concepts = conceptIris.map((sourceIri) => {
    const schemeLinks = sortedUnique([
      ...namedObjects(quads, sourceIri, SKOS_IN_SCHEME),
      ...namedObjects(quads, sourceIri, SKOS_TOP_CONCEPT_OF),
      ...schemeIris.filter((schemeIri) =>
        quads.some(
          (item) =>
            item.subject.value === schemeIri &&
            item.predicate.value === SKOS_HAS_TOP_CONCEPT &&
            item.object.termType === 'NamedNode' &&
            item.object.value === sourceIri,
        ),
      ),
    ]);
    if (schemeLinks.length === 0) {
      losses = appendLoss(
        losses,
        loss(
          'error',
          'skos.missing_scheme',
          sourceIri,
          'skos:inScheme',
          'Concept has no supported scheme link.',
        ),
      );
    } else if (schemeLinks.length > 1) {
      losses = appendLoss(
        losses,
        loss(
          'error',
          'skos.multiple_schemes',
          sourceIri,
          'skos:inScheme',
          'The canonical contract supports one scheme per concept.',
        ),
      );
    }
    return {
      sourceIri,
      suggestedId: idFor('concept', sourceIri),
      schemeIris: schemeLinks,
      preferredLabels: normalizedLabels(quads, sourceIri, SKOS_PREF_LABEL, (next) => {
        losses = appendLoss(losses, next);
      }),
      alternateLabels: normalizedLabels(
        quads,
        sourceIri,
        SKOS_ALT_LABEL,
        (next) => {
          losses = appendLoss(losses, next);
        },
        false,
      ),
      broaderIris: sortedUnique([
        ...namedObjects(quads, sourceIri, SKOS_BROADER),
        ...namedSubjects(quads, SKOS_NARROWER, sourceIri),
      ]),
      relatedIris: sortedUnique([
        ...namedObjects(quads, sourceIri, SKOS_RELATED),
        ...namedSubjects(quads, SKOS_RELATED, sourceIri),
      ]),
      mappings: mappingObjects(quads, sourceIri),
    } satisfies SkosConceptProposal;
  });

  const knownSubjects = new Set([...schemeIris, ...conceptIris]);
  for (const item of quads) {
    if (item.subject.termType === 'BlankNode' || item.object.termType === 'BlankNode') {
      losses = appendLoss(
        losses,
        loss(
          'warning',
          'skos.blank_node_unsupported',
          item.subject.value,
          'blank node',
          'Blank-node constructs are not imported.',
        ),
      );
    }
    if (knownSubjects.has(item.subject.value) && !SUPPORTED_PREDICATES.has(item.predicate.value)) {
      losses = appendLoss(
        losses,
        loss(
          'warning',
          'skos.unsupported_term',
          item.subject.value,
          item.predicate.value,
          'Predicate is outside the supported SKOS profile.',
        ),
      );
    }
  }

  const labels = [...schemes, ...concepts].reduce(
    (count, item) =>
      count +
      item.preferredLabels.length +
      ('alternateLabels' in item ? item.alternateLabels.length : 0),
    0,
  );
  if (labels > MAX_SKOS_LABELS)
    throw new RangeError(`SKOS artifact exceeds ${MAX_SKOS_LABELS} labels.`);
  return {
    format: 'naklidata-skos-import',
    version: 1,
    accepted: false,
    prefixes,
    schemes,
    concepts,
    losses,
    stats: { bytes, quads: quads.length, labels },
  };
}

export function browseSkosVocabulary(
  imported: SkosImportResult,
  query: string,
  limit = 100,
): SkosVocabularyRow[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw new RangeError('Vocabulary browse limit must be 1..200.');
  const needle = query.trim().toLocaleLowerCase();
  const schemes: SkosVocabularyRow[] = imported.schemes.map((scheme) => ({
    sourceIri: scheme.sourceIri,
    kind: 'scheme',
    label: displayLabel(scheme.preferredLabels, scheme.sourceIri),
    aliases: [],
    schemeIris: [],
    mappingCount: 0,
  }));
  const concepts: SkosVocabularyRow[] = imported.concepts.map((concept) => ({
    sourceIri: concept.sourceIri,
    kind: 'concept',
    label: displayLabel(concept.preferredLabels, concept.sourceIri),
    aliases: concept.alternateLabels.map((label) => label.value),
    schemeIris: [...concept.schemeIris],
    mappingCount: concept.mappings.length,
  }));
  return [...schemes, ...concepts]
    .filter((row) =>
      needle
        ? [row.sourceIri, row.label, ...row.aliases].some((value) =>
            value.toLocaleLowerCase().includes(needle),
          )
        : true,
    )
    .sort(
      (left, right) =>
        left.label.localeCompare(right.label) || left.sourceIri.localeCompare(right.sourceIri),
    )
    .slice(0, limit);
}

/**
 * Explicit acceptance boundary. It returns canonical records and never mutates
 * a workbook or its taxonomy.
 */
export function acceptSkosProposals(
  imported: SkosImportResult,
  selectedConceptIris: ReadonlyArray<string>,
): AcceptedSkosProposals {
  const selected = new Set(selectedConceptIris);
  const candidates = imported.concepts.filter((concept) => selected.has(concept.sourceIri));
  const requiredSchemeIris = new Set(
    candidates.flatMap((concept) => concept.schemeIris.slice(0, 1)),
  );
  let losses = [...imported.losses];
  const schemes = imported.schemes
    .filter((scheme) => requiredSchemeIris.has(scheme.sourceIri))
    .map((scheme) => ({
      id: scheme.suggestedId,
      kind: 'scheme' as const,
      schemeId: null,
      preferredLabels: scheme.preferredLabels,
      alternateLabels: [],
      broaderIds: [],
      relatedIds: [],
      mappings: [],
    }));
  const idByIri = new Map([
    ...schemes.map(
      (scheme) =>
        [
          imported.schemes.find((item) => item.suggestedId === scheme.id)?.sourceIri ?? '',
          scheme.id,
        ] as const,
    ),
    ...candidates.map((concept) => [concept.sourceIri, concept.suggestedId] as const),
  ]);
  const concepts: ConceptContract[] = [];
  for (const candidate of candidates) {
    const schemeId = idByIri.get(candidate.schemeIris[0] ?? '');
    if (!schemeId) {
      losses = appendLoss(
        losses,
        loss(
          'error',
          'skos.scheme_not_selected',
          candidate.sourceIri,
          'skos:inScheme',
          'Required scheme is absent from the import.',
        ),
      );
      continue;
    }
    const broaderIds = acceptedRelationIds(
      candidate.sourceIri,
      candidate.broaderIris,
      idByIri,
      'skos:broader',
      (next) => {
        losses = appendLoss(losses, next);
      },
    );
    const relatedIds = acceptedRelationIds(
      candidate.sourceIri,
      candidate.relatedIris,
      idByIri,
      'skos:related',
      (next) => {
        losses = appendLoss(losses, next);
      },
    );
    concepts.push({
      id: candidate.suggestedId,
      kind: 'concept',
      schemeId,
      preferredLabels: candidate.preferredLabels,
      alternateLabels: candidate.alternateLabels,
      broaderIds,
      relatedIds,
      mappings: candidate.mappings,
    });
  }
  return { schemes, concepts, losses };
}

function exportPrefixes(
  document: CanonicalInterchangeV1,
  options: Partial<SkosExportOptions>,
): Record<string, string> {
  const basePrefix = options.basePrefix ?? 'vocab';
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(basePrefix))
    throw new TypeError('SKOS base prefix is invalid.');
  if (['rdf', 'skos', 'nd'].includes(basePrefix))
    throw new TypeError('SKOS base prefix is reserved.');
  const custom = { ...document.namespace.prefixes, ...(options.prefixes ?? {}) };
  for (const reserved of ['rdf', 'skos', 'nd', basePrefix]) delete custom[reserved];
  for (const [prefix, iri] of Object.entries(custom)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(prefix) || !isAbsoluteIri(iri)) {
      throw new TypeError(`Invalid SKOS output prefix ${prefix}.`);
    }
  }
  return {
    [basePrefix]: document.namespace.baseIri,
    rdf: RDF_IRI,
    skos: SKOS_IRI,
    nd: document.namespace.prefixes.nd ?? '',
    ...custom,
  };
}

function conceptScheme(id: CanonicalId, label: string): ConceptContract {
  return {
    id,
    kind: 'scheme',
    schemeId: null,
    preferredLabels: [{ value: label, language: 'en' }],
    alternateLabels: [],
    broaderIds: [],
    relatedIds: [],
    mappings: [],
  };
}

function expandCurie(value: string, prefixes: Record<string, string>): string | null {
  const separator = value.indexOf(':');
  if (separator < 1) return null;
  const namespace = prefixes[value.slice(0, separator)];
  if (namespace) return `${namespace}${value.slice(separator + 1)}`;
  return /^(?:https?:\/\/|urn:)/i.test(value) && isAbsoluteIri(value) ? value : null;
}

function requireCanonicalId(map: ReadonlyMap<string, CanonicalId>, key: string): CanonicalId {
  const id = map.get(key);
  if (!id) throw new TypeError(`Unknown canonical concept key ${key}.`);
  return id;
}

function addLabels(
  quads: Quad[],
  subject: NamedNode,
  predicate: string,
  labels: LocalizedLabel[],
): void {
  for (const label of [...labels].sort(labelOrder)) {
    quads.push(
      quad(
        subject,
        namedNode(predicate),
        label.language ? literal(label.value, label.language) : literal(label.value),
      ),
    );
  }
}

function normalizedLabels(
  quads: Quad[],
  sourceIri: string,
  predicate: string,
  recordLoss: (loss: LossRecord) => void,
  onePerLanguage = true,
): LocalizedLabel[] {
  const labels = quads
    .flatMap((item): LocalizedLabel[] => {
      if (
        item.subject.value !== sourceIri ||
        item.predicate.value !== predicate ||
        item.object.termType !== 'Literal'
      ) {
        return [];
      }
      return [{ value: item.object.value, language: item.object.language.toLowerCase() || null }];
    })
    .sort(labelOrder);
  const accepted: LocalizedLabel[] = [];
  const languages = new Set<string>();
  for (const label of labels) {
    const language = label.language ?? '';
    if (label.language && !/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/.test(label.language)) {
      recordLoss(
        loss(
          'error',
          'skos.invalid_language',
          sourceIri,
          predicate,
          `Invalid language tag ${label.language}.`,
        ),
      );
      continue;
    }
    if (onePerLanguage && languages.has(language)) {
      recordLoss(
        loss(
          'error',
          'skos.duplicate_preferred_language',
          sourceIri,
          predicate,
          `More than one preferred label uses language ${language || '(untagged)'}.`,
        ),
      );
      continue;
    }
    if (
      !accepted.some(
        (existing) => existing.value === label.value && existing.language === label.language,
      )
    ) {
      accepted.push(label);
    }
    languages.add(language);
  }
  if (onePerLanguage && accepted.length === 0) {
    recordLoss(
      loss(
        'error',
        'skos.missing_preferred_label',
        sourceIri,
        predicate,
        'At least one preferred label is required.',
      ),
    );
  }
  return accepted;
}

function typedSubjects(quads: Quad[], objectIri: string): string[] {
  return sortedUnique(
    quads
      .filter(
        (item) =>
          item.predicate.value === RDF_TYPE &&
          item.object.termType === 'NamedNode' &&
          item.object.value === objectIri &&
          item.subject.termType === 'NamedNode',
      )
      .map((item) => item.subject.value),
  );
}

function namedObjects(quads: Quad[], subject: string, predicate: string): string[] {
  return sortedUnique(
    quads
      .filter(
        (item) =>
          item.subject.value === subject &&
          item.predicate.value === predicate &&
          item.object.termType === 'NamedNode',
      )
      .map((item) => item.object.value),
  );
}

function namedSubjects(quads: Quad[], predicate: string, object: string): string[] {
  return sortedUnique(
    quads
      .filter(
        (item) =>
          item.predicate.value === predicate &&
          item.object.termType === 'NamedNode' &&
          item.object.value === object &&
          item.subject.termType === 'NamedNode',
      )
      .map((item) => item.subject.value),
  );
}

function mappingObjects(quads: Quad[], subject: string): ConceptMappingContract[] {
  const mappings: ConceptMappingContract[] = [];
  for (const item of quads) {
    if (item.subject.value !== subject || item.object.termType !== 'NamedNode') continue;
    const kind = PREDICATE_TO_MAPPING.get(item.predicate.value);
    if (kind) mappings.push({ kind, targetIri: item.object.value });
  }
  return mappings.sort(mappingOrder);
}

function declaredPrefixes(turtle: string): Record<string, string> {
  const prefixes: Record<string, string> = {};
  const pattern = /(?:@prefix|PREFIX)\s+([A-Za-z][A-Za-z0-9_-]*)?:\s*<([^>]+)>/gi;
  for (const match of turtle.matchAll(pattern)) {
    const prefix = match[1] ?? '';
    const iri = match[2];
    if (prefix && iri && isAbsoluteIri(iri)) prefixes[prefix] = iri;
  }
  return Object.fromEntries(
    Object.entries(prefixes).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function acceptedRelationIds(
  sourceIri: string,
  targets: string[],
  idByIri: ReadonlyMap<string, CanonicalId>,
  construct: string,
  recordLoss: (loss: LossRecord) => void,
): CanonicalId[] {
  const ids: CanonicalId[] = [];
  for (const target of targets) {
    const id = idByIri.get(target);
    if (id) ids.push(id);
    else
      recordLoss(
        loss(
          'warning',
          'skos.unselected_relation_target',
          sourceIri,
          construct,
          `Relation target ${target} was not accepted.`,
        ),
      );
  }
  return sortedUnique(ids);
}

function endWriter(writer: Writer): Promise<string> {
  return new Promise((resolve, reject) => {
    writer.end((error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

function dedupeQuads(quads: Quad[]): Quad[] {
  const seen = new Set<string>();
  return quads.filter((item) => {
    const key = [
      item.subject.termType,
      item.subject.value,
      item.predicate.value,
      item.object.termType,
      item.object.value,
      item.object.termType === 'Literal' ? item.object.language : '',
      item.object.termType === 'Literal' ? item.object.datatype.value : '',
    ].join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stableIriHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function requireIri(map: ReadonlyMap<string, string>, id: string): string {
  const iri = map.get(id);
  if (!iri) throw new TypeError(`Unknown concept identifier ${id}.`);
  return iri;
}

function displayLabel(labels: LocalizedLabel[], fallback: string): string {
  return labels.find((label) => label.language === 'en')?.value ?? labels[0]?.value ?? fallback;
}

function mappingOrder(left: ConceptMappingContract, right: ConceptMappingContract): number {
  return left.kind.localeCompare(right.kind) || left.targetIri.localeCompare(right.targetIri);
}

function labelOrder(left: LocalizedLabel, right: LocalizedLabel): number {
  return (
    (left.language ?? '').localeCompare(right.language ?? '') ||
    left.value.localeCompare(right.value)
  );
}

function sortedUnique<T extends string>(values: ReadonlyArray<T>): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
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

function isAbsoluteIri(value: string): boolean {
  try {
    return new URL(value).protocol.length > 1;
  } catch {
    return /^urn:[^\s]+$/i.test(value);
  }
}
