// Public entry of the hazards module (simulation side, no graphics).
export { createScheduler, HAZARD_TYPES, HAZARD_NAMES_RU, MAGNITUDE_UNITS } from './scheduler.js';
export { loadHazards, decodeLevels } from './loader.js';
export { ymdToT, tToYmd, yearStartT, T_END } from './time.js';
export { intensityToLevel, eruptionLevel } from './physics.js';
