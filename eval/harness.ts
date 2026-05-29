// Sidecar eval harness (W2.4) — orchestration.
//
// Reads held-out fixtures, runs each case through the SAME prompt
// builders + response parsers the app uses (imported from
// src/core/sidecar/client.ts), scores deterministically, and emits an
// HTML report. Two modes:
//   - live:     call the configured provider (needs an API key in env)
//   - dry-run:  feed each fixture's recorded raw response through the
//               parser + scorer (no network; exercises the harness +
//               the parsers offline, and doubles as a regression check)
//
// The harness is bundled + run via eval/run.mjs (esbuild) so it can
// import the project's `.ts` modules directly without a TS runner dep.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildDefineTypePrompt,
  buildDisambiguateTypePrompt,
  buildExplainErrorPrompt,
  buildRecommendReportsPrompt,
  parseDefineTypeResponse,
  parseDisambiguateTypeResponse,
  parseExplainErrorResponse,
  parseRecommendReportsResponse,
} from '../src/core/sidecar/client.ts';
import { callAnthropic } from '../src/core/sidecar/providers/anthropic.ts';
import { callCustomOpenAI } from '../src/core/sidecar/providers/custom-openai.ts';
import { callOpenAI } from '../src/core/sidecar/providers/openai.ts';
import type {
  DefineTypeJob,
  DisambiguateTypeJob,
  ExplainErrorJob,
  RecommendReportsJob,
} from '../src/core/sidecar/types.ts';
import { type CaseResult, type RunMeta, aggregate, renderReport } from './report.ts';
import {
  type DefineTypeExpected,
  type DisambiguateExpected,
  type ExplainErrorExpected,
  type RecommendReportsExpected,
  scoreDefineType,
  scoreDisambiguateType,
  scoreExplainError,
  scoreRecommendReports,
} from './score.ts';

export type Provider = 'anthropic' | 'openai' | 'custom';
export type JobName = 'explain-error' | 'disambiguate-type' | 'define-type' | 'recommend-reports';
export const ALL_JOBS: JobName[] = [
  'explain-error',
  'disambiguate-type',
  'define-type',
  'recommend-reports',
];

export interface HarnessOpts {
  provider: Provider;
  model: string;
  apiKey: string;
  endpoint?: string;
  jobs: JobName[];
  dryRun: boolean;
  fixturesDir: string;
  outFile: string;
}

// ---- fixture shapes -------------------------------------------------

interface FixtureCase<Input, Expected> {
  id: string;
  input: Input;
  expected: Expected;
  /** Recorded raw model output, used in --dry-run. */
  recordedResponse: string;
}

interface FixtureFile<Input, Expected> {
  job: JobName;
  cases: FixtureCase<Input, Expected>[];
}

type ExplainInput = Omit<ExplainErrorJob, 'kind'>;
type DisambiguateInput = Omit<DisambiguateTypeJob, 'kind'>;
type DefineInput = Omit<DefineTypeJob, 'kind'>;
type RecommendInput = Omit<RecommendReportsJob, 'kind'>;

// ---- main -----------------------------------------------------------

export async function main(opts: HarnessOpts): Promise<{ pass: number; total: number }> {
  const results: CaseResult[] = [];
  for (const job of opts.jobs) {
    const fixture = await loadFixture(job, opts.fixturesDir);
    for (const c of fixture.cases) {
      results.push(await runCase(job, c, opts));
    }
  }

  const meta: RunMeta = {
    provider: opts.provider,
    model: opts.model || '(unset)',
    mode: opts.dryRun ? 'dry-run' : 'live',
    startedAt: new Date().toISOString(),
    ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
  };
  const html = renderReport(results, meta);
  await writeFile(opts.outFile, html, 'utf8');

  // Console summary.
  const aggs = aggregate(results);
  const pass = results.filter((r) => r.pass).length;
  const total = results.length;
  process.stdout.write(`\nSidecar eval — ${meta.provider}/${meta.model} (${meta.mode})\n`);
  for (const a of aggs) {
    process.stdout.write(
      `  ${a.job.padEnd(20)} ${a.passed}/${a.total} pass · mean ${a.meanScore.toFixed(3)}\n`,
    );
  }
  process.stdout.write(`  ${'TOTAL'.padEnd(20)} ${pass}/${total} pass\n`);
  process.stdout.write(`\nReport: ${opts.outFile}\n`);
  return { pass, total };
}

async function runCase(
  job: JobName,
  c: FixtureCase<unknown, unknown>,
  opts: HarnessOpts,
): Promise<CaseResult> {
  const started = Date.now();
  try {
    if (job === 'disambiguate-type') {
      const input = c.input as DisambiguateInput;
      const raw = await getRaw(opts, c.recordedResponse, () =>
        buildDisambiguateTypePrompt({ kind: 'disambiguate-type', ...input }),
      );
      const parsed = parseDisambiguateTypeResponse(raw, input.candidates);
      const s = scoreDisambiguateType(parsed, c.expected as DisambiguateExpected);
      return mk(job, c.id, s, raw, started);
    }
    if (job === 'define-type') {
      const input = c.input as DefineInput;
      const raw = await getRaw(opts, c.recordedResponse, () =>
        buildDefineTypePrompt({ kind: 'define-type', ...input }),
      );
      const parsed = parseDefineTypeResponse(raw);
      const s = scoreDefineType(parsed, c.expected as DefineTypeExpected, input.samples);
      return mk(job, c.id, s, raw, started);
    }
    if (job === 'recommend-reports') {
      const input = c.input as RecommendInput;
      const raw = await getRaw(opts, c.recordedResponse, () =>
        buildRecommendReportsPrompt({ kind: 'recommend-reports', ...input }),
      );
      const parsed = parseRecommendReportsResponse(
        raw,
        input.candidates.map((cand) => cand.templateId),
      );
      const s = scoreRecommendReports(parsed, c.expected as RecommendReportsExpected);
      return mk(job, c.id, s, raw, started);
    }
    // explain-error
    const input = c.input as ExplainInput;
    const raw = await getRaw(opts, c.recordedResponse, () =>
      buildExplainErrorPrompt({ kind: 'explain-error', ...input }),
    );
    const parsed = parseExplainErrorResponse(raw);
    const s = scoreExplainError(parsed, c.expected as ExplainErrorExpected);
    return mk(job, c.id, s, raw, started);
  } catch (err) {
    return {
      job,
      id: c.id,
      pass: false,
      score: 0,
      detail: '',
      rawResponse: '',
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * In dry-run, return the recorded response verbatim. In live mode,
 * build the prompt via the supplied builder and call the provider.
 */
async function getRaw(
  opts: HarnessOpts,
  recorded: string,
  buildPrompt: () => { system: string; user: string },
): Promise<string> {
  if (opts.dryRun) return recorded;
  const { system, user } = buildPrompt();
  return callProvider(opts, system, user);
}

async function callProvider(opts: HarnessOpts, system: string, user: string): Promise<string> {
  if (opts.provider === 'anthropic') {
    return callAnthropic({ apiKey: opts.apiKey, model: opts.model, system, user });
  }
  if (opts.provider === 'custom') {
    return callCustomOpenAI({
      endpointUrl: opts.endpoint ?? '',
      apiKey: opts.apiKey,
      model: opts.model,
      system,
      user,
    });
  }
  return callOpenAI({ apiKey: opts.apiKey, model: opts.model, system, user });
}

function mk(
  job: JobName,
  id: string,
  s: { pass: boolean; score: number; detail: string },
  raw: string,
  started: number,
): CaseResult {
  return {
    job,
    id,
    pass: s.pass,
    score: s.score,
    detail: s.detail,
    rawResponse: raw,
    durationMs: Date.now() - started,
  };
}

async function loadFixture(job: JobName, dir: string): Promise<FixtureFile<unknown, unknown>> {
  const path = join(dir, `${job}.json`);
  const text = await readFile(path, 'utf8');
  const parsed = JSON.parse(text) as FixtureFile<unknown, unknown>;
  if (parsed.job !== job) {
    throw new Error(`Fixture ${path} declares job "${parsed.job}" but is loaded for "${job}".`);
  }
  return parsed;
}
