import type { Quad, Term } from '@rdfjs/types';
import { DataFactory, Parser, Store, Writer } from 'n3';
import { validateSafeRegexPattern } from '../regex-safety.ts';
import {
  type CanonicalId,
  type CanonicalInterchangeV1,
  type ConstraintContract,
  type FieldContract,
  type LossRecord,
  appendLoss,
  assertCanonicalInterchange,
  canonicalId,
  canonicalIri,
} from './interchange.ts';

const { blankNode, literal, namedNode, quad } = DataFactory;

export const SHACL_IRI = 'http://www.w3.org/ns/shacl#';
export const XSD_IRI = 'http://www.w3.org/2001/XMLSchema#';
export const RDF_IRI = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
export const MAX_SHACL_BYTES = 1_000_000;
export const MAX_SHACL_QUADS = 50_000;
export const MAX_SHACL_SHAPES = 5_000;
export const MAX_SHACL_LIST_ITEMS = 1_000;

const RDF_TYPE = `${RDF_IRI}type`;
const RDF_FIRST = `${RDF_IRI}first`;
const RDF_REST = `${RDF_IRI}rest`;
const RDF_NIL = `${RDF_IRI}nil`;
const SH_NODE_SHAPE = `${SHACL_IRI}NodeShape`;
const SH_PROPERTY_SHAPE = `${SHACL_IRI}PropertyShape`;
const SH_TARGET_CLASS = `${SHACL_IRI}targetClass`;
const SH_PROPERTY = `${SHACL_IRI}property`;
const SH_PATH = `${SHACL_IRI}path`;

const CONSTRAINT_PREDICATES = {
  min_count: `${SHACL_IRI}minCount`,
  max_count: `${SHACL_IRI}maxCount`,
  datatype: `${SHACL_IRI}datatype`,
  min_inclusive: `${SHACL_IRI}minInclusive`,
  max_inclusive: `${SHACL_IRI}maxInclusive`,
  pattern: `${SHACL_IRI}pattern`,
  enumeration: `${SHACL_IRI}in`,
} as const;

const PREDICATE_TO_CONSTRAINT = new Map<string, ConstraintContract['kind']>(
  Object.entries(CONSTRAINT_PREDICATES).map(([kind, iri]) => [
    iri,
    kind as ConstraintContract['kind'],
  ]),
);

const SUPPORTED_SHAPE_PREDICATES = new Set([
  RDF_TYPE,
  SH_TARGET_CLASS,
  SH_PROPERTY,
  SH_PATH,
  ...Object.values(CONSTRAINT_PREDICATES),
]);

export interface ShaclExportResult {
  format: 'text/turtle';
  profile: 'naklidata-shacl-2017-core-v1';
  turtle: string;
  tripleCount: number;
  losses: LossRecord[];
}

export interface ShaclAssertionProposal {
  id: CanonicalId;
  sourceShapeIri: string;
  tableId: CanonicalId;
  fieldId: CanonicalId;
  table: string;
  column: string;
  constraint: ConstraintContract;
  sql: string;
  editable: true;
  status: 'un-run';
}

export interface ShaclImportResult {
  format: 'naklidata-shacl-import';
  version: 1;
  accepted: false;
  proposals: ShaclAssertionProposal[];
  losses: LossRecord[];
  stats: { bytes: number; quads: number; nodeShapes: number; propertyShapes: number };
}

export interface ShaclAcceptedProposals {
  constraints: ConstraintContract[];
  assertions: Array<Pick<ShaclAssertionProposal, 'id' | 'table' | 'column' | 'sql' | 'status'>>;
}

export interface ShaclViolation {
  constraintId: CanonicalId;
  tableId: CanonicalId;
  fieldId: CanonicalId;
  rowIndex: number;
  /** Stable diagnostic correlation only; source values never enter the report. */
  valueFingerprint: string;
}

export interface ShaclEvaluationResult {
  conforms: boolean;
  violations: ShaclViolation[];
}

export async function exportShaclTurtle(
  document: CanonicalInterchangeV1,
): Promise<ShaclExportResult> {
  assertCanonicalInterchange(document);
  let losses = [...document.losses];
  const writer = new Writer({
    prefixes: {
      shape: `${document.namespace.baseIri}shape/`,
      nd: document.namespace.prefixes.nd,
      rdf: RDF_IRI,
      sh: SHACL_IRI,
      xsd: XSD_IRI,
    },
  });
  const quads: Quad[] = [];
  const tableById = new Map(document.tables.map((table) => [table.id, table]));
  const fieldById = new Map(document.fields.map((field) => [field.id, field]));
  const shapeByTable = new Map<CanonicalId, string>();

  for (const constraint of [...document.constraints].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    const field = fieldById.get(constraint.targetId);
    if (!field) continue;
    const table = tableById.get(field.tableId);
    if (!table) continue;
    if (constraint.kind === 'datatype' && !duckDbTypeForXsd(String(constraint.value))) {
      losses = appendLoss(
        losses,
        loss(
          'warning',
          'shacl.unsupported_datatype',
          constraint.id,
          'sh:datatype',
          'Datatype is outside the supported SHACL profile.',
        ),
      );
      continue;
    }
    if (constraint.kind === 'pattern' && !validateSafeRegexPattern(String(constraint.value)).safe) {
      losses = appendLoss(
        losses,
        loss(
          'warning',
          'shacl.unsupported_pattern',
          constraint.id,
          'sh:pattern',
          'Pattern is outside the bounded regular-expression subset.',
        ),
      );
      continue;
    }
    let nodeShapeIri = shapeByTable.get(table.id);
    if (!nodeShapeIri) {
      nodeShapeIri = shapeIri(document, table.id);
      shapeByTable.set(table.id, nodeShapeIri);
      quads.push(quad(namedNode(nodeShapeIri), namedNode(RDF_TYPE), namedNode(SH_NODE_SHAPE)));
      quads.push(
        quad(
          namedNode(nodeShapeIri),
          namedNode(SH_TARGET_CLASS),
          namedNode(canonicalIri(document.namespace, table.id)),
        ),
      );
    }
    const propertyShapeIri = shapeIri(document, constraint.id);
    quads.push(quad(namedNode(nodeShapeIri), namedNode(SH_PROPERTY), namedNode(propertyShapeIri)));
    quads.push(
      quad(namedNode(propertyShapeIri), namedNode(RDF_TYPE), namedNode(SH_PROPERTY_SHAPE)),
    );
    quads.push(
      quad(
        namedNode(propertyShapeIri),
        namedNode(SH_PATH),
        namedNode(canonicalIri(document.namespace, field.id)),
      ),
    );
    addConstraintQuad(quads, propertyShapeIri, constraint);
  }
  const unique = dedupeQuads(quads);
  writer.addQuads(unique);
  return {
    format: 'text/turtle',
    profile: 'naklidata-shacl-2017-core-v1',
    turtle: await endWriter(writer),
    tripleCount: unique.length,
    losses,
  };
}

export function importShaclTurtle(
  turtle: string,
  document: CanonicalInterchangeV1,
): ShaclImportResult {
  assertCanonicalInterchange(document);
  const bytes = new TextEncoder().encode(turtle).byteLength;
  if (bytes > MAX_SHACL_BYTES) {
    throw new RangeError(`SHACL artifact exceeds ${MAX_SHACL_BYTES} bytes.`);
  }
  const quads: Quad[] = new Parser({
    baseIRI: document.namespace.baseIri,
    format: 'text/turtle',
  }).parse(turtle);
  if (quads.length > MAX_SHACL_QUADS) {
    throw new RangeError(`SHACL artifact exceeds ${MAX_SHACL_QUADS} quads.`);
  }
  const store = new Store(quads);
  const nodeShapes = typedNamedSubjects(store, SH_NODE_SHAPE);
  const propertyShapes = typedNamedSubjects(store, SH_PROPERTY_SHAPE);
  if (nodeShapes.length + propertyShapes.length > MAX_SHACL_SHAPES) {
    throw new RangeError(`SHACL artifact exceeds ${MAX_SHACL_SHAPES} shapes.`);
  }
  const tableByIri = new Map(
    document.tables.map((table) => [canonicalIri(document.namespace, table.id), table]),
  );
  const fieldByIri = new Map(
    document.fields.map((field) => [canonicalIri(document.namespace, field.id), field]),
  );
  let losses: LossRecord[] = [];
  const proposals: ShaclAssertionProposal[] = [];

  for (const nodeShapeIri of nodeShapes) {
    for (const item of store.getQuads(namedNode(nodeShapeIri), null, null, null)) {
      if (!SUPPORTED_SHAPE_PREDICATES.has(item.predicate.value)) {
        losses = appendLoss(
          losses,
          loss(
            'warning',
            'shacl.unsupported_constraint',
            nodeShapeIri,
            item.predicate.value,
            'Constraint is outside the supported SHACL Core profile.',
          ),
        );
      }
    }
    const targetIris = namedObjects(store, nodeShapeIri, SH_TARGET_CLASS);
    if (targetIris.length !== 1) {
      losses = appendLoss(
        losses,
        loss(
          'error',
          'shacl.target_class_required',
          nodeShapeIri,
          'sh:targetClass',
          'Profile requires exactly one named target class.',
        ),
      );
      continue;
    }
    const table = tableByIri.get(targetIris[0] ?? '');
    if (!table) {
      losses = appendLoss(
        losses,
        loss(
          'error',
          'shacl.unknown_target',
          nodeShapeIri,
          'sh:targetClass',
          'Target class does not identify a canonical table.',
        ),
      );
      continue;
    }
    for (const propertyShapeIri of namedObjects(store, nodeShapeIri, SH_PROPERTY)) {
      const pathIris = namedObjects(store, propertyShapeIri, SH_PATH);
      if (pathIris.length !== 1) {
        losses = appendLoss(
          losses,
          loss(
            'error',
            'shacl.direct_path_required',
            propertyShapeIri,
            'sh:path',
            'Profile requires exactly one named field path.',
          ),
        );
        continue;
      }
      const field = fieldByIri.get(pathIris[0] ?? '');
      if (!field || field.tableId !== table.id) {
        losses = appendLoss(
          losses,
          loss(
            'error',
            'shacl.unknown_path',
            propertyShapeIri,
            'sh:path',
            'Path does not identify a field owned by the target table.',
          ),
        );
        continue;
      }
      for (const item of store.getQuads(namedNode(propertyShapeIri), null, null, null)) {
        const kind = PREDICATE_TO_CONSTRAINT.get(item.predicate.value);
        if (!kind) {
          if (!SUPPORTED_SHAPE_PREDICATES.has(item.predicate.value)) {
            losses = appendLoss(
              losses,
              loss(
                'warning',
                'shacl.unsupported_constraint',
                propertyShapeIri,
                item.predicate.value,
                'Constraint is outside the supported SHACL Core profile.',
              ),
            );
          }
          continue;
        }
        const parsed = parseConstraintValue(store, kind, item.object, propertyShapeIri);
        if ('loss' in parsed) {
          losses = appendLoss(losses, parsed.loss);
          continue;
        }
        if (kind === 'pattern' && !validateSafeRegexPattern(String(parsed.value)).safe) {
          losses = appendLoss(
            losses,
            loss(
              'error',
              'shacl.unsafe_pattern',
              propertyShapeIri,
              'sh:pattern',
              'Pattern is outside the bounded regular-expression subset.',
            ),
          );
          continue;
        }
        if (kind === 'datatype' && !duckDbTypeForXsd(String(parsed.value))) {
          losses = appendLoss(
            losses,
            loss(
              'error',
              'shacl.unsupported_datatype',
              propertyShapeIri,
              'sh:datatype',
              'Datatype is outside the supported SHACL profile.',
            ),
          );
          continue;
        }
        const suffix = proposals.filter(
          (proposal) => proposal.sourceShapeIri === propertyShapeIri,
        ).length;
        const id = importedAssertionId(document, propertyShapeIri, suffix);
        const constraint: ConstraintContract = {
          id,
          targetId: field.id,
          kind,
          value: parsed.value,
          execution: 'explicit',
        };
        proposals.push({
          id,
          sourceShapeIri: propertyShapeIri,
          tableId: table.id,
          fieldId: field.id,
          table: table.name,
          column: field.name,
          constraint,
          sql: compileConstraintSql(table.name, field, constraint),
          editable: true,
          status: 'un-run',
        });
      }
    }
  }
  return {
    format: 'naklidata-shacl-import',
    version: 1,
    accepted: false,
    proposals,
    losses,
    stats: {
      bytes,
      quads: quads.length,
      nodeShapes: nodeShapes.length,
      propertyShapes: propertyShapes.length,
    },
  };
}

/**
 * Copies only the proposals named by the user. The import result and canonical
 * document remain unchanged; callers still decide whether and when to run SQL.
 */
export function acceptShaclProposals(
  imported: ShaclImportResult,
  selectedIds: ReadonlyArray<CanonicalId>,
): ShaclAcceptedProposals {
  const selected = new Set(selectedIds);
  const accepted = imported.proposals.filter((proposal) => selected.has(proposal.id));
  return {
    constraints: accepted.map((proposal) => structuredClone(proposal.constraint)),
    assertions: accepted.map(({ id, table, column, sql, status }) => ({
      id,
      table,
      column,
      sql,
      status,
    })),
  };
}

export function evaluateShaclRows(
  document: CanonicalInterchangeV1,
  tableId: CanonicalId,
  rows: ReadonlyArray<Record<string, unknown>>,
): ShaclEvaluationResult {
  assertCanonicalInterchange(document);
  const fields = new Map(
    document.fields.filter((field) => field.tableId === tableId).map((field) => [field.id, field]),
  );
  const constraints = document.constraints.filter((constraint) => fields.has(constraint.targetId));
  const violations: ShaclViolation[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    for (const constraint of constraints) {
      const field = fields.get(constraint.targetId);
      if (!field) continue;
      const value = row[field.name];
      if (!violates(value, constraint)) continue;
      violations.push({
        constraintId: constraint.id,
        tableId,
        fieldId: field.id,
        rowIndex,
        valueFingerprint: valueFingerprint(value),
      });
    }
  }
  return { conforms: violations.length === 0, violations };
}

export async function projectRowsToRdfTurtle(
  document: CanonicalInterchangeV1,
  tableId: CanonicalId,
  rows: ReadonlyArray<Record<string, unknown>>,
): Promise<string> {
  assertCanonicalInterchange(document);
  const table = document.tables.find((item) => item.id === tableId);
  if (!table) throw new TypeError(`Unknown table ${tableId}.`);
  const fields = document.fields.filter((field) => field.tableId === tableId);
  const quads: Quad[] = [];
  for (const [index, row] of rows.entries()) {
    const subject = namedNode(
      `${document.namespace.baseIri}row/${encodeURIComponent(table.id)}/${index}`,
    );
    quads.push(
      quad(subject, namedNode(RDF_TYPE), namedNode(canonicalIri(document.namespace, table.id))),
    );
    for (const field of fields) {
      const raw = row[field.name];
      const values = Array.isArray(raw) ? raw : [raw];
      for (const value of values) {
        if (value === null || value === undefined) continue;
        quads.push(
          quad(
            subject,
            namedNode(canonicalIri(document.namespace, field.id)),
            rdfLiteral(value, field.dataType),
          ),
        );
      }
    }
  }
  const writer = new Writer({ prefixes: { rdf: RDF_IRI, xsd: XSD_IRI } });
  writer.addQuads(quads);
  return endWriter(writer);
}

function addConstraintQuad(
  quads: Quad[],
  propertyShapeIri: string,
  constraint: ConstraintContract,
): void {
  const subject = namedNode(propertyShapeIri);
  const predicate = namedNode(CONSTRAINT_PREDICATES[constraint.kind]);
  if (constraint.kind === 'datatype') {
    quads.push(quad(subject, predicate, namedNode(String(constraint.value))));
  } else if (constraint.kind === 'min_count' || constraint.kind === 'max_count') {
    quads.push(
      quad(subject, predicate, literal(String(constraint.value), namedNode(`${XSD_IRI}integer`))),
    );
  } else if (constraint.kind === 'min_inclusive' || constraint.kind === 'max_inclusive') {
    quads.push(
      quad(subject, predicate, literal(String(constraint.value), namedNode(`${XSD_IRI}double`))),
    );
  } else if (constraint.kind === 'pattern') {
    quads.push(quad(subject, predicate, literal(String(constraint.value))));
  } else {
    const values = constraint.value as string[];
    const head = values.length
      ? blankNode(`list_${stableHash(constraint.id)}_0`)
      : namedNode(RDF_NIL);
    quads.push(quad(subject, predicate, head));
    for (const [index, value] of values.entries()) {
      const node = blankNode(`list_${stableHash(constraint.id)}_${index}`);
      const rest =
        index === values.length - 1
          ? namedNode(RDF_NIL)
          : blankNode(`list_${stableHash(constraint.id)}_${index + 1}`);
      quads.push(quad(node, namedNode(RDF_FIRST), literal(value)));
      quads.push(quad(node, namedNode(RDF_REST), rest));
    }
  }
}

function parseConstraintValue(
  store: Store,
  kind: ConstraintContract['kind'],
  object: Term,
  path: string,
): { value: ConstraintContract['value'] } | { loss: LossRecord } {
  if (kind === 'datatype') {
    return object.termType === 'NamedNode'
      ? { value: object.value }
      : {
          loss: loss(
            'error',
            'shacl.datatype_iri_required',
            path,
            'sh:datatype',
            'Datatype must be a named IRI.',
          ),
        };
  }
  if (kind === 'enumeration') {
    try {
      return { value: readStringList(store, object) };
    } catch (error) {
      return { loss: loss('error', 'shacl.invalid_list', path, 'sh:in', errorMessage(error)) };
    }
  }
  if (object.termType !== 'Literal') {
    return {
      loss: loss(
        'error',
        'shacl.literal_required',
        path,
        CONSTRAINT_PREDICATES[kind],
        'Constraint value must be a literal.',
      ),
    };
  }
  if (kind === 'pattern') return { value: object.value };
  const number = Number(object.value);
  if (!Number.isFinite(number)) {
    return {
      loss: loss(
        'error',
        'shacl.number_required',
        path,
        CONSTRAINT_PREDICATES[kind],
        'Constraint value must be finite.',
      ),
    };
  }
  if ((kind === 'min_count' || kind === 'max_count') && (!Number.isInteger(number) || number < 0)) {
    return {
      loss: loss(
        'error',
        'shacl.count_required',
        path,
        CONSTRAINT_PREDICATES[kind],
        'Count must be a non-negative integer.',
      ),
    };
  }
  return { value: number };
}

function readStringList(store: Store, head: Term): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  let current = head;
  while (!(current.termType === 'NamedNode' && current.value === RDF_NIL)) {
    if (current.termType !== 'BlankNode')
      throw new TypeError('Enumeration list must use blank nodes.');
    if (seen.has(current.value)) throw new TypeError('Enumeration list contains a cycle.');
    if (values.length >= MAX_SHACL_LIST_ITEMS) {
      throw new RangeError(`Enumeration exceeds ${MAX_SHACL_LIST_ITEMS} values.`);
    }
    seen.add(current.value);
    const first = store.getQuads(current, namedNode(RDF_FIRST), null, null);
    const rest = store.getQuads(current, namedNode(RDF_REST), null, null);
    if (first.length !== 1 || first[0]?.object.termType !== 'Literal' || rest.length !== 1) {
      throw new TypeError('Enumeration list is malformed.');
    }
    values.push(first[0].object.value);
    const next = rest[0]?.object;
    if (!next) throw new TypeError('Enumeration list is missing rdf:rest.');
    current = next;
  }
  if (values.length === 0) throw new TypeError('Enumeration list is empty.');
  return values;
}

function compileConstraintSql(
  table: string,
  field: FieldContract,
  constraint: ConstraintContract,
): string {
  const tableSql = quoteIdentifier(table);
  const columnSql = quoteIdentifier(field.name);
  const cardinality = `CASE WHEN ${columnSql} IS NULL THEN 0 ELSE 1 END`;
  let condition: string;
  if (constraint.kind === 'min_count') condition = `${cardinality} < ${constraint.value}`;
  else if (constraint.kind === 'max_count') condition = `${cardinality} > ${constraint.value}`;
  else if (constraint.kind === 'min_inclusive') condition = `${columnSql} < ${constraint.value}`;
  else if (constraint.kind === 'max_inclusive') condition = `${columnSql} > ${constraint.value}`;
  else if (constraint.kind === 'pattern') {
    condition = `NOT regexp_matches(CAST(${columnSql} AS VARCHAR), ${sqlString(String(constraint.value))})`;
  } else if (constraint.kind === 'enumeration') {
    const values = (constraint.value as string[]).map(sqlString).join(', ');
    condition = `CAST(${columnSql} AS VARCHAR) NOT IN (${values})`;
  } else {
    const cast = duckDbTypeForXsd(String(constraint.value));
    condition = cast
      ? `TRY_CAST(${columnSql} AS ${cast}) IS NULL`
      : 'FALSE /* datatype requires metadata review */';
  }
  return `-- naklidata-shacl: ${JSON.stringify(constraint)}\nSELECT *\nFROM ${tableSql}\nWHERE ${columnSql} IS NOT NULL AND (${condition})\nLIMIT 100`;
}

function violates(value: unknown, constraint: ConstraintContract): boolean {
  const values = Array.isArray(value)
    ? value.filter((item) => item !== null && item !== undefined)
    : value === null || value === undefined
      ? []
      : [value];
  if (constraint.kind === 'min_count') return values.length < Number(constraint.value);
  if (constraint.kind === 'max_count') return values.length > Number(constraint.value);
  if (values.length === 0) return false;
  return values.some((item) => {
    if (constraint.kind === 'datatype') return !matchesDatatype(item, String(constraint.value));
    if (constraint.kind === 'min_inclusive')
      return typeof item !== 'number' || item < Number(constraint.value);
    if (constraint.kind === 'max_inclusive')
      return typeof item !== 'number' || item > Number(constraint.value);
    if (constraint.kind === 'pattern')
      return typeof item !== 'string' || !new RegExp(String(constraint.value), 'u').test(item);
    return !(constraint.value as string[]).includes(String(item));
  });
}

function matchesDatatype(value: unknown, datatype: string): boolean {
  if (datatype === `${XSD_IRI}string`) return typeof value === 'string';
  if (datatype === `${XSD_IRI}boolean`) return typeof value === 'boolean';
  if ([`${XSD_IRI}integer`, `${XSD_IRI}decimal`, `${XSD_IRI}double`].includes(datatype)) {
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      (datatype !== `${XSD_IRI}integer` || Number.isInteger(value))
    );
  }
  if (datatype === `${XSD_IRI}date`)
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (datatype === `${XSD_IRI}dateTime`)
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
  return false;
}

function rdfLiteral(value: unknown, dataType: string): ReturnType<typeof literal> {
  if (typeof value === 'boolean') return literal(String(value), namedNode(`${XSD_IRI}boolean`));
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? literal(String(value), namedNode(`${XSD_IRI}integer`))
      : literal(String(value), namedNode(`${XSD_IRI}double`));
  }
  const upper = dataType.toUpperCase();
  if (upper === 'DATE') return literal(String(value), namedNode(`${XSD_IRI}date`));
  if (upper.includes('TIMESTAMP')) return literal(String(value), namedNode(`${XSD_IRI}dateTime`));
  return literal(String(value));
}

function duckDbTypeForXsd(datatype: string): string | null {
  if (datatype === `${XSD_IRI}string`) return 'VARCHAR';
  if (datatype === `${XSD_IRI}boolean`) return 'BOOLEAN';
  if (datatype === `${XSD_IRI}integer`) return 'BIGINT';
  if (datatype === `${XSD_IRI}decimal` || datatype === `${XSD_IRI}double`) return 'DOUBLE';
  if (datatype === `${XSD_IRI}date`) return 'DATE';
  if (datatype === `${XSD_IRI}dateTime`) return 'TIMESTAMP';
  return null;
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

function importedAssertionId(
  document: CanonicalInterchangeV1,
  shape: string,
  suffix: number,
): CanonicalId {
  const prefix = `${document.namespace.baseIri}shape/`;
  if (shape.startsWith(prefix)) {
    const decoded = decodeURIComponent(shape.slice(prefix.length));
    if (/^nd:assertion:/.test(decoded) && suffix === 0) return decoded as CanonicalId;
  }
  return canonicalId('assertion', `shacl-import-${stableHash(`${shape}:${suffix}`)}`);
}

function shapeIri(document: CanonicalInterchangeV1, id: CanonicalId): string {
  return `${document.namespace.baseIri}shape/${encodeURIComponent(id)}`;
}

function valueFingerprint(value: unknown): string {
  return `fnv64-${stableHash(JSON.stringify(value))}`;
}

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function dedupeQuads(quads: Quad[]): Quad[] {
  const seen = new Set<string>();
  return quads.filter((item) => {
    const objectSuffix =
      item.object.termType === 'Literal'
        ? `\u0000${item.object.language}\u0000${item.object.datatype.value}`
        : '';
    const key = `${item.subject.value}\u0000${item.predicate.value}\u0000${item.object.termType}\u0000${item.object.value}${objectSuffix}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortedUnique<T extends string>(values: ReadonlyArray<T>): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
