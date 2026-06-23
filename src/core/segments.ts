// Resolve track M2 — Segment primitive (Audience).
//
// A named, reusable BOOLEAN PREDICATE over a table — the marketer-friendly
// "audience" of the Resolve track — referenced via the `SEGMENT(name)` macro
// and expanded at the SAME single point as `MEASURE(name)` / `DIM(name)` (see
// `expandMeasures`). Typical segments:
//
//   high_value_lapsed : total_amount > 100000 AND last_seen < '2026-01-01'
//   gst_registered    : vendor_gstin IS NOT NULL
//
// `SELECT * FROM invoices WHERE SEGMENT(high_value_lapsed)` expands the macro
// to `WHERE (total_amount > 100000 AND last_seen < '2026-01-01')` before
// execution — pure client-side macro expansion, never a new SQL dialect. The
// definition lives in the workbook description (the optional `segments` field),
// never the data; the cell the user runs is the artifact (Hard NOT #4).
//
// **Engine-boundary contract (v1.3 M0):** no DOM, no FSA, no browser globals.
// The injection/keyword guard is shared with measures (a segment body is the
// same "fragment in a query slot" shape — here a WHERE-clause predicate).

import { validateMeasureExpression } from './measures.ts';

export interface SegmentDefinition {
  /** snake_case identifier; must match `[a-z_][a-z0-9_]*`. */
  name: string;
  /** Boolean SQL predicate that fits a WHERE-clause slot. */
  expression: string;
  /** Short human-readable description. */
  description: string;
  /** Schema version. v1 only today. */
  version: 1;
}

export interface SegmentsFile {
  version: 1;
  segments: SegmentDefinition[];
}

export function emptySegmentsFile(): SegmentsFile {
  return { version: 1, segments: [] };
}

/** Validate a segment name — snake_case, starts with `[a-z_]`. */
export function validateSegmentName(name: string): string | null {
  if (!name) return 'Segment name is required.';
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    return 'Segment name must be snake_case: lowercase letters, digits, underscores, starting with letter or underscore.';
  }
  if (name.length > 64) return 'Segment name must be ≤ 64 chars.';
  return null;
}

/**
 * Validate a segment expression. Reuses the measure expression guard (no
 * semicolons, no DDL/DML keywords) — a segment body is the same "SQL fragment
 * in a query slot" shape, here a boolean WHERE-clause predicate.
 */
export function validateSegmentExpression(expression: string): string | null {
  return validateMeasureExpression(expression);
}

const SEGMENT_CALL_RE = /\bSEGMENT\(([a-z_][a-z0-9_]*)\)/g;

/** Identify which segments a SQL string references (panel usage count). */
export function findReferencedSegments(sql: string): string[] {
  const found = new Set<string>();
  for (const m of sql.matchAll(SEGMENT_CALL_RE)) {
    if (m[1]) found.add(m[1]);
  }
  return Array.from(found);
}

/** Validate a whole segments file: per-name + per-expression + uniqueness. */
export function validateSegmentsFile(file: SegmentsFile): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const s of file.segments) {
    const nameErr = validateSegmentName(s.name);
    if (nameErr) errors.push(`${s.name || '(unnamed)'}: ${nameErr}`);
    if (seen.has(s.name)) errors.push(`${s.name}: duplicate name.`);
    else if (s.name) seen.add(s.name);
    const exprErr = validateSegmentExpression(s.expression);
    if (exprErr) errors.push(`${s.name}: ${exprErr}`);
  }
  return errors;
}

/**
 * Singleton store for segments. Mirrors `DimensionsStore` — observable,
 * IDB-compatible toFile/loadFromFile, and an `asMap()` the macro expander
 * consumes.
 */
export class SegmentsStore {
  private segments = new Map<string, SegmentDefinition>();
  private listeners = new Set<(segments: ReadonlyArray<SegmentDefinition>) => void>();

  list(): ReadonlyArray<SegmentDefinition> {
    return Array.from(this.segments.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): SegmentDefinition | undefined {
    return this.segments.get(name);
  }

  asMap(): ReadonlyMap<string, SegmentDefinition> {
    return this.segments;
  }

  set(def: SegmentDefinition): void {
    if (!/^[a-z_][a-z0-9_]*$/.test(def.name)) {
      throw new Error(`Invalid segment name: ${def.name}`);
    }
    this.segments.set(def.name, def);
    this.notify();
  }

  remove(name: string): void {
    if (this.segments.delete(name)) this.notify();
  }

  loadFromFile(file: SegmentsFile | undefined): void {
    this.segments.clear();
    if (file && file.version === 1) {
      for (const s of file.segments) this.segments.set(s.name, s);
    }
    this.notify();
  }

  toFile(): SegmentsFile {
    return { version: 1, segments: this.list() as SegmentDefinition[] };
  }

  subscribe(fn: (segments: ReadonlyArray<SegmentDefinition>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    const snapshot = this.list();
    for (const fn of this.listeners) fn(snapshot);
  }
}

let _store: SegmentsStore | null = null;

export function getSegmentsStore(): SegmentsStore {
  if (!_store) _store = new SegmentsStore();
  return _store;
}
