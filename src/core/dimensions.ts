// v1.4 F1 — Named dimensions.
//
// The non-aggregate parallel to the Measures layer (v1.3 M2): a named
// SQL fragment that fits a SELECT-list / GROUP BY slot, referenced via
// the `DIM(name)` macro and expanded at the SAME single point as
// `MEASURE(name)` (see `expandMeasures`). Typical dimensions:
//
//   month        : date_trunc('month', invoice_date)
//   gstin_state  : substr(vendor_gstin, 1, 2)
//   amount_band  : CASE WHEN amount < 1000 THEN 'small' ELSE 'large' END
//
// `SELECT DIM(gstin_state), MEASURE(revenue) FROM invoices GROUP BY 1`
// expands both macros before execution.
//
// **Engine-boundary contract (v1.3 M0):** no DOM, no FSA, no browser
// globals. The injection/keyword guard is shared with measures (a
// dimension body is the same "fragment in a query slot" shape).

import { validateMeasureExpression } from './measures.ts';

export interface DimensionDefinition {
  /** snake_case identifier; must match `[a-z_][a-z0-9_]*`. */
  name: string;
  /** Non-aggregate SQL fragment that fits a SELECT / GROUP BY slot. */
  expression: string;
  /** Short human-readable description. */
  description: string;
  /** Schema version. v1 only today. */
  version: 1;
}

export interface DimensionsFile {
  version: 1;
  dimensions: DimensionDefinition[];
}

export function emptyDimensionsFile(): DimensionsFile {
  return { version: 1, dimensions: [] };
}

/** Validate a dimension name — snake_case, starts with `[a-z_]`. */
export function validateDimensionName(name: string): string | null {
  if (!name) return 'Dimension name is required.';
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    return 'Dimension name must be snake_case: lowercase letters, digits, underscores, starting with letter or underscore.';
  }
  if (name.length > 64) return 'Dimension name must be ≤ 64 chars.';
  return null;
}

/**
 * Validate a dimension expression. Reuses the measure expression guard
 * (no semicolons, no DDL/DML keywords) — a dimension body is the same
 * "SQL fragment in a query slot" shape as a measure body.
 */
export function validateDimensionExpression(expression: string): string | null {
  return validateMeasureExpression(expression);
}

const DIM_CALL_RE = /\bDIM\(([a-z_][a-z0-9_]*)\)/g;

/** Identify which dimensions a SQL string references (panel usage count). */
export function findReferencedDimensions(sql: string): string[] {
  const found = new Set<string>();
  for (const m of sql.matchAll(DIM_CALL_RE)) {
    if (m[1]) found.add(m[1]);
  }
  return Array.from(found);
}

/** Validate a whole dimensions file: per-name + per-expression + uniqueness. */
export function validateDimensionsFile(file: DimensionsFile): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const d of file.dimensions) {
    const nameErr = validateDimensionName(d.name);
    if (nameErr) errors.push(`${d.name || '(unnamed)'}: ${nameErr}`);
    if (seen.has(d.name)) errors.push(`${d.name}: duplicate name.`);
    else if (d.name) seen.add(d.name);
    const exprErr = validateDimensionExpression(d.expression);
    if (exprErr) errors.push(`${d.name}: ${exprErr}`);
  }
  return errors;
}

/**
 * Singleton store for dimensions. Mirrors `MeasuresStore` — observable,
 * IDB-compatible toFile/loadFromFile, and an `asMap()` the macro
 * expander consumes.
 */
export class DimensionsStore {
  private dimensions = new Map<string, DimensionDefinition>();
  private listeners = new Set<(dimensions: ReadonlyArray<DimensionDefinition>) => void>();

  list(): ReadonlyArray<DimensionDefinition> {
    return Array.from(this.dimensions.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): DimensionDefinition | undefined {
    return this.dimensions.get(name);
  }

  asMap(): ReadonlyMap<string, DimensionDefinition> {
    return this.dimensions;
  }

  set(def: DimensionDefinition): void {
    if (!/^[a-z_][a-z0-9_]*$/.test(def.name)) {
      throw new Error(`Invalid dimension name: ${def.name}`);
    }
    this.dimensions.set(def.name, def);
    this.notify();
  }

  remove(name: string): void {
    if (this.dimensions.delete(name)) this.notify();
  }

  loadFromFile(file: DimensionsFile | undefined): void {
    this.dimensions.clear();
    if (file && file.version === 1) {
      for (const d of file.dimensions) this.dimensions.set(d.name, d);
    }
    this.notify();
  }

  toFile(): DimensionsFile {
    return { version: 1, dimensions: this.list() as DimensionDefinition[] };
  }

  subscribe(fn: (dimensions: ReadonlyArray<DimensionDefinition>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    const snapshot = this.list();
    for (const fn of this.listeners) fn(snapshot);
  }
}

let _store: DimensionsStore | null = null;

export function getDimensionsStore(): DimensionsStore {
  if (!_store) _store = new DimensionsStore();
  return _store;
}
