// Per-job scoring for the sidecar eval harness (W2.4).
//
// Each scorer takes the parsed sidecar response + the fixture's
// `expected` rubric and returns a normalised score in [0, 1] plus a
// boolean pass and a one-line detail string. The scorers deliberately
// avoid an LLM-judge: they're cheap, deterministic, and reproducible,
// which is what a prompted-base-vs-prompted+LoRA comparison needs.

import type {
  DefineTypeResponse,
  DisambiguateTypeResponse,
  ExplainErrorResponse,
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

function fmt(v: string | null): string {
  return v === null ? 'unknown' : `"${v}"`;
}
