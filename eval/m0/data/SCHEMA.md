# Facet M0 fixture — schema (deliberately messy)

A real OpenAlex Deep-Learning citation slice (2015-2023), wrangled into an
intentionally ugly schema to stress NL->SQL grounding. See build_dataset.py
for the traps. **This file is the ground truth the reference SQL is written
against.**

## papers  (node table — one row per paper)
| col | type | notes |
|-----|------|-------|
| `pid` | VARCHAR | PK, e.g. `W2194775991` |
| `ttl` | VARCHAR | title |
| `abs` | VARCHAR | abstract — **~24% NULL** (no abstract on record) |
| `yr` | BIGINT | publication year (2015-2023) |
| `venue` | VARCHAR | journal/conf name — inconsistent, **many NULL** |
| `n_cite` | BIGINT | **GLOBAL** cited-by count from OpenAlex — NOT intra-set in-degree |
| `lang` | VARCHAR | mostly `en`, a few NULL/other |
| `typ` | VARCHAR | work type (`article`) |
| `retracted` | BOOLEAN | is_retracted |
| `dt` | VARCHAR | publication date (ISO string) |
| `score` | VARCHAR | **MIXED TYPE** — mostly numeric strings, but also `'N/A'`, `'pending'`, NULL. Needs `TRY_CAST(score AS DOUBLE)`. |

## citations  (edge table — directed)
| col | type | notes |
|-----|------|-------|
| `src` | VARCHAR | the **citing** paper (`papers.pid`) |
| `dst` | VARCHAR | the **cited** paper (`papers.pid`) |

**Direction: `src` cites `dst`.** Only intra-set edges kept (both endpoints
in `papers`). So a paper's *intra-set in-degree* = `COUNT(*) WHERE dst = pid`
= how many papers in this set cite it. "Papers that cite X" -> `src WHERE
dst = X`. Reversing src/dst is the canonical silent-wrong error.

## authors  (node table)
| col | type | notes |
|-----|------|-------|
| `aid` | VARCHAR | PK, OpenAlex author id |
| `nm` | VARCHAR | display name |
| `inst` | VARCHAR | institution — **many NULL** |

## authorship  (bipartite edge — paper <-> author)
| col | type | notes |
|-----|------|-------|
| `pid` | VARCHAR | `papers.pid` |
| `aid` | VARCHAR | `authors.aid` |
| `pos` | VARCHAR | author position: `first` / `middle` / `last` |
