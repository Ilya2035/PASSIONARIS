// Electron save storage: files in userData/saves, written by the main process (electron/saves.cjs).
//
// Bridge API exposed by electron/preload.cjs as window.passionaris.saves:
//   list()            → Promise<SaveInfo[]>   newest first; {id, size, modified, formatVersion, gameVersion, meta}
//                                             or {id, size, modified, error} for unreadable files
//   save(id, bytes)   → Promise<SaveInfo>     bytes: Uint8Array of a .psav file; atomic write (tmp + rename)
//   load(id)          → Promise<Uint8Array>
//   remove(id)        → Promise<boolean>      false if there was no such save
// Errors thrown by the main process carry a code prefix: "[NOT_FOUND] …", "[BAD_ID] …", "[STORAGE] …".
import { SaveError, checkSaveId, exactBytes, toBytes } from './saveSystem.js';

// ipcRenderer.invoke wraps errors: "Error invoking remote method 'saves:load': Error: [NOT_FOUND] …"
function mapError(e) {
  if (e instanceof SaveError) return e;
  const msg = String(e?.message ?? e);
  const m = /\[([A-Z_]+)\]\s*([\s\S]*)$/.exec(msg);
  return m ? new SaveError(m[1], m[2], e) : new SaveError('STORAGE', `Ошибка файлового хранилища: ${msg}`, e);
}

async function call(fn) {
  try { return await fn(); } catch (e) { throw mapError(e); }
}

/**
 * @param {object} [o]
 * @param {object} [o.bridge=window.passionaris.saves]  injectable for tests
 */
export function createElectronStorage({ bridge = globalThis.window?.passionaris?.saves } = {}) {
  if (!bridge || typeof bridge.save !== 'function') throw new SaveError('STORAGE', 'Хранилище сохранений Electron недоступно');
  return {
    kind: 'electron',
    list: () => call(() => bridge.list()),
    save: (id, bytes) => call(() => bridge.save(checkSaveId(id), exactBytes(bytes))),
    load: id => call(async () => toBytes(await bridge.load(checkSaveId(id)))),
    remove: id => call(() => bridge.remove(checkSaveId(id))),
  };
}

export const hasElectronSaves = () => typeof globalThis.window?.passionaris?.saves?.save === 'function';
