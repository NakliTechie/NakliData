// Multi-session persistence. Each session owns its own workbook
// snapshot (same JSON shape as a `.naklidata` file — sources +
// assignments + cells + settings). The currently-active session id +
// the full list of sessions live at `sessions/index`; per-session
// snapshots live at `sessions/<id>/snapshot`.
//
// Migration: the previous single-snapshot key `workbook/current` is
// read once on first boot and adopted as the seed session, then
// deleted. New code never writes to `workbook/current`.

import { deleteHandle } from './handles.ts';
import { kvDelete, kvGet, kvPut } from './idb.ts';
import { loadChunk } from './lazy-loader.ts';
import type { NakliDataFile } from './persistence.ts';
import { clearFingerprints } from './refresh-store.ts';
import { clearResultSnapshots } from './result-snapshots.ts';
import { forgetSourceSecrets } from './secrets/source-secrets.ts';

const INDEX_KEY = 'sessions/index';
const LEGACY_SNAPSHOT_KEY = 'workbook/current';

export interface SessionMeta {
  id: string;
  name: string;
  created: string;
  modified: string;
}

export interface SessionsIndex {
  activeId: string | null;
  sessions: SessionMeta[];
}

const EMPTY_INDEX: SessionsIndex = { activeId: null, sessions: [] };

function snapshotKey(id: string): string {
  return `sessions/${id}/snapshot`;
}

function newId(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function loadIndex(): Promise<SessionsIndex> {
  return (await kvGet<SessionsIndex>(INDEX_KEY)) ?? EMPTY_INDEX;
}

async function writeIndex(idx: SessionsIndex): Promise<void> {
  await kvPut(INDEX_KEY, idx);
}

/**
 * Ensure at least one session exists and the index has an `activeId`
 * pointing at a real session. Handles three startup states:
 *
 * 1. Brand-new install (no index, no legacy snapshot) → create an
 *    empty "Untitled" session.
 * 2. Upgrade from pre-session storage (no index, legacy
 *    `workbook/current` present) → adopt the legacy snapshot as the
 *    seed session, delete the legacy key.
 * 3. Existing multi-session install (index present) → return the
 *    active session (or fall back to the first if `activeId` is
 *    stale).
 */
export async function ensureActiveSession(): Promise<SessionMeta> {
  let idx = await loadIndex();

  if (idx.sessions.length === 0) {
    const legacyRaw = await kvGet<unknown>(LEGACY_SNAPSHOT_KEY);
    let legacy: NakliDataFile | null = null;
    if (legacyRaw) {
      try {
        const validator = await loadChunk('persistence-validation');
        legacy = validator.validateNakliDataFile(legacyRaw);
      } catch {
        // A malformed legacy snapshot is not allowed to seed a new session.
      }
    }
    const id = newId();
    const meta: SessionMeta = {
      id,
      name: legacy?.name?.trim() || 'Untitled',
      created: legacy?.created ?? nowIso(),
      modified: legacy?.modified ?? nowIso(),
    };
    idx = { activeId: id, sessions: [meta] };
    if (legacy) {
      await kvPut(snapshotKey(id), legacy);
      await kvDelete(LEGACY_SNAPSHOT_KEY);
    }
    await writeIndex(idx);
    return meta;
  }

  const active = idx.sessions.find((s) => s.id === idx.activeId);
  if (active) return active;

  const first = idx.sessions[0];
  if (!first) {
    // Defensive: sessions[] has length but no element at [0] is
    // impossible — but TypeScript won't narrow that for us.
    throw new Error('sessions index corrupted (length > 0 but [0] missing)');
  }
  idx = { ...idx, activeId: first.id };
  await writeIndex(idx);
  return first;
}

export async function createSession(name?: string): Promise<SessionMeta> {
  const idx = await loadIndex();
  const id = newId();
  const meta: SessionMeta = {
    id,
    name: (name ?? '').trim() || `Session ${idx.sessions.length + 1}`,
    created: nowIso(),
    modified: nowIso(),
  };
  await writeIndex({
    activeId: id,
    sessions: [...idx.sessions, meta],
  });
  return meta;
}

export async function setActiveSession(id: string): Promise<void> {
  const idx = await loadIndex();
  if (!idx.sessions.find((s) => s.id === id)) {
    throw new Error(`No such session: ${id}`);
  }
  await writeIndex({ ...idx, activeId: id });
}

export async function renameSession(id: string, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) throw new Error('Session name cannot be empty.');
  const idx = await loadIndex();
  const next: SessionsIndex = {
    ...idx,
    sessions: idx.sessions.map((s) =>
      s.id === id ? { ...s, name: clean, modified: nowIso() } : s,
    ),
  };
  await writeIndex(next);
}

export async function deleteSession(id: string): Promise<void> {
  const idx = await loadIndex();
  if (idx.sessions.length <= 1) {
    throw new Error('Cannot delete the last session.');
  }
  await clearSessionArtifacts(id, idx);
  const remaining = idx.sessions.filter((s) => s.id !== id);
  if (remaining.length === 0) throw new Error('unreachable: length check above');
  const head = remaining[0];
  if (!head) throw new Error('unreachable: length check above');
  const activeId = idx.activeId === id ? head.id : idx.activeId;
  await writeIndex({ activeId, sessions: remaining });
}

export async function loadSnapshot(id: string): Promise<NakliDataFile | null> {
  const raw = await kvGet<unknown>(snapshotKey(id));
  if (!raw) return null;
  try {
    const validator = await loadChunk('persistence-validation');
    return validator.validateNakliDataFile(raw);
  } catch {
    return null;
  }
}

export async function saveSnapshot(id: string, snapshot: NakliDataFile): Promise<void> {
  await kvPut(snapshotKey(id), snapshot);
  // Reflect the freshly-saved modified time in the index so the UI list
  // can show last-touched ordering.
  const idx = await loadIndex();
  const next: SessionsIndex = {
    ...idx,
    sessions: idx.sessions.map((s) => (s.id === id ? { ...s, modified: snapshot.modified } : s)),
  };
  await writeIndex(next);
}

export async function clearSnapshot(id: string): Promise<void> {
  await kvDelete(snapshotKey(id));
}

/**
 * Delete every separately stored artifact owned by a session. A session is
 * more than its main workbook snapshot: result rows, refresh fingerprints,
 * source credentials, and FSA handles otherwise survive deletion/Start Fresh.
 *
 * Handle refs can be shared by two saved sessions, so only delete a handle
 * when no surviving snapshot still points at it. All deletions are attempted
 * before an error is surfaced; callers must not claim success on a partial
 * cleanup.
 */
export async function clearSessionArtifacts(id: string, knownIndex?: SessionsIndex): Promise<void> {
  const idx = knownIndex ?? (await loadIndex());
  const snapshot = await loadSnapshot(id);
  const survivingRefs = new Set<string>();
  for (const other of idx.sessions) {
    if (other.id === id) continue;
    const otherSnapshot = await loadSnapshot(other.id);
    if (!otherSnapshot) continue;
    for (const source of otherSnapshot.sources) {
      if (source.ref) survivingRefs.add(source.ref);
    }
  }

  const cleanup: Array<Promise<unknown>> = [
    kvDelete(snapshotKey(id)),
    clearResultSnapshots(id),
    clearFingerprints(id),
  ];
  if (snapshot) {
    for (const source of snapshot.sources) {
      cleanup.push(forgetSourceSecrets(source.id, source.kind));
      if (
        (source.kind === 'fsa-folder' || source.kind === 'fsa-file') &&
        source.ref &&
        !survivingRefs.has(source.ref)
      ) {
        cleanup.push(deleteHandle(source.ref));
      }
    }
  }

  const settled = await Promise.allSettled(cleanup);
  const failures = settled.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    throw new Error(
      `Could not remove ${failures.length} stored session artifact${failures.length === 1 ? '' : 's'}.`,
    );
  }
}
