import type { AgentErrorCode, AgentScope } from './contract.ts';

export type AgentActivityOutcome = 'ok' | 'error' | 'denied' | 'cancelled';

export interface AgentActivityEntry {
  id: number;
  tool: string;
  scope: AgentScope;
  outcome: AgentActivityOutcome;
  errorCode: AgentErrorCode | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  rowsReturned: number | null;
  redactedColumns: number | null;
}

export interface AgentAccessSnapshot {
  workspaceRevision: number;
  grants: Record<AgentScope, boolean>;
  inFlight: number;
  activity: AgentActivityEntry[];
}

export class AgentPermissionError extends Error {
  readonly scope: AgentScope;

  constructor(scope: AgentScope) {
    super(`Agent access requires the per-tab "${scope}" grant.`);
    this.name = 'AgentPermissionError';
    this.scope = scope;
  }
}

export interface AgentRequest {
  signal: AbortSignal;
  finish(
    outcome: 'ok' | 'error',
    details?: { rowsReturned: number | null; redactedColumns: number | null },
    errorCode?: AgentErrorCode | null,
  ): void;
}

/**
 * Per-tab agent authority. Nothing here is serializable or persisted.
 * `readEpoch` is injected so the shell can invalidate lazy state without
 * loading the agent chunk during a workspace replacement.
 */
export class AgentSession {
  private grants = new Set<AgentScope>(['metadata:read']);
  private activity: AgentActivityEntry[] = [];
  private inFlight = new Map<number, { scope: AgentScope; controller: AbortController }>();
  private listeners = new Set<() => void>();
  private nextId = 1;
  private epoch: number;

  constructor(
    private readonly readEpoch: () => number,
    private readonly activityLimit = 50,
  ) {
    this.epoch = readEpoch();
  }

  snapshot(): AgentAccessSnapshot {
    this.syncEpoch();
    return {
      workspaceRevision: this.epoch,
      grants: {
        'metadata:read': true,
        'values:read': this.grants.has('values:read'),
        'workspace:propose': this.grants.has('workspace:propose'),
      },
      inFlight: this.inFlight.size,
      activity: this.activity.map((entry) => ({ ...entry })),
    };
  }

  has(scope: AgentScope): boolean {
    this.syncEpoch();
    return scope === 'metadata:read' || this.grants.has(scope);
  }

  setGrant(scope: AgentScope, granted: boolean): void {
    this.syncEpoch();
    if (scope === 'metadata:read') return;
    if (granted) {
      this.grants.add(scope);
    } else {
      this.grants.delete(scope);
      this.abortScope(scope);
    }
    this.notify();
  }

  revokeAll(): void {
    this.syncEpoch();
    this.grants = new Set<AgentScope>(['metadata:read']);
    this.abortAll();
    this.notify();
  }

  begin(scope: AgentScope, tool: string): AgentRequest {
    this.syncEpoch();
    const id = this.nextId++;
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    if (!this.has(scope)) {
      this.record({
        id,
        tool,
        scope,
        outcome: 'denied',
        errorCode: 'permission_denied',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        rowsReturned: null,
        redactedColumns: null,
      });
      throw new AgentPermissionError(scope);
    }
    const controller = new AbortController();
    const requestEpoch = this.epoch;
    this.inFlight.set(id, { scope, controller });
    this.notify();
    let finished = false;
    return {
      signal: controller.signal,
      finish: (outcome, details, errorCode = null) => {
        if (finished) return;
        finished = true;
        this.inFlight.delete(id);
        if (requestEpoch !== this.epoch) return;
        this.record({
          id,
          tool,
          scope,
          outcome: controller.signal.aborted ? 'cancelled' : outcome,
          errorCode: controller.signal.aborted ? 'cancelled' : errorCode,
          startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Math.max(0, Date.now() - startedMs),
          rowsReturned: details?.rowsReturned ?? null,
          redactedColumns: details?.redactedColumns ?? null,
        });
      },
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private syncEpoch(): void {
    const next = this.readEpoch();
    if (next === this.epoch) return;
    this.abortAll();
    this.inFlight.clear();
    this.grants = new Set<AgentScope>(['metadata:read']);
    this.activity = [];
    this.epoch = next;
    this.notify();
  }

  private abortScope(scope: AgentScope): void {
    for (const request of this.inFlight.values()) {
      if (request.scope === scope) request.controller.abort();
    }
  }

  private abortAll(): void {
    for (const request of this.inFlight.values()) request.controller.abort();
  }

  private record(entry: AgentActivityEntry): void {
    this.activity.unshift(entry);
    if (this.activity.length > this.activityLimit) this.activity.length = this.activityLimit;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
