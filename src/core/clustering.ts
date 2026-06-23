// Resolve track M1 — clustering / fuzzy-merge core.
//
// Detect groups of variant spellings of a column's values
// (`Sharma Trading Co` = `Sharma Trading Co.` = `SHARMA TRADING CO`) and
// build an ADDITIVE CASE-expression that rewrites the column to canonical
// values as a new `<col>__merged` column. Two OpenRefine-standard methods:
//   1. Key collision (fingerprint) — default, no threshold.
//   2. Nearest neighbour (edit distance) — opt-in, threshold-driven,
//      blocked + capped at NN_MAX_DISTINCT distinct values (O(n²) guard).
//
// The artifact is a NEW SQL cell the user runs (Hard NOT #4). It's the
// source of truth — reproducible, replays via DuckDB with no model and no
// network. Mirrors the calc-field cell-emit path (src/core/calc-field.ts):
// "clustering is a CASE-flavoured calc-field."
//
// **Engine-boundary contract (v1.3 M0):** pure logic only — no DOM, no
// FSA, no browser globals. Identifier/literal quoting is delegated to the
// existing injection-safe emitter (query-builder.ts); this module never
// templates a user value into SQL without quoteIdent / quoteLiteral.

import { distance } from 'fastest-levenshtein';
import { quoteIdent, quoteLiteral } from './query-builder.ts';

/** A distinct source value + how many rows carry it (from `GROUP BY 1`). */
export interface ValueCount {
  value: string;
  count: number;
}

/** A detected group of variant values that mean the same thing. */
export interface Cluster {
  /** Proposed canonical value (default = most frequent → longest → lexicographic). */
  canonical: string;
  /** Variant values in this cluster (canonical's source value included), with counts. */
  values: ValueCount[];
}

export type ClusterMethod = 'key-collision' | 'nearest-neighbour';

export interface ClusterRunResult {
  clusters: Cluster[];
  /**
   * Nearest-neighbour only: distinct-value count exceeded NN_MAX_DISTINCT,
   * so NN was skipped (the UI shows "too many distinct values — use key
   * collision"). Always false for key collision.
   */
  tooMany: boolean;
}

export const NN_DEFAULT_THRESHOLD = 0.85;
export const NN_MIN_THRESHOLD = 0.7;
export const NN_MAX_THRESHOLD = 0.95;
/** Above this many distinct values, nearest-neighbour is disabled (O(n²) guard). */
export const NN_MAX_DISTINCT = 5000;
/** Default suffix for the emitted merged column. */
export const DEFAULT_ALIAS_SUFFIX = '__merged';

// ── Fingerprint (key-collision keystone) ────────────────────────────────

/**
 * OpenRefine-style fingerprint: a normalized key such that variant
 * spellings collide. Steps (order matters):
 *   1. toString → trim → lowercase
 *   2. ASCII-fold diacritics (NFKD normalize, strip combining marks)
 *   3. remove punctuation / control chars (keep alphanumerics + spaces)
 *   4. collapse internal whitespace to single spaces
 *   5. split on whitespace → dedupe tokens → sort ascending → join with ' '
 *
 * So "Sharma Trading Co." / "SHARMA TRADING CO" → "co sharma trading", and
 * token-reordered "John Smith" / "Smith John" → "john smith". A value that
 * reduces to the empty string (all punctuation/whitespace) is NOT
 * clusterable and callers skip it.
 */
export function fingerprint(value: string): string {
  const lowered = String(value).trim().toLowerCase();
  // NFKD + strip combining marks (U+0300–U+036F) folds é→e, ñ→n, etc.
  const folded = lowered.normalize('NFKD').replace(/\p{M}/gu, '');
  // Delete everything that isn't a letter, digit, or whitespace.
  const cleaned = folded.replace(/[^\p{L}\p{N}\s]/gu, '');
  const tokens = cleaned.split(/\s+/).filter((t) => t.length > 0);
  const unique = [...new Set(tokens)].sort();
  return unique.join(' ');
}

// ── Canonical selection ─────────────────────────────────────────────────

function isBetterCanonical(c: ValueCount, best: ValueCount): boolean {
  // Most frequent → longest → lexicographically first. Deterministic.
  if (c.count !== best.count) return c.count > best.count;
  if (c.value.length !== best.value.length) return c.value.length > best.value.length;
  return c.value < best.value;
}

/**
 * Canonical default for a cluster: most frequent raw value; ties broken by
 * longest, then lexicographically first. Deterministic and stable.
 */
export function pickCanonical(values: ReadonlyArray<ValueCount>): string {
  let best: ValueCount | null = null;
  for (const c of values) {
    if (best === null || isBetterCanonical(c, best)) best = c;
  }
  return best?.value ?? '';
}

// ── Key collision (fingerprint) clustering ──────────────────────────────

/**
 * Group distinct values by fingerprint. A group with ≥2 distinct source
 * values is a cluster; singletons are not. Clusters are returned
 * most-impactful-first (descending total row count, ties by canonical).
 */
export function clusterByKeyCollision(values: ReadonlyArray<ValueCount>): Cluster[] {
  const merged = mergeValueCounts(values);
  const groups = new Map<string, ValueCount[]>();
  for (const vc of merged) {
    const fp = fingerprint(vc.value);
    if (fp === '') continue; // all-punctuation/empty — not clusterable
    const bucket = groups.get(fp);
    if (bucket) bucket.push(vc);
    else groups.set(fp, [vc]);
  }
  const clusters: Cluster[] = [];
  for (const bucket of groups.values()) {
    if (bucket.length < 2) continue; // singleton — not a cluster
    clusters.push(makeCluster(bucket));
  }
  return sortClusters(clusters);
}

// ── Nearest neighbour (edit distance) clustering ────────────────────────

/**
 * Normalized Levenshtein similarity in [0, 1]: 1 - distance/max(len). Both
 * sides are trimmed + lowercased first (case/whitespace variants score 1.0;
 * the case the user opted into NN to also catch). Two empty strings → 1.
 */
export function similarity(a: string, b: string): number {
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - distance(na, nb) / maxLen;
}

export function clampThreshold(t: number): number {
  if (!Number.isFinite(t)) return NN_DEFAULT_THRESHOLD;
  return Math.min(NN_MAX_THRESHOLD, Math.max(NN_MIN_THRESHOLD, t));
}

/** Normalize a value the same way `similarity` does, for length pruning. */
function normLen(value: string): number {
  return value.trim().toLowerCase().length;
}

/**
 * Nearest-neighbour clustering with greedy single-link (union-find).
 *
 * Blocking (handoff §3.2 — "block before pairwise compare"): values are
 * grouped by their first fingerprint char; within each group, sorted by
 * normalized length, a pair is only compared when its lengths could meet
 * the threshold (`len_j ≤ len_i / t`, since `sim ≥ t ⟹ |Δlen| ≤ (1-t)·maxLen`).
 * Because the group is length-sorted ascending, once that bound is crossed
 * every later `j` also fails, so we break. This is EXACT within a first-char
 * block — no length-boundary misses — while still pruning the O(n²) compare
 * to a small window. The one residual approximation is first-char blocking
 * (a leading-character typo lands in a different block); the deterministic
 * key-collision method + the AI pass cover that residue.
 *
 * Distinct values above NN_MAX_DISTINCT short-circuit to
 * `{clusters: [], tooMany: true}` — the caller disables NN and steers the
 * user to key collision.
 */
export function clusterByNearestNeighbour(
  values: ReadonlyArray<ValueCount>,
  threshold: number = NN_DEFAULT_THRESHOLD,
): ClusterRunResult {
  const merged = mergeValueCounts(values).filter((vc) => vc.value.trim() !== '');
  if (merged.length > NN_MAX_DISTINCT) {
    return { clusters: [], tooMany: true };
  }
  const t = clampThreshold(threshold);
  // Block by first fingerprint char.
  const charGroups = new Map<string, number[]>();
  merged.forEach((vc, i) => {
    const fp = fingerprint(vc.value);
    const key = fp.length > 0 ? (fp[0] ?? '') : '';
    const g = charGroups.get(key);
    if (g) g.push(i);
    else charGroups.set(key, [i]);
  });
  const uf = new UnionFind(merged.length);
  for (const group of charGroups.values()) {
    const sorted = group
      .map((idx) => ({ idx, len: normLen(merged[idx]?.value ?? '') }))
      .sort((a, b) => a.len - b.len);
    for (let i = 0; i < sorted.length; i++) {
      const ai = sorted[i]?.idx ?? 0;
      const la = sorted[i]?.len ?? 0;
      for (let j = i + 1; j < sorted.length; j++) {
        const lb = sorted[j]?.len ?? 0;
        // Length window: sim ≥ t is impossible once len_j > len_i / t.
        if (la > 0 && lb > la / t) break;
        const bj = sorted[j]?.idx ?? 0;
        if (similarity(merged[ai]?.value ?? '', merged[bj]?.value ?? '') >= t) uf.union(ai, bj);
      }
    }
  }
  const comps = new Map<number, ValueCount[]>();
  merged.forEach((vc, i) => {
    const root = uf.find(i);
    const c = comps.get(root);
    if (c) c.push(vc);
    else comps.set(root, [vc]);
  });
  const clusters: Cluster[] = [];
  for (const members of comps.values()) {
    if (members.length < 2) continue;
    clusters.push(makeCluster(members));
  }
  return { clusters: sortClusters(clusters), tooMany: false };
}

/** Dispatcher the UI (and the `window.naklidata.cluster` verb) calls. */
export function cluster(
  values: ReadonlyArray<ValueCount>,
  method: ClusterMethod,
  threshold: number = NN_DEFAULT_THRESHOLD,
): ClusterRunResult {
  if (method === 'nearest-neighbour') {
    return clusterByNearestNeighbour(values, threshold);
  }
  return { clusters: clusterByKeyCollision(values), tooMany: false };
}

/** A candidate pair for the sidecar to adjudicate (borderline — almost matched). */
export interface BorderlinePair {
  a: string;
  b: string;
  aCount: number;
  bCount: number;
}

/**
 * Pairs whose similarity lands in `[threshold - band, threshold)` — "almost
 * matched but below the bar". These are exactly the candidates the removable
 * sidecar job #8 (`propose-merge`) is asked to adjudicate; the deterministic
 * NN already groups everything at/above the threshold. Same first-char +
 * length-window blocking as NN, capped at NN_MAX_DISTINCT. Returns at most
 * `limit` pairs (highest combined row count first) to keep the prompt small
 * and the privacy surface narrow.
 */
export function borderlinePairs(
  values: ReadonlyArray<ValueCount>,
  threshold: number = NN_DEFAULT_THRESHOLD,
  opts?: { band?: number; limit?: number },
): BorderlinePair[] {
  const band = opts?.band ?? 0.1;
  const limit = opts?.limit ?? 20;
  const merged = mergeValueCounts(values).filter((vc) => vc.value.trim() !== '');
  if (merged.length > NN_MAX_DISTINCT) return [];
  const t = clampThreshold(threshold);
  const lo = Math.max(0, t - band);
  const charGroups = new Map<string, number[]>();
  merged.forEach((vc, i) => {
    const fp = fingerprint(vc.value);
    const key = fp.length > 0 ? (fp[0] ?? '') : '';
    const g = charGroups.get(key);
    if (g) g.push(i);
    else charGroups.set(key, [i]);
  });
  const found: Array<BorderlinePair & { weight: number }> = [];
  for (const group of charGroups.values()) {
    const sorted = group
      .map((idx) => ({ idx, len: normLen(merged[idx]?.value ?? '') }))
      .sort((x, y) => x.len - y.len);
    for (let i = 0; i < sorted.length; i++) {
      const ai = sorted[i]?.idx ?? 0;
      const la = sorted[i]?.len ?? 0;
      for (let j = i + 1; j < sorted.length; j++) {
        const lb = sorted[j]?.len ?? 0;
        // Widen the window to `lo` (looser than NN's `t`) so borderline pairs survive.
        if (lo > 0 && la > 0 && lb > la / lo) break;
        const bj = sorted[j]?.idx ?? 0;
        const av = merged[ai]?.value ?? '';
        const bv = merged[bj]?.value ?? '';
        const sim = similarity(av, bv);
        if (sim >= lo && sim < t) {
          const aCount = merged[ai]?.count ?? 0;
          const bCount = merged[bj]?.count ?? 0;
          found.push({ a: av, b: bv, aCount, bCount, weight: aCount + bCount });
        }
      }
    }
  }
  found.sort((x, y) => y.weight - x.weight);
  return found.slice(0, limit).map(({ weight: _weight, ...p }) => p);
}

// ── The artifact: the additive CASE-rewrite SQL cell (the crux, §4) ─────

/**
 * Build the additive CASE-rewrite SQL for a set of ACCEPTED clusters,
 * wrapping the upstream SQL as a subquery and adding ONE new column:
 *
 *   SELECT *,
 *     CASE
 *       WHEN "col" IN ('v1', 'v2') THEN 'canonical'
 *       ...
 *       ELSE "col"
 *     END AS "col__merged"
 *   FROM ( <upstream_sql> ) AS cluster_src
 *
 * Injection-safe by construction: the column + alias flow through
 * quoteIdent; every variant value + canonical through quoteLiteral. Only
 * NON-canonical variants need a WHEN arm (a value equal to its own
 * canonical already falls through ELSE to itself). With no remapping arms
 * the merged column is an honest copy of the source.
 *
 * `canonical` may be any string — one of the cluster's values (the common
 * case: the others remap to it) OR a brand-new spelling the user typed (then
 * EVERY value remaps to it). Either is well-defined and safe. The caller owns
 * cluster assembly: it must place every value that should remap into
 * `values`, and set `canonical` directly (do NOT re-run a user/AI-curated
 * cluster through `makeCluster`, which would recompute the canonical).
 */
export function buildMergeCaseSql(
  column: string,
  clusters: ReadonlyArray<Cluster>,
  upstreamSql: string,
  opts?: { aliasSuffix?: string },
): string {
  const suffix = opts?.aliasSuffix ?? DEFAULT_ALIAS_SUFFIX;
  const col = quoteIdent(column);
  const alias = quoteIdent(`${column}${suffix}`);
  const src = upstreamSql.trim().replace(/;\s*$/, '');

  const arms: string[] = [];
  for (const c of clusters) {
    const variants = c.values.map((v) => v.value).filter((v) => v !== c.canonical);
    if (variants.length === 0) continue;
    const inList = variants.map(quoteLiteral).join(', ');
    arms.push(`    WHEN ${col} IN (${inList}) THEN ${quoteLiteral(c.canonical)}`);
  }

  if (arms.length === 0) {
    return `SELECT *, ${col} AS ${alias}\nFROM (\n${src}\n) AS cluster_src`;
  }
  return [
    'SELECT *,',
    '  CASE',
    ...arms,
    `    ELSE ${col}`,
    `  END AS ${alias}`,
    `FROM (\n${src}\n) AS cluster_src`,
  ].join('\n');
}

// ── Internal helpers ────────────────────────────────────────────────────

/** Combine entries with an identical `value`, summing counts (defensive — the
 *  `GROUP BY 1` upstream already yields distinct values). */
function mergeValueCounts(values: ReadonlyArray<ValueCount>): ValueCount[] {
  const m = new Map<string, number>();
  for (const vc of values) {
    m.set(vc.value, (m.get(vc.value) ?? 0) + vc.count);
  }
  return [...m.entries()].map(([value, count]) => ({ value, count }));
}

function compareValueCount(a: ValueCount, b: ValueCount): number {
  if (a.count !== b.count) return b.count - a.count;
  if (a.value < b.value) return -1;
  if (a.value > b.value) return 1;
  return 0;
}

function makeCluster(values: ReadonlyArray<ValueCount>): Cluster {
  const sorted = [...values].sort(compareValueCount);
  return { canonical: pickCanonical(sorted), values: sorted };
}

function totalCount(c: Cluster): number {
  return c.values.reduce((s, v) => s + v.count, 0);
}

function sortClusters(clusters: Cluster[]): Cluster[] {
  return clusters.sort((a, b) => {
    const at = totalCount(a);
    const bt = totalCount(b);
    if (at !== bt) return bt - at;
    if (a.canonical < b.canonical) return -1;
    if (a.canonical > b.canonical) return 1;
    return 0;
  });
}

/** Minimal union-find (path compression + union by rank) for single-link. */
class UnionFind {
  private parent: number[];
  private rank: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0) as number[];
  }
  find(x: number): number {
    let root = x;
    while ((this.parent[root] ?? root) !== root) root = this.parent[root] ?? root;
    let cur = x;
    while ((this.parent[cur] ?? cur) !== root) {
      const next = this.parent[cur] ?? root;
      this.parent[cur] = root;
      cur = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank[ra] ?? 0;
    const rankB = this.rank[rb] ?? 0;
    if (rankA < rankB) {
      this.parent[ra] = rb;
    } else if (rankA > rankB) {
      this.parent[rb] = ra;
    } else {
      this.parent[rb] = ra;
      this.rank[ra] = rankA + 1;
    }
  }
}
