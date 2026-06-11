// v1.3 M2 — Measures Layer.
//
// Cognos Framework Manager, shrunk to a local file. Named, versioned
// SQL fragments that the notebook substitutes into queries via the
// single `MEASURE(name)` macro point.
//
// **Engine-boundary contract (v1.3 M0 lint):** no DOM, no FSA, no
// browser globals. Pure types + the audited macro expander.
//
// **Single expansion point** (handoff §M2): the only place
// `MEASURE(name)` becomes its definition is `expandMeasures` below.
// No second SQL dialect — measures are named fragments, not a new
// language.
//
// **Expression contract:**
// A measure's `expression` is a SQL fragment that fits inside the
// SELECT list of an outer query. Typically a filtered aggregate
// using DuckDB's `FILTER (WHERE ...)` clause:
//
//   revenue: SUM(amount) FILTER (WHERE status = 'completed')
//
// Then `SELECT MEASURE(revenue) FROM invoices` expands to:
//
//   SELECT SUM(amount) FILTER (WHERE status = 'completed') FROM invoices
//
// — valid SQL the engine compiles directly. Measures can reference
// other measures via nested MEASURE() calls; the expander is recursive
// with a depth cap.

export type MeasureFormat =
  | 'number'
  | 'currency_inr'
  | 'currency_usd'
  | 'currency_eur'
  | 'percent'
  | 'count';

export interface MeasureDefinition {
  /** snake_case identifier; must match `[a-z_][a-z0-9_]*`. */
  name: string;
  /** SQL fragment that fits in a SELECT-list slot. Typically a filtered
   *  aggregate using `FILTER (WHERE ...)`. May reference other measures
   *  via nested `MEASURE(other_name)` calls. */
  expression: string;
  /** Display formatting hint for chart cells / pivot cells / KPI tiles.
   *  Does NOT affect the SQL — the SQL returns raw numbers. */
  format: MeasureFormat;
  /** Short human-readable description. */
  description: string;
  /** Optional list of taxonomy typeIds the measure needs to be
   *  applicable. Used by the taxonomy-synergy panel ("this file
   *  supports: revenue, order_count"). Empty / undefined means
   *  "always applicable." */
  requiredTypes?: string[];
  /** Schema version. v1 only today. */
  version: 1;
}

export interface MeasuresFile {
  version: 1;
  measures: MeasureDefinition[];
}

/** Empty measures file — used as the default in the persistence
 *  layer for `.naklidata` files saved before v1.3. */
export function emptyMeasuresFile(): MeasuresFile {
  return { version: 1, measures: [] };
}

/**
 * Validate a measure name — snake_case, starts with `[a-z_]`.
 * Returns null if valid, an error string otherwise.
 */
export function validateMeasureName(name: string): string | null {
  if (!name) return 'Measure name is required.';
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    return 'Measure name must be snake_case: lowercase letters, digits, underscores, starting with letter or underscore.';
  }
  if (name.length > 64) {
    return 'Measure name must be ≤ 64 chars.';
  }
  return null;
}

/**
 * Validate that a measure expression doesn't include obviously-broken
 * SQL shapes (statement terminators, dangerous SQL keywords). NOT a
 * full parser — the goal is to catch obvious mistakes early; DuckDB
 * will report semantic errors at run time.
 *
 * Rejects:
 *   - empty / whitespace-only expressions
 *   - semicolons (would close the outer SELECT)
 *   - bare keywords that have no place in a SELECT-slot: INSERT /
 *     UPDATE / DELETE / DROP / ALTER / CREATE / GRANT / REVOKE /
 *     TRUNCATE / ATTACH / DETACH / PRAGMA / SET / INSTALL / LOAD /
 *     COPY / EXPORT
 */
const FORBIDDEN_KEYWORDS = new Set([
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'CREATE',
  'GRANT',
  'REVOKE',
  'TRUNCATE',
  'ATTACH',
  'DETACH',
  'PRAGMA',
  'SET',
  'INSTALL',
  'LOAD',
  'COPY',
  'EXPORT',
  'CALL',
  'MERGE',
  'RESET',
  'USE',
]);

export function validateMeasureExpression(expression: string): string | null {
  const trimmed = expression.trim();
  if (!trimmed) return 'Expression is required.';
  // Strip string literals, double-quoted identifiers, and line / block
  // comments before the keyword check so a string like `'INSERT'` OR a
  // column named `"insert"` doesn't false-trip (forward-pass M2).
  const stripped = trimmed
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  if (stripped.includes(';')) {
    return 'Expression cannot contain semicolons.';
  }
  // Tokenize on word boundaries; check each token against the keyword
  // allowlist. Case-insensitive.
  const tokens = stripped.toUpperCase().split(/\b/);
  for (const tok of tokens) {
    if (FORBIDDEN_KEYWORDS.has(tok.trim())) {
      return `Expression contains forbidden keyword: ${tok.trim()}`;
    }
  }
  return null;
}

/**
 * Validate an entire measure file's contents — name uniqueness +
 * each measure's name + expression individually.
 * Returns an array of error strings (empty when valid).
 */
export function validateMeasuresFile(file: MeasuresFile): string[] {
  const errors: string[] = [];
  const seenNames = new Set<string>();
  for (const m of file.measures) {
    const nameErr = validateMeasureName(m.name);
    if (nameErr) errors.push(`${m.name || '(unnamed)'}: ${nameErr}`);
    if (seenNames.has(m.name)) {
      errors.push(`${m.name}: duplicate name.`);
    } else if (m.name) {
      seenNames.add(m.name);
    }
    const exprErr = validateMeasureExpression(m.expression);
    if (exprErr) errors.push(`${m.name}: ${exprErr}`);
  }
  // M32 — static cycle pre-pass. expandMeasures has a runtime MAX_DEPTH
  // guard, but catching a cyclic `MEASURE(...)` graph here surfaces a
  // clear error at edit time instead of a depth-cap failure at run time.
  errors.push(...detectMeasureCycles(file.measures));
  return errors;
}

/**
 * Detect cycles in the `MEASURE(name)` reference graph (M32). Returns one
 * error per distinct cycle; references to unknown measures are ignored
 * here (the expansion path reports those).
 */
function detectMeasureCycles(measures: ReadonlyArray<MeasureDefinition>): string[] {
  const deps = new Map<string, string[]>();
  for (const m of measures) {
    if (!m.name) continue;
    const refs = [...m.expression.matchAll(MEASURE_CALL_RE)]
      .map((x) => x[1])
      .filter((r): r is string => !!r);
    deps.set(m.name, refs);
  }
  const errors: string[] = [];
  const reported = new Set<string>();
  const onStack = new Set<string>();
  const done = new Set<string>();
  const dfs = (name: string, path: string[]): void => {
    onStack.add(name);
    for (const dep of deps.get(name) ?? []) {
      if (!deps.has(dep)) continue; // unknown measure — not our concern
      if (onStack.has(dep)) {
        const members = path.slice(path.indexOf(dep));
        const key = [...members].sort().join(',');
        if (!reported.has(key)) {
          reported.add(key);
          errors.push(`${dep}: cyclic measure reference (${[...members, dep].join(' → ')}).`);
        }
      } else if (!done.has(dep)) {
        dfs(dep, [...path, dep]);
      }
    }
    onStack.delete(name);
    done.add(name);
  };
  for (const name of deps.keys()) {
    if (!done.has(name)) dfs(name, [name]);
  }
  return errors;
}

/**
 * Result of expanding a SQL string against a measures map. The
 * caller logs `expansions` for audit + passes `sql` to the engine.
 *
 * `expansions` is in expansion-order (outer first, then nested
 * substitutions). `unknownMeasures` collects any `MEASURE(name)`
 * references whose `name` isn't in the measures map — the caller
 * decides whether to throw or surface the issue.
 */
export interface MeasureExpansionResult {
  sql: string;
  expansions: Array<{ name: string; expression: string }>;
  unknownMeasures: string[];
}

const MEASURE_CALL_RE = /\bMEASURE\(([a-z_][a-z0-9_]*)\)/g;
const MAX_DEPTH = 10;

/**
 * Expand `MEASURE(name)` calls in `sql` recursively. Iteratively
 * substitutes until no `MEASURE(` calls remain OR the depth cap
 * (`MAX_DEPTH`) is hit (loud failure — defence against a malicious
 * cyclic definition that survived `validateMeasuresFile`).
 *
 * The single audited expansion point (handoff §M2). All callers
 * (notebook cell-run, chart cell render, sidecar dispatcher) go
 * through this function.
 */
export function expandMeasures(
  sql: string,
  measures: ReadonlyMap<string, MeasureDefinition>,
): MeasureExpansionResult {
  const expansions: Array<{ name: string; expression: string }> = [];
  const unknownMeasures: string[] = [];
  let current = sql;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const seenAny = MEASURE_CALL_RE.test(current);
    MEASURE_CALL_RE.lastIndex = 0;
    if (!seenAny) {
      return { sql: current, expansions, unknownMeasures };
    }
    current = current.replace(MEASURE_CALL_RE, (_match, name: string) => {
      const def = measures.get(name);
      if (!def) {
        if (!unknownMeasures.includes(name)) unknownMeasures.push(name);
        // Leave the call in place so the caller can see what's unknown
        // OR substitute with NULL — choosing NULL because it keeps the
        // outer SQL well-formed (the user gets a column of nulls + the
        // unknown-measures list as a parser-level diagnostic).
        return 'NULL';
      }
      expansions.push({ name, expression: def.expression });
      return `(${def.expression})`;
    });
  }
  throw new Error(
    `Measure expansion exceeded depth cap (${MAX_DEPTH}) — likely a cyclic definition. Expansions so far: ${expansions.map((e) => e.name).join(' → ')}`,
  );
}

/**
 * Identify which measures are referenced in a SQL string (without
 * actually expanding them). Used by the measures panel to show
 * "this measure is used by N cells" before allowing edit.
 */
export function findReferencedMeasures(sql: string): string[] {
  const found = new Set<string>();
  for (const match of sql.matchAll(MEASURE_CALL_RE)) {
    if (match[1]) found.add(match[1]);
  }
  return Array.from(found);
}

/**
 * Filter the measures applicable to a given set of available
 * taxonomy types — used by the "this file supports..." synergy
 * panel.
 *
 * A measure is applicable when every typeId in its `requiredTypes`
 * list is present in `availableTypes`. Measures with no
 * `requiredTypes` are always applicable.
 */
export function applicableMeasures(
  measures: ReadonlyArray<MeasureDefinition>,
  availableTypes: ReadonlyArray<string>,
): MeasureDefinition[] {
  const avail = new Set(availableTypes);
  return measures.filter((m) => {
    if (!m.requiredTypes || m.requiredTypes.length === 0) return true;
    return m.requiredTypes.every((t) => avail.has(t));
  });
}
