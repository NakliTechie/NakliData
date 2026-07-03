// Build the standalone M0 runner harness. Separate from the product build
// (esbuild.config.mjs) — it reuses the product's COMMON options so transformers
// / duckdb-wasm bundle identically, but emits eval/m0/runner/harness.js. Not shipped.
import { build } from 'esbuild';

await build({
  bundle: true,
  target: 'es2022',
  format: 'esm',
  platform: 'browser',
  loader: { '.svg': 'text', '.css': 'text' },
  define: { 'process.env.NODE_ENV': '"production"' },
  entryPoints: ['eval/m0/runner/harness.ts'],
  outfile: 'eval/m0/runner/harness.js',
  logLevel: 'info',
});
console.log('built eval/m0/runner/harness.js');
