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
  /** The Tier-3 analytical family for `typeId`. `'entity'` is the taxonomy's
   *  own notion of "this column identifies something" — which is exactly the
   *  guard a dedupe suggestion needs, and far better than regexing the name. */
  roleFamily: 'entity' | 'dimension' | 'measure' | 'metric' | null;
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

/** One worked example of what a fix does, computed from the sample. */
export interface FixPreviewRow {
  before: string;
  after: string;
}

export interface SuggestedFix extends FixEvidence {
  /** Stable id (`trim`, `fill-nulls`, …) — used as the click target. */
  id: string;
  /** Short imperative label for the affordance. */
  label: string;
  /** The SQL this fix would emit as a NEW, UN-RUN cell (EJ-1). */
  sql: string;
  /**
   * Up to 3 before/after examples. C2's reshaping fixes (split, extract) change
   * a value's SHAPE, not just its whitespace — a user has to SEE the effect
   * before accepting, and computing it here from the existing sample means no
   * engine round-trip and no preview that can disagree with the emitted SQL.
   * Empty for fixes whose effect is obvious from the label.
   */
  preview: FixPreviewRow[];
}

/** A fix definition. `detect` returns null when the fix doesn't apply. */
interface FixDefinition {
  id: string;
  label: string;
  detect(facts: ColumnFacts): FixEvidence | null;
  emit(facts: ColumnFacts, ev: FixEvidence): string;
  /** Optional worked examples from the sample (C2 reshaping fixes). */
  preview?(facts: ColumnFacts): FixPreviewRow[];
}

export interface SuggestOptions {
  /** Minimum affected fraction to surface a fix. EJ-3 — default 1%. */
  impactFloor?: number;
}

export interface TableFixFacts {
  table: string;
  columns: readonly ColumnFacts[];
  /** Association participation is conservatively treated as foreign-key risk. */
  associatedColumns: readonly string[];
}

export interface SuggestedTableFix extends SuggestedFix {
  columns: string[];
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

// ── C2 — reshaping fixes. These change a value's SHAPE, so each one ships a
//    before/after preview (computed from the same sample the detector used).

/** Delimiters worth splitting on, most specific first so `", "` wins over `","`. */
const SPLIT_DELIMS = [', ', ' | ', ' - ', ';', ',', '|', '\t'] as const;

/** The delimiter that splits (nearly) every sampled value into the same number
 *  of parts (≥2). Returns null when the column isn't consistently delimited —
 *  a half-delimited column is not a split candidate, it's a mess. */
function detectDelimiter(
  values: readonly string[],
): { delim: string; parts: number; affected: number } | null {
  const nonEmpty = values.filter((v) => v.trim() !== '');
  if (nonEmpty.length === 0) return null;
  for (const delim of SPLIT_DELIMS) {
    const counts = nonEmpty.map((v) => v.split(delim).length);
    const parts = counts[0] ?? 1;
    if (parts < 2) continue;
    const agree = counts.filter((c) => c === parts).length;
    // Demand near-total agreement: splitting on a delimiter that only some rows
    // have silently produces NULL columns for the rest.
    if (agree / nonEmpty.length >= 0.9) {
      return { delim, parts, affected: agree };
    }
  }
  return null;
}

/**
 * The number in a value like "Stay 5 days", if there is exactly one and it
 * stands alone.
 *
 * "Stands alone" is the load-bearing rule. An earlier version accepted digits
 * glued to letters, which made this fire on every IDENTIFIER in the smoke
 * fixture — `vendor_id` "V0001", `pan` "HBHZW6406C", `ifsc` "PUNB0ZMUBTG" —
 * suggesting we extract "the number" from a PAN code. A measure spells its
 * number as its own whitespace-delimited token; a code does not. Requiring a
 * second, non-numeric token also excludes plain numbers ("42"), which have
 * nothing to extract.
 */
function embeddedNumber(value: string): string | null {
  const toks = value.trim().split(/\s+/).filter(Boolean);
  if (toks.length < 2) return null;
  const nums = toks.filter((t) => /^\d+(?:\.\d+)?$/.test(t));
  return nums.length === 1 ? (nums[0] ?? null) : null;
}

/**
 * Extracting an arbitrary digit is only useful when the column itself signals
 * a numeric output. Narrative semantics are an explicit stop even if a future
 * alias happens to contain a numeric-looking word. Unknown columns need a
 * conservative measure-bearing header; recognized measures/metrics already
 * provide stronger semantic evidence.
 */
function signalsNumericOutput(facts: ColumnFacts): boolean {
  if (
    facts.typeId &&
    /(?:name|title|description|reason|address|json|text|comment|note)$/.test(facts.typeId)
  ) {
    return false;
  }
  if (facts.roleFamily === 'measure' || facts.roleFamily === 'metric') return true;
  const header = facts.column
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
  return /(?:^|_)(?:amount|age|count|days?|distance|duration|fare|hours?|installments?|latency|length|minutes?|price|quantity|rate|score|seconds?|size|tenure|weight|width|height)(?:_|$)/.test(
    header,
  );
}

// C3 (row dedupe) is PARKED — see plan/pending.md and DECISIONS EK.
//
// A per-column registry cannot tell a PRIMARY key from a FOREIGN key, and a
// foreign key repeating is not a defect, it is the entire point of one. The
// first attempt suggested "keep one row per key" for `vendor_gstin` on an
// INVOICES table (160 sampled values, 24 distinct) — advice that would delete
// 85% of the invoices. Dedupe needs table-level context (which column is the
// grain) and belongs with the other table-level fixes.

const C2_FIXES: FixDefinition[] = [
  {
    id: 'split-column',
    label: 'Split into columns',
    detect(facts) {
      if (!isTextual(facts.sqlType) || facts.sampleValues.length === 0) return null;
      const d = detectDelimiter(facts.sampleValues);
      if (!d) return null;
      const fraction = d.affected / facts.sampleValues.length;
      return {
        affected: d.affected,
        fraction,
        rationale: `${d.affected} of ${facts.sampleValues.length} sampled values split into ${d.parts} parts on "${d.delim}" — one column is holding ${d.parts} fields.`,
      };
    },
    emit(facts, ev) {
      const d = detectDelimiter(facts.sampleValues);
      const col = quoteIdent(facts.column);
      const parts = d?.parts ?? 2;
      const delim = (d?.delim ?? ',').replace(/'/g, "''");
      const cols: string[] = [];
      for (let i = 1; i <= parts; i++) {
        cols.push(
          `  SPLIT_PART(${col}, '${delim}', ${i}) AS ${quoteIdent(`${facts.column}_${i}`)}`,
        );
      }
      // Adds columns rather than replacing — the original stays so the human can
      // compare before deleting it.
      return `-- Split "${facts.column}" on '${delim}' into ${parts} columns (${pct(ev.fraction)} of sampled values)\n-- The original column is kept; drop it once you're happy.\nSELECT *,\n${cols.join(',\n')}\nFROM ${quoteIdent(facts.table)}`;
    },
    preview(facts) {
      const d = detectDelimiter(facts.sampleValues);
      if (!d) return [];
      return facts.sampleValues
        .filter((v) => v.split(d.delim).length === d.parts)
        .slice(0, 3)
        .map((v) => ({ before: v, after: v.split(d.delim).join('  |  ') }));
    },
  },
  {
    id: 'extract-number',
    label: 'Extract as numeric measure',
    detect(facts) {
      if (
        !isTextual(facts.sqlType) ||
        facts.sampleValues.length === 0 ||
        !signalsNumericOutput(facts)
      ) {
        return null;
      }
      let affected = 0;
      let purelyNumeric = 0;
      for (const v of facts.sampleValues) {
        const t = v.trim();
        if (t === '') continue;
        if (/^\d+(\.\d+)?$/.test(t)) {
          purelyNumeric++;
          continue;
        }
        if (embeddedNumber(t) !== null) affected++;
      }
      // If the column is already all-numeric there is nothing to extract; the
      // fix is for numbers TRAPPED in text.
      if (affected === 0 || purelyNumeric > affected) return null;
      const fraction = affected / facts.sampleValues.length;
      return {
        affected,
        fraction,
        rationale: `${affected} of ${facts.sampleValues.length} sampled values hold a numeric measure inside text (e.g. "${facts.sampleValues.find((v) => embeddedNumber(v) !== null) ?? ''}") — the extracted output would be a numeric measure that can be summed or compared.`,
      };
    },
    emit(facts, ev) {
      const col = quoteIdent(facts.column);
      const alias = quoteIdent(`${facts.column}_number`);
      return `-- Extract the number from "${facts.column}" into a numeric column (${pct(ev.fraction)} of sampled values)\n-- The original column is kept; drop it once you're happy.\nSELECT *,\n  TRY_CAST(REGEXP_EXTRACT(${col}, '(?:^|\\s)(\\d+(?:\\.\\d+)?)(?:\\s|$)', 1) AS DOUBLE) AS ${alias}\nFROM ${quoteIdent(facts.table)}`;
    },
    preview(facts) {
      return facts.sampleValues
        .map((v) => ({ before: v.trim(), after: embeddedNumber(v) }))
        .filter((x): x is { before: string; after: string } => x.after !== null)
        .slice(0, 3);
    },
  },
];

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
  for (const def of [...FIXES, ...C2_FIXES]) {
    let ev: FixEvidence | null;
    try {
      ev = def.detect(facts);
    } catch {
      // A detector must never break the schema panel. Skip it and move on.
      continue;
    }
    if (!ev || ev.fraction < floor) continue;
    let preview: FixPreviewRow[] = [];
    try {
      preview = def.preview?.(facts) ?? [];
    } catch {
      preview = [];
    }
    out.push({ id: def.id, label: def.label, ...ev, sql: def.emit(facts, ev), preview });
  }
  return out.sort((a, b) => b.fraction - a.fraction);
}

/**
 * Pure table-context cleaning boundary. Every emitted query is additive or a
 * read-only row projection. No detector executes SQL or mutates source state.
 */
export function suggestTableFixes(facts: TableFixFacts): SuggestedTableFix[] {
  const suggestions: SuggestedTableFix[] = [];
  const associated = new Set(facts.associatedColumns);
  const grainCandidates = facts.columns.filter(
    (column) =>
      column.roleFamily === 'entity' &&
      isTableGrainName(facts.table, column.column) &&
      !associated.has(column.column),
  );
  if (grainCandidates.length === 1) {
    const key = grainCandidates[0];
    if (
      key &&
      key.sampledRows !== null &&
      key.distinctCount !== null &&
      key.sampledRows > 0 &&
      key.distinctCount < key.sampledRows
    ) {
      const duplicates = key.sampledRows - key.distinctCount;
      const fraction = duplicates / key.sampledRows;
      suggestions.push({
        id: 'dedupe-exact-rows',
        label: 'Remove exact duplicate rows',
        columns: [key.column],
        affected: duplicates,
        fraction,
        rationale: `${key.column} is the single table-grain candidate and repeats in ${duplicates} of ${key.sampledRows} sampled rows. DISTINCT removes only byte-for-byte duplicate rows; differing records with the same key remain for review.`,
        sql: `-- Remove exact duplicate rows; records that differ in any column remain.\nSELECT DISTINCT *\nFROM ${quoteIdent(facts.table)}`,
        preview: [
          {
            before: `${key.sampledRows} sampled rows; ${key.distinctCount} distinct ${key.column} values`,
            after: 'Only rows identical across every column collapse',
          },
        ],
      });
    }
  }

  for (const group of sameSemanticTypePairs(facts.columns)) {
    const [left, right] = group;
    if (!left || !right || left.roleFamily === 'entity' || right.roleFamily === 'entity') continue;
    if ((left.nullCount ?? 0) + (right.nullCount ?? 0) === 0) continue;
    const [primary, secondary] =
      compareNullBurden(left, right) <= 0 ? [left, right] : [right, left];
    const output = uniqueOutputName(
      `merged_${portableIdentifier(primary.typeId ?? primary.column)}`,
      facts.columns,
    );
    const collision = uniqueOutputName(`${output}_collision`, facts.columns, [output]);
    const p = quoteIdent(primary.column);
    const s = quoteIdent(secondary.column);
    suggestions.push({
      id: `merge-columns:${primary.column}:${secondary.column}`,
      label: `Merge ${primary.column} + ${secondary.column}`,
      columns: [primary.column, secondary.column],
      affected: (primary.nullCount ?? 0) + (secondary.nullCount ?? 0),
      fraction: Math.min(1, nullFraction(primary) + nullFraction(secondary)),
      rationale: `Both columns classify as ${primary.typeId}. ${primary.column} has precedence, NULL falls back to ${secondary.column}, and conflicting non-NULL values are flagged in ${collision}. Original columns stay present.`,
      sql: `-- Add a merged column with explicit precedence; preserve both inputs and flag conflicts.\nSELECT *,\n  COALESCE(${p}, ${s}) AS ${quoteIdent(output)},\n  (${p} IS NOT NULL AND ${s} IS NOT NULL AND ${p} IS DISTINCT FROM ${s}) AS ${quoteIdent(collision)}\nFROM ${quoteIdent(facts.table)}`,
      preview: [
        {
          before: `${primary.column} | ${secondary.column}`,
          after: `${output} = first non-NULL; ${collision} marks disagreements`,
        },
      ],
    });
  }

  for (const group of unpivotGroups(facts.columns)) {
    const period = uniqueOutputName('period', facts.columns);
    const value = uniqueOutputName(portableIdentifier(group.base) || 'value', facts.columns, [
      period,
    ]);
    const columns = group.columns.map((column) => column.column);
    suggestions.push({
      id: `unpivot:${group.base}`,
      label: `Unpivot ${group.base} columns`,
      columns,
      affected: columns.length,
      fraction: 1,
      rationale: `${columns.length} compatible year-labelled columns share the "${group.base}" stem. Unpivot preserves every other identifier column and adds deterministic ${period}/${value} outputs.`,
      sql: `-- Melt year columns into a long table; all unlisted identifier columns are preserved.\nUNPIVOT ${quoteIdent(facts.table)}\nON ${columns.map(quoteIdent).join(', ')}\nINTO\n  NAME ${quoteIdent(period)}\n  VALUE ${quoteIdent(value)}`,
      preview: [
        {
          before: columns.join(' | '),
          after: `${period} | ${value} (${columns.length} rows per input row)`,
        },
      ],
    });
  }

  return suggestions.sort((left, right) =>
    `${left.id}:${left.columns.join(':')}`.localeCompare(`${right.id}:${right.columns.join(':')}`),
  );
}

function isTableGrainName(table: string, column: string): boolean {
  const normalizedTable = portableIdentifier(table);
  const singular = normalizedTable.endsWith('ies')
    ? `${normalizedTable.slice(0, -3)}y`
    : normalizedTable.endsWith('s')
      ? normalizedTable.slice(0, -1)
      : normalizedTable;
  const normalizedColumn = portableIdentifier(column);
  return (
    normalizedColumn === 'id' ||
    normalizedColumn === `${singular}_id` ||
    normalizedColumn === `${singular}id`
  );
}

function sameSemanticTypePairs(columns: readonly ColumnFacts[]): ColumnFacts[][] {
  const groups = new Map<string, ColumnFacts[]>();
  for (const column of columns) {
    if (!column.typeId) continue;
    const current = groups.get(column.typeId) ?? [];
    current.push(column);
    groups.set(column.typeId, current);
  }
  return [...groups.values()].filter(
    (group) =>
      group.length === 2 &&
      new Set(group.map((column) => column.column.toLowerCase())).size === group.length,
  );
}

function compareNullBurden(left: ColumnFacts, right: ColumnFacts): number {
  const delta = nullFraction(left) - nullFraction(right);
  return delta === 0 ? left.column.localeCompare(right.column) : delta;
}

function nullFraction(column: ColumnFacts): number {
  return column.sampledRows && column.nullCount ? column.nullCount / column.sampledRows : 0;
}

function unpivotGroups(
  columns: readonly ColumnFacts[],
): Array<{ base: string; columns: ColumnFacts[] }> {
  const groups = new Map<string, ColumnFacts[]>();
  for (const column of columns) {
    const match = /^(.*?)[_-]?((?:19|20)\d{2})$/.exec(column.column);
    const base = match?.[1]?.replace(/[_-]+$/, '') ?? '';
    if (!base) continue;
    const key = `${base.toLowerCase()}::${sqlTypeFamily(column.sqlType)}`;
    const current = groups.get(key) ?? [];
    current.push(column);
    groups.set(key, current);
  }
  return [...groups.entries()]
    .filter(
      ([, group]) =>
        group.length >= 2 &&
        new Set(group.map((column) => column.column.toLowerCase())).size === group.length,
    )
    .map(([key, group]) => ({
      base: key.slice(0, key.indexOf('::')),
      columns: group.sort((left, right) => left.column.localeCompare(right.column)),
    }));
}

function sqlTypeFamily(sqlType: string): string {
  const type = sqlType.toUpperCase();
  if (/(?:INT|DECIMAL|NUMERIC|DOUBLE|FLOAT|REAL)/.test(type)) return 'numeric';
  if (/(?:CHAR|TEXT|STRING|VARCHAR)/.test(type)) return 'text';
  if (/(?:DATE|TIME)/.test(type)) return 'temporal';
  return type;
}

function uniqueOutputName(
  candidate: string,
  columns: readonly ColumnFacts[],
  reserved: readonly string[] = [],
): string {
  const occupied = new Set(
    [...columns.map((column) => column.column), ...reserved].map((value) => value.toLowerCase()),
  );
  let output = candidate || 'cleaned_value';
  let suffix = 2;
  while (occupied.has(output.toLowerCase())) output = `${candidate}_${suffix++}`;
  return output;
}

function portableIdentifier(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9]/, '_$&')
    .slice(0, 48);
}

/** The ids this build knows about — lets a caller (or a test) assert coverage
 *  without reaching into the private FIXES array. */
export function knownFixIds(): string[] {
  return [...FIXES, ...C2_FIXES].map((f) => f.id);
}
