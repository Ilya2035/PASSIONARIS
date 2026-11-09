// Save format tests: tools/node/node.exe --test tests/save-format.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import {
  encodeSave, decodeSave, readSaveHeader, SaveError, MigrationRegistry, FORMAT_VERSION, HEADER_SIZE,
  SaveRegistry, packState, unpackState, checkSaveId, slugSaveId, crc32, DTYPES,
} from '../src/save/saveSystem.js';
import { createClock } from '../src/sim/clock.js';
import { fromDate } from '../src/sim/calendar.js';

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mixedSections() {
  const rnd = mulberry32(42);
  const grid = new Uint8Array(720 * 360 * 4);            // weather-like grid, compressible
  for (let i = 0; i < grid.length; i++) grid[i] = (i >> 9) & 0xff;
  const temps = new Float32Array(1001).map((_, i) => Math.sin(i) * 30);
  const noise = new Uint32Array(4096).map(() => (rnd() * 2 ** 32) >>> 0);
  const big = new BigInt64Array([1n, -2n, 2n ** 62n, -(2n ** 63n)]);
  const raw = new Uint8Array([1, 2, 3, 4, 5]).buffer;
  const backing = new Int16Array(64).map((_, i) => i - 32);
  return {
    'weather/grid': grid,
    'climate/temps': temps,
    'rng/state': noise,
    'odd': new Uint8Array([9, 8, 7]),                      // 3 bytes → next section must still be aligned
    'f64': new Float64Array([Math.PI, -0, Infinity, NaN, 1e-300]),
    'i16.sub': backing.subarray(10, 20),                   // a view with byteOffset ≠ 0
    'i64': big,
    'u64': new BigUint64Array([2n ** 64n - 1n]),
    'i8': new Int8Array([-128, 127]),
    'u8c': new Uint8ClampedArray([0, 255]),
    'u16': new Uint16Array([65535]),
    'i32': new Int32Array([-1, 2 ** 31 - 1]),
    'empty': new Int32Array(0),
    'bytes': raw,
    'view': new DataView(new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer),
    'clock': { v: 1, ticks: 123456, speed: 3, paused: true, label: 'Древний мир' },
    'list': [1, 'два', null, { x: [true] }],
    'n': 7,
  };
}

const META = { name: 'Тестовый мир', t: fromDate(1066, 3, 12, 14), seed: 1234 };

test('roundtrip of mixed sections with gzip', async () => {
  const sections = mixedSections();
  const bytes = await encodeSave({ meta: META, sections, gameVersion: '0.1.3' });
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'PSAV');

  const h = readSaveHeader(bytes);
  assert.equal(h.formatVersion, FORMAT_VERSION);
  assert.equal(h.compressed, true);
  assert.equal(h.gameVersion, '0.1.3');
  assert.equal(h.meta.name, 'Тестовый мир');
  assert.equal(h.meta.t, META.t);
  assert.equal(h.meta.dateLabel, '12 марта 1066 г.');
  assert.equal(h.meta.seed, 1234);
  assert.ok(!Number.isNaN(Date.parse(h.meta.created)));
  assert.ok(h.rawLength > grid0Size(), 'raw payload holds the grid');
  assert.ok(h.payloadLength < h.rawLength / 4, `gzip compresses (${h.payloadLength} of ${h.rawLength})`);
  // the payload is plain gzip (readable by any tool)
  const raw = gunzipSync(bytes.subarray(h.payloadOffset));
  assert.equal(raw.length, h.rawLength);

  const save = await decodeSave(bytes);
  assert.equal(save.formatVersion, FORMAT_VERSION);
  assert.equal(save.gameVersion, '0.1.3');
  assert.deepEqual(save.meta, h.meta);
  assert.equal(save.migratedFrom, undefined);
  const s = save.sections;
  assert.deepEqual(Object.keys(s), Object.keys(sections));
  for (const [k, v] of Object.entries(sections)) {
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
      assert.equal(s[k].constructor, v.constructor, k);
      assert.deepEqual([...s[k]], [...v], k);
      assert.equal(s[k].byteOffset % 8, 0, `${k} is aligned`);
    }
  }
  assert.ok(Object.is(s.f64[1], -0));
  assert.ok(Number.isNaN(s.f64[3]));
  assert.ok(Object.prototype.toString.call(s.bytes) === '[object ArrayBuffer]');
  assert.deepEqual([...new Uint8Array(s.bytes)], [1, 2, 3, 4, 5]);
  assert.ok(s.view instanceof DataView);
  assert.equal(s.view.getUint32(0, false), 0xdeadbeef);
  assert.deepEqual(s.clock, sections.clock);
  assert.deepEqual(s.list, sections.list);
  assert.equal(s.n, 7);
  assert.equal(s.empty.length, 0);

  // copy: independent buffers
  const c = await decodeSave(bytes, { copy: true });
  assert.notEqual(c.sections['weather/grid'].buffer, c.sections['rng/state'].buffer);
  assert.deepEqual([...c.sections.odd], [9, 8, 7]);
});

function grid0Size() { return 720 * 360 * 4; }

test('uncompressed mode with CRC; corruption is detected', async () => {
  const bytes = await encodeSave({ meta: META, sections: { a: new Float32Array([1, 2, 3]), j: { ok: 1 } }, compress: false });
  const h = readSaveHeader(bytes);
  assert.equal(h.compressed, false);
  assert.equal(h.rawLength, h.payloadLength);
  assert.notEqual(h.crc, 0);
  const s = await decodeSave(bytes);
  assert.deepEqual([...s.sections.a], [1, 2, 3]);
  const bad = bytes.slice();
  bad[bad.length - 9] ^= 0xff;
  await assert.rejects(decodeSave(bad), e => e instanceof SaveError && e.code === 'CORRUPT');
});

test('clear errors for bad input files', async () => {
  const bytes = await encodeSave({ meta: META, sections: { grid: new Uint16Array(5000).fill(7), j: [1] } });
  const code = c => e => e instanceof SaveError && e.code === c && typeof e.message === 'string' && e.message.length > 5;

  await assert.rejects(decodeSave(new Uint8Array([1, 2])), code('TRUNCATED'));
  await assert.rejects(decodeSave(new TextEncoder().encode('PK\u0003\u0004 definitely a zip file, not a save')), code('BAD_MAGIC'));
  await assert.rejects(decodeSave(bytes.subarray(0, HEADER_SIZE + 3)), code('TRUNCATED'));
  await assert.rejects(decodeSave(bytes.subarray(0, bytes.length - 10)), code('TRUNCATED'));
  const longer = new Uint8Array(bytes.length + 3); longer.set(bytes);
  await assert.rejects(decodeSave(longer), code('CORRUPT'));

  // flip a byte in the middle of the gzip stream
  const h = readSaveHeader(bytes);
  const flipped = bytes.slice();
  flipped[h.payloadOffset + Math.floor(h.payloadLength / 2)] ^= 0x5a;
  await assert.rejects(decodeSave(flipped), e => e instanceof SaveError && e.code === 'CORRUPT');

  // broken metadata JSON
  const metaBroken = bytes.slice();
  metaBroken[HEADER_SIZE + h.gameVersion.length] = 0x7b + 1; // '{' → '|'
  assert.throws(() => readSaveHeader(metaBroken), code('CORRUPT'));

  // unknown flags
  const flags = bytes.slice();
  flags[6] |= 0x80;
  await assert.rejects(decodeSave(flags), code('UNSUPPORTED'));

  // lying raw length (zip-bomb guard)
  const bomb = bytes.slice();
  new DataView(bomb.buffer).setUint32(16, 0xfffffff0, true);
  await assert.rejects(decodeSave(bomb), code('CORRUPT'));

  // a save from the future
  const future = await encodeSave({ meta: META, sections: {}, formatVersion: FORMAT_VERSION + 4 });
  await assert.rejects(decodeSave(future), code('TOO_NEW'));
});

test('encode-side validation', async () => {
  const bad = c => e => e instanceof SaveError && e.code === c;
  await assert.rejects(encodeSave({ meta: { name: 'x' }, sections: {} }), bad('BAD_INPUT')); // no t
  await assert.rejects(encodeSave({ meta: META, sections: { 'bad name!': 1 } }), bad('BAD_INPUT'));
  await assert.rejects(encodeSave({ meta: META, sections: { __proto__x: undefined } }), bad('BAD_INPUT'));
  await assert.rejects(encodeSave({ meta: META, sections: [{ name: 'a', data: 1 }, { name: 'a', data: 2 }] }), bad('BAD_INPUT'));
  const cyclic = {}; cyclic.self = cyclic;
  await assert.rejects(encodeSave({ meta: META, sections: { c: cyclic } }), bad('BAD_INPUT'));
  await assert.rejects(encodeSave({ meta: { ...META, thumbnail: 'http://x' }, sections: {} }), bad('BAD_INPUT'));
  // Map and array forms work
  const m = await decodeSave(await encodeSave({ meta: META, sections: new Map([['a', new Uint8Array([1])]]) }));
  assert.deepEqual([...m.sections.a], [1]);
  const thumb = 'data:image/jpeg;base64,AAAA';
  const t = readSaveHeader(await encodeSave({ meta: { ...META, thumbnail: thumb }, sections: [{ name: 'b', data: 'x' }] }));
  assert.equal(t.meta.thumbnail, thumb);
  assert.ok(DTYPES.includes('f32') && DTYPES.includes('json'));
});

test('migration hook: chained steps by format version', async () => {
  const v1 = await encodeSave({ meta: META, sections: { snow: new Uint8Array([1, 2, 3]), old: { a: 1 } }, formatVersion: 1 });
  const reg = new MigrationRegistry();
  const calls = [];
  reg.register(1, (save, { from, to }) => {
    calls.push(`${from}->${to}`);
    save.sections['weather/snow'] = save.sections.snow; // rename a section
    delete save.sections.snow;
  });
  reg.register(2, async (save, { from, to }) => {
    calls.push(`${from}->${to}`);
    return { ...save, meta: { ...save.meta, upgraded: true }, sections: { ...save.sections, added: new Float32Array([0.5]) } };
  });
  const s = await decodeSave(v1, { migrations: reg, targetVersion: 3 });
  assert.deepEqual(calls, ['1->2', '2->3']);
  assert.equal(s.formatVersion, 3);
  assert.equal(s.migratedFrom, 1);
  assert.equal(s.meta.upgraded, true);
  assert.deepEqual([...s.sections['weather/snow']], [1, 2, 3]);
  assert.equal(s.sections.snow, undefined);
  assert.deepEqual([...s.sections.added], [0.5]);

  // a missing step is a clear error
  const gap = new MigrationRegistry().register(1, () => {});
  await assert.rejects(decodeSave(v1, { migrations: gap, targetVersion: 3 }), e => e.code === 'NO_MIGRATION' && /2/.test(e.message));
  // a throwing step is reported as such
  const boom = new MigrationRegistry().register(1, () => { throw new Error('boom'); });
  await assert.rejects(decodeSave(v1, { migrations: boom, targetVersion: 2 }), e => e.code === 'MIGRATION_FAILED' && e.cause?.message === 'boom');
  // duplicate registration is refused
  assert.throws(() => reg.register(1, () => {}));
  // current-version files are not touched
  const none = new MigrationRegistry().register(1, () => { throw new Error('should not run'); });
  const same = await decodeSave(v1, { migrations: none });
  assert.equal(same.formatVersion, 1);
});

test('SaveRegistry packs module states with nested typed arrays', async () => {
  const clock = createClock({ t0: fromDate(-3000, 5, 1) });
  const weather = {
    t: 42,
    grid: new Uint8Array([1, 2, 3, 4]),
    layers: { snow: new Float32Array([0.5, 1.5]), drought: [new Int16Array([-1]), new Int16Array([2])] },
    events: [{ type: 'storm', cell: 12 }],
  };
  let loadedWeather = null;
  const reg = new SaveRegistry();
  reg.register('clock', { save: () => clock.serialize(), load: s => clock.deserialize(s) });
  reg.register('weather', { save: () => weather, load: s => { loadedWeather = s; } });
  let missing = 0;
  reg.register('future', { save: () => ({ x: 1 }), load: () => {}, optional: true, onMissing: () => missing++ });
  const sections = reg.collect();
  assert.ok(sections['weather/grid'] instanceof Uint8Array);
  assert.ok(sections['weather/layers.snow'] instanceof Float32Array);
  assert.ok(sections['weather/layers.drought.1'] instanceof Int16Array);
  assert.deepEqual(sections.weather.grid, { $bin: 'weather/grid' });

  const save = await decodeSave(await encodeSave({ meta: { t: clock.t }, sections }));
  delete save.sections.future; // like an older save without this module
  clock.setTime(0);
  await reg.apply(save.sections);
  assert.equal(clock.t, fromDate(-3000, 5, 1));
  assert.equal(missing, 1);
  assert.equal(loadedWeather.t, 42);
  assert.deepEqual([...loadedWeather.grid], [1, 2, 3, 4]);
  assert.deepEqual([...loadedWeather.layers.snow], [0.5, 1.5]);
  assert.deepEqual([...loadedWeather.layers.drought[1]], [2]);
  assert.deepEqual(loadedWeather.events, weather.events);
  // required module missing → error
  delete save.sections.weather;
  await assert.rejects(reg.apply(save.sections), e => e.code === 'CORRUPT');
  // pack/unpack symmetry
  const p = packState('k', { a: [new Uint8Array([5])], b: 'x' });
  assert.deepEqual(unpackState(p.json, p.sections), { a: [new Uint8Array([5])], b: 'x' });
});

test('save ids are safe file names', () => {
  for (const ok of ['autosave-1', 'Мой мир', 'save_2 (копия)', 'v1.2', 'a']) assert.equal(checkSaveId(ok), ok);
  for (const bad of ['', '../x', '..', 'a/b', 'a\\b', 'C:x', 'CON', 'con.txt', 'nul', 'COM1', 'x.', 'x ', '.hidden',
    'a'.repeat(65), 'tab\tname', 'a..b', null, 5, 'имя:поток', 'a*b', 'a?', '<x>', '"q"', 'a|b']) {
    assert.throws(() => checkSaveId(bad), e => e.code === 'BAD_ID', JSON.stringify(bad));
  }
  assert.equal(slugSaveId('Мой мир: 1066 / Нормандия'), 'Мой мир - 1066 - Нормандия');
  assert.equal(slugSaveId('../../etc/passwd'), 'etc - passwd');
  assert.equal(slugSaveId('  Рим, 44 г. до н.э.  '), 'Рим - 44 г - до н - э');
  for (const n of ['a/../b', '....', 'x'.repeat(200), 'CON', 'Ünïcödé ✓ 🌍']) checkSaveId(slugSaveId(n));
  assert.equal(slugSaveId('***'), 'save');
  assert.equal(slugSaveId('con'), 'save-con');
});

test('crc32 reference value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('large payload: chunked async compression yields to the event loop', async () => {
  const big = new Float32Array(8 * 1024 * 1024 / 4).map((_, i) => (i % 1000) * 0.25); // 8 MB
  let ticks = 0;
  const iv = setInterval(() => ticks++, 0);
  const t0 = performance.now();
  const bytes = await encodeSave({ meta: META, sections: { big }, chunkSize: 64 * 1024, budgetMs: 2 });
  const s = await decodeSave(bytes, { chunkSize: 64 * 1024, budgetMs: 2 });
  clearInterval(iv);
  const ms = performance.now() - t0;
  assert.equal(s.sections.big.length, big.length);
  assert.equal(s.sections.big[123457], big[123457]);
  assert.ok(ticks > 0, 'timers ran while encoding/decoding');
  assert.ok(ms < 10000, `took ${ms.toFixed(0)} ms`);
});

// ---- regressions found by the verifier
test('packState never fails on key names: non-ASCII, colliding, long paths, __proto__, SharedArrayBuffer', async () => {
  let deep = { v: new Uint8Array([7]) };
  for (let i = 0; i < 40; i++) deep = { ['level' + i]: deep };
  const sab = new SharedArrayBuffer(4); new Uint8Array(sab).set([1, 2, 3, 4]);
  const state = JSON.parse('{"__proto__": {"kept": 1}}');
  Object.assign(state, {
    'снег': new Float32Array([1]), 'вода': new Float32Array([2]), // both map to '____'
    'a b': new Int8Array([3]), 'a_b': new Int8Array([4]),         // both map to 'a_b'
    ':1': new Uint8Array([5]),                                    // looks like a generated name
    deep, sab,
  });
  const reg = new SaveRegistry();
  let loaded = null;
  reg.register('m', { save: () => state, load: s => { loaded = s; } });
  const sections = reg.collect();
  for (const k of Object.keys(sections)) assert.ok(k.length <= 200, k);
  const save = await decodeSave(await encodeSave({ meta: { t: 0 }, sections }));
  await reg.apply(save.sections);
  assert.equal(loaded['снег'][0], 1);
  assert.equal(loaded['вода'][0], 2);
  assert.equal(loaded['a b'][0], 3);
  assert.equal(loaded['a_b'][0], 4);
  assert.equal(loaded[':1'][0], 5);
  let d = loaded.deep;
  for (let i = 39; i >= 0; i--) d = d['level' + i];
  assert.equal(d.v[0], 7);
  assert.deepEqual([...new Uint8Array(loaded.sab)], [1, 2, 3, 4]);
  assert.ok(Object.prototype.hasOwnProperty.call(loaded, '__proto__'), '__proto__ kept as data');
  assert.equal(loaded.__proto__.kept, 1);
  assert.equal(Object.getPrototypeOf(loaded), Object.prototype);
  assert.equal(({}).kept, undefined);
  assert.throws(() => reg.register('k'.repeat(101), { save: () => 1, load: () => {} }), e => e.code === 'BAD_INPUT');
});

test('yieldToEventLoop uses an ordinary-priority task, not scheduler.yield (which starves rendering)', async () => {
  const { yieldToEventLoop } = await import('../src/save/saveSystem.js');
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'scheduler');
  const prev = globalThis.scheduler;
  const calls = [];
  globalThis.scheduler = {
    yield: () => { calls.push('yield'); return Promise.resolve(); },
    postTask: (fn, o) => { calls.push(`postTask:${o?.priority}`); return Promise.resolve().then(fn); },
  };
  try {
    await yieldToEventLoop();
  } finally {
    if (had) globalThis.scheduler = prev; else delete globalThis.scheduler;
  }
  assert.deepEqual(calls, ['postTask:user-visible']);
});
