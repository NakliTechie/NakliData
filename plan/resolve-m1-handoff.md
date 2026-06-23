# NakliData — Agent Handoff: Resolve track M1 (Clustering / fuzzy-merge)

Dated **2026-06-22**. Target build: **v1.5.0** on `NakliTechie/NakliData` @ `main`.
Reference build: **v1.4.0** (`STATUS.md` top entry). Vision: `NAKLIDATA-RESOLVE-TRACK-VISION.md`.

---

## §0 — How to use this doc

Build M1 **autonomously to the gate.** You own naming (button labels, internal fn names, copy), implementation choices, debugging, and alternatives. Stop and surface **only** when (a) a locked decision here conflicts with repo reality, (b) you need a dependency beyond `fastest-levenshtein`, or (c) genuine scope ambiguity changes the product. Large gate checkpoints only — not step-by-step.

This is **M1 of the Resolve track** (M2 segments, M3 golden-table sink come later — out of scope here).

---

## §1 — Repo / build / deploy

- Repo `NakliTechie/NakliData`, single `main` branch. Stack: TypeScript → esbuild → single `dist/index.html`; DuckDB-wasm; CodeMirror 6; vitest; biome; Playwright e2e.
- Scripts: `npm run dev` (5173) · `npm run check` (tsc + biome + **engine-boundary lint** + **bundle gate**) · `npm run test` (vitest) · `npm run test:e2e` (Playwright) · `npm run smoke` · `npm run build`.
- **Bundle cap: 750 KB. Current ~677 KB → ~73 KB headroom. This is tight — treat it as a hard constraint.** `fastest-levenshtein` is ~2 KB; the clustering core + modal should land in single-digit-to-low-double-digit KB. Do **not** add a heavy dep, do **not** lazy-split this (it's small and core); verify `npm run check` bundle gate stays green.
- Deploy is automatic on push to `main` (GH Pages + Cloudflare Workers verify gate). Don't touch deploy config.

---

## §2 — What M1 is

Given a column with messy values, detect groups of variants that mean the same thing, let the user confirm a canonical value per group, and emit a **CASE-expression SQL cell** that rewrites the column to canonical values as an **additive** new column (`<col>__merged`). The user runs the cell (Hard NOT #4). The CASE is the artifact — reproducible, replays with no model.

Two detection methods (both OpenRefine-standard):
1. **Key collision** (fingerprint) — *default, offered first.* Safe, no threshold.
2. **Nearest neighbour** (edit distance) — *"find more", opt-in.* Threshold-driven.

---

## §3 — The two methods (spec)

### 3.1 Key collision (fingerprint)
Pure function over a value → fingerprint string:
1. `toString` → `trim` → lowercase
2. ASCII-fold diacritics (NFKD normalize, strip combining marks)
3. remove punctuation/control chars (keep alphanumerics + spaces)
4. collapse internal whitespace to single spaces
5. split on whitespace → dedupe tokens → sort ascending → join with single space

Group all source values sharing a fingerprint. Canonical default = the **most frequent** raw value in the group (ties → longest, then lexicographically first — deterministic). Singletons (fingerprint with one source value) are **not** clusters.

### 3.2 Nearest neighbour (edit distance)
- Distance via `fastest-levenshtein` (MIT). Normalized similarity = `1 - distance / max(len(a), len(b))`.
- Group values where similarity ≥ **threshold (default 0.85)**; expose a slider (0.70–0.95) in the modal. Greedy single-link clustering is acceptable for v1; document the choice.
- **Perf / blocking (required):** NN is O(n²) in *distinct* values. Block before pairwise compare — bucket by `(first-fingerprint-char, length-band)` and only compare within a bucket. **Cap NN at ≤ 5,000 distinct values**; above that, disable NN and show "Too many distinct values for nearest-neighbour — use key collision." Document the cap.
- Canonical default: same rule as 3.1 (most frequent → longest → lexicographic).

Both methods run **in JS over the distinct-value set**, not row-by-row over the table.

---

## §4 — The artifact it emits (the crux)

A new SQL cell, **additive** (new column, never destructive), wrapping the upstream SQL — identical shape to the existing calc-field cell (`src/core/calc-field.ts`, F4/F5):

```sql
SELECT *,
  CASE
    WHEN "vendor_name" IN ('Sharma Trading Co.', 'SHARMA TRADING CO') THEN 'Sharma Trading Co'
    WHEN "vendor_name" IN ('Acme Inc', 'ACME INC.') THEN 'Acme Inc'
    ELSE "vendor_name"
  END AS "vendor_name__merged"
FROM (<upstream_sql>) AS cluster_src
```

- **Reuse the existing injection-safe emitter** (`quoteIdent` wraps identifiers in `"` doubling internal `"`; `quoteLiteral` wraps literals in `'` doubling internal `'`) from `src/core/query-builder.ts` / `calc-field.ts` / `anonymize.ts`. Every variant value → `quoteLiteral`; the column + alias → `quoteIdent`. **Do not** build a new emitter or any string-concat path (handoff-level hard rule, see §14).
- Only **accepted** clusters become `WHEN` arms. Rejected clusters and singletons fall through to `ELSE "col"`.
- Alias suffix `__merged` (agent may pick a different suffix if it collides; keep it deterministic and documented).
- Insert as a new SQL cell; **user clicks Run** — no auto-execution.
- **Reproducibility:** the CASE is the source of truth. Re-opening the file a year later replays it via DuckDB with no model and no network.

Treat clustering as a **CASE-flavoured calc-field**: new clustering core + reuse of the calc-field cell-emit path. Minimal new surface.

---

## §5 — Data flow

1. User triggers clustering on a column (see §6).
2. NakliData runs `SELECT "<col>" AS v, COUNT(*) AS n FROM (<upstream>) AS s GROUP BY 1` → distinct values + frequencies (cheap; `getFile()`-class cost).
3. Pure clustering fn (engine-boundary clean) computes clusters from `{value, count}[]`.
4. Modal presents clusters; user edits/accepts.
5. Emit the CASE cell (§4).

`<upstream>` is the SQL of the source cell/result, or a mounted-table `SELECT * FROM <table>` when invoked from the schema panel — mirror how calc-field resolves its upstream.

---

## §6 — UI surfaces

Two entry points (both small):
- **Schema panel** — a per-column "Cluster values" action (pending.md's "schema panel is the most important surface" thesis). Acts on the mounted column.
- **SQL result** — a "Cluster" chip on a result column (next to the existing calc-field affordance). Acts on the result column.

**Modal** (reuse `src/ui/confirm-modal.ts` patterns; in-app, not native dialogs):
- Method toggle: **Key collision** (default) | **Nearest neighbour**.
- Threshold slider (NN only; hidden for key collision).
- Cluster list: one row per cluster — editable **canonical** value (text input, prefilled with the default), the **variants** with per-variant counts, and an **accept/reject** checkbox per cluster. Rejected clusters **dim, not hide** (absence-as-signal; honest counts).
- Optional "Ask AI to check ambiguous pairs" affordance → §7 (only if a provider is configured; otherwise hidden).
- Footer: "Insert as SQL cell" (primary) + Cancel.
- **Empty state:** no clusters found → "No variants detected with this method — try nearest neighbour / lower the threshold." (not an error).
- **Error UX:** GROUP BY query fails → toast via the existing `naklidata:toast` bridge; modal stays open.

---

## §7 — Sidecar job #8 `propose-merge` (the removable AI)

- **When:** only on explicit "Ask AI to check ambiguous pairs". Feed it the **borderline** pairs (e.g. NN similarity in a `[threshold-0.1, threshold)` band, or cross-fingerprint pairs the deterministic methods didn't group). Never the whole column.
- **Request:** the candidate pairs + their counts. Send the minimum context; no full table.
- **Response schema (strict, JSON only):**
  ```json
  { "pairs": [ { "a": "<input value>", "b": "<input value>", "merge": true, "canonical": "<one of a|b>" } ] }
  ```
- **No prose** — replicate `propose-chart`'s three-layer guard: (1) system prompt explicitly bans narration; (2) strict JSON parser (markdown-fence-tolerant, prose-preface-rejecting); (3) response type has no observation/explanation field.
- **Hallucination guard (all-or-nothing per pair):** `a` and `b` must each be one of the input values, and `canonical` must equal `a` or `b` (or an already-present cluster canonical). Any violation → drop that pair's suggestion. (Same posture as propose-chart's binary reject.)
- **Provider:** the existing BYOK + local-runtime ladder (`src/core/sidecar/…`). No new provider, no new endpoint, no new egress.
- **Removability:** delete this job → key collision + NN still cluster fully. The button simply doesn't appear without a provider. ✓

---

## §8 — Persistence

**M1 changes NO `.naklidata` schema.** Clusters are ephemeral UI state; the only durable output is an ordinary SQL cell, which already round-trips. State this in DECISIONS as a deliberate choice (zero back-compat risk; mapping-as-persisted-artifact is a future-track item, not M1).

---

## §9 — Engine-boundary contract

- New `src/core/clustering.ts` = **pure logic only** (no DOM, no FSA, no browser globals) — fingerprint, NN, blocking, canonical-default, and the cluster→CASE construction (delegating literal/ident quoting to the existing emitter helpers). It must pass the engine-boundary lint (the 10-required-module contract; add to `WATCHED_OPTIONAL` if needed, like `chart-shelves.ts` / `lineage-edit.ts`).
- UI binding (modal, chips, schema-panel action) lives in `src/ui/…` and imports the core.
- The sidecar job lives under `src/core/sidecar/…` alongside the other jobs.

---

## §10 — Design tokens / a11y

- CSS via existing custom properties only (house palette → variables); no hardcoded hex.
- Modal keyboard-traversable; cluster list reachable; canonical inputs labelled; Escape/backdrop/close-icon all dismiss (match existing modals).
- "Dim, never hide" for rejected clusters.
- In-app prompt/confirm, never native dialogs.

---

## §11 — CSP / security

- The injection-safe emitter is **mandatory** and the load-bearing safety property. Add vitest cases proving the CASE holds against hostile column names and hostile variant values (`'`, `"`, `;`, `--`, control chars) — mirror `tests/anonymize.test.ts` / `tests/query-builder.test.ts` hostile cases.
- No new network egress from clustering. The sidecar uses the existing BYOK path (already CSP-cleared).

---

## §12 — Tests (gate)

- **vitest** (`tests/clustering.test.ts`): fingerprint cases incl. the `Sharma Trading Co` family; diacritic fold; token reorder ("John Smith" = "Smith John"); singleton-is-not-a-cluster; NN threshold boundary (just-in / just-out); blocking correctness; canonical default tie-breaks; **CASE-emitter injection** cases (hostile idents + literals); `propose-merge` parser (happy path, prose-preface reject, hallucination reject — non-input value, canonical-not-in-pair).
- **smoke**: clustering modal opens + inserts a runnable cell.
- **e2e** (Playwright): schema-panel "Cluster values" → modal → accept a cluster → "Insert as SQL cell" → Run → `__merged` column present with canonical values.
- `npm run check` green (tsc + biome + engine-boundary + **bundle < 750 KB**).

---

## §13 — README + help + version

- README: one new surface bullet under the v1.5 surfaces ("Cluster values — fuzzy-merge variant spellings into a canonical column"), no model names / no line counts (portfolio convention).
- Help/guide: add a clustering entry (the `?`-opened generated guide; `/guide` skill if regenerating).
- Bump the visible version string (UI + meta tag) to **v1.5.0** before the push.

---

## §14 — Hard NOTs (do not do)

- ❌ No auto-apply — emit a cell, user runs it.
- ❌ No new `.naklidata` field for M1.
- ❌ No new emitter / no string-concat SQL — reuse `quoteIdent` / `quoteLiteral`.
- ❌ No prose from the sidecar; no observation field.
- ❌ No background processing / no polling / no auto-rescan.
- ❌ No O(n²) blow-up — block + cap NN at 5,000 distinct values.
- ❌ No heavy dependency; no lazy-split of this small core.
- ❌ No engine-boundary violation in `clustering.ts`.
- ❌ Don't borrow OpenRefine's UI — the *methods*, not the 2010-era look (`plan/pending.md`).

---

## §15 — Escalation protocol

Proceed autonomously. Surface only for: a locked decision here contradicting the repo; a needed dependency beyond `fastest-levenshtein`; or scope ambiguity that changes the product. Naming, copy, internal structure, debugging, and method tuning are yours.

---

## §16 — Gate artifacts to produce on completion

1. **STATUS.md** top entry (run state: vitest/e2e/smoke/check counts + bundle KB / headroom).
2. **DECISIONS.md** entries for the load-bearing choices: key-collision-first vs NN-opt-in; CASE-cell-as-artifact (no persisted mapping); blocking + 5,000-distinct cap; `propose-merge` all-or-nothing guard; emit-then-run over auto-apply.
3. **`plan/spec-amendments.md`** → next amendment id (A31).
4. README bullet + help entry + version bump.
5. All §12 tests green; bundle report.

---

## §17 — Forward-pass

Run `/forward-pass` after the clustering core + emitter land (before wiring the modal); fix the list before the UI stage opens. Run `/walkthrough` near the end (schema-panel and SQL-result entry points, accept + reject + edit-canonical paths). Nothing advances with the forward-pass list open; the injection-safe emitter is never a deferred fix.
