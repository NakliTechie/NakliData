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

## ~~Chunk 1 — Wave 3 opener: Job 4 (report-template recommendation)~~ ✅ DONE (2026-05-24 evening)

Shipped: `recommend-reports` sidecar job (types + prompt + parser +
dispatch), "Ask sidecar to rank" affordance in the Suggested-reports
panel (opt-in, reorders cards + score badge, ephemeral), eval harness
extended with the 4th job (dry-run 42/42). DECISIONS 22:00; spec
amendment A10.

Next Wave 3 work is the bigger multi-week arc below (Chunk 2).

---

## Chunk 2 — Wave 3 next coding steps (NakliData-repo, mockable)

The two pieces that are real NakliData work + verifiable here (the
multi-week external pieces — the real local model, the bridge binary —
are in "Unbatched / separate-repo" below):

- **W3.4a — `compute-bridge` source kind.** Per the now-landed
  [`compute-bridge-protocol.md`](./compute-bridge-protocol.md):
  `src/core/bridge/bridge-client.ts` (health / listTables /
  query→Arrow IPC, injected fetchImpl, mock-tested like the Iceberg
  REST client) + a `'compute-bridge'` SourceKind + mount flow + Bearer
  via source-secrets + graceful "unreachable → Reconnect" fallback +
  `.naklidata` round-trip. Results ingest via the existing
  `registerArrow` path. Half–full day. Builds against a mock; real
  end-to-end waits for the binary.
- **Chunk 4 maintenance items** (below) are good interleave fillers.

---

## Separate-repo / real-browser work (not this repo, or not headless-verifiable)

- **W3.2 slice B — real local inference.** Add `@huggingface/transformers`;
  `src/lazy/local-model.ts` loads a Phi-3-mini-class 4-bit ONNX model
  (WebGPU + wasm fallback) + registers the generator; Cache-API
  weights; Settings `'local'` radio + download UI. **Needs a real
  browser + WebGPU — can't be smoke-tested headless.** Dedicated
  session with manual verification. Seam (slice A) already shipped.
- **W3.3 — the bridge binary.** Separate OSS repo (Rust single binary +
  Docker; HTTP + Arrow IPC + Flight; Bearer auth; DuckDB engine).
  Multi-week; cannot be built from the NakliData repo. The wire
  contract (`compute-bridge-protocol.md`) unblocks it. Confirm
  naming (rethink `nakli-compute` given independent-product
  positioning) + license (Apache 2.0 lean) at repo creation.

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
