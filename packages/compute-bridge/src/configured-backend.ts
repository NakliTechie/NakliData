import type { BridgeBackend } from './backend.ts';
import { backendFromEnvironment } from './vendor-config.ts';

/**
 * Batch 6 packages the protocol/security foundation without claiming a live
 * warehouse adapter. Batches 7 and 8 add exact vendor factories here after
 * their live profiles pass. Until then every deployed environment is
 * deliberately unready and exposes no query capability.
 */
export function configuredBackend(_env: Env): BridgeBackend | null {
  return backendFromEnvironment(_env);
}
