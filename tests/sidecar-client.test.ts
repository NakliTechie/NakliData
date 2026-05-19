import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildExplainErrorPrompt,
  type SidecarTransport,
  dispatchJob,
  parseExplainErrorResponse,
} from '../src/core/sidecar/client.ts';
import { SidecarError } from '../src/core/sidecar/types.ts';

// Shared IDB shim — sidecar client looks up the API key via byok.loadKey.
const _idb = new Map<string, unknown>();
vi.mock('../src/core/idb.ts', () => ({
  kvGet: async <T>(key: string) => (_idb.get(key) as T | undefined) ?? null,
  kvPut: async (key: string, value: unknown) => {
    _idb.set(key, value);
  },
  kvDelete: async (key: string) => {
    _idb.delete(key);
  },
}));

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, v);
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
}
const _session = new MemoryStorage();
// biome-ignore lint/suspicious/noExplicitAny: shim for tests
(globalThis as any).sessionStorage = _session;

beforeEach(() => {
  _idb.clear();
  for (const k of [
    'naklidata.byok.anthropic',
    'naklidata.byok.openai',
    'sidecar/byok/anthropic',
    'sidecar/byok/openai',
  ]) {
    _session.removeItem(k);
    _idb.delete(k);
  }
});

describe('buildExplainErrorPrompt', () => {
  it('embeds SQL + error + optional schema hint in the user content', () => {
    const { system, user } = buildExplainErrorPrompt({
      kind: 'explain-error',
      sql: 'SELEKT * FROM invoices',
      errorMessage: 'Parser Error: syntax error at or near "SELEKT"',
      schemaHint: 'invoices: invoice_no, vendor_name, total_amount',
    });
    expect(system).toMatch(/explain DuckDB query errors/);
    expect(system).toMatch(/JSON in this shape/);
    expect(user).toContain('SELEKT * FROM invoices');
    expect(user).toContain('Parser Error');
    expect(user).toContain('invoices: invoice_no, vendor_name, total_amount');
  });

  it('omits the schema section when no hint is provided', () => {
    const { user } = buildExplainErrorPrompt({
      kind: 'explain-error',
      sql: 'SELECT 1',
      errorMessage: 'oops',
    });
    expect(user).not.toContain('Schema (tables and columns currently mounted)');
  });
});

describe('parseExplainErrorResponse', () => {
  it('parses a clean JSON object', () => {
    const r = parseExplainErrorResponse(
      JSON.stringify({
        explanation: 'You wrote SELEKT instead of SELECT.',
        suggested_fix: 'SELECT * FROM invoices',
      }),
    );
    expect(r.kind).toBe('explain-error');
    expect(r.explanation).toMatch(/SELEKT instead of SELECT/);
    expect(r.suggestedFix).toBe('SELECT * FROM invoices');
  });

  it('strips ```json``` fences if the model adds them despite instructions', () => {
    const fenced = '```json\n{"explanation":"x","suggested_fix":null}\n```';
    const r = parseExplainErrorResponse(fenced);
    expect(r.explanation).toBe('x');
    expect(r.suggestedFix).toBeNull();
  });

  it('null + empty suggested_fix both become null', () => {
    const r1 = parseExplainErrorResponse('{"explanation":"x","suggested_fix":null}');
    const r2 = parseExplainErrorResponse('{"explanation":"x","suggested_fix":"  "}');
    expect(r1.suggestedFix).toBeNull();
    expect(r2.suggestedFix).toBeNull();
  });

  it('throws a SidecarError on malformed JSON', () => {
    expect(() => parseExplainErrorResponse('not json at all')).toThrow(SidecarError);
  });

  it('throws a SidecarError when explanation is missing', () => {
    expect(() => parseExplainErrorResponse('{"suggested_fix":"SELECT 1"}')).toThrow(SidecarError);
  });
});

describe('dispatchJob — explain-error', () => {
  it('rejects with no-key kind when no API key is configured', async () => {
    await expect(
      dispatchJob(
        { kind: 'explain-error', sql: 'SELECT 1', errorMessage: 'oops' },
        { provider: 'anthropic', model: 'claude-3-5-haiku-latest' },
      ),
    ).rejects.toMatchObject({ kind: 'no-key' });
  });

  it('calls the stubbed transport with provider/model + parsed key, returns parsed response', async () => {
    // Stash a key in IDB (kvPut) directly.
    _idb.set('sidecar/byok/anthropic', 'sk-ant-stub');

    const transport: SidecarTransport = async (req) => {
      expect(req.provider).toBe('anthropic');
      expect(req.model).toBe('claude-3-5-haiku-latest');
      expect(req.apiKey).toBe('sk-ant-stub');
      expect(req.system).toMatch(/explain DuckDB query errors/);
      expect(req.user).toContain('SELECT 1');
      return JSON.stringify({
        explanation: 'It works.',
        suggested_fix: null,
      });
    };

    const result = await dispatchJob(
      { kind: 'explain-error', sql: 'SELECT 1', errorMessage: 'no-op' },
      { provider: 'anthropic', model: 'claude-3-5-haiku-latest', transport },
    );
    expect(result).toEqual({
      kind: 'explain-error',
      explanation: 'It works.',
      suggestedFix: null,
    });
  });

  it('propagates SidecarError from the transport', async () => {
    _idb.set('sidecar/byok/openai', 'sk-openai-stub');
    const transport: SidecarTransport = async () => {
      throw new SidecarError('rate-limited', 'rate-limit');
    };
    await expect(
      dispatchJob(
        { kind: 'explain-error', sql: 'SELECT 1', errorMessage: 'no-op' },
        { provider: 'openai', model: 'gpt-4o-mini', transport },
      ),
    ).rejects.toMatchObject({ kind: 'rate-limit' });
  });
});
