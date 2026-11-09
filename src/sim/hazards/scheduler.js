// Natural-hazard scheduler for 5000 BC – 2100 AD.
//
//   const sched = createScheduler({ data: await loadHazards(), seed: 12345 });
//   sched.eventsBetween(t0, t1)   // [{type, t, lat, lon, magnitude, vei, level, name, documented, ...}] sorted by t
//
// Time t = days since -4999-01-01 00:00 (astronomical years, proleptic Gregorian; see time.js).
// Documented events come from the baked catalogues (GVP, NOAA NCEI, USGS, NASA). Gaps are filled
// stochastically and deterministically (seeded, keyed per year), so any window can be queried in
// any order with identical results and the scheduler state is fully described by the seed:
//   - earthquakes: instrumental (USGS 1900–2025, M>=6) rates per 5°x5° zone, scaled to the complete
//     1964–2025 global rate (completeness factor); before 1900 only the per-century deficit relative
//     to the documented record is added; after the catalogue end the full rate. Locations bootstrap instrumental epicentres, magnitudes follow Gutenberg–Richter (b=1)
//     truncated at the zone maximum.
//   - eruptions: per VEI class global rates over the period in which the GVP record is near complete
//     (VEI<=2: 1960+, 3: 1900+, 4: 1800+, 5: 1500+, 6: 1 AD+, 7: whole window); deficits before that,
//     full rate after the catalogue end; volcanoes chosen by their activity / max VEI.
//   - tsunamis: triggered by stochastic shallow offshore M>=7 earthquakes (empirical probability
//     from the instrumental era) and by large coastal eruptions.
//   - meteorites: witnessed falls (modern rate 1950–catalogue end), airbursts >= 100 kt from the
//     Brown et al. (2002) flux N(>E) = 3.7·E^-0.9 per year.
//   - landslides: Froude & Petley (2018) global rate distributed over steep, wet, seismic cells, plus
//     co-seismic landslides after M>=6.5 earthquakes on susceptible ground.
// Stochastic events never coincide with documented ones (the same volcano within a year of a
// documented eruption, counted from its onset to its paroxysm, or an earthquake within 30 days and
// 150 km of a documented one, are rejected).
//
// Returned event objects are frozen and shared between calls; treat them as read-only.
import { ymdToT, tToYmd, yearStartT, daysInMonth, daysInYear, START_YEAR, END_YEAR, T_END } from './time.js';
import { Rng, hashUnit, hashString } from './rng.js';
import {
  simCellOf, simLat, simLon, SIM_W, distKm, offsetKm, quakeIntensityAt, intensityToLevel, tsunamiLevelFromHeight,
  meteoriteLevelFromMass, airburstLevel, impactsPerYearAbove, sampleImpactEnergy, ruptureLengthKm, eruptionLevel,
  landslideSusceptibility, LANDSLIDES_PER_YEAR,
} from './physics.js';

export const HAZARD_TYPES = Object.freeze(['eruption', 'earthquake', 'tsunami', 'meteorite', 'landslide']);
/** Russian display names of the hazard types. */
export const HAZARD_NAMES_RU = Object.freeze({
  eruption: 'Извержение вулкана', earthquake: 'Землетрясение', tsunami: 'Цунами', meteorite: 'Падение метеорита', landslide: 'Оползень',
});
/** Meaning of `magnitude` per type. */
export const MAGNITUDE_UNITS = Object.freeze({
  eruption: 'VEI', earthquake: 'Mw (best available magnitude)', tsunami: 'max water height, m',
  meteorite: 'fall: recovered mass, kg; airburst: energy, kt TNT', landslide: 'log10 volume, m³ (nominal)',
});

const K_ER = 1, K_EQ = 2, K_TS = 3, K_MT = 4, K_LS = 5;
const INSTR_Y0 = 1900, INSTR_Y1 = 2025, COMPLETE_Y0 = 1964;
const T_1900 = ymdToT(1900, 1, 1);
const MIN10 = 10 / 1440;
// Documented history is the same in every world: unknown date parts are placed with a fixed salt.
const DOC_SALT = 0x48415a44;

const table = json => { const f = {}; json.fields.forEach((n, i) => { f[n] = i; }); return { f, rows: json.rows }; };
const r1 = v => Math.round(v * 10) / 10;
const r3 = v => Math.round(v * 1000) / 1000;
const centuryOf = y => Math.floor((y + 5000) / 100);           // -4999 -> 0
const NCENT = centuryOf(END_YEAR) + 1;
/** Years of century c that lie inside the game window and before the reference (complete-record) year. */
const defYears = (c, ref) => { const s = c * 100 - 5000; return Math.max(1, Math.min(s + 100, ref) - Math.max(s, START_YEAR)); };
const cmpEv = (a, b) => (a.t - b.t) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function lowerBound(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (arr[m] < x) lo = m + 1; else hi = m; }
  return lo;
}
function buildCdf(weights) {
  const cdf = new Float64Array(weights.length);
  let s = 0;
  for (let i = 0; i < weights.length; i++) { if (weights[i] > 0) s += weights[i]; cdf[i] = s; }
  return { cdf, total: s };
}
function sampleCdf(c, u) {
  const x = u * c.total, a = c.cdf;
  let lo = 0, hi = a.length - 1;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (a[m] <= x) lo = m + 1; else hi = m; }
  return lo;
}

/** Deterministic placement of a catalogue date with unknown parts inside its year/month/day. */
function placeT(seed, kind, idx, y, m, d, h, mi) {
  const u = hashUnit(seed, kind, idx, 7);
  if (!m) return yearStartT(y) + u * daysInYear(y);
  if (!d) return ymdToT(y, m, 1) + u * daysInMonth(y, m);
  if (h == null || h < 0) return ymdToT(y, m, d) + u;
  return ymdToT(y, m, d, h + (mi != null && mi >= 0 ? mi : Math.floor(u * 60)) / 60);
}

/**
 * @param {object} args
 * @param {object} args.data   output of loadHazards()
 * @param {number|string} [args.seed=1]
 * @param {object} [args.options]
 *   minQuakeMagnitude (6)      lower magnitude of stochastic earthquakes (>= 6)
 *   landslidesPerYear (374)    global rate of stochastic rain-triggered landslides
 *   airburstMinKt (100)        smallest stochastic airburst energy
 *   annualPrecip (null)        optional Float32Array/Uint16Array(720*360) mm/yr to replace the wetness proxy
 *   coseismicLandslides (true)
 *   cacheYears (256)           size of the per-year stochastic cache
 */
export function createScheduler({ data, seed = 1, options = {} } = {}) {
  if (!data || !data.levels) throw new Error('createScheduler: data from loadHazards() is required');
  const SEED = typeof seed === 'string' ? hashString(seed) : (Math.floor(Number(seed)) >>> 0);
  const opt = {
    minQuakeMagnitude: 6, landslidesPerYear: LANDSLIDES_PER_YEAR, airburstMinKt: 100, annualPrecip: null,
    coseismicLandslides: true, cacheYears: 256, ...options,
  };
  const minMag = Math.max(6, opt.minQuakeMagnitude);
  const L = data.levels, lay = L.layers, placeNames = L.meta.places || [];
  const placeAt = cell => placeNames[L.place[cell]] || '';
  const rng = new Rng(SEED);

  // ================================================================ documented events
  const docs = [];
  const V = table(data.volcanoes), vf = V.f;
  const vol = V.rows.map(r => ({ gvp: r[vf.gvp], name: r[vf.name], lat: r[vf.lat], lon: r[vf.lon], maxVei: r[vf.maxVei] }));
  const erIv = vol.map(() => []);                          // documented [onset, paroxysm] spans per volcano

  const E = table(data.eruptions), ef = E.f;
  const erDocs = [];
  E.rows.forEach((r, i) => {
    const v = vol[r[ef.v]];
    const fl = r[ef.flags], climax = (fl & 8) !== 0;
    const t0 = placeT(DOC_SALT, K_ER, i, r[ef.y], r[ef.m], r[ef.d], -1, -1);
    const t = climax ? placeT(DOC_SALT, K_ER, i, r[ef.cy], r[ef.cm], r[ef.cd], -1, -1) : t0;
    const vei = r[ef.vei] >= 0 ? r[ef.vei] : null;
    const ev = {
      id: `er:${i}`, type: 'eruption', t, lat: v.lat, lon: v.lon, magnitude: vei, vei, level: eruptionLevel(vei), name: v.name,
      documented: true, src: 'GVP', volcano: r[ef.v], gvp: v.gvp, tStart: t0, uncertain: (fl & 1) !== 0, deaths: r[ef.deaths] || 0,
    };
    docs.push(ev); erDocs.push(ev); erIv[r[ef.v]].push([Math.min(t0, t), Math.max(t0, t)]);
  });
  const erStart = [], erEnd = [], erMaxLen = new Float64Array(vol.length);
  erIv.forEach((iv, k) => {
    iv.sort((p, q) => p[0] - q[0]);
    erStart.push(Float64Array.from(iv, p => p[0])); erEnd.push(Float64Array.from(iv, p => p[1]));
    for (const p of iv) erMaxLen[k] = Math.max(erMaxLen[k], p[1] - p[0]);
  });

  const Q = table(data.earthquakes), qf = Q.f, qPlaces = data.earthquakes.places || [];
  const eqDocs = [];
  Q.rows.forEach((r, i) => {
    const fl = r[qf.flags];
    const ev = {
      id: `eq:${i}`, type: 'earthquake', t: placeT(DOC_SALT, K_EQ, i, r[qf.y], r[qf.m], r[qf.d], r[qf.h], r[qf.mi]),
      lat: r[qf.lat], lon: r[qf.lon], magnitude: r[qf.mag], vei: null, level: r[qf.level], name: qPlaces[r[qf.place]] || '',
      documented: true, src: fl & 2 ? (fl & 1 ? 'NCEI+USGS' : 'USGS') : 'NCEI', depth: r[qf.dep] >= 0 ? r[qf.dep] : null,
      intensity: r[qf.I0], deaths: r[qf.deaths] || 0, magnitudeEstimated: (fl & 4) !== 0, tsunami: (fl & 16) !== 0,
      tsunamiId: r[qf.ts] || 0, year: r[qf.y],
    };
    docs.push(ev); eqDocs.push(ev);
  });
  const eqByTsunami = new Map();
  for (const q of eqDocs) if (q.tsunamiId) eqByTsunami.set(q.tsunamiId, q);

  const TS = table(data.tsunamis), tf = TS.f;
  const tsH = new Map();
  TS.rows.forEach((r, i) => {
    const id = r[tf.id], H = r[tf.maxH] >= 0 ? r[tf.maxH] : null;
    const q = eqByTsunami.get(id);
    // follow the linked earthquake when the catalogue dates agree (keeps random placement consistent)
    const t = q && q.year === r[tf.y] ? q.t + MIN10 : placeT(DOC_SALT, K_TS, i, r[tf.y], r[tf.m], r[tf.d], r[tf.h], r[tf.mi]) + MIN10;
    if (H != null) tsH.set(id, H);
    docs.push({
      id: `ts:${id}`, type: 'tsunami', t, lat: r[tf.lat], lon: r[tf.lon], magnitude: H, vei: null, level: r[tf.level],
      name: qPlaces[r[tf.place]] || '', documented: true, src: 'NCEI', cause: r[tf.cause], validity: r[tf.validity],
      uncertain: r[tf.validity] < 3, deaths: r[tf.deaths] || 0,
    });
  });

  const MT = table(data.meteorites), mf = MT.f;
  let lastFallYear = 1950;
  const refFallMass = [];
  let refFalls = 0;
  const fallsPerCentury = new Float32Array(NCENT);
  MT.rows.forEach((r, i) => {
    const fall = r[mf.fall];
    if (fall === 0) return;                                   // finds: catalogue only, not events
    const y = r[mf.y];
    const kg = r[mf.massKg] > 0 ? r[mf.massKg] : null, E = r[mf.energyKt] > 0 ? r[mf.energyKt] : null;
    if (fall === 1) {
      lastFallYear = Math.max(lastFallYear, y);
      if (y >= 1950) { refFalls++; if (kg) refFallMass.push(kg); }
      if (y >= START_YEAR && y < 1950) fallsPerCentury[centuryOf(y)]++;
    }
    docs.push({
      id: `mt:${i}`, type: 'meteorite', t: placeT(DOC_SALT, K_MT, i, y, r[mf.m], r[mf.d], -1, -1), lat: r[mf.lat], lon: r[mf.lon],
      magnitude: fall === 2 ? E : kg, vei: null, level: r[mf.level], name: r[mf.name], documented: true, src: 'NASA',
      kind: fall === 2 ? 'airburst' : 'fall', massKg: kg, energyKt: E,
    });
  });

  docs.sort(cmpEv);
  for (const ev of docs) Object.freeze(ev);
  const docT = Float64Array.from(docs, e => e.t);
  const T_EQ_END = eqDocs.reduce((m, e) => Math.max(m, e.t), 0);          // "present day" of the data
  const T_ER_END = erDocs.reduce((m, e) => Math.max(m, e.t), 0);
  const T_MT_END = yearStartT(lastFallYear + 1);

  // documented earthquakes sorted by time, for duplicate rejection
  const eqSorted = eqDocs.slice().sort((a, b) => a.t - b.t);
  const eqT = Float64Array.from(eqSorted, e => e.t);
  function nearDocumentedQuake(t, lat, lon) {
    for (let i = lowerBound(eqT, t - 30); i < eqT.length && eqT[i] <= t + 30; i++) {
      if (distKm(lat, lon, eqSorted[i].lat, eqSorted[i].lon) < 150) return true;
    }
    return false;
  }

  // ================================================================ earthquake rates
  const ZW = 72, ZH = 36, NZ = ZW * ZH;
  const zoneOf = (lat, lon) => Math.min(ZH - 1, Math.max(0, Math.floor((90 - lat) / 5))) * ZW + ((Math.floor((lon + 180) / 5) % ZW) + ZW) % ZW;
  const instr = Array.from({ length: NZ }, () => []);
  const zMax = new Float32Array(NZ);
  const eqDef = new Float32Array(NZ * NCENT);                 // documented M>=minMag per zone and century (pre-1900)
  for (const q of eqDocs) {
    const z = zoneOf(q.lat, q.lon);
    if (q.magnitude > zMax[z]) zMax[z] = q.magnitude;
    if (q.magnitude < minMag) continue;
    if (q.year >= INSTR_Y0 && q.year <= INSTR_Y1 && q.src !== 'NCEI') instr[z].push(q);
    else if (q.year < INSTR_Y0 && q.year >= START_YEAR) eqDef[z * NCENT + centuryOf(q.year)]++;
  }
  // The M>=6 record is incomplete before the ISC era (1900s: ~35/yr, 1964–2025: ~135/yr), so the
  // 1900–2025 zone counts give the spatial pattern and a global completeness factor (rate over
  // COMPLETE_Y0–INSTR_Y1 / rate over the whole span) restores the modern annual rate.
  let nAllInstr = 0, nComplete = 0;
  for (let z = 0; z < NZ; z++) for (const q of instr[z]) { nAllInstr++; if (q.year >= COMPLETE_Y0) nComplete++; }
  const completeness = nAllInstr && nComplete
    ? (nComplete / (INSTR_Y1 - COMPLETE_Y0 + 1)) / (nAllInstr / (INSTR_Y1 - INSTR_Y0 + 1)) : 1;
  const lambda = new Float64Array(NZ);
  for (let z = 0; z < NZ; z++) lambda[z] = completeness * instr[z].length / (INSTR_Y1 - INSTR_Y0 + 1);
  const zMmax = Float32Array.from(zMax, m => Math.min(9.5, Math.max(minMag + 0.5, m + 0.3)));
  const eqFuture = buildCdf(lambda);
  const eqCentury = new Map();
  function eqCenturyCdf(c) {
    let cdf = eqCentury.get(c);
    if (!cdf) {
      const w = new Float64Array(NZ);
      for (let z = 0; z < NZ; z++) w[z] = Math.max(0, lambda[z] - eqDef[z * NCENT + c] / defYears(c, INSTR_Y0));
      cdf = buildCdf(w); eqCentury.set(c, cdf);
    }
    return cdf;
  }

  // empirical tsunami probability for shallow offshore quakes (instrumental era) + run-up samples
  const TS_BINS = [7, 7.5, 8, 8.5];
  const tsN = [0, 0, 0, 0], tsK = [0, 0, 0, 0], tsHs = [[], [], [], []];
  const binOf = M => (M >= 8.5 ? 3 : M >= 8 ? 2 : M >= 7.5 ? 1 : 0);
  const offshore = (lat, lon) => { const c = simCellOf(lat, lon); return lay.land[c] <= 128 || lay.coast[c] === 1; };
  for (const q of eqDocs) {
    if (q.magnitude < 7 || (q.depth != null && q.depth > 70)) continue;
    const b = binOf(q.magnitude);
    if (q.tsunamiId && tsH.get(q.tsunamiId) > 0) tsHs[b].push(Math.min(60, tsH.get(q.tsunamiId)));
    if (q.year < INSTR_Y0 || q.year > INSTR_Y1 || q.src === 'NCEI' || !offshore(q.lat, q.lon)) continue;
    tsN[b]++; if (q.tsunami || q.tsunamiId) tsK[b]++;
  }
  const TS_DEFAULT = [0.2, 0.4, 0.7, 0.9];
  const tsProb = tsN.map((n, b) => (n >= 5 ? tsK[b] / n : TS_DEFAULT[b]));

  // ================================================================ eruption rates
  const ER_CLASSES = [
    { lo: -1, hi: 2, ref: 1960 }, { lo: 3, hi: 3, ref: 1900 }, { lo: 4, hi: 4, ref: 1800 },
    { lo: 5, hi: 5, ref: 1500 }, { lo: 6, hi: 6, ref: 1 }, { lo: 7, hi: 8, ref: START_YEAR },
  ];
  const erClass = vei => (vei == null || vei <= 2 ? 0 : vei >= 7 ? 5 : vei - 2);
  const erRate = new Float64Array(ER_CLASSES.length);
  const erDef = new Float32Array(ER_CLASSES.length * NCENT);
  const small = [0, 0, 0];
  const nAll = new Float64Array(vol.length), nRecent = new Float64Array(vol.length);
  const nBig = ER_CLASSES.map(() => new Float64Array(vol.length));
  for (const e of erDocs) {
    const y = tToYmd(e.tStart).year, k = erClass(e.vei);
    nAll[e.volcano]++; if (y >= 1800) nRecent[e.volcano]++;
    for (let j = 0; j <= k; j++) nBig[j][e.volcano]++;
    if (!e.uncertain && y >= ER_CLASSES[k].ref && y <= INSTR_Y1) {
      erRate[k]++;
      if (k === 0 && e.vei != null) small[e.vei]++;
    }
    if (y < ER_CLASSES[k].ref) erDef[k * NCENT + centuryOf(y)]++;
  }
  ER_CLASSES.forEach((c, k) => { erRate[k] /= INSTR_Y1 - c.ref + 1; });
  const smallTotal = small[0] + small[1] + small[2] || 1;
  const smallCdf = [small[0] / smallTotal, (small[0] + small[1]) / smallTotal];
  const volCdf = ER_CLASSES.map((c, k) => buildCdf(vol.map((v, i) => {
    if (k <= 1) return 0.05 + nAll[i] + 2 * nRecent[i];
    if (!(v.maxVei >= c.lo - 1)) return 0;
    return 0.5 + 3 * nBig[k][i] + 0.1 * nAll[i];
  })));

  // ================================================================ meteorite rates
  const fallRate = refFalls / Math.max(1, lastFallYear - 1950 + 1);
  const airburstRate = impactsPerYearAbove(opt.airburstMinKt);
  const N = L.meta.layerBytes;
  const landW = new Float64Array(N);
  for (let i = 0; i < N; i++) landW[i] = (lay.land[i] / 255) * Math.cos(simLat(Math.floor(i / SIM_W)) * Math.PI / 180);
  const landCdf = buildCdf(landW);

  // ================================================================ landslide model
  const susc = new Uint8Array(N);
  if (opt.annualPrecip) {
    for (let i = 0; i < N; i++) {
      if (lay.land[i] < 13) continue;
      const wet = Math.min(1, Math.max(0, opt.annualPrecip[i] / 2000));
      susc[i] = landslideSusceptibility(lay.slope[i], wet, lay.quake[i]);
    }
  } else susc.set(lay.landslide);
  const lsW = new Float64Array(N);
  for (let i = 0; i < N; i++) if (susc[i]) lsW[i] = susc[i] * susc[i] * landW[i];
  const lsCdf = buildCdf(lsW);

  // ================================================================ per-year stochastic buckets
  const cellPoint = (cell, u1, u2) => {
    const y = Math.floor(cell / SIM_W), x = cell - y * SIM_W;
    return [r3(simLat(y) + (u1 - 0.5) * 0.5), r3(simLon(x) + (u2 - 0.5) * 0.5)];
  };
  const yearSpan = (y, from) => {
    const a = Math.max(yearStartT(y), from), b = yearStartT(y + 1);
    return [a, b, Math.max(0, (b - a) / (b - yearStartT(y)))];
  };

  function genQuakes(y, out) {
    let cdf, a, b, frac;
    if (y < INSTR_Y0) { cdf = eqCenturyCdf(centuryOf(y)); [a, b, frac] = yearSpan(y, -Infinity); }
    else { [a, b, frac] = yearSpan(y, T_EQ_END); if (frac <= 0) return; cdf = eqFuture; }
    rng.reseed(SEED, K_EQ, y, 1);
    const n = rng.poisson(cdf.total * frac);
    const lnTop = 1 - 1e-12;
    for (let k = 0; k < n; k++) {
      const t = a + rng.next() * (b - a);
      const z = sampleCdf(cdf, rng.next());
      const list = instr[z];
      const src = list[rng.int(list.length)];
      const [lat, lon] = offsetKm(src.lat, src.lon, Math.abs(rng.normal()) * 20, rng.next() * 2 * Math.PI);
      const depth = src.depth != null ? Math.max(1, src.depth * (0.8 + 0.4 * rng.next())) : 10 + 20 * rng.next();
      const u = Math.min(lnTop, rng.next());
      const M = minMag - Math.log10(1 - u * (1 - Math.pow(10, -(zMmax[z] - minMag))));
      const uTs = rng.next(), uH = rng.next(), uH2 = rng.next();
      if (nearDocumentedQuake(t, lat, lon)) continue;
      const ev = {
        id: `~eq:${y}:${k}`, type: 'earthquake', t, lat: r3(lat), lon: r3(lon), magnitude: r1(M), vei: null,
        level: intensityToLevel(quakeIntensityAt(M, 0, depth)), name: src.name, documented: false, src: 'stochastic', depth: Math.round(depth),
      };
      out.push(ev);
      // tsunami from shallow offshore great quakes
      if (M >= 7 && depth <= 70 && offshore(lat, lon) && uTs < tsProb[binOf(M)]) {
        const hs = tsHs[binOf(M)];
        const H = hs.length >= 3 ? hs[Math.floor(uH * hs.length)] : Math.min(60, Math.pow(10, -0.3 + 0.6 * (M - 7) + 0.4 * (uH2 * 2 - 1)));
        out.push({
          id: `~ts:${y}:q${k}`, type: 'tsunami', t: t + MIN10, lat: ev.lat, lon: ev.lon, magnitude: r1(H), vei: null,
          level: tsunamiLevelFromHeight(H), name: src.name, documented: false, src: 'stochastic', cause: 1, sourceId: ev.id,
        });
      }
    }
  }

  function genEruptions(y, out) {
    const c = centuryOf(y);
    for (let k = 0; k < ER_CLASSES.length; k++) {
      let rate, a, b, frac;
      if (y < ER_CLASSES[k].ref) { rate = Math.max(0, erRate[k] - erDef[k * NCENT + c] / defYears(c, ER_CLASSES[k].ref)); [a, b, frac] = yearSpan(y, -Infinity); }
      else { [a, b, frac] = yearSpan(y, T_ER_END); rate = erRate[k]; }
      if (!(rate > 0) || frac <= 0) continue;
      rng.reseed(SEED, K_ER, y, 10 + k);
      const n = rng.poisson(rate * frac);
      for (let j = 0; j < n; j++) {
        const t = a + rng.next() * (b - a);
        let vi = sampleCdf(volCdf[k], rng.next());
        const alt = sampleCdf(volCdf[k], rng.next());
        const uv = rng.next(), uTs = rng.next(), uH = rng.next();
        if (clashesWithDocumented(vi, t)) { vi = alt; if (clashesWithDocumented(vi, t)) continue; }
        const vei = k === 0 ? (uv < smallCdf[0] ? 0 : uv < smallCdf[1] ? 1 : 2) : k === 5 ? 7 : k + 2;
        const v = vol[vi];
        const ev = {
          id: `~er:${y}:${k}:${j}`, type: 'eruption', t, lat: v.lat, lon: v.lon, magnitude: vei, vei, level: eruptionLevel(vei),
          name: v.name, documented: false, src: 'stochastic', volcano: vi, gvp: v.gvp, tStart: t,
        };
        out.push(ev);
        // volcanic tsunami (caldera collapse, pyroclastic flows into the sea)
        if (vei >= 4) {
          const cell = simCellOf(v.lat, v.lon);
          const coastal = lay.coast[cell] === 1 || lay.land[cell] < 200;
          const p = vei >= 6 ? 0.4 : 0.03;
          if (coastal && uTs < p) {
            const H = vei >= 6 ? 5 + 35 * uH : 1 + 9 * uH;
            out.push({
              id: `~ts:${y}:e${k}:${j}`, type: 'tsunami', t: t + MIN10, lat: v.lat, lon: v.lon, magnitude: r1(H), vei: null,
              level: tsunamiLevelFromHeight(H), name: v.name, documented: false, src: 'stochastic', cause: 6, sourceId: ev.id,
            });
          }
        }
      }
    }
  }
  /** True when t is within a year of a documented eruption of volcano vi (onset .. paroxysm). */
  function clashesWithDocumented(vi, t) {
    const a = erStart[vi], e = erEnd[vi], lo = t - 365 - erMaxLen[vi];
    for (let j = lowerBound(a, t + 365 + 1e-9) - 1; j >= 0 && a[j] >= lo; j--) if (e[j] >= t - 365) return true;
    return false;
  }

  function genMeteorites(y, out) {
    // witnessed falls
    let rate, a, b, frac;
    if (y < 1950) { rate = Math.max(0, fallRate - fallsPerCentury[centuryOf(y)] / defYears(centuryOf(y), 1950)); [a, b, frac] = yearSpan(y, -Infinity); }
    else { [a, b, frac] = yearSpan(y, T_MT_END); rate = fallRate; }
    if (rate > 0 && frac > 0) {
      rng.reseed(SEED, K_MT, y, 1);
      const n = rng.poisson(rate * frac);
      for (let k = 0; k < n; k++) {
        const t = a + rng.next() * (b - a);
        const cell = sampleCdf(landCdf, rng.next());
        const [lat, lon] = cellPoint(cell, rng.next(), rng.next());
        const kg = refFallMass.length ? refFallMass[rng.int(refFallMass.length)] : 1 + 50 * rng.next();
        out.push({
          id: `~mt:${y}:${k}`, type: 'meteorite', t, lat, lon, magnitude: kg, vei: null, level: meteoriteLevelFromMass(kg),
          name: placeAt(cell), documented: false, src: 'stochastic', kind: 'fall', massKg: kg, energyKt: null,
        });
      }
    }
    // airbursts (record treated as complete 1900 – present)
    if (y < INSTR_Y0) [a, b, frac] = yearSpan(y, -Infinity);
    else [a, b, frac] = yearSpan(y, T_EQ_END);
    if (frac > 0) {
      rng.reseed(SEED, K_MT, y, 2);
      const n = rng.poisson(airburstRate * frac);
      for (let k = 0; k < n; k++) {
        const t = a + rng.next() * (b - a);
        const lat = Math.asin(2 * rng.next() - 1) * 180 / Math.PI, lon = rng.next() * 360 - 180;
        const Ekt = sampleImpactEnergy(opt.airburstMinKt, 1 - rng.next());
        out.push({
          id: `~ab:${y}:${k}`, type: 'meteorite', t, lat: r3(lat), lon: r3(lon), magnitude: Math.round(Ekt), vei: null,
          level: airburstLevel(Ekt), name: placeAt(simCellOf(lat, lon)), documented: false, src: 'stochastic', kind: 'airburst',
          massKg: null, energyKt: Math.round(Ekt),
        });
      }
    }
  }

  function genLandslides(y, out, quakes) {
    const [a, b] = yearSpan(y, -Infinity);
    rng.reseed(SEED, K_LS, y, 1);
    const n = lsCdf.total > 0 ? rng.poisson(opt.landslidesPerYear) : 0;
    for (let k = 0; k < n; k++) {
      const t = a + rng.next() * (b - a);
      const cell = sampleCdf(lsCdf, rng.next());
      const [lat, lon] = cellPoint(cell, rng.next(), rng.next());
      const level = sampleLandslideLevel(susc[cell], rng.next());
      out.push({
        id: `~ls:${y}:${k}`, type: 'landslide', t, lat, lon, magnitude: r1(3 + level + rng.next()), vei: null, level,
        name: placeAt(cell), documented: false, src: 'stochastic', trigger: 'rain',
      });
    }
    if (!opt.coseismicLandslides) return;
    const r2 = new Rng(1);
    for (const q of quakes) {
      if (!(q.magnitude >= 6.5) || q.t < a || q.t >= b) continue;
      r2.reseed(SEED, K_LS, hashString(q.id), 2);
      const cnt = Math.min(6, r2.poisson(0.5 * Math.pow(q.magnitude - 6, 1.5)));
      const reach = ruptureLengthKm(q.magnitude) / 2 + 20;
      for (let k = 0; k < cnt; k++) {
        const [lat, lon] = offsetKm(q.lat, q.lon, reach * Math.sqrt(r2.next()), r2.next() * 2 * Math.PI);
        const dt = r2.next() * 0.1, um = r2.next();
        const cell = simCellOf(lat, lon);
        if (susc[cell] < 2 || lay.land[cell] < 64) continue;
        const level = Math.max(1, Math.min(5, Math.round(susc[cell] * (0.6 + 0.1 * (q.magnitude - 6)))));
        out.push({
          id: `~ls:${q.id}:${k}`, type: 'landslide', t: q.t + dt, lat: r3(lat), lon: r3(lon), magnitude: r1(3 + level + um), vei: null, level,
          name: placeAt(cell), documented: false, src: 'stochastic', trigger: 'earthquake', sourceId: q.id,
        });
      }
    }
  }
  const LS_P = [1, 0.35, 0.1225, 0.0429, 0.015];
  function sampleLandslideLevel(maxL, u) {
    let s = 0;
    for (let k = 0; k < maxL; k++) s += LS_P[k];
    let x = u * s;
    for (let k = 0; k < maxL; k++) { x -= LS_P[k]; if (x < 0) return k + 1; }
    return maxL;
  }

  const cache = new Map();
  function bucket(y) {
    let out = cache.get(y);
    if (out) { cache.delete(y); cache.set(y, out); return out; }
    out = [];
    genQuakes(y, out);
    genEruptions(y, out);
    genMeteorites(y, out);
    const ya = yearStartT(y), yb = yearStartT(y + 1);
    const quakes = out.filter(e => e.type === 'earthquake');
    for (let i = lowerBound(docT, ya); i < docs.length && docT[i] < yb; i++) if (docs[i].type === 'earthquake') quakes.push(docs[i]);
    genLandslides(y, out, quakes);
    out.sort(cmpEv);
    for (const ev of out) Object.freeze(ev);
    cache.set(y, out);
    if (cache.size > opt.cacheYears) cache.delete(cache.keys().next().value);
    return out;
  }

  // ================================================================ public API
  /**
   * Events with t0 <= t < t1, sorted by t.
   * @param {number} t0 @param {number} t1
   * @param {{types?: string[], minLevel?: number, documented?: boolean}} [filter]
   */
  function eventsBetween(t0, t1, filter) {
    const a = Math.max(0, t0), b = Math.min(T_END, t1);
    if (!(b > a)) return [];
    const types = filter?.types ? new Set(filter.types) : null;
    const minLevel = filter?.minLevel ?? 0;
    const onlyDoc = filter?.documented;
    const pass = ev => (!types || types.has(ev.type)) && ev.level >= minLevel && (onlyDoc == null || ev.documented === onlyDoc);
    const res = [];
    for (let i = lowerBound(docT, a); i < docs.length && docT[i] < b; i++) if (pass(docs[i])) res.push(docs[i]);
    if (onlyDoc !== true) {
      const y0 = tToYmd(a).year, y1 = tToYmd(b - 1e-7).year;
      // the previous year is scanned for events spilling over a year boundary (tsunami delays)
      for (let y = Math.max(START_YEAR, y0 - 1); y <= Math.min(END_YEAR, y1); y++) {
        for (const ev of bucket(y)) if (ev.t >= a && ev.t < b && pass(ev)) res.push(ev);
      }
    }
    res.sort(cmpEv);
    return res;
  }

  /** Hazard levels of the SIM cell containing (lat, lon). */
  function levelsAt(lat, lon) {
    const c = simCellOf(lat, lon);
    return {
      cell: c, quake: lay.quake[c], tsunami: lay.tsunami[c], volcano: lay.volcano[c], landslide: susc[c],
      intensity: lay.quakeI10[c] / 10, place: placeAt(c),
    };
  }

  function stats() {
    const pre = eqCenturyCdf(centuryOf(1000)).total;
    return {
      seed: SEED, documented: docs.length,
      catalogueEnd: { earthquakes: tToYmd(T_EQ_END), eruptions: tToYmd(T_ER_END), meteoriteFalls: lastFallYear },
      ratesPerYear: {
        earthquakesInstrumental: eqFuture.total, earthquakeCompleteness: completeness, earthquakeDeficitYear1000: pre,
        eruptionsByClass: Array.from(erRate), meteoriteFalls: fallRate, airbursts: airburstRate, landslides: opt.landslidesPerYear,
      },
      tsunamiProbability: tsProb,
    };
  }

  return Object.freeze({
    seed: SEED, eventsBetween, levelsAt, stats,
    /** All documented catalogue events (sorted, frozen). */
    documented: () => docs,
    /** Russian display label for an event, e.g. «Извержение вулкана Везувий». */
    label: ev => `${HAZARD_NAMES_RU[ev.type]}${ev.name ? (ev.type === 'eruption' ? ' ' : ' — ') + ev.name : ''}`,
  });
}
