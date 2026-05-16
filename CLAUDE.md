# NakliData — agent rules

Browser-native semantic data workbench. Read `02-SPEC.md` (uploaded with
the handoff) for the canonical product spec — but check
`plan/spec-amendments.md` for divergences we've ratified since. Read
`STATUS.md` for current build state, `DECISIONS.md` for the running
decision log, and `plan/pending.md` for what's queued next.

## Stop checklist (read before declaring a task done)

1. **`npm run smoke` passes.** This is the headless browser end-to-end
   (`scripts/smoke.mjs`). It catches CSP, FSA, worker-bootstrap, and
   classification regressions that `tsc` and `vitest` both let through.
   No exceptions for "small" changes — small changes break this surface
   most often.
2. **`npm run check` clean.** `tsc --noEmit` and `biome check`.
3. **`npm run test` green.** Vitest unit tests.
4. **Bundle within budget.** `dist/index.html` ≤ 600 KB (spec §7.1).
   Check after any non-trivial dependency change.
5. **Schema-panel-touching changes get a manual look.** It's the spec's
   single most important surface (handoff §9). Render it, click it,
   override a column, then move on.
6. **STATUS.md reflects reality.** Update "build status", "what's done",
   "what's next" before pushing.
7. **Non-trivial decisions logged.** New entry in `DECISIONS.md` per the
   format in handoff §5. If you decided not-to-do something, that's still
   a decision worth logging.

## Don't do these

Carried forward from spec §6:

- No telemetry, analytics, or error reporting.
- No persistent storage of BYOK keys (sessionStorage only, in v1.1).
- No auto-execution of LLM-generated SQL.
- No prose "insights" or "narrations" of query results.
- No background polling of remote sources.
- No login, accounts, email, sharing-via-link.
- No third-party scripts at runtime beyond the SRI-pinned DuckDB CDN load.
- No write operations to remote sources.

## Conventions

- **Color values come from `src/tokens/colors.ts` only.** No hardcoded
  hex in components or CSS-string-templates outside the tokens dir.
- **Spacing/type/radius** from `src/tokens/spacing.ts`.
- **Icons** from `src/tokens/icons.ts` (Phosphor, vendored as SVG path
  data). Add to that file before referencing a new glyph.
- **`exactOptionalPropertyTypes: true` is on.** Use explicit `null`,
  not `undefined`, when a field can be absent. The TS noise is the
  point — it catches real bugs.
- **`biome check` is the formatter.** Don't argue with it.
- **Workers**: DuckDB's worker is loaded from the vendor's bundle via
  `importScripts`; the taxonomy worker is bundled as a separate file
  by esbuild. Don't bundle a third worker without a clear reason.
- **CSP**: the inlined `<script>` body's SHA-256 is computed at build
  time and injected into `script-src`. If you change how the bundle is
  produced, verify the page still loads (the smoke test will catch this).

## Build commands

```
npm install          # postinstall vendors DuckDB-wasm into public/duckdb-fallback/
npm run dev          # esbuild + dev server on :5173
npm run build        # → dist/index.html (single file)
npm run check        # tsc --noEmit + biome check
npm run test         # vitest run
npm run smoke        # build + headless Playwright smoke test
```

## When uncertain

Default to proceeding (handoff §0). Decide, log to `DECISIONS.md`,
move. Stop and write a `BLOCKER.md` only for the four cases in
handoff §5: spec-vs-spec contradiction, genuinely-required new
runtime dep, materially-changed downstream sink format, or a feature
that conflicts with a Hard NOT.
