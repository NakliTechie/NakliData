# Workplan — 2026-05-29 snapshot (post-W3.4a)

Wave 3 is substantially complete on the NakliData-repo side. W3.1
(Job 4), W3.2 slice A (local-model seam), W3.3 (wire-protocol design),
and W3.4a (compute-bridge client) all shipped today.

What's left here divides cleanly into:
1. **Maintenance + polish** — small, interleavable, ship in short
   sessions (Chunk 1).
2. **W3.4b — multi-table picker** — meaningful follow-up, but
   speculative until a real bridge binary exists to test against
   (Chunk 2).
3. **External-blocked** — separate-repo (bridge binary) or real-browser
   (local-model slice B). Listed in Unbatched, not actionable here.

---

## Chunk 1 — Maintenance + polish (interleavable, 30 min – 1 hour each)

Concrete items that don't depend on anything external. Pick off
opportunistically; each ships its own gate pass.

- **Modal a11y audit pass** beyond schema-graph and slice-3 modals.
  Apply the W1.11 focus-restore + Escape-listener-cleanup pattern to
  the older modals (settings, define-type, override-rules,
  compare-tables). 1–2 real leaks likely hiding; the pattern is
  proven.
- **"Test connection" button** for the custom-endpoint sidecar
  (Settings). Probe the configured URL + key with a minimal
  `chat/completions` call → surface the real HTTP error inline
  instead of waiting for the first job. Small, user-visible.
- **`checkpoint-*-eod.md` cleanup**. Old pre-windup files still on
  disk; archive into a `plan/archive/` subdir or leave as history.
  Doc-cadence already decided summaries are canonical.
- **`registerArrowBuffer` exposed in vitest mock helpers** — the
  mount.test.ts `mockEngine` already lists every register*; the
  new `registerArrowBuffer` could join for consistency (not strictly
  needed, but tidies the surface).

Prereq: none. None of these touch a new external surface.

---

## Chunk 2 — W3.4b: Compute Bridge multi-table picker (half day, speculative until binary exists)

The follow-up the W3.4a slice deliberately deferred. The protocol
endpoint `/v1/tables` is already implemented in `BridgeClient.listTables()`.

- A connect-then-browse modal flow: paste URL + Bearer → fetch the
  catalog → render table list with schemas → multi-select → for each
  picked table, issue a bounded `SELECT * FROM <t> LIMIT <cap>` and
  register the result. Similar shape to the Iceberg-catalog
  namespace+table picker (`mount-iceberg-catalog-modal.ts`).
- Persistence: a `'compute-bridge-catalog'` SourceKind that tracks
  the catalog URL + selection, distinct from `'compute-bridge'`
  (single-table-via-SQL). Two source kinds because the persistence
  shape differs.
- Tests: bridge-client `listTables()` is already covered; the
  multi-select mount needs new vitest specs.

Useful even pre-binary as a design clarifier — but live verification
waits for the binary.

---

## Unbatched / separate-repo / real-browser (not actionable from this repo)

- **W3.2 slice B — real local inference.** Add `@huggingface/transformers`;
  `src/lazy/local-model.ts` loads a Phi-3-mini-class 4-bit ONNX model
  (WebGPU + wasm fallback) + registers the generator; Cache-API
  weights; Settings `'local'` radio + download UI. **Needs a real
  browser + WebGPU — dedicated session + manual verification.** Seam
  (slice A) already shipped.
- **The Compute Bridge binary** — separate OSS repo (Rust single
  binary + Docker; HTTP + Arrow IPC + Flight; Bearer auth; DuckDB
  engine). Multi-week. The wire contract
  ([`compute-bridge-protocol.md`](./compute-bridge-protocol.md))
  unblocks it. Confirm naming (`nakli-compute` was chosen under the
  launcher-portfolio framing we dropped — rethink given the
  independent-product positioning) + license (Apache 2.0 lean) at
  repo creation.
- **W3.5** — routing logic (which jobs benefit from the bridge:
  batch-classify 10k+ columns, heavy semantic search). After the
  binary exists.
- **W2.1c — Iceberg OAuth2 device flow + AWS SigV4.** v1.3, with
  multi-tenant enterprise work.
- **W1.8 deploy / W1.6 basemap / W2.6 deck.gl** — see pending.md
  Deferred section.

---

## Dropped (no longer planned)

- **W1.4 mirror** — naklios.dev launcher mirror. NakliData is an
  independent product; cross-repo `sync-mirrors.sh` work off the
  roadmap.
