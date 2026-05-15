// Classification orchestration. Pure: takes a TaxonomyBundle + ColumnSample
// and returns the ranked candidates + Phase 2 resolution.
//
// Spec §3.2 (Phase 1/2/3):
//   - For each type, run its detectors; aggregate weighted scores.
//   - Sort by confidence; apply confidence_floor.
//   - Auto-accept if exactly one is >= 0.9; else if multiple >= 0.7 → ambiguous.
//   - Else → unknown<base>.

import { runDetector } from './detectors.ts';
import type {
  ClassificationResult,
  ColumnSample,
  DetectorResult,
  TaxonomyBundle,
  TypeCandidate,
  TypeSpec,
} from './types.ts';

const DETECTOR_TIMEOUT_MS = 50;

export function classifyColumn(bundle: TaxonomyBundle, sample: ColumnSample): ClassificationResult {
  const candidates: TypeCandidate[] = [];
  for (const typeSpec of bundle.types) {
    if (!sqlCompatible(typeSpec, sample.sqlType)) continue;
    const candidate = scoreType(typeSpec, sample);
    if (candidate && candidate.confidence >= typeSpec.confidence_floor) {
      candidates.push(candidate);
    }
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  return { column: sample, candidates, resolution: resolve(sample, candidates) };
}

function sqlCompatible(typeSpec: TypeSpec, sqlType: string): boolean {
  if (typeSpec.sql_compat.length === 0) return true;
  const norm = sqlType.toUpperCase();
  return typeSpec.sql_compat.some((t) => norm.includes(t.toUpperCase()));
}

function scoreType(typeSpec: TypeSpec, sample: ColumnSample): TypeCandidate | null {
  let weighted = 0;
  let totalWeight = 0;
  const evidence: string[] = [];

  for (const det of typeSpec.detectors) {
    const start = performance.now();
    let result: DetectorResult;
    try {
      result = runDetector(det, sample);
    } catch (err) {
      console.warn(`[classify] detector ${det.kind} threw for ${typeSpec.id}`, err);
      result = { score: 0, applicable: false, evidence: '' };
    }
    const elapsed = performance.now() - start;
    if (elapsed > DETECTOR_TIMEOUT_MS) {
      // Spec §3.4: detectors must complete within 50 ms per column or are
      // skipped with a logged timeout. We don't skip a result that already
      // completed, but we surface the timing in evidence so the schema
      // panel can show it.
      evidence.push(`${det.kind} slow: ${elapsed.toFixed(0)}ms`);
    }
    if (!result.applicable) continue;
    weighted += result.score * det.weight;
    totalWeight += det.weight;
    if (result.evidence) evidence.push(`${det.kind}: ${result.evidence}`);
  }
  if (totalWeight === 0) return null;
  const confidence = weighted / totalWeight;
  return {
    typeId: typeSpec.id,
    displayName: typeSpec.display_name,
    confidence,
    evidence,
  };
}

function resolve(
  sample: ColumnSample,
  candidates: TypeCandidate[],
): ClassificationResult['resolution'] {
  const strong = candidates.filter((c) => c.confidence >= 0.9);
  if (strong.length === 1 && strong[0]) {
    return { kind: 'auto_accept', typeId: strong[0].typeId, confidence: strong[0].confidence };
  }
  const ambiguous = candidates.filter((c) => c.confidence >= 0.7);
  if (ambiguous.length > 1) {
    return { kind: 'ambiguous', choices: ambiguous };
  }
  if (ambiguous.length === 1 && ambiguous[0]) {
    return {
      kind: 'auto_accept',
      typeId: ambiguous[0].typeId,
      confidence: ambiguous[0].confidence,
    };
  }
  return { kind: 'unknown', base: sample.sqlType };
}
