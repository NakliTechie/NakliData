import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentPermissionError, AgentSession } from '../src/core/agent/session.ts';

describe('AgentSession', () => {
  afterEach(() => vi.useRealTimers());
  it('defaults to metadata only and never revokes metadata', () => {
    const session = new AgentSession(() => 0);
    expect(session.snapshot().grants).toEqual({
      'metadata:read': true,
      'values:read': false,
      'workspace:propose': false,
    });
    session.setGrant('metadata:read', false);
    expect(session.has('metadata:read')).toBe(true);
  });

  it('records denied requests without their input or values', () => {
    const session = new AgentSession(() => 0);
    expect(() => session.begin('values:read', 'query')).toThrow(AgentPermissionError);
    expect(session.snapshot().activity).toMatchObject([
      {
        tool: 'query',
        scope: 'values:read',
        outcome: 'denied',
        errorCode: 'permission_denied',
      },
    ]);
    expect(JSON.stringify(session.snapshot().activity)).not.toContain('SELECT');
  });

  it('aborts affected in-flight work when a scope is revoked', () => {
    const session = new AgentSession(() => 0);
    session.setGrant('values:read', true);
    const request = session.begin('values:read', 'query');
    session.setGrant('values:read', false);
    expect(request.signal.aborted).toBe(true);
    request.finish('error');
    expect(session.snapshot().activity[0]).toMatchObject({
      outcome: 'cancelled',
      errorCode: 'cancelled',
    });
  });

  it('clears grants and activity when the workspace epoch changes', () => {
    let epoch = 0;
    const session = new AgentSession(() => epoch);
    session.setGrant('workspace:propose', true);
    const request = session.begin('workspace:propose', 'proposeSqlCell');
    request.finish('ok');
    epoch++;
    expect(session.snapshot()).toMatchObject({
      workspaceRevision: 1,
      grants: {
        'metadata:read': true,
        'values:read': false,
        'workspace:propose': false,
      },
      activity: [],
    });
  });

  it('keeps only the configured number of metadata-only activity entries', () => {
    const session = new AgentSession(() => 0, 2);
    for (const tool of ['a', 'b', 'c']) {
      const request = session.begin('metadata:read', tool);
      request.finish('ok');
    }
    expect(session.snapshot().activity.map((entry) => entry.tool)).toEqual(['c', 'b']);
  });

  it('aborts calls at the configured deadline', () => {
    vi.useFakeTimers();
    const session = new AgentSession(() => 0, 50, 25);
    const request = session.begin('metadata:read', 'describe');
    vi.advanceTimersByTime(25);
    expect(request.signal.aborted).toBe(true);
    expect(request.signal.reason).toBe('deadline');
    request.finish('error');
    expect(session.snapshot().activity[0]).toMatchObject({
      outcome: 'cancelled',
      errorCode: 'cancelled',
    });
  });
});
