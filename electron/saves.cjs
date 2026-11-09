// Passionaris save files in the Electron main process (owner: time-save module, see docs/ENGINE.md).
//
// Files: <userData>/saves/<id>.psav  (format: src/save/saveSystem.js). Writes are atomic: a hidden temp file
// '.<id>.psav.<pid>.<random>.tmp' is written + fsynced, then renamed over the target. Ids are validated here again
// (never trust the renderer): letters/digits/space/_-.() only, no path separators, no '..', no Windows device names.
//
// Wiring in electron/main.cjs (main thread owns that file):
//
//   const { registerSaveIpc } = require('./saves.cjs');
//   app.whenReady().then(() => {
//     registerSaveIpc(ipcMain, app);   // optionally: { trashItem: p => shell.trashItem(p) }
//     …
//   });
//
// Preload snippet for electron/preload.cjs (add inside the exposeInMainWorld('passionaris', { … }) object):
//
//   saves: {
//     list: () => ipcRenderer.invoke('saves:list'),
//     save: (id, bytes) => ipcRenderer.invoke('saves:save', id, bytes),
//     load: id => ipcRenderer.invoke('saves:load', id),
//     remove: id => ipcRenderer.invoke('saves:remove', id),
//   },
//
// Renderer side: src/save/electron.js (createElectronStorage) uses exactly this API.
// Errors are thrown as Error('[CODE] message') so the renderer can map them back to SaveError codes.

'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');

const EXT = '.psav';
const HEADER_SIZE = 28;
const MAX_META_BYTES = 16 * 1024 * 1024;
const MAX_SAVE_BYTES = 2 * 1024 * 1024 * 1024 - 1; // 2 GiB
const STALE_TMP_MS = 10 * 60 * 1000;

const ID_RE = /^[\p{L}\p{N}][\p{L}\p{N} _\-.()]{0,63}$/u;
const RESERVED_RE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;

function fail(code, message) {
  const e = new Error(`[${code}] ${message}`);
  e.code = code;
  return e;
}

/** Same rule as checkSaveId() in src/save/saveSystem.js. */
function checkId(id) {
  const s = typeof id === 'string' ? id.normalize('NFC') : '';
  if (!ID_RE.test(s) || s.includes('..') || /[. ]$/.test(s) || RESERVED_RE.test(s.split('.')[0].trim())) {
    throw fail('BAD_ID', `Недопустимое имя слота сохранения: ${JSON.stringify(id)}`);
  }
  return s;
}

function fileFor(dir, id) {
  const file = path.join(dir, checkId(id) + EXT);
  // belt and braces: the resolved file must sit directly in the saves folder
  if (path.dirname(path.resolve(file)) !== path.resolve(dir)) throw fail('BAD_ID', 'Недопустимый путь сохранения');
  return file;
}

function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  if (ArrayBuffer.isView(bytes)) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  throw fail('BAD_INPUT', 'Данные сохранения должны быть Uint8Array');
}

function parseHeader(buf, needAll) {
  if (buf.length < HEADER_SIZE || buf.toString('latin1', 0, 4) !== 'PSAV') throw fail('BAD_MAGIC', 'Это не файл сохранения Passionaris');
  const formatVersion = buf.readUInt16LE(4);
  const metaLength = buf.readUInt32LE(8);
  const payloadLength = buf.readUInt32LE(12);
  const gvLength = buf.readUInt16LE(24);
  if (metaLength > MAX_META_BYTES) throw fail('CORRUPT', 'Сохранение повреждено: метаданные слишком велики');
  const total = HEADER_SIZE + gvLength + metaLength + payloadLength;
  if (needAll && buf.length !== total) throw fail('CORRUPT', 'Сохранение повреждено: размер не совпадает с заголовком');
  return { formatVersion, metaLength, gvLength, total };
}

async function readInfo(dir, name) {
  const file = path.join(dir, name);
  const id = name.slice(0, -EXT.length);
  let fh;
  try {
    fh = await fsp.open(file, 'r');
    const st = await fh.stat();
    const head = Buffer.alloc(HEADER_SIZE);
    const { bytesRead } = await fh.read(head, 0, HEADER_SIZE, 0);
    const h = parseHeader(head.subarray(0, bytesRead), false);
    const rest = Buffer.alloc(h.gvLength + h.metaLength);
    const r2 = await fh.read(rest, 0, rest.length, HEADER_SIZE);
    if (r2.bytesRead !== rest.length) throw fail('TRUNCATED', 'Файл сохранения обрезан');
    const gameVersion = rest.toString('utf8', 0, h.gvLength);
    const meta = JSON.parse(rest.toString('utf8', h.gvLength));
    if (st.size < h.total) throw fail('TRUNCATED', 'Файл сохранения обрезан');
    return { id, size: st.size, modified: st.mtimeMs, formatVersion: h.formatVersion, gameVersion, meta };
  } catch (e) {
    let size = 0, modified = 0;
    try { const st = await fsp.stat(file); size = st.size; modified = st.mtimeMs; } catch { /* gone */ }
    return { id, size, modified, error: String(e && e.message || e) };
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Windows: antivirus/indexers can hold the target briefly → retry the rename a few times.
async function renameWithRetry(from, to) {
  for (let i = 0; ; i++) {
    try { return await fsp.rename(from, to); } catch (e) {
      if (i >= 8 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
      await sleep(25 * (i + 1));
    }
  }
}

async function cleanStaleTmp(dir) {
  let names;
  try { names = await fsp.readdir(dir); } catch { return; }
  const now = Date.now();
  await Promise.all(names.filter(n => n.startsWith('.') && n.endsWith('.tmp') && n.includes(EXT + '.')).map(async n => {
    const p = path.join(dir, n);
    try { const st = await fsp.stat(p); if (now - st.mtimeMs > STALE_TMP_MS) await fsp.unlink(p); } catch { /* ignore */ }
  }));
}

/** Storage operations bound to a folder (exported for tests and tools). */
function createSaveFolder(dir, { trashItem = null } = {}) {
  const ensure = () => fsp.mkdir(dir, { recursive: true });
  return {
    dir,
    async list() {
      await ensure();
      await cleanStaleTmp(dir);
      const names = (await fsp.readdir(dir)).filter(n => n.endsWith(EXT) && !n.startsWith('.'));
      const infos = await Promise.all(names.map(async n => {
        const info = await readInfo(dir, n);
        // a file copied in by hand ('my save!.psav', a non-NFC name) cannot be loaded or removed through the id
        // API: list it as unreadable instead of offering a slot that fails on load
        let idOk = false;
        try { idOk = checkId(info.id) === info.id; } catch { /* invalid */ }
        if (!idOk && !info.error) {
          return { id: info.id, size: info.size, modified: info.modified, error: `[BAD_ID] Недопустимое имя файла сохранения: ${JSON.stringify(n)}` };
        }
        return info;
      }));
      return infos.sort((a, b) => b.modified - a.modified);
    },
    async save(id, bytes) {
      const file = fileFor(dir, id);
      const buf = toBuffer(bytes);
      if (buf.length > MAX_SAVE_BYTES) throw fail('TOO_LARGE', 'Сохранение слишком большое');
      parseHeader(buf, true); // refuse to store anything that is not a complete save file
      await ensure();
      const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
      let fh;
      try {
        fh = await fsp.open(tmp, 'wx');
        await fh.writeFile(buf);
        await fh.sync();
        await fh.close();
        fh = null;
        await renameWithRetry(tmp, file);
      } catch (e) {
        if (fh) await fh.close().catch(() => {});
        await fsp.unlink(tmp).catch(() => {});
        throw fail('STORAGE', `Не удалось записать сохранение: ${e.message}`);
      }
      return readInfo(dir, path.basename(file));
    },
    async load(id) {
      const file = fileFor(dir, id);
      try {
        return await fsp.readFile(file);
      } catch (e) {
        if (e.code === 'ENOENT') throw fail('NOT_FOUND', `Сохранение «${id}» не найдено`);
        throw fail('STORAGE', `Не удалось прочитать сохранение: ${e.message}`);
      }
    },
    async remove(id) {
      const file = fileFor(dir, id);
      try {
        if (trashItem) await trashItem(file); else await fsp.unlink(file);
        return true;
      } catch (e) {
        if (e.code === 'ENOENT' || !fs.existsSync(file)) return false;
        throw fail('STORAGE', `Не удалось удалить сохранение: ${e.message}`);
      }
    },
  };
}

/**
 * Register 'saves:list' 'saves:save' 'saves:load' 'saves:remove' on ipcMain.
 * @param {Electron.IpcMain} ipcMain
 * @param {Electron.App} app
 * @param {object} [opts]  {trashItem?: (path) => Promise<void>  — e.g. shell.trashItem for recoverable deletes,
 *                          dir?: string — override the folder (tests)}
 * @returns the folder API ({dir, list, save, load, remove})
 */
function registerSaveIpc(ipcMain, app, opts = {}) {
  const dir = opts.dir || path.join(app.getPath('userData'), 'saves');
  const folder = createSaveFolder(dir, opts);
  ipcMain.handle('saves:list', () => folder.list());
  ipcMain.handle('saves:save', (_e, id, bytes) => folder.save(id, bytes));
  ipcMain.handle('saves:load', (_e, id) => folder.load(id));
  ipcMain.handle('saves:remove', (_e, id) => folder.remove(id));
  return folder;
}

module.exports = { registerSaveIpc, createSaveFolder, checkId };
