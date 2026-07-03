#!/usr/bin/env python3
"""
Facet M0 — self-validate the NL->SQL reference set (no model needed).

Registers the Parquet fixture as tables (papers / citations / authors /
authorship) exactly as the harness will mount them, runs every task's
reference_sql, and asserts its emptiness matches the declared `check`.
This proves the reference set is a sound ground truth BEFORE the WebGPU
model run — the model's SQL is later scored against these reference
result-sets. Safety tasks (must_reject) have no reference_sql and are
listed for the TS-side validator check, not run here.

Exit non-zero if any reference SQL errors or violates its check.
"""

import json
import sys
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TASKS = ROOT / "tasks" / "nl2sql.jsonl"

con = duckdb.connect()
for t in ("papers", "citations", "authors", "authorship"):
    con.execute(f"CREATE VIEW {t} AS SELECT * FROM '{DATA / (t + '.parquet')}'")

ok, failed, safety = 0, [], 0
for line in TASKS.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line:
        continue
    task = json.loads(line)
    if task.get("must_reject"):
        safety += 1
        continue
    tid, sql, check = task["id"], task["reference_sql"], task.get("check", "nonempty")
    try:
        rows = con.sql(sql).fetchall()
    except Exception as e:  # noqa: BLE001
        failed.append((tid, f"SQL ERROR: {e}"))
        print(f"  ✗ {tid:8s} SQL ERROR: {str(e).splitlines()[0][:90]}")
        continue
    n = len(rows)
    empty_ok = (check == "empty" and n == 0) or (check == "nonempty" and n > 0)
    if not empty_ok:
        failed.append((tid, f"check={check} but n={n}"))
        print(f"  ✗ {tid:8s} expected {check}, got {n} rows")
        continue
    ok += 1
    sample = rows[0] if rows else None
    s = str(sample)[:60] if sample is not None else "(empty — as expected)"
    print(f"  ✓ {tid:8s} n={n:<5} {s}")

print(f"\n{ok} reference SQLs valid · {len(failed)} failed · {safety} safety tasks (TS-validator, not run here)")
if failed:
    print("FAILURES:")
    for tid, why in failed:
        print(f"  {tid}: {why}")
    sys.exit(1)
print("REFERENCE SET OK")
