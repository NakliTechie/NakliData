/** Stable browser ↔ Compute Bridge protocol identity. */
export const BRIDGE_PROTOCOL_ID = 'naklidata-compute-bridge';
export const BRIDGE_PROTOCOL_VERSION = 2;

export const BRIDGE_CAPABILITIES = {
  arrowIpc: 'arrow-ipc',
  query: 'query',
  tableQuery: 'table-query',
  tables: 'tables',
} as const;

export type BridgeCapability = (typeof BRIDGE_CAPABILITIES)[keyof typeof BRIDGE_CAPABILITIES];

export const BRIDGE_QUERY_ROW_CAP_DEFAULT = 100_000;
export const BRIDGE_QUERY_ROW_CAP_MAX = 1_000_000;

export interface BridgeHealth {
  protocol: typeof BRIDGE_PROTOCOL_ID;
  protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
  name: string;
  version: string;
  auth: 'bearer' | 'oauth2' | 'none';
  singleTenant: boolean;
  capabilities: string[];
}

export interface BridgeColumn {
  name: string;
  type: string;
}

export interface BridgeTable {
  /** Leaf object name, suitable for compact display. */
  name: string;
  /** Opaque server-side identifier returned unchanged to `/v1/table-query`. */
  qualifiedName: string;
  /** Top-level catalog, when the bridge exposes one. */
  catalog: string | null;
  /** Ordered namespace/schema path between catalog and object. */
  namespace: string[];
  kind: 'table' | 'view';
  /** Informational source/adapter name. */
  source: string | null;
  schema: BridgeColumn[];
}

export interface BridgeRequestOptions {
  signal?: AbortSignal;
}

export interface BridgeQueryOptions extends BridgeRequestOptions {
  rowLimit?: number;
}

export interface BridgeHealthOptions extends BridgeRequestOptions {
  requiredCapabilities?: readonly BridgeCapability[];
}

export class BridgeError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = 'bridge_error') {
    super(message);
    this.name = 'BridgeError';
    this.status = status;
    this.code = code;
  }
}
