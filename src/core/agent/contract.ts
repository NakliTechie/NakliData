/**
 * Canonical agent-surface product contract.
 *
 * This file is deliberately free of DOM, engine, and store imports. Runtime
 * registries, transport adapters, tests, and generated product documentation
 * all consume the same vocabulary without making a transport an authority.
 */

export const AGENT_CONTRACT_VERSION = '3' as const;
export const AGENT_COMPATIBILITY_VERSIONS = ['2', AGENT_CONTRACT_VERSION] as const;

export const AGENT_SCOPES = ['metadata:read', 'values:read', 'workspace:propose'] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

export const DEFAULT_AGENT_SCOPES: readonly AgentScope[] = ['metadata:read'];

export const AGENT_ERROR_CODES = [
  'invalid_input',
  'unknown_tool',
  'permission_denied',
  'validation_failed',
  'safety_refusal',
  'unavailable',
  'cancelled',
  'workspace_changed',
  'internal_error',
] as const;
export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

export const AGENT_BOUNDS = {
  queryRows: 1000,
  activityEntries: 50,
  artifactBytes: 2 * 1024 * 1024,
  requestDeadlineMs: 30_000,
} as const;

export interface AgentProvenance {
  workspaceRevision: number | null;
  sourceIds: string[];
  tableIds: string[];
}

export interface AgentResultBounds {
  rowLimit: number | null;
  rowsReturned: number | null;
  truncated: boolean;
}

export interface AgentRedaction {
  applied: boolean;
  columns: string[];
  policy: 'semantic-sensitivity-v1' | 'none';
}

export interface AgentResultMeta {
  provenance: AgentProvenance;
  bounds: AgentResultBounds;
  redaction: AgentRedaction;
  /** True when returned content originated in user-controlled data/artifacts. */
  untrustedContent: boolean;
}

export interface AgentError {
  code: AgentErrorCode;
  message: string;
  retryable: boolean;
}

export type AgentV3Result<T = unknown> =
  | {
      version: typeof AGENT_CONTRACT_VERSION;
      ok: true;
      tool: string;
      scope: AgentScope;
      data: T;
      meta: AgentResultMeta;
    }
  | {
      version: typeof AGENT_CONTRACT_VERSION;
      ok: false;
      tool: string;
      scope: AgentScope;
      error: AgentError;
      meta: AgentResultMeta;
    };

export type AgentAdapterReadiness = 'available' | 'experimental' | 'planned';

export interface AgentAdapterCapability {
  id: 'window-v2' | 'window-v3' | 'webmcp' | 'external-mcp';
  label: string;
  readiness: AgentAdapterReadiness;
  boundary: string;
}

/**
 * Product truth for transports. "Experimental" and "planned" are intentionally
 * not availability claims.
 */
export const AGENT_ADAPTERS: readonly AgentAdapterCapability[] = [
  {
    id: 'window-v2',
    label: 'Browser API v2',
    readiness: 'available',
    boundary: 'Compatibility surface on the page global; proposal-only mutation.',
  },
  {
    id: 'window-v3',
    label: 'Browser API v3',
    readiness: 'planned',
    boundary: 'Versioned scoped surface; implementation is not yet released.',
  },
  {
    id: 'webmcp',
    label: 'WebMCP adapter',
    readiness: 'experimental',
    boundary: 'Feature-detected, flag-gated browser experiment; never load-bearing.',
  },
  {
    id: 'external-mcp',
    label: 'External MCP server',
    readiness: 'planned',
    boundary: 'Artifact-first boundary only; no live-tab server is shipped.',
  },
] as const;

export const AGENT_V3_TOOL_SCOPES = {
  describe: 'metadata:read',
  listTables: 'metadata:read',
  listCells: 'metadata:read',
  getCapabilities: 'metadata:read',
  getLineage: 'metadata:read',
  exportDataDictionary: 'metadata:read',
  validateArtifact: 'metadata:read',
  query: 'values:read',
  proposeSqlCell: 'workspace:propose',
  proposeChart: 'workspace:propose',
  proposeQualityCheck: 'workspace:propose',
} as const satisfies Record<string, AgentScope>;

export const DEFERRED_AGENT_TOOLS = {
  proposeCleaningStep:
    'Unavailable until the table-context cleaning boundary in workplan batch N5 is complete.',
} as const;
