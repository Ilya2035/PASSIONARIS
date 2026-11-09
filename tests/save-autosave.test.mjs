// Autosave tests: tools/node/node.exe --test tests/save-autosave.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAutosave, snapshotSections } from '../src/save/autosave.js';
import { decodeSave, infoFromBytes } from '../src/save/saveSystem.js';
import { createClock } from '../src/sim/clock.js';

// Fake storage: records calls, optional delay to simulate slow disks.
function fakeStorage({ delayMs = 0, failOnce = false } = {}) {
  const files = new Map();
  const calls = [];
  let modified = 1000;
  let fail = failOnce;
  return {
    files, calls,
    async list() { return [...files.values()].map(f => f.info).sort((a, b) => b.modified - a.modified); },
    async save(id, bytes) {
      calls.push(id);
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
      if (fail) { fail = false; throw new Error('disk full'); }
      const info = infoFromBytes(id, bytes, modified++);
      files.set(id, { bytes, info });
      return info;
    },
    async load(id) { return files.get(id).bytes; },
    async remove(id) { return files.delete(id); },
  };
}

function game() {
  const clock = createClock({ t0: 0, paused: false, speed: 5 });
  const snow = new Uint8Array(1024);
  return {
    clock, snow,
    collect: () => ({ meta: { t: clock.t }, sections: { clock: clock.serialize(), snow } }),
    play(seconds) { for (let i = 0; i < seconds * 10; i++) { clock.advance(0.1); snow[i % snow.length]++; } },
  };
}

test('ring rotation autosave-1..N on the interval', async () => {
  const storage = fakeStorage();
  const g = game();
  let now = 0;
  const saved = [];
  const auto = createAutosave({
    storage, collect: g.collect, intervalMinutes: 5, slots: 3, now: () => now,
    getGameTime: () => g.clock.t, onSaved: (info, id) => saved.push(id), encodeOptions: { gameVersion: 't' },
  });
  assert.equal(auto.nextSlotId, 'autosave-1');
  for (let minute = 1; minute <= 26; minute++) {
    now = minute * 60000;
    g.play(1);
    if (auto.tick()) await auto.saveNow(); // saveNow() while busy returns the running save
  }
  assert.deepEqual(saved, ['autosave-1', 'autosave-2', 'autosave-3', 'autosave-1', 'autosave-2']);
  assert.deepEqual([...storage.files.keys()].sort(), ['autosave-1', 'autosave-2', 'autosave-3']);
  assert.equal(auto.nextSlotId, 'autosave-3');
  assert.equal(auto.count, 5);
  const info = storage.files.get('autosave-2').info;
  assert.equal(info.meta.name, 'Автосохранение 2');
  assert.equal(info.meta.autosave, true);
  assert.equal(info.meta.slot, 2);
  const s = await decodeSave(storage.files.get('autosave-2').bytes);
  assert.equal(s.sections.clock.ticks, Math.round(info.meta.t * 24));
});

test('tick never blocks: it only starts the async save, and skips while busy', async () => {
  const storage = fakeStorage({ delayMs: 30 });
  const g = game();
  let now = 0;
  const auto = createAutosave({ storage, collect: g.collect, intervalMinutes: 1, slots: 2, now: () => now });
  now = 60000;
  const t0 = performance.now();
  assert.equal(auto.tick(), true);
  assert.ok(performance.now() - t0 < 25, 'tick returns before the storage finishes');
  assert.equal(auto.busy, true);
  now = 200000;
  assert.equal(auto.tick(), false, 'no second save while the first runs');
  const p1 = auto.saveNow();
  const p2 = auto.saveNow();
  assert.equal(p1, p2, 'concurrent saveNow() share one save');
  await p1;
  assert.equal(auto.busy, false);
  assert.deepEqual(storage.calls, ['autosave-1']);
});

test('snapshot: the sim can mutate arrays while the save is compressed', async () => {
  const storage = fakeStorage({ delayMs: 5 });
  const snow = new Uint8Array(4096).fill(7);
  let now = 0;
  const auto = createAutosave({ storage, collect: () => ({ meta: { t: 1 }, sections: { snow } }), intervalMinutes: 1, now: () => now });
  now = 60000;
  auto.tick();
  snow.fill(99); // the next frame changes the world
  await auto.saveNow();
  const s = await decodeSave(storage.files.get('autosave-1').bytes);
  assert.ok(s.sections.snow.every(v => v === 7));
  // helper keeps types and copies buffers
  const src = { a: new Float32Array([1]), b: new ArrayBuffer(2), c: { x: 1 } };
  const copy = snapshotSections(src);
  assert.notEqual(copy.a.buffer, src.a.buffer);
  assert.ok(copy.a instanceof Float32Array);
  assert.equal(copy.c, src.c);
});

test('paused game: nothing new → no autosave; disabled / zero interval', async () => {
  const storage = fakeStorage();
  const g = game();
  let now = 0;
  const auto = createAutosave({ storage, collect: g.collect, intervalMinutes: 2, now: () => now, getGameTime: () => g.clock.t });
  now = 120000; g.play(1);
  assert.equal(auto.tick(), true); await auto.saveNow();
  g.clock.pause();
  now = 240000;
  assert.equal(auto.tick(), false, 'same game time');
  now = 480000; g.clock.resume(); g.play(1);
  assert.equal(auto.tick(), true); await auto.saveNow();
  auto.setEnabled(false);
  now = 10e6; g.play(1);
  assert.equal(auto.tick(), false);
  auto.setEnabled(true);
  auto.setIntervalMinutes(0);
  assert.equal(auto.tick(), false);
  assert.deepEqual(storage.calls, ['autosave-1', 'autosave-2']);
});

test('init() continues the ring after the newest autosave; errors are reported, not thrown', async () => {
  const storage = fakeStorage();
  const g = game();
  let now = 0;
  const first = createAutosave({ storage, collect: g.collect, slots: 4, now: () => now });
  for (let i = 0; i < 6; i++) { g.play(1); await first.saveNow(); } // 1 2 3 4 1 2 → newest is autosave-2
  const errors = [];
  const second = createAutosave({ storage, collect: g.collect, slots: 4, now: () => now, onError: e => errors.push(e) });
  assert.equal(await second.init(), 3);
  assert.equal(second.nextSlotId, 'autosave-3');

  const flaky = fakeStorage({ failOnce: true });
  const third = createAutosave({ storage: flaky, collect: g.collect, now: () => now, onError: e => errors.push(e) });
  assert.equal(await third.saveNow(), null);
  assert.equal(errors.length, 1);
  assert.equal(third.nextSlotId, 'autosave-1', 'a failed save does not advance the ring');
  assert.ok(await third.saveNow());
  assert.equal(third.nextSlotId, 'autosave-2');

  const bad = createAutosave({ storage, collect: () => null, now: () => now, onError: e => errors.push(e) });
  assert.equal(await bad.saveNow(), null);
  assert.equal(errors.at(-1).code, 'BAD_INPUT');
  assert.equal(bad.busy, false, 'a synchronous collect() failure does not leave the autosave stuck');
  const throwing = createAutosave({ storage, collect: () => { throw new Error('sim not ready'); }, now: () => now, onError: e => errors.push(e) });
  const before = errors.length;
  assert.equal(await throwing.saveNow(), null);
  assert.equal(await throwing.saveNow(), null);
  assert.equal(errors.length, before + 2);
  assert.throws(() => createAutosave({ storage, collect: g.collect, prefix: '../x' }), e => e.code === 'BAD_ID');
});

// ---- regressions found by the verifier
test('snapshot copies SharedArrayBuffer sections too (a worker may keep writing into them)', () => {
  const sab = new SharedArrayBuffer(8);
  const shared = new Int32Array(sab).fill(5);
  const copy = snapshotSections({ raw: sab, view: shared });
  new Int32Array(sab).fill(9);
  assert.deepEqual([...new Int32Array(copy.raw)], [5, 5]);
  assert.deepEqual([...copy.view], [5, 5]);
});
