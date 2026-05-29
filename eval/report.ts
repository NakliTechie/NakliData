// Self-contained HTML report for the sidecar eval harness (W2.4).
// No chart libraries — inline CSS + a couple of tables. The report is
// meant to be opened directly in a browser or diffed across runs.

export interface CaseResult {
  job: string;
  id: string;
  pass: boolean;
  score: number;
  detail: string;
  rawResponse: string;
  durationMs: number;
  error?: string;
}

export interface RunMeta {
  provider: string;
  model: string;
  mode: 'live' | 'dry-run';
  startedAt: string;
  endpoint?: string;
}

export interface JobAggregate {
  job: string;
  total: number;
  passed: number;
  meanScore: number;
}

export function aggregate(results: CaseResult[]): JobAggregate[] {
  const byJob = new Map<string, CaseResult[]>();
  for (const r of results) {
    const list = byJob.get(r.job) ?? [];
    list.push(r);
    byJob.set(r.job, list);
  }
  return [...byJob.entries()].map(([job, list]) => ({
    job,
    total: list.length,
    passed: list.filter((r) => r.pass).length,
    meanScore: list.reduce((a, r) => a + r.score, 0) / (list.length || 1),
  }));
}

export function renderReport(results: CaseResult[], meta: RunMeta): string {
  const aggs = aggregate(results);
  const overallPass = results.filter((r) => r.pass).length;
  const overallTotal = results.length;
  const pct = (n: number, d: number) => (d === 0 ? '0' : ((n / d) * 100).toFixed(0));

  const aggRows = aggs
    .map(
      (a) => `
        <tr>
          <td>${esc(a.job)}</td>
          <td class="num">${a.passed}/${a.total}</td>
          <td class="num">${pct(a.passed, a.total)}%</td>
          <td class="num">${a.meanScore.toFixed(3)}</td>
        </tr>`,
    )
    .join('');

  const caseRows = results
    .map(
      (r) => `
        <tr class="${r.pass ? 'pass' : 'fail'}">
          <td>${esc(r.job)}</td>
          <td>${esc(r.id)}</td>
          <td class="status">${r.error ? 'ERROR' : r.pass ? 'PASS' : 'FAIL'}</td>
          <td class="num">${r.score.toFixed(2)}</td>
          <td>${esc(r.error ? r.error : r.detail)}</td>
          <td class="num">${r.durationMs}ms</td>
          <td><details><summary>raw</summary><pre>${esc(r.rawResponse)}</pre></details></td>
        </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>NakliData sidecar eval — ${esc(meta.provider)}/${esc(meta.model)}</title>
<style>
  :root { --bg:#1f1b16; --fg:#f4efe8; --muted:#a99e8e; --pass:#3c8c4f; --fail:#b5371c; --line:#3a342c; --card:#2a251f; }
  * { box-sizing: border-box; }
  body { margin:0; padding:2rem; background:var(--bg); color:var(--fg); font:14px/1.5 ui-sans-serif,system-ui,sans-serif; }
  h1 { font-size:1.25rem; margin:0 0 .25rem; }
  .meta { color:var(--muted); margin-bottom:1.5rem; }
  .meta code { color:var(--fg); }
  .summary { display:flex; gap:1rem; flex-wrap:wrap; margin-bottom:1.5rem; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:.75rem 1rem; min-width:9rem; }
  .stat .big { font-size:1.5rem; font-weight:600; }
  .stat .label { color:var(--muted); font-size:.8rem; }
  table { border-collapse:collapse; width:100%; margin-bottom:2rem; background:var(--card); border:1px solid var(--line); border-radius:8px; overflow:hidden; }
  th, td { text-align:left; padding:.5rem .75rem; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--muted); font-weight:600; font-size:.8rem; text-transform:uppercase; letter-spacing:.03em; }
  td.num { text-align:right; font-variant-numeric:tabular-nums; }
  tr.pass td.status { color:var(--pass); font-weight:600; }
  tr.fail td.status { color:var(--fail); font-weight:600; }
  pre { margin:.5rem 0 0; padding:.5rem; background:var(--bg); border-radius:4px; white-space:pre-wrap; word-break:break-word; max-width:40rem; }
  details summary { cursor:pointer; color:var(--muted); }
</style>
</head>
<body>
  <h1>NakliData sidecar eval</h1>
  <div class="meta">
    <code>${esc(meta.provider)}</code> · model <code>${esc(meta.model)}</code>${
      meta.endpoint ? ` · <code>${esc(meta.endpoint)}</code>` : ''
    } · <code>${esc(meta.mode)}</code> · ${esc(meta.startedAt)}
  </div>
  <div class="summary">
    <div class="stat"><div class="big">${pct(overallPass, overallTotal)}%</div><div class="label">overall pass (${overallPass}/${overallTotal})</div></div>
    ${aggs
      .map(
        (a) =>
          `<div class="stat"><div class="big">${pct(a.passed, a.total)}%</div><div class="label">${esc(a.job)} (${a.passed}/${a.total})</div></div>`,
      )
      .join('')}
  </div>

  <h2>Per-job aggregate</h2>
  <table>
    <thead><tr><th>Job</th><th class="num">Passed</th><th class="num">Pass %</th><th class="num">Mean score</th></tr></thead>
    <tbody>${aggRows}</tbody>
  </table>

  <h2>Cases</h2>
  <table>
    <thead><tr><th>Job</th><th>Case</th><th>Status</th><th class="num">Score</th><th>Detail</th><th class="num">Time</th><th>Response</th></tr></thead>
    <tbody>${caseRows}</tbody>
  </table>
</body>
</html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
