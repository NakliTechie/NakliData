# Workplan — 2026-05-24 snapshot

v1.1.0 is tagged + pushed; `applyLoadedFile` mutex landed post-tag.
Wave 1 is closed except for W1.4 (mirror) and W1.6 (basemap stretch).
The next session has two natural starting points: a small housekeeping
chunk that finishes Wave 1's deferred items, or a strategic kickoff
of Wave 2. They're independent — pick the one that matches available
time.

Order below is "tactical first, strategic second" — small finishable
items come before the bigger arcs so a short session can still close
something.

---

## Chunk 1 — Ship the v1.1.0 deploy + mirror (half day)

Closes Wave 1's two deferred items together. The deploy unblocks the
mirror; doing them in one sitting avoids context-switching.

- **W1.8** — Add a GitHub Pages deploy workflow.
  `.github/workflows/deploy-pages.yml` building `dist/` on push to
  `main` and publishing via `actions/deploy-pages`. Verify the SRI +
  CSP story still holds when served from `*.github.io`.
- **W1.2 follow-up** — Once Pages is live, replace the "URL TBD when
  published" line in `README.md` with the actual hosted URL.
- **W1.4** — Extend `nakli-dev`'s `sync-mirrors.sh` to handle
  multi-file builds (new `source_url` / `pages_url` field in
  `apps/manifest.json`); add NakliData's mirror entry; add the
  source-side `.github/workflows/notify-naklios.yml` here +
  `NAKLIOS_DISPATCH_TOKEN`.

Prerequisites: GitHub Pages enabled for the repo (one-click in
Settings). Cross-repo work touches `NakliTechie/nakli-dev`.

---

## Chunk 2 — Wave 2 kickoff: Iceberg + S3 endpoints (1–2 days)

The lakehouse + BYO-endpoint pair. Both DuckDB-native, no new core
dependencies. Worth doing together because they share the auth /
secrets / CSP surface.

- **W2.1** — Apache Iceberg REST + OAuth2 / Bearer / SigV4 via
  DuckDB's `iceberg` extension. New source kind `iceberg-catalog`.
- **W2.2** — S3-compatible custom endpoints via DuckDB `httpfs`.
  New source kind `s3-endpoint` (MinIO, R2, B2, Wasabi out of the
  box). BYOK secrets mirror the sidecar BYOK pattern (session
  default + opt-in IDB per amendment A2).
- **W2.5** — `plan/spec-amendments.md` entries for both, since they
  introduce new auth + secret-storage surfaces the canonical spec
  didn't anticipate.

Prerequisites: none — both extensions confirmed to work in browser
as of Dec 2025 (see DECISIONS 2026-05-23 for the vendored-extension
groundwork). Depends on user's appetite for the lakehouse arc vs
the sidecar arc next; Chunk 3 is the alternate.

---

## Chunk 3 — Wave 2 sidecar: custom endpoint + eval harness (1–2 days)

The "BYO-model" half of Wave 2. Independent of Chunk 2 — pick
whichever matters more for the next demo.

- **W2.3** — Custom-endpoint sidecar provider. New kind
  `custom-openai-compatible`; user supplies URL + model name. **CSP
  rework required:** today's explicit-host whitelist won't survive
  runtime URL config; replace with a runtime-allow-list driven by
  configured provider URLs or a meta-CSP refresh pattern. This is
  the gnarliest part.
- **W2.4** — Sidecar eval harness. Held-out per-job evaluation set
  + a runner that scores prompted-base vs prompted+LoRA on the same
  set. Lives under `eval/`; no new runtime dependency in the main
  app. Foundation for the v1.3 LoRA work. See
  [`sidecar-architecture.md`](./sidecar-architecture.md) §"v1.2 —
  build the eval harness".

Prerequisites: a working local sidecar endpoint (llamafile or
vLLM) for testing W2.3.

---

## Chunk 4 — Small follow-ups (under an hour each)

Scrappy items that don't fit Chunks 1–3 and don't deserve their own
sitting. Pick off opportunistically.

- **W1.9** — Decide whether the `checkpoint-YYYY-MM-DD-eod.md` files
  are still needed now that `windup` writes a daily summary +
  workplan. Consolidate or document the distinction.
- **Cytoscape modal focus restoration** — quick a11y audit; the
  schema-graph modal may not return keyboard focus to the open
  button on close.
- **Format-version bump readiness check** — `.naklidata` is still at
  `version: '1.0'` with additive optional fields (`user_types`,
  `override_rules`). Document when a `1.1` bump would actually be
  warranted (breaking change to a required field, not new optional
  fields).

---

## Unbatched

Bigger items that don't yet have enough shape to be in a chunk:

- **W2.6 stretch** — Map cell deck.gl pairing (for >10k-point
  rendering). Defer until a real workload appears.
- **W1.6 stretch** — Map cell basemap with CSP carve-out for OSM
  tiles. Touches privacy posture; warrants a `DECISIONS.md` entry
  before any code lands.
- **Wave 3 entirely** — Sidecar maturation + Compute Bridge MVP.
  Multi-week arc; see [`enterprise-strategy.md`](./enterprise-strategy.md)
  for the full strategic context. Don't start until Wave 2 ships.
