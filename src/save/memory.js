// In-memory save storage: fallback when neither Electron nor IndexedDB is available, and for tests.
import { SaveError, checkSaveId, exactBytes, infoFromBytes } from './saveSystem.js';

export function createMemoryStorage({ clock = () => Date.now() } = {}) {
  const files = new Map(); // id → {bytes, info}
  return {
    kind: 'memory',
    async list() {
      return [...files.values()].map(f => f.info).sort((a, b) => b.modified - a.modified);
    },
    async save(id, bytes) {
      id = checkSaveId(id);
      const copy = exactBytes(bytes).slice(); // own the data, like a real storage
      const info = infoFromBytes(id, copy, clock());
      files.set(id, { bytes: copy, info });
      return info;
    },
    async load(id) {
      const f = files.get(checkSaveId(id));
      if (!f) throw new SaveError('NOT_FOUND', `Сохранение «${id}» не найдено`);
      return f.bytes.slice();
    },
    async remove(id) {
      return files.delete(checkSaveId(id));
    },
  };
}
