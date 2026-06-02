# Workplan — 2026-06-02 snapshot (post v1.2.2)

Today closed the 33-finding forward-pass audit + 9 self-review bugs.
v1.2.2 tagged at `40360b1`. Next session picks up doc sync first,
then has a menu of options.

The audit detail lives in `plan/forward-pass-2026-06-02.md`; the
release notes in `plan/v1.2.2-release-notes.md`.

---

## Chunk 1 — Doc sync after v1.2.2 (keystone, ~45 min)

The audit shipped substantial behaviour changes (lens auto-mount
confirmation, NL→SQL parser tightening, CSP additions, postinstall
hash-pin) but the doc surface hasn't caught up. Stop-checklist #5
calls for STATUS.md to reflect reality; #6 for non-trivial decisions
to be in `DECISIONS.md`.

- [ ] **STATUS.md** — update "build status", "what's done", "what's
  next" to reflect v1.2.2 + the security-hardening sweep.
- [ ] **DECISIONS.md** — append entries (via `/decide` or by hand)
  for the load-bearing audit choices: lens auto-mount confirmation,
  postinstall hash-pin, bearer-token RFC 7235 charset, CSP defence
  set, NL→SQL parser safety, two-track adversarial review as
  standing gate.
- [ ] **plan/spec-amendments.md** — formalise A19–A23 (lens, hash-pin,
  bearer, CSP, NL→SQL) or document explicitly that they don't need
  spec-amendment treatment.

Why keystone: doc state is part of the project's reliability surface
— picking up cold without it costs the next session their first 20
minutes orientating.

---

## Chunk 2 — Runtime verification of audit fixes (~30 min)

Static reasoning + unit tests + e2e covered the happy paths but two
behaviours are still owed runtime verification.

- [ ] [test in Chrome] **Lens-confirm modal end-to-end.** Build a
  test `?lens=…` containing 1+ remote-source kind, paste into a
  fresh tab, verify the modal renders, lists hosts, Cancel restores
  saved state, Continue proceeds with the mount. Focus order + Tab
  trap should match other modals.
- [ ] [test] **Postinstall hash-mismatch probe.** Mutate one
  `public/duckdb-fallback/duckdb-eh.wasm` byte, re-run
  `node scripts/fetch-duckdb-fallback.mjs`, confirm it exits 1 with
  the "supply-chain alert" message. Then restore the byte. Same
  for `fetch-duckdb-extensions.mjs`.

---

## Chunk 3 — Audit "worth a look" verifications (~1 hr)

Three lower-confidence hunches from the forward-pass. Each starts
with a verify step, then a decide.

- [ ] **W1 — SRI on cross-origin DuckDB-wasm.** Inspect the runtime
  script tags emitted when the engine boots from
  `naklitechie.github.io` or `cdn.jsdelivr.net`. If no `integrity=`
  attribute, decide whether to add one.
- [ ] **W2 — `?lens=` back-button replay.** Playwright case:
  navigate to a lens-link, decline the confirmation, then click
  back/forward. Does the lens param re-trigger? Fix order:
  reproduce → patch (likely call clearLensFromLocation BEFORE the
  modal opens, not after) → test.
- [ ] **W3 — SW scope on Forget all.** Inspect what `forgetAllKeys`
  cleans up; check whether the SW cache still references state the
  keys protected. If so, add an `unregister` step.

---

## Chunk 4 — v1.3.0 tag decision (~15 min decision + 30 min tag/notes)

All Critical + High findings closed. Open work is doc sync (chunk 1)
and the deferred Transformers.js inference (chunk 5).

- [ ] [decide] **Tag v1.3.0** to mark "everything from Wave 5+6 +
  the security-hardening sweep" as a release boundary? Or leave at
  v1.2.2 and accumulate toward v1.3.0 when Transformers.js (or
  another substantive feature) lands?
- [ ] If yes: draft `plan/v1.3.0-release-notes.md` rolling up
  v1.2.0 + v1.2.1 + v1.2.2; tag + push.

---

## Chunk 5 — W3.2 slice B — Transformers.js chunk + real inference (DEFERRED, ~half day)

The only `[pending]` item from the historical task list. W3.2
shipped the 'local' provider seam + UI; slice B is the actual
Transformers.js chunk + model load + inference path. Substantive
feature work, not housekeeping.

- [ ] Pick the model (HF ONNX repo). Document the choice in
  DECISIONS — it's a multi-week commitment given the bundle weight.
- [ ] `src/lazy/transformers.ts` — chunk with the model + tokenizer
  loader.
- [ ] Wire into `registerLocalGenerator` in the local-runtime
  seam.
- [ ] Bundle-size impact assessment — the model is the dominant
  cost; verify the chunk-load doesn't break the offline path.
- [ ] Eval harness — local provider should pass the same 6-job
  golden cases.

Prereq: model choice decision. Run `/decide` first.

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
