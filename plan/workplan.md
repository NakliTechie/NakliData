# Workplan — 2026-05-24 EOD snapshot (updated post-W2.4)

**Wave 2 is COMPLETE.** All six slices shipped (1, 2, 3a, 3b, W2.3,
W2.4). The eval harness landed in the 2026-05-24 evening session
(`eval/`, DECISIONS 21:30). **W2.1c (Iceberg OAuth2 + SigV4)** is the
only Wave-2-adjacent item left, deferred to v1.3.

The next session opens Wave 3. Chunk 1 below (Job 4) is the smallest
user-visible opener; Chunk 2 is the strategic multi-week arc.

---

## ~~Chunk 0 — W2.4 eval harness~~ ✅ DONE (2026-05-24 evening)

Shipped: `eval/run.mjs` (esbuild-bundled TS harness, no new dep),
`eval/harness.ts`, `eval/score.ts`, `eval/report.ts`, fixtures for all
three jobs, `tests/eval-score.test.ts` (15 specs), `npm run eval`.
Dry-run self-test 34/34. See DECISIONS 21:30.

---

## Chunk 1 — Wave 3 opener: Job 4 (report-template recommendation) (half day)

Wave 3's first item per `plan/pending.md`. The smallest user-visible
addition that doesn't need the bigger Compute Bridge infrastructure.

- **W3.1** — Job 4: report-template recommendation. Browser-side,
  structured-output only (template-ids ranked by fit, no prose).
  Wired into the schema-panel "Suggested reports" section as an
  "Ask sidecar to rank" affordance. New job kind in
  `src/core/sidecar/types.ts`; prompt + parser in `client.ts`;
  UI hook in the schema-panel templates section.

Prerequisites: none — reuses the existing sidecar dispatch surface.
Custom-endpoint sidecar already works (W2.3), so the user can run
Job 4 against a local model if they want.

---

## Chunk 3 — Wave 3 strategic prep (week-scale)

The Compute Bridge MVP is multi-week — not for a single sitting. But
two opening moves are tractable:

- **W3.2** — Local-model path. Transformers.js + Phi-3-mini-class at
  4-bit (~150 MB OPFS-cached). Opt-in via Settings; fallback to
  BYOK when not downloaded. New sidecar transport in
  `src/core/sidecar/`.
- **W3.3** — Compute Bridge MVP project scaffolding. Sibling OSS
  repo (target name `NakliTechie/nakli-compute` — but worth a
  rename pass given the launcher positioning is dropped). Single
  binary + Docker image, Arrow Flight + HTTP wire protocol, Bearer-
  token auth.

Prerequisite for both: Wave 2 closed (so W2.4 ships first).

---

## Chunk 4 — Maintenance + nice-to-haves (under an hour each)

Loose items worth picking off when context allows:

- **`exitFullScreen` / focus audit pass** beyond the schema-graph
  modal — check the other modals (settings, define-type, override-
  rules, compare-tables, mount-url, mount-s3, mount-iceberg, mount-
  iceberg-catalog) for the same focus-restoration + Escape-listener
  cleanup pattern. Probably 1–2 fixes hiding.
- **"Test connection" button** in the custom-endpoint sidecar
  settings. Punted today; revisit if users hit configuration
  friction in practice.
- **Rename `NakliTechie/nakli-compute`** target name now that the
  launcher positioning is dropped. Decision-only — the repo doesn't
  exist yet.
- **Multi-bucket S3 / multi-token Iceberg** via DuckDB `CREATE
  SECRET` once wasm catches up. Tracked limitation in DECISIONS
  15:30 + 16:00.

---

## Unbatched

Bigger items that don't yet have enough shape to be in a chunk:

- **W1.8 deploy** — A hosted build. Useful eventually but the
  runtime is the static page itself; users self-host. Pick up
  when we want a canonical hosted entry-point.
- **W2.1c — Iceberg OAuth2 device flow + AWS SigV4** for v1.3
  (with multi-tenant enterprise work).
- **W2.6 stretch** — Map cell deck.gl pairing (>10k-point rendering).
- **W1.6 stretch** — Map cell basemap with CSP carve-out for OSM tiles.
- **Wave 3 entirely** — Sidecar maturation + Compute Bridge MVP.
  Multi-week arc per [`enterprise-strategy.md`](./enterprise-strategy.md).
- **v1.4 — multi-team OAuth2 + shared-taxonomy hub** — comes after
  Wave 3.

---

## Dropped (no longer planned)

- **W1.4 mirror** — naklios.dev Immersive same-origin mirror.
  NakliData is positioned as an independent product; cross-repo
  `sync-mirrors.sh` work no longer on the roadmap.
