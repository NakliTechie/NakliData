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
if (config.vars?.BRIDGE_VENDOR_CONFIG_JSON !== '{}') {
  throw new Error('The default environment must not contain vendor configuration.');
}
const serialized = JSON.stringify(config);
for (const secretName of ['BRIDGE_AUTH_TOKEN', 'DATABRICKS_TOKEN', 'SNOWFLAKE_TOKEN']) {
  if (serialized.includes(secretName)) {
    throw new Error(`wrangler.jsonc must not define the ${secretName} secret binding.`);
  }
}
for (const name of ['staging', 'production']) {
  const environment = config.env?.[name];
  if (!environment || environment.observability?.enabled !== false) {
    throw new Error(`${name} must explicitly disable persisted observability.`);
  }
  if (environment.vars?.BRIDGE_ADAPTER !== 'unconfigured') {
    throw new Error(`${name} must remain unconfigured until its live matrix passes.`);
  }
  if (environment.vars?.BRIDGE_VENDOR_CONFIG_JSON !== '{}') {
    throw new Error(`${name} must not contain vendor configuration before its live matrix.`);
  }
}

console.log('[compute-bridge-config] privacy and fail-closed defaults present');
