// Save thumbnails (meta.thumbnail): written with every save when the game has a picture, optional for loading,
// shown by the launcher (a placeholder when there is none): tools/node/node.exe --test tests/save-thumbnail.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSave, readSaveHeader, saveGame, loadGame } from '../src/save/saveSystem.js';
import { createAutosave, withTimeout } from '../src/save/autosave.js';
import { createMemoryStorage } from '../src/save/memory.js';
import { describeSave } from '../src/launcher/saves.js';

// a real 1×1 JPEG
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

test('a save with a thumbnail: the header carries it, the launcher shows it, the game loads it', async () => {
  const storage = createMemoryStorage();
  const sections = { clock: { t: 12.5 }, snow: new Uint8Array([1, 2, 3]) };
  await saveGame(storage, 'with-thumb', { meta: { t: 12.5, name: 'С картинкой', thumbnail: JPEG }, sections }, { gameVersion: 't' });
  const [info] = await storage.list();
  assert.equal(info.meta.thumbnail, JPEG);
  const d = describeSave(info);
  assert.equal(d.thumbnail, JPEG);
  assert.equal(d.name, 'С картинкой');
  const s = await loadGame(storage, 'with-thumb');
  assert.deepEqual([...s.sections.snow], [1, 2, 3]);
  assert.equal(s.meta.thumbnail, JPEG);
});

test('a save without a thumbnail (older versions, a minimised window) loads; the launcher gets no picture', async () => {
  const storage = createMemoryStorage();
  await saveGame(storage, 'old', { meta: { t: 3, name: 'Старое' }, sections: { clock: { t: 3 } } }, { gameVersion: '0.2.0' });
  const [info] = await storage.list();
  assert.equal(info.meta.thumbnail, undefined);
  assert.equal(describeSave(info).thumbnail, null);
  assert.equal((await loadGame(storage, 'old')).sections.clock.t, 3);
  // a thumbnail that is not a picture is not shown
  const bytes = await encodeSave({ meta: { t: 1, thumbnail: 'data:image/svg+xml;base64,PHN2Zz4=' }, sections: {} });
  assert.equal(describeSave({ id: 'x', meta: readSaveHeader(bytes).meta }).thumbnail, null);
  // an unreadable file: a placeholder, never a picture
  assert.equal(describeSave({ id: 'bad', error: 'CORRUPT' }).thumbnail, null);
});

test('autosave asks for a thumbnail after taking the state, and saves without one when there is none', async () => {
  const snow = new Uint8Array(16);
  let t = 1;
  const collect = () => ({ meta: { t }, sections: { snow } });
  const run = async thumbnail => {
    const storage = createMemoryStorage();
    const auto = createAutosave({ storage, collect, thumbnail, thumbnailTimeoutMs: 80, encodeOptions: { gameVersion: 't' }, onError: e => { throw e; } });
    const info = await auto.saveNow();
    assert.ok(info, 'saved');
    return { info, storage };
  };
  // a picture comes a frame later; the sim moves on meanwhile — the save keeps the state it took
  let r = await run(() => new Promise(res => setTimeout(() => { snow.fill(9); t = 2; res(JPEG); }, 10)));
  assert.equal(r.info.meta.thumbnail, JPEG);
  assert.equal(r.info.meta.t, 1);
  assert.deepEqual([...(await loadGame(r.storage, 'autosave-1')).sections.snow], new Array(16).fill(0));
  assert.equal(describeSave(r.info).kind, 'auto');
  assert.equal(describeSave(r.info).thumbnail, JPEG);
  // no picture, a failure, a hang, something that is not a picture: saved all the same, without a thumbnail
  for (const fn of [() => null, () => { throw new Error('no canvas'); }, () => Promise.reject(new Error('lost')), () => new Promise(() => {}), () => 'not a picture']) {
    r = await run(fn);
    assert.equal(r.info.meta.thumbnail, undefined);
  }
  // and without the option at all (as before)
  r = await run(null);
  assert.equal(r.info.meta.thumbnail, undefined);
});

test('withTimeout: the value of a data:image URL in time, null otherwise', async () => {
  assert.equal(await withTimeout(() => JPEG, 50), JPEG);
  assert.equal(await withTimeout(() => Promise.resolve(JPEG), 50), JPEG);
  assert.equal(await withTimeout(() => new Promise(r => setTimeout(() => r(JPEG), 200)), 20), null);
  assert.equal(await withTimeout(() => { throw new Error('x'); }, 50), null);
  assert.equal(await withTimeout(() => 42, 50), null);
  // the function is called at once, not a microtask later (the snapshot must wait for the frame being drawn now)
  let called = false;
  const p = withTimeout(() => { called = true; return JPEG; }, 50);
  assert.equal(called, true);
  await p;
});
