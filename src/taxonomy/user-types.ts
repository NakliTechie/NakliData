// Convert a workbook UserType (defined via the sidecar wave 3 modal or
// hand-authored in a `.naklidata` file) into the TypeSpec shape the
// classifier consumes. The result is structurally identical to a
// bundled taxonomy type — once merged into the bundle, the classifier
// can't tell them apart.
//
// Two detectors are synthesised per user type:
//   - regex: matches values against the user-supplied pattern.
//   - header_match: matches the column header against the type's id
//     + display_name + any space/underscore variants. So a column
//     named `employee_id` fires the user type with id `employee_id`.

import type { UserType } from '../core/workbook.ts';
import type { DetectorSpec, TypeSpec } from './types.ts';

const DEFAULT_CONFIDENCE_FLOOR = 0.5;
const DEFAULT_SQL_COMPAT = ['VARCHAR'];

export function userTypeToTypeSpec(ut: UserType): TypeSpec {
  const detectors: DetectorSpec[] = [
    {
      kind: 'regex',
      pattern: ut.regex,
      weight: 0.6,
    },
    {
      kind: 'header_match',
      patterns: headerPatterns(ut),
      weight: 0.4,
    },
  ];
  return {
    id: ut.id,
    display_name: ut.display_name,
    domain: 'user-defined',
    sql_compat: DEFAULT_SQL_COMPAT,
    detectors,
    confidence_floor: DEFAULT_CONFIDENCE_FLOOR,
    seed_origin: 'user-defined',
  };
}

/**
 * Build a list of header patterns that the `header_match` detector
 * should accept for this user type. Includes the id, the display_name
 * (lower-cased), and common variants (snake/space).
 */
function headerPatterns(ut: UserType): string[] {
  const candidates = new Set<string>();
  candidates.add(ut.id.toLowerCase());
  const dn = ut.display_name.toLowerCase().trim();
  if (dn) {
    candidates.add(dn);
    candidates.add(dn.replace(/\s+/g, '_'));
    candidates.add(dn.replace(/\s+/g, ''));
  }
  return [...candidates].filter((s) => s.length > 0);
}

/**
 * Merge a list of user types into a bundle's `types` array. Bundle is
 * not mutated — a new object is returned. If a user-type id collides
 * with a bundled type, the user type wins (so users can override
 * bundled detectors locally to their workbook).
 */
export function mergeUserTypesIntoBundle<T extends { types: TypeSpec[] }>(
  bundle: T,
  userTypes: UserType[],
): T {
  if (userTypes.length === 0) return bundle;
  const userSpecs = userTypes.map(userTypeToTypeSpec);
  const userIds = new Set(userSpecs.map((s) => s.id));
  const bundleTypes = bundle.types.filter((t) => !userIds.has(t.id));
  return { ...bundle, types: [...bundleTypes, ...userSpecs] };
}
