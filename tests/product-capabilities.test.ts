import { describe, expect, it } from 'vitest';
import {
  ICEBERG_UNAVAILABLE_REASON,
  PRIVACY_POSTURE_COPY,
  SOURCE_GROUPS,
  SOURCE_OPTIONS,
  SUPPORTED_FILE_FORMATS,
  sourceOptionForAction,
} from '../src/core/product-capabilities.ts';

describe('product capability registry', () => {
  it('exposes each source option exactly once under a known group', () => {
    expect(new Set(SOURCE_OPTIONS.map((option) => option.action)).size).toBe(SOURCE_OPTIONS.length);
    const groups = new Set(SOURCE_GROUPS.map((group) => group.id));
    expect(SOURCE_OPTIONS.every((option) => groups.has(option.group))).toBe(true);
    expect(
      SOURCE_GROUPS.every((group) => SOURCE_OPTIONS.some((option) => option.group === group.id)),
    ).toBe(true);
  });

  it('fails closed for both unverified Iceberg entry points', () => {
    for (const action of ['mount-iceberg', 'mount-iceberg-catalog']) {
      const option = sourceOptionForAction(action);
      expect(option?.readiness).toBe('unavailable');
      expect(option?.unavailableReason).toBe(ICEBERG_UNAVAILABLE_REASON);
      expect(option?.hint).toMatch(/unavailable/i);
    }
  });

  it('labels bridge entry points as advanced bring-your-own paths', () => {
    const bridgeOptions = SOURCE_OPTIONS.filter((option) => option.group === 'warehouse-compute');
    expect(bridgeOptions).toHaveLength(2);
    expect(bridgeOptions.every((option) => option.readiness === 'advanced')).toBe(true);
    expect(bridgeOptions.every((option) => /Advanced/.test(option.label))).toBe(true);
    expect(SOURCE_GROUPS.find((group) => group.id === 'warehouse-compute')?.description).toMatch(
      /bring your own compatible bridge endpoint/i,
    );
  });

  it('keeps the precise privacy boundary in one shared sentence', () => {
    expect(PRIVACY_POSTURE_COPY).toContain('unless you explicitly connect a remote source');
    expect(PRIVACY_POSTURE_COPY).toContain('enable the OSM basemap');
    expect(PRIVACY_POSTURE_COPY).toContain('provider and payload categories');
  });

  it('has 14 canonical logical file-format identifiers', () => {
    expect(SUPPORTED_FILE_FORMATS).toHaveLength(14);
    expect(new Set(SUPPORTED_FILE_FORMATS).size).toBe(SUPPORTED_FILE_FORMATS.length);
  });
});
