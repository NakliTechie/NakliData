// Shared IndexedDB connection + object-store schema. Both `handles.ts`
// (FSA handle persistence) and `idb-kv.ts` (settings + future session
// state) open this DB; centralizing the schema avoids version conflicts.

const DB_NAME = 'naklidata';
const DB_VERSION = 2;
export const HANDLES_STORE = 'fsa-handles';
export const KV_STORE = 'kv';

export function openNakliDataDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HANDLES_STORE)) db.createObjectStore(HANDLES_STORE);
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => T | Promise<T>,
): Promise<T> {
  const db = await openNakliDataDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
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

// Generic kv helpers over KV_STORE — used by settings + future session
// state. Both `handles.ts` and consumers of these helpers share one DB
// connection so version-upgrade logic stays in one place.

export async function kvGet<T>(key: string): Promise<T | null> {
  return await withStore(KV_STORE, 'readonly', (store) => {
    return new Promise<T | null>((resolve) => {
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  });
}

export async function kvPut(key: string, value: unknown): Promise<void> {
  await withStore(KV_STORE, 'readwrite', (store) => {
    store.put(value, key);
  });
}

export async function kvDelete(key: string): Promise<void> {
  await withStore(KV_STORE, 'readwrite', (store) => {
    store.delete(key);
  });
}
