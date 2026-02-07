import type { Snapshot } from "./snapshot";

const DB_NAME = "mazemaze-piggy-bank";
const DB_VERSION = 1;
const STORE_NAME = "snapshot";

export type CachedSnapshot = {
  key: string;
  snapshot: Snapshot;
  etag: string | null;
  cachedAt: string;
};

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export const readSnapshotCache = async (key: string): Promise<CachedSnapshot | null> => {
  if (typeof indexedDB === "undefined") {
    return null;
  }
  const db = await openDatabase();
  return new Promise<CachedSnapshot | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => resolve((request.result as CachedSnapshot | undefined) ?? null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onabort = () => db.close();
    tx.onerror = () => db.close();
  });
};

export const writeSnapshotCache = async (record: CachedSnapshot): Promise<void> => {
  if (typeof indexedDB === "undefined") {
    return;
  }
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onabort = () => db.close();
    tx.onerror = () => db.close();
  });
};

export const clearSnapshotCache = async (): Promise<void> => {
  if (typeof indexedDB === "undefined") {
    return;
  }
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onabort = () => db.close();
    tx.onerror = () => db.close();
  });
};
