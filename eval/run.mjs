#!/usr/bin/env node
// Sidecar eval harness entry point (W2.4).
//
// The actual logic lives in eval/harness.ts (TypeScript, imports the
// app's `.ts` sidecar modules). Node's native type-stripping can't run
// it (the codebase uses TS parameter properties, which strip-only mode
// rejects), so we bundle harness.ts with esbuild — already a devDep —
// into eval/.cache/ and import the result. No new dependency.
//
// Usage:
//   npm run eval -- --dry-run
//   npm run eval -- --provider openai --model gpt-4o-mini
//   npm run eval -- --provider anthropic --model claude-3-5-haiku-latest --job explain-error
//   npm run eval -- --provider custom --endpoint https://llm.local --model mixtral
//
// Live mode reads the API key from env:
//   ANTHROPIC_API_KEY / OPENAI_API_KEY / CUSTOM_API_KEY
//
// Flags:
//   --dry-run            score recorded fixture responses; no network
//   --provider <name>    anthropic | openai | custom   (default: openai)
//   --model <id>         model id (default: provider's haiku/mini)
//   --endpoint <url>     base URL for --provider custom
//   --job <name>         run one job (repeatable); default: all three
//   --out <path>         report output (default: eval/report.html)

import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const ALL_JOBS = ['explain-error', 'disambiguate-type', 'define-type'];
const DEFAULT_MODEL = { anthropic: 'claude-3-5-haiku-latest', openai: 'gpt-4o-mini', custom: '' };
const ENV_KEY = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  custom: 'CUSTOM_API_KEY',
};

function parseArgs(argv) {
  const opts = { provider: 'openai', model: '', endpoint: '', jobs: [], dryRun: false, out: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--provider') opts.provider = argv[++i];
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--endpoint') opts.endpoint = argv[++i];
    else if (a === '--job') opts.jobs.push(argv[++i]);
    else if (a === '--out') opts.out = argv[++i];
    else {
      process.stderr.write(`Unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return opts;
}

const cli = parseArgs(process.argv.slice(2));

if (!['anthropic', 'openai', 'custom'].includes(cli.provider)) {
  process.stderr.write(`--provider must be anthropic | openai | custom (got "${cli.provider}")\n`);
  process.exit(2);
}
for (const j of cli.jobs) {
  if (!ALL_JOBS.includes(j)) {
    process.stderr.write(`--job must be one of ${ALL_JOBS.join(' | ')} (got "${j}")\n`);
    process.exit(2);
  }
}

const provider = cli.provider;
const model = cli.model || DEFAULT_MODEL[provider];
const jobs = cli.jobs.length > 0 ? cli.jobs : ALL_JOBS;
const out = cli.out || resolve(HERE, 'report.html');
const apiKey = cli.dryRun ? '' : (process.env[ENV_KEY[provider]] ?? '');

if (!cli.dryRun && !apiKey) {
  process.stderr.write(
    `No API key in $${ENV_KEY[provider]}. Set it, or run with --dry-run to score recorded fixtures offline.\n`,
  );
  process.exit(2);
}
if (provider === 'custom' && !cli.dryRun && !cli.endpoint) {
  process.stderr.write('--provider custom requires --endpoint <url> (or use --dry-run).\n');
  process.exit(2);
}

// Bundle harness.ts → eval/.cache/harness.mjs, then import + run.
const cacheDir = resolve(HERE, '.cache');
const bundlePath = resolve(cacheDir, 'harness.mjs');
await mkdir(cacheDir, { recursive: true });
await build({
  entryPoints: [resolve(HERE, 'harness.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: bundlePath,
  logLevel: 'warning',
});

const { main } = await import(`file://${bundlePath}`);
try {
  const { pass, total } = await main({
    provider,
    model,
    apiKey,
    endpoint: cli.endpoint,
    jobs,
    dryRun: cli.dryRun,
    fixturesDir: resolve(HERE, 'fixtures'),
    outFile: out,
  });
  // Non-zero exit when any case failed — useful for CI gating later.
  process.exit(pass === total ? 0 : 1);
} finally {
  await rm(cacheDir, { recursive: true, force: true });
}
