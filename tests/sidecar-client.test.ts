import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type SidecarTransport,
  buildDefineTypePrompt,
  buildDisambiguateTypePrompt,
  buildExplainErrorPrompt,
  buildNlToSqlPrompt,
  buildRecommendReportsPrompt,
  buildSummariseResultPrompt,
  dispatchJob,
  parseDefineTypeResponse,
  parseDisambiguateTypeResponse,
  parseExplainErrorResponse,
  parseNlToSqlResponse,
  parseRecommendReportsResponse,
  parseSummariseResultResponse,
} from '../src/core/sidecar/client.ts';
import {
  buildAssignTypePrompt,
  buildCreateTableDdl,
  buildNlToSchemaPrompt,
  dispatchOntologyJob,
  parseAssignTypeResponse,
  parseNlToSchemaResponse,
} from '../src/core/sidecar/ontology-jobs.ts';
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
    const fenced = '```json\n{"id":"x","display_name":"X","category":"Code","regex":"^x$"}\n```';
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

// ---- recommend-reports (Job 4 / Wave 3) -----------------------------

const REPORT_CANDIDATES = [
  {
    templateId: 'vendor_concentration',
    name: 'Vendor concentration',
    description: 'Top vendors by spend',
  },
  { templateId: 'ar_aging', name: 'AR aging', description: 'Receivables by age bucket' },
  { templateId: 'gst_recon', name: 'GST reconciliation', description: 'GST input vs output' },
];
const CANDIDATE_IDS = REPORT_CANDIDATES.map((c) => c.templateId);

describe('buildRecommendReportsPrompt', () => {
  it('lists candidate ids + names and includes the type summary', () => {
    const { system, user } = buildRecommendReportsPrompt({
      kind: 'recommend-reports',
      candidates: REPORT_CANDIDATES,
      typeSummary: 'invoices: gstin, amount',
    });
    expect(system).toMatch(/ONLY template_ids/i);
    expect(user).toContain('vendor_concentration');
    expect(user).toContain('invoices: gstin, amount');
  });
});

describe('parseRecommendReportsResponse', () => {
  it('parses + sorts recommendations by score descending', () => {
    const raw = JSON.stringify({
      recommendations: [
        { template_id: 'ar_aging', score: 0.6 },
        { template_id: 'vendor_concentration', score: 0.95 },
      ],
    });
    const r = parseRecommendReportsResponse(raw, CANDIDATE_IDS);
    expect(r.recommendations.map((x) => x.templateId)).toEqual([
      'vendor_concentration',
      'ar_aging',
    ]);
    expect(r.recommendations[0]?.score).toBe(0.95);
  });

  it('drops template_ids that are not in the candidate set (hallucination guard)', () => {
    const raw = JSON.stringify({
      recommendations: [
        { template_id: 'made_up_report', score: 0.99 },
        { template_id: 'gst_recon', score: 0.5 },
      ],
    });
    const r = parseRecommendReportsResponse(raw, CANDIDATE_IDS);
    expect(r.recommendations.map((x) => x.templateId)).toEqual(['gst_recon']);
  });

  it('clamps scores into [0, 1]', () => {
    const raw = JSON.stringify({
      recommendations: [
        { template_id: 'vendor_concentration', score: 1.7 },
        { template_id: 'ar_aging', score: -0.3 },
      ],
    });
    const r = parseRecommendReportsResponse(raw, CANDIDATE_IDS);
    const byId = Object.fromEntries(r.recommendations.map((x) => [x.templateId, x.score]));
    expect(byId.vendor_concentration).toBe(1);
    expect(byId.ar_aging).toBe(0);
  });

  it('de-duplicates repeated ids (keeps the first occurrence)', () => {
    const raw = JSON.stringify({
      recommendations: [
        { template_id: 'ar_aging', score: 0.8 },
        { template_id: 'ar_aging', score: 0.2 },
      ],
    });
    const r = parseRecommendReportsResponse(raw, CANDIDATE_IDS);
    expect(r.recommendations).toHaveLength(1);
    expect(r.recommendations[0]?.score).toBe(0.8);
  });

  it('strips code fences', () => {
    const raw = '```json\n{"recommendations":[{"template_id":"gst_recon","score":0.7}]}\n```';
    const r = parseRecommendReportsResponse(raw, CANDIDATE_IDS);
    expect(r.recommendations[0]?.templateId).toBe('gst_recon');
  });

  it('throws on non-JSON', () => {
    expect(() => parseRecommendReportsResponse('not json', CANDIDATE_IDS)).toThrow(SidecarError);
  });

  it('throws when recommendations is missing', () => {
    expect(() => parseRecommendReportsResponse('{}', CANDIDATE_IDS)).toThrow(/recommendations/);
  });

  it('returns an empty list when nothing matches (no throw)', () => {
    const raw = JSON.stringify({ recommendations: [{ template_id: 'nope', score: 1 }] });
    const r = parseRecommendReportsResponse(raw, CANDIDATE_IDS);
    expect(r.recommendations).toEqual([]);
  });
});

describe('dispatchJob — recommend-reports', () => {
  it('routes to the recommend-reports parser', async () => {
    _idb.set('sidecar/byok/openai', 'sk-openai-stub');
    const transport: SidecarTransport = async () =>
      JSON.stringify({ recommendations: [{ template_id: 'vendor_concentration', score: 0.9 }] });
    const result = await dispatchJob(
      { kind: 'recommend-reports', candidates: REPORT_CANDIDATES, typeSummary: 'invoices: amount' },
      { provider: 'openai', model: 'gpt-4o-mini', transport },
    );
    expect(result.kind).toBe('recommend-reports');
    if (result.kind !== 'recommend-reports') return;
    expect(result.recommendations[0]?.templateId).toBe('vendor_concentration');
  });
});

// ---- summarise-result (Job 6 / Wave 5 W5.2) -------------------------

const SUMMARY_COLUMNS = ['vendor_name', 'total'];

describe('buildSummariseResultPrompt', () => {
  it('includes the SQL, columns, row count, and sample rows', () => {
    const { system, user } = buildSummariseResultPrompt({
      kind: 'summarise-result',
      sql: 'SELECT vendor_name, SUM(amount) AS total FROM invoices GROUP BY 1',
      columns: SUMMARY_COLUMNS,
      rowCount: 42,
      sampleRows: [
        { vendor_name: 'Acme', total: '1000' },
        { vendor_name: 'Globex', total: '900' },
      ],
    });
    expect(system).toMatch(/one short sentence/i);
    expect(system).toMatch(/wrapped in backticks/i);
    expect(user).toContain('vendor_name, total');
    expect(user).toContain('Total rows: 42');
    expect(user).toContain('Acme');
  });
});

describe('parseSummariseResultResponse', () => {
  it('parses a normal observation', () => {
    const raw = JSON.stringify({
      observation: 'Top vendor is Acme at 1000 on `total`.',
    });
    const r = parseSummariseResultResponse(raw, SUMMARY_COLUMNS);
    expect(r.kind).toBe('summarise-result');
    expect(r.observation).toContain('Acme');
  });

  it('drops the response when a backticked column is not in the input (hallucination guard)', () => {
    const raw = JSON.stringify({
      observation: 'The dominant `country` is Acme.',
    });
    const r = parseSummariseResultResponse(raw, SUMMARY_COLUMNS);
    expect(r.observation).toBe('');
  });

  it('allows backticks around real columns case-insensitively', () => {
    const raw = JSON.stringify({
      observation: 'Largest `Total` belongs to `Vendor_Name` Acme.',
    });
    const r = parseSummariseResultResponse(raw, SUMMARY_COLUMNS);
    expect(r.observation).toContain('Acme');
  });

  it('caps overlong observations with an ellipsis', () => {
    const long = `Top vendor is Acme at 1000 on \`total\`. ${'x'.repeat(300)}`;
    const raw = JSON.stringify({ observation: long });
    const r = parseSummariseResultResponse(raw, SUMMARY_COLUMNS);
    expect(r.observation.length).toBeLessThanOrEqual(200);
    expect(r.observation.endsWith('…')).toBe(true);
  });

  it('collapses internal whitespace and newlines', () => {
    const raw = JSON.stringify({
      observation: 'Top vendor   is\nAcme\twith total 1000.',
    });
    const r = parseSummariseResultResponse(raw, SUMMARY_COLUMNS);
    expect(r.observation).toBe('Top vendor is Acme with total 1000.');
  });

  it('returns empty observation when the model declines (empty string)', () => {
    const raw = JSON.stringify({ observation: '' });
    const r = parseSummariseResultResponse(raw, SUMMARY_COLUMNS);
    expect(r.observation).toBe('');
  });

  it('strips code fences', () => {
    const raw = '```json\n{"observation":"Top vendor is Acme on `total`."}\n```';
    const r = parseSummariseResultResponse(raw, SUMMARY_COLUMNS);
    expect(r.observation).toContain('Acme');
  });

  it('throws on non-JSON', () => {
    expect(() => parseSummariseResultResponse('not json', SUMMARY_COLUMNS)).toThrow(SidecarError);
  });
});

describe('dispatchJob — summarise-result', () => {
  it('routes to the summarise-result parser', async () => {
    _idb.set('sidecar/byok/openai', 'sk-openai-stub');
    const transport: SidecarTransport = async () =>
      JSON.stringify({ observation: 'Top vendor is Acme at 1000 on `total`.' });
    const result = await dispatchJob(
      {
        kind: 'summarise-result',
        sql: 'SELECT vendor_name, SUM(amount) AS total FROM invoices GROUP BY 1',
        columns: SUMMARY_COLUMNS,
        rowCount: 5,
        sampleRows: [{ vendor_name: 'Acme', total: '1000' }],
      },
      { provider: 'openai', model: 'gpt-4o-mini', transport },
    );
    expect(result.kind).toBe('summarise-result');
    if (result.kind !== 'summarise-result') return;
    expect(result.observation).toContain('Acme');
  });
});

// ---- nl-to-sql (Job 5 / Wave 5 W5.1) --------------------------------

const NL_TABLES = [
  { name: 'invoices', columns: ['invoice_no', 'vendor_name', 'amount', 'iso_date'] },
  { name: 'payments', columns: ['payment_id', 'amount', 'payment_mode', 'iso_date'] },
];
const NL_TABLE_NAMES = NL_TABLES.map((t) => t.name);

describe('buildNlToSqlPrompt', () => {
  it('emits the schema block, dialect, and the user question', () => {
    const { system, user } = buildNlToSqlPrompt({
      kind: 'nl-to-sql',
      question: 'Top vendors by total amount',
      tables: NL_TABLES,
      dialect: 'duckdb',
    });
    expect(system).toMatch(/SELECT/);
    expect(system).toMatch(/NEVER emit INSERT/);
    expect(user).toContain('Dialect: duckdb');
    expect(user).toContain('invoices(invoice_no, vendor_name, amount, iso_date)');
    expect(user).toContain('Top vendors by total amount');
  });

  it('handles an empty schema gracefully', () => {
    const { user } = buildNlToSqlPrompt({
      kind: 'nl-to-sql',
      question: 'hi',
      tables: [],
    });
    expect(user).toContain('(no tables mounted)');
  });
});

describe('parseNlToSqlResponse', () => {
  it('returns the SQL when it starts with SELECT and tables exist', () => {
    const raw = 'SELECT vendor_name, SUM(amount) AS total FROM invoices GROUP BY 1';
    const r = parseNlToSqlResponse(raw, NL_TABLE_NAMES);
    expect(r.sql).toContain('SELECT');
    expect(r.sql).toContain('invoices');
  });

  it('strips ```sql``` fences', () => {
    const raw = '```sql\nSELECT * FROM invoices LIMIT 5\n```';
    const r = parseNlToSqlResponse(raw, NL_TABLE_NAMES);
    expect(r.sql).toBe('SELECT * FROM invoices LIMIT 5');
  });

  it('allows WITH (CTE)', () => {
    const raw = 'WITH x AS (SELECT * FROM invoices) SELECT * FROM x';
    const r = parseNlToSqlResponse(raw, NL_TABLE_NAMES);
    expect(r.sql).toContain('WITH x');
    expect(r.sql).toContain('SELECT * FROM x');
  });

  it('allows quoted table names', () => {
    const raw = 'SELECT * FROM "invoices"';
    const r = parseNlToSqlResponse(raw, NL_TABLE_NAMES);
    expect(r.sql).toContain('"invoices"');
  });

  it('drops DELETE statements', () => {
    const raw = 'DELETE FROM invoices WHERE amount < 0';
    const r = parseNlToSqlResponse(raw, NL_TABLE_NAMES);
    expect(r.sql).toBe('');
  });

  it('drops UPDATE statements', () => {
    const raw = 'UPDATE invoices SET amount = 0';
    const r = parseNlToSqlResponse(raw, NL_TABLE_NAMES);
    expect(r.sql).toBe('');
  });

  it('drops DDL (CREATE / DROP / ALTER)', () => {
    expect(parseNlToSqlResponse('CREATE TABLE foo AS SELECT 1', NL_TABLE_NAMES).sql).toBe('');
    expect(parseNlToSqlResponse('DROP TABLE invoices', NL_TABLE_NAMES).sql).toBe('');
    expect(parseNlToSqlResponse('ALTER TABLE invoices ADD COLUMN x INT', NL_TABLE_NAMES).sql).toBe(
      '',
    );
  });

  it('drops responses that reference an unknown table (hallucination guard)', () => {
    const raw = 'SELECT * FROM customers';
    const r = parseNlToSqlResponse(raw, NL_TABLE_NAMES);
    expect(r.sql).toBe('');
  });

  it('drops prose-wrapped responses', () => {
    const raw = "Sure! Here's a query: SELECT * FROM invoices";
    const r = parseNlToSqlResponse(raw, NL_TABLE_NAMES);
    expect(r.sql).toBe('');
  });

  it('returns empty for empty input', () => {
    expect(parseNlToSqlResponse('', NL_TABLE_NAMES).sql).toBe('');
    expect(parseNlToSqlResponse('   \n   ', NL_TABLE_NAMES).sql).toBe('');
  });

  it('allows CTE names that are not real tables', () => {
    const raw =
      'WITH ranked AS (SELECT vendor_name, SUM(amount) AS total FROM invoices GROUP BY 1) SELECT * FROM ranked';
    const r = parseNlToSqlResponse(raw, NL_TABLE_NAMES);
    expect(r.sql).toContain('FROM ranked');
  });

  it('allows JOINs across known tables', () => {
    const raw =
      'SELECT i.vendor_name, SUM(p.amount) AS paid FROM invoices i JOIN payments p ON p.iso_date = i.iso_date GROUP BY i.vendor_name';
    const r = parseNlToSqlResponse(raw, NL_TABLE_NAMES);
    expect(r.sql).toContain('invoices');
    expect(r.sql).toContain('payments');
  });

  it('drops JOIN onto an unknown table', () => {
    const raw = 'SELECT i.vendor_name FROM invoices i JOIN customers c ON c.id = i.vendor_name';
    const r = parseNlToSqlResponse(raw, NL_TABLE_NAMES);
    expect(r.sql).toBe('');
  });
});

describe('dispatchJob — nl-to-sql', () => {
  it('routes to the nl-to-sql parser', async () => {
    _idb.set('sidecar/byok/openai', 'sk-openai-stub');
    const transport: SidecarTransport = async () =>
      'SELECT vendor_name, SUM(amount) AS total FROM invoices GROUP BY 1 ORDER BY total DESC LIMIT 10';
    const result = await dispatchJob(
      { kind: 'nl-to-sql', question: 'Top vendors', tables: NL_TABLES, dialect: 'duckdb' },
      { provider: 'openai', model: 'gpt-4o-mini', transport },
    );
    expect(result.kind).toBe('nl-to-sql');
    if (result.kind !== 'nl-to-sql') return;
    expect(result.sql).toContain('invoices');
  });

  it('returns empty SQL when the transport ships a write statement', async () => {
    _idb.set('sidecar/byok/openai', 'sk-openai-stub');
    const transport: SidecarTransport = async () => 'DELETE FROM invoices';
    const result = await dispatchJob(
      { kind: 'nl-to-sql', question: 'remove things', tables: NL_TABLES },
      { provider: 'openai', model: 'gpt-4o-mini', transport },
    );
    expect(result.kind).toBe('nl-to-sql');
    if (result.kind !== 'nl-to-sql') return;
    expect(result.sql).toBe('');
  });
});

// ---- assign-type (Job 9) -------------------------------------------

const ASSIGN_CATALOG = [
  { typeId: 'email', displayName: 'Email', domain: 'contact' },
  { typeId: 'gstin', displayName: 'GSTIN', domain: 'finance-in' },
  { typeId: 'iso_date', displayName: 'ISO date', domain: 'temporal' },
];

describe('buildAssignTypePrompt', () => {
  it('embeds the column, samples, and the full catalog with domains', () => {
    const { system, user } = buildAssignTypePrompt({
      kind: 'assign-type',
      columnName: 'contact_email',
      sqlType: 'VARCHAR',
      samples: ['a@b.com', 'c@d.io'],
      catalog: ASSIGN_CATALOG,
    });
    expect(system).toMatch(/assigning a semantic type/i);
    expect(user).toContain('contact_email');
    expect(user).toContain('- email (Email) [contact]');
    expect(user).toContain('- gstin (GSTIN) [finance-in]');
    expect(user).toContain('a@b.com');
  });
});

describe('parseAssignTypeResponse', () => {
  it('accepts a valid catalog id (case-insensitively)', () => {
    expect(parseAssignTypeResponse('email', ASSIGN_CATALOG).typeId).toBe('email');
    expect(parseAssignTypeResponse('  EMAIL  ', ASSIGN_CATALOG).typeId).toBe('email');
    expect(parseAssignTypeResponse('`iso_date`', ASSIGN_CATALOG).typeId).toBe('iso_date');
  });

  it('coerces unknown / out-of-catalog / empty to null', () => {
    expect(parseAssignTypeResponse('unknown', ASSIGN_CATALOG).typeId).toBeNull();
    expect(parseAssignTypeResponse('made_up_type', ASSIGN_CATALOG).typeId).toBeNull();
    expect(parseAssignTypeResponse('', ASSIGN_CATALOG).typeId).toBeNull();
  });

  it('dispatches end-to-end and applies the hallucination guard', async () => {
    _idb.set('sidecar/byok/openai', 'sk-openai-stub');
    const transport: SidecarTransport = async () => 'not_in_catalog';
    const result = await dispatchOntologyJob(
      {
        kind: 'assign-type',
        columnName: 'x',
        sqlType: 'VARCHAR',
        samples: ['1'],
        catalog: ASSIGN_CATALOG,
      },
      { provider: 'openai', model: 'gpt-4o-mini', transport },
    );
    expect(result.kind).toBe('assign-type');
    if (result.kind !== 'assign-type') return;
    expect(result.typeId).toBeNull();
  });
});

// ---- nl-to-schema (Job 10) ------------------------------------------

const KNOWN_TYPES = [
  { typeId: 'email', displayName: 'Email' },
  { typeId: 'amount', displayName: 'Amount' },
  { typeId: 'iso_date', displayName: 'ISO date' },
];

describe('buildNlToSchemaPrompt', () => {
  it('embeds the description, optional table name, and known types', () => {
    const { system, user } = buildNlToSchemaPrompt({
      kind: 'nl-to-schema',
      description: 'a list of orders',
      tableName: 'orders',
      knownTypes: KNOWN_TYPES,
    });
    expect(system).toMatch(/inferring a tabular schema/i);
    expect(user).toContain('a list of orders');
    expect(user).toContain('Suggested table name: orders');
    expect(user).toContain('- email (Email)');
  });
});

describe('parseNlToSchemaResponse', () => {
  const KNOWN_IDS = KNOWN_TYPES.map((t) => t.typeId);

  it('parses a clean schema and maps known semantic types', () => {
    const raw = JSON.stringify({
      table_name: 'orders',
      columns: [
        { name: 'order_no', sql_type: 'VARCHAR', semantic_type_id: null, description: 'id' },
        { name: 'buyer_email', sql_type: 'VARCHAR', semantic_type_id: 'email', description: '' },
        { name: 'total', sql_type: 'DECIMAL(12,2)', semantic_type_id: 'amount', description: '' },
      ],
    });
    const r = parseNlToSchemaResponse(raw, KNOWN_IDS);
    expect(r.tableName).toBe('orders');
    expect(r.columns).toHaveLength(3);
    expect(r.columns[1]).toMatchObject({ name: 'buyer_email', semanticTypeId: 'email' });
    expect(r.columns[2]?.sqlType).toBe('DECIMAL(12,2)');
  });

  it('coerces a hallucinated semantic id to null and a bad sql type to VARCHAR', () => {
    const raw = JSON.stringify({
      table_name: 'x',
      columns: [{ name: 'a', sql_type: 'NONSENSE', semantic_type_id: 'made_up', description: '' }],
    });
    const r = parseNlToSchemaResponse(raw, KNOWN_IDS);
    expect(r.columns[0]).toMatchObject({ sqlType: 'VARCHAR', semanticTypeId: null });
  });

  it('sanitises names, drops unnamed/duplicate columns, and defaults the table name', () => {
    const raw = JSON.stringify({
      table_name: '',
      columns: [
        { name: 'Created At!', sql_type: 'DATE', semantic_type_id: 'iso_date' },
        { name: '', sql_type: 'VARCHAR' },
        { name: 'created_at', sql_type: 'DATE' },
      ],
    });
    const r = parseNlToSchemaResponse(raw, KNOWN_IDS);
    expect(r.tableName).toBe('new_dataset');
    expect(r.columns).toHaveLength(1);
    expect(r.columns[0]?.name).toBe('created_at');
  });

  it('returns an empty column set (rejection) when nothing usable survives', () => {
    const r = parseNlToSchemaResponse(JSON.stringify({ table_name: 'x', columns: [] }), KNOWN_IDS);
    expect(r.columns).toHaveLength(0);
    expect(r.tableName).toBe('');
  });

  it('strips ```json``` fences', () => {
    const fenced = `\`\`\`json\n${JSON.stringify({
      table_name: 't',
      columns: [{ name: 'c', sql_type: 'VARCHAR' }],
    })}\n\`\`\``;
    const r = parseNlToSchemaResponse(fenced, KNOWN_IDS);
    expect(r.columns).toHaveLength(1);
  });

  it('throws a parse error on non-JSON', () => {
    expect(() => parseNlToSchemaResponse('not json', KNOWN_IDS)).toThrow();
  });
});

describe('buildCreateTableDdl', () => {
  it('emits valid DDL with quoted identifiers and no trailing comma on the last column', () => {
    const ddl = buildCreateTableDdl({
      kind: 'nl-to-schema',
      tableName: 'orders',
      columns: [
        { name: 'order_no', sqlType: 'VARCHAR', semanticTypeId: null, description: '' },
        { name: 'total', sqlType: 'DECIMAL(12,2)', semanticTypeId: 'amount', description: 'sum' },
      ],
    });
    expect(ddl).toContain('CREATE TABLE "orders" (');
    expect(ddl).toContain('"order_no" VARCHAR,');
    expect(ddl).toContain('"total" DECIMAL(12,2)');
    expect(ddl).toContain('-- amount: sum');
    // The last column line must not end with a dangling comma before ");".
    expect(ddl).not.toMatch(/,\s*\)\s*;\s*$/);
    expect(ddl.trimEnd().endsWith(');')).toBe(true);
  });

  it('returns empty string for a rejected (empty) schema', () => {
    expect(buildCreateTableDdl({ kind: 'nl-to-schema', tableName: '', columns: [] })).toBe('');
  });
});
