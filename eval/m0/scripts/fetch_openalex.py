#!/usr/bin/env python3
"""
Facet M0 — fetch a real, messy citation-graph slice from OpenAlex.

Why OpenAlex: it is a genuine, messy graph corpus — null abstracts,
inconsistent venue strings, missing years, entity-variant author names —
AND it has real text (title + abstract) for the semantic-search gate and
real citation edges for the graph-flavored NL->SQL gate. A clean toy
would invalidate G1 (see facet-m0-handoff.md). We fetch once and commit
the wrangled Parquet as the fixture; this script is for reproducing it.

Focused slice: top-cited Deep-Learning works (2015-2023). A tight subfield
gives dense intra-set citation edges and recognisable subtopic clusters
(CNNs / transformers / RL / GANs / ...) so semantic-search relevance has a
checkable ground truth.

Output: data/raw_works.jsonl (one work per line, only the fields we use).
No API key needed (polite pool via mailto). stdlib only.
"""

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

MAILTO = "chirag.patnaik@gmail.com"
CONCEPT_DEEP_LEARNING = "C108583219"  # OpenAlex concept: Deep learning
TARGET = 2500
PER_PAGE = 200
OUT = Path(__file__).resolve().parent.parent / "data" / "raw_works.jsonl"

FILTER = ",".join(
    [
        f"concepts.id:{CONCEPT_DEEP_LEARNING}",
        "from_publication_date:2015-01-01",
        "to_publication_date:2023-12-31",
        "type:article",
    ]
)
SELECT = ",".join(
    [
        "id",
        "title",
        "abstract_inverted_index",
        "publication_year",
        "publication_date",
        "cited_by_count",
        "referenced_works",
        "authorships",
        "primary_location",
        "language",
        "type",
        "is_retracted",
    ]
)


def reconstruct_abstract(inv):
    """OpenAlex stores abstracts as an inverted index {word: [positions]}."""
    if not inv:
        return None
    positions = []
    for word, idxs in inv.items():
        for i in idxs:
            positions.append((i, word))
    if not positions:
        return None
    positions.sort()
    return " ".join(w for _, w in positions)


def fetch_page(cursor):
    qs = urllib.parse.urlencode(
        {
            "filter": FILTER,
            "select": SELECT,
            "per-page": PER_PAGE,
            "cursor": cursor,
            "sort": "cited_by_count:desc",
            "mailto": MAILTO,
        }
    )
    url = f"https://api.openalex.org/works?{qs}"
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": f"facet-m0 ({MAILTO})"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001 — eval script, retry-all is fine
            wait = 2 ** attempt
            print(f"  ! page fetch failed ({e}); retry in {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise SystemExit("fetch failed after retries")


def short_id(oid):
    """https://openalex.org/W123 -> W123 (compact, still unique)."""
    return oid.rsplit("/", 1)[-1] if oid else None


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    cursor = "*"
    written = 0
    with OUT.open("w", encoding="utf-8") as f:
        while written < TARGET:
            data = fetch_page(cursor)
            results = data.get("results", [])
            if not results:
                break
            for w in results:
                venue = None
                loc = w.get("primary_location") or {}
                src = (loc or {}).get("source") or {}
                if src:
                    venue = src.get("display_name")
                rec = {
                    "id": short_id(w.get("id")),
                    "title": w.get("title"),
                    "abstract": reconstruct_abstract(w.get("abstract_inverted_index")),
                    "year": w.get("publication_year"),
                    "date": w.get("publication_date"),
                    "venue": venue,
                    "cited_by_count": w.get("cited_by_count"),
                    "referenced_works": [short_id(r) for r in (w.get("referenced_works") or [])],
                    "authors": [
                        {
                            "id": short_id((a.get("author") or {}).get("id")),
                            "name": (a.get("author") or {}).get("display_name"),
                            "institution": (
                                (a.get("institutions") or [{}])[0].get("display_name")
                                if a.get("institutions")
                                else None
                            ),
                            "position": a.get("author_position"),
                        }
                        for a in (w.get("authorships") or [])
                    ],
                    "language": w.get("language"),
                    "type": w.get("type"),
                    "is_retracted": w.get("is_retracted"),
                }
                if not rec["id"]:
                    continue
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                written += 1
            cursor = (data.get("meta") or {}).get("next_cursor")
            print(f"  fetched {written} works…", file=sys.stderr)
            if not cursor:
                break
            time.sleep(0.2)  # polite
    print(f"wrote {written} works -> {OUT}")


if __name__ == "__main__":
    main()
