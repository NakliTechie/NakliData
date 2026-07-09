// Top-level sidecar client — picks the configured provider, loads the
// stored key, builds the prompt for the requested job, calls the
// provider, parses the response into the job's structured shape.
//
// Tests substitute the provider call via the `transport` option so
// unit tests don't need real API access.

import { loadKey } from './byok.ts';
import { getLocalGenerator } from './local-runtime.ts';
import { callAnthropic } from './providers/anthropic.ts';
import { callCustomOpenAI } from './providers/custom-openai.ts';
import { callOpenAI } from './providers/openai.ts';
import {
  type DefineTypeJob,
  type DefineTypeResponse,
  type DisambiguateTypeJob,
  type DisambiguateTypeResponse,
  type ExplainErrorJob,
  type ExplainErrorResponse,
  type NlToSqlJob,
  type NlToSqlResponse,
  type ProposeChartJob,
  type ProposeChartResponse,
  type ProposeMergeJob,
  type ProposeMergeResponse,
  type RecommendReportsJob,
  type RecommendReportsResponse,
  SidecarError,
  type SidecarJob,
  type SidecarProvider,
  type SidecarResponse,
  type SummariseResultJob,
  type SummariseResultResponse,
} from './types.ts';

export interface SidecarDispatchOpts {
  provider: SidecarProvider;
  model: string;
  signal?: AbortSignal;
  /**
   * Required when `provider === 'custom'`. The OpenAI-compatible base
   * URL the custom transport posts to. Ignored for other providers.
   */
  customEndpoint?: string;
  /** Override the provider transport — used by tests to stub fetch. */
  transport?: SidecarTransport;
}

export interface SidecarTransportRequest {
  provider: SidecarProvider;
  model: string;
  system: string;
  user: string;
  apiKey: string;
  /** Set when `provider === 'custom'`. */
  endpointUrl?: string;
  signal?: AbortSignal;
}

export type SidecarTransport = (req: SidecarTransportRequest) => Promise<string>;

const defaultTransport: SidecarTransport = (req) => {
  if (req.provider === 'anthropic') {
    return callAnthropic({
      apiKey: req.apiKey,
      model: req.model,
      system: req.system,
      user: req.user,
      ...(req.signal ? { signal: req.signal } : {}),
    });
  }
  if (req.provider === 'custom') {
    return callCustomOpenAI({
      endpointUrl: req.endpointUrl ?? '',
      apiKey: req.apiKey,
      model: req.model,
      system: req.system,
      user: req.user,
      ...(req.signal ? { signal: req.signal } : {}),
    });
  }
  if (req.provider === 'local') {
    const generate = getLocalGenerator();
    if (!generate) {
      // Privacy-first: do NOT silently fall back to a cloud provider —
      // picking 'local' is a "my data stays in the tab" choice. Surface
      // an actionable error instead. (DECISIONS 2026-05-24 22:30.)
      throw new SidecarError(
        'Local model is not loaded yet. Download it under Settings → AI sidecar, or switch to a cloud provider.',
        'no-provider',
      );
    }
    return generate({
      model: req.model,
      system: req.system,
      user: req.user,
      ...(req.signal ? { signal: req.signal } : {}),
    });
  }
  if (req.provider === 'openai') {
    return callOpenAI({
      apiKey: req.apiKey,
      model: req.model,
      system: req.system,
      user: req.user,
      ...(req.signal ? { signal: req.signal } : {}),
    });
  }
  // Defence-in-depth: refuse to silently route an unknown provider to
  // OpenAI. Corrupted settings (`provider: 'evil'`) would otherwise
  // ship the user's OpenAI key + prompt to api.openai.com. Throw
  // explicitly so a typo / settings-migration bug surfaces loudly.
  // (Forward-pass L4, 2026-06-02.)
  throw new SidecarError(
    `Unsupported sidecar provider: ${String(req.provider)}. Reset Settings → AI sidecar.`,
    'no-provider',
  );
};

export async function dispatchJob(
  job: SidecarJob,
  opts: SidecarDispatchOpts,
): Promise<SidecarResponse> {
  // The 'local' provider runs in-browser — no API key. W6: the 'custom'
  // (OpenAI-compatible) provider may point at an UNAUTHENTICATED endpoint
  // (self-hosted Ollama / vLLM / LM Studio), so its key is optional — an empty
  // key means "send no Authorization header" rather than forcing the user to
  // store a junk placeholder. Anthropic/OpenAI still require a real key.
  let key = '';
  if (opts.provider !== 'local') {
    const loaded = await loadKey(opts.provider);
    if (!loaded && opts.provider !== 'custom') {
      throw new SidecarError(
        `No API key configured for ${opts.provider}. Open Settings to add one.`,
        'no-key',
      );
    }
    key = loaded ?? '';
  }
  const transport = opts.transport ?? defaultTransport;
  if (job.kind === 'explain-error') {
    const { system, user } = buildExplainErrorPrompt(job);
    const raw = await transport({
      provider: opts.provider,
      model: opts.model,
      system,
      user,
      apiKey: key,
      ...(opts.customEndpoint ? { endpointUrl: opts.customEndpoint } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return parseExplainErrorResponse(raw);
  }
  if (job.kind === 'disambiguate-type') {
    const { system, user } = buildDisambiguateTypePrompt(job);
    const raw = await transport({
      provider: opts.provider,
      model: opts.model,
      system,
      user,
      apiKey: key,
      ...(opts.customEndpoint ? { endpointUrl: opts.customEndpoint } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return parseDisambiguateTypeResponse(raw, job.candidates);
  }
  if (job.kind === 'define-type') {
    const { system, user } = buildDefineTypePrompt(job);
    const raw = await transport({
      provider: opts.provider,
      model: opts.model,
      system,
      user,
      apiKey: key,
      ...(opts.customEndpoint ? { endpointUrl: opts.customEndpoint } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return parseDefineTypeResponse(raw);
  }
  if (job.kind === 'recommend-reports') {
    const { system, user } = buildRecommendReportsPrompt(job);
    const raw = await transport({
      provider: opts.provider,
      model: opts.model,
      system,
      user,
      apiKey: key,
      ...(opts.customEndpoint ? { endpointUrl: opts.customEndpoint } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return parseRecommendReportsResponse(
      raw,
      job.candidates.map((c) => c.templateId),
    );
  }
  if (job.kind === 'summarise-result') {
    const { system, user } = buildSummariseResultPrompt(job);
    const raw = await transport({
      provider: opts.provider,
      model: opts.model,
      system,
      user,
      apiKey: key,
      ...(opts.customEndpoint ? { endpointUrl: opts.customEndpoint } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return parseSummariseResultResponse(raw, job.columns);
  }
  if (job.kind === 'nl-to-sql') {
    const { system, user } = buildNlToSqlPrompt(job);
    const raw = await transport({
      provider: opts.provider,
      model: opts.model,
      system,
      user,
      apiKey: key,
      ...(opts.customEndpoint ? { endpointUrl: opts.customEndpoint } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return parseNlToSqlResponse(
      raw,
      job.tables.map((t) => t.name),
    );
  }
  if (job.kind === 'propose-chart') {
    const { system, user } = buildProposeChartPrompt(job);
    const raw = await transport({
      provider: opts.provider,
      model: opts.model,
      system,
      user,
      apiKey: key,
      ...(opts.customEndpoint ? { endpointUrl: opts.customEndpoint } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return parseProposeChartResponse(
      raw,
      job.columns.map((c) => c.name),
    );
  }
  if (job.kind === 'propose-merge') {
    const { system, user } = buildProposeMergePrompt(job);
    const raw = await transport({
      provider: opts.provider,
      model: opts.model,
      system,
      user,
      apiKey: key,
      ...(opts.customEndpoint ? { endpointUrl: opts.customEndpoint } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return parseProposeMergeResponse(raw, job.pairs);
  }
  throw new SidecarError(`Unsupported job kind: ${(job as { kind: string }).kind}`, 'unsupported');
}

// ---- explain-error prompt + parser ----------------------------------

const EXPLAIN_ERROR_SYSTEM = `You are NakliData's sidecar. Your job is to explain DuckDB query errors to a data-curious user in 1-3 plain-English sentences. Always also suggest a corrected SQL on a new line when the fix is obvious (typos, missing tables, wrong function names). Output strictly as JSON in this shape:

{
  "explanation": "<1-3 sentences, no preamble>",
  "suggested_fix": "<corrected SQL or null if the error needs more context>"
}

Hard rules:
- Output ONLY the JSON object. No markdown code fences. No commentary outside the JSON.
- "explanation" is plain prose, not Markdown.
- "suggested_fix" is plain SQL text, or null. Never include placeholder syntax like <table>; if you don't know the table name, return null.
- Never invent table or column names that don't appear in the schema hint.`;

export function buildExplainErrorPrompt(job: ExplainErrorJob): {
  system: string;
  user: string;
} {
  const sections: string[] = [];
  sections.push('SQL the user tried to run:');
  sections.push('```sql');
  sections.push(job.sql);
  sections.push('```');
  sections.push('');
  sections.push('DuckDB error message:');
  sections.push('```');
  sections.push(job.errorMessage);
  sections.push('```');
  if (job.schemaHint) {
    sections.push('');
    sections.push('Schema (tables and columns currently mounted):');
    sections.push('```');
    sections.push(job.schemaHint);
    sections.push('```');
  }
  return {
    system: EXPLAIN_ERROR_SYSTEM,
    user: sections.join('\n'),
  };
}

// ---- disambiguate-type prompt + parser ------------------------------

const DISAMBIGUATE_TYPE_SYSTEM = `You are NakliData's sidecar performing semantic type disambiguation for a single column.

The user has classified the column and has multiple candidate types. Your job is to pick exactly one.

Hard rules:
- Output ONLY one token: either the chosen typeId from the candidate list, or the literal word \`unknown\`.
- Do NOT output prose, code fences, JSON, quotes, or any other characters.
- Pick \`unknown\` if the samples don't clearly fit any candidate, or if the column header + samples are ambiguous.
- Never invent a typeId that wasn't in the candidate list.`;

export function buildDisambiguateTypePrompt(job: DisambiguateTypeJob): {
  system: string;
  user: string;
} {
  const candidatesBlock = job.candidates.map((c) => `- ${c.typeId} (${c.displayName})`).join('\n');
  const samplesBlock = job.samples.slice(0, 20).join('\n');
  const user = [
    `Column header: ${job.columnName}`,
    `SQL type: ${job.sqlType}`,
    '',
    'Candidate types (output one of these typeIds, or `unknown`):',
    candidatesBlock,
    '',
    'Sample values:',
    samplesBlock,
  ].join('\n');
  return { system: DISAMBIGUATE_TYPE_SYSTEM, user };
}

export function parseDisambiguateTypeResponse(
  raw: string,
  candidates: DisambiguateTypeJob['candidates'],
): DisambiguateTypeResponse {
  // Strip backticks, quotes, periods, code fences — defensive against
  // models that wrap the answer despite the instruction.
  const cleaned = raw
    .trim()
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/^["'`]|["'`.]$/g, '')
    .trim();
  if (cleaned.toLowerCase() === 'unknown' || cleaned === '') {
    return { kind: 'disambiguate-type', typeId: null };
  }
  // Match case-insensitively against the candidate ids.
  const match = candidates.find((c) => c.typeId.toLowerCase() === cleaned.toLowerCase());
  if (match) {
    return { kind: 'disambiguate-type', typeId: match.typeId };
  }
  // The model returned a string that isn't in the candidate list. Treat as 'unknown'.
  // (We don't throw here — coercing to null is more user-friendly than failing.)
  return { kind: 'disambiguate-type', typeId: null };
}

// ---- define-type prompt + parser ------------------------------------

const DEFINE_TYPE_SYSTEM = `You are NakliData's sidecar helping the user define a new semantic type for a column the classifier didn't recognise.

Given the column header and sample values, suggest a type specification.

Output strictly as JSON in this shape:

{
  "id": "<snake_case_id>",
  "display_name": "<Human Readable>",
  "category": "<one short label like 'Identifier' / 'Code' / 'Email' / 'Date' / 'Domain-specific'>",
  "regex": "<JavaScript-compatible regex, with anchors ^ and $, no leading/trailing slashes>"
}

Hard rules:
- Output ONLY the JSON object. No markdown code fences. No commentary outside the JSON.
- "id" is snake_case (lowercase letters / digits / underscores; starts with a letter). Choose a short, meaningful id (e.g., \`employee_id\`, \`order_no\`, \`isbn_13\`).
- "display_name" is Title Case, no more than 3 words.
- "category" is one short label, capitalised. Pick "Identifier" when the column looks like a key, "Code" for short codes, "Email" / "Phone" / "Date" / "URL" / "Currency" for those, otherwise "Domain-specific".
- "regex" must include anchors (^ and $) and match every sample value provided. Never emit \`.*\` or \`.+\` as the entire pattern — that's useless. If the samples don't share a clear pattern, return a regex that matches their character class + length range.`;

export function buildDefineTypePrompt(job: DefineTypeJob): {
  system: string;
  user: string;
} {
  const samplesBlock = job.samples.slice(0, 20).join('\n');
  const user = [
    `Column header: ${job.columnName}`,
    `SQL type: ${job.sqlType}`,
    '',
    'Sample values:',
    samplesBlock,
  ].join('\n');
  return { system: DEFINE_TYPE_SYSTEM, user };
}

const ID_REGEX = /^[a-z][a-z0-9_]*$/;

export function parseDefineTypeResponse(raw: string): DefineTypeResponse {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  let parsed: {
    id?: unknown;
    display_name?: unknown;
    category?: unknown;
    regex?: unknown;
  };
  try {
    parsed = JSON.parse(stripped) as typeof parsed;
  } catch (err) {
    throw new SidecarError(
      `Could not parse sidecar response as JSON: ${err instanceof Error ? err.message : String(err)}`,
      'parse',
    );
  }
  const id = typeof parsed.id === 'string' ? parsed.id.trim() : '';
  const display_name = typeof parsed.display_name === 'string' ? parsed.display_name.trim() : '';
  const category = typeof parsed.category === 'string' ? parsed.category.trim() : '';
  const regex = typeof parsed.regex === 'string' ? parsed.regex.trim() : '';
  if (!id || !display_name || !category || !regex) {
    throw new SidecarError(
      'Sidecar response missing one of {id, display_name, category, regex}.',
      'parse',
    );
  }
  if (!ID_REGEX.test(id)) {
    throw new SidecarError(`Sidecar returned a non-snake_case id: ${id}`, 'parse');
  }
  // Verify the regex compiles. If it doesn't, surface the failure so the
  // UI can show the user a helpful error before they save the type.
  try {
    new RegExp(regex);
  } catch (err) {
    throw new SidecarError(
      `Sidecar returned an invalid regex: ${err instanceof Error ? err.message : String(err)}`,
      'parse',
    );
  }
  return {
    kind: 'define-type',
    suggestion: { id, display_name, category, regex },
  };
}

// ---- explain-error parser -------------------------------------------

export function parseExplainErrorResponse(raw: string): ExplainErrorResponse {
  // Strip ```json``` fences if the model added them despite instructions.
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  let parsed: { explanation?: unknown; suggested_fix?: unknown };
  try {
    parsed = JSON.parse(stripped) as typeof parsed;
  } catch (err) {
    throw new SidecarError(
      `Could not parse sidecar response as JSON: ${err instanceof Error ? err.message : String(err)}`,
      'parse',
    );
  }
  const explanation =
    typeof parsed.explanation === 'string' && parsed.explanation.trim()
      ? parsed.explanation.trim()
      : '';
  if (!explanation) {
    throw new SidecarError('Sidecar response missing "explanation" string.', 'parse');
  }
  const suggestedFix =
    typeof parsed.suggested_fix === 'string' && parsed.suggested_fix.trim()
      ? parsed.suggested_fix.trim()
      : null;
  return { kind: 'explain-error', explanation, suggestedFix };
}

// ---- recommend-reports (Job 4 / Wave 3) prompt + parser -------------

const RECOMMEND_REPORTS_SYSTEM = `You are NakliData's sidecar ranking report templates by how well they fit the user's data. You are given a list of CANDIDATE templates (each already applicable to the workbook) plus a summary of the workbook's column types.

Rank the candidates by fit. Output strictly as JSON in this shape:

{
  "recommendations": [
    { "template_id": "<id from the candidate list>", "score": 0.0 to 1.0 }
  ]
}

Hard rules:
- Output ONLY the JSON object. No markdown code fences. No commentary, no prose justification.
- Use ONLY template_ids that appear in the candidate list. Never invent an id.
- "score" is your confidence the template is a good fit (1.0 = perfect, 0.0 = poor), a number between 0 and 1.
- Rank highest-fit first. You may omit candidates you think are poor fits, or include them with a low score.`;

export function buildRecommendReportsPrompt(job: RecommendReportsJob): {
  system: string;
  user: string;
} {
  const candidatesBlock = job.candidates
    .map((c) => `- ${c.templateId}: ${c.name} — ${c.description}`)
    .join('\n');
  const user = [
    'Workbook column types (table: assigned types):',
    job.typeSummary,
    '',
    'Candidate templates (rank these; use these template_ids exactly):',
    candidatesBlock,
  ].join('\n');
  return { system: RECOMMEND_REPORTS_SYSTEM, user };
}

export function parseRecommendReportsResponse(
  raw: string,
  candidateIds: string[],
): RecommendReportsResponse {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  let parsed: { recommendations?: unknown };
  try {
    parsed = JSON.parse(stripped) as typeof parsed;
  } catch (err) {
    throw new SidecarError(
      `Could not parse sidecar response as JSON: ${err instanceof Error ? err.message : String(err)}`,
      'parse',
    );
  }
  if (!Array.isArray(parsed.recommendations)) {
    throw new SidecarError('Sidecar response missing "recommendations" array.', 'parse');
  }
  const allowed = new Set(candidateIds);
  const seen = new Set<string>();
  const recommendations: Array<{ templateId: string; score: number }> = [];
  for (const item of parsed.recommendations) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as { template_id?: unknown; score?: unknown };
    const templateId = typeof rec.template_id === 'string' ? rec.template_id.trim() : '';
    // Drop unknown ids (hallucination guard) and duplicates.
    if (!allowed.has(templateId) || seen.has(templateId)) continue;
    const rawScore = typeof rec.score === 'number' && Number.isFinite(rec.score) ? rec.score : 0;
    const score = Math.min(1, Math.max(0, rawScore));
    recommendations.push({ templateId, score });
    seen.add(templateId);
  }
  recommendations.sort((a, b) => b.score - a.score);
  return { kind: 'recommend-reports', recommendations };
}

// ---- summarise-result (Job 6 / Wave 5 W5.2) prompt + parser ---------
//
// Hex Magic's "summary card" pattern: after a query runs, ask the
// sidecar for a one-line plain-English observation about the result.
// The hallucination guard (same shape as Job 4's id-allowlist) lives
// in the parser: any backtick-wrapped column reference must be a
// real column in the result. Anything outside that set → drop the
// whole response.

const SUMMARISE_RESULT_MAX_CHARS = 200;

const SUMMARISE_RESULT_SYSTEM = `You are NakliData's sidecar emitting a one-line observation about a query result. The user has already seen the table — you are summarising in prose what stands out (top value, distribution, range, presence of nulls, simple skew).

Output strictly as JSON in this shape:

{
  "observation": "<one short sentence, ≤ 200 chars>"
}

Hard rules:
- Output ONLY the JSON object. No markdown code fences. No commentary outside the JSON.
- "observation" is a single plain-English sentence. No bullets, no markdown, no SQL, no code fences.
- Reference columns by name wrapped in backticks (e.g., \`total\`). Only mention columns that appear in the result.
- Never invent numbers. If you cite a value, it must appear in the sample rows you were given.
- If the result is empty or you cannot say anything useful, return an empty string for "observation".
- Stay under 200 characters. Be specific, not generic ("Top vendor is Acme at 12.3k" beats "There are several vendors").`;

export function buildSummariseResultPrompt(job: SummariseResultJob): {
  system: string;
  user: string;
} {
  const sampleBlock = job.sampleRows
    .map((row, i) => `Row ${i + 1}: ${JSON.stringify(row)}`)
    .join('\n');
  const user = [
    'SQL that produced this result:',
    '```sql',
    job.sql,
    '```',
    '',
    `Columns (in order): ${job.columns.join(', ')}`,
    `Total rows: ${job.rowCount}`,
    '',
    `Sample rows (first ${job.sampleRows.length} of ${job.rowCount}):`,
    sampleBlock || '(no rows)',
  ].join('\n');
  return { system: SUMMARISE_RESULT_SYSTEM, user };
}

export function parseSummariseResultResponse(
  raw: string,
  columns: string[],
): SummariseResultResponse {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  let parsed: { observation?: unknown };
  try {
    parsed = JSON.parse(stripped) as typeof parsed;
  } catch (err) {
    throw new SidecarError(
      `Could not parse sidecar response as JSON: ${err instanceof Error ? err.message : String(err)}`,
      'parse',
    );
  }
  const rawObservation = typeof parsed.observation === 'string' ? parsed.observation.trim() : '';
  if (!rawObservation) {
    return { kind: 'summarise-result', observation: '' };
  }
  // Collapse whitespace + cap length. Models sometimes emit newlines or
  // run long despite the instruction.
  const collapsed = rawObservation.replace(/\s+/g, ' ').trim();
  const truncated =
    collapsed.length > SUMMARISE_RESULT_MAX_CHARS
      ? `${collapsed.slice(0, SUMMARISE_RESULT_MAX_CHARS - 1).trimEnd()}…`
      : collapsed;

  // Hallucination guard — every backtick-wrapped identifier must be a
  // column in the result. If the model invented one, drop the entire
  // observation: a card pointing at a nonexistent column is worse than
  // no card.
  //
  // Trim+lowercase both sides — a column literally named `"total "`
  // (trailing space, from `SELECT … AS "total ";`) was previously
  // added to `allowed` as `"total "`, then a perfectly-valid backtick
  // ref to `total` failed the check and the observation got dropped
  // as hallucinated. (Forward-pass M5, 2026-06-02.)
  const allowed = new Set(columns.map((c) => c.trim().toLowerCase()));
  const refMatcher = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex.exec loop pattern.
  while ((m = refMatcher.exec(truncated)) !== null) {
    const ref = m[1]?.trim().toLowerCase() ?? '';
    if (!ref) continue;
    if (!allowed.has(ref)) {
      return { kind: 'summarise-result', observation: '' };
    }
  }
  return { kind: 'summarise-result', observation: truncated };
}

// ---- nl-to-sql (Job 5 / Wave 5 W5.1) prompt + parser ----------------
//
// Genie / Cortex / Magic pattern. The user types a question; we ship
// the workbook's tables + columns + dialect; the model returns a single
// DuckDB SELECT statement. The result lands as the body of a new SQL
// cell — never auto-executed (Hard NOT #4).
//
// Parser layers, in order:
//   1. Strip ```sql``` fences if the model added them
//   2. Reject any write keyword (INSERT/UPDATE/DELETE/CREATE/DROP/ALTER/
//      TRUNCATE/MERGE/CALL/ATTACH). We render only SELECT (or WITH …
//      SELECT) — anything else is dropped to ''. Even with auto-exec
//      off, showing a write statement is a trap.
//   3. Hallucination guard: scan `FROM <ident>` and `JOIN <ident>` for
//      the tables actually referenced. Any table not in `tableNames` →
//      drop the response. Quoted ("…") and unquoted forms both checked.
//      Column-level validation is intentionally NOT done — DuckDB's own
//      error message on Run is a good signal, and a real SQL parser
//      adds far more weight than the value it brings.

const NL_TO_SQL_SYSTEM = `You are NakliData's sidecar translating plain-English questions into DuckDB SQL.

Hard rules:
- Output ONLY a single DuckDB SQL statement. No prose, no Markdown, no code fences, no comments after the SQL.
- The statement MUST start with SELECT (optionally preceded by WITH ... clauses).
- NEVER emit INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, TRUNCATE, MERGE, CALL, ATTACH, or any other write/DDL keyword. Read-only queries only.
- Reference ONLY the tables and columns listed in the schema below. Never invent a table or column name.
- Quote identifiers with double quotes when they contain non-alphanumeric characters or match SQL reserved words.
- Prefer LIMIT clauses on exploratory queries (default LIMIT 100 if the question doesn't constrain).
- If the question is ambiguous or impossible against this schema, emit a SELECT that returns an empty result with a clear column label (e.g., \`SELECT 'unanswerable' AS note WHERE 1=0\`).

Output ONLY the SQL — nothing else, no explanation, no greeting.`;

export function buildNlToSqlPrompt(job: NlToSqlJob): { system: string; user: string } {
  const dialect = job.dialect ?? 'duckdb';
  const schemaBlock = job.tables.map((t) => `- ${t.name}(${t.columns.join(', ')})`).join('\n');
  const user = [
    `Dialect: ${dialect}`,
    '',
    'Schema (tables and their columns — use ONLY these):',
    schemaBlock || '(no tables mounted)',
    '',
    `Question: ${job.question.trim()}`,
  ].join('\n');
  return { system: NL_TO_SQL_SYSTEM, user };
}

// Write/DDL/session-mutating keyword set. The model is INSTRUCTED to
// emit SELECT-only, but a confused or hostile response can include
// statements that — once the user clicks Run — mutate DuckDB session
// state in ways NL→SQL has no business touching:
//   - INSTALL / LOAD: pull in extensions, broaden the engine's network
//     reach (e.g. `LOAD httpfs` then `read_csv('https://attacker/…')`).
//   - SET / RESET: change session options (e.g.
//     `SET enable_external_access = true`) — a single SET in a
//     multi-statement response permanently weakens the session.
//   - USE: switch schemas.
// Forward-pass H3 (2026-06-02) — added INSTALL|LOAD|SET|RESET|USE.
const WRITE_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|MERGE|CALL|ATTACH|DETACH|GRANT|REVOKE|COPY|EXPORT|VACUUM|PRAGMA|INSTALL|LOAD|SET|RESET|USE)\b/i;

// Identifier the parser is willing to recognise after FROM / JOIN / a
// from-clause comma. Either double-quoted (capture group 1) or a bare
// snake_case-ish token (group 2). Used inline by extractFromTables.
const IDENT_REGEX = /^\s*(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/;

// Words that terminate a FROM clause's comma-list. Once we hit one of
// these (or the end of string / closing paren / `;`), stop walking the
// from-list. Subsequent FROM / JOIN occurrences open fresh from-windows.
//
// LATERAL / UNNEST / TABLE / VALUES / PIVOT / UNPIVOT are FROM-clause
// MODIFIERS, not table names — code-review of v1.2.1..HEAD caught the
// pre-fix walker emitting them as found-tables, which would falsely
// reject valid queries like `FROM t1, LATERAL (SELECT * FROM t2) lat`.
// Treat them as terminators so the comma-loop stops; the outer fromRe
// iteration still picks up any tables inside the LATERAL subquery.
const FROM_LIST_TERMINATOR =
  /^\s*(?:WHERE|GROUP|HAVING|ORDER|LIMIT|OFFSET|FETCH|UNION|INTERSECT|EXCEPT|JOIN|LEFT|RIGHT|INNER|FULL|OUTER|CROSS|ON|USING|QUALIFY|WINDOW|LATERAL|UNNEST|TABLE|VALUES|PIVOT|UNPIVOT|;|\))/i;

/**
 * Walk every FROM / JOIN window in a SQL statement and return the table
 * identifiers each window references — including the SQL-89 comma-join
 * form (`FROM a, b, c`).
 *
 * The original `\b(?:FROM|JOIN)\s+<ident>` regex only captured the FIRST
 * identifier after each keyword, so `FROM allowed, secret_table` passed
 * the hallucination guard with only `allowed` checked — `secret_table`
 * slipped through unvalidated. (Forward-pass H2, 2026-06-02.)
 *
 * Exported for unit tests.
 */
export function extractFromTables(sql: string): string[] {
  const found: string[] = [];
  const fromRe = /\b(?:FROM|JOIN)\b/gi;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: regex.exec loop.
  while ((m = fromRe.exec(sql)) !== null) {
    let pos = m.index + m[0].length;
    // Walk comma-separated identifiers from `pos`. Stop when the
    // upcoming token is a terminator keyword, a paren, or end-of-string.
    while (pos < sql.length) {
      const rest = sql.slice(pos);
      if (FROM_LIST_TERMINATOR.test(rest)) break;
      const identMatch = IDENT_REGEX.exec(rest);
      if (!identMatch) break;
      const ident = (identMatch[1] ?? identMatch[2] ?? '').trim();
      if (ident) found.push(ident);
      pos += identMatch[0].length;
      // Skip an optional alias (`t AS alias` or `t alias`). AS is
      // case-insensitive; the bare-alias form is also allowed.
      const aliasMatch = /^\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*)/i.exec(sql.slice(pos));
      if (aliasMatch) {
        // Only consume as alias if NOT itself a terminator keyword.
        const candidate = aliasMatch[1]?.toUpperCase() ?? '';
        const kw =
          /^(WHERE|GROUP|HAVING|ORDER|LIMIT|OFFSET|FETCH|UNION|INTERSECT|EXCEPT|JOIN|LEFT|RIGHT|INNER|FULL|OUTER|CROSS|ON|USING|QUALIFY|WINDOW|AS)$/i;
        if (!kw.test(candidate)) {
          pos += aliasMatch[0].length;
        }
      }
      const commaMatch = /^\s*,/.exec(sql.slice(pos));
      if (!commaMatch) break;
      pos += commaMatch[0].length;
    }
  }
  return found;
}

/**
 * Strip SQL line (`-- …`) and block (`/* … *​/`) comments, preserving
 * single-quoted string literals verbatim (so `'a -- b'` isn't gutted).
 * M1: the nl-to-sql gates below must run on a comment-free view — otherwise
 * `FROM/**​/'https://attacker/x.csv'` slips past the `FROM\s+'` replacement-scan
 * gate (the comment defeats `\s+`) and past the identifier walker (no ident to
 * validate). Comments are replaced with a space so adjacent tokens don't fuse.
 */
function stripSqlComments(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    if (ch === "'") {
      const start = i;
      i++;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      out += sql.slice(start, i);
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      i += 2;
      while (i < n && sql[i] !== '\n') i++;
      out += ' ';
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i = Math.min(n, i + 2);
      out += ' ';
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export function parseNlToSqlResponse(raw: string, tableNames: string[]): NlToSqlResponse {
  const stripped = raw
    .trim()
    .replace(/^```(?:sql|duckdb)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  if (!stripped) {
    return { kind: 'nl-to-sql', sql: '' };
  }
  // M1: run EVERY security gate against a comment-free view so a model (or a
  // prompt-injected one) can't hide a replacement-scan URL or extra statement
  // behind `/* */` or `--`. The returned SQL stays `stripped` (comments are
  // harmless once the dangerous forms are rejected).
  const norm = stripSqlComments(stripped).trim();
  // Must start with SELECT or WITH (optionally inside a leading
  // parenthesis — `(SELECT …)` and `(WITH …)` are valid).
  const headMatcher = /^(?:\(\s*)?(SELECT|WITH)\b/i;
  if (!headMatcher.test(norm)) {
    return { kind: 'nl-to-sql', sql: '' };
  }
  // Reject any write/DDL/session-mutating keyword anywhere in the body.
  // (A SELECT that references a column literally named `delete` is rare;
  // if it happens we false-reject and the user can edit.)
  if (WRITE_KEYWORDS.test(norm)) {
    return { kind: 'nl-to-sql', sql: '' };
  }
  // Reject DuckDB's "replacement scan" syntax: `FROM '…'` (single-quoted
  // string) reads the URL/path as if it were `read_csv_auto(...)`. The
  // hallucination guard below only walks IDENTIFIERS — a quoted-string
  // FROM has no ident to validate, so without this gate the model could
  // emit `SELECT * FROM 'https://attacker.com/x.csv'` and the parser
  // would let it through. (Code-review of v1.2.1..HEAD surfaced.)
  // Same gate for JOIN as defence-in-depth.
  if (/\b(?:FROM|JOIN)\s+'/i.test(norm)) {
    return { kind: 'nl-to-sql', sql: '' };
  }
  // Reject multi-statement responses. The model is instructed to emit a
  // single statement, but a confused response might produce
  // `SELECT 1; SET enable_external_access=true; SELECT 1;`. WRITE_KEYWORDS
  // catches SET specifically, but the broader multi-statement gate
  // catches anything else we haven't enumerated. (Forward-pass H3.)
  //
  // Strip string literals first so a column value like `'foo;bar'`
  // doesn't false-trip the gate. DuckDB strings use `''` as embedded-
  // quote escape — the regex handles that with `(?:[^']|'')*`.
  // (Code-review of v1.2.1..HEAD surfaced.)
  const strippedNoStrings = norm.replace(/'(?:[^']|'')*'/g, "''");
  if (/;\s*\S/.test(strippedNoStrings)) {
    return { kind: 'nl-to-sql', sql: '' };
  }
  // Hallucination guard — every table referenced by FROM/JOIN (including
  // the SQL-89 comma-join form `FROM a, b, c`) must be in tableNames
  // (case-insensitive). CTE names defined via WITH are explicitly
  // allowed: pull them out first.
  const cteNames = new Set<string>();
  // Match `WITH name AS (...)` and `, name AS (...)` — naive but
  // covers the common case. Recursive CTEs (`WITH RECURSIVE name AS`)
  // pick up the optional RECURSIVE token too.
  const cteMatcher = /(?:WITH\s+(?:RECURSIVE\s+)?|,\s*)([A-Za-z_][A-Za-z0-9_]*)\s+AS\s*\(/gi;
  let cm: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex.exec loop pattern.
  while ((cm = cteMatcher.exec(norm)) !== null) {
    const name = cm[1]?.toLowerCase() ?? '';
    if (name) cteNames.add(name);
  }
  const allowed = new Set(tableNames.map((n) => n.toLowerCase()));
  // extractFromTables walks every FROM/JOIN window and returns ALL
  // comma-separated identifiers inside each — closing the H2 gap.
  for (const refRaw of extractFromTables(norm)) {
    const ref = refRaw.toLowerCase();
    // Skip CTE references and known cell-view shorthands (cell_<id>).
    if (cteNames.has(ref)) continue;
    if (ref.startsWith('cell_')) continue;
    if (!allowed.has(ref)) {
      return { kind: 'nl-to-sql', sql: '' };
    }
  }
  return { kind: 'nl-to-sql', sql: stripped };
}

// ---- propose-chart prompt + parser (M4) ----------------------------

const PROPOSE_CHART_SYSTEM = `You are NakliData's sidecar. Your job is to propose ONE chart configuration for a SQL result. Output JSON ONLY. No prose. No commentary. No markdown fences.

Output shape (verbatim):

{
  "chart_type": "<one of: bar | line | area | scatter | pie | histogram | stat | table>",
  "x_column": "<column name from the result or null>",
  "y_column": "<column name from the result or null>",
  "group_column": "<column name from the result or null>",
  "title": "<short title, ≤ 80 chars>"
}

Hard rules:
- Output ONLY the JSON object. No markdown code fences. No commentary outside the JSON.
- "chart_type" MUST be one of the eight listed values. Anything else → dropped.
- "x_column" / "y_column" / "group_column" MUST be names from the provided column list, or null.
- Pick the chart type that best fits the result:
  - bar / line / area: one categorical / temporal column + one numeric column.
  - scatter: two numeric columns.
  - pie: one categorical column + one numeric column (≤ ~10 categories).
  - histogram: one numeric column (no Y axis — set y_column to null).
  - stat: one numeric scalar (single row, single column).
  - table: when no chart fits — fall back to a styled table.
- "title" is plain text, ≤ 80 chars, summarising the chart.
- NEVER include prose narration of the data ("here's a chart showing X over time"). The output is JSON only.`;

export function buildProposeChartPrompt(job: ProposeChartJob): {
  system: string;
  user: string;
} {
  const colsLine = job.columns.map((c) => `${c.name} (${c.sqlType})`).join(', ');
  const sampleLines = job.sampleRows
    .slice(0, 10)
    .map((r) => JSON.stringify(r))
    .join('\n');
  const user = `SQL the cell ran:\n${job.sql.slice(0, 400)}\n\nResult columns: ${colsLine}\nRow count: ${job.rowCount}\n\nFirst rows:\n${sampleLines}\n\nPropose ONE chart configuration. JSON only.`;
  return { system: PROPOSE_CHART_SYSTEM, user };
}

const CHART_TYPES = new Set([
  'bar',
  'line',
  'area',
  'scatter',
  'pie',
  'histogram',
  'stat',
  'table',
] as const);

type AllowedChartType =
  | 'bar'
  | 'line'
  | 'area'
  | 'scatter'
  | 'pie'
  | 'histogram'
  | 'stat'
  | 'table';

/**
 * Parse the model's response into a `ProposeChartResponse`. Strict —
 * any of the following → return `{kind: 'propose-chart', proposal: null}`:
 *   - JSON parse fails
 *   - `chart_type` not in the 8-value allowlist
 *   - `x_column` / `y_column` / `group_column` reference a column name
 *     not in the input
 *   - `title` is missing or > 80 chars
 *
 * The null proposal is the UI's cue to fall back to manual chart-cell
 * insertion ("Couldn't propose a chart; pick one manually").
 */
export function parseProposeChartResponse(
  raw: string,
  columnNames: string[],
): ProposeChartResponse {
  const trimmed = raw.trim();
  // Strip markdown fences if the model emitted them despite instructions.
  // Extract the contents of the FIRST fenced block when present, which
  // tolerates a trailing prose tail after the closing fence — the old
  // `/```$/` only matched a fence at the exact end of the string, so
  // "```json … ``` Hope this helps!" failed to parse (forward-pass M18).
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const stripped = (fenceMatch?.[1] ?? trimmed).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return { kind: 'propose-chart', proposal: null };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { kind: 'propose-chart', proposal: null };
  }
  const obj = parsed as Record<string, unknown>;
  const chartType = obj.chart_type;
  if (typeof chartType !== 'string' || !CHART_TYPES.has(chartType as AllowedChartType)) {
    return { kind: 'propose-chart', proposal: null };
  }
  const colSet = new Set(columnNames);
  // If a non-null string was supplied but it's not in the column
  // allowlist, DROP the whole proposal (hallucination guard).
  const xRaw = obj.x_column;
  const yRaw = obj.y_column;
  const groupRaw = obj.group_column;
  const validateRef = (v: unknown): { ok: boolean; value: string | null } => {
    if (v === null || v === undefined) return { ok: true, value: null };
    if (typeof v !== 'string') return { ok: false, value: null };
    if (v === '') return { ok: true, value: null };
    if (!colSet.has(v)) return { ok: false, value: null };
    return { ok: true, value: v };
  };
  const x = validateRef(xRaw);
  const y = validateRef(yRaw);
  const grp = validateRef(groupRaw);
  if (!x.ok || !y.ok || !grp.ok) {
    return { kind: 'propose-chart', proposal: null };
  }
  const title = obj.title;
  if (typeof title !== 'string' || title.length === 0 || title.length > 80) {
    return { kind: 'propose-chart', proposal: null };
  }
  return {
    kind: 'propose-chart',
    proposal: {
      chartType: chartType as AllowedChartType,
      xColumn: x.value,
      yColumn: y.value,
      groupColumn: grp.value,
      title: title.trim(),
    },
  };
}

// ---- propose-merge prompt + parser (Resolve M1, Job 8) --------------
//
// Adjudicate borderline value pairs the deterministic clustering left
// ungrouped. Three-layer no-prose guard (same as propose-chart): (1) the
// system prompt bans narration; (2) the parser is strict JSON-only
// (markdown-fence-tolerant, prose-preface-rejecting); (3) the response
// type has no observation/explanation field. Hallucination guard is
// all-or-nothing PER PAIR: a and b must be exact input values and (when
// merging) canonical must equal a or b — else that pair is dropped.

const PROPOSE_MERGE_SYSTEM = `You are NakliData's sidecar. You decide whether pairs of column values are the SAME real-world entity spelled differently (e.g. "Sharma Trading Co" vs "SHARMA TRADING CO."). Output JSON ONLY. No prose. No commentary. No markdown fences.

Output shape (verbatim):

{
  "pairs": [
    { "a": "<the exact value a you were given>", "b": "<the exact value b>", "merge": true, "canonical": "<a or b, verbatim>" }
  ]
}

Hard rules:
- Output ONLY the JSON object. No markdown code fences. No commentary outside the JSON.
- "a" and "b" MUST be copied VERBATIM from the pair you were given. Never alter, trim, reorder, or invent a value.
- "merge" is true only when the two values denote the same entity; false when they are genuinely different.
- "canonical" MUST be exactly one of the two input values (a or b) — the better-formed spelling. Never invent a new spelling.
- Decide each pair independently. When unsure, prefer "merge": false.
- NEVER narrate or explain. The output is JSON only.`;

export function buildProposeMergePrompt(job: ProposeMergeJob): {
  system: string;
  user: string;
} {
  const block = job.pairs
    .map(
      (p, i) =>
        `Pair ${i + 1}: a=${JSON.stringify(p.a)} (count ${p.aCount}), b=${JSON.stringify(p.b)} (count ${p.bCount})`,
    )
    .join('\n');
  const user = [
    'Decide for each candidate pair whether a and b are the SAME real-world entity spelled differently.',
    '',
    block || '(no pairs)',
    '',
    'Return the JSON object. JSON only.',
  ].join('\n');
  return { system: PROPOSE_MERGE_SYSTEM, user };
}

/**
 * Parse the model's merge decisions. Strict — junk JSON or a non-object
 * → `{pairs: []}`. Each pair is validated independently against the input
 * allowlist; a pair that fails the guard is dropped (the others survive).
 */
export function parseProposeMergeResponse(
  raw: string,
  askedPairs: ReadonlyArray<{ a: string; b: string }>,
): ProposeMergeResponse {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const stripped = (fenceMatch?.[1] ?? trimmed).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return { kind: 'propose-merge', pairs: [] };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { kind: 'propose-merge', pairs: [] };
  }
  const arr = (parsed as { pairs?: unknown }).pairs;
  if (!Array.isArray(arr)) {
    return { kind: 'propose-merge', pairs: [] };
  }
  // Per-pair allowlist: only accept decisions on pairs we actually asked
  // about, keyed unordered (the model may return a/b in either order). Tighter
  // than a flat value allowlist — it blocks a cross-pair recombination (a from
  // one pair + b from another) the deterministic layer never proposed, not
  // just fabricated values.
  const pairKey = (x: string, y: string): string => JSON.stringify(x < y ? [x, y] : [y, x]);
  const allowedPairs = new Set(askedPairs.map((p) => pairKey(p.a, p.b)));
  const out: ProposeMergeResponse['pairs'] = [];
  for (const item of arr) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as { a?: unknown; b?: unknown; merge?: unknown; canonical?: unknown };
    const a = typeof rec.a === 'string' ? rec.a : '';
    const b = typeof rec.b === 'string' ? rec.b : '';
    // Must be an exact pair we asked about (blocks fabricated values AND
    // recombined pairings).
    if (a === b || !allowedPairs.has(pairKey(a, b))) continue;
    const merge = rec.merge === true;
    let canonical = '';
    if (merge) {
      const c = typeof rec.canonical === 'string' ? rec.canonical : '';
      // canonical must be exactly one of the two input values, else drop.
      if (c !== a && c !== b) continue;
      canonical = c;
    }
    out.push({ a, b, merge, canonical });
  }
  return { kind: 'propose-merge', pairs: out };
}
