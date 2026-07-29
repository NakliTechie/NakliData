/** Stable browser ↔ Compute Bridge protocol identity. */
export const BRIDGE_PROTOCOL_ID = 'naklidata-compute-bridge';
export const BRIDGE_PROTOCOL_VERSION = 1;

export const BRIDGE_CAPABILITIES = {
  arrowIpc: 'arrow-ipc',
  query: 'query',
  tables: 'tables',
} as const;

export type BridgeCapability = (typeof BRIDGE_CAPABILITIES)[keyof typeof BRIDGE_CAPABILITIES];

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
  /** Opaque server-side identifier used in generated bridge SQL. */
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
