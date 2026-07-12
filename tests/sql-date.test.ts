import { describe, expect, it } from 'vitest';
import { dateCastExpr } from '../src/core/sql-date.ts';

describe('dateCastExpr', () => {
  it('wraps the ISO cast with a try_strptime fallback list', () => {
    const e = dateCastExpr('"InvoiceDate"');
    expect(e).toContain('TRY_CAST("InvoiceDate" AS TIMESTAMP)');
    expect(e).toContain('try_strptime("InvoiceDate"');
    expect(e).toContain('COALESCE(');
    // covers the two formats seen in the real-data pass
    expect(e).toContain("'%m/%d/%Y %H:%M'");
    expect(e).toContain("'%B %d, %Y'");
  });
  it('is composable inside DATE_TRUNC', () => {
    const e = `DATE_TRUNC('month', ${dateCastExpr('"d"')})`;
    expect(e.startsWith("DATE_TRUNC('month', COALESCE(")).toBe(true);
  });
});
