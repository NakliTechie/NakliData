import { defineConfig } from '@playwright/test';

// Env-var override (sandbox sets this); otherwise let Playwright use its
// bundled chromium. Same convention as scripts/smoke.mjs.
const CHROME = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? process.env.CHROMIUM_PATH;

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  retries: 0,
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
