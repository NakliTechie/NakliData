// Tier-3 UniversalTerm layer — pure parse / validate / resolve.
//
// Engine boundary (v1.3 M0): no DOM, FSA, or browser globals. The runtime
// loader (`load.ts`) fetches the two JSONL files and hands their text here;
// this module parses, validates, and answers `typeId → { sensitivity,
// roleFamily, universalTerm }` synchronously over the in-memory layer.
//
// See `universal-terms/SPEC.md`. Decisions: role_family on the term with a
// per-role crosswalk override (#1); sensitivity's canonical home is the term,
// migrated off types.jsonl (#4); report_slot is NOT here — the report engine
// derives placement from roleFamily (#5).

import type {
  CrosswalkEntry,
  RoleFamily,
  TaxonomyBundle,
  TypeSensitivity,
  TypeSpec,
  UniversalLayer,
  UniversalTerm,
} from './types.ts';

const ROLE_FAMILIES: ReadonlySet<string> = new Set(['entity', 'dimension', 'measure', 'metric']);
const SENSITIVITIES: ReadonlySet<string> = new Set(['public', 'pii', 'financial', 'secret']);

/** Parse the two universal-layer JSONL blobs into a {@link UniversalLayer}. */
export function parseUniversalLayer(termsText: string, crosswalkText: string): UniversalLayer {
  const terms: UniversalTerm[] = [];
  for (const line of termsText.split('\n')) {
    const t = line.trim();
    if (t) terms.push(JSON.parse(t) as UniversalTerm);
  }
  const crosswalk: CrosswalkEntry[] = [];
  for (const line of crosswalkText.split('\n')) {
    const t = line.trim();
    if (t) crosswalk.push(JSON.parse(t) as CrosswalkEntry);
  }
  return { terms, crosswalk };
}

// --- indexing (memoized per-layer for O(1) resolves) -------------------------

interface LayerIndex {
  termById: Map<string, UniversalTerm>;
  crosswalkByRole: Map<string, CrosswalkEntry>;
}
const indexCache = new WeakMap<UniversalLayer, LayerIndex>();

function indexOf(layer: UniversalLayer): LayerIndex {
  const cached = indexCache.get(layer);
  if (cached) return cached;
  const termById = new Map<string, UniversalTerm>();
  for (const term of layer.terms) termById.set(term.id, term);
  const crosswalkByRole = new Map<string, CrosswalkEntry>();
  for (const entry of layer.crosswalk) crosswalkByRole.set(entry.role, entry);
  const idx = { termById, crosswalkByRole };
  indexCache.set(layer, idx);
  return idx;
}

// --- resolvers (the public surface the seams call) ---------------------------

/**
 * True when the Tier-3 sensitivity layer is loaded. Security-critical: the
 * anonymize sink MUST fail closed (refuse to export) when this is `false`,
 * because `sensitivityForType` degrades to `'public'` → strategy `'keep'` →
 * a plaintext export otherwise. The layer is a separate fetch from types.jsonl
 * and can fail independently, so a non-null bundle does NOT imply it's present.
 */
export function hasSensitivityLayer(
  bundle: TaxonomyBundle | null,
): bundle is TaxonomyBundle & { universal: UniversalLayer } {
  return !!bundle?.universal;
}

/** The UniversalTerm a `typeId` maps to, or `null` if unmapped / no layer. */
export function universalTermForType(bundle: TaxonomyBundle, typeId: string): UniversalTerm | null {
  const layer = bundle.universal;
  if (!layer) return null;
  const idx = indexOf(layer);
  const entry = idx.crosswalkByRole.get(typeId);
  if (!entry) return null;
  return idx.termById.get(entry.universalTerm) ?? null;
}

/**
 * Effective sensitivity for a `typeId`: per-role crosswalk override, else the
 * mapped term's sensitivity, else `'public'`. This is the canonical home after
 * the migration (decision #4) — the schema-panel badge and anonymize sink both
 * read it here instead of off {@link TypeSpec}.
 */
export function sensitivityForType(bundle: TaxonomyBundle, typeId: string): TypeSensitivity {
  const layer = bundle.universal;
  if (!layer) return 'public';
  const idx = indexOf(layer);
  const entry = idx.crosswalkByRole.get(typeId);
  if (!entry) return 'public';
  if (entry.sensitivity) return entry.sensitivity;
  const term = idx.termById.get(entry.universalTerm);
  return term?.sensitivity ?? 'public';
}

/** Effective roleFamily for a `typeId`: per-role override, else the term's, else `null`. */
export function roleFamilyForType(bundle: TaxonomyBundle, typeId: string): RoleFamily | null {
  const layer = bundle.universal;
  if (!layer) return null;
  const idx = indexOf(layer);
  const entry = idx.crosswalkByRole.get(typeId);
  if (!entry) return null;
  if (entry.roleFamily) return entry.roleFamily;
  const term = idx.termById.get(entry.universalTerm);
  return term?.roleFamily ?? null;
}

// --- validation --------------------------------------------------------------

/**
 * Structural integrity of the universal layer against the shipped types.
 * Returns a list of human-readable errors (empty = valid). Enforced by a test
 * (Phase 2) and available to a build-time gate.
 */
export function validateUniversalLayer(layer: UniversalLayer, types: TypeSpec[]): string[] {
  const errors: string[] = [];
  const termIds = new Set(layer.terms.map((t) => t.id));
  const typeIds = new Set(types.map((t) => t.id));

  // 1. every term is well-formed
  for (const term of layer.terms) {
    if (!term.id.startsWith('ut:')) errors.push(`term id not ut:-prefixed: ${term.id}`);
    if (!ROLE_FAMILIES.has(term.roleFamily))
      errors.push(`term ${term.id}: bad roleFamily ${term.roleFamily}`);
    if (!SENSITIVITIES.has(term.sensitivity))
      errors.push(`term ${term.id}: bad sensitivity ${term.sensitivity}`);
    for (const b of term.broader ?? [])
      if (!termIds.has(b)) errors.push(`term ${term.id}: broader→undefined ${b}`);
    // Decision #5: report placement (kpi.*, axis.*, filter…) is NOT in Tier-3 —
    // the report engine derives it from roleFamily. Reject any smuggled slot key
    // so the layer stays purely semantic.
    const rec = term as unknown as Record<string, unknown>;
    if ('reportSlot' in rec || 'reportSlots' in rec || 'report_slot' in rec)
      errors.push(`term ${term.id}: report_slot must live with the report engine, not Tier-3`);
  }

  // 2. no broader cycles
  const termById = new Map(layer.terms.map((t) => [t.id, t]));
  const hasCycle = (id: string, seen: Set<string>): boolean => {
    if (seen.has(id)) return true;
    const term = termById.get(id);
    if (!term) return false;
    const next = new Set(seen).add(id);
    return (term.broader ?? []).some((b) => hasCycle(b, next));
  };
  for (const term of layer.terms)
    if (hasCycle(term.id, new Set())) errors.push(`broader cycle at ${term.id}`);

  // 3. crosswalk integrity: unique roles, known targets, valid overrides
  const seenRoles = new Set<string>();
  for (const entry of layer.crosswalk) {
    if (seenRoles.has(entry.role)) errors.push(`duplicate crosswalk role: ${entry.role}`);
    seenRoles.add(entry.role);
    if (!typeIds.has(entry.role)) errors.push(`crosswalk role is not a known type: ${entry.role}`);
    if (!termIds.has(entry.universalTerm))
      errors.push(`crosswalk ${entry.role}→undefined term ${entry.universalTerm}`);
    if (entry.sensitivity && !SENSITIVITIES.has(entry.sensitivity))
      errors.push(`crosswalk ${entry.role}: bad sensitivity override ${entry.sensitivity}`);
    if (entry.roleFamily && !ROLE_FAMILIES.has(entry.roleFamily))
      errors.push(`crosswalk ${entry.role}: bad roleFamily override ${entry.roleFamily}`);
  }

  // 4. every shipped type is mapped
  for (const id of typeIds)
    if (!seenRoles.has(id)) errors.push(`type has no crosswalk mapping: ${id}`);

  return errors;
}
