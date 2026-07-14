# UniversalTerm (Tier-3) — Deferred

> **Lifecycle:** living

Items deliberately out of scope for this round. Each has a revisit trigger.

## Wire report/measure surfaces to consume `roleFamily`
- **What:** rewrite A1 `pickChartColumns` + A2 auto-measures + templates to read `roleFamily`
  (`x = dimension`, `y = measure`; `entity → COUNT(DISTINCT)`) instead of their ad-hoc heuristics.
- **Why deferred:** this round is spec + data + validator + the sensitivity migration. Rewiring the
  report engine is a separate behaviour change with its own gate.
- **Trigger:** once the universal layer ships + validates, and the next reporting/chart iteration is opened.

## Quality meta-role
- **What:** the `{expected_completeness, expected_uniqueness, valid_range}` quality annotations from
  the draft (§2.4) that would drive a future data-quality panel.
- **Why deferred:** no consumer exists yet; purely declarative until a quality panel is built.
- **Trigger:** when a data-quality panel is specced.

## Provenance meta-role
- **What:** `source | joined | computed | imputed` derivation annotation.
- **Why deferred:** interacts with the measures layer; no consumer this round.
- **Trigger:** when the measures layer records derivation formulas.

## FHIR/OCDS vertical domain packs
- **What:** full healthcare-FHIR / procurement-OCDS role packs (beyond the existing healthcare pack).
- **Why deferred:** the `exactMatch` links are authored now (decision #3), but the *packs* are breadth
  work for a later batch.
- **Trigger:** a future taxonomy-breadth session (the G-series batch).
