// Passionaris save files (owner: time-save module, see docs/ENGINE.md).
//
// Container layout, format 1 (all integers little-endian):
//
//   off  size  field
//     0     4  magic 'PSAV'
//     4     2  formatVersion (u16)                      — migrations are keyed by this number
//     6     2  flags (u16): bit0 = payload is gzip
//     8     4  metaLength (u32)                         — UTF-8 JSON bytes
//    12     4  payloadLength (u32)                      — stored payload bytes (after compression)
//    16     4  rawLength (u32)                          — uncompressed payload bytes
//    20     4  payloadCrc32 (u32)                       — CRC-32 of an uncompressed payload, 0 for gzip
//                                                         (gzip carries its own CRC-32 + length)
//    24     2  gameVersionLength (u16)
//    26     2  reserved (0)
//    28     …  gameVersion (UTF-8) · meta JSON (UTF-8) · payload
//
// Header and metadata stay uncompressed, so a save list can read name/date/thumbnail without inflating the payload.
//
// Payload (before gzip):
//     0     4  tableLength (u32)
//     4     …  table JSON: [{name, dtype, length, offset, byteLength}], offsets relative to the data region
//     …        zero padding to 8 bytes; data region: every section starts at an 8-byte aligned offset,
//              so decoded typed arrays are zero-copy views into one buffer.
//
// dtypes: u8 i8 u8c u16 i16 u32 i32 f32 f64 i64 u64 (f16 when the platform has Float16Array) — typed arrays;
//         bytes — ArrayBuffer; view — DataView; json — any JSON value (UTF-8).
//
// Compression uses CompressionStream/DecompressionStream (browsers, Electron, Node ≥ 18). The work is fed in
// chunks and the encoder yields to the event loop whenever a time budget is used up, so saving a large world
// does not freeze a frame. Typed arrays are read while encoding runs: pass copies if the sim keeps mutating them
// (autosave.js does that by default).

import { VERSION } from '../shared/version.js';
import { formatRu } from '../sim/calendar.js';

export const SAVE_MAGIC = 'PSAV';
/** Current container/content format version. Bump it together with a migration registered below or by modules. */
export const FORMAT_VERSION = 1;
export const SAVE_EXTENSION = '.psav';
export const HEADER_SIZE = 28;
export const FLAG_GZIP = 1;
const KNOWN_FLAGS = FLAG_GZIP;
const MAX_U32 = 0xffffffff;
const MAX_META_BYTES = 16 * 1024 * 1024;
const MAX_THUMBNAIL_CHARS = 2 * 1024 * 1024;

// ------------------------------------------------------------------ errors
/**
 * Error with a stable `code` and a Russian user-facing `message`.
 * Codes: BAD_INPUT BAD_ID BAD_MAGIC BAD_VERSION TOO_NEW UNSUPPORTED TRUNCATED CORRUPT TOO_LARGE
 *        NO_MIGRATION MIGRATION_FAILED NOT_FOUND STORAGE
 */
export class SaveError extends Error {
  constructor(code, message, cause) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'SaveError';
    this.code = code;
  }
}

// ------------------------------------------------------------------ dtypes
const TYPED = {
  u8: Uint8Array, i8: Int8Array, u8c: Uint8ClampedArray, u16: Uint16Array, i16: Int16Array,
  u32: Uint32Array, i32: Int32Array, f32: Float32Array, f64: Float64Array,
  i64: BigInt64Array, u64: BigUint64Array,
};
if (typeof globalThis.Float16Array === 'function') TYPED.f16 = globalThis.Float16Array;
const TYPED_ENTRIES = Object.entries(TYPED);
export const DTYPES = Object.freeze([...Object.keys(TYPED), 'bytes', 'view', 'json']);

const IS_LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
const isArrayBuffer = v => Object.prototype.toString.call(v) === '[object ArrayBuffer]';
const isSharedBuffer = v => typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer;

function typedDtype(v) {
  for (const [k, C] of TYPED_ENTRIES) if (v.constructor === C) return k;
  for (const [k, C] of TYPED_ENTRIES) if (v instanceof C) return k; // subclasses, e.g. Node Buffer → u8
  return null;
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
const align8 = n => (n + 7) & ~7;
const ZERO8 = new Uint8Array(8);

// Section names: ASCII, namespaced with '.', '/', ':' (e.g. 'weather/snow'), no prototype keys.
const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.:\/-]{0,199}$/;
const BAD_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
function checkSectionName(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name) || BAD_NAMES.has(name)) {
    throw new SaveError('BAD_INPUT', `Недопустимое имя раздела сохранения: ${JSON.stringify(name)}`);
  }
}

// ------------------------------------------------------------------ helpers
/** Uint8Array view of bytes given as Uint8Array / Buffer / ArrayBuffer / any ArrayBufferView. */
export function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (isArrayBuffer(data) || isSharedBuffer(data)) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new SaveError('BAD_INPUT', 'Данные сохранения должны быть двоичными (Uint8Array/ArrayBuffer)');
}

/** A tightly-sized copy if `u8` is a view into a larger buffer (structured clone would copy the whole buffer). */
export function exactBytes(data) {
  const u8 = toBytes(data);
  return u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength && !isSharedBuffer(u8.buffer) ? u8 : u8.slice();
}

let CRC_TABLE = null;
export function crc32(u8, crc = 0) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const now = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());

/**
 * Yield to the event loop with an ordinary-priority task, so the browser can render a frame in between.
 * Not scheduler.yield(): Chromium runs its continuations ahead of rendering, and a 32 MB save measured
 * 4 frames in 458 ms (107 ms gaps) with it, versus 64 frames (≤ 8 ms gaps) with a normal task.
 */
export function yieldToEventLoop() {
  if (typeof globalThis.scheduler?.postTask === 'function') return globalThis.scheduler.postTask(() => {}, { priority: 'user-visible' });
  if (typeof setImmediate === 'function') return new Promise(r => setImmediate(r));
  if (typeof MessageChannel === 'function') {
    return new Promise(r => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => { ch.port1.close(); r(); };
      ch.port2.postMessage(0);
    });
  }
  return new Promise(r => setTimeout(r, 0));
}

class Budget {
  constructor(ms) { this.ms = ms; this.t0 = now(); }
  async tick() {
    if (this.ms > 0 && now() - this.t0 >= this.ms) { await yieldToEventLoop(); this.t0 = now(); }
  }
}

function concatChunks(chunks, total) {
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

async function gzipParts(parts, { chunkSize, budgetMs }) {
  if (typeof CompressionStream !== 'function') throw new SaveError('UNSUPPORTED', 'Сжатие (CompressionStream) недоступно в этой среде');
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();
  const chunks = [];
  let total = 0;
  const pump = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      chunks.push(value); total += value.length;
    }
  })();
  const feed = (async () => {
    const budget = new Budget(budgetMs);
    for (const p of parts) {
      for (let o = 0; o < p.length; o += chunkSize) {
        let c = p.subarray(o, Math.min(p.length, o + chunkSize));
        if (isSharedBuffer(c.buffer)) c = c.slice(); // streams reject shared memory
        await writer.write(c);
        await budget.tick();
      }
    }
    await writer.close();
  })();
  try {
    await Promise.all([feed, pump]);
  } catch (e) {
    reader.cancel().catch(() => {});
    writer.abort().catch(() => {});
    throw new SaveError('STORAGE', `Не удалось сжать сохранение: ${e?.message ?? e}`, e);
  }
  return concatChunks(chunks, total);
}

async function gunzipTo(stored, rawLength, { chunkSize, budgetMs }) {
  if (typeof DecompressionStream !== 'function') throw new SaveError('UNSUPPORTED', 'Распаковка (DecompressionStream) недоступна в этой среде');
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  const out = new Uint8Array(rawLength);
  let pos = 0;
  const pump = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (pos + value.length > rawLength) throw new SaveError('CORRUPT', 'Сохранение повреждено: данные длиннее заявленного');
      out.set(value, pos); pos += value.length;
    }
  })();
  const feed = (async () => {
    const budget = new Budget(budgetMs);
    for (let o = 0; o < stored.length; o += chunkSize) {
      await writer.write(stored.subarray(o, Math.min(stored.length, o + chunkSize)));
      await budget.tick();
    }
    await writer.close();
  })();
  try {
    await Promise.all([feed, pump]);
  } catch (e) {
    reader.cancel().catch(() => {});
    writer.abort().catch(() => {});
    if (e instanceof SaveError) throw e;
    throw new SaveError('CORRUPT', 'Сохранение повреждено: сжатые данные не читаются', e);
  }
  if (pos !== rawLength) throw new SaveError('CORRUPT', 'Сохранение повреждено: данные короче заявленного');
  return out;
}

// ------------------------------------------------------------------ sections
function entriesOf(sections) {
  if (!sections) return [];
  if (sections instanceof Map) return [...sections.entries()];
  if (Array.isArray(sections)) {
    return sections.map(s => {
      if (!s || typeof s !== 'object' || !('name' in s)) throw new SaveError('BAD_INPUT', 'Раздел сохранения должен иметь вид {name, data}');
      return [s.name, s.data];
    });
  }
  if (typeof sections === 'object') return Object.entries(sections);
  throw new SaveError('BAD_INPUT', 'Разделы сохранения: ожидается объект, Map или массив');
}

function encodeSection(name, value) {
  checkSectionName(name);
  if (value === undefined) throw new SaveError('BAD_INPUT', `Раздел «${name}» пуст (undefined)`);
  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) {
      return { name, dtype: 'view', length: value.byteLength, bytes: new Uint8Array(value.buffer, value.byteOffset, value.byteLength) };
    }
    const dtype = typedDtype(value);
    if (!dtype) throw new SaveError('BAD_INPUT', `Раздел «${name}»: неподдерживаемый тип массива ${value.constructor?.name}`);
    return { name, dtype, length: value.length, bytes: new Uint8Array(value.buffer, value.byteOffset, value.byteLength) };
  }
  if (isArrayBuffer(value) || isSharedBuffer(value)) {
    return { name, dtype: 'bytes', length: value.byteLength, bytes: new Uint8Array(value) };
  }
  let json;
  try { json = JSON.stringify(value); } catch (e) {
    throw new SaveError('BAD_INPUT', `Раздел «${name}» нельзя записать как JSON: ${e.message}`, e);
  }
  if (typeof json !== 'string') throw new SaveError('BAD_INPUT', `Раздел «${name}» нельзя записать как JSON`);
  const bytes = enc.encode(json);
  return { name, dtype: 'json', length: bytes.length, bytes };
}

function buildMeta(meta) {
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) throw new SaveError('BAD_INPUT', 'Метаданные сохранения должны быть объектом');
  const m = { ...meta };
  if (!Number.isFinite(m.t)) throw new SaveError('BAD_INPUT', 'В метаданных сохранения нет игровой даты (t)');
  m.name = typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 200) : 'Сохранение';
  if (typeof m.created !== 'string') m.created = new Date().toISOString();
  if (typeof m.dateLabel !== 'string') m.dateLabel = formatRu(m.t, 'day');
  if (m.thumbnail !== undefined && m.thumbnail !== null) {
    if (typeof m.thumbnail !== 'string' || !m.thumbnail.startsWith('data:image/') || m.thumbnail.length > MAX_THUMBNAIL_CHARS) {
      throw new SaveError('BAD_INPUT', 'Миниатюра сохранения должна быть data:image/… строкой до 2 МБ');
    }
  }
  return m;
}

// ------------------------------------------------------------------ encode
/**
 * Build a save file.
 * @param {object} o
 * @param {object} o.meta          {t (required), name, created, thumbnail?, …any JSON}
 * @param {object|Map|Array} o.sections  name → TypedArray | ArrayBuffer | DataView | JSON value
 * @param {string} [o.gameVersion] defaults to the app version (package.json via vite)
 * @param {boolean}[o.compress=true]
 * @param {number} [o.formatVersion=FORMAT_VERSION]  (tests/tools only)
 * @param {number} [o.chunkSize=262144] [o.budgetMs=6]  async feeding granularity
 * @returns {Promise<Uint8Array>}
 */
export async function encodeSave({ meta, sections, gameVersion = VERSION, compress = true,
  formatVersion = FORMAT_VERSION, chunkSize = 256 * 1024, budgetMs = 6 } = {}) {
  if (!IS_LE) throw new SaveError('UNSUPPORTED', 'Сохранения поддерживаются только на little-endian платформах');
  if (!Number.isInteger(formatVersion) || formatVersion < 1 || formatVersion > 0xffff) throw new SaveError('BAD_INPUT', 'Неверная версия формата');
  const metaObj = buildMeta(meta ?? {});
  const metaBytes = enc.encode(JSON.stringify(metaObj));
  if (metaBytes.length > MAX_META_BYTES) throw new SaveError('TOO_LARGE', 'Метаданные сохранения слишком велики');
  const gvBytes = enc.encode(String(gameVersion ?? ''));
  if (gvBytes.length > 0xffff) throw new SaveError('BAD_INPUT', 'Слишком длинная строка версии игры');

  const secs = [];
  const seen = new Set();
  for (const [name, value] of entriesOf(sections)) {
    if (seen.has(name)) throw new SaveError('BAD_INPUT', `Раздел «${name}» указан дважды`);
    seen.add(name);
    secs.push(encodeSection(name, value));
  }

  // section table + layout
  const table = [];
  let off = 0;
  for (const s of secs) {
    table.push({ name: s.name, dtype: s.dtype, length: s.length, offset: off, byteLength: s.bytes.length });
    off = align8(off + s.bytes.length);
  }
  const tableBytes = enc.encode(JSON.stringify(table));
  const dataStart = align8(4 + tableBytes.length);
  const head = new Uint8Array(dataStart);
  new DataView(head.buffer).setUint32(0, tableBytes.length, true);
  head.set(tableBytes, 4);
  const parts = [head];
  let raw = dataStart;
  for (const s of secs) {
    parts.push(s.bytes);
    raw += s.bytes.length;
    const pad = align8(raw) - raw;
    if (pad) { parts.push(ZERO8.subarray(0, pad)); raw += pad; }
  }
  if (raw > MAX_U32) throw new SaveError('TOO_LARGE', 'Сохранение больше 4 ГБ не поддерживается');

  let stored, crc = 0;
  if (compress) {
    stored = await gzipParts(parts, { chunkSize, budgetMs });
  } else {
    stored = concatChunks(parts, raw);
    crc = crc32(stored);
  }
  if (stored.length > MAX_U32) throw new SaveError('TOO_LARGE', 'Сохранение больше 4 ГБ не поддерживается');

  const total = HEADER_SIZE + gvBytes.length + metaBytes.length + stored.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set([0x50, 0x53, 0x41, 0x56], 0); // 'PSAV'
  dv.setUint16(4, formatVersion, true);
  dv.setUint16(6, compress ? FLAG_GZIP : 0, true);
  dv.setUint32(8, metaBytes.length, true);
  dv.setUint32(12, stored.length, true);
  dv.setUint32(16, raw, true);
  dv.setUint32(20, crc, true);
  dv.setUint16(24, gvBytes.length, true);
  dv.setUint16(26, 0, true);
  out.set(gvBytes, HEADER_SIZE);
  out.set(metaBytes, HEADER_SIZE + gvBytes.length);
  out.set(stored, HEADER_SIZE + gvBytes.length + metaBytes.length);
  return out;
}

// ------------------------------------------------------------------ decode
/**
 * Parse the uncompressed header + metadata (cheap; no payload inflation).
 * Needs at least the header and metadata bytes; the payload may be missing (e.g. a partial file read).
 * @returns {{formatVersion, flags, compressed, gameVersion, meta, payloadOffset, payloadLength, rawLength, crc, totalLength}}
 */
export function readSaveHeader(data) {
  const u8 = toBytes(data);
  if (u8.length < 4 || u8[0] !== 0x50 || u8[1] !== 0x53 || u8[2] !== 0x41 || u8[3] !== 0x56) {
    if (u8.length < 4) throw new SaveError('TRUNCATED', 'Файл сохранения обрезан (нет заголовка)');
    throw new SaveError('BAD_MAGIC', 'Это не файл сохранения Passionaris');
  }
  if (u8.length < HEADER_SIZE) throw new SaveError('TRUNCATED', 'Файл сохранения обрезан (нет заголовка)');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const formatVersion = dv.getUint16(4, true);
  const flags = dv.getUint16(6, true);
  const metaLength = dv.getUint32(8, true);
  const payloadLength = dv.getUint32(12, true);
  const rawLength = dv.getUint32(16, true);
  const crc = dv.getUint32(20, true);
  const gvLength = dv.getUint16(24, true);
  if (formatVersion < 1) throw new SaveError('BAD_VERSION', `Неверная версия формата сохранения: ${formatVersion}`);
  if (flags & ~KNOWN_FLAGS) throw new SaveError('UNSUPPORTED', 'Сохранение использует неизвестные возможности формата (более новая версия игры?)');
  if (metaLength > MAX_META_BYTES) throw new SaveError('CORRUPT', 'Сохранение повреждено: метаданные слишком велики');
  const metaStart = HEADER_SIZE + gvLength;
  const payloadOffset = metaStart + metaLength;
  if (u8.length < payloadOffset) throw new SaveError('TRUNCATED', 'Файл сохранения обрезан (метаданные)');
  let gameVersion, meta;
  try {
    gameVersion = dec.decode(u8.subarray(HEADER_SIZE, metaStart));
    meta = JSON.parse(dec.decode(u8.subarray(metaStart, payloadOffset)));
  } catch (e) {
    throw new SaveError('CORRUPT', 'Сохранение повреждено: метаданные не читаются', e);
  }
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) throw new SaveError('CORRUPT', 'Сохранение повреждено: метаданные не объект');
  return {
    formatVersion, flags, compressed: (flags & FLAG_GZIP) !== 0, gameVersion, meta,
    payloadOffset, payloadLength, rawLength, crc, totalLength: payloadOffset + payloadLength,
  };
}

function parsePayload(raw, copy) {
  if (raw.length < 4) throw new SaveError('CORRUPT', 'Сохранение повреждено: нет таблицы разделов');
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const tableLength = dv.getUint32(0, true);
  if (4 + tableLength > raw.length) throw new SaveError('CORRUPT', 'Сохранение повреждено: таблица разделов обрезана');
  let table;
  try { table = JSON.parse(dec.decode(raw.subarray(4, 4 + tableLength))); } catch (e) {
    throw new SaveError('CORRUPT', 'Сохранение повреждено: таблица разделов не читается', e);
  }
  if (!Array.isArray(table)) throw new SaveError('CORRUPT', 'Сохранение повреждено: таблица разделов');
  const dataStart = align8(4 + tableLength);
  const base = raw.byteOffset + dataStart; // raw.byteOffset is 0 for buffers we allocate → 8-byte aligned views
  const sections = {};
  for (const e of table) {
    const bad = why => new SaveError('CORRUPT', `Сохранение повреждено: раздел ${JSON.stringify(e?.name)} (${why})`);
    if (!e || typeof e !== 'object') throw bad('запись');
    try { checkSectionName(e.name); } catch { throw bad('имя'); }
    if (Object.prototype.hasOwnProperty.call(sections, e.name)) throw bad('повтор');
    const { dtype, length, offset, byteLength } = e;
    if (![length, offset, byteLength].every(n => Number.isSafeInteger(n) && n >= 0)) throw bad('размеры');
    if (offset % 8 !== 0 || dataStart + offset + byteLength > raw.length) throw bad('границы');
    const C = TYPED[dtype];
    let value;
    if (C) {
      if (byteLength !== length * C.BYTES_PER_ELEMENT) throw bad('длина');
      value = new C(raw.buffer, base + offset, length);
      if (copy) value = value.slice();
    } else if (dtype === 'bytes') {
      value = raw.buffer.slice(base + offset, base + offset + byteLength);
    } else if (dtype === 'view') {
      value = copy ? new DataView(raw.buffer.slice(base + offset, base + offset + byteLength)) : new DataView(raw.buffer, base + offset, byteLength);
    } else if (dtype === 'json') {
      try { value = JSON.parse(dec.decode(raw.subarray(dataStart + offset, dataStart + offset + byteLength))); } catch { throw bad('JSON'); }
    } else {
      throw new SaveError('UNSUPPORTED', `Раздел «${e.name}»: неизвестный тип данных ${JSON.stringify(dtype)}`);
    }
    sections[e.name] = value;
  }
  return sections;
}

/**
 * Decode a save file, verify it and migrate it to `targetVersion`.
 * @param {Uint8Array|ArrayBuffer} data
 * @param {object} [o]
 * @param {MigrationRegistry} [o.migrations=migrations]
 * @param {number}  [o.targetVersion=FORMAT_VERSION]
 * @param {boolean} [o.copy=false]   typed arrays as independent copies instead of views into one buffer
 * @returns {Promise<{formatVersion, gameVersion, meta, sections, migratedFrom?}>}
 */
export async function decodeSave(data, { migrations: registry = migrations, targetVersion = FORMAT_VERSION,
  copy = false, chunkSize = 256 * 1024, budgetMs = 6 } = {}) {
  if (!IS_LE) throw new SaveError('UNSUPPORTED', 'Сохранения поддерживаются только на little-endian платформах');
  const u8 = toBytes(data);
  const h = readSaveHeader(u8);
  if (h.formatVersion > targetVersion) {
    throw new SaveError('TOO_NEW', `Сохранение создано более новой версией игры (${h.gameVersion || '?'}, формат ${h.formatVersion}); обновите игру`);
  }
  if (u8.length < h.totalLength) throw new SaveError('TRUNCATED', 'Файл сохранения обрезан (не хватает данных)');
  if (u8.length > h.totalLength) throw new SaveError('CORRUPT', 'Сохранение повреждено: лишние данные в конце файла');
  const stored = u8.subarray(h.payloadOffset, h.totalLength);
  let raw;
  if (h.compressed) {
    // gzip cannot expand more than ~1032:1 — rejects absurd sizes before allocating
    if (h.rawLength > h.payloadLength * 1100 + 4096) throw new SaveError('CORRUPT', 'Сохранение повреждено: неверный размер данных');
    raw = await gunzipTo(stored, h.rawLength, { chunkSize, budgetMs });
  } else {
    if (h.rawLength !== h.payloadLength) throw new SaveError('CORRUPT', 'Сохранение повреждено: неверный размер данных');
    if (crc32(stored) !== h.crc) throw new SaveError('CORRUPT', 'Сохранение повреждено: контрольная сумма не совпадает');
    raw = stored.slice(); // own, 8-byte aligned buffer
  }
  let save = { formatVersion: h.formatVersion, gameVersion: h.gameVersion, meta: h.meta, sections: parsePayload(raw, copy) };
  if (h.formatVersion < targetVersion) save = await registry.apply(save, targetVersion);
  return save;
}

// ------------------------------------------------------------------ migrations
/**
 * Ordered upgrade steps keyed by format version: register(v, fn) upgrades a decoded save from v to v + 1.
 * fn(save, {from, to}) may mutate `save` ({formatVersion, gameVersion, meta, sections}) and/or return a new one;
 * it may be async. A save older than the target needs every step in between.
 */
export class MigrationRegistry {
  constructor() { this._steps = new Map(); }
  register(fromVersion, fn) {
    if (!Number.isInteger(fromVersion) || fromVersion < 1) throw new TypeError('migrations.register: fromVersion must be an integer ≥ 1');
    if (typeof fn !== 'function') throw new TypeError('migrations.register: fn must be a function');
    if (this._steps.has(fromVersion)) throw new Error(`migrations.register: a step from version ${fromVersion} already exists`);
    this._steps.set(fromVersion, fn);
    return this;
  }
  has(fromVersion) { return this._steps.has(fromVersion); }
  async apply(save, targetVersion = FORMAT_VERSION) {
    const from = save.formatVersion;
    let v = from;
    while (v < targetVersion) {
      const fn = this._steps.get(v);
      if (!fn) throw new SaveError('NO_MIGRATION', `Не найдено обновление сохранения с формата ${v} на ${v + 1}`);
      let next;
      try { next = await fn(save, { from: v, to: v + 1 }); } catch (e) {
        throw new SaveError('MIGRATION_FAILED', `Не удалось обновить сохранение с формата ${v} на ${v + 1}: ${e?.message ?? e}`, e);
      }
      if (next !== undefined) {
        if (!next || typeof next !== 'object' || !next.sections || !next.meta) {
          throw new SaveError('MIGRATION_FAILED', `Обновление сохранения ${v}→${v + 1} вернуло неверный объект`);
        }
        save = next;
      }
      v += 1;
      save.formatVersion = v;
    }
    if (v !== from) save.migratedFrom = from;
    return save;
  }
}

/** The game's global migration registry (decodeSave uses it by default). */
export const migrations = new MigrationRegistry();

// ------------------------------------------------------------------ save ids
// Slot ids double as file names in Electron (electron/saves.cjs repeats this check on the main side).
const ID_RE = /^[\p{L}\p{N}][\p{L}\p{N} _\-.()]{0,63}$/u;
const RESERVED_RE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;
/** Validate and normalise a save slot id ('autosave-1', 'Мой мир'). Throws SaveError('BAD_ID'). */
export function checkSaveId(id) {
  const s = typeof id === 'string' ? id.normalize('NFC') : '';
  if (!ID_RE.test(s) || s.includes('..') || /[. ]$/.test(s) || RESERVED_RE.test(s.split('.')[0].trim())) {
    throw new SaveError('BAD_ID', `Недопустимое имя слота сохранения: ${JSON.stringify(id)}`);
  }
  return s;
}

/** Make a valid slot id from a free-form name (keeps letters/digits, collapses the rest to '-'). */
export function slugSaveId(name, fallback = 'save') {
  let s = String(name ?? '').normalize('NFC')
    .replace(/\s*[^\p{L}\p{N} _\-()]+\s*/gu, ' - ')   // forbidden runs (':', '/', '.', …) → ' - '
    .replace(/\s+/g, ' ').replace(/(?:\s*-\s*){2,}/g, ' - ')
    .replace(/^[^\p{L}\p{N}]+/u, '').slice(0, 64).replace(/[. -]+$/, '');
  if (!s) s = fallback;
  try { return checkSaveId(s); } catch { return checkSaveId(`${fallback}-${s.replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 64)); }
}

// ------------------------------------------------------------------ storage-level helpers
/**
 * Storage adapter interface (indexedDb.js, electron.js, memory.js):
 *   list()            → Promise<SaveInfo[]>, newest first
 *   save(id, bytes)   → Promise<SaveInfo>
 *   load(id)          → Promise<Uint8Array>  (SaveError NOT_FOUND if missing)
 *   remove(id)        → Promise<boolean>     (false if it did not exist)
 * SaveInfo = {id, size, modified (ms), formatVersion, gameVersion, meta} or {id, size, modified, error}.
 */
export function infoFromBytes(id, bytes, modified = Date.now()) {
  const h = readSaveHeader(bytes);
  return { id, size: bytes.length, modified, formatVersion: h.formatVersion, gameVersion: h.gameVersion, meta: h.meta };
}

/** Encode and store a game. */
export async function saveGame(storage, id, { meta, sections }, opts = {}) {
  const bytes = await encodeSave({ ...opts, meta, sections });
  return storage.save(checkSaveId(id), bytes);
}

/**
 * Load and decode a game. Unlike decodeSave(), typed arrays default to independent copies (`copy: true`):
 * zero-copy views would all share one payload buffer, so a module keeping a tiny view would pin the whole
 * payload in memory, posting a view to a Worker would clone the whole payload, and transferring
 * `view.buffer` would detach every other module's section. Pass {copy: false} only for read-only tools.
 */
export async function loadGame(storage, id, opts = {}) {
  const bytes = await storage.load(checkSaveId(id));
  return decodeSave(bytes, { copy: true, ...opts });
}

// ------------------------------------------------------------------ module state registry
// Modules register a provider; their state objects may mix JSON values and typed arrays at any depth.
// Typed arrays / ArrayBuffers / DataViews are split into binary sections `${key}/${path}` and replaced in the
// JSON skeleton by {"$bin": "<section name>"}; unpacking restores the original shape.

const isBinary = v => ArrayBuffer.isView(v) || isArrayBuffer(v) || isSharedBuffer(v);
const PATH_SAFE = s => String(s).replace(/[^A-Za-z0-9_.:-]/g, '_');
const MAX_MODULE_KEY = 100;
// own property even for the key '__proto__' (plain assignment would replace the prototype and lose the data)
const setOwn = (o, k, v) => {
  if (k === '__proto__') Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
  else o[k] = v;
};

/**
 * Split a state object into {json, sections}. Binary parts get readable names `${key}/${path}`; when a path
 * is too long or two paths map to the same name (e.g. non-ASCII keys, 'a b' vs 'a_b'), a unique
 * `${key}/:${n}` name is used instead. The {$bin} placeholder stores the exact name, so loading never guesses.
 */
export function packState(key, state) {
  const sections = {};
  const used = new Set();
  let serial = 0;
  const nameFor = path => {
    let name = `${key}/${path || '_'}`;
    if (used.has(name) || !NAME_RE.test(name)) {
      do name = `${key}/:${++serial}`; while (used.has(name));
    }
    used.add(name);
    return name;
  };
  const walk = (v, path) => {
    if (isBinary(v)) {
      const name = nameFor(path);
      sections[name] = v;
      return { $bin: name };
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, path ? `${path}.${i}` : `${i}`));
    if (v && typeof v === 'object') {
      if (v instanceof Map || v instanceof Set) throw new SaveError('BAD_INPUT', `Раздел «${key}»: Map/Set не поддерживаются, используйте объекты/массивы`);
      if (typeof v.toJSON === 'function') return v.toJSON();
      const o = {};
      for (const k of Object.keys(v)) {
        const x = v[k];
        if (x === undefined || typeof x === 'function') continue;
        setOwn(o, k, walk(x, path ? `${path}.${PATH_SAFE(k)}` : PATH_SAFE(k)));
      }
      return o;
    }
    return v;
  };
  return { json: walk(state, ''), sections };
}

/** Inverse of packState: replace {$bin} placeholders with the decoded sections. */
export function unpackState(json, sections) {
  const walk = v => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === '$bin' && typeof v.$bin === 'string') {
        if (!(v.$bin in sections)) throw new SaveError('CORRUPT', `Сохранение повреждено: нет раздела «${v.$bin}»`);
        return sections[v.$bin];
      }
      const o = {};
      for (const k of keys) setOwn(o, k, walk(v[k]));
      return o;
    }
    return v;
  };
  return walk(json);
}

/**
 * Collects the state of game modules into sections and hands it back on load.
 *   registry.register('clock', { save: () => clock.serialize(), load: s => clock.deserialize(s) });
 *   const sections = registry.collect();            // → encodeSave({meta, sections})
 *   await registry.apply(save.sections);            // after decodeSave
 * Providers marked `optional` are skipped on load when the save has no data for them (older saves),
 * calling `onMissing()` if given.
 */
export class SaveRegistry {
  constructor() { this._providers = new Map(); }
  register(key, provider) {
    checkSectionName(key);
    if (key.includes('/')) throw new SaveError('BAD_INPUT', `Ключ модуля «${key}» не должен содержать '/'`);
    if (key.length > MAX_MODULE_KEY) throw new SaveError('BAD_INPUT', `Ключ модуля «${key}» длиннее ${MAX_MODULE_KEY} символов`);
    if (!provider || typeof provider.save !== 'function' || typeof provider.load !== 'function') {
      throw new TypeError('SaveRegistry.register: provider needs save() and load()');
    }
    if (this._providers.has(key)) throw new Error(`SaveRegistry.register: "${key}" already registered`);
    this._providers.set(key, provider);
    return () => this._providers.delete(key);
  }
  get keys() { return [...this._providers.keys()]; }
  /** Synchronous snapshot of every module (binary parts are NOT copied here; see autosave `copy`). */
  collect() {
    const sections = {};
    for (const [key, p] of this._providers) {
      const { json, sections: bins } = packState(key, p.save());
      sections[key] = json === undefined ? null : json;
      Object.assign(sections, bins);
    }
    return sections;
  }
  /** Feed decoded sections back to the modules in registration order. */
  async apply(sections) {
    for (const [key, p] of this._providers) {
      if (!Object.prototype.hasOwnProperty.call(sections, key)) {
        if (p.optional) { p.onMissing?.(); continue; }
        throw new SaveError('CORRUPT', `В сохранении нет данных модуля «${key}»`);
      }
      await p.load(unpackState(sections[key], sections));
    }
  }
}
