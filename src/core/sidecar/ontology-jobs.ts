import { validateSafeRegexPattern } from '../regex-safety.ts';
// Ontology sidecar jobs (Wave 7) — assign-type (Job 9) + nl-to-schema
// (Job 10). Split out of client.ts so their prompts/parsers ship in the
// lazy `sidecar-ontology` chunk, not the inlined shell (spec §7.1 / A35):
// both jobs are user-triggered (schema-panel "Ask AI to classify" and the
// notebook "Infer schema" modal), so paying for their code only on first
// use is free. The builders/parsers are exported + unit/eval-tested
// directly; runtime dispatch goes through `dispatchOntologyJob`, which
// reuses client.ts's shared key-resolution + transport via `sendPrompt`.
import { type SidecarDispatchOpts, prepareCloudDispatch, sendPrompt } from './client.ts';
import { parseFirstJsonObject } from './response-json.ts';
import {
  type AssignTypeJob,
  type AssignTypeResponse,
  type NlToSchemaColumn,
  type NlToSchemaJob,
  type NlToSchemaResponse,
  SidecarError,
} from './types.ts';

// ---- assign-type (Job 9 / Wave 7 W7.1) prompt + parser --------------
//
// Same one-token contract as disambiguate-type, but the model picks
// from the WHOLE taxonomy vocabulary rather than a column's existing
// candidate list. Used on `unknown` columns the deterministic detectors
// couldn't place. The parser validates the returned id against the
// catalog (case-insensitive) and coerces anything else to null.

const ASSIGN_TYPE_SYSTEM = `You are NakliData's sidecar assigning a semantic type to a single column the deterministic classifier could not place.

You are given the column header, its SQL type, sample values, and the full catalog of known semantic types. Pick the ONE type that best fits, or \`unknown\` if none clearly fits.

Hard rules:
- Output ONLY one token: either the chosen typeId from the catalog, or the literal word \`unknown\`.
- Do NOT output prose, code fences, JSON, quotes, or any other characters.
- Prefer \`unknown\` over a weak guess. A wrong confident assignment is worse than leaving the column unknown.
- Never invent a typeId that isn't in the catalog.`;

// The 0.5B browser model can execute compact classification prompts on
// WebGPU, while a 232-type prompt exceeds the current runtime's reliable
// prefill shape on physical Chrome. Evaluate the entire catalog in bounded
// groups, then adjudicate only the surviving candidates. Cloud providers keep
// the single-request path because their runtimes do not share this browser
// memory constraint.
const LOCAL_ASSIGN_CATALOG_BATCH = 16;

export function buildAssignTypePrompt(job: AssignTypeJob): {
  system: string;
  user: string;
} {
  // Group the catalog by domain so the model sees structure, but keep
  // it compact — one line per type.
  const catalogBlock = job.catalog
    .map((c) => `- ${c.typeId} (${c.displayName}) [${c.domain}]`)
    .join('\n');
  const samplesBlock = job.samples.slice(0, 20).join('\n');
  const user = [
    `Column header: ${job.columnName}`,
    `SQL type: ${job.sqlType}`,
    '',
    'Catalog (output one of these typeIds, or `unknown`):',
    catalogBlock,
    '',
    'Sample values:',
    samplesBlock,
  ].join('\n');
  return { system: ASSIGN_TYPE_SYSTEM, user };
}

export function parseAssignTypeResponse(
  raw: string,
  catalog: AssignTypeJob['catalog'],
  samples: string[] = [],
): AssignTypeResponse {
  // Identical cleaning to disambiguate-type — strip fences / quotes /
  // trailing punctuation a model might wrap the single token in.
  const cleaned = raw
    .trim()
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/^["'`]|["'`.]$/g, '')
    .trim();
  if (cleaned.toLowerCase() === 'unknown' || cleaned === '') {
    return { kind: 'assign-type', typeId: null };
  }
  const match = catalog.find((c) => c.typeId.toLowerCase() === cleaned.toLowerCase());
  if (match) {
    if (match.valuePattern && samples.length > 0) {
      try {
        if (!validateSafeRegexPattern(match.valuePattern).safe) {
          return { kind: 'assign-type', typeId: null };
        }
        const regex = new RegExp(match.valuePattern);
        if (!samples.every((sample) => regex.test(sample))) {
          return { kind: 'assign-type', typeId: null };
        }
      } catch {
        return { kind: 'assign-type', typeId: null };
      }
    }
    return { kind: 'assign-type', typeId: match.typeId };
  }
  // Id not in the catalog — coerce to unknown (hallucination guard).
  return { kind: 'assign-type', typeId: null };
}

// ---- nl-to-schema (Job 10 / Wave 7 W7.2) prompt + parser -------------
//
// Describe a dataset in plain English → a typed schema. Every value
// the model returns is sanitised or allowlisted:
//   - column / table names → safe snake_case identifiers (bad → dropped
//     / defaulted). Prevents a malicious name from poisoning the DDL.
//   - sqlType → validated against a DuckDB type allowlist (unknown →
//     VARCHAR). Keeps the generated CREATE TABLE valid + free of
//     arbitrary type expressions.
//   - semanticTypeId → must be in knownTypes (else null). Same
//     hallucination guard as every other typed job.
// An empty surviving column set === rejected response.

// Base DuckDB type words we'll accept. We keep the model's full type
// string (so DECIMAL(10,2) / TIMESTAMP WITH TIME ZONE survive) when its
// LEADING word is in this set; otherwise we coerce to VARCHAR.
const ALLOWED_SQL_TYPE_WORDS = new Set([
  'VARCHAR',
  'TEXT',
  'CHAR',
  'STRING',
  'BOOLEAN',
  'BOOL',
  'TINYINT',
  'SMALLINT',
  'INTEGER',
  'INT',
  'BIGINT',
  'HUGEINT',
  'UTINYINT',
  'USMALLINT',
  'UINTEGER',
  'UBIGINT',
  'FLOAT',
  'REAL',
  'DOUBLE',
  'DECIMAL',
  'NUMERIC',
  'DATE',
  'TIME',
  'TIMESTAMP',
  'DATETIME',
  'INTERVAL',
  'BLOB',
  'UUID',
  'JSON',
]);

// Sanity cap — a plain-English description shouldn't yield a 200-column
// monster; if it does, something went wrong and we'd blow the prompt /
// DDL budget. Keep the first N.
const NL_TO_SCHEMA_MAX_COLUMNS = 60;

/** Lowercase snake_case-ish identifier, or '' if nothing usable remains. */
function sanitiseIdentifier(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^([0-9])/, '_$1'); // identifiers can't start with a digit
}

/** Keep the model's type string when its leading word is allowlisted; else VARCHAR. */
function normaliseSqlType(raw: string): string {
  const trimmed = raw.trim().toUpperCase();
  const lead = /^([A-Z]+)/.exec(trimmed)?.[1] ?? '';
  return lead && ALLOWED_SQL_TYPE_WORDS.has(lead) ? trimmed : 'VARCHAR';
}

const NL_TO_SCHEMA_SYSTEM = `You are NakliData's sidecar inferring a tabular schema from a plain-English description of a dataset.

Given the description, propose a set of columns with appropriate DuckDB SQL types, and where possible map each column to one of the KNOWN semantic types provided.

Output strictly as JSON in this shape:

{
  "table_name": "<snake_case table name>",
  "columns": [
    { "name": "<snake_case column>", "sql_type": "<DuckDB type>", "semantic_type_id": "<known type id or null>", "description": "<short note>" }
  ]
}

Hard rules:
- Output ONLY the JSON object. No markdown code fences. No commentary outside the JSON.
- "name" and "table_name" are snake_case (lowercase letters, digits, underscores; start with a letter).
- "sql_type" must be a real DuckDB type (VARCHAR, BIGINT, INTEGER, DOUBLE, DECIMAL(10,2), BOOLEAN, DATE, TIMESTAMP, etc.). Default to VARCHAR when unsure.
- "semantic_type_id" must be one of the known type ids listed below, or null. NEVER invent a semantic type id.
- "description" is a short plain-text note (no markdown), or "".
- Propose a focused, realistic set of columns (typically 4–15). Do not pad.`;

const LOCAL_NL_TO_SCHEMA_SYSTEM = `Infer a compact tabular schema from the user's dataset description.

Output ONLY this compact JSON shape on one line:
{"t":"table_name","c":[["column_name","DUCKDB_TYPE","known_semantic_type_id_or_null"]]}

Hard rules:
- Output one JSON object only. No prose, markdown, comments, or extra keys.
- t and every column name use snake_case and start with a letter.
- Every c item has exactly three values in this order: column name, DuckDB SQL type, semantic type id.
- The second value must be one of VARCHAR, BIGINT, DOUBLE, BOOLEAN, DATE, TIMESTAMP, or DECIMAL(18,2).
- The third value must be one listed semantic type id or the JSON literal null.
- Use JSON null. Never use None, "NULL", or an omitted third value.
- Use VARCHAR when the SQL type is uncertain.
- Use null when no listed semantic type clearly fits.
- Propose 4–12 useful columns. Do not emit descriptions.

Tuple example: ["customer_email","VARCHAR","email"]
Null example: ["ticket_number","VARCHAR",null]`;

export function buildNlToSchemaPrompt(job: NlToSchemaJob): {
  system: string;
  user: string;
} {
  const knownBlock = job.knownTypes.length
    ? job.knownTypes.map((t) => `- ${t.typeId} (${t.displayName})`).join('\n')
    : '(no known semantic types — set every semantic_type_id to null)';
  const sections = [`Dataset description: ${job.description.trim()}`];
  if (job.tableName?.trim()) {
    sections.push(`Suggested table name: ${job.tableName.trim()}`);
  }
  sections.push('', 'Known semantic types (map columns to these ids, or null):', knownBlock);
  return { system: NL_TO_SCHEMA_SYSTEM, user: sections.join('\n') };
}

/**
 * Compact product contract for small in-browser generators. It removes the
 * repeated verbose object keys and free-text descriptions that caused the
 * physical 0.5B model to exhaust its response budget. Cloud providers retain
 * `buildNlToSchemaPrompt` and its richer description field.
 */
export function buildLocalNlToSchemaPrompt(job: NlToSchemaJob): {
  system: string;
  user: string;
} {
  const knownBlock = job.knownTypes.length
    ? job.knownTypes.map((type) => `${type.typeId}=${type.displayName}`).join('\n')
    : '(none; use null for every semantic type)';
  const sections = [`Description: ${job.description.trim()}`];
  if (job.tableName?.trim()) sections.push(`Table hint: ${job.tableName.trim()}`);
  sections.push('', 'Allowed semantic types:', knownBlock);
  return { system: LOCAL_NL_TO_SCHEMA_SYSTEM, user: sections.join('\n') };
}

export function parseNlToSchemaResponse(raw: string, knownTypeIds: string[]): NlToSchemaResponse {
  let parsed: { table_name?: unknown; columns?: unknown };
  try {
    parsed = parseFirstJsonObject(raw) as typeof parsed;
  } catch (err) {
    throw new SidecarError(
      `Could not parse sidecar response as JSON: ${err instanceof Error ? err.message : String(err)}`,
      'parse',
    );
  }
  if (!Array.isArray(parsed.columns)) {
    throw new SidecarError('Sidecar response missing "columns" array.', 'parse');
  }
  const allowedTypes = new Set(knownTypeIds.map((t) => t.toLowerCase()));
  const seen = new Set<string>();
  const columns: NlToSchemaColumn[] = [];
  for (const item of parsed.columns) {
    if (columns.length >= NL_TO_SCHEMA_MAX_COLUMNS) break;
    if (typeof item !== 'object' || item === null) continue;
    const col = item as {
      name?: unknown;
      sql_type?: unknown;
      semantic_type_id?: unknown;
      description?: unknown;
    };
    const name = sanitiseIdentifier(typeof col.name === 'string' ? col.name : '');
    if (!name || seen.has(name)) continue; // drop unnamed / duplicate columns
    seen.add(name);
    const sqlType = normaliseSqlType(typeof col.sql_type === 'string' ? col.sql_type : '');
    // Map semantic type only when it's a known id (case-insensitive),
    // resolving back to the catalog's canonical casing.
    let semanticTypeId: string | null = null;
    if (typeof col.semantic_type_id === 'string') {
      const want = col.semantic_type_id.trim().toLowerCase();
      if (want && want !== 'null' && allowedTypes.has(want)) {
        semanticTypeId = knownTypeIds.find((t) => t.toLowerCase() === want) ?? null;
      }
    }
    const description =
      typeof col.description === 'string' ? col.description.trim().replace(/\s+/g, ' ') : '';
    columns.push({ name, sqlType, semanticTypeId, description });
  }
  if (columns.length === 0) {
    // Nothing usable — signal rejection to the caller.
    return { kind: 'nl-to-schema', tableName: '', columns: [] };
  }
  const tableName =
    sanitiseIdentifier(typeof parsed.table_name === 'string' ? parsed.table_name : '') ||
    'new_dataset';
  return { kind: 'nl-to-schema', tableName, columns };
}

/** Parse the compact local tuple contract through the canonical guards. */
export function parseLocalNlToSchemaResponse(
  raw: string,
  knownTypeIds: string[],
): NlToSchemaResponse {
  let parsed: { t?: unknown; c?: unknown };
  try {
    parsed = parseFirstJsonObject(raw) as typeof parsed;
  } catch (err) {
    throw new SidecarError(
      `Could not parse local sidecar response as JSON: ${err instanceof Error ? err.message : String(err)}`,
      'parse',
    );
  }
  if (!Array.isArray(parsed.c)) {
    throw new SidecarError('Local sidecar response missing compact "c" array.', 'parse');
  }
  const columns = parsed.c.map((item) => {
    if (!Array.isArray(item)) return {};
    return {
      name: item[0],
      sql_type: item[1],
      semantic_type_id: item[2] ?? null,
      description: '',
    };
  });
  return parseNlToSchemaResponse(JSON.stringify({ table_name: parsed.t, columns }), knownTypeIds);
}

/**
 * Build a DuckDB CREATE TABLE statement from an inferred schema. Pure +
 * exported so the modal and tests share one source of truth. Identifiers
 * are double-quoted (they're already sanitised to snake_case, but
 * quoting is correct + defensive). The generated DDL is dropped into an
 * UN-RUN cell — never auto-executed (Hard NOT #4).
 */
export function buildCreateTableDdl(schema: NlToSchemaResponse): string {
  if (!schema.tableName || schema.columns.length === 0) return '';
  const cols = schema.columns
    .map((c) => {
      const comment = c.semanticTypeId
        ? `  -- ${c.semanticTypeId}${c.description ? `: ${c.description}` : ''}`
        : c.description
          ? `  -- ${c.description}`
          : '';
      return `  "${c.name}" ${c.sqlType},${comment}`;
    })
    .join('\n')
    // Drop the trailing comma on the last column line (before any comment).
    .replace(/,(\s*--[^\n]*)?$/, '$1');
  return `CREATE TABLE "${schema.tableName}" (\n${cols}\n);`;
}

/**
 * Runtime dispatch for the two ontology jobs. Mirrors dispatchJob's
 * build → send → parse shape, but lives off-shell. Reuses `sendPrompt`
 * (client.ts) so key-resolution + transport stay in one place.
 */
export async function dispatchOntologyJob(
  job: AssignTypeJob | NlToSchemaJob,
  opts: SidecarDispatchOpts,
): Promise<AssignTypeResponse | NlToSchemaResponse> {
  const safeJob = (await prepareCloudDispatch(job, opts)) as AssignTypeJob | NlToSchemaJob;
  if (safeJob.kind === 'assign-type') {
    if (opts.provider === 'local' && safeJob.catalog.length > LOCAL_ASSIGN_CATALOG_BATCH) {
      const candidates: AssignTypeJob['catalog'] = [];
      for (let start = 0; start < safeJob.catalog.length; start += LOCAL_ASSIGN_CATALOG_BATCH) {
        const catalog = safeJob.catalog.slice(start, start + LOCAL_ASSIGN_CATALOG_BATCH);
        const chunkJob: AssignTypeJob = { ...safeJob, catalog };
        const { system, user } = buildAssignTypePrompt(chunkJob);
        const response = parseAssignTypeResponse(
          await sendPrompt(system, user, opts, 32),
          catalog,
          safeJob.samples,
        );
        if (response.typeId !== null) {
          const candidate = catalog.find((entry) => entry.typeId === response.typeId);
          if (candidate) candidates.push(candidate);
        }
      }
      if (candidates.length === 0) return { kind: 'assign-type', typeId: null };
      if (candidates.length === 1) {
        return { kind: 'assign-type', typeId: candidates[0]?.typeId ?? null };
      }
      const finalJob: AssignTypeJob = { ...safeJob, catalog: candidates };
      const { system, user } = buildAssignTypePrompt(finalJob);
      return parseAssignTypeResponse(
        await sendPrompt(system, user, opts, 32),
        candidates,
        safeJob.samples,
      );
    }
    const { system, user } = buildAssignTypePrompt(safeJob);
    return parseAssignTypeResponse(
      await sendPrompt(system, user, opts, 32),
      safeJob.catalog,
      safeJob.samples,
    );
  }
  const knownTypeIds = safeJob.knownTypes.map((type) => type.typeId);
  if (opts.provider === 'local') {
    const { system, user } = buildLocalNlToSchemaPrompt(safeJob);
    return parseLocalNlToSchemaResponse(await sendPrompt(system, user, opts, 384), knownTypeIds);
  }
  const { system, user } = buildNlToSchemaPrompt(safeJob);
  return parseNlToSchemaResponse(await sendPrompt(system, user, opts), knownTypeIds);
}
