import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const requiredFlags = [
  'nodejs_compat',
  'enable_request_signal',
  'request_signal_passthrough',
  'disallow_eval_during_startup',
];

for (const flag of requiredFlags) {
  if (!config.compatibility_flags?.includes(flag)) {
    throw new Error(`wrangler.jsonc is missing required flag ${flag}`);
  }
}
if (config.observability?.enabled !== false) {
  throw new Error('Compute Bridge observability must remain disabled by default.');
}
if (config.vars?.BRIDGE_ADAPTER !== 'unconfigured') {
  throw new Error('The default environment must not claim a live warehouse adapter.');
}
for (const name of ['staging', 'production']) {
  const environment = config.env?.[name];
  if (!environment || environment.observability?.enabled !== false) {
    throw new Error(`${name} must explicitly disable persisted observability.`);
  }
  if (environment.vars?.BRIDGE_ADAPTER !== 'unconfigured') {
    throw new Error(`${name} must remain unconfigured until its live matrix passes.`);
  }
}

console.log('[compute-bridge-config] privacy and fail-closed defaults present');
