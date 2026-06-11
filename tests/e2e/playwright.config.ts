import { defineConfig } from '@playwright/test';

// Env-var override (sandbox sets this); otherwise let Playwright use its
// bundled chromium. Same convention as scripts/smoke.mjs.
const CHROME = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? process.env.CHROMIUM_PATH;

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  // Retry in CI only (forward-pass L21). A handful of specs assert
  // focus-restoration after a modal close (compare-tables, override-rules);
  // headless chromium under 2-worker load occasionally drops the focus
  // event, a pure timing flake. Retries re-run only the failed spec, so a
  // genuine regression still fails (it fails every attempt) while a flake
  // is absorbed. Local runs keep retries:0 for fast, honest feedback.
  retries: process.env.CI ? 2 : 0,
  // DuckDB-wasm boot is memory-heavy; >2 chromium workers hammering it
  // in parallel produces engine-boot timeouts on machines with fewer
  // cores. Override on a beefier box with `--workers=N`.
  workers: 2,
  fullyParallel: false,
  use: {
    headless: true,
    launchOptions: {
      ...(CHROME ? { executablePath: CHROME } : {}),
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  },
});
