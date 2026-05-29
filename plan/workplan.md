# Workplan — 2026-05-29 snapshot

Wave 2 is COMPLETE. Wave 3 is in progress: W3.1 (Job 4), W3.2 slice A
(local-model seam), and W3.3 design all shipped. What's left splits
into one buildable-here chunk (W3.4a) and external work (the bridge
binary, the real local model) that can't be built/verified from this
repo.

Top chunk is the next thing to grab.

---

## Chunk 1 — W3.4a: `compute-bridge` source kind (half–full day)

The one remaining Wave 3 piece that's real NakliData-repo work +
verifiable here (against a mock). Spec'd in
[`compute-bridge-protocol.md`](./compute-bridge-protocol.md).

- **`src/core/bridge/bridge-client.ts`** — `health()` / `listTables()`
  / `query(sql) → Arrow IPC ArrayBuffer`. Injected `fetchImpl`,
  mock-tested exactly like `iceberg/rest-client.ts`.
- **`'compute-bridge'` SourceKind** + mount flow: health handshake →
  list tables → user picks → bounded `SELECT` → register the Arrow
  result via the EXISTING `Engine.registerArrow` path (becomes a local
  DuckDB table).
- **Bearer token** via the W2.2 `source-secrets` module (session
  default + opt-in IDB). 401 → reconnect.
- **Graceful fallback:** `health()` fail on mount/reload → "Compute
  Bridge unreachable — Reconnect" state (reuse FSA `reconnectNeeded`).
  Never takes down the session.
- **`.naklidata` round-trip:** persist bridge URL + table selection
  (NOT the token); additive `PersistedSource.bridge` field, no
  format-version bump.
- Tests: bridge-client against canned `/v1/health` + `/v1/tables` +
  `/v1/query` (Arrow IPC) responses; mount + fallback e2e with a
  mocked endpoint.

Prereq: none (mockable). Real end-to-end waits for the binary.

---

## Chunk 2 — Maintenance + nice-to-haves (under an hour each)

Good interleave fillers:

- **Modal focus/Escape audit** beyond schema-graph — apply the W1.11
  focus-restore + Escape-listener-cleanup pattern to the other modals
  (settings, define-type, override-rules, compare-tables, the 4
  mount-* modals). 1–2 real leaks likely hiding.
- **"Test connection" button** for the custom-endpoint sidecar
  (Settings) — revisit if config friction shows up.
- **Multi-bucket S3 / multi-token Iceberg** via DuckDB `CREATE SECRET`
  once wasm supports it (tracked limitation, DECISIONS 2026-05-24
  15:30 + 16:00).
- **`checkpoint-*-eod.md` cleanup** — old pre-windup files still on
  disk; archive or leave as history (doc-cadence decided summaries are
  canonical).

---

## Unbatched / separate-repo / real-browser (not buildable headless here)

- **W3.2 slice B — real local inference.** Add `@huggingface/transformers`;
  `src/lazy/local-model.ts` loads a Phi-3-mini-class 4-bit ONNX model
  (WebGPU + wasm fallback) + registers the generator; Cache-API
  weights; Settings `'local'` radio + download UI. **Needs a real
  browser + WebGPU — dedicated session + manual verification.** Seam
  (slice A) already shipped.
- **W3.3 — the bridge binary.** Separate OSS repo (Rust single binary +
  Docker; HTTP + Arrow IPC + Flight; Bearer auth; DuckDB engine).
  Multi-week. The wire contract (`compute-bridge-protocol.md`) unblocks
  it. Confirm naming (rethink `nakli-compute`) + license (Apache 2.0
  lean) at repo creation.
- **W3.5** — routing logic (which jobs benefit from the bridge:
  batch-classify 10k+ columns, heavy semantic search). After W3.3 +
  W3.4a exist.
- **W2.1c — Iceberg OAuth2 device flow + AWS SigV4.** v1.3, with
  multi-tenant enterprise work.
- **W1.8 deploy / W1.6 basemap / W2.6 deck.gl** — see pending.md
  Deferred section.

---

## Dropped (no longer planned)

- **W1.4 mirror** — naklios.dev launcher mirror. NakliData is an
  independent product; cross-repo `sync-mirrors.sh` work off the
  roadmap.
