# Workplan — 2026-05-24 snapshot

v1.1.0 is tagged + pushed; `applyLoadedFile` mutex landed post-tag.
Wave 1 is closed; W1.4 (mirror) is dropped now that NakliData
positions as an independent product (not a launcher app); W1.8
(deploy) is deferred — we're nowhere near needing a hosted build
yet. The next session opens with the small Chunk 4 follow-ups, then
moves into Wave 2.

Order below puts the small finishable items first, then the bigger
Wave 2 arcs.

---

## Chunk 4 — Small follow-ups (under an hour each — pick them off)

Scrappy items that don't fit a larger arc. Doing these together
gives the next session a clean "got something concrete done" start
before tackling Wave 2.

- **W1.9** — Doc-cadence decision. We now have *both*
  `checkpoint-YYYY-MM-DD-eod.md` (pre-windup pattern, exhaustive)
  and `YYYY-MM-DD-summary.md` (windup output, tight). Pick one going
  forward; either archive old checkpoints or document why both
  exist. Most likely outcome: summaries are canonical, old
  checkpoints stay as historical record.
- **Cytoscape modal focus restoration** — quick a11y audit on
  `src/ui/schema-graph.ts`. When the modal closes, keyboard focus
  may stay trapped on the cytoscape canvas instead of returning to
  the trigger button. Small fix if confirmed; no fix if focus
  already returns cleanly.
- **`.naklidata` format-version policy** — document when a `1.1`
  bump would actually be warranted (breaking change to a *required*
  field) vs additive-optional changes that round-trip cleanly
  (`user_types`, `override_rules` both landed without a version
  bump). One paragraph in `plan/spec-amendments.md` or
  `DECISIONS.md` so future-us doesn't accidentally bump on something
  that doesn't need it.

Prerequisites: none. Each item is self-contained.

---

## Chunk 1 — Wave 2 kickoff: Iceberg + S3 endpoints (1–2 days)

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

## Chunk 2 — Wave 2 sidecar: custom endpoint + eval harness (1–2 days)

The "BYO-model" half of Wave 2. Independent of Chunk 1 above — pick
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

## Unbatched

Bigger items that don't yet have enough shape to be in a chunk:

- **W1.8 deploy** — A hosted build is useful eventually (the README
  still says "URL TBD when published") but the runtime is the
  static page itself; users self-host. Pick up when we want a
  canonical hosted entry-point and have the bandwidth.
- **W2.6 stretch** — Map cell deck.gl pairing (for >10k-point
  rendering). Defer until a real workload appears.
- **W1.6 stretch** — Map cell basemap with CSP carve-out for OSM
  tiles. Touches privacy posture; warrants a `DECISIONS.md` entry
  before any code lands.
- **Wave 3 entirely** — Sidecar maturation + Compute Bridge MVP.
  Multi-week arc; see [`enterprise-strategy.md`](./enterprise-strategy.md)
  for the full strategic context. Don't start until Wave 2 ships.

---

## Dropped (no longer planned)

- **W1.4 mirror** — naklios.dev Immersive same-origin mirror. NakliData
  positions as an independent product; we're not tying its
  discoverability to the launcher. Existing `nakli-dev` infrastructure
  is no longer in scope. (The cross-repo work to extend
  `sync-mirrors.sh` for multi-file builds is also dropped.)
