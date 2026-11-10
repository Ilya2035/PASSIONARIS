// Public entry of the save module.
export * from './saveSystem.js';
export { createIndexedDbStorage } from './indexedDb.js';
export { createElectronStorage, hasElectronSaves } from './electron.js';
export { createMemoryStorage } from './memory.js';
export { createAutosave, snapshotSections, withTimeout } from './autosave.js';
export { captureThumbnail } from './thumbnail.js';

import { createIndexedDbStorage } from './indexedDb.js';
import { createElectronStorage, hasElectronSaves } from './electron.js';
import { createMemoryStorage } from './memory.js';

/** Electron files → IndexedDB → memory (nothing persists; warns once). */
export function createDefaultStorage() {
  if (hasElectronSaves()) return createElectronStorage();
  if (typeof globalThis.indexedDB !== 'undefined') return createIndexedDbStorage();
  console.warn('[save] no persistent storage available: saves are kept in memory only');
  return createMemoryStorage();
}
