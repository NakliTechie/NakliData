export interface AnalyticalNumberDisplay {
  /** Human-facing, rounded/grouped representation. */
  text: string;
  /** Canonical value used for selections and precision disclosure. */
  exact: string;
}

const MONETARY_TYPE =
  /(?:^amount$|amount|price|fare|fee|income|compensation|sum_insured|contract_value|donation|premium)/;

/**
 * Display-only formatting for analytical tables. The caller keeps `exact` for
 * selection predicates, exports, and the precision tooltip; formatting never
 * mutates the query result.
 */
export function formatAnalyticalNumber(
  value: number | bigint,
  semanticTypeId: string | null = null,
  locale?: string,
): AnalyticalNumberDisplay {
  const exact = String(value);
  if (typeof value === 'bigint') {
    return {
      text: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value),
      exact,
    };
  }
  if (!Number.isFinite(value)) return { text: exact, exact };

  const monetary = semanticTypeId !== null && MONETARY_TYPE.test(semanticTypeId);
  const options: Intl.NumberFormatOptions = monetary
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : Number.isInteger(value)
      ? { maximumFractionDigits: 0 }
      : { maximumSignificantDigits: 15 };
  return { text: new Intl.NumberFormat(locale, options).format(value), exact };
}
