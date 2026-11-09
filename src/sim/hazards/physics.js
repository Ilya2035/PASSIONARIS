// Geometry and published empirical relations used by the hazards module (bake + runtime).

export const EARTH_KM = 6371.0088;
const RAD = Math.PI / 180;

/** SIM grid (docs/ENGINE.md): 720x360, 0.5 deg, row 0 = 90N, col 0 = 180W. */
export const SIM_W = 720, SIM_H = 360, SIM_STEP = 0.5;
export const simCellOf = (lat, lon) => {
  let x = Math.floor((lon + 180) / SIM_STEP); x = ((x % SIM_W) + SIM_W) % SIM_W;
  const y = Math.min(SIM_H - 1, Math.max(0, Math.floor((90 - lat) / SIM_STEP)));
  return y * SIM_W + x;
};
export const simLon = x => -180 + (x + 0.5) * SIM_STEP;
export const simLat = y => 90 - (y + 0.5) * SIM_STEP;

/** Great-circle distance in km. */
export function distKm(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * RAD, p2 = lat2 * RAD;
  const dp = p2 - p1, dl = (lon2 - lon1) * RAD;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Point at distance d (km) and bearing b (rad) from (lat, lon); returns [lat, lon]. */
export function offsetKm(lat, lon, d, b) {
  const p1 = lat * RAD, l1 = lon * RAD, dr = d / EARTH_KM;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(dr) + Math.cos(p1) * Math.sin(dr) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(dr) * Math.cos(p1), Math.cos(dr) - Math.sin(p1) * Math.sin(p2));
  let lo = l2 / RAD;
  lo = ((lo + 540) % 360) - 180;
  return [p2 / RAD, lo];
}

// ---------------------------------------------------------------- earthquakes

/**
 * Intensity prediction equation of Allen, Wald & Worden (2012),
 * "Intensity attenuation for active crustal regions", J. Seismology 16:409–433,
 * hypocentral-distance model (coefficients as in the paper / OpenQuake AllenEtAl2012):
 *   MMI = c0 + c1·M + c2·ln(sqrt(Rhyp² + RM²)) [+ c3·ln(Rhyp/50) for Rhyp > 50 km],
 *   RM  = m1 + m2·exp(M − 5).
 */
export const AWW2012 = { c0: 2.085, c1: 1.428, c2: -1.402, c3: 0.078, m1: -0.209, m2: 2.042 };
export function mmiAllen2012(M, rhypKm) {
  const k = AWW2012;
  const rm = k.m1 + k.m2 * Math.exp(M - 5);
  let I = k.c0 + k.c1 * M + k.c2 * Math.log(Math.sqrt(rhypKm * rhypKm + rm * rm));
  if (rhypKm > 50) I += k.c3 * Math.log(rhypKm / 50);
  return I;
}

/**
 * Subsurface rupture length (km) from moment magnitude, Wells & Coppersmith (1994),
 * BSSA 84(4):974–1002, all slip types: log10(RLD) = −2.44 + 0.59·M.
 */
export const ruptureLengthKm = M => Math.pow(10, -2.44 + 0.59 * M);

/**
 * Intensity at epicentral distance d (km) for magnitude M and focal depth h (km),
 * treating the source as a finite rupture: distance is measured to the nearest point of a
 * rupture of length L(M) centred on the epicentre (orientation unknown -> isotropic).
 */
export function quakeIntensityAt(M, dEpiKm, depthKm) {
  const h = Math.max(5, depthKm || 15);
  const r = Math.max(0, dEpiKm - ruptureLengthKm(M) / 2);
  const rh = Math.sqrt(r * r + h * h);
  let I = mmiAllen2012(M, rh);
  // AWW2012 is purely geometric and calibrated on near/regional data; beyond 300 km we add an
  // anelastic term c·(R − 300) of the form used by Atkinson & Wald (2007) / Atkinson et al. (2014)
  // IPEs (assumed c = −0.0012 per km) so that great events do not reach "felt" at teleseismic range.
  if (rh > FAR_FIELD_KM) I += ANELASTIC_PER_KM * (rh - FAR_FIELD_KM);
  return I;
}
export const FAR_FIELD_KM = 300;
export const ANELASTIC_PER_KM = -0.0012;

/**
 * Magnitude estimate from epicentral intensity (macroseismic, for pre-instrumental events) by
 * Shebalin's (1968) macroseismic field equation I0 = 1.5·M − 3.5·lg(h) + 3.0 (MSK-64, h in km).
 * The Allen et al. IPE saturates near MMI ~8.3 at the source, so it cannot be inverted for
 * high intensities. Historical I0 >= 11 reports are often exaggerated, so the estimate is
 * capped at M 7.5 (great historical events usually carry an explicit magnitude anyway).
 */
export const MAG_FROM_I0_CAP = 7.5;
export function magnitudeFromIntensity(I0, depthKm = 15) {
  const h = Math.max(5, depthKm || 15);
  const M = (I0 + 3.5 * Math.log10(h) - 3.0) / 1.5;
  return Math.max(4, Math.min(MAG_FROM_I0_CAP, M));
}

/**
 * Intensity at epicentral distance d with an observed epicentral intensity I0: when I0 exceeds
 * the IPE prediction (site effects, IPE near-field saturation), the excess is applied near the
 * source and tapered with rupture distance r as Rs/(Rs + r), Rs = 25 km.
 */
export function quakeIntensityObserved(M, dEpiKm, depthKm, I0) {
  const base = quakeIntensityAt(M, dEpiKm, depthKm);
  if (I0 == null) return base;
  const shift = I0 - quakeIntensityAt(M, 0, depthKm);
  if (!(shift > 0)) return base;
  const r = Math.max(0, dEpiKm - ruptureLengthKm(M) / 2);
  return base + shift * 25 / (25 + r);
}

/**
 * The user's earthquake scale (docs/ENGINE.md): level 1 = intensity 2–4, 2 = 4–6, 3 = 6–8,
 * 4 = 8–10, 5 = >10 (half-open bins [lo, hi)); below 2 -> 0.
 */
export function intensityToLevel(I) {
  if (!(I >= 2)) return 0;
  if (I < 4) return 1;
  if (I < 6) return 2;
  if (I < 8) return 3;
  if (I < 10) return 4;
  return 5;
}

// ---------------------------------------------------------------- tsunamis

/**
 * Soloviev–Imamura tsunami intensity: I = log2(sqrt(2)·H), H = max run-up/wave height (m)
 * (Soloviev 1970; used by the NOAA NCEI / NGDC tsunami database).
 */
export const tsunamiIntensity = H => Math.log2(Math.SQRT2 * Math.max(H, 1e-3));

/** Tsunami level 0–5 from max water height (m): I<1 ->1, [1,2) ->2, [2,3) ->3, [3,4) ->4, >=4 ->5. */
export function tsunamiLevelFromHeight(H) {
  if (!(H > 0)) return 0;
  const I = tsunamiIntensity(H);
  if (I < 1) return 1;
  if (I < 2) return 2;
  if (I < 3) return 3;
  if (I < 4) return 4;
  return 5;
}

// ---------------------------------------------------------------- volcanoes

/**
 * Volcanic hazard level 0–5 at distance d (km) from a volcano with maximum Holocene VEI v.
 * Distance bands follow the 10/30/100 km radii of the Volcano Population Exposure Index
 * (Brown et al. 2015, "Global Volcanic Hazards and Risk", Cambridge Univ. Press), extended to
 * 300/1000 km for the far-field ash fall of VEI>=4 / VEI>=6 eruptions (Newhall & Self 1982 VEI
 * definitions: column height and tephra volume grow ~10x per VEI step).
 */
export function volcanoLevelAt(dKm, vei) {
  const v = vei < 0 ? 1 : vei;               // no VEI on record -> weak (mostly effusive) activity
  if (dKm <= 30) return v >= 4 ? 5 : v >= 2 ? 4 : 3;
  if (dKm <= 100) return v >= 5 ? 4 : v >= 3 ? 3 : 2;
  if (dKm <= 300) return v >= 6 ? 3 : v >= 4 ? 2 : v >= 2 ? 1 : 0;
  if (dKm <= 1000) return v >= 7 ? 2 : v >= 6 ? 1 : 0;
  return 0;
}

// ---------------------------------------------------------------- meteorites

/**
 * Cumulative annual number of impacts with energy >= E (kt TNT) from
 * Brown et al. (2002), Nature 420:294–296: N(>E) = 3.7 · E^−0.90.
 */
export const impactsPerYearAbove = Ekt => 3.7 * Math.pow(Ekt, -0.9);
/** Inverse CDF sample of energy (kt) above Emin for a uniform u in (0,1]. */
export const sampleImpactEnergy = (Emin, u) => Emin * Math.pow(Math.max(u, 1e-12), -1 / 0.9);

/** Meteorite level from recovered mass (kg): 1–10 ->1, 10–100 ->2, 100–1000 ->3, 1–10 t ->4, >10 t ->5. */
export function meteoriteLevelFromMass(kg) {
  if (!(kg > 0)) return 1;
  if (kg < 10) return 1;
  if (kg < 100) return 2;
  if (kg < 1000) return 3;
  if (kg < 10000) return 4;
  return 5;
}
/** Airburst level from energy (kt): <500 ->2, 0.5–5 Mt ->3, 5–50 Mt ->4, >50 Mt ->5. */
export function airburstLevel(Ekt) {
  if (Ekt < 500) return 2;
  if (Ekt < 5000) return 3;
  if (Ekt < 50000) return 4;
  return 5;
}

/** Eruption event level 0–5 from VEI (unknown -> 1). */
const VEI_LEVEL = [1, 1, 2, 3, 3, 4, 5, 5, 5];
export const eruptionLevel = vei => (vei == null || vei < 0 ? 1 : VEI_LEVEL[Math.min(8, vei | 0)]);

// ---------------------------------------------------------------- landslides

/** Slope-class thresholds on the mean ~5 km terrain gradient (m/km), classes 1..5. */
export const SLOPE_CLASS_MKM = [8, 18, 32, 55, 85];
export function slopeClass(g) {
  const T = SLOPE_CLASS_MKM;
  return g < T[0] ? 0 : g < T[1] ? 1 : g < T[2] ? 2 : g < T[3] ? 3 : g < T[4] ? 4 : 5;
}
/**
 * Landslide susceptibility 0–5: slope class scaled by a trigger factor from wetness (0..1)
 * and the earthquake level (0..5). A simple heuristic in the spirit of the NASA global landslide
 * susceptibility map (Stanley & Kirschbaum 2017: slope dominant, modulated by triggers).
 */
export function landslideSusceptibility(gradMkm, wet01, quakeLevel) {
  const s = slopeClass(gradMkm);
  if (!s) return 0;
  const f = 0.45 + 0.35 * Math.max(0, Math.min(1, wet01)) + 0.25 * Math.min(1, quakeLevel / 4);
  return Math.max(1, Math.min(5, Math.round(s * f)));
}
/** Global rate of fatal non-seismic landslides, Froude & Petley (2018), NHESS 18:2161 (4862 in 2004–2016). */
export const LANDSLIDES_PER_YEAR = 4862 / 13;
