/**
 * Product-truth gates for the standards train.
 *
 * The adapters and conformance evidence can exist while every user-facing
 * surface remains disabled. A release changes one explicit flag at a time;
 * disabling any flag is the rollback path and never changes stored artifacts.
 */

export const STANDARDS_CAPABILITY_VERSION = 1 as const;
export const STANDARDS_EVIDENCE_DATE = '2026-08-18' as const;

export const STANDARDS_PROFILES = {
  skos: 'naklidata-skos-2009-v1',
  shacl: 'naklidata-shacl-2017-core-v1',
  prov: 'naklidata-prov-o-2013-v1',
  owl: 'naklidata-owl-2-rl-v1',
  reasoning: 'naklidata-bounded-standards-reasoning-v1',
} as const;

export type StandardsCapabilityId = keyof typeof STANDARDS_PROFILES;
export type StandardsCapabilityReadiness = 'available' | 'release-gated';

export interface StandardsCapability {
  id: StandardsCapabilityId;
  label: string;
  profile: (typeof STANDARDS_PROFILES)[StandardsCapabilityId];
  readiness: StandardsCapabilityReadiness;
  enabled: boolean;
  evidenceDate: typeof STANDARDS_EVIDENCE_DATE;
  boundary: string;
  dependencies: StandardsCapabilityId[];
  unavailableReason: string | null;
}

export type StandardsReleaseFlags = Readonly<Record<StandardsCapabilityId, boolean>>;

/** Release defaults. No standards surface is user-facing in this build. */
export const STANDARDS_RELEASE_FLAGS: StandardsReleaseFlags = {
  skos: false,
  shacl: false,
  prov: false,
  owl: false,
  reasoning: false,
};

const DEFINITIONS: ReadonlyArray<
  Pick<StandardsCapability, 'id' | 'label' | 'boundary' | 'dependencies'>
> = [
  {
    id: 'skos',
    label: 'SKOS vocabulary interchange',
    boundary: 'Bounded Turtle import/export and detached vocabulary proposals.',
    dependencies: [],
  },
  {
    id: 'shacl',
    label: 'SHACL constraint interchange',
    boundary: 'SHACL Core subset with editable, un-run assertion proposals.',
    dependencies: [],
  },
  {
    id: 'prov',
    label: 'PROV-O provenance interchange',
    boundary: 'Observed lineage and annotations remain distinct and byte-free.',
    dependencies: [],
  },
  {
    id: 'owl',
    label: 'OWL ontology interchange',
    boundary: 'Strict named-axiom OWL 2 RL subset with detached proposals.',
    dependencies: [],
  },
  {
    id: 'reasoning',
    label: 'Bounded standards reasoning',
    boundary: 'Worker-only deterministic SKOS/OWL proposals with no execution authority.',
    dependencies: ['skos', 'owl'],
  },
];

export function resolveStandardsCapabilities(
  flags: StandardsReleaseFlags = STANDARDS_RELEASE_FLAGS,
): StandardsCapability[] {
  return DEFINITIONS.map((definition) => {
    const missing = definition.dependencies.filter((id) => !flags[id]);
    const enabled = flags[definition.id] && missing.length === 0;
    return {
      ...definition,
      profile: STANDARDS_PROFILES[definition.id],
      readiness: enabled ? 'available' : 'release-gated',
      enabled,
      evidenceDate: STANDARDS_EVIDENCE_DATE,
      unavailableReason: enabled
        ? null
        : missing.length > 0
          ? `Release gate requires enabled dependencies: ${missing.join(', ')}.`
          : 'Release authorization and a user-facing product surface are absent.',
    };
  });
}
