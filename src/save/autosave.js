// Autosave: every N real minutes into a ring of K slots 'autosave-1' … 'autosave-K'.
//
// Never blocks the frame: tick() is a number comparison; the snapshot (collect + copy of binary sections) is one
// synchronous step, and compression/storage then run asynchronously with yields (see saveSystem.js).
// Only one autosave runs at a time; a tick during a running save is ignored.
import { saveGame, checkSaveId, SaveError } from './saveSystem.js';

const defaultNow = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());

function copyBinary(v) {
  if (v instanceof DataView) return new DataView(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
  if (ArrayBuffer.isView(v)) return v.slice();
  const tag = Object.prototype.toString.call(v);
  if (tag === '[object ArrayBuffer]' || tag === '[object SharedArrayBuffer]') return v.slice(0); // a worker may write into shared memory
  return v; // JSON values are serialised synchronously by encodeSave, no copy needed
}

/** fn() → its value, or null when it fails, gives no data:image URL or takes longer than ms. */
export async function withTimeout(fn, ms) {
  let timer = 0;
  try {
    // fn is called at once (not in a microtask): a map snapshot then waits for the frame being drawn now
    const v = await Promise.race([new Promise(r => r(fn())), new Promise(r => { timer = setTimeout(() => r(null), ms); })]);
    return typeof v === 'string' && v.startsWith('data:image/') ? v : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

/** Copy every binary section so the sim can keep mutating its arrays while the save is compressed. */
export function snapshotSections(sections) {
  if (!sections) return sections;
  if (sections instanceof Map) return new Map([...sections].map(([k, v]) => [k, copyBinary(v)]));
  if (Array.isArray(sections)) return sections.map(s => ({ ...s, data: copyBinary(s.data) }));
  const out = {};
  for (const k of Object.keys(sections)) out[k] = copyBinary(sections[k]);
  return out;
}

/**
 * @param {object} o
 * @param {object}   o.storage               storage adapter (indexedDb.js / electron.js / memory.js)
 * @param {Function} o.collect               () => {meta: {t, …}, sections} (sync preferred; may return a promise)
 * @param {number}   [o.intervalMinutes=5]   real minutes between autosaves (0 or less = disabled)
 * @param {number}   [o.slots=3]             ring size
 * @param {string}   [o.prefix='autosave']   slot ids are `${prefix}-1..N`
 * @param {Function} [o.getGameTime]         () => t; if unchanged since the last autosave (paused game), skip
 * @param {boolean}  [o.copy=true]           snapshot binary sections before the async part
 * @param {object}   [o.encodeOptions]       passed to encodeSave (gameVersion, budgetMs, …)
 * @param {Function} [o.onSaved]             (info, id) => void
 * @param {Function} [o.onError]             (error) => void   (default: console.warn)
 * @param {Function} [o.now]                 ms clock (default performance.now); injectable for tests
 * @param {string}   [o.name='Автосохранение'] display name prefix
 * @param {Function} [o.thumbnail]           () => Promise<string|null>: meta.thumbnail (a data:image/… URL), asked
 *                                           after the snapshot; null, an error or no answer in time = no thumbnail
 * @param {number}   [o.thumbnailTimeoutMs=3000]
 */
export function createAutosave({ storage, collect, intervalMinutes = 5, slots = 3, prefix = 'autosave',
  getGameTime = null, copy = true, encodeOptions = {}, onSaved = null, onError = null, now = defaultNow,
  name = 'Автосохранение', thumbnail = null, thumbnailTimeoutMs = 3000 } = {}) {
  if (!storage || typeof storage.save !== 'function') throw new TypeError('createAutosave: storage is required');
  if (typeof collect !== 'function') throw new TypeError('createAutosave: collect() is required');
  checkSaveId(`${prefix}-1`);

  let intervalMs = Math.max(0, intervalMinutes) * 60000;
  let ring = Math.max(1, Math.floor(slots));
  let next = 1;
  let lastAt = now();
  let lastSavedT = NaN;
  let busy = null;
  let timer = null;
  let enabled = true;
  let count = 0;

  const slotId = k => `${prefix}-${k}`;
  const escaped = prefix.replace(/[.*+?^$()|[\]{}\\-]/g, ch => '\\' + ch);
  const slotRe = new RegExp('^' + escaped + '-(\\d+)$');

  /** Start an autosave now (or return the running one). Resolves to SaveInfo, or null on failure. */
  function saveNow() {
    if (busy) return busy;
    const k = next;
    const id = slotId(k);
    const run = async () => {
      try {
        // snapshot: synchronous collect + copy, before the first await
        let data = collect();
        if (data && typeof data.then === 'function') data = await data;
        if (!data || !data.meta) throw new SaveError('BAD_INPUT', 'Автосохранение: collect() должен вернуть {meta, sections}');
        const sections = copy ? snapshotSections(data.sections) : data.sections;
        const thumb = thumbnail ? await withTimeout(thumbnail, thumbnailTimeoutMs) : null;
        const meta = { ...data.meta, ...(thumb ? { thumbnail: thumb } : {}), name: `${name} ${k}`, autosave: true, slot: k };
        const info = await saveGame(storage, id, { meta, sections }, encodeOptions);
        next = (k % ring) + 1;
        lastSavedT = meta.t;
        lastAt = now();
        count++;
        onSaved?.(info, id);
        return info;
      } catch (e) {
        lastAt = now(); // retry after a full interval, not every frame
        if (onError) onError(e); else console.warn('[autosave]', e);
        return null;
      }
    };
    // .finally runs asynchronously, so `busy` is cleared even when collect() throws synchronously
    const p = run().finally(() => { if (busy === p) busy = null; });
    busy = p;
    return p;
  }

  /** Call once per frame (or let start() poll). Returns true if an autosave was started. */
  function tick(t = now()) {
    if (!enabled || busy || intervalMs <= 0 || t - lastAt < intervalMs) return false;
    if (getGameTime && getGameTime() === lastSavedT) { lastAt = t; return false; } // paused: nothing new
    saveNow();
    return true;
  }

  return {
    tick,
    saveNow,
    /** Continue the ring after the newest existing autosave (call once after the storage is ready). */
    async init() {
      try {
        const list = await storage.list();
        let best = null;
        for (const s of list) {
          const m = slotRe.exec(s.id);
          const n = m ? Number(m[1]) : 0;
          if (n < 1 || n > ring || s.error) continue;
          const at = Date.parse(s.meta?.created) || s.modified || 0;
          if (!best || at > best.at) best = { n, at };
        }
        next = best ? (best.n % ring) + 1 : 1;
      } catch (e) {
        if (onError) onError(e); else console.warn('[autosave]', e);
      }
      return next;
    },
    /** Poll with a timer instead of calling tick() from the frame loop. */
    start(pollMs = 1000) { if (!timer) timer = setInterval(() => tick(), pollMs); },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
    /** Restart the countdown (e.g. after loading or a manual save). */
    reset(t = now()) { lastAt = t; },
    setIntervalMinutes(m) { intervalMs = Math.max(0, m) * 60000; },
    setSlots(n) { ring = Math.max(1, Math.floor(n)); if (next > ring) next = 1; },
    setEnabled(v) { enabled = !!v; },
    get enabled() { return enabled; },
    get busy() { return !!busy; },
    get nextSlotId() { return slotId(next); },
    get slots() { return ring; },
    get intervalMinutes() { return intervalMs / 60000; },
    get count() { return count; },
    /** ms until the next autosave check fires (for a HUD hint). */
    remainingMs(t = now()) { return Math.max(0, intervalMs - (t - lastAt)); },
  };
}
