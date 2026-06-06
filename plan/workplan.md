# Workplan — 2026-06-02 snapshot (post v1.2.2)

Today closed the 33-finding forward-pass audit + 9 self-review bugs.
v1.2.2 tagged at `40360b1`. Next session picks up doc sync first,
then has a menu of options.

The audit detail lives in `plan/forward-pass-2026-06-02.md`; the
release notes in `plan/v1.2.2-release-notes.md`.

---

## Chunk 1 — Doc sync after v1.2.2 (keystone, ~45 min) ✅

- [x] **STATUS.md** — new 2026-06-02T22:30 entry covering v1.2.2 +
  the security-hardening sweep; tag list updated through v1.2.2.
- [x] **DECISIONS.md** — appended `## 2026-06-02 — Forward-pass
  audit + v1.2.2 — load-bearing decisions` with 8 lettered
  sub-decisions (A: lens confirmation UX, B: two-track adversarial
  review as standing gate, C: mountIcebergTable vs catalog regex
  asymmetry, D: frame-ancestors in meta as documentation, E:
  postinstall pin via existing integrity.json, F: xlsx exact-pin
  scope, G: postinstall exit(1), H: smoke warning visible).
- [x] **plan/spec-amendments.md** — A19 (lens auto-mount
  confirmation), A20 (postinstall hash-pin protocol), A21
  (bearer-token RFC 7235 charset), A22 (CSP defence-in-depth),
  A23 (NL→SQL parser safety contract) — all with index entries +
  full sections.

---

## Chunk 2 — Runtime verification of audit fixes (~30 min) ✅

- [x] **Lens-confirm modal end-to-end** — `tests/e2e/lens-confirm-modal.spec.ts`
  with 4 cases: modal fires for http source + Cancel strips param;
  Escape cancels; back-button does NOT replay (W2 verified); local-
  only lens does NOT fire modal.
- [x] **Postinstall hash-mismatch probe** — `scripts/probe-hash-mismatch.mjs`.
  Live-ran the probe; verified baseline pass → tampered exit 1 +
  "supply-chain alert" → restored pass. End-to-end protection
  confirmed.

---

## Chunk 3 — Audit "worth a look" verifications (~1 hr) ✅

- [x] **W1 — SRI on cross-origin DuckDB-wasm.** Verified
  intentionally dropped per W1.8.2 + spec amendment A14 (blob-pre-
  wrap broke cross-blob worker access in current Chrome). Trust
  = version-pin + build-time SHA-384 verify against integrity.json
  + (new in v1.2.2) postinstall hash-pin enforcement. Code-comment
  block at `src/core/engine.ts:215-221` carries the rationale.
  Conclusion: no change. (DECISIONS Decision I.)
- [x] **W2 — `?lens=` back-button replay.** Tested. With
  `history.replaceState` semantics, the current entry is replaced
  rather than a new entry created — back-button after Cancel goes
  to the pre-lens URL, NOT back to the lens. Locked in by the new
  e2e case (chunk 2). Conclusion: no change.
- [x] **W3 — SW scope on Forget all.** Verified. `forgetAllKeys`
  only touches sessionStorage + IDB BYOK entries. SW caches the
  shell + same-origin SWR; cross-origin requests (where BYOK keys
  go) explicitly bypass the cache. SW holds no key-dependent
  content. Conclusion: no change. (DECISIONS Decision I.)

---

## Chunk 4 — v1.3.0 tag decision ✅

- [x] **Decision: defer v1.3.0.** Recorded as Decision J in
  DECISIONS.md. Reasoning: a 1.x → 1.y jump should mark a meaningful
  shape change, not "patch tags piled up." The security-hardening
  sweep is correctly captured across v1.2.0 / v1.2.1 / v1.2.2 patch
  tags with clean per-version notes. v1.3.0 trigger will be: W3.2
  slice B (Transformers.js local inference) ships, OR a new mount
  source kind ships, OR a new cell kind. Tag tooling stays
  trivially reversible.

---

## Chunk 5 — W3.2 slice B — Transformers.js (mostly ✅; chunks 5+7 owed)

User accepted my recommended defaults; autonomous track shipped
chunks 1-4 (code) + chunk 6 (spec + DECISIONS).

- [x] **Decision 1**: Qwen2.5-1.5B-Instruct default (curated list of
  3 in `LOCAL_MODEL_OPTIONS`).
- [x] **Decision 2**: custom OPFS layer shipped as
  `src/core/sidecar/local-cache.ts`.
- [x] **Decision 3**: single `src/lazy/transformers.ts` chunk
  (525 KB tree-shaken).
- [x] **Decision 4**: lazy chunk not budgeted; shell stays at
  541 KB / 600 KB.
- [x] **Decision 5**: eval coverage skipped for slice B; manual
  validation per-job (see chunk 5 below).
- [x] **Chunk 1** — OPFS cache primitive shipped at `87b56a1`.
- [x] **Chunk 2** — Transformers.js chunk + adapter shipped at
  `bdf6a5b`.
- [x] **Chunk 3** — Settings UI shipped at `767afa5`.
- [x] **Chunk 4** — boot-path auto-load shipped at `6e8fed4`.
- [ ] **Chunk 5** — per-job validation against loaded Qwen.
  Checklist at `plan/w32-slice-b-validation.md`. ~30-60 min. Run
  through each of the 6 sidecar jobs, fill in the `<TODO>`s, pass
  count 6/6.
- [x] **Chunk 6** — spec amendment A24 + DECISIONS K-O.
- [ ] **Chunk 7** — tag v1.3.0. Gated on chunk 5's 6/6 PASS.

---

## Notes

- `plan/pending.md` is the flat source of truth for open items
  (large legacy backlog from competitive recon + the new audit
  follow-throughs section at the bottom). The workplan above is
  the curated near-term play.
- `plan/forward-pass-2026-06-02.md` has the full per-finding detail
  + the batched workplan — useful if any audit item resurfaces or
  needs deeper context.
- Stop-checklist (from CLAUDE.md): `npm run smoke`, `npm run test`,
  bundle ≤ 600 KB, schema panel manual look, STATUS reflects
  reality, decisions logged, `npm run check` LAST.
