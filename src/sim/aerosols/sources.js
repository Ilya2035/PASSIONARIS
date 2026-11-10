// Aerosol sources from world events: eruptions (ash by VEI; SO2 -> sulphate for VEI >= 5, the plume reaches the
// stratosphere), meteorite impacts and airbursts (dust), wildfires (smoke), desert dust storms (dust).
//
// Amounts are "mass" = area integral of the optical depth (tau*km^2). Reference points:
//   ash cloud: peak tau ~ 2.5 (VEI 3) ... 10 (VEI 7) over a radius that grows with the VEI;
//   sulphate: global-mean optical depth injected as SO2 — VEI 5 ~0.015, VEI 6 ~0.12 (Pinatubo 1991, peak
//   global AOD ~0.1, ~0.5 degC cooling), VEI 7 ~0.45 (Tambora 1815, "the year without a summer"), VEI 8 ~1.5.
import { ASH, SMOKE, DUST, SO2, EARTH_KM2 } from './core.js';

const blob = (tau, rKm) => tau * Math.PI * rKm * rKm * 0.5;   // mass of a gaussian of peak tau and radius 2 sigma

// VEI 0..8: ash cloud radius (km), peak tau, emission time (days); SO2 as global-mean optical depth
const ERUPT = [
  null, null,
  { r: 45, tau: 1.5, days: 0.5, so2: 0 },
  { r: 90, tau: 2.5, days: 0.8, so2: 0 },
  { r: 170, tau: 4, days: 1.2, so2: 0 },
  { r: 300, tau: 6, days: 2, so2: 0.015 },
  { r: 480, tau: 8, days: 3, so2: 0.12 },
  { r: 800, tau: 10, days: 5, so2: 0.45 },
  { r: 1400, tau: 12, days: 9, so2: 1.5 },
];

/** Sources of an eruption {t, lat, lon, vei} (VEI < 2: nothing worth a cloud). */
export function eruptionSources({ t, lat, lon, vei }) {
  const v = Math.max(0, Math.min(8, Math.round(vei ?? 2)));
  const e = ERUPT[v];
  if (!e) return [];
  const out = [{ sp: ASH, lat, lon, rKm: e.r, rate: blob(e.tau, e.r) / e.days, t0: t, t1: t + e.days, tag: `er${v}` }];
  if (e.so2 > 0) out.push({ sp: SO2, lat, lon, rKm: e.r, rate: e.so2 * EARTH_KM2 / e.days, t0: t, t1: t + e.days, tag: `so2-${v}` });
  return out;
}

/** Dust of a meteorite impact or airburst {t, lat, lon, level 1..5, kind}. Small falls raise nothing. */
export function impactSources({ t, lat, lon, level, kind }) {
  const l = Math.round(level ?? 0);
  if (l < 3) return [];
  const air = kind === 'airburst';
  const r = l >= 5 ? 420 : l === 4 ? 160 : 60;
  const tau = (l >= 5 ? 5 : l === 4 ? 3 : 1.6) * (air ? 0.5 : 1);
  const days = l >= 5 ? 0.6 : 0.3;
  return [{ sp: DUST, lat, lon, rKm: r, rate: blob(tau, r) / days, t0: t, t1: t + days, tag: `mt${l}` }];
}

/** Smoke of a wildfire {t0, t1, lat, lon, severity 1..5}: burns for the event's (estimated) duration.
 *  Routine dry-season fires (severity 1-2) stay local; big fires send plumes over the continent. */
export function fireSources({ t0, t1, lat, lon, severity }) {
  const s = Math.round(severity ?? 0);
  if (s < 3) return [];
  const days = Math.max(3, Math.min(25, (t1 ?? t0) - t0 || 6));
  const r = 60 + 45 * s;
  const tauDay = 0.4 + 0.8 * (s - 2);   // peak optical depth added per day near the fire
  return [{ sp: SMOKE, lat, lon, rKm: r, rate: blob(tauDay, r), t0, t1: t0 + days, tag: `fire${s}` }];
}

/** Dust of a desert dust storm {t0, t1, lat, lon, severity}. */
export function dustStormSources({ t0, t1, lat, lon, severity }) {
  const s = Math.max(1, Math.round(severity ?? 1));
  const days = Math.max(2, Math.min(6, (t1 ?? t0) - t0 || 3));
  const r = 180 + 70 * s;
  const tauDay = 0.35 + 0.3 * s;
  return [{ sp: DUST, lat, lon, rKm: r, rate: blob(tauDay, r), t0, t1: t0 + days, tag: `dust${s}` }];
}
