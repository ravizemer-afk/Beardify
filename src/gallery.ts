// Saved recordings, kept on the device in IndexedDB.

export type Clip = {
  id: string;
  created: number;
  duration: number;
  style: string;
  color: string;
  video: Blob;
  thumb: Blob;
};

const DB = 'beard-ar';
const STORE = 'clips';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const saveClip = (clip: Clip) => tx('readwrite', (s) => s.put(clip));
export const deleteClip = (id: string) => tx('readwrite', (s) => s.delete(id));
export const listClips = async () =>
  ((await tx('readonly', (s) => s.getAll())) as Clip[]).sort((a, b) => b.created - a.created);

export function fileExtension(type: string) {
  return type.includes('mp4') ? 'mp4' : 'webm';
}
