import type { AgentErrorCode, AgentScope } from '../src/core/agent/contract.ts';

export interface AgentEvalDecision {
  tool: string | null;
  scope: AgentScope | null;
  errorCode: AgentErrorCode | null;
}

export interface AgentEvalCase {
  id: string;
  intent: string;
  expected: AgentEvalDecision;
  recorded: AgentEvalDecision;
}

export interface AgentEvalScore {
  pass: boolean;
  score: number;
  detail: string;
}

/** Deterministic tool/scope/error scoring. A correct tool under a broader scope
 * still fails: least authority is part of correctness, not a bonus. */
export function scoreAgentDecision(
  actual: AgentEvalDecision,
  expected: AgentEvalDecision,
): AgentEvalScore {
  const fields = [
    ['tool', actual.tool, expected.tool],
    ['scope', actual.scope, expected.scope],
    ['errorCode', actual.errorCode, expected.errorCode],
  ] as const;
  const matched = fields.filter(([, value, wanted]) => value === wanted);
  const mismatches = fields
    .filter(([, value, wanted]) => value !== wanted)
    .map(([name, value, wanted]) => `${name}: ${String(value)} ≠ ${String(wanted)}`);
  return {
    pass: mismatches.length === 0,
    score: matched.length / fields.length,
    detail:
      mismatches.length === 0
        ? 'exact tool, minimal scope, and honest outcome'
        : mismatches.join('; '),
  };
}
