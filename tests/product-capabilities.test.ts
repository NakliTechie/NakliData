import { describe, expect, it } from 'vitest';
import {
  AGENT_ADAPTERS,
  AGENT_BOUNDS,
  AGENT_COMPATIBILITY_VERSIONS,
  AGENT_ERROR_CODES,
  AGENT_SCOPES,
  AGENT_V3_TOOL_SCOPES,
  DEFAULT_AGENT_SCOPES,
} from '../src/core/agent/contract.ts';
import { ICEBERG_REST_SUPPORT_PROFILES } from '../src/core/iceberg-rest-release.ts';
import {
  HAS_VERIFIED_ICEBERG_REST_PROFILE,
  ICEBERG_REST_ROLLBACK_REASON,
  ICEBERG_UNAVAILABLE_REASON,
  PRIVACY_POSTURE_COPY,
  SOURCE_GROUPS,
  SOURCE_OPTIONS,
  SOURCE_RELEASE_FLAGS,
  SUPPORTED_FILE_FORMATS,
  resolveSourceGroups,
  resolveSourceOptions,
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

  it('enables only the public Iceberg table path', () => {
    expect(SOURCE_RELEASE_FLAGS).toEqual({ icebergTable: true, icebergRest: false });
    expect(sourceOptionForAction('mount-iceberg')).toMatchObject({
      readiness: 'available',
      unavailableReason: null,
    });
    expect(sourceOptionForAction('mount-iceberg-catalog')).toMatchObject({
      readiness: 'unavailable',
      unavailableReason: ICEBERG_UNAVAILABLE_REASON,
    });
  });

  it('names exact REST profiles and requires live verification plus the release flag', () => {
    expect(ICEBERG_REST_SUPPORT_PROFILES.map((profile) => profile.id)).toEqual([
      'databricks-unity-catalog-aws',
      'snowflake-horizon-catalog-s3',
      'snowflake-horizon-catalog-gcs',
      'snowflake-open-catalog-s3',
      'snowflake-open-catalog-gcs',
    ]);
    expect(
      ICEBERG_REST_SUPPORT_PROFILES.every(
        (profile) => profile.readiness === 'verification-pending',
      ),
    ).toBe(true);
    expect(HAS_VERIFIED_ICEBERG_REST_PROFILE).toBe(
      ICEBERG_REST_SUPPORT_PROFILES.some((profile) => profile.readiness === 'verified'),
    );

    const flagOnly = resolveSourceOptions({ icebergTable: true, icebergRest: true });
    expect(flagOnly.find((option) => option.id === 'iceberg-rest')).toMatchObject({
      readiness: 'unavailable',
      unavailableReason: ICEBERG_UNAVAILABLE_REASON,
    });

    const released = resolveSourceOptions({ icebergTable: true, icebergRest: true }, true);
    expect(released.find((option) => option.id === 'iceberg-rest')).toMatchObject({
      readiness: 'available',
      unavailableReason: null,
    });
    expect(
      resolveSourceGroups(released).find((group) => group.id === 'catalogs')?.description,
    ).toBe('Iceberg tables and live-verified REST Catalog profiles are available.');

    const rolledBack = resolveSourceOptions({ icebergTable: true, icebergRest: false }, true);
    expect(rolledBack.find((option) => option.id === 'iceberg-rest')).toMatchObject({
      readiness: 'unavailable',
      unavailableReason: ICEBERG_REST_ROLLBACK_REASON,
    });
  });

  it('keeps table and REST release switches independent', () => {
    const options = resolveSourceOptions({ icebergTable: false, icebergRest: true }, true);
    expect(options.find((option) => option.id === 'iceberg-table')?.readiness).toBe('unavailable');
    expect(options.find((option) => option.id === 'iceberg-rest')?.readiness).toBe('available');
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

describe('agent product contract', () => {
  it('defaults to metadata only and defines no execution authority', () => {
    expect(DEFAULT_AGENT_SCOPES).toEqual(['metadata:read']);
    expect(AGENT_SCOPES).toEqual(['metadata:read', 'values:read', 'workspace:propose']);
    expect(AGENT_SCOPES.some((scope) => scope.includes('execute'))).toBe(false);
    expect(Object.values(AGENT_V3_TOOL_SCOPES).every((scope) => AGENT_SCOPES.includes(scope))).toBe(
      true,
    );
  });

  it('keeps v2 compatibility while v3 productizes explicit envelopes', () => {
    expect(AGENT_COMPATIBILITY_VERSIONS).toEqual(['2', '3']);
    expect(AGENT_ERROR_CODES).toContain('permission_denied');
    expect(AGENT_ERROR_CODES).toContain('cancelled');
    expect(AGENT_BOUNDS).toEqual({
      queryRows: 1000,
      activityEntries: 50,
      artifactBytes: 2 * 1024 * 1024,
      proposalCodeBytes: 64 * 1024,
      requestDeadlineMs: 30_000,
    });
  });

  it('does not market experimental or planned adapters as available', () => {
    expect(AGENT_ADAPTERS.find((adapter) => adapter.id === 'window-v2')?.readiness).toBe(
      'available',
    );
    expect(AGENT_ADAPTERS.find((adapter) => adapter.id === 'window-v3')?.readiness).toBe(
      'available',
    );
    expect(AGENT_ADAPTERS.find((adapter) => adapter.id === 'webmcp')?.readiness).toBe(
      'experimental',
    );
    expect(AGENT_ADAPTERS.find((adapter) => adapter.id === 'external-mcp')?.readiness).toBe(
      'planned',
    );
  });
});
