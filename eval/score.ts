// Per-job scoring for the sidecar eval harness (W2.4).
//
// Each scorer takes the parsed sidecar response + the fixture's
// `expected` rubric and returns a normalised score in [0, 1] plus a
// boolean pass and a one-line detail string. The scorers deliberately
// avoid an LLM-judge: they're cheap, deterministic, and reproducible,
// which is what a prompted-base-vs-prompted+LoRA comparison needs.

import type {
  AssignTypeResponse,
  DefineTypeResponse,
  DisambiguateTypeResponse,
  ExplainErrorResponse,
  NlToSchemaResponse,
  NlToSqlResponse,
  RecommendReportsResponse,
  SummariseResultResponse,
} from '../src/core/sidecar/types.ts';

export interface ScoreResult {
  pass: boolean;
  /** 0..1. For pass/fail jobs this is 0 or 1; for composite jobs it's a fraction. */
  score: number;
  detail: string;
}

// ---- disambiguate-type: exact typeId match --------------------------

export interface DisambiguateExpected {
  /** Expected chosen typeId, or null when the right answer is "unknown". */
  typeId: string | null;
}

export function scoreDisambiguateType(
  parsed: DisambiguateTypeResponse,
  expected: DisambiguateExpected,
): ScoreResult {
  const got = parsed.typeId;
  const pass = got === expected.typeId;
  return {
    pass,
    score: pass ? 1 : 0,
    detail: pass ? `chose ${fmt(got)} ✓` : `chose ${fmt(got)}, expected ${fmt(expected.typeId)}`,
  };
}

// ---- define-type: category match + functional regex check -----------

export interface DefineTypeExpected {
  /** Expected category label (case-insensitive compare). */
  category: string;
  /** When true, the suggested regex must compile AND match every sample. */
  regexMatchesSamples: boolean;
  /** Optional substring the id should contain (soft signal, not gating). */
  idLike?: string;
}

export function scoreDefineType(
  parsed: DefineTypeResponse,
  expected: DefineTypeExpected,
  samples: string[],
): ScoreResult {
  const parts: Array<{ ok: boolean; weight: number; label: string }> = [];

  // (1) category match — case-insensitive.
  const categoryOk = parsed.suggestion.category.toLowerCase() === expected.category.toLowerCase();
  parts.push({ ok: categoryOk, weight: 0.4, label: `category=${parsed.suggestion.category}` });

  // (2) regex functional check — compiles AND matches every sample.
  let regexOk = !expected.regexMatchesSamples; // vacuously true if not required
  let regexDetail = 'regex not required';
  if (expected.regexMatchesSamples) {
    try {
      const re = new RegExp(parsed.suggestion.regex);
      const misses = samples.filter((s) => !re.test(s));
      regexOk = misses.length === 0;
      regexDetail = regexOk
        ? `regex matches all ${samples.length} samples`
        : `regex misses ${misses.length}/${samples.length} samples`;
    } catch {
      regexOk = false;
      regexDetail = 'regex does not compile';
    }
  }
  parts.push({ ok: regexOk, weight: 0.5, label: regexDetail });

  // (3) id soft signal — small weight, never gates.
  const idOk = expected.idLike
    ? parsed.suggestion.id.toLowerCase().includes(expected.idLike.toLowerCase())
    : true;
  parts.push({ ok: idOk, weight: 0.1, label: `id=${parsed.suggestion.id}` });

  const score = parts.reduce((acc, p) => acc + (p.ok ? p.weight : 0), 0);
  // Pass requires the two load-bearing parts: category + regex.
  const pass = categoryOk && regexOk;
  return {
    pass,
    score,
    detail: parts.map((p) => `${p.ok ? '✓' : '✗'} ${p.label}`).join(' · '),
  };
}

// ---- explain-error: keyword coverage + suggested-fix check ----------

export interface ExplainErrorExpected {
  /** Keywords the explanation should mention (case-insensitive substring). */
  keywords: string[];
  /**
   * When a string: the suggested fix must be non-null and contain it.
   * When null: the suggested fix SHOULD be null (error needs more context).
   * When undefined: suggested fix is not scored.
   */
  suggestedFixContains?: string | null;
}

export function scoreExplainError(
  parsed: ExplainErrorResponse,
  expected: ExplainErrorExpected,
): ScoreResult {
  const explanation = parsed.explanation.toLowerCase();
  const hits = expected.keywords.filter((k) => explanation.includes(k.toLowerCase()));
  const keywordCoverage =
    expected.keywords.length === 0 ? 1 : hits.length / expected.keywords.length;

  let fixOk = true;
  let fixDetail = 'fix not scored';
  if (expected.suggestedFixContains === null) {
    fixOk = parsed.suggestedFix === null;
    fixDetail = fixOk ? 'fix correctly null' : 'expected null fix';
  } else if (typeof expected.suggestedFixContains === 'string') {
    const f = parsed.suggestedFix?.toLowerCase() ?? '';
    fixOk = f.includes(expected.suggestedFixContains.toLowerCase());
    fixDetail = fixOk
      ? `fix contains "${expected.suggestedFixContains}"`
      : `fix missing "${expected.suggestedFixContains}"`;
  }

  // Composite: 70% keyword coverage, 30% fix correctness.
  const score = keywordCoverage * 0.7 + (fixOk ? 0.3 : 0);
  // Pass requires majority keyword coverage AND the fix check.
  const pass = keywordCoverage >= 0.5 && fixOk;
  return {
    pass,
    score,
    detail: `keywords ${hits.length}/${expected.keywords.length} · ${fixDetail}`,
  };
}

// ---- recommend-reports: top-1 hit + must-include coverage -----------

export interface RecommendReportsExpected {
  /** The template that should rank #1. */
  top: string;
  /** Template ids that must appear somewhere in the ranking. */
  mustInclude?: string[];
}

export function scoreRecommendReports(
  parsed: RecommendReportsResponse,
  expected: RecommendReportsExpected,
): ScoreResult {
  const ids = parsed.recommendations.map((r) => r.templateId);
  const topOk = ids[0] === expected.top;
  const must = expected.mustInclude ?? [];
  const included = must.filter((m) => ids.includes(m));
  const coverage = must.length === 0 ? 1 : included.length / must.length;
  // 60% top-1 correctness, 40% must-include coverage.
  const score = (topOk ? 0.6 : 0) + coverage * 0.4;
  const pass = topOk && coverage === 1;
  return {
    pass,
    score,
    detail: `top=${ids[0] ?? '(none)'} ${topOk ? '✓' : `(want ${expected.top})`} · include ${included.length}/${must.length}`,
  };
}

// ---- summarise-result: keyword coverage + length cap + safety -------

export interface SummariseResultExpected {
  /**
   * Keywords (case-insensitive substrings) the observation should
   * contain. Each keyword the observation hits adds to coverage.
   */
  keywords?: string[];
  /**
   * When `true`, the parser is expected to have dropped the response
   * because it referenced a column not in the result (hallucination
   * guard). `parsed.observation` must be `''` to pass.
   */
  expectDropped?: boolean;
  /** Upper bound on length, characters. Default 200 (matches the parser cap). */
  maxChars?: number;
}

export function scoreSummariseResult(
  parsed: SummariseResultResponse,
  expected: SummariseResultExpected,
): ScoreResult {
  const obs = parsed.observation;
  const maxChars = expected.maxChars ?? 200;

  // (1) Hallucination-drop case — observation must be empty.
  if (expected.expectDropped) {
    const pass = obs === '';
    return {
      pass,
      score: pass ? 1 : 0,
      detail: pass
        ? 'response correctly dropped'
        : `expected drop, got "${obs.slice(0, 80)}${obs.length > 80 ? '…' : ''}"`,
    };
  }

  // (2) Normal case — non-empty, under the cap, mentions the expected keywords.
  const nonEmpty = obs.length > 0;
  const underCap = obs.length <= maxChars;
  const keywords = expected.keywords ?? [];
  const lower = obs.toLowerCase();
  const hits = keywords.filter((k) => lower.includes(k.toLowerCase()));
  const coverage = keywords.length === 0 ? (nonEmpty ? 1 : 0) : hits.length / keywords.length;

  // Composite: 60% keyword coverage, 20% non-empty, 20% under-cap.
  const score = coverage * 0.6 + (nonEmpty ? 0.2 : 0) + (underCap ? 0.2 : 0);
  // Pass requires non-empty, under cap, and majority keyword coverage
  // (or non-empty when no keywords were specified).
  const pass = nonEmpty && underCap && (keywords.length === 0 || coverage >= 0.5);
  return {
    pass,
    score,
    detail: `len=${obs.length}/${maxChars} · keywords ${hits.length}/${keywords.length}${nonEmpty ? '' : ' · empty'}`,
  };
}

// ---- nl-to-sql: SELECT-only + keyword coverage + safety drop --------

export interface NlToSqlExpected {
  /**
   * When `true`, the parser is expected to have dropped the response
   * (write keyword, unknown table, junk start, …). `parsed.sql` must
   * be `''` to pass.
   */
  expectDropped?: boolean;
  /**
   * Keywords the generated SQL must contain (case-insensitive substrings).
   * Useful for "must FROM invoices" / "must group by vendor_name".
   */
  keywords?: string[];
}

export function scoreNlToSql(parsed: NlToSqlResponse, expected: NlToSqlExpected): ScoreResult {
  const sql = parsed.sql;

  // (1) Hallucination-drop case — sql must be empty.
  if (expected.expectDropped) {
    const pass = sql === '';
    return {
      pass,
      score: pass ? 1 : 0,
      detail: pass
        ? 'response correctly dropped'
        : `expected drop, got "${sql.slice(0, 80)}${sql.length > 80 ? '…' : ''}"`,
    };
  }

  // (2) Normal case — non-empty, starts with SELECT or WITH, contains keywords.
  const nonEmpty = sql.length > 0;
  const startsRight = /^(?:\(\s*)?(SELECT|WITH)\b/i.test(sql);
  const keywords = expected.keywords ?? [];
  const lower = sql.toLowerCase();
  const hits = keywords.filter((k) => lower.includes(k.toLowerCase()));
  const coverage = keywords.length === 0 ? (nonEmpty ? 1 : 0) : hits.length / keywords.length;

  // Composite: 60% keyword coverage, 20% non-empty, 20% starts with SELECT/WITH.
  const score = coverage * 0.6 + (nonEmpty ? 0.2 : 0) + (startsRight ? 0.2 : 0);
  const pass = nonEmpty && startsRight && (keywords.length === 0 || coverage >= 0.5);
  return {
    pass,
    score,
    detail: `len=${sql.length} · starts=${startsRight ? 'SELECT/WITH ✓' : '✗'} · keywords ${hits.length}/${keywords.length}${nonEmpty ? '' : ' · empty'}`,
  };
}

// ---- assign-type: exact typeId match (full-vocabulary pick) ---------

export interface AssignTypeExpected {
  /** Expected chosen typeId, or null when the right answer is "unknown". */
  typeId: string | null;
}

export function scoreAssignType(
  parsed: AssignTypeResponse,
  expected: AssignTypeExpected,
): ScoreResult {
  const got = parsed.typeId;
  const pass = got === expected.typeId;
  return {
    pass,
    score: pass ? 1 : 0,
    detail: pass ? `chose ${fmt(got)} ✓` : `chose ${fmt(got)}, expected ${fmt(expected.typeId)}`,
  };
}

// ---- nl-to-schema: column coverage + semantic-mapping coverage ------

export interface NlToSchemaExpected {
  /**
   * When `true`, the parser is expected to have rejected the response
   * (no usable columns). `parsed.columns` must be empty to pass.
   */
  expectRejected?: boolean;
  /** Column names (sanitised, snake_case) that must appear in the schema. */
  mustHaveColumns?: string[];
  /**
   * Required column → semantic-type-id mappings. Each entry passes when
   * the column exists AND its semanticTypeId equals the expected id.
   */
  mustMap?: Record<string, string>;
}

export function scoreNlToSchema(
  parsed: NlToSchemaResponse,
  expected: NlToSchemaExpected,
): ScoreResult {
  if (expected.expectRejected) {
    const pass = parsed.columns.length === 0;
    return {
      pass,
      score: pass ? 1 : 0,
      detail: pass
        ? 'response correctly rejected'
        : `expected rejection, got ${parsed.columns.length} cols`,
    };
  }

  const names = new Set(parsed.columns.map((c) => c.name.toLowerCase()));
  const must = expected.mustHaveColumns ?? [];
  const colHits = must.filter((m) => names.has(m.toLowerCase()));
  const colCoverage =
    must.length === 0 ? (parsed.columns.length > 0 ? 1 : 0) : colHits.length / must.length;

  const mapEntries = Object.entries(expected.mustMap ?? {});
  const mapHits = mapEntries.filter(([col, typeId]) => {
    const found = parsed.columns.find((c) => c.name.toLowerCase() === col.toLowerCase());
    return found?.semanticTypeId === typeId;
  });
  const mapCoverage = mapEntries.length === 0 ? 1 : mapHits.length / mapEntries.length;

  // 60% column coverage, 40% mapping coverage.
  const score = colCoverage * 0.6 + mapCoverage * 0.4;
  const pass = colCoverage === 1 && mapCoverage >= 0.5;
  return {
    pass,
    score,
    detail: `cols ${colHits.length}/${must.length} · map ${mapHits.length}/${mapEntries.length}`,
  };
}

function fmt(v: string | null): string {
  return v === null ? 'unknown' : `"${v}"`;
}
