import { describe, expect, it } from 'vitest';
import {
  STANDARDS_PROFILES,
  STANDARDS_RELEASE_FLAGS,
  type StandardsReleaseFlags,
  resolveStandardsCapabilities,
} from '../src/core/standards/capabilities.ts';

describe('standards product capability gates', () => {
  it('keeps every standards claim release-gated by default', () => {
    const capabilities = resolveStandardsCapabilities();
    expect(capabilities.map((item) => item.id)).toEqual([
      'skos',
      'shacl',
      'prov',
      'owl',
      'reasoning',
    ]);
    expect(capabilities.every((item) => item.readiness === 'release-gated')).toBe(true);
    expect(capabilities.every((item) => item.enabled === false)).toBe(true);
    expect(new Set(capabilities.map((item) => item.profile))).toEqual(
      new Set(Object.values(STANDARDS_PROFILES)),
    );
    expect(STANDARDS_RELEASE_FLAGS).toEqual({
      skos: false,
      shacl: false,
      prov: false,
      owl: false,
      reasoning: false,
    });
  });

  it('enables and rolls back each independent profile without widening another gate', () => {
    for (const id of ['skos', 'shacl', 'prov', 'owl'] as const) {
      const flags = releaseFlags({ [id]: true });
      const capabilities = resolveStandardsCapabilities(flags);
      expect(capabilities.filter((item) => item.enabled).map((item) => item.id)).toEqual([id]);
      expect(
        resolveStandardsCapabilities(releaseFlags()).find((item) => item.id === id)?.enabled,
      ).toBe(false);
    }
  });

  it('requires both semantic dependencies before reasoning can be enabled', () => {
    const missing = resolveStandardsCapabilities(releaseFlags({ reasoning: true }));
    expect(missing.find((item) => item.id === 'reasoning')).toMatchObject({
      enabled: false,
      readiness: 'release-gated',
      dependencies: ['skos', 'owl'],
    });
    const enabled = resolveStandardsCapabilities(
      releaseFlags({ skos: true, owl: true, reasoning: true }),
    );
    expect(enabled.find((item) => item.id === 'reasoning')).toMatchObject({
      enabled: true,
      readiness: 'available',
      unavailableReason: null,
    });
    const rolledBack = resolveStandardsCapabilities(
      releaseFlags({ skos: true, owl: false, reasoning: true }),
    );
    expect(rolledBack.find((item) => item.id === 'reasoning')?.enabled).toBe(false);
  });
});

function releaseFlags(overrides: Partial<StandardsReleaseFlags> = {}): StandardsReleaseFlags {
  return { ...STANDARDS_RELEASE_FLAGS, ...overrides };
}
