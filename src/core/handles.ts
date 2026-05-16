// IndexedDB persistence for File System Access handles. FSA handles aren't
// JSON-serializable; they ARE structured-clone-able, so we put them
// directly into an IndexedDB object store and IDB takes care of the rest.
// On retrieval we re-request permission via the handle's permission API.
//
// Spec / handoff refs:
//   §3.5 (handoff) — re-request permission; reverify in the UI banner flow
//   §2.3 — IndexedDB holds FSA handles

const DB_NAME = 'NakliData';
const DB_VERSION = 1;
const STORE = 'fsa-handles';

interface DirHandle extends FileSystemDirectoryHandle {
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
}
interface FileHandle extends FileSystemFileHandle {
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
}

export type AnyHandle = DirHandle | FileHandle;

export class PermissionLostError extends Error {
  constructor(public readonly handleId: string) {
    super(`Permission lost for handle "${handleId}". Reconnect required.`);
    this.name = 'PermissionLostError';
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => T | Promise<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let value: T;
      Promise.resolve(fn(store))
        .then((v) => {
          value = v;
        })
        .catch(reject);
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function putHandle(id: string, handle: AnyHandle): Promise<void> {
  await withStore('readwrite', (store) => {
    store.put(handle, id);
  });
}

export async function getHandle(id: string): Promise<AnyHandle | null> {
  return await withStore('readonly', (store) => {
    return new Promise<AnyHandle | null>((resolve) => {
      const req = store.get(id);
      req.onsuccess = () => resolve((req.result as AnyHandle | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  });
}

export async function deleteHandle(id: string): Promise<void> {
  await withStore('readwrite', (store) => {
    store.delete(id);
  });
}

export async function listHandles(): Promise<Array<{ id: string; handle: AnyHandle }>> {
  return await withStore('readonly', (store) => {
    return new Promise<Array<{ id: string; handle: AnyHandle }>>((resolve) => {
      const req = store.openCursor();
      const out: Array<{ id: string; handle: AnyHandle }> = [];
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) {
          resolve(out);
          return;
        }
        out.push({ id: String(cur.key), handle: cur.value as AnyHandle });
        cur.continue();
      };
      req.onerror = () => resolve(out);
    });
  });
}

/**
 * Ensure we still have permission to read the handle. Returns true if
 * permission is granted (now or after the user re-grants). The user MUST
 * have initiated this call from a click — browsers gate `requestPermission`
 * behind user activation.
 */
export async function ensureReadPermission(handle: AnyHandle): Promise<boolean> {
  if (typeof handle.queryPermission === 'function') {
    const state = await handle.queryPermission({ mode: 'read' });
    if (state === 'granted') return true;
    if (typeof handle.requestPermission === 'function') {
      const req = await handle.requestPermission({ mode: 'read' });
      return req === 'granted';
    }
    return false;
  }
  return true; // older browsers without the API behave as already-granted
}

let _idSeq = 1;
export function newHandleId(): string {
  return `h_${Date.now().toString(36)}_${_idSeq++}`;
}
