// Recorded videos live in IndexedDB (they are too big for the draft in chrome.storage); the draft keeps
// only their id, name and a few small frames. The "media" store keeps the screenshots and video list of
// each Recent reports entry, so exports from history still have their pictures.
const DB = 'qarator', VIDEOS = 'videos', MEDIA = 'media';

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      for (const name of [VIDEOS, MEDIA]) if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('The video store is busy in another QArator window. Close it and try again.'));
  });
}
async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    let t, req;
    try { t = db.transaction(store, mode); req = fn(t.objectStore(store)); }
    catch (e) { db.close(); reject(e); return; }
    t.oncomplete = () => { db.close(); resolve(req && req.result); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error || new Error('Storage was full or unavailable.')); };
  });
}

export const putVideo = (id, blob) => tx(VIDEOS, 'readwrite', (s) => s.put(blob, id));
export const getVideo = (id) => tx(VIDEOS, 'readonly', (s) => s.get(id));
export const deleteVideo = (id) => tx(VIDEOS, 'readwrite', (s) => s.delete(id));
export const videoIds = () => tx(VIDEOS, 'readonly', (s) => s.getAllKeys());

export const putMedia = (id, media) => tx(MEDIA, 'readwrite', (s) => s.put(media, String(id)));
export const getMedia = (id) => tx(MEDIA, 'readonly', (s) => s.get(String(id)));
export const deleteMedia = (id) => tx(MEDIA, 'readwrite', (s) => s.delete(String(id)));
export const mediaIds = () => tx(MEDIA, 'readonly', (s) => s.getAllKeys());
export const allMedia = () => tx(MEDIA, 'readonly', (s) => s.getAll());

/** Remove stored videos nothing refers to any more. */
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
