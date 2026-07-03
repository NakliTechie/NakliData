#!/usr/bin/env python3
"""
Facet M0 — wrangle raw_works.jsonl into the messy Parquet fixture.

The schema is deliberately UGLY, to stress the one thing M0's NL->SQL gate
must prove: that the model grounds in the *actual* schema, not a clean
imagined one, and fails LOUD (empty / engine error) rather than returning
plausible-but-wrong rows (G1/G2). The traps, on purpose:

  * cryptic column names   — pid/ttl/abs/yr/n_cite/src/dst/aid/nm/inst
  * citation DIRECTION      — citations(src, dst): "src cites dst". Getting
                              it backwards is the canonical silent-wrong bug
                              ("papers that cite X" vs "papers X cites").
  * two "most cited" senses — papers.n_cite is OpenAlex's GLOBAL count;
                              intra-set in-degree (COUNT over citations.dst)
                              is different. An ambiguous intent must not be
                              silently answered with the wrong one.
  * a MIXED-TYPE column     — papers.score is VARCHAR holding mostly numbers
                              but also 'N/A' / 'pending' / NULL. Naive
                              AVG(score) errors; correct SQL needs TRY_CAST.
  * natural nulls           — ~24% null abstracts, null venues, null insts.

Outputs (data/): papers.parquet, citations.parquet, authors.parquet,
authorship.parquet, and SCHEMA.md.
"""

from pathlib import Path

import duckdb

DATA = Path(__file__).resolve().parent.parent / "data"
RAW = DATA / "raw_works.jsonl"

con = duckdb.connect()
con.execute(
    f"CREATE TABLE w AS SELECT * FROM read_json_auto('{RAW}', maximum_object_size=20000000)"
)

# --- papers (node table) — ugly names + injected mixed-type `score` --------
con.execute(
    """
    CREATE TABLE papers AS
    SELECT
        id                                            AS pid,
        title                                         AS ttl,
        abstract                                      AS abs,
        year                                          AS yr,
        venue                                         AS venue,
        cited_by_count                                AS n_cite,   -- GLOBAL count (trap)
        language                                      AS lang,
        type                                          AS typ,
        is_retracted                                  AS retracted,
        date                                          AS dt,
        -- injected mixed-type VARCHAR: mostly numeric strings, some junk
        CASE (abs(hash(id)) % 17)
            WHEN 0 THEN 'N/A'
            WHEN 1 THEN 'pending'
            WHEN 2 THEN NULL
            ELSE CAST(round(0.30 + (abs(hash(id)) % 70) / 100.0, 2) AS VARCHAR)
        END                                           AS score
    FROM w
    """
)

# --- citations (edge table) — src cites dst; intra-set edges only ----------
con.execute(
    """
    CREATE TABLE citations AS
    WITH e AS (
        SELECT id AS src, unnest(referenced_works) AS dst FROM w
    )
    SELECT DISTINCT e.src, e.dst
    FROM e
    WHERE e.dst IN (SELECT pid FROM papers)
      AND e.src <> e.dst
    """
)

# --- authors + authorship (bipartite) --------------------------------------
con.execute(
    """
    CREATE TABLE _au AS
    SELECT id AS pid, unnest(authors, recursive := true) FROM w
    """
)
# one row per distinct author id; take an arbitrary (first) name/institution
con.execute(
    """
    CREATE TABLE authors AS
    SELECT id AS aid, any_value(name) AS nm, any_value(institution) AS inst
    FROM _au
    WHERE id IS NOT NULL
    GROUP BY id
    """
)
con.execute(
    """
    CREATE TABLE authorship AS
    SELECT DISTINCT pid, id AS aid, position AS pos
    FROM _au
    WHERE id IS NOT NULL
    """
)

for t in ("papers", "citations", "authors", "authorship"):
    out = DATA / f"{t}.parquet"
    con.execute(f"COPY {t} TO '{out}' (FORMAT parquet)")
    n = con.sql(f"SELECT count(*) FROM {t}").fetchone()[0]
    print(f"  {t:12s} {n:>7,} rows -> {out.name}")

# --- quick messiness report ------------------------------------------------
print("\nmessiness:")
print("  null abstracts :", con.sql("SELECT count(*) FROM papers WHERE abs IS NULL").fetchone()[0])
print("  null venues    :", con.sql("SELECT count(*) FROM papers WHERE venue IS NULL").fetchone()[0])
print("  score = 'N/A'  :", con.sql("SELECT count(*) FROM papers WHERE score='N/A'").fetchone()[0])
print("  score numeric  :", con.sql("SELECT count(*) FROM papers WHERE TRY_CAST(score AS DOUBLE) IS NOT NULL").fetchone()[0])
print("  distinct venues:", con.sql("SELECT count(DISTINCT venue) FROM papers").fetchone()[0])
print("  max in-degree  :", con.sql("SELECT max(c) FROM (SELECT dst, count(*) c FROM citations GROUP BY dst)").fetchone()[0])

# --- SCHEMA.md (authoritative ugly-schema doc) -----------------------------
schema_md = """# Facet M0 fixture — schema (deliberately messy)

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
"""
(DATA / "SCHEMA.md").write_text(schema_md, encoding="utf-8")
print("\nwrote SCHEMA.md")
