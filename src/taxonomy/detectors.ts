// Pure detector functions. Each takes a DetectorSpec + ColumnSample and
// returns a DetectorResult. No side effects, no engine access.
//
// Detector kinds (spec §3.2):
//   header_match | regex | checksum | value_set | range_numeric | distribution
//
// Each runs within 50 ms per column; long-running detectors should be
// skipped by the dispatcher and logged.

import { CHECKSUM_FNS } from './checksums.ts';
import type { ColumnSample, DetectorResult, DetectorSpec } from './types.ts';

export function runDetector(spec: DetectorSpec, sample: ColumnSample): DetectorResult {
  switch (spec.kind) {
    case 'header_match':
      return headerMatch(spec, sample);
    case 'regex':
      return regexMatch(spec, sample);
    case 'checksum':
      return checksumMatch(spec, sample);
    case 'value_set':
      return valueSet(spec, sample);
    case 'range_numeric':
      return rangeNumeric(spec, sample);
    case 'distribution':
      return distribution(spec, sample);
  }
}

const HEADER_TOKEN_RE = /[a-z0-9]+/g;
function tokenize(name: string): string[] {
  return name.toLowerCase().match(HEADER_TOKEN_RE) ?? [];
}

function headerMatch(spec: DetectorSpec, sample: ColumnSample): DetectorResult {
  const patterns = spec.patterns ?? [];
  if (patterns.length === 0) return inapplicable();
  const header = sample.columnName.toLowerCase();
  const headerTokens = new Set(tokenize(sample.columnName));
  // Scan all patterns and return the best (highest-score) match so a
  // generic short pattern doesn't shadow a more specific one (e.g. "vendor"
  // shouldn't beat "vendor_name" when the column is literally "vendor_name").
  let bestScore = 0;
  let bestEvidence = '';
  for (const p of patterns) {
    const pLower = p.toLowerCase();
    let score = 0;
    let evidence = '';
    if (header === pLower) {
      score = 1;
      evidence = `header == "${p}"`;
    } else {
      const pTokens = tokenize(p);
      if (pTokens.length > 0 && pTokens.every((t) => headerTokens.has(t))) {
        score = 0.85;
        evidence = `header contains "${p}"`;
      } else if (header.includes(pLower)) {
        score = 0.65;
        evidence = `header substring "${p}"`;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestEvidence = evidence;
    }
    if (bestScore >= 1) break; // can't do better
  }
  return { score: bestScore, applicable: true, evidence: bestEvidence };
}

function regexMatch(spec: DetectorSpec, sample: ColumnSample): DetectorResult {
  if (!spec.pattern || sample.values.length === 0) return inapplicable();
  let re: RegExp;
  try {
    re = new RegExp(spec.pattern);
  } catch {
    return inapplicable();
  }
  let hits = 0;
  for (const v of sample.values) {
    if (re.test(v)) hits++;
  }
  const ratio = hits / sample.values.length;
  return {
    score: ratio,
    applicable: true,
    evidence:
      ratio === 1
        ? `regex match 100% (${hits}/${sample.values.length})`
        : `regex match ${(ratio * 100).toFixed(0)}% (${hits}/${sample.values.length})`,
  };
}

function checksumMatch(spec: DetectorSpec, sample: ColumnSample): DetectorResult {
  if (!spec.fn || sample.values.length === 0) return inapplicable();
  const fn = CHECKSUM_FNS[spec.fn];
  if (!fn) return inapplicable();
  let hits = 0;
  for (const v of sample.values) {
    if (fn(v)) hits++;
  }
  const ratio = hits / sample.values.length;
  return {
    score: ratio,
    applicable: true,
    evidence: `${spec.fn} valid ${(ratio * 100).toFixed(0)}% (${hits}/${sample.values.length})`,
  };
}

function valueSet(spec: DetectorSpec, sample: ColumnSample): DetectorResult {
  if (!spec.values || sample.values.length === 0) return inapplicable();
  const set = new Set(spec.values.map((v) => v.toLowerCase()));
  let hits = 0;
  for (const v of sample.values) {
    if (set.has(v.toLowerCase())) hits++;
  }
  const ratio = hits / sample.values.length;
  return {
    score: ratio,
    applicable: true,
    evidence: `value-set match ${(ratio * 100).toFixed(0)}% (${hits}/${sample.values.length})`,
  };
}

function rangeNumeric(spec: DetectorSpec, sample: ColumnSample): DetectorResult {
  if (sample.values.length === 0) return inapplicable();
  const min = spec.min ?? Number.NEGATIVE_INFINITY;
  const max = spec.max ?? Number.POSITIVE_INFINITY;
  let parsed = 0;
  let inRange = 0;
  for (const v of sample.values) {
    const n = Number(v);
    if (Number.isFinite(n)) {
      parsed++;
      if (n >= min && n <= max) inRange++;
    }
  }
  if (parsed === 0) return { score: 0, applicable: true, evidence: 'no numeric values' };
  const ratio = inRange / sample.values.length;
  return {
    score: ratio,
    applicable: true,
    evidence: `in [${min}, ${max}]: ${(ratio * 100).toFixed(0)}% (${inRange}/${sample.values.length})`,
  };
}

function distribution(spec: DetectorSpec, sample: ColumnSample): DetectorResult {
  if (sample.values.length === 0) return inapplicable();
  let score = 1;
  const evidence: string[] = [];

  if (spec.high_cardinality) {
    const distinctRatio = sample.distinctCount / sample.values.length;
    score *= distinctRatio > 0.8 ? 1 : distinctRatio > 0.5 ? 0.6 : 0.2;
    evidence.push(`cardinality ${(distinctRatio * 100).toFixed(0)}%`);
  }
  if (spec.low_cardinality) {
    const distinctRatio = sample.distinctCount / sample.values.length;
    score *= distinctRatio < 0.1 ? 1 : distinctRatio < 0.3 ? 0.6 : 0.2;
    evidence.push(`cardinality ${(distinctRatio * 100).toFixed(0)}%`);
  }
  if (spec.numeric) {
    let n = 0;
    for (const v of sample.values) {
      if (Number.isFinite(Number(v))) n++;
    }
    const ratio = n / sample.values.length;
    score *= ratio;
    evidence.push(`numeric ${(ratio * 100).toFixed(0)}%`);
  }
  if (spec.min_length !== undefined || spec.max_length !== undefined) {
    const minL = spec.min_length ?? 0;
    const maxL = spec.max_length ?? Number.POSITIVE_INFINITY;
    let inLen = 0;
    for (const v of sample.values) {
      if (v.length >= minL && v.length <= maxL) inLen++;
    }
    const ratio = inLen / sample.values.length;
    score *= ratio;
    evidence.push(
      `length∈[${minL},${maxL === Number.POSITIVE_INFINITY ? '∞' : maxL}] ${(ratio * 100).toFixed(0)}%`,
    );
  }
  return { score, applicable: true, evidence: evidence.join(', ') };
}

function inapplicable(): DetectorResult {
  return { score: 0, applicable: false, evidence: '' };
}
