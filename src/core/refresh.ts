// M3 — Incremental Refresh.
//
// Pure data structures + cascade logic. Detecting that a source has
// changed since the workbook was last saved is the job of
// `refresh-engine.ts` (which talks to FSA / HTTP / etc.). This
// module only:
//   - Defines the `SourceFingerprint` shape (discriminated by kind).
//   - Compares two fingerprints for equality.
//   - Cascades a set of stale source IDs through a lineage graph to
//     return the affected cell IDs (M3 hard-depends on M2).
//
// Handoff Hard NOTs preserved (handoff §10):
//   - No background polling. The cascade is invoked ON USER ACTION
//     or ON APP BOOT — never on a timer.
//   - No persistence of file contents — only the fingerprint hash
//     (size, lastModified, ETag, etc.).

import type { LineageGraph } from './lineage-store.ts';

/**
 * A per-source change-detection token. Discriminated by `kind`; each
 * source kind picks the most reliable signal available without
 * triggering a full download.
 *
 *   - `fsa`         — File System Access handle. Cheap: `file.size`
 *                     + `file.lastModified` are on the File object the
 *                     OS hands back. No network. No file read.
 *   - `http`        — Public URL. `ETag` + `Last-Modified` from a HEAD
 *                     request. Falls back to `Content-Length` if both
 *                     are absent (rare for static hosting).
 *   - `s3`          — S3-compatible endpoint. Same as `http` for the
 *                     object via HEAD; the path identifies the object.
 *   - `iceberg`     — Iceberg metadata file version (the `current_snapshot_id`
 *                     field is the canonical change marker).
 *   - `bridge`      — Compute Bridge SQL hash + bridge URL. Detects
 *                     SQL changes; data drift requires the bridge to
 *                     respond with its own fingerprint header.
 *   - `unsupported` — kind we don't know how to fingerprint yet
 *                     (currently iceberg/bridge stubs). Never
 *                     considered stale; never auto-refreshes.
 */
export type SourceFingerprint =
  | { kind: 'fsa'; size: number; lastModified: number; computedAt: string }
  | {
      kind: 'http';
      etag: string | null;
      lastModifiedHeader: string | null;
      contentLength: number | null;
      computedAt: string;
    }
  | {
      kind: 's3';
      etag: string | null;
      lastModifiedHeader: string | null;
      computedAt: string;
    }
  | { kind: 'iceberg'; snapshotId: string; computedAt: string }
  | { kind: 'bridge'; sqlHash: string; computedAt: string }
  | { kind: 'unsupported'; computedAt: string };

/**
 * Two fingerprints are equal when:
 *   - Their kind matches.
 *   - Every field used for change detection is byte-equal.
 *
 * `computedAt` is metadata (not part of the change-detection key) and
 * intentionally ignored — two fingerprints captured at different times
 * for the same unchanged file should compare equal.
 *
 * `unsupported` fingerprints ALWAYS compare equal — we don't know how
 * to detect change, so we don't make false claims.
 */
export function fingerprintsEqual(a: SourceFingerprint, b: SourceFingerprint): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'unsupported') return true;
  if (a.kind === 'fsa' && b.kind === 'fsa') {
    return a.size === b.size && a.lastModified === b.lastModified;
  }
  if (a.kind === 'http' && b.kind === 'http') {
    return (
      a.etag === b.etag &&
      a.lastModifiedHeader === b.lastModifiedHeader &&
      a.contentLength === b.contentLength
    );
  }
  if (a.kind === 's3' && b.kind === 's3') {
    return a.etag === b.etag && a.lastModifiedHeader === b.lastModifiedHeader;
  }
  if (a.kind === 'iceberg' && b.kind === 'iceberg') {
    return a.snapshotId === b.snapshotId;
  }
  if (a.kind === 'bridge' && b.kind === 'bridge') {
    return a.sqlHash === b.sqlHash;
  }
  return false;
}

/**
 * Given a set of stale source IDs and a lineage graph from M2, walk
 * the graph forward (sources → cells → downstream cells) and return
 * the set of cell IDs whose result is potentially out-of-date.
 *
 * **Algorithm:** BFS from each stale source. A cell is stale if any
 * inbound edge originates from a stale source OR a stale cell.
 *
 * **Cycle safety:** even though the canonical lineage graph is a DAG,
 * a malformed `.naklidata` (or a future feature like recursive CTEs
 * rendering as a cycle) could break a naive walker. The `visited`
 * set guarantees O(V + E) and termination.
 *
 * **Sink nodes:** ignored. Sinks don't have results to "refresh";
 * if their upstream cell goes stale the user re-runs the cell, and
 * the sink panel shows "result is stale — re-run before exporting."
 *
 * Returns the set of stale cell IDs only — sinks are not in the
 * result (callers don't need to "refresh" a sink).
 */
export function cascadeStaleness(
  staleSourceIds: ReadonlyArray<string>,
  graph: LineageGraph,
): { staleCellIds: string[] } {
  const stale = new Set<string>(staleSourceIds);
  const cellNodes = new Set(graph.nodes.filter((n) => n.kind === 'cell').map((n) => n.id));

  // Edges grouped by their `from` node — lets us BFS forward in O(E).
  const outgoing = new Map<string, Array<{ to: string }>>();
  for (const e of graph.edges) {
    const list = outgoing.get(e.from) ?? [];
    list.push({ to: e.to });
    outgoing.set(e.from, list);
  }

  const queue = [...staleSourceIds];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) continue;
    const outs = outgoing.get(node) ?? [];
    for (const edge of outs) {
      // Only cells go on the queue. Sinks terminate the chain — they
      // have no further downstream consumers in the graph.
      if (!cellNodes.has(edge.to)) continue;
      if (stale.has(edge.to)) continue;
      stale.add(edge.to);
      queue.push(edge.to);
    }
  }

  // Strip the source IDs from the returned stale set — the caller
  // wants the CELLS to re-run, not the sources (sources don't re-run;
  // their fingerprint just gets refreshed after the user confirms).
  const staleCellIds: string[] = [];
  for (const id of stale) {
    if (cellNodes.has(id)) staleCellIds.push(id);
  }
  return { staleCellIds };
}

/**
 * Convenience constructor for the FSA path — `Engine.registerCsv`-style
 * code paths have the `File` in hand; this turns it into a
 * fingerprint without leaking the kind into call sites.
 */
export function fingerprintFromFile(file: File): SourceFingerprint {
  return {
    kind: 'fsa',
    size: file.size,
    lastModified: file.lastModified,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Convenience constructor for the HTTP path — given the response
 * Headers from a HEAD request, build a fingerprint.
 */
export function fingerprintFromHeaders(headers: Headers): SourceFingerprint {
  const cl = headers.get('content-length');
  return {
    kind: 'http',
    etag: headers.get('etag'),
    lastModifiedHeader: headers.get('last-modified'),
    contentLength: cl !== null ? Number.parseInt(cl, 10) || null : null,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Convenience: an "unsupported" fingerprint sentinel. Used as the
 * default for source kinds we haven't wired fingerprinting for yet
 * (iceberg / bridge). Always compares equal to any other unsupported
 * — never triggers a stale banner.
 */
export function unsupportedFingerprint(): SourceFingerprint {
  return { kind: 'unsupported', computedAt: new Date().toISOString() };
}
