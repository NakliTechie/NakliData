import type { BridgeTable } from '../../../src/core/bridge/protocol.ts';

export interface BridgeExecutionRequest {
  requestId: string;
  rowLimit: number;
  signal: AbortSignal;
}

export interface BridgeDirectQueryRequest extends BridgeExecutionRequest {
  sql: string;
}

export interface BridgeTableQueryRequest extends BridgeExecutionRequest {
  qualifiedName: string;
}

export interface BridgeResult {
  arrow: Uint8Array;
  rowCount: number;
}

export interface BridgeBackend {
  readonly id: string;
  readonly source: string;
  readonly capabilities: readonly string[];
  readonly security: {
    readonly readOnlyIdentity: boolean;
    readonly objectAllowlist: boolean;
    readonly downstreamCancellation: boolean;
  };
  readiness(signal: AbortSignal): Promise<{ ready: boolean; detail: string | null }>;
  listTables(signal: AbortSignal): Promise<BridgeTable[]>;
  query(request: BridgeDirectQueryRequest): Promise<BridgeResult>;
  queryTable(request: BridgeTableQueryRequest): Promise<BridgeResult>;
}

export class BridgeServerError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message.slice(0, 320));
    this.name = 'BridgeServerError';
    this.code = code;
    this.status = status;
  }
}
