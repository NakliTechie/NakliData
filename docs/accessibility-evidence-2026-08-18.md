# Accessibility evidence — 2026-08-18

Scope: critical browser-native workflows in the checked-in production build.
This record is evidence, not a WCAG conformance statement.

## Automated evidence

- Populated-workspace buttons, disclosures, text fields, text areas, and selects
  meet a 24 CSS-pixel minimum target in Chromium.
- Token pairs measured in browser: primary text/background 16.13:1; muted
  text/surface 5.91:1; border/surface 3.16:1; focus/surface 5.73:1.
- `prefers-reduced-motion: reduce` matches and collapses transition/animation
  durations while disabling smooth scroll.
- 640 CSS-pixel and 320 CSS-pixel viewports model 200% and 400% zoom from a
  1280-pixel baseline. Both retain a visible main landmark without document
  horizontal overflow.
- Production smoke finds 556 named interactive controls and a described graph
  canvas.
- Eleven focused E2E cases cover source, Settings/AI, override, define-type,
  and compare-table modal focus. The five modal paths assert Tab and Shift+Tab
  wrapping, Escape closure, and focus return.

Commands:

```text
npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/accessibility-matrix.spec.ts --workers=1
npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/mount-url.spec.ts tests/e2e/sidecar-flow.spec.ts tests/e2e/override-rules.spec.ts tests/e2e/define-type.spec.ts tests/e2e/compare-tables.spec.ts --workers=1
```

## Environment-specific evidence still required

- VoiceOver on macOS across first run, schema override, notebook execution,
  report creation, error recovery, and exports.
- NVDA on Windows across the same workflows.
- Record browser, OS, screen-reader versions, speech/braille output findings,
  and any repaired defects before making a screen-reader support claim.
