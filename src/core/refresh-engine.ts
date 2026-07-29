// M3 — Refresh orchestrator.
//
// Coordinates the change-detection sweep:
//   1. For each mounted source, compute a CURRENT fingerprint.
//      - FSA-folder: aggregate supported-file metadata and hash the sorted
//        filename + size + lastModified tuples.
//      - HTTP: HEAD request → ETag + Last-Modified + Content-Length.
//      - Others (iceberg, bridge, s3): explicitly uncheckable.
//   2. Compare against the persisted fingerprint map (IDB).
//   3. Compute stale source IDs from the diff.
//   4. Cascade via the M2 lineage graph to stale cell IDs.
//   5. Return the diff for the UI to surface.
//
// The orchestrator is invoked ON USER ACTION (header "Check changes"
// button). Per handoff §10 Hard NOT: never on a timer, no
// background polling.

import { getHandle, queryReadPermissionQuiet } from './handles.ts';
import type { LineageGraph } from './lineage-store.ts';
import { type MountedSource, detectFormat } from './mount.ts';
import { loadFingerprints, saveFingerprints } from './refresh-store.ts';
import {
  type SourceFingerprint,
  cascadeStaleness,
  fingerprintFromHeaders,
  fingerprintsEqual,
  hashFingerprintMetadata,
  isCheckableFingerprint,
  unsupportedFingerprint,
} from './refresh.ts';

export interface RefreshDiff {
  /** Sources whose CURRENT fingerprint differs from the persisted one. */
  staleSourceIds: string[];
  /** Cells downstream of any stale source (BFS via the M2 lineage graph). */
  staleCellIds: string[];
  /** Sources where the current fingerprint couldn't be computed
   *  (FSA handle revoked, HEAD failed, etc.). Surface but don't
   *  auto-cascade — the user can decide. */
  uncheckableSourceIds: string[];
  /** Total sources scanned this pass. */
  scanned: number;
  /** Fresh fingerprint map. Existing-source entries are persisted only after
   *  remount + recomputation succeeds; first observations are also copied into
   *  `baselineFingerprints` and may be recorded immediately. */
  freshFingerprints: Record<string, SourceFingerprint>;
  /** First successful observations. These are safe to persist immediately:
   *  there is no older baseline or stale result to protect. */
  baselineFingerprints: Record<string, SourceFingerprint>;
}

/**
 * Run the change-detection sweep. Returns the diff; does NOT persist it. The
 * caller may immediately record `baselineFingerprints`, but changed entries
 * stay pending until remount + recomputation succeeds.
 */
export async function computeRefreshDiff(opts: {
  sessionId: string;
  sources: ReadonlyArray<MountedSource>;
  lineage: LineageGraph;
  /** Inject a custom HEAD fetcher for testing; defaults to global fetch. */
  fetchHead?: (url: string) => Promise<Response>;
  /** Deterministic store snapshot for tests and non-IDB hosts. */
  persistedFingerprints?: Readonly<Record<string, SourceFingerprint>>;
}): Promise<RefreshDiff> {
  const persisted = opts.persistedFingerprints ?? (await loadFingerprints(opts.sessionId));
  const staleSourceIds: string[] = [];
  const uncheckableSourceIds: string[] = [];
  const freshFingerprints: Record<string, SourceFingerprint> = {};
  const baselineFingerprints: Record<string, SourceFingerprint> = {};

  for (const source of opts.sources) {
    const current = await computeCurrentFingerprint(source, opts.fetchHead);
    if (current === null || !isCheckableFingerprint(current)) {
      uncheckableSourceIds.push(source.id);
      continue;
    }
    freshFingerprints[source.id] = current;
    const prior = persisted[source.id];
    if (!prior) {
      // First successful observation establishes the baseline immediately;
      // there is no stale result/baseline pair to keep coordinated yet.
      baselineFingerprints[source.id] = current;
      continue;
    }
    if (!fingerprintsEqual(prior, current)) {
      staleSourceIds.push(source.id);
    }
  }

  const { staleCellIds } = cascadeStaleness(staleSourceIds, opts.lineage);

  return {
    staleSourceIds,
    staleCellIds,
    uncheckableSourceIds,
    scanned: opts.sources.length,
    freshFingerprints,
    baselineFingerprints,
  };
}

/** Merge observations into the session's fingerprint map. Called immediately
 *  for first baselines and after a confirmed changed-source refresh succeeds.
 *
 *  M9: MERGE over the persisted map rather than replacing it. The fresh map
 *  omits uncheckable sources (permission temporarily lost, HEAD failed); a
 *  plain replace would drop their stored baseline, so once checkable again
 *  there'd be "no prior" and a real change would be silently missed. Merging
 *  keeps each uncheckable source's last-known baseline intact. */
export async function persistFingerprints(
  sessionId: string,
  fingerprints: Record<string, SourceFingerprint>,
): Promise<void> {
  const existing = await loadFingerprints(sessionId);
  await saveFingerprints(sessionId, { ...existing, ...fingerprints });
}

/**
 * Compute the current fingerprint for one source. Returns null if
 * the fingerprint couldn't be obtained (handle revoked, HEAD failed).
 * Returns an `unsupported` sentinel for source kinds we don't yet
 * fingerprint. The caller treats it as uncheckable and never records it as
 * evidence that the source is current.
 */
async function computeCurrentFingerprint(
  source: MountedSource,
  fetchHead?: (url: string) => Promise<Response>,
): Promise<SourceFingerprint | null> {
  const kind = source.kind;
  if (kind === 'fsa-folder') return await fingerprintFsaFolder(source);
  if (kind === 'http') return await fingerprintHttp(source, fetchHead);
  // s3-endpoint, iceberg-table, iceberg-catalog, compute-bridge,
  // compute-bridge-catalog, lens-restored, example-bundle: all
  // unsupported for now — see DECISIONS 2026-06-10 entry M.
  return unsupportedFingerprint();
}

/**
 * For an FSA folder source, aggregate supported-file size/max-mtime and hash
 * the sorted filename/size/mtime tuples. The tuple hash closes collisions where
 * additions/removals preserve the old aggregate values.
 *
 * If the FSA handle is gone OR permission isn't already granted
 * (queryPermission only — no prompt; the check is opportunistic),
 * returns null. The UI surfaces "needs reconnect to check."
 */
async function fingerprintFsaFolder(source: MountedSource): Promise<SourceFingerprint | null> {
  if (!source.ref) return null;
  let handle: FileSystemDirectoryHandle | null = null;
  try {
    const got = await getHandle(source.ref);
    if (!got || got.kind !== 'directory') return null;
    handle = got as FileSystemDirectoryHandle;
  } catch {
    return null;
  }
  // Don't PROMPT — only check existing grant. Prompting here would
  // make a silent "Check for updates" button fire a permission popup,
  // which is wrong UX. If permission is gone, mark uncheckable.
  const perm = await queryReadPermissionQuiet(
    handle as unknown as Parameters<typeof queryReadPermissionQuiet>[0],
  );
  if (perm !== 'granted') return null;

  let totalSize = 0;
  let maxLastModified = 0;
  const metadata: string[] = [];
  const MAX_FOLDER_ENTRIES = 5000;
  let walked = 0;
  try {
    // values() iterator is async on FileSystemDirectoryHandle.
    const iter = (
      handle as FileSystemDirectoryHandle & {
        values(): AsyncIterableIterator<FileSystemHandle>;
      }
    ).values();
    for await (const entry of iter) {
      if (entry.kind !== 'file') continue;
      if (!detectFormat(entry.name)) continue;
      if (++walked > MAX_FOLDER_ENTRIES) return null;
      try {
        const file = await (entry as FileSystemFileHandle).getFile();
        totalSize += file.size;
        if (file.lastModified > maxLastModified) maxLastModified = file.lastModified;
        metadata.push(`${entry.name}\u0000${file.size}\u0000${file.lastModified}`);
      } catch {
        // A partial scan is not evidence of freshness.
        return null;
      }
    }
  } catch {
    return null;
  }
  metadata.sort();
  return {
    kind: 'fsa',
    size: totalSize,
    lastModified: maxLastModified,
    fileCount: metadata.length,
    metadataHash: hashFingerprintMetadata(metadata),
    computedAt: new Date().toISOString(),
  };
}

/** HEAD a public URL → fingerprint. CORS-safe headers (ETag,
 *  Last-Modified, Content-Length) are returned by the wrapper. */
async function fingerprintHttp(
  source: MountedSource,
  fetchHead?: (url: string) => Promise<Response>,
): Promise<SourceFingerprint | null> {
  const url = source.ref;
  if (!url) return null;
  const fetcher = fetchHead ?? defaultHeadFetcher;
  try {
    const res = await fetcher(url);
    if (!res.ok) return null;
    return fingerprintFromHeaders(res.headers);
  } catch {
    return null;
  }
}

async function defaultHeadFetcher(url: string): Promise<Response> {
  return await fetch(url, { method: 'HEAD' });
}
