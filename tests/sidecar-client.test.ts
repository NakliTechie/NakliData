import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type SidecarTransport,
  buildDefineTypePrompt,
  buildDisambiguateTypePrompt,
  buildExplainErrorPrompt,
  dispatchJob,
  parseDefineTypeResponse,
  parseDisambiguateTypeResponse,
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

const SAMPLE_CANDIDATES = [
  { typeId: 'gstin', displayName: 'GSTIN' },
  { typeId: 'pan', displayName: 'PAN' },
];

describe('buildDisambiguateTypePrompt', () => {
  it('includes the candidate list + the sample values + the SQL type', () => {
    const { system, user } = buildDisambiguateTypePrompt({
      kind: 'disambiguate-type',
      columnName: 'id_code',
      sqlType: 'VARCHAR',
      samples: ['ABCDE1234F', 'BCDEF2345G'],
      candidates: SAMPLE_CANDIDATES,
    });
    expect(system).toMatch(/one token/);
    expect(system).toMatch(/Never invent a typeId/);
    expect(user).toContain('Column header: id_code');
    expect(user).toContain('SQL type: VARCHAR');
    expect(user).toContain('- gstin (GSTIN)');
    expect(user).toContain('- pan (PAN)');
    expect(user).toContain('ABCDE1234F');
  });

  it('caps samples at 20 (extra rows are dropped at the prompt boundary)', () => {
    const many = Array.from({ length: 50 }, (_, i) => `sample_${i}`);
    const { user } = buildDisambiguateTypePrompt({
      kind: 'disambiguate-type',
      columnName: 'c',
      sqlType: 'VARCHAR',
      samples: many,
      candidates: SAMPLE_CANDIDATES,
    });
    expect(user).toContain('sample_0');
    expect(user).toContain('sample_19');
    expect(user).not.toContain('sample_20');
  });
});

describe('parseDisambiguateTypeResponse', () => {
  it('returns the matching typeId when the model picks a candidate', () => {
    const r = parseDisambiguateTypeResponse('pan', SAMPLE_CANDIDATES);
    expect(r).toEqual({ kind: 'disambiguate-type', typeId: 'pan' });
  });

  it('matches case-insensitively (GSTIN → gstin)', () => {
    const r = parseDisambiguateTypeResponse('GSTIN', SAMPLE_CANDIDATES);
    expect(r.typeId).toBe('gstin');
  });

  it("returns null when the model picks 'unknown'", () => {
    const r = parseDisambiguateTypeResponse('unknown', SAMPLE_CANDIDATES);
    expect(r.typeId).toBeNull();
  });

  it("treats off-candidate strings as 'unknown' (defensive)", () => {
    const r = parseDisambiguateTypeResponse('hsn_code', SAMPLE_CANDIDATES);
    expect(r.typeId).toBeNull();
  });

  it('strips wrapping quotes, backticks, periods, and code fences', () => {
    expect(parseDisambiguateTypeResponse('"pan"', SAMPLE_CANDIDATES).typeId).toBe('pan');
    expect(parseDisambiguateTypeResponse('`pan`', SAMPLE_CANDIDATES).typeId).toBe('pan');
    expect(parseDisambiguateTypeResponse('pan.', SAMPLE_CANDIDATES).typeId).toBe('pan');
    expect(parseDisambiguateTypeResponse('```\npan\n```', SAMPLE_CANDIDATES).typeId).toBe('pan');
  });

  it('empty string returns null (no candidate)', () => {
    expect(parseDisambiguateTypeResponse('   ', SAMPLE_CANDIDATES).typeId).toBeNull();
  });
});

describe('dispatchJob — disambiguate-type', () => {
  it('calls the transport with the disambiguate-type prompt and returns the parsed candidate', async () => {
    _idb.set('sidecar/byok/anthropic', 'sk-ant-stub');
    const transport: SidecarTransport = async (req) => {
      expect(req.system).toMatch(/disambiguation/);
      expect(req.user).toContain('Column header: id_code');
      expect(req.user).toContain('- pan (PAN)');
      return 'pan';
    };
    const result = await dispatchJob(
      {
        kind: 'disambiguate-type',
        columnName: 'id_code',
        sqlType: 'VARCHAR',
        samples: ['ABCDE1234F'],
        candidates: SAMPLE_CANDIDATES,
      },
      { provider: 'anthropic', model: 'claude-3-5-haiku-latest', transport },
    );
    expect(result).toEqual({ kind: 'disambiguate-type', typeId: 'pan' });
  });

  it('returns typeId: null when the transport returns `unknown`', async () => {
    _idb.set('sidecar/byok/anthropic', 'sk-ant-stub');
    const transport: SidecarTransport = async () => 'unknown';
    const result = await dispatchJob(
      {
        kind: 'disambiguate-type',
        columnName: 'comments',
        sqlType: 'VARCHAR',
        samples: ['Lorem ipsum'],
        candidates: SAMPLE_CANDIDATES,
      },
      { provider: 'anthropic', model: 'claude-3-5-haiku-latest', transport },
    );
    expect(result).toEqual({ kind: 'disambiguate-type', typeId: null });
  });
});

describe('buildDefineTypePrompt', () => {
  it('embeds column header + SQL type + samples (capped at 20)', () => {
    const { system, user } = buildDefineTypePrompt({
      kind: 'define-type',
      columnName: 'employee_id',
      sqlType: 'VARCHAR',
      samples: ['EMP-0001', 'EMP-0002'],
    });
    expect(system).toMatch(/define a new semantic type/);
    expect(system).toMatch(/snake_case_id/);
    expect(system).toMatch(/anchors/);
    expect(user).toContain('Column header: employee_id');
    expect(user).toContain('SQL type: VARCHAR');
    expect(user).toContain('EMP-0001');
    expect(user).toContain('EMP-0002');
  });

  it('caps samples at 20', () => {
    const samples = Array.from({ length: 50 }, (_, i) => `s${i}`);
    const { user } = buildDefineTypePrompt({
      kind: 'define-type',
      columnName: 'c',
      sqlType: 'VARCHAR',
      samples,
    });
    expect(user).toContain('s0');
    expect(user).toContain('s19');
    expect(user).not.toContain('s20');
  });
});

describe('parseDefineTypeResponse', () => {
  it('parses a clean JSON suggestion', () => {
    const r = parseDefineTypeResponse(
      JSON.stringify({
        id: 'employee_id',
        display_name: 'Employee ID',
        category: 'Identifier',
        regex: '^EMP-[0-9]{4}$',
      }),
    );
    expect(r).toEqual({
      kind: 'define-type',
      suggestion: {
        id: 'employee_id',
        display_name: 'Employee ID',
        category: 'Identifier',
        regex: '^EMP-[0-9]{4}$',
      },
    });
  });

  it('strips ```json``` fences if the model adds them', () => {
    const fenced =
      '```json\n{"id":"x","display_name":"X","category":"Code","regex":"^x$"}\n```';
    const r = parseDefineTypeResponse(fenced);
    expect(r.suggestion.id).toBe('x');
  });

  it('throws on malformed JSON', () => {
    expect(() => parseDefineTypeResponse('not json')).toThrow(SidecarError);
  });

  it('throws when any of {id, display_name, category, regex} is missing', () => {
    expect(() =>
      parseDefineTypeResponse(JSON.stringify({ id: 'x', display_name: 'X', category: 'Code' })),
    ).toThrow(SidecarError);
  });

  it('throws on non-snake_case id', () => {
    expect(() =>
      parseDefineTypeResponse(
        JSON.stringify({
          id: 'Employee ID',
          display_name: 'Employee ID',
          category: 'Identifier',
          regex: '^.+$',
        }),
      ),
    ).toThrow(/non-snake_case/);
  });

  it('throws on uncompilable regex', () => {
    expect(() =>
      parseDefineTypeResponse(
        JSON.stringify({
          id: 'x',
          display_name: 'X',
          category: 'Code',
          regex: '[invalid(',
        }),
      ),
    ).toThrow(/invalid regex/);
  });
});

describe('dispatchJob — define-type', () => {
  it('calls the transport with the define-type prompt and returns the parsed suggestion', async () => {
    _idb.set('sidecar/byok/anthropic', 'sk-ant-stub');
    const transport: SidecarTransport = async (req) => {
      expect(req.system).toMatch(/define a new semantic type/);
      expect(req.user).toContain('Column header: employee_id');
      expect(req.user).toContain('EMP-0001');
      return JSON.stringify({
        id: 'employee_id',
        display_name: 'Employee ID',
        category: 'Identifier',
        regex: '^EMP-[0-9]{4}$',
      });
    };
    const result = await dispatchJob(
      {
        kind: 'define-type',
        columnName: 'employee_id',
        sqlType: 'VARCHAR',
        samples: ['EMP-0001'],
      },
      { provider: 'anthropic', model: 'claude-3-5-haiku-latest', transport },
    );
    expect(result.kind).toBe('define-type');
    if (result.kind !== 'define-type') return;
    expect(result.suggestion.id).toBe('employee_id');
    expect(result.suggestion.regex).toBe('^EMP-[0-9]{4}$');
  });
});
