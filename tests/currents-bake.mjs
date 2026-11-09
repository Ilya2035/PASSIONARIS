// Ocean currents baker / validator (module "currents").
//
//   tools/node/node.exe tests/currents-bake.mjs           -> validate public/assets/ocean/currents.json
//   tools/node/node.exe tests/currents-bake.mjs --write   -> rebuild it from currents.src.json
//
// Source: public/assets/ocean/currents.src.json — hand-authored waypoints (flow order).
// Bake: centripetal Catmull-Rom smoothing on the sphere, resampling every ~1 deg,
// then every point is nudged off land (keeping a coastal clearance where the sea
// allows it) and every segment is sampled along its great-circle arc every <= 1.2 km
// (finer than a MAP texel, so no headland or islet is clipped between checks); a
// segment that touches land gets a nudged midpoint inserted. Fully deterministic.
//
// Lives in tests/ because ENGINE.md gives the currents module no scripts/ folder;
// without --write it only reads and validates, so it is harmless under `node --test`.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const SRC = path.join(ROOT, 'public', 'assets', 'ocean', 'currents.src.json');
export const OUT = path.join(ROOT, 'public', 'assets', 'ocean', 'currents.json');
const CELLS = path.join(ROOT, 'public', 'assets', 'map', 'cells.bin.gz');

const DEG = Math.PI / 180;
const EARTH_KM = 6371.0088;
const STEP_DEG = 1.0;             // target spacing of baked path points
// preferred distance from land: about the half-width the renderer draws (so the band
// is not half over the coast), relaxed step by step in narrow straits
export function clearanceLadder(widthKm) {
  const hw = Math.min(420, Math.max(50, 40 + 0.6 * widthKm)) / 2;   // = displayHalfWidthKm() in the renderer
  const c = Math.round(Math.min(80, Math.max(28, hw)));
  return [...new Set([c, Math.round(c * 0.6), 16, 8, 0])].sort((a, b) => b - a);
}
const MAX_NUDGE_KM = 450;

// ---------------------------------------------------------------- water mask
let maskCache = null;
/** Water mask from the baked map: Uint8 W*H, 1 = open ocean (cell id 0). Cached per process. */
export function loadWaterMask(cellsPath = CELLS) {
  if (maskCache && maskCache.path === cellsPath) return maskCache;
  const buf = zlib.gunzipSync(fs.readFileSync(cellsPath));
  const W = 8192, H = 4096;
  if (buf.byteLength !== W * H * 4) throw new Error(`cells.bin.gz: unexpected size ${buf.byteLength}`);
  const cells = new Uint32Array(buf.buffer, buf.byteOffset, W * H);
  const water = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) water[i] = cells[i] === 0 ? 1 : 0;
  maskCache = { path: cellsPath, W, H, water };
  return maskCache;
}

// MAP-grid texel of a geographic point (same rule as scripts/bake-map.mjs and the GPU lookup)
export function cellIndex(mask, lon, lat) {
  const { W, H } = mask;
  let x = Math.floor((lon + 180) / 360 * W);
  x = ((x % W) + W) % W;
  const y = Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / 180 * H)));
  return y * W + x;
}
export const isWater = (mask, lon, lat) => mask.water[cellIndex(mask, lon, lat)] === 1;

/** true when every texel within rKm of (lon, lat) is ocean (rKm = 0: just the texel itself). */
export function isClear(mask, lon, lat, rKm) {
  if (!isWater(mask, lon, lat)) return false;
  if (rKm <= 0) return true;
  const { W, H, water } = mask;
  const cellKm = Math.PI * EARTH_KM / H;              // texel height, km
  const y0 = Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / 180 * H)));
  const x0 = ((Math.floor((lon + 180) / 360 * W) % W) + W) % W;
  const dy = Math.ceil(rKm / cellKm);
  for (let y = Math.max(0, y0 - dy); y <= Math.min(H - 1, y0 + dy); y++) {
    const ky = (y - y0) * cellKm;
    const rem = rKm * rKm - ky * ky;
    if (rem < 0) continue;
    const rowLat = 90 - (y + 0.5) * 180 / H;
    const cellX = Math.max(1e-3, cellKm * Math.cos(rowLat * DEG));
    const dx = Math.min(W >> 1, Math.ceil(Math.sqrt(rem) / cellX));
    const row = y * W;
    for (let k = -dx; k <= dx; k++) {
      const x = (((x0 + k) % W) + W) % W;
      if (water[row + x] !== 1) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------- sphere helpers
export const toVec = (lon, lat) => [Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG), Math.cos(lat * DEG) * Math.cos(lon * DEG)];
export function toGeo(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [Math.atan2(v[0], v[2]) / DEG, Math.asin(Math.max(-1, Math.min(1, v[1] / l))) / DEG];
}
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** great-circle angle between two [lon,lat] points, degrees */
export function arcDeg(a, b) {
  const u = toVec(a[0], a[1]), v = toVec(b[0], b[1]);
  const c = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return Math.atan2(Math.hypot(c[0], c[1], c[2]), dot(u, v)) / DEG;
}
/** point at fraction t along the great circle a->b ([lon,lat]) */
export function slerpGeo(a, b, t) {
  const u = toVec(a[0], a[1]), v = toVec(b[0], b[1]);
  const om = Math.acos(Math.max(-1, Math.min(1, dot(u, v))));
  if (om < 1e-9) return [a[0], a[1]];
  const s = Math.sin(om), ka = Math.sin((1 - t) * om) / s, kb = Math.sin(t * om) / s;
  return toGeo([u[0] * ka + v[0] * kb, u[1] * ka + v[1] * kb, u[2] * ka + v[2] * kb]);
}
/** destination from [lon,lat] by distance (km) and bearing (rad, clockwise from north) */
function destination(p, km, brg) {
  const d = km / EARTH_KM, la1 = p[1] * DEG, lo1 = p[0] * DEG;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(brg));
  const lo2 = lo1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return [wrapLon(lo2 / DEG), la2 / DEG];
}
export const wrapLon = lon => { let l = ((lon + 180) % 360 + 360) % 360 - 180; if (l === -180 && lon > 0) l = 180; return l; };
const r3 = x => Math.round(x * 1000) / 1000;
const roundGeo = p => [r3(wrapLon(p[0])), r3(Math.max(-89.999, Math.min(89.999, p[1])))];

// ---------------------------------------------------------------- smoothing + resampling
function catmullRom(src, samplesPerSeg = 24) {
  const V = src.map(p => toVec(p[0], p[1]));
  const n = V.length;
  const ext = (a, b) => norm([2 * a[0] - b[0], 2 * a[1] - b[1], 2 * a[2] - b[2]]);
  const P = i => (i < 0 ? ext(V[0], V[1]) : i >= n ? ext(V[n - 1], V[n - 2]) : V[i]);
  const out = [V[0]];
  for (let i = 0; i < n - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    // centripetal parametrisation (alpha = 0.5) avoids cusps and overshoot
    const dt = (a, b) => Math.max(1e-6, Math.sqrt(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])));
    const t0 = 0, t1 = t0 + dt(p0, p1), t2 = t1 + dt(p1, p2), t3 = t2 + dt(p2, p3);
    for (let k = 1; k <= samplesPerSeg; k++) {
      const t = t1 + (t2 - t1) * k / samplesPerSeg;
      const L = (pa, pb, ta, tb) => pa.map((_, j) => ((tb - t) * pa[j] + (t - ta) * pb[j]) / (tb - ta));
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
      out.push(norm(L(B1, B2, t1, t2)));
    }
  }
  return out;
}

function resample(vecs, stepDeg) {
  const seg = [];
  let total = 0;
  for (let i = 1; i < vecs.length; i++) {
    const a = Math.acos(Math.max(-1, Math.min(1, dot(vecs[i - 1], vecs[i]))));
    seg.push(a); total += a;
  }
  const n = Math.max(1, Math.ceil(total / (stepDeg * DEG)));
  const out = [toGeo(vecs[0])];
  let i = 0, acc = 0;
  for (let k = 1; k < n; k++) {
    const target = total * k / n;
    while (i < seg.length - 1 && acc + seg[i] < target) { acc += seg[i]; i++; }
    const f = seg[i] > 0 ? (target - acc) / seg[i] : 0;
    const a = vecs[i], b = vecs[i + 1];
    out.push(toGeo(norm([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f])));
  }
  out.push(toGeo(vecs[vecs.length - 1]));
  return out;
}

// ---------------------------------------------------------------- nudging
/** clearance (km) a point actually has, from the ladder; -1 = on land */
function clearanceOf(mask, p, ladder) {
  for (const c of ladder) if (isClear(mask, p[0], p[1], c)) return c;
  return -1;
}

/** move p to the nearest position with clearance >= want (km), preferring moves across the flow */
function nudge(mask, p, want, flowBrg) {
  for (let rho = 4; rho <= MAX_NUDGE_KM; rho += 4) {
    const nAng = Math.max(16, Math.ceil(2 * Math.PI * rho / 4));
    let best = null, bestScore = Infinity;
    for (let k = 0; k < nAng; k++) {
      const brg = 2 * Math.PI * k / nAng;
      const q = roundGeo(destination(p, rho, brg));
      if (!isClear(mask, q[0], q[1], want)) continue;
      // along-track displacement counts extra: keep points where they were along the path
      const along = flowBrg == null ? 0 : Math.abs(Math.cos(brg - flowBrg));
      const score = rho * (1 + 0.6 * along);
      if (score < bestScore) { bestScore = score; best = q; }
    }
    if (best) return { p: best, km: rho };
  }
  return null;
}

function bearing(a, b) {
  const la1 = a[1] * DEG, la2 = b[1] * DEG, dlo = (b[0] - a[0]) * DEG;
  return Math.atan2(Math.sin(dlo) * Math.cos(la2), Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dlo));
}

/** fix one point: best clearance it can get within reach, returns {p, km, clear} */
function settle(mask, p, flowBrg, ladder) {
  const have = clearanceOf(mask, p, ladder);
  if (have === ladder[0]) return { p, km: 0, clear: have };
  for (const want of ladder) {
    if (want <= have) return { p, km: 0, clear: have };
    const r = nudge(mask, p, want, flowBrg);
    // a move must stay proportionate to the clearance it buys; the last rung (0 = just water) always wins
    if (r && (want === 0 || r.km <= 1.6 * want + 12)) return { p: r.p, km: r.km, clear: want };
  }
  throw new Error(`no water within ${MAX_NUDGE_KM} km of ${p}`);
}

// Segment test: the whole great-circle arc is sampled finer than one MAP texel (~4.9 km
// N-S, less E-W at high latitude), so a segment cannot clip a headland or a small island
// between two checks. (The renderer interpolates the same great circles.)
export const SEG_STEP_KM = 1.2;
export const SEG_FRACTIONS = [0.25, 0.5, 0.75];   // kept for reference: the old, coarser check
/** interior sample fractions along a->b, spaced <= SEG_STEP_KM */
export function segmentFractions(a, b, stepKm = SEG_STEP_KM) {
  const n = Math.max(2, Math.ceil(arcDeg(a, b) * DEG * EARTH_KM / stepKm));
  const out = new Float64Array(n - 1);
  for (let k = 1; k < n; k++) out[k - 1] = k / n;
  return out;
}
/** true when every sample of the arc a->b (endpoints excluded) is open ocean */
export function segmentOnWater(mask, a, b, stepKm = SEG_STEP_KM) {
  for (const t of segmentFractions(a, b, stepKm)) { const q = slerpGeo(a, b, t); if (!isWater(mask, q[0], q[1])) return false; }
  return true;
}

function bakePath(mask, src, ladder, log) {
  let pts = resample(catmullRom(src), STEP_DEG).map(roundGeo);
  let maxKm = 0, moved = 0, tight = 0;
  const flowAt = (arr, i) => bearing(arr[Math.max(0, i - 1)], arr[Math.min(arr.length - 1, i + 1)]);
  const fixPoint = (arr, i) => {
    const r = settle(mask, arr[i], flowAt(arr, i), ladder);
    if (r.km > 0) { moved++; maxKm = Math.max(maxKm, r.km); }
    if (r.clear < ladder[0]) tight++;
    arr[i] = r.p;
  };
  for (let i = 0; i < pts.length; i++) fixPoint(pts, i);

  // light smoothing of nudge zig-zags, accepted only where it keeps the clearance it had
  for (let it = 0; it < 3; it++) {
    for (let i = 1; i < pts.length - 1; i++) {
      const a = toVec(...pts[i - 1]), b = toVec(...pts[i]), c = toVec(...pts[i + 1]);
      const q = roundGeo(toGeo(norm([a[0] + 2 * b[0] + c[0], a[1] + 2 * b[1] + c[1], a[2] + 2 * b[2] + c[2]])));
      if (clearanceOf(mask, q, ladder) >= Math.max(0, clearanceOf(mask, pts[i], ladder))) pts[i] = q;
    }
  }

  // drop near-duplicates created by nudging two neighbours to the same spot (compared with
  // the last point kept, before the segment pass so no unchecked segment is created later)
  const dedupe = arr => {
    const out = [arr[0]];
    for (let i = 1; i < arr.length; i++) {
      if (i < arr.length - 1 && arcDeg(out[out.length - 1], arr[i]) <= 0.05) continue;
      out.push(arr[i]);
    }
    return out;
  };
  pts = dedupe(pts);

  // segments: insert nudged midpoints until every arc sample is on water
  for (let pass = 0; pass < 16; pass++) {
    let changed = false;
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = out[out.length - 1], b = pts[i];
      if (!segmentOnWater(mask, a, b) && arcDeg(a, b) > 0.02) {
        const arr = [a, roundGeo(slerpGeo(a, b, 0.5)), b];
        fixPoint(arr, 1);
        // keep the inserted point only if it is a real new point (a nudge can land on a neighbour)
        if (arcDeg(a, arr[1]) > 0.01 && arcDeg(arr[1], b) > 0.01) { out.push(arr[1]); changed = true; }
      }
      out.push(b);
    }
    pts = out;
    if (!changed) break;
  }
  log({ moved, maxKm, tight, n: pts.length });
  return pts;
}

// ---------------------------------------------------------------- validation (also used by tests)
export const KINDS = ['warm', 'cold', 'neutral'];
/** returns a list of problems (empty = valid) */
export function validateCurrents(data, mask) {
  const errs = [];
  if (!data || !Array.isArray(data.currents)) return ['no currents[]'];
  const ids = new Set();
  for (const c of data.currents) {
    const tag = c && c.id;
    if (typeof c.id !== 'string' || !/^[a-z0-9_]+$/.test(c.id)) errs.push(`${tag}: bad id`);
    if (ids.has(c.id)) errs.push(`${tag}: duplicate id`);
    ids.add(c.id);
    if (typeof c.nameRu !== 'string' || !/[А-Яа-яЁё]/.test(c.nameRu)) errs.push(`${tag}: nameRu`);
    if (typeof c.nameEn !== 'string' || !c.nameEn) errs.push(`${tag}: nameEn`);
    if (!KINDS.includes(c.kind)) errs.push(`${tag}: kind`);
    if (!(Number.isFinite(c.speed) && c.speed > 0 && c.speed <= 3)) errs.push(`${tag}: speed`);
    if (!(Number.isFinite(c.widthKm) && c.widthKm >= 10 && c.widthKm <= 2000)) errs.push(`${tag}: widthKm`);
    if (c.seasonal !== null) {
      const s = c.seasonal;
      const okMonths = a => Array.isArray(a) && a.every(m => Number.isInteger(m) && m >= 1 && m <= 12);
      if (!s || typeof s.reverse !== 'boolean' || !okMonths(s.months) || !s.months.length) errs.push(`${tag}: seasonal`);
      else if (s.weakMonths !== undefined && (!okMonths(s.weakMonths) || s.weakMonths.some(m => s.months.includes(m)))) errs.push(`${tag}: seasonal.weakMonths`);
    }
    if (!Array.isArray(c.path) || c.path.length < 2) { errs.push(`${tag}: path`); continue; }
    for (let i = 0; i < c.path.length; i++) {
      const p = c.path[i];
      if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) { errs.push(`${tag}[${i}]: not a finite [lon,lat]`); continue; }
      if (Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) errs.push(`${tag}[${i}]: out of range`);
      if (mask && !isWater(mask, p[0], p[1])) errs.push(`${tag}[${i}] ${p}: on land`);
      if (i > 0) {
        const q = c.path[i - 1];
        if (!Array.isArray(q) || !q.every(Number.isFinite)) continue;
        const d = arcDeg(q, p);
        if (d > 3.5) errs.push(`${tag}[${i}]: step ${d.toFixed(2)} deg > 3.5`);
        if (d < 0.01) errs.push(`${tag}[${i}]: duplicate point`);
        if (mask) {
          for (const t of segmentFractions(q, p)) {
            const m = slerpGeo(q, p, t);
            if (!isWater(mask, m[0], m[1])) { errs.push(`${tag}[${i - 1}->${i}] t=${t.toFixed(3)} ${m.map(v => v.toFixed(3))}: on land`); break; }
          }
        }
      }
    }
  }
  return errs;
}

// ---------------------------------------------------------------- output
function stringify(data) {
  const head = { ...data, currents: undefined };
  const lines = ['{'];
  for (const [k, v] of Object.entries(head)) if (v !== undefined) lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  lines.push('  "currents": [');
  data.currents.forEach((c, i) => {
    const { path: p, ...rest } = c;
    const body = JSON.stringify(rest).slice(1, -1);
    lines.push(`    {${body},\n      "path": ${JSON.stringify(p)}}${i < data.currents.length - 1 ? ',' : ''}`);
  });
  lines.push('  ]', '}');
  return lines.join('\n') + '\n';
}

export function bake(src, mask, log = () => {}) {
  const currents = src.currents.map(c => {
    let st = null;
    const p = bakePath(mask, c.path, clearanceLadder(c.widthKm), s => { st = s; });
    log(c.id, st);
    return { id: c.id, nameRu: c.nameRu, nameEn: c.nameEn, kind: c.kind, speed: c.speed, widthKm: c.widthKm, seasonal: c.seasonal ?? null, path: p };
  });
  return {
    version: 1,
    format: 'Passionaris ocean surface currents. path: [[lon,lat],...] in flow order (main season), degrees, lon in [-180,180]; consecutive points <= ~1.5 deg apart; a step with |dlon|>180 crosses the antimeridian the short way. speed: typical surface speed, m/s. widthKm: typical width. seasonal: null | {reverse:true, months:[1-12], weakMonths?} (flow reversed in months) | {reverse:false, months, weakMonths?} (present only in months); weakMonths = transition months at reduced strength.',
    source: 'Hand-authored from standard oceanographic charts (see data/sources/ocean.md); baked by tests/currents-bake.mjs against public/assets/map/cells.bin.gz',
    count: currents.length,
    currents,
  };
}

function main() {
  const write = process.argv.includes('--write');
  const t0 = Date.now();
  const mask = loadWaterMask();
  if (write) {
    const src = JSON.parse(fs.readFileSync(SRC, 'utf8'));
    const srcErrs = validateCurrents({ currents: src.currents.map(c => ({ ...c, path: c.path })) }, null)
      .filter(e => !/step|duplicate point/.test(e));
    if (srcErrs.length) { console.error(srcErrs.join('\n')); process.exit(1); }
    const out = bake(src, mask, (id, s) => {
      const warn = s.maxKm > 90 ? '  <-- check waypoints' : '';
      console.log(`${id.padEnd(26)} pts ${String(s.n).padStart(4)}  nudged ${String(s.moved).padStart(3)}  max ${String(s.maxKm).padStart(3)} km  tight ${s.tight}${warn}`);
    });
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, stringify(out));
    console.log(`wrote ${path.relative(ROOT, OUT)} (${fs.statSync(OUT).size} bytes, ${out.count} currents)`);
  }
  const data = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const errs = validateCurrents(data, mask);
  const pts = data.currents.reduce((s, c) => s + c.path.length, 0);
  console.log(`validate: ${data.currents.length} currents, ${pts} points, ${errs.length} problems (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (errs.length) { console.error(errs.slice(0, 50).join('\n')); process.exitCode = 1; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
