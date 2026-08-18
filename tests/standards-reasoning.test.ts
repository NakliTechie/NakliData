import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CanonicalInterchangeV1 } from '../src/core/standards/interchange.ts';
import {
  MAX_REASONING_MESSAGE_BYTES,
  assertReasoningMessageBound,
} from '../src/core/standards/reasoning-protocol.ts';
import {
  type ReasoningFact,
  ReasoningLimitError,
  buildReasoningFacts,
  runBoundedReasoning,
} from '../src/core/standards/reasoning.ts';

describe('bounded deterministic standards reasoning', () => {
  it('derives only the selected SKOS and OWL rules with premise traces', async () => {
    const result = await runBoundedReasoning(input(ruleFixture()));
    expect(result.proposals).toEqual(
      expect.arrayContaining([
        proposal('skos_broader_transitive', 'skos:A', 'skos:C', 'skos-broader-transitive'),
        proposal('skos_exact_match', 'skos:Y', 'skos:X', 'skos-exact-symmetry'),
        proposal('skos_exact_match', 'skos:X', 'skos:Z', 'skos-exact-transitive'),
        proposal('owl_subclass', 'owl:A', 'owl:B', 'owl-equivalent-to-subclass'),
        proposal('owl_subclass', 'owl:A', 'owl:C', 'owl-subclass-transitive'),
        proposal('owl_disjoint_class', 'owl:A', 'owl:E', 'owl-disjoint-downward'),
      ]),
    );
    expect(result.proposals.every((item) => item.status === 'review')).toBe(true);
    expect(result.proposals.every((item) => item.execution === 'none')).toBe(true);
    expect(result.proposals.every((item) => item.confidence === 1)).toBe(true);
    expect(result.proposals.every((item) => item.premiseIds.length > 0)).toBe(true);
  });

  it('builds separate SKOS and approved OWL facts without semantic promotion', () => {
    const document = readCanonicalFixture();
    const vendor = document.concepts.find((item) => item.id === 'nd:concept:vendor');
    if (!vendor) throw new Error('vendor concept fixture missing');
    vendor.broaderIds.push('nd:concept:finance');
    vendor.mappings.push({ kind: 'exact', targetIri: 'https://external.test/Vendor' });
    const facts = buildReasoningFacts(document, [
      {
        kind: 'subclass',
        classIri: `${document.namespace.baseIri}nd:concept:vendor`,
        targetIri: 'https://external.test/Organization',
      },
    ]);
    expect(facts.map((item) => item.kind)).toEqual([
      'skos_broader',
      'skos_exact_match',
      'owl_subclass',
    ]);
    expect(facts.every((item) => item.id.startsWith('asserted:'))).toBe(true);
  });

  it('is deterministic, non-mutating, and tied to workspace ownership', async () => {
    const facts = ruleFixture();
    const original = structuredClone(facts);
    const first = await runBoundedReasoning(input(facts));
    const second = await runBoundedReasoning(input([...facts].reverse()));
    expect(second.proposals).toEqual(first.proposals);
    expect(facts).toEqual(original);
    expect(first.proposals[0]?.provenance).toMatchObject({
      workspaceId: 'workspace-7',
      workspaceRevision: 12,
      sourceGraphFingerprint: expect.stringMatching(/^fnv64-/),
    });
    await expect(
      runBoundedReasoning({
        ...input(facts),
        expectedWorkspaceRevision: 13,
      }),
    ).rejects.toThrow(/revision changed/);
  });

  it('surfaces conflicting conclusions without applying either conclusion', async () => {
    const result = await runBoundedReasoning(
      input([
        fact('eq', 'owl_equivalent_class', 'owl:A', 'owl:B'),
        fact('disjoint', 'owl_disjoint_class', 'owl:A', 'owl:B'),
        fact('subclass', 'owl_subclass', 'owl:C', 'owl:D'),
        fact('subclass-disjoint', 'owl_disjoint_class', 'owl:C', 'owl:D'),
      ]),
    );
    expect(result.conflicts).toEqual([
      expect.objectContaining({ kind: 'equivalent_and_disjoint', left: 'owl:A', right: 'owl:B' }),
      expect.objectContaining({ kind: 'subclass_and_disjoint', left: 'owl:C', right: 'owl:D' }),
    ]);
    expect(result.proposals.every((item) => item.status === 'review')).toBe(true);
  });

  it('terminates on cycles and infers their named-class equivalence', async () => {
    const result = await runBoundedReasoning(
      input([
        fact('ab', 'owl_subclass', 'owl:A', 'owl:B'),
        fact('ba', 'owl_subclass', 'owl:B', 'owl:A'),
      ]),
    );
    expect(result.proposals).toContainEqual(
      proposal('owl_equivalent_class', 'owl:A', 'owl:B', 'owl-mutual-subclass-equivalence'),
    );
    expect(result.stats.ruleApplications).toBeLessThan(20);
  });

  it('matches the independent OWL-RL subclass entailment fixture', async () => {
    const result = await runBoundedReasoning(
      input([
        fact('ab', 'owl_subclass', 'https://example.test/owl/A', 'https://example.test/owl/B'),
        fact('bc', 'owl_subclass', 'https://example.test/owl/B', 'https://example.test/owl/C'),
      ]),
    );
    expect(result.proposals).toContainEqual(
      proposal(
        'owl_subclass',
        'https://example.test/owl/A',
        'https://example.test/owl/C',
        'owl-subclass-transitive',
      ),
    );
  });

  it('enforces fact, node, application, deadline, and message ceilings', async () => {
    const pair = [
      fact('ab', 'owl_subclass', 'owl:A', 'owl:B'),
      fact('bc', 'owl_subclass', 'owl:B', 'owl:C'),
    ];
    await expect(
      runBoundedReasoning(input(pair), { limits: { maxFacts: 1 } }),
    ).rejects.toBeInstanceOf(ReasoningLimitError);
    await expect(
      runBoundedReasoning(input(pair), { limits: { maxNodes: 2 } }),
    ).rejects.toBeInstanceOf(ReasoningLimitError);
    await expect(
      runBoundedReasoning(input(pair), { limits: { maxApplications: 1 } }),
    ).rejects.toBeInstanceOf(ReasoningLimitError);
    let clock = 0;
    await expect(
      runBoundedReasoning(input(pair), {
        limits: { deadlineMs: 1 },
        now: () => {
          clock += 2;
          return clock;
        },
      }),
    ).rejects.toThrow(/exceeded 1 ms/);
    expect(() =>
      assertReasoningMessageBound({ payload: 'x'.repeat(MAX_REASONING_MESSAGE_BYTES + 1) }),
    ).toThrow(/exceeds/);
  });

  it('honors cancellation before work and at a cooperative yield', async () => {
    const before = new AbortController();
    before.abort();
    await expect(
      runBoundedReasoning(input(ruleFixture()), { signal: before.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    const during = new AbortController();
    const chain = Array.from({ length: 40 }, (_, index) =>
      fact(`edge-${index}`, 'owl_subclass', `owl:${index}`, `owl:${index + 1}`),
    );
    await expect(
      runBoundedReasoning(input(chain), {
        signal: during.signal,
        yieldControl: async () => {
          during.abort();
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

function input(facts: ReasoningFact[]) {
  return {
    workspaceId: 'workspace-7',
    workspaceRevision: 12,
    expectedWorkspaceId: 'workspace-7',
    expectedWorkspaceRevision: 12,
    facts,
  };
}

function fact(
  id: string,
  kind: ReasoningFact['kind'],
  subject: string,
  object: string,
): ReasoningFact {
  return { id, kind, subject, object };
}

function ruleFixture(): ReasoningFact[] {
  return [
    fact('broader-ab', 'skos_broader', 'skos:A', 'skos:B'),
    fact('broader-bc', 'skos_broader', 'skos:B', 'skos:C'),
    fact('exact-xy', 'skos_exact_match', 'skos:X', 'skos:Y'),
    fact('exact-yz', 'skos_exact_match', 'skos:Y', 'skos:Z'),
    fact('equivalent-ab', 'owl_equivalent_class', 'owl:A', 'owl:B'),
    fact('subclass-bc', 'owl_subclass', 'owl:B', 'owl:C'),
    fact('disjoint-ce', 'owl_disjoint_class', 'owl:C', 'owl:E'),
  ];
}

function proposal(kind: ReasoningFact['kind'], subject: string, object: string, rule: string) {
  return expect.objectContaining({
    fact: { kind, subject, object },
    rule,
    premiseIds: expect.any(Array),
    status: 'review',
    execution: 'none',
  });
}

function readCanonicalFixture(): CanonicalInterchangeV1 {
  const path = fileURLToPath(new URL('fixtures/standards/s0/canonical-v1.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as CanonicalInterchangeV1;
}
