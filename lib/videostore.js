// Recorded videos live in IndexedDB (they are too big for the draft in chrome.storage); the draft keeps
// only their id, name and a few small frames.
const DB = 'qarator', STORE = 'videos';

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req && req.result); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

export const putVideo = (id, blob) => tx('readwrite', (s) => s.put(blob, id));
export const getVideo = (id) => tx('readonly', (s) => s.get(id));
export const deleteVideo = (id) => tx('readwrite', (s) => s.delete(id));
export const videoIds = () => tx('readonly', (s) => s.getAllKeys());

/** Remove stored videos no draft refers to any more. */
export async function pruneVideos(keep) {
  const ids = await videoIds().catch(() => []);
  for (const id of ids || []) if (!keep.includes(id)) await deleteVideo(id).catch(() => {});
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
