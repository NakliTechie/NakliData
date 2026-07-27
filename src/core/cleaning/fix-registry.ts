// Cleaning surface — the fix registry (chunk C0; DECISIONS EJ).
//
// Cleaning is the biggest measured gap in the job (25-45% of analyst time,
// coverage row 1) and the one place our semantic layer pays off twice: because
// we already know what a column MEANS, we can propose the fix instead of asking
// the user what the column is. This module is that proposal engine.
//
// Shape, per the ratified decisions:
//   EJ-1  every fix EMITS SQL for a new cell — never mutates a view or the
//         source. Propose-don't-execute, same posture as the agent surface, so
//         lineage stays honest and undo is "delete the cell".
//   EJ-2  the caller renders these on the schema-panel column row today; a
//         workbook-wide roll-up panel is a later addition, so this module is a
//         PURE per-column function with no surface coupling — a panel just maps
//         it over every column and groups the results.
//   EJ-3  suggestions are gated on an impact floor (default 1% of sampled
//         values). A clean file returns [] and shows nothing; that silence is
//         information.
//   EJ-4  no sidecar — every fix here is deterministic and taxonomy-driven.
//
// Engine-boundary clean: pure string/array work, no DOM/engine/globals. Adding
// a fix = adding one entry to FIXES; nothing else changes.

import { quoteIdent } from '../query-builder.ts';

/** Everything a fix needs to know about one column. Assembled by the caller
 *  from the workbook assignment + the column profile — no I/O in here. */
export interface ColumnFacts {
  /** Physical table name, used to build the emitted FROM clause. */
  table: string;
  column: string;
  /** DuckDB type as reported by DESCRIBE (`VARCHAR`, `BIGINT`, …). */
  sqlType: string;
  /** Taxonomy type id, or null when unclassified. */
  typeId: string | null;
  /** Sensitivity tier — a fix may want to behave differently on pii/secret. */
  sensitivity: 'public' | 'pii' | 'financial' | 'secret';
  /** Total rows in the table, when known. Display/context only — never mix it
   *  with the sample-scoped counts below to compute a fraction. */
  rowCount: number | null;
  /** Rows the sample covered. The denominator for `nullCount`. */
  sampledRows: number | null;
  /** Nulls WITHIN the sample (`sampledRows` is its denominator). */
  nullCount: number | null;
  /** Distinct non-null values, when known. */
  distinctCount: number | null;
  /** A sample of stringified values. Detection runs over this, so `fraction`
   *  is "of the sample", not of the table — the rationale says so. */
  sampleValues: readonly string[];
}

/** What a detector reports when it finds something worth fixing. */
export interface FixEvidence {
  /** How many sampled values (or rows, for row-level fixes) are affected. */
  affected: number;
  /** Affected / considered, 0..1. Compared against the impact floor. */
  fraction: number;
  /** Human sentence explaining WHY this is suggested. Shown verbatim. */
  rationale: string;
}

export interface SuggestedFix extends FixEvidence {
  /** Stable id (`trim`, `fill-nulls`, …) — used as the click target. */
  id: string;
  /** Short imperative label for the affordance. */
  label: string;
  /** The SQL this fix would emit as a NEW, UN-RUN cell (EJ-1). */
  sql: string;
}

/** A fix definition. `detect` returns null when the fix doesn't apply. */
interface FixDefinition {
  id: string;
  label: string;
  detect(facts: ColumnFacts): FixEvidence | null;
  emit(facts: ColumnFacts, ev: FixEvidence): string;
}

export interface SuggestOptions {
  /** Minimum affected fraction to surface a fix. EJ-3 — default 1%. */
  impactFloor?: number;
}

const DEFAULT_IMPACT_FLOOR = 0.01;

/** Text-ish columns are the only ones most string fixes make sense on. */
function isTextual(sqlType: string): boolean {
  const t = sqlType.toUpperCase();
  return t.includes('VARCHAR') || t.includes('CHAR') || t.includes('TEXT') || t.includes('STRING');
}

/** `pct(0.1234)` → `"12%"`; keeps one decimal under 10% so "0%" never lies. */
function pct(fraction: number): string {
  const p = fraction * 100;
  if (p > 0 && p < 10) return `${Math.round(p * 10) / 10}%`;
  return `${Math.round(p)}%`;
}

/**
 * Wrap a column-replacing expression as a whole-table SELECT. DuckDB's
 * `* REPLACE` keeps every other column untouched, which is exactly the shape a
 * cleaning fix wants — the emitted cell is a drop-in replacement for
 * `SELECT * FROM t`, readable and editable by the human who runs it (EJ-1).
 */
function emitReplace(facts: ColumnFacts, expr: string, comment: string): string {
  const col = quoteIdent(facts.column);
  return `-- ${comment}\nSELECT * REPLACE (${expr} AS ${col})\nFROM ${quoteIdent(facts.table)}`;
}

// ── The registry. Adding a fix means adding an entry here. ────────────────────

const FIXES: FixDefinition[] = [
  {
    id: 'trim',
    label: 'Trim whitespace',
    detect(facts) {
      if (!isTextual(facts.sqlType) || facts.sampleValues.length === 0) return null;
      let affected = 0;
      for (const v of facts.sampleValues) {
        if (v !== v.trim()) affected++;
      }
      if (affected === 0) return null;
      const fraction = affected / facts.sampleValues.length;
      return {
        affected,
        fraction,
        rationale: `${affected} of ${facts.sampleValues.length} sampled values (${pct(fraction)}) have leading or trailing whitespace.`,
      };
    },
    emit(facts, ev) {
      return emitReplace(
        facts,
        `TRIM(${quoteIdent(facts.column)})`,
        `Trim whitespace from "${facts.column}" (${pct(ev.fraction)} of sampled values affected)`,
      );
    },
  },

  // ── C1 ─────────────────────────────────────────────────────────────────────

  {
    // Placeholder strings that MEAN missing but aren't NULL, so every count,
    // average and join silently treats them as real data. The most valuable
    // member of the find-replace family, and the only one a registry can
    // suggest without being told what to look for.
    id: 'normalize-missing',
    label: 'Convert "N/A" to NULL',
    detect(facts) {
      if (!isTextual(facts.sqlType) || facts.sampleValues.length === 0) return null;
      let affected = 0;
      for (const v of facts.sampleValues) {
        if (MISSING_TOKENS.has(v.trim().toUpperCase())) affected++;
      }
      if (affected === 0) return null;
      const fraction = affected / facts.sampleValues.length;
      return {
        affected,
        fraction,
        rationale: `${affected} of ${facts.sampleValues.length} sampled values (${pct(fraction)}) are placeholders like "N/A" or "-" that mean missing but are not NULL, so aggregates silently count them.`,
      };
    },
    emit(facts, ev) {
      const col = quoteIdent(facts.column);
      const list = [...MISSING_TOKENS].map((t) => `'${t}'`).join(', ');
      return emitReplace(
        facts,
        `CASE WHEN UPPER(TRIM(${col})) IN (${list}) THEN NULL ELSE ${col} END`,
        `Convert missing-value placeholders in "${facts.column}" to real NULL (${pct(ev.fraction)} of sampled values)`,
      );
    },
  },
  {
    // Same value, different casing — splits every GROUP BY and join.
    id: 'normalize-case',
    label: 'Normalise casing',
    detect(facts) {
      if (!isTextual(facts.sqlType) || facts.sampleValues.length === 0) return null;
      const seen = new Set<string>();
      const lowered = new Set<string>();
      for (const v of facts.sampleValues) {
        const t = v.trim();
        if (!t) continue;
        seen.add(t);
        lowered.add(t.toLowerCase());
      }
      const collapsed = seen.size - lowered.size;
      if (collapsed <= 0) return null;
      const fraction = collapsed / Math.max(1, seen.size);
      return {
        affected: collapsed,
        fraction,
        rationale: `${seen.size} distinct sampled values collapse to ${lowered.size} when case is ignored — ${collapsed} are case variants of another value, which splits GROUP BY and joins.`,
      };
    },
    emit(facts, ev) {
      return emitReplace(
        facts,
        `LOWER(${quoteIdent(facts.column)})`,
        `Normalise casing in "${facts.column}" (${ev.affected} case-variant value(s)) — switch LOWER to UPPER or INITCAP if you prefer`,
      );
    },
  },
  {
    id: 'fill-nulls',
    label: 'Fill nulls',
    detect(facts) {
      const ev = nullEvidence(facts);
      if (!ev) return null;
      return {
        ...ev,
        rationale: `${ev.rationale} Filling keeps the rows; edit the fill value in the emitted cell.`,
      };
    },
    emit(facts, ev) {
      const col = quoteIdent(facts.column);
      const fill = isTextual(facts.sqlType) ? `''` : '0';
      return emitReplace(
        facts,
        `COALESCE(${col}, ${fill})`,
        `Fill nulls in "${facts.column}" (${pct(ev.fraction)} of sampled rows) — EDIT ${fill} to the value you actually want`,
      );
    },
  },
  {
    id: 'drop-null-rows',
    label: 'Drop rows with nulls',
    detect(facts) {
      const ev = nullEvidence(facts);
      if (!ev) return null;
      return {
        ...ev,
        rationale: `${ev.rationale} Dropping removes those rows entirely — check the count before you run it.`,
      };
    },
    emit(facts, ev) {
      const col = quoteIdent(facts.column);
      return `-- Drop rows where "${facts.column}" is NULL (${pct(ev.fraction)} of sampled rows)\nSELECT *\nFROM ${quoteIdent(facts.table)}\nWHERE ${col} IS NOT NULL`;
    },
  },
];

/** Placeholder strings that mean "missing". Uppercased for comparison. */
const MISSING_TOKENS = new Set(['N/A', 'NA', 'NULL', 'NONE', 'NIL', '-', '--', '?', '']);

/** Shared null detection for the fill/drop pair — both fire on the same
 *  condition and differ only in what the user wants done about it. */
function nullEvidence(facts: ColumnFacts): FixEvidence | null {
  const denom = facts.sampledRows;
  const nulls = facts.nullCount;
  if (denom == null || nulls == null || denom <= 0 || nulls <= 0) return null;
  const fraction = nulls / denom;
  return {
    affected: nulls,
    fraction,
    rationale: `${nulls} of ${denom} sampled rows (${pct(fraction)}) are NULL in "${facts.column}".`,
  };
}

/**
 * Rank the fixes worth offering for one column, most impactful first.
 *
 * Returns `[]` for a clean column — the caller should render nothing at all
 * rather than an empty affordance (EJ-3: silence is information).
 */
export function suggestFixes(facts: ColumnFacts, opts: SuggestOptions = {}): SuggestedFix[] {
  const floor = opts.impactFloor ?? DEFAULT_IMPACT_FLOOR;
  const out: SuggestedFix[] = [];
  for (const def of FIXES) {
    let ev: FixEvidence | null;
    try {
      ev = def.detect(facts);
    } catch {
      // A detector must never break the schema panel. Skip it and move on.
      continue;
    }
    if (!ev || ev.fraction < floor) continue;
    out.push({ id: def.id, label: def.label, ...ev, sql: def.emit(facts, ev) });
  }
  return out.sort((a, b) => b.fraction - a.fraction);
}

/** The ids this build knows about — lets a caller (or a test) assert coverage
 *  without reaching into the private FIXES array. */
export function knownFixIds(): string[] {
  return FIXES.map((f) => f.id);
}
