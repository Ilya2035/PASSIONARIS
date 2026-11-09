// Save storage tests (memory, IndexedDB with a small fake, Electron main-process folder + renderer adapter):
//   tools/node/node.exe --test tests/save-storage.test.mjs
// Temporary files live in tests/.tmp-save-<pid>-<rand>/ inside the project and are removed afterwards.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { encodeSave, decodeSave, saveGame, loadGame, SaveError } from '../src/save/saveSystem.js';
import { createMemoryStorage } from '../src/save/memory.js';
import { createIndexedDbStorage } from '../src/save/indexedDb.js';
import { createElectronStorage } from '../src/save/electron.js';

const require = createRequire(import.meta.url);
const { registerSaveIpc, checkId } = require('../electron/saves.cjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(HERE, `.tmp-save-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const isCode = c => e => e instanceof SaveError && e.code === c;
const makeSave = (name, t, n = 1000) => encodeSave({
  meta: { name, t }, sections: { grid: new Uint16Array(n).map((_, i) => i * 3), clock: { ticks: t * 24 } }, gameVersion: '0.1.3',
});

async function exerciseStorage(storage) {
  assert.deepEqual(await storage.list(), []);
  const a = await makeSave('Первый', 100);
  const b = await makeSave('Второй', 200);
  const infoA = await storage.save('slot-a', a);
  assert.equal(infoA.id, 'slot-a');
  assert.equal(infoA.meta.name, 'Первый');
  assert.equal(infoA.size, a.length);
  assert.equal(infoA.gameVersion, '0.1.3');
  await new Promise(r => setTimeout(r, 5)); // distinct modified times
  await storage.save('Мой мир', b);
  const list = await storage.list();
  assert.deepEqual(list.map(s => s.id), ['Мой мир', 'slot-a'], 'newest first');
  assert.equal(list[0].meta.dateLabel, '20 июля 5000 г. до н.э.'); // t = 200 days after -4999-01-01

  const back = await storage.load('slot-a');
  assert.ok(back instanceof Uint8Array);
  assert.deepEqual(back, a);
  const save = await decodeSave(back);
  assert.equal(save.sections.grid[10], 30);

  // overwrite in place
  await storage.save('slot-a', await makeSave('Первый (новый)', 300));
  const list2 = await storage.list();
  assert.equal(list2.length, 2);
  assert.equal(list2.find(s => s.id === 'slot-a').meta.name, 'Первый (новый)');

  // high-level helpers
  await saveGame(storage, 'helper', { meta: { t: 5 }, sections: { x: new Float64Array([1.25]) } });
  const g = await loadGame(storage, 'helper');
  assert.equal(g.sections.x[0], 1.25);

  assert.equal(await storage.remove('slot-a'), true);
  assert.equal(await storage.remove('slot-a'), false);
  await assert.rejects(storage.load('slot-a'), isCode('NOT_FOUND'));
  await assert.rejects(storage.save('../escape', a), isCode('BAD_ID'));
  await assert.rejects(storage.load('a/b'), isCode('BAD_ID'));
  assert.deepEqual((await storage.list()).map(s => s.id).sort(), ['helper', 'Мой мир'].sort());
}

test('memory storage', async () => {
  await exerciseStorage(createMemoryStorage());
});

// --------------------------------------------------------------- minimal IndexedDB fake (subset used by indexedDb.js)
function createFakeIndexedDB() {
  const dbs = new Map();
  const later = fn => setTimeout(fn, 0);
  const newReq = () => ({ result: undefined, error: null, onsuccess: null, onerror: null });
  function makeDb(rec) {
    return {
      objectStoreNames: { contains: n => rec.stores.has(n) },
      createObjectStore(n) { rec.stores.set(n, new Map()); },
      close() {},
      transaction(names, mode) {
        names = [].concat(names);
        const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
        const staged = []; // writes become visible at commit → atomic across stores
        let pending = 0;
        const finish = () => {
          if (pending > 0) return later(finish);
          for (const w of staged) w();
          tx.oncomplete?.();
        };
        later(finish);
        const op = fn => {
          const r = newReq();
          pending++;
          later(() => { r.result = fn(); pending--; r.onsuccess?.(); });
          return r;
        };
        tx.objectStore = n => {
          if (!names.includes(n)) throw new Error(`NotFoundError: ${n}`);
          const store = rec.stores.get(n);
          const write = () => { if (mode !== 'readwrite') throw new Error('ReadOnlyError'); };
          return {
            put(v, k) { write(); const val = structuredClone(v); staged.push(() => store.set(k, val)); return op(() => k); },
            delete(k) { write(); staged.push(() => store.delete(k)); return op(() => undefined); },
            get: k => op(() => structuredClone(store.get(k))),
            getAll: () => op(() => [...store.values()].map(v => structuredClone(v))),
            count: k => op(() => (store.has(k) ? 1 : 0)),
          };
        };
        return tx;
      },
    };
  }
  return {
    open(name, version) {
      const r = { ...newReq(), onupgradeneeded: null, onblocked: null };
      later(() => {
        let rec = dbs.get(name);
        const upgrade = !rec || rec.version < version;
        if (!rec) { rec = { version, stores: new Map() }; dbs.set(name, rec); }
        r.result = makeDb(rec);
        if (upgrade) { rec.version = version; r.onupgradeneeded?.(); }
        r.onsuccess?.();
      });
      return r;
    },
  };
}

test('IndexedDB storage (fake IDBFactory)', async () => {
  const idb = createFakeIndexedDB();
  const storage = createIndexedDbStorage({ indexedDB: idb, dbName: 'test-saves' });
  await exerciseStorage(storage);
  // a second instance sees the same database
  const again = createIndexedDbStorage({ indexedDB: idb, dbName: 'test-saves' });
  assert.equal((await again.list()).length, 2);
  // a view into a bigger buffer is stored tightly
  const bytes = await makeSave('view', 1);
  const padded = new Uint8Array(bytes.length + 100);
  padded.set(bytes, 50);
  await again.save('view', padded.subarray(50, 50 + bytes.length));
  assert.equal((await again.load('view')).buffer.byteLength, bytes.length);
  await storage.close();
  assert.throws(() => createIndexedDbStorage({ indexedDB: null }), isCode('STORAGE'));
});

// --------------------------------------------------------------- Electron: main-process folder via fake ipcMain
function fakeElectron(userData, opts) {
  const handlers = new Map();
  const ipcMain = { handle: (ch, fn) => { assert.ok(!handlers.has(ch)); handlers.set(ch, fn); } };
  const app = { getPath: k => { assert.equal(k, 'userData'); return userData; } };
  const folder = registerSaveIpc(ipcMain, app, opts);
  // ipcRenderer.invoke semantics: structured clone both ways, errors wrapped into a new Error message
  const invoke = async (ch, ...args) => {
    const fn = handlers.get(ch);
    if (!fn) throw new Error(`No handler registered for '${ch}'`);
    try {
      return structuredClone(await fn({ sender: {} }, ...structuredClone(args)));
    } catch (e) {
      throw new Error(`Error invoking remote method '${ch}': ${e}`);
    }
  };
  const bridge = {
    list: () => invoke('saves:list'),
    save: (id, bytes) => invoke('saves:save', id, bytes),
    load: id => invoke('saves:load', id),
    remove: id => invoke('saves:remove', id),
  };
  return { handlers, folder, invoke, bridge };
}

test('Electron saves: IPC handlers + renderer adapter, atomic files in userData/saves', async () => {
  const userData = path.join(TMP, 'userData');
  const { folder, bridge, invoke } = fakeElectron(userData);
  assert.equal(folder.dir, path.join(userData, 'saves'));
  const storage = createElectronStorage({ bridge });
  await exerciseStorage(storage);

  const files = fs.readdirSync(folder.dir).sort();
  assert.deepEqual(files, ['helper.psav', 'Мой мир.psav'].sort(), 'only final files, no temp leftovers');

  // the main side validates ids on its own (bypassing the renderer check)
  const a = await makeSave('x', 1);
  for (const bad of ['../evil', '..\\evil', 'a/b', 'CON', 'nul.txt', '', 'x.', '.hidden', 'C:\\Windows\\x']) {
    await assert.rejects(invoke('saves:save', bad, a), /\[BAD_ID\]/, JSON.stringify(bad));
    await assert.rejects(invoke('saves:load', bad), /\[BAD_ID\]/);
    await assert.rejects(invoke('saves:remove', bad), /\[BAD_ID\]/);
  }
  assert.ok(!fs.existsSync(path.join(userData, 'evil.psav')));
  assert.ok(!fs.existsSync(path.join(TMP, 'evil.psav')));
  assert.deepEqual(checkId('autosave-3'), 'autosave-3');

  // refuses to store bytes that are not a complete save
  await assert.rejects(storage.save('junk', new Uint8Array([1, 2, 3, 4])), isCode('BAD_MAGIC'));
  await assert.rejects(storage.save('cut', a.subarray(0, a.length - 1)), isCode('CORRUPT'));
  assert.ok(!fs.existsSync(path.join(folder.dir, 'junk.psav')));

  // unreadable files show up with an error instead of breaking the list
  fs.writeFileSync(path.join(folder.dir, 'broken.psav'), 'not a save');
  const list = await storage.list();
  const broken = list.find(s => s.id === 'broken');
  assert.ok(broken && typeof broken.error === 'string');
  assert.equal(list.filter(s => !s.error).length, 2);
  fs.unlinkSync(path.join(folder.dir, 'broken.psav'));

  // stale temp files from a crash are cleaned on list(); fresh ones are left alone
  const stale = path.join(folder.dir, '.slot.psav.999.abcdef.tmp');
  const fresh = path.join(folder.dir, '.slot.psav.999.fedcba.tmp');
  fs.writeFileSync(stale, 'x'); fs.writeFileSync(fresh, 'x');
  const old = new Date(Date.now() - 3600e3);
  fs.utimesSync(stale, old, old);
  await storage.list();
  assert.ok(!fs.existsSync(stale));
  assert.ok(fs.existsSync(fresh));
  fs.unlinkSync(fresh);

  // errors from the main process keep their codes in the renderer
  await assert.rejects(storage.load('nothing-here'), e => e instanceof SaveError && e.code === 'NOT_FOUND' && /nothing-here/.test(e.message));
});

test('Electron saves: concurrent writes to one slot stay consistent; optional trashItem', async () => {
  const trashed = [];
  const { bridge, folder } = fakeElectron(path.join(TMP, 'userData2'), {
    trashItem: async p => { trashed.push(path.basename(p)); fs.unlinkSync(p); },
  });
  const storage = createElectronStorage({ bridge });
  const saves = await Promise.all([1, 2, 3, 4, 5].map(i => makeSave(`v${i}`, i, 20000)));
  await Promise.all(saves.map(b => storage.save('race', b)));
  const back = await storage.load('race');
  assert.ok(saves.some(s => Buffer.compare(Buffer.from(s), Buffer.from(back)) === 0), 'one complete version wins');
  await decodeSave(back);
  assert.deepEqual(fs.readdirSync(folder.dir), ['race.psav']);
  assert.equal(await storage.remove('race'), true);
  assert.deepEqual(trashed, ['race.psav']);
  assert.throws(() => createElectronStorage({ bridge: null }), isCode('STORAGE'));
});

// ---- regressions found by the verifier
test('loadGame returns independent typed arrays by default (safe to keep, post or transfer)', async () => {
  const storage = createMemoryStorage();
  await saveGame(storage, 'w', { meta: { t: 1 }, sections: { big: new Uint8Array(1 << 16).fill(1), small: new Float32Array([2]) } });
  const s = await loadGame(storage, 'w');
  assert.equal(s.sections.small.buffer.byteLength, 4, 'a small section does not pin the whole payload');
  assert.notEqual(s.sections.small.buffer, s.sections.big.buffer);
  structuredClone(s.sections.big, { transfer: [s.sections.big.buffer] }); // detaching one section…
  assert.equal(s.sections.small[0], 2, '…leaves the others intact');
  const v = await loadGame(storage, 'w', { copy: false });
  assert.equal(v.sections.small.buffer, v.sections.big.buffer, 'zero-copy views on request');
});

test('Electron saves: files with names outside the id rules are listed as unreadable', async () => {
  const { bridge, folder } = fakeElectron(path.join(TMP, 'userData3'));
  const storage = createElectronStorage({ bridge });
  await storage.save('good', await makeSave('ok', 1));
  fs.writeFileSync(path.join(folder.dir, 'bad name!.psav'), fs.readFileSync(path.join(folder.dir, 'good.psav')));
  const list = await storage.list();
  assert.equal(list.find(s => s.id === 'good').error, undefined);
  const bad = list.find(s => s.id === 'bad name!');
  assert.ok(bad && /BAD_ID/.test(bad.error), JSON.stringify(bad));
});
