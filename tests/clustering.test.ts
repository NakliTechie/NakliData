// Resolve track M1 — clustering / fuzzy-merge core tests.
//
// Two load-bearing properties under test:
//   1. Correct clustering — fingerprint collisions, NN threshold + blocking,
//      deterministic canonical defaults, singleton-is-not-a-cluster.
//   2. Injection-safe emit — the CASE cell must hold against hostile column
//      names + hostile variant values (mirrors tests/anonymize.test.ts).

import { describe, expect, it } from 'vitest';
import {
  cluster,
  type Cluster,
  NN_DEFAULT_THRESHOLD,
  NN_MAX_DISTINCT,
  type ValueCount,
  borderlinePairs,
  buildMergeCaseSql,
  clampThreshold,
  clusterByKeyCollision,
  clusterByNearestNeighbour,
  fingerprint,
  pickCanonical,
  similarity,
} from '../src/core/clustering.ts';
import { buildProposeMergePrompt, parseProposeMergeResponse } from '../src/core/sidecar/client.ts';

const vc = (value: string, count: number): ValueCount => ({ value, count });

// ── fingerprint ─────────────────────────────────────────────────────────

describe('fingerprint', () => {
  it('collides the Sharma Trading Co family (case + trailing punctuation)', () => {
    const fp = fingerprint('Sharma Trading Co');
    expect(fingerprint('Sharma Trading Co.')).toBe(fp);
    expect(fingerprint('SHARMA TRADING CO')).toBe(fp);
    expect(fingerprint('  sharma   trading  co  ')).toBe(fp);
    // Token-sorted, lowercased.
    expect(fp).toBe('co sharma trading');
  });

  it('folds diacritics (NFKD + strip combining marks)', () => {
    expect(fingerprint('José')).toBe(fingerprint('Jose'));
    expect(fingerprint('Müller')).toBe(fingerprint('Muller'));
    expect(fingerprint('Łódź café')).toBe(fingerprint('Łódź café'));
  });

  it('is invariant to token order', () => {
    expect(fingerprint('John Smith')).toBe(fingerprint('Smith John'));
  });

  it('dedupes repeated tokens', () => {
    expect(fingerprint('New York New York')).toBe('new york');
    expect(fingerprint('York New')).toBe('new york');
  });

  it('reduces an all-punctuation / whitespace value to the empty string', () => {
    expect(fingerprint('   ')).toBe('');
    expect(fingerprint('!!! ... ---')).toBe('');
  });

  it('keeps digits as token content', () => {
    expect(fingerprint('Route 66')).toBe('66 route');
  });
});

// ── pickCanonical (deterministic tie-breaks) ─────────────────────────────

describe('pickCanonical', () => {
  it('picks the most frequent value', () => {
    expect(pickCanonical([vc('a', 3), vc('b', 5), vc('c', 1)])).toBe('b');
  });
  it('breaks count ties by longest', () => {
    expect(pickCanonical([vc('bb', 2), vc('a', 2)])).toBe('bb');
  });
  it('breaks count+length ties lexicographically (first wins)', () => {
    expect(pickCanonical([vc('zz', 2), vc('aa', 2)])).toBe('aa');
  });
});

// ── key-collision clustering ─────────────────────────────────────────────

describe('clusterByKeyCollision', () => {
  it('groups variant spellings into one cluster, canonical = most frequent', () => {
    const clusters = clusterByKeyCollision([
      vc('Sharma Trading Co', 5),
      vc('Sharma Trading Co.', 2),
      vc('SHARMA TRADING CO', 1),
      vc('Acme Inc', 9),
    ]);
    expect(clusters).toHaveLength(1); // Acme Inc is a singleton → not a cluster
    const c = clusters[0];
    expect(c?.canonical).toBe('Sharma Trading Co');
    expect(c?.values.map((v) => v.value).sort()).toEqual([
      'SHARMA TRADING CO',
      'Sharma Trading Co',
      'Sharma Trading Co.',
    ]);
  });

  it('does NOT treat a singleton fingerprint as a cluster', () => {
    expect(clusterByKeyCollision([vc('Acme', 3), vc('Globex', 4)])).toHaveLength(0);
  });

  it('skips values that fingerprint to empty (all punctuation)', () => {
    expect(clusterByKeyCollision([vc('!!!', 2), vc('???', 2)])).toHaveLength(0);
  });

  it('sorts clusters by total row count, most impactful first', () => {
    const clusters = clusterByKeyCollision([
      vc('big co', 1),
      vc('Big Co', 1),
      vc('huge corp', 50),
      vc('Huge Corp', 40),
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]?.canonical).toBe('huge corp'); // 90 rows > 2 rows
  });
});

// ── nearest-neighbour clustering ─────────────────────────────────────────

describe('similarity', () => {
  it('is 1.0 for case/whitespace-only differences', () => {
    expect(similarity('Acme Inc', 'acme inc')).toBe(1);
    expect(similarity('  Acme  ', 'acme')).toBe(1);
  });
  it('computes normalized edit distance', () => {
    // "microsoft" (9) vs "microsft" (8): 1 deletion → 1 - 1/9.
    expect(similarity('Microsoft', 'Microsft')).toBeCloseTo(1 - 1 / 9, 10);
    // "abcde" vs "abcdx": 1 substitution / maxLen 5 → 0.8 exactly.
    expect(similarity('abcde', 'abcdx')).toBe(0.8);
  });
});

describe('clusterByNearestNeighbour', () => {
  it('groups a typo within the threshold', () => {
    const { clusters, tooMany } = clusterByNearestNeighbour(
      [vc('Microsoft', 10), vc('Microsft', 1), vc('Apple', 8)],
      NN_DEFAULT_THRESHOLD,
    );
    expect(tooMany).toBe(false);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.canonical).toBe('Microsoft');
    expect(clusters[0]?.values.map((v) => v.value).sort()).toEqual(['Microsft', 'Microsoft']);
  });

  it('respects the threshold boundary (just-in vs just-out)', () => {
    const pair = [vc('abcde', 2), vc('abcdx', 1)]; // similarity exactly 0.80
    // threshold 0.80 → 0.80 >= 0.80 → grouped
    expect(clusterByNearestNeighbour(pair, 0.8).clusters).toHaveLength(1);
    // threshold 0.81 → 0.80 < 0.81 → not grouped
    expect(clusterByNearestNeighbour(pair, 0.81).clusters).toHaveLength(0);
  });

  it('chains via single-link (a~b, b~c ⇒ one cluster)', () => {
    // colour↔colouur (1) and colouur↔colouuur (1) link transitively.
    const { clusters } = clusterByNearestNeighbour(
      [vc('colour', 3), vc('colouur', 2), vc('colouuur', 1)],
      0.8,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.values).toHaveLength(3);
  });

  it('does not merge values below threshold', () => {
    expect(clusterByNearestNeighbour([vc('cat', 1), vc('dog', 1)], 0.7).clusters).toHaveLength(0);
  });

  it('short-circuits with tooMany above the distinct-value cap', () => {
    const many = Array.from({ length: NN_MAX_DISTINCT + 1 }, (_, i) => vc(`value_${i}`, 1));
    const res = clusterByNearestNeighbour(many);
    expect(res.tooMany).toBe(true);
    expect(res.clusters).toHaveLength(0);
  });
});

describe('clampThreshold', () => {
  it('clamps to [0.70, 0.95] and defaults non-finite', () => {
    expect(clampThreshold(0.5)).toBe(0.7);
    expect(clampThreshold(0.99)).toBe(0.95);
    expect(clampThreshold(0.85)).toBe(0.85);
    expect(clampThreshold(Number.NaN)).toBe(NN_DEFAULT_THRESHOLD);
  });
});

describe('cluster dispatcher', () => {
  it('routes to key-collision (tooMany always false)', () => {
    const res = cluster([vc('A', 1), vc('a', 1)], 'key-collision');
    expect(res.tooMany).toBe(false);
    expect(res.clusters).toHaveLength(1);
  });
  it('routes to nearest-neighbour', () => {
    const res = cluster([vc('Microsoft', 2), vc('Microsft', 1)], 'nearest-neighbour');
    expect(res.clusters).toHaveLength(1);
  });
});

describe('borderlinePairs (sidecar candidate set)', () => {
  it('returns pairs in [threshold-band, threshold) — just below the bar', () => {
    // sim('abcde','abcdx') = 0.80. At threshold 0.85, band 0.10 → window [0.75, 0.85).
    const pairs = borderlinePairs([vc('abcde', 5), vc('abcdx', 2)], 0.85);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ aCount: 5, bCount: 2 });
  });

  it('excludes pairs at/above the threshold (those are already NN clusters)', () => {
    // At threshold 0.80, sim 0.80 is NOT < 0.80 → not borderline.
    expect(borderlinePairs([vc('abcde', 1), vc('abcdx', 1)], 0.8)).toHaveLength(0);
  });

  it('excludes pairs far below the band', () => {
    expect(borderlinePairs([vc('cat', 1), vc('dog', 1)], 0.85)).toHaveLength(0);
  });
});

// ── the CASE-cell artifact (injection-critical) ──────────────────────────

const sharmaCluster: Cluster = {
  canonical: 'Sharma Trading Co',
  values: [vc('Sharma Trading Co', 5), vc('Sharma Trading Co.', 2), vc('SHARMA TRADING CO', 1)],
};

describe('buildMergeCaseSql — shape', () => {
  it('emits the additive CASE cell matching the handoff §4 example', () => {
    const sql = buildMergeCaseSql(
      'vendor_name',
      [sharmaCluster],
      'SELECT vendor_name FROM invoices',
    );
    expect(sql).toBe(
      [
        'SELECT *,',
        '  CASE',
        `    WHEN "vendor_name" IN ('Sharma Trading Co.', 'SHARMA TRADING CO') THEN 'Sharma Trading Co'`,
        '    ELSE "vendor_name"',
        '  END AS "vendor_name__merged"',
        'FROM (',
        'SELECT vendor_name FROM invoices',
        ') AS cluster_src',
      ].join('\n'),
    );
  });

  it('excludes the canonical from its own IN list (it falls through ELSE)', () => {
    const sql = buildMergeCaseSql('c', [sharmaCluster], 'SELECT c FROM t');
    expect(sql).not.toContain(`IN ('Sharma Trading Co'`);
    expect(sql).toContain(`THEN 'Sharma Trading Co'`);
  });

  it('strips a trailing semicolon from the upstream SQL so the wrap stays valid', () => {
    const sql = buildMergeCaseSql('c', [sharmaCluster], 'SELECT c FROM t;');
    expect(sql).toContain('SELECT c FROM t\n) AS cluster_src');
    expect(sql).not.toContain('FROM t;');
  });

  it('emits an honest copy when no cluster has a real remap (no arms)', () => {
    const sql = buildMergeCaseSql('c', [], 'SELECT c FROM t');
    expect(sql).toBe('SELECT *, "c" AS "c__merged"\nFROM (\nSELECT c FROM t\n) AS cluster_src');
    expect(sql).not.toContain('CASE');
  });

  it('honors a custom alias suffix', () => {
    const sql = buildMergeCaseSql('c', [sharmaCluster], 'SELECT c FROM t', {
      aliasSuffix: '__canonical',
    });
    expect(sql).toContain('AS "c__canonical"');
  });
});

describe('buildMergeCaseSql — injection resistance', () => {
  it('hostile column name with a single quote survives via quoteIdent', () => {
    const sql = buildMergeCaseSql(`x'; DROP TABLE users; --`, [sharmaCluster], 'SELECT 1');
    // Single quotes are legal inside a double-quoted identifier — not escaped,
    // but structurally inert (the whole name is one quoted ident).
    expect(sql).toContain(`"x'; DROP TABLE users; --" IN (`);
    expect(sql).toContain(`END AS "x'; DROP TABLE users; --__merged"`);
  });

  it('hostile column name with a double quote is doubled (DuckDB ident rule)', () => {
    const sql = buildMergeCaseSql(`x"; DROP TABLE x; --`, [sharmaCluster], 'SELECT 1');
    expect(sql).toContain(`"x""; DROP TABLE x; --" IN (`);
    // The raw unescaped double-quote-then-text must never appear bare.
    expect(sql).not.toContain(`"x"; DROP TABLE x; --"`);
  });

  it('hostile variant value with a single quote is doubled via quoteLiteral', () => {
    const hostile: Cluster = {
      canonical: "O'Brien & Sons",
      values: [vc("O'Brien & Sons", 4), vc("O'BRIEN'; DROP TABLE t; --", 1)],
    };
    const sql = buildMergeCaseSql('vendor', [hostile], 'SELECT vendor FROM t');
    // Both literals quote-doubled; the IN-list value can't break out.
    expect(sql).toContain(`IN ('O''BRIEN''; DROP TABLE t; --')`);
    expect(sql).toContain(`THEN 'O''Brien & Sons'`);
  });

  it('control characters in a value stay inside one quoted literal', () => {
    const dirty = `di${String.fromCharCode(1)}rty`; // embedded U+0001 control char
    const hostile: Cluster = {
      canonical: 'clean',
      values: [vc('clean', 3), vc(dirty, 1)],
    };
    const sql = buildMergeCaseSql('c', [hostile], 'SELECT c FROM t');
    // Only `'` needs escaping; the control char passes through inside the literal.
    expect(sql).toContain(`IN ('${dirty}')`);
  });
});

// ── sidecar job #8 propose-merge parser (the removable AI) ───────────────

describe('parseProposeMergeResponse', () => {
  // The pairs we actually asked the model to decide (per-pair allowlist).
  const ASKED = [
    { a: 'Sharma Trading Co', b: 'SHARMA TRADING CO.' },
    { a: 'Acme', b: 'Acme Inc' },
  ];

  it('parses a valid merge decision (happy path)', () => {
    const raw = JSON.stringify({
      pairs: [
        {
          a: 'Sharma Trading Co',
          b: 'SHARMA TRADING CO.',
          merge: true,
          canonical: 'Sharma Trading Co',
        },
      ],
    });
    const res = parseProposeMergeResponse(raw, ASKED);
    expect(res.pairs).toEqual([
      {
        a: 'Sharma Trading Co',
        b: 'SHARMA TRADING CO.',
        merge: true,
        canonical: 'Sharma Trading Co',
      },
    ]);
  });

  it('tolerates markdown code fences', () => {
    const raw =
      '```json\n{ "pairs": [ { "a": "Acme", "b": "Acme Inc", "merge": true, "canonical": "Acme Inc" } ] }\n```';
    expect(parseProposeMergeResponse(raw, ASKED).pairs).toHaveLength(1);
  });

  it('keeps a merge:false decision with empty canonical', () => {
    const raw = JSON.stringify({
      pairs: [{ a: 'Acme', b: 'Acme Inc', merge: false, canonical: 'Acme' }],
    });
    expect(parseProposeMergeResponse(raw, ASKED).pairs).toEqual([
      { a: 'Acme', b: 'Acme Inc', merge: false, canonical: '' },
    ]);
  });

  it('rejects a prose preface (not JSON) → empty', () => {
    const raw = 'Sure! Here are the merges:\n{ "pairs": [] }';
    expect(parseProposeMergeResponse(raw, ASKED).pairs).toEqual([]);
  });

  it('drops a pair whose value is not an input (hallucination guard)', () => {
    const raw = JSON.stringify({
      pairs: [
        {
          a: 'Sharma Trading Co',
          b: 'Totally Invented Co',
          merge: true,
          canonical: 'Sharma Trading Co',
        },
        { a: 'Acme', b: 'Acme Inc', merge: true, canonical: 'Acme Inc' },
      ],
    });
    // The invented-value pair is dropped; the valid one survives (per-pair guard).
    expect(parseProposeMergeResponse(raw, ASKED).pairs).toEqual([
      { a: 'Acme', b: 'Acme Inc', merge: true, canonical: 'Acme Inc' },
    ]);
  });

  it('drops a merge whose canonical is neither a nor b', () => {
    const raw = JSON.stringify({
      pairs: [{ a: 'Acme', b: 'Acme Inc', merge: true, canonical: 'ACME CORP' }],
    });
    expect(parseProposeMergeResponse(raw, ASKED).pairs).toEqual([]);
  });

  it('drops a recombined pairing we never asked about (per-pair allowlist)', () => {
    // Both values are real column values, but (Sharma Trading Co, Acme Inc)
    // was never a candidate pair — the deterministic layer didn't propose it.
    const raw = JSON.stringify({
      pairs: [{ a: 'Sharma Trading Co', b: 'Acme Inc', merge: true, canonical: 'Acme Inc' }],
    });
    expect(parseProposeMergeResponse(raw, ASKED).pairs).toEqual([]);
  });

  it('returns empty on junk / non-object', () => {
    expect(parseProposeMergeResponse('not json at all', ASKED).pairs).toEqual([]);
    expect(parseProposeMergeResponse('[]', ASKED).pairs).toEqual([]);
    expect(parseProposeMergeResponse('{"pairs": "nope"}', ASKED).pairs).toEqual([]);
  });

  it('builds a prose-free prompt carrying the pairs verbatim', () => {
    const { system, user } = buildProposeMergePrompt({
      kind: 'propose-merge',
      pairs: [{ a: 'Acme', b: 'Acme Inc', aCount: 5, bCount: 2 }],
    });
    expect(system).toContain('JSON ONLY');
    expect(user).toContain('"Acme"');
    expect(user).toContain('"Acme Inc"');
  });
});
