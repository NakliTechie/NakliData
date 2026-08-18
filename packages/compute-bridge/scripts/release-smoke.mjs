import { pathToFileURL } from 'node:url';
import { LiveMatrixError, configFromEnvironment, runLiveMatrix } from './live-matrix.mjs';

const RELEASE_SMOKE_ID = 'naklidata-compute-bridge-release-smoke';
const RELEASE_SMOKE_VERSION = 1;

export function releaseConfigFromEnvironment(env = process.env) {
  const config = configFromEnvironment(env);
  if (config.mode !== 'baseline') {
    throw new LiveMatrixError(
      'Release smoke requires BRIDGE_LIVE_MODE=baseline.',
      'invalid_config',
    );
  }
  if (!config.expectedVersion) {
    throw new LiveMatrixError(
      'BRIDGE_LIVE_EXPECTED_VERSION is required for release smoke.',
      'invalid_config',
    );
  }
  return config;
}

export async function runReleaseSmoke(config, options = {}) {
  const result = await runLiveMatrix(config, options);
  return {
    releaseSmoke: RELEASE_SMOKE_ID,
    version: RELEASE_SMOKE_VERSION,
    expectedBridgeVersion: config.expectedVersion,
    matrix: result,
  };
}

async function main() {
  try {
    const result = await runReleaseSmoke(releaseConfigFromEnvironment());
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const normalized =
      error instanceof LiveMatrixError
        ? error
        : new LiveMatrixError('Release smoke runner failed.', 'runner_error');
    process.stderr.write(
      `${JSON.stringify({
        releaseSmoke: RELEASE_SMOKE_ID,
        version: RELEASE_SMOKE_VERSION,
        ok: false,
        status: normalized.status,
        errorCode: normalized.code,
      })}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
