/* global __APP_VERSION__, __APP_NAME__ */
// Version scheme (see docs/VERSIONING.md):  EPOCH.UPDATE.STEP
//   EPOCH  — global era of the game (0 = foundation, 1 = first epoch, ...)
//   UPDATE — big update / new system
//   STEP   — small step inside an update
export const APP_NAME = typeof __APP_NAME__ !== 'undefined' ? __APP_NAME__ : 'Passionaris';
export const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

const [epoch, update, step] = VERSION.split('.').map(Number);
export const VERSION_PARTS = { epoch, update, step };

const EPOCH_NAMES = ['Фундамент'];
export const EPOCH_LABEL = `Эпоха ${epoch} · ${EPOCH_NAMES[epoch] ?? '—'}`;
export const VERSION_LABEL = `v${VERSION}`;
