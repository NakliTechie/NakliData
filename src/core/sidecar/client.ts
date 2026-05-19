// Top-level sidecar client — picks the configured provider, loads the
// stored key, builds the prompt for the requested job, calls the
// provider, parses the response into the job's structured shape.
//
// Tests substitute the provider call via the `transport` option so
// unit tests don't need real API access.

import { loadKey } from './byok.ts';
import { callAnthropic } from './providers/anthropic.ts';
import { callOpenAI } from './providers/openai.ts';
import {
  type ExplainErrorJob,
  type ExplainErrorResponse,
  SidecarError,
  type SidecarJob,
  type SidecarProvider,
  type SidecarResponse,
} from './types.ts';

export interface SidecarDispatchOpts {
  provider: SidecarProvider;
  model: string;
  signal?: AbortSignal;
  /** Override the provider transport — used by tests to stub fetch. */
  transport?: SidecarTransport;
}

export interface SidecarTransportRequest {
  provider: SidecarProvider;
  model: string;
  system: string;
  user: string;
  apiKey: string;
  signal?: AbortSignal;
}

export type SidecarTransport = (req: SidecarTransportRequest) => Promise<string>;

const defaultTransport: SidecarTransport = (req) => {
  if (req.provider === 'anthropic') {
    return callAnthropic({
      apiKey: req.apiKey,
      model: req.model,
      system: req.system,
      user: req.user,
      ...(req.signal ? { signal: req.signal } : {}),
    });
  }
  return callOpenAI({
    apiKey: req.apiKey,
    model: req.model,
    system: req.system,
    user: req.user,
    ...(req.signal ? { signal: req.signal } : {}),
  });
};

export async function dispatchJob(
  job: SidecarJob,
  opts: SidecarDispatchOpts,
): Promise<SidecarResponse> {
  const key = await loadKey(opts.provider);
  if (!key) {
    throw new SidecarError(
      `No API key configured for ${opts.provider}. Open Settings to add one.`,
      'no-key',
    );
  }
  const transport = opts.transport ?? defaultTransport;
  if (job.kind === 'explain-error') {
    const { system, user } = buildExplainErrorPrompt(job);
    const raw = await transport({
      provider: opts.provider,
      model: opts.model,
      system,
      user,
      apiKey: key,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return parseExplainErrorResponse(raw);
  }
  throw new SidecarError(`Unsupported job kind: ${(job as { kind: string }).kind}`, 'unsupported');
}

// ---- explain-error prompt + parser ----------------------------------

const EXPLAIN_ERROR_SYSTEM = `You are NakliData's sidecar. Your job is to explain DuckDB query errors to a data-curious user in 1-3 plain-English sentences. Always also suggest a corrected SQL on a new line when the fix is obvious (typos, missing tables, wrong function names). Output strictly as JSON in this shape:

{
  "explanation": "<1-3 sentences, no preamble>",
  "suggested_fix": "<corrected SQL or null if the error needs more context>"
}

Hard rules:
- Output ONLY the JSON object. No markdown code fences. No commentary outside the JSON.
- "explanation" is plain prose, not Markdown.
- "suggested_fix" is plain SQL text, or null. Never include placeholder syntax like <table>; if you don't know the table name, return null.
- Never invent table or column names that don't appear in the schema hint.`;

export function buildExplainErrorPrompt(job: ExplainErrorJob): {
  system: string;
  user: string;
} {
  const sections: string[] = [];
  sections.push('SQL the user tried to run:');
  sections.push('```sql');
  sections.push(job.sql);
  sections.push('```');
  sections.push('');
  sections.push('DuckDB error message:');
  sections.push('```');
  sections.push(job.errorMessage);
  sections.push('```');
  if (job.schemaHint) {
    sections.push('');
    sections.push('Schema (tables and columns currently mounted):');
    sections.push('```');
    sections.push(job.schemaHint);
    sections.push('```');
  }
  return {
    system: EXPLAIN_ERROR_SYSTEM,
    user: sections.join('\n'),
  };
}

export function parseExplainErrorResponse(raw: string): ExplainErrorResponse {
  // Strip ```json``` fences if the model added them despite instructions.
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  let parsed: { explanation?: unknown; suggested_fix?: unknown };
  try {
    parsed = JSON.parse(stripped) as typeof parsed;
  } catch (err) {
    throw new SidecarError(
      `Could not parse sidecar response as JSON: ${err instanceof Error ? err.message : String(err)}`,
      'parse',
    );
  }
  const explanation =
    typeof parsed.explanation === 'string' && parsed.explanation.trim()
      ? parsed.explanation.trim()
      : '';
  if (!explanation) {
    throw new SidecarError('Sidecar response missing "explanation" string.', 'parse');
  }
  const suggestedFix =
    typeof parsed.suggested_fix === 'string' && parsed.suggested_fix.trim()
      ? parsed.suggested_fix.trim()
      : null;
  return { kind: 'explain-error', explanation, suggestedFix };
}
