import { defineConfig } from '@playwright/test';

const CHROME = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  retries: 0,
  fullyParallel: false,
  use: {
    headless: true,
    launchOptions: { executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] },
  },
});
