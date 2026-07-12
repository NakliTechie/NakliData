// Tolerant date parsing for generated SQL (Tier-1 date fix, 2026-07-12 pass).
//
// The `iso_date` / `iso_datetime` detectors now classify common NON-ISO date
// columns too (M/D/Y, D/M/Y, "September 25, 2021"). A plain `CAST(x AS TIMESTAMP)`
// in a report/quick-chart would then fail on those values, so any generated SQL
// that time-buckets a detected date column routes it through this helper: try
// the native ISO cast first, then a list of common `strptime` formats, else NULL
// (an unparseable row just drops out of the time series rather than erroring).

/** DuckDB formats tried, in order, after the native ISO cast. */
const STRPTIME_FORMATS = [
  '%m/%d/%Y %H:%M', // 12/1/2010 8:26  (US datetime)
  '%m/%d/%Y', // 12/1/2010
  '%d/%m/%Y %H:%M', // 1/12/2010 8:26  (EU datetime)
  '%d/%m/%Y', // 1/12/2010
  '%B %d, %Y', // September 25, 2021
  '%b %d, %Y', // Sep 25, 2021
  '%d %B %Y', // 25 September 2021
  '%Y/%m/%d', // 2010/12/01
];

/**
 * A DuckDB expression that parses `quotedColExpr` (an already-quoted identifier
 * or expression) to TIMESTAMP tolerantly, or NULL when nothing matches.
 */
export function dateCastExpr(quotedColExpr: string): string {
  const fmts = STRPTIME_FORMATS.map((f) => `'${f}'`).join(', ');
  return `COALESCE(TRY_CAST(${quotedColExpr} AS TIMESTAMP), try_strptime(${quotedColExpr}, [${fmts}]))`;
}
