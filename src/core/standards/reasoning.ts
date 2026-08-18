export const REASONING_PROFILE = 'naklidata-bounded-standards-reasoning-v1' as const;
export const MAX_REASONING_NODES = 5_000;
export const MAX_REASONING_FACTS = 20_000;
export const MAX_REASONING_APPLICATIONS = 100_000;
export const MAX_REASONING_PROPOSALS = 50_000;
export const MAX_REASONING_DEADLINE_MS = 5_000;
export const DEFAULT_REASONING_DEADLINE_MS = 1_000;

export type ReasoningFactKind =
  | 'skos_broader'
  | 'skos_broader_transitive'
  | 'skos_exact_match'
  | 'owl_subclass'
  | 'owl_equivalent_class'
  | 'owl_disjoint_class';

export interface ReasoningFact {
  id: string;
  kind: ReasoningFactKind;
  subject: string;
  object: string;
}

export interface ReasoningInput {
  workspaceId: string;
  workspaceRevision: number;
  expectedWorkspaceId: string;
  expectedWorkspaceRevision: number;
  facts: ReasoningFact[];
}

export interface ReasoningLimits {
  maxNodes: number;
  maxFacts: number;
  maxApplications: number;
  maxProposals: number;
  deadlineMs: number;
}

export type ReasoningRule =
  | 'skos-broader-transitive'
  | 'skos-exact-symmetry'
  | 'skos-exact-transitive'
  | 'owl-equivalent-to-subclass'
  | 'owl-subclass-transitive'
  | 'owl-mutual-subclass-equivalence'
  | 'owl-disjoint-downward';

export interface ReasoningProposal {
  id: string;
  fact: Omit<ReasoningFact, 'id'>;
  rule: ReasoningRule;
  premiseIds: string[];
  provenance: {
    profile: typeof REASONING_PROFILE;
    workspaceId: string;
    workspaceRevision: number;
    sourceGraphFingerprint: string;
  };
  confidence: 1;
  status: 'review';
  execution: 'none';
}

export interface ReasoningConflict {
  kind: 'equivalent_and_disjoint' | 'subclass_and_disjoint';
  left: string;
  right: string;
  premiseIds: string[];
}

export interface ReasoningResult {
  profile: typeof REASONING_PROFILE;
  proposals: ReasoningProposal[];
  conflicts: ReasoningConflict[];
  stats: {
    nodes: number;
    inputFacts: number;
    ruleApplications: number;
    inferredFacts: number;
    elapsedMs: number;
  };
}

export interface ReasoningOptions {
  signal?: AbortSignal;
  limits?: Partial<ReasoningLimits>;
  now?: () => number;
  yieldControl?: () => Promise<void>;
}

interface EdgeEvidence {
  premiseIds: string[];
  asserted: boolean;
  rule: ReasoningRule;
}

interface InferenceState {
  applications: number;
  proposals: Map<string, ReasoningProposal>;
  inputKeys: Set<string>;
  fingerprint: string;
  startedAt: number;
  limits: ReasoningLimits;
  now: () => number;
  signal: AbortSignal | null;
  yieldControl: () => Promise<void>;
  workspaceId: string;
  workspaceRevision: number;
}

export class ReasoningLimitError extends RangeError {
  override name = 'ReasoningLimitError';
}

export function buildReasoningFacts(
  document: CanonicalInterchangeV1,
  approvedOwlAxioms: ReadonlyArray<OwlNamedAxiomProposal>,
): ReasoningFact[] {
  const facts: ReasoningFact[] = [];
  for (const concept of [...document.concepts].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (concept.kind !== 'concept') continue;
    const subject = canonicalIri(document.namespace, concept.id);
    for (const broaderId of [...concept.broaderIds].sort((left, right) =>
      left.localeCompare(right),
    )) {
      const object = canonicalIri(document.namespace, broaderId);
      facts.push(reasoningFact('skos_broader', subject, object));
    }
    for (const mapping of concept.mappings
      .filter((item) => item.kind === 'exact')
      .sort((left, right) => left.targetIri.localeCompare(right.targetIri))) {
      facts.push(reasoningFact('skos_exact_match', subject, mapping.targetIri));
    }
  }
  for (const axiom of [...approvedOwlAxioms].sort((left, right) => {
    const leftKey = `${left.kind}\u0000${left.classIri}\u0000${left.targetIri}`;
    const rightKey = `${right.kind}\u0000${right.classIri}\u0000${right.targetIri}`;
    return leftKey.localeCompare(rightKey);
  })) {
    const kind: ReasoningFactKind =
      axiom.kind === 'subclass'
        ? 'owl_subclass'
        : axiom.kind === 'equivalent'
          ? 'owl_equivalent_class'
          : 'owl_disjoint_class';
    facts.push(reasoningFact(kind, axiom.classIri, axiom.targetIri));
  }
  return facts;
}

export async function runBoundedReasoning(
  input: ReasoningInput,
  options: ReasoningOptions = {},
): Promise<ReasoningResult> {
  assertWorkspaceOwnership(input);
  const limits = resolveLimits(options.limits);
  validateFacts(input.facts, limits);
  const nodes = new Set(input.facts.flatMap((fact) => [fact.subject, fact.object]));
  if (nodes.size > limits.maxNodes) {
    throw new ReasoningLimitError(`Reasoning graph exceeds ${limits.maxNodes} nodes.`);
  }
  const now = options.now ?? (() => performance.now());
  const state: InferenceState = {
    applications: 0,
    proposals: new Map(),
    inputKeys: new Set(input.facts.map(factKey)),
    fingerprint: sourceGraphFingerprint(input.facts),
    startedAt: now(),
    limits,
    now,
    signal: options.signal ?? null,
    yieldControl: options.yieldControl ?? defaultYield,
    workspaceId: input.workspaceId,
    workspaceRevision: input.workspaceRevision,
  };
  checkState(state);
  const byKind = groupFacts(input.facts);

  const broader = await transitiveClosure(byKind.get('skos_broader') ?? [], state);
  for (const [key, evidence] of broader) {
    const [subject, object] = splitDirectedKey(key);
    if (state.inputKeys.has(factKeyParts('skos_broader', subject, object))) continue;
    addProposal(
      state,
      'skos_broader_transitive',
      subject,
      object,
      'skos-broader-transitive',
      evidence.premiseIds,
    );
  }

  await inferExactMatches(byKind.get('skos_exact_match') ?? [], state);

  const subclassSeeds = [...(byKind.get('owl_subclass') ?? [])];
  for (const fact of byKind.get('owl_equivalent_class') ?? []) {
    addSeedAndProposal(
      subclassSeeds,
      state,
      'owl_subclass',
      fact.subject,
      fact.object,
      'owl-equivalent-to-subclass',
      [fact.id],
    );
    addSeedAndProposal(
      subclassSeeds,
      state,
      'owl_subclass',
      fact.object,
      fact.subject,
      'owl-equivalent-to-subclass',
      [fact.id],
    );
  }
  const subclass = await transitiveClosure(subclassSeeds, state);
  for (const [key, evidence] of subclass) {
    const [subject, object] = splitDirectedKey(key);
    if (state.inputKeys.has(factKeyParts('owl_subclass', subject, object))) continue;
    if (subject === object) continue;
    const existing = state.proposals.get(factKeyParts('owl_subclass', subject, object));
    if (!existing) {
      addProposal(
        state,
        'owl_subclass',
        subject,
        object,
        'owl-subclass-transitive',
        evidence.premiseIds,
      );
    }
  }
  await inferMutualSubclass(subclass, byKind.get('owl_equivalent_class') ?? [], state);
  const disjoint = await inferDisjointDownward(
    byKind.get('owl_disjoint_class') ?? [],
    subclass,
    state,
  );
  const conflicts = detectConflicts(subclass, disjoint, state.proposals, byKind);
  checkState(state);
  const proposals = [...state.proposals.values()].sort((left, right) =>
    proposalKey(left).localeCompare(proposalKey(right)),
  );
  return {
    profile: REASONING_PROFILE,
    proposals,
    conflicts,
    stats: {
      nodes: nodes.size,
      inputFacts: input.facts.length,
      ruleApplications: state.applications,
      inferredFacts: proposals.length,
      elapsedMs: Math.max(0, state.now() - state.startedAt),
    },
  };
}

async function transitiveClosure(
  facts: ReadonlyArray<ReasoningFact>,
  state: InferenceState,
): Promise<Map<string, EdgeEvidence>> {
  const adjacency = new Map<string, Array<{ target: string; premiseIds: string[] }>>();
  const closure = new Map<string, EdgeEvidence>();
  for (const fact of [...facts].sort((left, right) =>
    factKey(left).localeCompare(factKey(right)),
  )) {
    const edge = { target: fact.object, premiseIds: [fact.id] };
    const next = adjacency.get(fact.subject) ?? [];
    next.push(edge);
    adjacency.set(fact.subject, next);
    closure.set(directedKey(fact.subject, fact.object), {
      premiseIds: [fact.id],
      asserted: true,
      rule: 'owl-subclass-transitive',
    });
  }
  for (const next of adjacency.values())
    next.sort((left, right) => left.target.localeCompare(right.target));
  const starts = [...adjacency.keys()].sort((left, right) => left.localeCompare(right));
  for (const start of starts) {
    const reached = new Map<string, string[]>();
    const queue = [...(adjacency.get(start) ?? [])];
    for (const edge of queue) reached.set(edge.target, edge.premiseIds);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      if (!current) continue;
      await applyRule(state);
      for (const edge of adjacency.get(current.target) ?? []) {
        const premises = sortedUnique([...current.premiseIds, ...edge.premiseIds]);
        const known = reached.get(edge.target);
        if (known && comparePremises(known, premises) <= 0) continue;
        reached.set(edge.target, premises);
        queue.push({ target: edge.target, premiseIds: premises });
      }
    }
    for (const [target, premiseIds] of reached) {
      const key = directedKey(start, target);
      const current = closure.get(key);
      if (!current || comparePremises(premiseIds, current.premiseIds) < 0) {
        closure.set(key, {
          premiseIds,
          asserted: premiseIds.length === 1,
          rule: 'owl-subclass-transitive',
        });
      }
    }
  }
  return closure;
}

async function inferExactMatches(
  facts: ReadonlyArray<ReasoningFact>,
  state: InferenceState,
): Promise<void> {
  const adjacency = new Map<string, Array<{ target: string; premise: string }>>();
  for (const fact of facts) {
    for (const [left, right] of [
      [fact.subject, fact.object],
      [fact.object, fact.subject],
    ] as const) {
      const next = adjacency.get(left) ?? [];
      next.push({ target: right, premise: fact.id });
      adjacency.set(left, next);
    }
  }
  for (const next of adjacency.values())
    next.sort((left, right) => left.target.localeCompare(right.target));
  for (const start of [...adjacency.keys()].sort((left, right) => left.localeCompare(right))) {
    const reached = new Map<string, string[]>();
    const queue = (adjacency.get(start) ?? []).map((edge) => ({
      target: edge.target,
      premiseIds: [edge.premise],
    }));
    for (const item of queue) reached.set(item.target, item.premiseIds);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      if (!current) continue;
      await applyRule(state);
      for (const edge of adjacency.get(current.target) ?? []) {
        if (edge.target === start) continue;
        const premises = sortedUnique([...current.premiseIds, edge.premise]);
        const known = reached.get(edge.target);
        if (known && comparePremises(known, premises) <= 0) continue;
        reached.set(edge.target, premises);
        queue.push({ target: edge.target, premiseIds: premises });
      }
    }
    for (const [target, premiseIds] of reached) {
      if (target === start || state.inputKeys.has(factKeyParts('skos_exact_match', start, target)))
        continue;
      const reverseWasAsserted = state.inputKeys.has(
        factKeyParts('skos_exact_match', target, start),
      );
      addProposal(
        state,
        'skos_exact_match',
        start,
        target,
        reverseWasAsserted ? 'skos-exact-symmetry' : 'skos-exact-transitive',
        premiseIds,
      );
    }
  }
}

async function inferMutualSubclass(
  subclass: ReadonlyMap<string, EdgeEvidence>,
  equivalents: ReadonlyArray<ReasoningFact>,
  state: InferenceState,
): Promise<void> {
  const asserted = new Set(equivalents.map((fact) => unorderedKey(fact.subject, fact.object)));
  for (const [key, evidence] of [...subclass.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    await applyRule(state);
    const [subject, object] = splitDirectedKey(key);
    if (subject >= object || !subclass.has(directedKey(object, subject))) continue;
    const pair = unorderedKey(subject, object);
    if (asserted.has(pair)) continue;
    const reverse = subclass.get(directedKey(object, subject));
    if (!reverse) continue;
    addProposal(
      state,
      'owl_equivalent_class',
      subject,
      object,
      'owl-mutual-subclass-equivalence',
      sortedUnique([...evidence.premiseIds, ...reverse.premiseIds]),
    );
  }
}

async function inferDisjointDownward(
  facts: ReadonlyArray<ReasoningFact>,
  subclass: ReadonlyMap<string, EdgeEvidence>,
  state: InferenceState,
): Promise<Map<string, EdgeEvidence>> {
  const descendants = new Map<string, Map<string, string[]>>();
  for (const [key, evidence] of subclass) {
    const [child, parent] = splitDirectedKey(key);
    const values = descendants.get(parent) ?? new Map<string, string[]>();
    values.set(child, evidence.premiseIds);
    descendants.set(parent, values);
  }
  const result = new Map<string, EdgeEvidence>();
  for (const fact of [...facts].sort((left, right) =>
    factKey(left).localeCompare(factKey(right)),
  )) {
    result.set(unorderedKey(fact.subject, fact.object), {
      premiseIds: [fact.id],
      asserted: true,
      rule: 'owl-disjoint-downward',
    });
    const lefts = new Map([
      [fact.subject, [] as string[]],
      ...(descendants.get(fact.subject) ?? []),
    ]);
    const rights = new Map([
      [fact.object, [] as string[]],
      ...(descendants.get(fact.object) ?? []),
    ]);
    for (const [left, leftPremises] of lefts) {
      for (const [right, rightPremises] of rights) {
        await applyRule(state);
        if (left === right) continue;
        const key = unorderedKey(left, right);
        const premiseIds = sortedUnique([fact.id, ...leftPremises, ...rightPremises]);
        const current = result.get(key);
        if (!current || comparePremises(premiseIds, current.premiseIds) < 0) {
          result.set(key, {
            premiseIds,
            asserted: premiseIds.length === 1,
            rule: 'owl-disjoint-downward',
          });
        }
        if (
          !state.inputKeys.has(factKeyParts('owl_disjoint_class', left, right)) &&
          premiseIds.length > 1
        ) {
          addProposal(
            state,
            'owl_disjoint_class',
            left,
            right,
            'owl-disjoint-downward',
            premiseIds,
          );
        }
      }
    }
  }
  return result;
}

function detectConflicts(
  subclass: ReadonlyMap<string, EdgeEvidence>,
  disjoint: ReadonlyMap<string, EdgeEvidence>,
  proposals: ReadonlyMap<string, ReasoningProposal>,
  byKind: ReadonlyMap<ReasoningFactKind, ReasoningFact[]>,
): ReasoningConflict[] {
  const equivalent = new Map<string, string[]>();
  for (const fact of byKind.get('owl_equivalent_class') ?? []) {
    equivalent.set(unorderedKey(fact.subject, fact.object), [fact.id]);
  }
  for (const proposal of proposals.values()) {
    if (proposal.fact.kind === 'owl_equivalent_class') {
      equivalent.set(
        unorderedKey(proposal.fact.subject, proposal.fact.object),
        proposal.premiseIds,
      );
    }
  }
  const conflicts: ReasoningConflict[] = [];
  for (const [pair, evidence] of disjoint) {
    const [left, right] = splitUnorderedKey(pair);
    const equivalentEvidence = equivalent.get(pair);
    if (equivalentEvidence) {
      conflicts.push({
        kind: 'equivalent_and_disjoint',
        left,
        right,
        premiseIds: sortedUnique([...evidence.premiseIds, ...equivalentEvidence]),
      });
      continue;
    }
    const forward = subclass.get(directedKey(left, right));
    const reverse = subclass.get(directedKey(right, left));
    const subclassEvidence = forward ?? reverse;
    if (subclassEvidence) {
      conflicts.push({
        kind: 'subclass_and_disjoint',
        left,
        right,
        premiseIds: sortedUnique([...evidence.premiseIds, ...subclassEvidence.premiseIds]),
      });
    }
  }
  return conflicts.sort((left, right) =>
    `${left.kind}\u0000${left.left}\u0000${left.right}`.localeCompare(
      `${right.kind}\u0000${right.left}\u0000${right.right}`,
    ),
  );
}

function addSeedAndProposal(
  facts: ReasoningFact[],
  state: InferenceState,
  kind: ReasoningFactKind,
  subject: string,
  object: string,
  rule: ReasoningRule,
  premiseIds: string[],
): void {
  const id = premiseIds[0] ?? `derived:${stableHash(factKeyParts(kind, subject, object))}`;
  facts.push({ id, kind, subject, object });
  if (!state.inputKeys.has(factKeyParts(kind, subject, object))) {
    addProposal(state, kind, subject, object, rule, premiseIds);
  }
}

function addProposal(
  state: InferenceState,
  kind: ReasoningFactKind,
  subject: string,
  object: string,
  rule: ReasoningRule,
  premiseIds: string[],
): void {
  const key = factKeyParts(kind, subject, object);
  const existing = state.proposals.get(key);
  const normalizedPremises = sortedUnique(premiseIds);
  if (existing && comparePremises(existing.premiseIds, normalizedPremises) <= 0) return;
  if (!existing && state.proposals.size >= state.limits.maxProposals) {
    throw new ReasoningLimitError(
      `Reasoning output exceeds ${state.limits.maxProposals} proposals.`,
    );
  }
  state.proposals.set(key, {
    id: `reasoning:${stableHash(key)}`,
    fact: { kind, subject, object },
    rule,
    premiseIds: normalizedPremises,
    provenance: {
      profile: REASONING_PROFILE,
      workspaceId: state.workspaceId,
      workspaceRevision: state.workspaceRevision,
      sourceGraphFingerprint: state.fingerprint,
    },
    confidence: 1,
    status: 'review',
    execution: 'none',
  });
}

async function applyRule(state: InferenceState): Promise<void> {
  state.applications += 1;
  if (state.applications > state.limits.maxApplications) {
    throw new ReasoningLimitError(
      `Reasoning exceeded ${state.limits.maxApplications} rule applications.`,
    );
  }
  if (state.applications % 256 === 0) await state.yieldControl();
  checkState(state);
}

function checkState(state: InferenceState): void {
  if (state.signal?.aborted) throw abortError();
  if (state.now() - state.startedAt > state.limits.deadlineMs) {
    throw new ReasoningLimitError(`Reasoning exceeded ${state.limits.deadlineMs} ms.`);
  }
}

function assertWorkspaceOwnership(input: ReasoningInput): void {
  if (!input.workspaceId.trim() || input.workspaceId !== input.expectedWorkspaceId) {
    throw new TypeError('Reasoning workspace ownership changed.');
  }
  if (
    !Number.isSafeInteger(input.workspaceRevision) ||
    input.workspaceRevision < 0 ||
    input.workspaceRevision !== input.expectedWorkspaceRevision
  ) {
    throw new TypeError('Reasoning workspace revision changed.');
  }
}

function validateFacts(facts: ReadonlyArray<ReasoningFact>, limits: ReasoningLimits): void {
  if (facts.length > limits.maxFacts) {
    throw new ReasoningLimitError(`Reasoning graph exceeds ${limits.maxFacts} facts.`);
  }
  const ids = new Set<string>();
  const keys = new Set<string>();
  const supported: ReadonlySet<string> = new Set([
    'skos_broader',
    'skos_exact_match',
    'owl_subclass',
    'owl_equivalent_class',
    'owl_disjoint_class',
  ]);
  for (const fact of facts) {
    if (!fact.id.trim() || ids.has(fact.id))
      throw new TypeError(`Reasoning fact id is empty or duplicated: ${fact.id}`);
    if (!supported.has(fact.kind))
      throw new TypeError(`Reasoning fact kind is unsupported: ${fact.kind}`);
    if (!fact.subject.trim() || !fact.object.trim())
      throw new TypeError('Reasoning fact endpoints are required.');
    const key = factKey(fact);
    if (keys.has(key)) throw new TypeError(`Reasoning fact is duplicated: ${key}`);
    ids.add(fact.id);
    keys.add(key);
  }
}

function resolveLimits(overrides: Partial<ReasoningLimits> | undefined): ReasoningLimits {
  const limits: ReasoningLimits = {
    maxNodes: overrides?.maxNodes ?? MAX_REASONING_NODES,
    maxFacts: overrides?.maxFacts ?? MAX_REASONING_FACTS,
    maxApplications: overrides?.maxApplications ?? MAX_REASONING_APPLICATIONS,
    maxProposals: overrides?.maxProposals ?? MAX_REASONING_PROPOSALS,
    deadlineMs: overrides?.deadlineMs ?? DEFAULT_REASONING_DEADLINE_MS,
  };
  const ceilings: ReasoningLimits = {
    maxNodes: MAX_REASONING_NODES,
    maxFacts: MAX_REASONING_FACTS,
    maxApplications: MAX_REASONING_APPLICATIONS,
    maxProposals: MAX_REASONING_PROPOSALS,
    deadlineMs: MAX_REASONING_DEADLINE_MS,
  };
  for (const key of Object.keys(limits) as Array<keyof ReasoningLimits>) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > ceilings[key]) {
      throw new RangeError(`${key} must be an integer between 1 and ${ceilings[key]}.`);
    }
  }
  return limits;
}

function groupFacts(facts: ReadonlyArray<ReasoningFact>): Map<ReasoningFactKind, ReasoningFact[]> {
  const grouped = new Map<ReasoningFactKind, ReasoningFact[]>();
  for (const fact of facts) {
    const values = grouped.get(fact.kind) ?? [];
    values.push(fact);
    grouped.set(fact.kind, values);
  }
  return grouped;
}

function sourceGraphFingerprint(facts: ReadonlyArray<ReasoningFact>): string {
  return `fnv64-${stableHash([...facts].map(factKey).sort().join('\n'))}`;
}

function reasoningFact(kind: ReasoningFactKind, subject: string, object: string): ReasoningFact {
  const key = factKeyParts(kind, subject, object);
  return { id: `asserted:${stableHash(key)}`, kind, subject, object };
}

function factKey(fact: Pick<ReasoningFact, 'kind' | 'subject' | 'object'>): string {
  return factKeyParts(fact.kind, fact.subject, fact.object);
}

function factKeyParts(kind: ReasoningFactKind, subject: string, object: string): string {
  return `${kind}\u0000${subject}\u0000${object}`;
}

function proposalKey(proposal: ReasoningProposal): string {
  return factKey(proposal.fact);
}

function directedKey(subject: string, object: string): string {
  return `${subject}\u0000${object}`;
}

function unorderedKey(left: string, right: string): string {
  return left < right ? directedKey(left, right) : directedKey(right, left);
}

function splitDirectedKey(key: string): [string, string] {
  const index = key.indexOf('\u0000');
  return [key.slice(0, index), key.slice(index + 1)];
}

function splitUnorderedKey(key: string): [string, string] {
  return splitDirectedKey(key);
}

function comparePremises(left: ReadonlyArray<string>, right: ReadonlyArray<string>): number {
  if (left.length !== right.length) return left.length - right.length;
  return left.join('\u0000').localeCompare(right.join('\u0000'));
}

function sortedUnique(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function abortError(): Error {
  return new DOMException('Reasoning cancelled.', 'AbortError');
}

function defaultYield(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
import type { CanonicalInterchangeV1 } from './interchange.ts';
import { canonicalIri } from './interchange.ts';
import type { OwlNamedAxiomProposal } from './owl.ts';
