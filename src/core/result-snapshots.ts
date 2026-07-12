// Result-snapshot persistence (Tier-2 / reporting-improvements #3).
//
// On reload, the notebook restores cells + sources but every SQL cell shows
// "Run to see results" — the durable `.naklidata` deliberately strips result
// rows (lean file, no data leak; see persistence.ts `cellWithoutResults`).
// For senior-staff prep, drafts should reopen with visible EVIDENCE, so we
// persist a small capped snapshot of each SQL result to a SEPARATE per-session
// IDB store — never the shared/exported file. On restore the cell shows the
// snapshot with a staleness label; recomputation stays local + user-initiated.
//
// This module is the pure builder + hash + staleness check, plus the tiny
// IDB-backed store. No DOM, no engine.

import { kvDelete, kvGet, kvPut } from './idb.ts';

/** Max rows kept per snapshot — a head sample, enough for "reopen with evidence". */
export const SNAPSHOT_ROW_CAP = 100;

/** The persisted head of a SQL result, keyed by cell id within a session. */
export interface ResultSnapshot {
  columns: string[];
  /** Head sample — at most SNAPSHOT_ROW_CAP rows. */
  rows: Array<Record<string, unknown>>;
  /** FULL row count of the result (may exceed rows.length). */
  rowCount: number;
  elapsedMs: number;
  /** Epoch ms when the producing run happened. */
  ranAt: number;
  /** Hash of the SQL that produced it — drives staleness. */
  sqlHash: string;
}

/** Metadata carried on a SQL cell describing its current lastResult's provenance. */
export interface SqlResultMeta {
  ranAt: number;
  sqlHash: string;
  /** True when lastResult.rows is a capped head of rowCount. */
  capped: boolean;
  /** True when lastResult was rehydrated from a snapshot (not a live run this session). */
  fromSnapshot: boolean;
}

export interface SnapshotableResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  elapsedMs: number;
}

/** Stable, fast, non-cryptographic hash (FNV-1a → 8-hex). Used only for
 *  "did the query text change since this result?" — not for security. */
export function hashSql(code: string): string {
  const s = code.trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // FNV prime multiply, kept in 32-bit via Math.imul.
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Build a capped snapshot from a fresh result + the code that produced it. */
export function buildResultSnapshot(
  code: string,
  result: SnapshotableResult,
  now: number,
): ResultSnapshot {
  return {
    columns: result.columns,
    rows: result.rows.slice(0, SNAPSHOT_ROW_CAP),
    rowCount: result.rowCount,
    elapsedMs: result.elapsedMs,
    ranAt: now,
    sqlHash: hashSql(code),
  };
}

/** True when the cell's current code no longer matches the snapshot's query. */
export function isSnapshotStale(snapshotSqlHash: string, currentCode: string): boolean {
  return snapshotSqlHash !== hashSql(currentCode);
}

// ---- per-session IDB store (kept out of the shared .naklidata file) --------

const key = (sessionId: string) => `result-snapshots/${sessionId}`;

export async function loadResultSnapshots(
  sessionId: string,
): Promise<Record<string, ResultSnapshot>> {
  const raw = await kvGet<Record<string, ResultSnapshot>>(key(sessionId));
  return raw ?? {};
}

export async function saveResultSnapshots(
  sessionId: string,
  map: Record<string, ResultSnapshot>,
): Promise<void> {
  await kvPut(key(sessionId), map);
}

export async function clearResultSnapshots(sessionId: string): Promise<void> {
  await kvDelete(key(sessionId));
}
