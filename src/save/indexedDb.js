// Browser save storage on IndexedDB (plain `vite` dev server / web build).
// Two object stores in one database: 'meta' (SaveInfo, cheap to list) and 'data' (the file bytes).
import { SaveError, checkSaveId, exactBytes, infoFromBytes, toBytes } from './saveSystem.js';

export const IDB_NAME = 'passionaris-saves';
const IDB_VERSION = 1;
const META = 'meta';
const DATA = 'data';

const request = r => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

const transactionDone = tx => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
});

const storageError = (what, e) => new SaveError('STORAGE', `Хранилище браузера: не удалось ${what}: ${e?.message ?? e}`, e);

/**
 * @param {object} [o]
 * @param {IDBFactory} [o.indexedDB=globalThis.indexedDB]  injectable for tests
 * @param {string} [o.dbName='passionaris-saves']
 */
export function createIndexedDbStorage({ indexedDB: idb = globalThis.indexedDB, dbName = IDB_NAME, clock = () => Date.now() } = {}) {
  if (!idb) throw new SaveError('STORAGE', 'IndexedDB недоступен в этом браузере');
  let dbPromise = null;
  const open = () => {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const r = idb.open(dbName, IDB_VERSION);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
          if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA);
        };
        r.onsuccess = () => {
          const db = r.result;
          db.onversionchange = () => { db.close(); dbPromise = null; };
          resolve(db);
        };
        r.onerror = () => reject(r.error);
        r.onblocked = () => reject(new Error('database is blocked by another tab'));
      }).catch(e => { dbPromise = null; throw storageError('открыть базу', e); });
    }
    return dbPromise;
  };

  return {
    kind: 'indexeddb',
    async list() {
      const db = await open();
      try {
        const tx = db.transaction(META, 'readonly');
        const all = await request(tx.objectStore(META).getAll());
        return all.sort((a, b) => b.modified - a.modified);
      } catch (e) { throw storageError('прочитать список', e); }
    },
    async save(id, bytes) {
      id = checkSaveId(id);
      const data = exactBytes(bytes); // structured clone copies the whole underlying buffer otherwise
      const info = infoFromBytes(id, data, clock());
      const db = await open();
      try {
        const tx = db.transaction([META, DATA], 'readwrite');
        const done = transactionDone(tx);
        done.catch(() => {}); // a synchronous put() error below must not leave an unhandled rejection
        tx.objectStore(DATA).put(data, id);
        tx.objectStore(META).put(info, id);
        await done; // both stores or none
        return info;
      } catch (e) {
        if (e?.name === 'QuotaExceededError') throw new SaveError('STORAGE', 'Недостаточно места в хранилище браузера для сохранения', e);
        throw storageError('записать сохранение', e);
      }
    },
    async load(id) {
      id = checkSaveId(id);
      const db = await open();
      let v;
      try {
        const tx = db.transaction(DATA, 'readonly');
        v = await request(tx.objectStore(DATA).get(id));
      } catch (e) { throw storageError('прочитать сохранение', e); }
      if (v === undefined) throw new SaveError('NOT_FOUND', `Сохранение «${id}» не найдено`);
      return toBytes(v);
    },
    async remove(id) {
      id = checkSaveId(id);
      const db = await open();
      try {
        const tx = db.transaction([META, DATA], 'readwrite');
        const done = transactionDone(tx);
        done.catch(() => {});
        const counted = request(tx.objectStore(META).count(id)); // requests run in order: count before delete
        tx.objectStore(META).delete(id);
        tx.objectStore(DATA).delete(id);
        const [existed] = await Promise.all([counted, done]);
        return existed > 0;
      } catch (e) { throw storageError('удалить сохранение', e); }
    },
    /** Close the connection (tests, page unload). */
    async close() {
      if (dbPromise) { const db = await dbPromise.catch(() => null); db?.close(); dbPromise = null; }
    },
  };
}
