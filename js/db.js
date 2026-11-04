// JourneyMan — IndexedDB storage. Everything stays in this browser on this Mac.

const DB_NAME = 'journeyman';
const DB_VERSION = 1;
const STORES = ['areas', 'projects', 'tasks', 'meta'];

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Storage is blocked by another JourneyMan tab.'));
  });
}

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

const getAll = (db, name) => new Promise((resolve, reject) => {
  const req = db.transaction(name).objectStore(name).getAll();
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/*
  Returns { data, save, remove, replaceAll, ok }. If IndexedDB can't be opened
  (private window, blocked storage), it works in memory and ok is false.
*/
export async function openStorage() {
  let db;
  try {
    db = await open();
  } catch (err) {
    console.warn('JourneyMan: storage unavailable, working in memory only.', err);
    return { ok: false, error: err, data: {}, save() {}, remove() {}, async replaceAll() {} };
  }
  const [areas, projects, tasks, meta] = await Promise.all(STORES.map((s) => getAll(db, s)));
  const settings = meta.find((m) => m.id === 'settings');
  if (settings) delete settings.id;

  const onError = (err) => console.error('JourneyMan: could not save.', err);
  return {
    ok: true,
    data: { areas, projects, tasks, settings },
    save(store, record) {
      try {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(record);
        done(tx).catch(onError);
      } catch (err) { onError(err); }
    },
    remove(store, id) {
      try {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(id);
        done(tx).catch(onError);
      } catch (err) { onError(err); }
    },
    /* Wipes everything and writes `data` (used by Import). */
    async replaceAll(data) {
      const tx = db.transaction(STORES, 'readwrite');
      for (const s of STORES) tx.objectStore(s).clear();
      for (const s of ['areas', 'projects', 'tasks']) for (const rec of data[s] || []) tx.objectStore(s).put(rec);
      tx.objectStore('meta').put({ id: 'settings', ...(data.settings || {}) });
      await done(tx);
    },
  };
}
