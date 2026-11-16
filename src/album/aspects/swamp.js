// ASPECT «Болота»: where the swamps of the region are and how they look. This file belongs to the swamp work; the
// contract with the rest of the album is in docs/ALBUM-CHUNKS.md, the rules and their sources in docs/album/swamp.md.
//   aspSwamp(p, L) → paints the swamp over the bare ground L.col, thins the forest (L.cover), adds open water (L.gloss)
// The state comes from the chunks: p.cA.a = share of the chunk's land under swamp, p.cB = (ice, snow, flood, spare).
// Which swamp grows at a place is not stored: it follows from the height, the wetness and the sea (swampKind).

import { FKM, FNX, FNY, CHUNK_KM, CI0, CJ0, NONE } from '../chunks.js';
import { KN, KNY, KKM, KX0, KY0, kmHash } from '../division/km.js';
import { farmBytes } from '../town/state.js';
import { BBOX, STAGE } from '../geo.js';
import { wetAt as climateWet } from '../ground/climate.js';
import { DRY_LAND } from '../ground/despike.js';

// ---- rules on the CPU: the same numbers as in the GLSL below, for the natural state, the map of swamps, the tests
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const KMD = 111.195, COS = Math.cos(40 * Math.PI / 180), X0 = CI0 * CHUNK_KM, Y0 = CJ0 * CHUNK_KM;   // flat km, as in chunks.js
// the CPU twin of albumWet() in glsl.js, without its noise: 0 desert .. 1 Atlantic forest — the baked climate of the
// ground (ground/climate.js); without its file, the formula the album began with
export const wetAt = (lat, lon, h) => climateWet(lat, lon, h);
// ---- STAGE 3: the rule on the large polygon (France, the Low Countries, the Maghreb). The rule was set on Iberia,
// where cold wet ground is mountain and level wet ground hardly exists; on the plains of the north both are the
// whole country, and by the numbers of Iberia 30 % of the chunks of France held swamp, most of it brown raised bog
// (16.11.2026; with the numbers below 12 %, and nothing moves in Iberia). What differs at stage 3:
//   • the temperature. The stand-in runs about 2 °C under the baked mean of the year, alike from the Sahara to the
//     Loire — the thresholds are on its scale — but north of T_BEND_LAT it fell too fast: 3.6 °C under at 53° N.
//     From there it falls T_BEND °C a degree slower;
//   • raised bog. On low ground it needs a colder year (BOG_LOW °C against BOG_WARM), unless the climate is of the
//     wettest (BOG_WET) or the ground is upland (BOG_HILL, m): the mires of the valleys of Picardy and of the Paris
//     basin are reed fen and alder carr, those of Holland, of the Ardennes and of the Massif Central are peat bog;
//   • the cold wet uplands (MIRE) and the level ground of a wet climate (humid) — see naturalSwamp();
//   • the tide: the Channel and the North Sea have it (swampTide);
//   • land lifted from below the sea — polders, salt pans — holds no swamp by the rule (naturalSwamp).
const S3 = STAGE >= 3;
export const T_BEND = S3 ? .28 : 0, T_BEND_LAT = 47.5;
export const BOG_WARM = 11.5, BOG_LOW = S3 ? 9.5 : BOG_WARM, BOG_WET = [.86, .95], BOG_HILL = [250, 450];
// the wetlands of the list that belong to the polygon of this stage (an entry of a later stage carries "stage")
export const wetlandsOfStage = (list, stage = STAGE) => list.filter(w => (w.stage || 2) <= (stage >= 3 ? 3 : 2));
// mean temperature of the year, °C (the same stand-in as the data mode of terrain.js)
export const tempAt = (lat, h) => 17.5 - (lat - 38) * .75 + Math.max(lat - T_BEND_LAT, 0) * T_BEND - h * .0062;
// the warmest year a raised bog still grows in, °C on the scale of tempAt()
export const bogWarmAt = (wet, h) => BOG_LOW + (BOG_WARM - BOG_LOW) * Math.max(ss(BOG_WET[0], BOG_WET[1], wet), ss(BOG_HILL[0], BOG_HILL[1], h));
// which swamp grows here; the four shares add up to 1
//   salt  the lowest ground, where the sea reaches: tidal marsh, mud, salt
//   bog   cold and wet: raised and blanket peat bog
//   carr  warm and wet: flooded forest
//   fen   the rest: reed and sedge marsh
export function swampKind(lat, lon, h) {
  const wet = wetAt(lat, lon, h), salt = 1 - ss(3, 8, h), tb = bogWarmAt(wet, h);
  let rest = 1 - salt;
  const bog = rest * ss(tb, tb - 2.5, tempAt(lat, h)) * ss(.56, .70, wet); rest -= bog;
  const carr = rest * ss(.58, .70, wet);
  return { bog, fen: rest - carr, salt, carr };
}
// Bog iron (docs/album/swamp.md): it settles where fresh, acid ground water that carries iron comes out into a mire.
// A chunk holds it when its swamp is ≥ 0.10, lies above the reach of the sea and the climate is humid; the dome of a
// raised bog is fed by rain alone and holds little. Returns the strength 0..1 (0 = none). It fills the map «Болотное
// железо»; the rusty tint is its twin in the GLSL. The resources do not read it (v0.6.20): bog iron is plain iron there.
export function swampIron(swamp, lat, lon, h) {
  if (!(swamp >= .1)) return 0;
  const v = swamp * ss(3, 8, h) * ss(.58, .70, wetAt(lat, lon, h)) * (1 - .6 * swampKind(lat, lon, h).bog);
  return v < .03 ? 0 : Math.min(1, v);
}

const MIRE = S3 ? { wet: [.82, .96], t: [8, 6], share: .06 } : { wet: [.72, .92], t: [9.5, 7], share: .09 };
const inside = (poly, lat, lon) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ya, xa] = poly[i], [yb, xb] = poly[j];
    if ((ya > lat) !== (yb > lat) && lon < (xb - xa) * (lat - ya) / (yb - ya) + xa) c = !c;
  }
  return c;
};

// The natural share of swamp of every chunk (the world before drainage): a rule of relief and water, and over it the
// wetlands known by name. A chunk is a natural cell (chunks.js): its outline follows the rivers, the foot of the slopes
// and the coast, so a flood plain or a hollow is a chunk of its own, and everything here is counted over the real
// outlines and the real neighbours of the chunks.
//   ch: Chunks, built with the rivers (its links say where a river runs along a border)
//   heightAt(lat, lon) → metres;  wetlands: public/assets/album/swamp/wetlands.json
// Returns Float32Array, 0..0.95 per chunk; water chunks stay 0.
export function naturalSwamp(ch, heightAt, { wetlands = [] } = {}) {
  const n = ch.count, cell = ch.cell, out = new Float32Array(n), isLand = k => ch.kind[k] === 1;
  // heights on the fine raster the outlines live on (1.25 km), land chunks only
  const hgt = new Float32Array(FNX * FNY).fill(-1);
  for (let ty = 0, t = 0; ty < FNY; ty++) {
    const lat = (Y0 + (ty + .5) * FKM) / KMD;
    for (let tx = 0; tx < FNX; tx++, t++) if (isLand(cell[t])) hgt[t] = heightAt(lat, (X0 + (tx + .5) * FKM) / (KMD * COS));
  }
  // how much of the chunk is flat ground (water stands on it) and gentle ground (a blanket of peat holds on it):
  // the share of neighbouring points inside the chunk that differ by less than 9 m, and by less than 55 m
  const tex = new Uint32Array(n), pairs = new Uint32Array(n), fl = new Uint32Array(n), ge = new Uint32Array(n), lifted = new Uint32Array(n);
  for (let ty = 0, t = 0; ty < FNY; ty++) for (let tx = 0; tx < FNX; tx++, t++) {
    const k = cell[t], h = hgt[t]; tex[k]++;
    if (h <= 0) continue;
    for (let d = 0; d < 2; d++) {
      if (d ? ty >= FNY - 1 : tx >= FNX - 1) continue;
      const m = t + (d ? FNX : 1); if (cell[m] !== k) continue;
      const g = hgt[m]; if (g <= 0) continue;
      const dh = Math.abs(g - h); pairs[k]++;
      if (dh < 1e-6 && h > 8) continue;              // a dead-level surface inland is a reservoir in the height data, not land
      // (stage 3) dead-level ground at exactly DRY_LAND m is land the base lifted from below the sea (liftDryLand,
      // ground/despike.js): a polder behind its dikes, a salt pan of the desert. It is dry by the hand of man or by
      // the Sun, and no marsh of nature lies on it — by the rule alone all of Holland was one marsh.
      if (S3 && dh < 1e-6 && Math.abs(h - DRY_LAND) < .01) { lifted[k]++; continue; }
      if (dh < 9) fl[k]++; if (dh < 55) ge[k]++;
    }
  }
  const flat = k => pairs[k] ? fl[k] / pairs[k] : 0, gentle = k => pairs[k] ? ge[k] / pairs[k] : 0;
  // (for the wetlands known by name lifted land is level ground like any other: the Camargue lies on it)
  const flatNamed = k => pairs[k] ? (fl[k] + lifted[k]) / pairs[k] : 0;
  // a river along the border of the chunk floods its plain; where the sea is a neighbour too, that is a river mouth
  const riv = new Float32Array(n), mouth = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    if (!isLand(k)) continue;
    let r = 0, sea = false;
    for (const l of ch.links[k]) { if (l.river) r = Math.max(r, (l.river === 2 ? 1 : .65) * Math.min(1, l.wet / 5)); if (!isLand(l.k)) sea = true; }
    riv[k] = r;
    if (r > 0 && sea) for (const [m, steps] of ch.ring(k, 2)) mouth[m] = Math.max(mouth[m], r * (1 - steps / 3));
  }
  for (let k = 0; k < n; k++) {
    if (!isLand(k)) continue;
    const c = ch.centre(k), h = ch.height[k], wet = wetAt(c.lat, c.lon, h);
    let s = 0, a = 0;                                 // how much lower the chunk lies than the land within two chunks of it
    for (const [m] of ch.ring(k, 2)) if (isLand(m)) { s += ch.height[m] * ch.area[m]; a += ch.area[m]; }
    const low = h - s / a, level = ss(.55, .95, flat(k)), basin = ss(10, -30, low);
    const coast = ss(9, 2, h) * level;                                               // level ground at the height of the sea
    const flood = riv[k] * level * ss(20, -5, low);                                 // the flood plain of a river
    // level, badly drained ground in a wet climate. (Stage 3: in a hollow only — lower than the land around it. Any
    // level ground counted in Iberia, where a wet plain is a rarity; in France it is half the country, and the chalk
    // and limestone of its plains drain well. Its wet plains are in the list by name: the Sologne, the Brenne.)
    const humid = ss(.56, .74, wet) * level * (S3 ? ss(2, -25, low) : .45 + .55 * basin);
    // cold wet uplands: a blanket of peat. (Stage 3: wetter and colder — the Ardennes, the Vosges, the high plateaux
    // of the Massif Central, not every hill north of the Loire; and a smaller share of them: from 150 km the plateau
    // of the Ardennes was all ochre blots.)
    const mire = ss(MIRE.wet[0], MIRE.wet[1], wet) * ss(MIRE.t[0], MIRE.t[1], tempAt(c.lat, h)) * ss(.5, .9, gentle(k));
    const v = Math.max(coast * .5, flood * .25, humid * .22, mire * MIRE.share) + mouth[k] * .12 * level;
    out[k] = v < .04 ? 0 : Math.min(.95, v);
  }
  // the wetlands known by name: a disc of their area (or an outline) laid over the chunks it covers, land only. Steep
  // ground holds half of it; what it does not hold lies on the level chunks beside it, so the area is kept.
  const PEAK = .85, TKM2 = FKM * FKM;
  const fit = k => { const c = ch.centre(k); return .5 + .5 * Math.max(ss(.3, .8, flatNamed(k)), ss(11.5, 9, tempAt(c.lat, ch.height[k])) * ss(.4, .8, gentle(k))); };
  const clampX = v => Math.max(0, Math.min(FNX - 1, Math.floor(v))), clampY = v => Math.max(0, Math.min(FNY - 1, Math.floor(v)));
  for (const w of wetlands) {
    const acc = new Map(), R = w.poly ? 0 : Math.sqrt(w.km2 / (Math.PI * PEAK)), wx = w.lon * KMD * COS, wy = w.lat * KMD;
    const xs = w.poly ? w.poly.map(q => q[1] * KMD * COS) : [wx - R * 1.3, wx + R * 1.3], ys = w.poly ? w.poly.map(q => q[0] * KMD) : [wy - R * 1.3, wy + R * 1.3];
    const tx0 = clampX((Math.min(...xs) - X0) / FKM), tx1 = clampX((Math.max(...xs) - X0) / FKM), ty0 = clampY((Math.min(...ys) - Y0) / FKM), ty1 = clampY((Math.max(...ys) - Y0) / FKM);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const k = cell[ty * FNX + tx]; if (!isLand(k)) continue;
      const x = X0 + (tx + .5) * FKM, y = Y0 + (ty + .5) * FKM;
      const v = w.poly ? (inside(w.poly, y / KMD, x / (KMD * COS)) ? 1 : 0) : 1 - ss(.7 * R, 1.3 * R, Math.hypot(x - wx, y - wy));
      if (v > 0) acc.set(k, (acc.get(k) || 0) + v);
    }
    const share = new Map();
    if (w.poly) for (const [k, s] of acc) share.set(k, w.share * s / tex[k] * fit(k));
    else {
      let scale = 1;
      for (let pass = 0; pass < 3; pass++) {
        let area = 0; for (const [k, s] of acc) area += Math.min(.95, PEAK * s / tex[k] * fit(k) * scale) * tex[k] * TKM2;
        if (area > 0) scale = Math.min(1.6, scale * w.km2 / area);
      }
      for (const [k, s] of acc) share.set(k, PEAK * s / tex[k] * fit(k) * scale);
      // a small wetland still shows in its own chunk; one that lies in a lagoon goes to the shore with the longest border
      let k0 = ch.at(w.lat, w.lon);
      if (k0 >= 0 && !isLand(k0)) k0 = ch.links[k0].filter(l => isLand(l.k)).sort((p, q) => q.km - p.km)[0]?.k ?? -1;
      if (k0 >= 0) share.set(k0, Math.max(share.get(k0) || 0, Math.min(PEAK, Math.max(.05, w.km2 / ch.area[k0]))));
    }
    for (const [k, v] of share) if (v >= .04) out[k] = Math.min(.95, Math.max(out[k], v));
  }
  // nothing outside the region of the album: the land shader ends there
  for (let k = 0; k < n; k++) { if (!out[k]) continue; const c = ch.centre(k); if (c.lat < BBOX.lat0 - .05 || c.lat > BBOX.lat1 + .05 || c.lon < BBOX.lon0 - .05 || c.lon > BBOX.lon1 + .05) out[k] = 0; }
  return out;
}

// ---- STAGE 3: the swamp of the chunks of 1 km² (division/km.js). A natural cell is some 100 km², and its share of
// swamp says how much of it is swamp, not where: the shader used to lay that share by a noise, and a flood plain of
// 15 km² came out as blots all over its cell, some of them far from the river (the lead at Zaragoza, 15.11.2026).
// Here every square of 1 km² of a cell with swamp gets a mark — how readily water stands on it — and the squares of
// the cell take its swamp in the order of their marks until the area of the cell's swamp is laid:
//   low ground of the cell first · level ground before a slope · near water (the sea, a lagoon, a river of the map)
//   before far from it · a hollow before a rise · and a little chance, so that level country does not fill in rows.
// The swamp of a cell stays what it was; only its place inside the cell is new. The answer is softened over the
// squares around (a swamp does not end at the side of a square).
//   ch: Chunks;  heightAt(lat, lon) → m;  natural: the share of swamp of every natural cell (naturalSwamp);
//   rivers: the rivers of the map, [{ pts: [[lon, lat], …] }]
// → Uint8Array KN × KNY, square j · KN + i: its share of swamp, 0..255. The settlements keep it beside the fields of
// the chunks (town/state.js, mirrorSwamp) and the ground shader reads it there (swampKm below).
export const KM_REACH = 6;                                  // squares: how far water is looked for
export function swampKmOf(ch, heightAt, natural, { rivers = [] } = {}) {
  const n = KN * KNY, cell = ch.cell, cells = ch.count, of = new Int32Array(n).fill(-1), count = new Uint32Array(cells);
  for (let j = 0, c = 0; j < KNY; j++) {
    const ty = Math.min(FNY - 1, Math.floor((j + .5) * KKM / FKM));
    for (let i = 0; i < KN; i++, c++) {
      const k = cell[ty * FNX + Math.min(FNX - 1, Math.floor((i + .5) * KKM / FKM))];
      if (k === NONE || k >= cells || ch.kind[k] !== 1 || !(natural[k] > 0)) continue;
      of[c] = k; count[k]++;
    }
  }
  // the heights of the squares, as they are asked for
  const hs = new Float32Array(n).fill(NaN);
  const hAt = c => { let v = hs[c]; if (v !== v) { const i = c % KN, j = (c - i) / KN; v = hs[c] = heightAt((KY0 + (j + .5) * KKM) / KMD, (KX0 + (i + .5) * KKM) / (KMD * COS)); } return v; };
  const hOf = (i, j) => hAt(Math.max(0, Math.min(KNY - 1, j)) * KN + Math.max(0, Math.min(KN - 1, i)));
  // the squares a river of the map runs through
  const river = new Uint8Array(n);
  for (const r of rivers) for (let q = 1; q < (r.pts || []).length; q++) {
    const x0 = r.pts[q - 1][0] * KMD * COS, y0 = r.pts[q - 1][1] * KMD, x1 = r.pts[q][0] * KMD * COS, y1 = r.pts[q][1] * KMD, steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (KKM * .4)));
    for (let t = 0; t <= steps; t++) { const i = Math.floor((x0 + (x1 - x0) * t / steps - KX0) / KKM), j = Math.floor((y0 + (y1 - y0) * t / steps - KY0) / KKM); if (i >= 0 && j >= 0 && i < KN && j < KNY) river[j * KN + i] = 1; }
  }
  // how far the nearest water is from a square, in squares (KM_REACH: none within reach)
  const waterFrom = (i, j) => {
    for (let r = 0; r <= KM_REACH; r++) for (let b = -r; b <= r; b++) for (let a = -r; a <= r; a++) {
      if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue;
      const x = i + a, y = j + b; if (x < 0 || y < 0 || x >= KN || y >= KNY) continue;
      if (river[y * KN + x] || hAt(y * KN + x) <= 0) return r;
    }
    return KM_REACH;
  };
  // the squares of every cell, one cell after another
  const start = new Uint32Array(cells + 1); for (let k = 0; k < cells; k++) start[k + 1] = start[k] + count[k];
  const list = new Uint32Array(start[cells]), fill = start.slice(0, cells);
  for (let c = 0; c < n; c++) if (of[c] >= 0) list[fill[of[c]]++] = c;
  const share = new Float32Array(n);
  for (let k = 0; k < cells; k++) {
    const m = count[k]; if (!m) continue;
    let lo = Infinity, hi = -Infinity;
    for (let q = start[k]; q < start[k + 1]; q++) { const h = hAt(list[q]); if (h < lo) lo = h; if (h > hi) hi = h; }
    const mark = [];
    for (let q = start[k]; q < start[k + 1]; q++) {
      const c = list[q], i = c % KN, j = (c - i) / KN, h = hAt(c), e = hOf(i + 1, j), w = hOf(i - 1, j), no = hOf(i, j + 1), so = hOf(i, j - 1);
      const steep = Math.min(1, Math.max(Math.abs(h - e), Math.abs(h - w), Math.abs(h - no), Math.abs(h - so)) / 30);
      const rise = Math.max(0, Math.min(1, .5 + (h - (e + w + no + so) / 4) / 20));
      mark.push([.35 * (h - lo) / (hi - lo + 5) + .25 * steep + .25 * waterFrom(i, j) / KM_REACH + .10 * rise + .05 * kmHash(i, j, 77), c]);
    }
    mark.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const area = Math.min(.95, natural[k]) * m, whole = Math.floor(area);
    for (let q = 0; q < whole; q++) share[mark[q][1]] = 1;
    if (whole < m) share[mark[whole][1]] = area - whole;
  }
  // softened over the squares around: 1 2 1 / 2 4 2 / 1 2 1
  const km = new Uint8Array(n);
  for (let j = 0, c = 0; j < KNY; j++) for (let i = 0; i < KN; i++, c++) {
    let sum = 0;
    for (let b = -1; b <= 1; b++) { const y = j + b; if (y < 0 || y >= KNY) continue; for (let a = -1; a <= 1; a++) { const x = i + a; if (x < 0 || x >= KN) continue; const v = share[y * KN + x]; if (v > 0) sum += v * (a ? 1 : 2) * (b ? 1 : 2); } }
    if (sum > 0) km[c] = Math.round(sum / 16 * 255);
  }
  return km;
}
// has the settlement work written the swamp of the chunks into its texture (mirrorSwamp: the six low bits of A)?
// Looked up on a few squares that hold swamp; bytes: the chunk rows of that texture.
export function swampKmMirrored(km, bytes = farmBytes) {
  if (!km || bytes.length < km.length * 4) return false;
  let seen = 0;
  for (let c = 0; c < km.length && seen < 8; c += 97) { if (km[c] < 8) continue; if ((bytes[c * 4 + 3] & 63) !== km[c] >> 2) return false; seen++; }
  return seen > 0;
}
// the shader: where the settlements keep the share (a texel a square, square (i, j) at (i, j)), joined between the
// four squares around a point. It stands in the text of the ground shader AFTER the settlement aspect, whose texture
// it reads — in the forest aspect, which is the next one of the same hand (aspects/index.js); the swamp's own text,
// which comes first, only names it.
export const SWAMP_KM_GLSL = S3 ? /* glsl */`
float swampKmAt(ivec2 c) { return mod(floor(texelFetch(tSettle, clamp(c, ivec2(0), ivec2(${KN - 1}, ${KNY - 1})), 0).a * 255. + .5), 64.); }
float swampKm(vec2 pk) {
  vec2 t = (pk - vec2(${KX0.toFixed(1)}, ${KY0.toFixed(1)})) / ${KKM.toFixed(1)} - .5, f = fract(t); ivec2 c = ivec2(floor(t));
  vec4 v = vec4(swampKmAt(c), swampKmAt(c + ivec2(1, 0)), swampKmAt(c + ivec2(0, 1)), swampKmAt(c + ivec2(1, 1)));
  return mix(mix(v.x, v.y, f.x), mix(v.z, v.w, f.x), f.y) / 63.;
}
` : '';

// ---- rules in GLSL, shared with anything that must know what a swamp is at a point.
// They need COMMON of glsl.js (heightLod, vnoise) and nothing else: no uniforms, no screen derivatives.
// Used outside this file: the forest (swampTreeless) and, since v0.6.140, the vertex shader of the yards of the
// settlements (layers/towns.js: swampHeight, swampSlope, swampField, swampDepth — a yard is not drawn where the
// swamp lies). Their signatures are a contract: with another signature that shader does not compile and no house is
// drawn at all. Change them only together with the settlements, and run acheck.
export const SWAMP_RULES = /* glsl */`
// smooth gradient noise, 0..1 (about .5 ± .3): its level lines wander freely, without the square grain of vnoise
float swampNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6. - 15.) + 10.);
  return .5 + 1.4 * mix(mix(dot(hash22(i) - .5, f), dot(hash22(i + vec2(1., 0.)) - .5, f - vec2(1., 0.)), u.x),
    mix(dot(hash22(i + vec2(0., 1.)) - .5, f - vec2(0., 1.)), dot(hash22(i + vec2(1., 1.)) - .5, f - vec2(1., 1.)), u.x), u.y);
}
// the height the swamp rules read: metres, smoothed over about a kilometre, so the steps of the height data do not show
float swampHeight(vec2 ll) { return max(heightLod(ll, 2.), 0.); }
// the slope of that smoothed ground, rise over run
float swampSlope(vec2 ll, float hs) {
  return length(vec2(swampHeight(ll + vec2(0., 1. / (KM * cos(radians(ll.x))))) - hs, swampHeight(ll + vec2(1. / KM, 0.)) - hs)) * .001;
}
// which swamp grows here: x raised bog, y reed fen, z salt marsh, w flooded forest; the four add up to 1
vec4 swampKind(vec2 ll, float hs, float wet) {
${S3 ? `  float t = 17.5 - (ll.x - 38.) * .75 + max(ll.x - ${T_BEND_LAT.toFixed(1)}, 0.) * ${T_BEND} - hs * .0062, salt = 1. - smoothstep(3., 8., hs), rest = 1. - salt;
  float tb = ${BOG_LOW.toFixed(1)} + ${(BOG_WARM - BOG_LOW).toFixed(1)} * max(smoothstep(${BOG_WET[0]}, ${BOG_WET[1]}, wet), smoothstep(${BOG_HILL[0].toFixed(1)}, ${BOG_HILL[1].toFixed(1)}, hs));   // (the warmest year of a raised bog: bogWarmAt)
  float bq = clamp((tb - t) * .4, 0., 1.), bog = rest * bq * bq * (3. - 2. * bq) * smoothstep(.56, .70, wet); rest -= bog;` : `  float t = 17.5 - (ll.x - 38.) * .75 - hs * .0062, salt = 1. - smoothstep(3., 8., hs), rest = 1. - salt;
  float bog = rest * smoothstep(11.5, 9., t) * smoothstep(.56, .70, wet); rest -= bog;`}
  float carr = rest * smoothstep(.58, .70, wet);
  return vec4(bog, rest - carr, salt, carr);
}
// 1 on the coasts of the ocean, where the tide comes in twice a day; 0 on the Mediterranean${S3 ? `
// (stage 3: the Channel and the North Sea — everything north of the Loire; the Mediterranean ends at 43.8° N)` : ''}
float swampTide(vec2 ll) { return ${S3 ? 'max(smoothstep(46.5, 47.5, ll.x), ' : ''}max(1. - smoothstep(-5.9, -5.3, ll.y), smoothstep(42.9, 43.2, ll.x) * (1. - smoothstep(-.6, .4, ll.y)))${S3 ? ')' : ''}; }
// the pattern the share of the chunk is compared with: 0..1, evenly spread; n2, n3 = the shared noises of 7 and 1 km
float swampField(vec2 pk, float n2, float n3, float px) {
  float nz = px < 2.6 ? mix(.5, swampNoise(pk / 2.7 + 61.), smoothstep(2.6, 1., px)) : .5;
  return smoothstep(.2, .8, n2 * .55 + n3 * .10 + nz * .42 - .035);
}
// How deep into the swamp a point is: below 0 dry ground, 0 the edge, toward 1 the wet heart. s = swamp share of the
// chunk, f = swampField. Weak goes first: a small share leaves only the lowest, flattest, wettest ground under swamp.
// Water stands on level ground only; the peat of a raised bog also holds on a gentle slope.
float swampDepth(float s, float f, vec2 ll, float hs, float slope, float bog) {
  float low = clamp((max(heightLod(ll, 4.5), 0.) - hs) / (4. + hs * .03), -1., 1.);         // lower than the land around it
  return s * 1.05 - f + low * .3 - smoothstep(mix(.012, .07, bog), mix(.05, .28, bog), slope) * 1.3;
}
// For the trees: the share of them that cannot stand at this point (open bog, reed, marsh; fewer in a flooded forest).
// s = cA.a of the chunk; n2, n3 = the shared noises of 7 and 1 km, not faded.
float swampTreeless(float s, vec2 pk, vec2 ll, float wet, float n2, float n3) {
  if (s < .004) return 0.;
  float hs = swampHeight(ll); vec4 kind = swampKind(ll, hs + (n2 - .5) * 3. + (n3 - .5) * 1.5, wet);
  float d = swampDepth(s, swampField(pk, n2, n3, 0.), ll, hs, swampSlope(ll, hs), kind.x);
  return smoothstep(-.07, .07, d) * mix(dot(kind, vec4(.97, .9, 1., .3)), 1., smoothstep(.15, .375, d) * .8);
}
`;

const GLSL = /* glsl */`
uniform float uSwampWater, uSwampIron;
${SWAMP_RULES}${S3 ? `
// (stage 3) the swamp of the chunks of 1 km²: uSwampKm is 1 once the settlements keep it in their texture; swampKm()
// stands further down the text (SWAMP_KM_GLSL). How deep into the swamp a point is, by that share: the swamp lies
// where the chunks hold it, and the noise only frays its edge.
uniform float uSwampKm;
float swampKm(vec2 pk);
float swampDepthKm(float sk, float f, vec2 ll, float hs, float slope, float bog) {
  float low = clamp((max(heightLod(ll, 4.5), 0.) - hs) / (4. + hs * .03), -1., 1.);
  return (sk - .5) * 1.6 + (.5 - f) * .3 + low * .2 - smoothstep(mix(.012, .07, bog), mix(.05, .28, bog), slope) * 1.3;
}` : ''}
// a line of water of half-width w km, a km away from the middle of a pixel px km wide: the share of the pixel it covers
float swampLine(float a, float w, float px) { return clamp((min(w, a + .5 * px) - max(-w, a - .5 * px)) / px, 0., 1.); }

float fSwampW = 0.;   // how much of this pixel the swamp has painted, 0..1: for the aspects painted after it (the fields keep off it — aspects/settle.js)
void aspSwamp(Px p, inout Land L) {
  float s = p.cA.a;
  if (s < .004 || p.h < -1.) return;
  vec2 pk = p.pk; float px = p.px, far = smoothstep(1.5, 4.5, px), f = swampField(pk, p.n2, p.n3, px);
${S3 ? `  float sk = -1.;
  if (uSwampKm > .5) { sk = swampKm(pk); if (sk < .02 && far <= 0.) return; }             // no swamp in the chunks around
  else if (s * 1.05 - f + .3 < -.07 && far <= 0.) return;                             // (the chunks are not known yet: by the noise, as at stage 2)` : `  if (s * 1.05 - f + .3 < -.07 && far <= 0.) return;                                  // dry even in the lowest hollow`}
  float hs = swampHeight(p.ll), slope = swampSlope(p.ll, hs);
  float hk = hs + (p.n2 - .5) * 3. + (p.n3 - .5) * 1.5;                               // a little unevenness, so the kinds do not change along the cells of the height data
  vec4 kind = swampKind(p.ll, hk, p.wet);
  float d = ${S3 ? 'sk < 0. ? swampDepth(s, f, p.ll, hs, slope, kind.x) : swampDepthKm(sk, f, p.ll, hs, slope, kind.x)' : 'swampDepth(s, f, p.ll, hs, slope, kind.x)'};
  // (The edge of the swamp is a few pixels wide, and no wider than it was. With one width at every height a small
  // swamp seen from 20 km was a blurred blot — the lead on the flood plain of the Ebro at Zaragoza, 15.11.2026.)
  float swE = clamp(px * 1.2, .012, .07);
  float m = mix(smoothstep(-swE, swE, d), clamp(s * 1.05, 0., 1.) * step(slope, .05), far);
  fSwampW = m; if (m < .004) return;
  float z = clamp(d * 2., 0., 1.);                                                    // 0 the edge of the swamp .. 1 its heart
  float glade = kind.w * smoothstep(.15, .5, z) * .85; kind.w -= glade; kind.y += glade;   // the heart of a flooded forest is open reed and water
${S3 ? `  // (stage 3) where the forest is felled a flooded forest is a reed fen too: without its trees the black litter under
  // them lay as a dark blot among the fields (the lead on Paris from 20 km, 16.11.2026)
  float felled = kind.w * (1. - smoothstep(.12, .45, L.cover)); kind.w -= felled; kind.y += felled;
` : ''}  float tide = swampTide(p.ll), ice = p.cB.r, snow = p.cB.g, cold = max(ice, snow), mott = p.n3;
  float lvl = .5 + uSwampWater + p.cB.b;                                              // water level: 1 is the usual one; a flood of the chunk raises it
  float flats = kind.z * smoothstep(2.2, .5, hk);                                     // the lowest salt marsh: flats the sea covers
  float cw = dot(kind, vec4(.3, 1., 1.3, .8)) * lvl * (1. + flats * .5);              // how wide the creeks are
  float pa = dot(kind, vec4(.10, .30, .16 - .08 * tide, .20));                        // how much water stands in pools

  // ---- open water: pools, the low places of the shared noises of 1 and 7 km. The swamp asks for no noise of its own
  // here, and that is on purpose. A noise needs many registers of the video card at once; called in the middle of this
  // function, among the two dozen numbers it keeps by then, one creek noise pushed the whole ground shader past the
  // limit after which a weak card runs it 40 % slower (14.11.2026, «land-200»: 436 ms against 307 ms with the same
  // noise counted first — docs/album/ground.md, «Скорость»). The creeks themselves are gone as well: a single net of
  // arms showed as dark blue blades and crescents across the green (w3-roads on v0.6.65), and the bright blue streaks
  // of the richer water before it looked false beside dry land (the lead on v0.6.52).
  float near = 1. - smoothstep(.5, 1.5, px), A = pa * z * lvl, e = clamp(px * .9, .012, .3), P = p.n3 * .6 + p.n2 * .4;
  float eP = ((1. - A) - P) * .6, edge = eP;
  float water = clamp((P - (1. - A)) / e * .5 + .5, 0., 1.), wdeep = clamp(-eP * 6., 0., 1.);
  water = mix(z * (pa * .5 + .05 * cw) * lvl, water, near);                           // what is left of the water when it is smaller than a pixel

  // ---- what grows
  // tussocks and hummocks: the noise without the square grain (vnoise here was a checker of 85 m all over the swamp)
  float fine = px < .12 ? mix(.5, clamp(.5 + (swampNoise(pk / .085 + 3.) - .5) * 1.6, 0., 1.), smoothstep(.12, .04, px)) : .5;
  vec3 vBog = mix(vec3(.46, .37, .18), vec3(.36, .37, .16), mott);                    // ochre moss and deer grass
  vBog = mix(vBog, vec3(.33, .22, .17), smoothstep(.52, .8, fine) * .6);              // russet hummocks of heather
  vBog = mix(vBog, vec3(.49, .46, .17), smoothstep(.38, .12, fine) * z * .55);        // bright wet moss in the hollows
  vec3 vFen = mix(vec3(.24, .35, .15), vec3(.38, .43, .19), mott * .6 + fine * .4);   // reed beds
  vFen = mix(vFen, vec3(.56, .51, .27), smoothstep(.55, .8, P * .5 + p.n2 * .5) * .45);     // stands of last year's straw
  vFen = mix(vec3(.47, .45, .22), vFen, smoothstep(0., .35, z));                      // sedge and wet grass at the dry edge
  vFen = mix(vFen, vec3(.46, .45, .25), smoothstep(.45, .2, p.wet) * .55);            // in a dry land the reed is straw and olive, not fresh green
  vec3 vSalt = mix(vec3(.38, .46, .24), vec3(.52, .53, .30), mott * .6 + fine * .4);  // cord grass, sea purslane
  vSalt = mix(vSalt, vec3(.47, .33, .26), smoothstep(.5, .8, p.n2) * (1. - z * .5) * .45);  // red glasswort on the high marsh
  vSalt = mix(vSalt, vFen, (1. - tide) * .35);                                        // a tideless shore is half reed
  vec3 vCarr = mix(vec3(.12, .17, .08), vec3(.25, .31, .13), mott * .6 + fine * .4);  // wet black litter and sedge under alder and willow
  vec3 veg = kind.x * vBog + kind.y * vFen + kind.z * vSalt + kind.w * vCarr;
  vec3 dead = kind.x * vec3(.35, .26, .19) + kind.y * vec3(.63, .55, .34) + kind.z * vec3(.46, .42, .31) + kind.w * vec3(.21, .20, .14);
  veg = mix(veg, dead * (.85 + .3 * mott), smoothstep(.05, .5, cold) * .85);          // winter: reed and sedge die back to straw, moss darkens
  veg *= .88 + .24 * fine;                                                           // (its own mottle; the grain of the ground is not kept this far)
  // the bank: a wall of dark reed in a fen, bright moss round a bog pool
  float bankW = .03 + px, bank = (1. - smoothstep(0., bankW, edge)) * near;
  veg = mix(veg, kind.x * vec3(.51, .46, .17) + kind.y * vec3(.17, .30, .11) + kind.z * veg + kind.w * vec3(.10, .14, .07), bank * .65);
  // salt marsh: bare mud along the creeks and on the flats, a crust of salt round the pans of a dry tideless coast
  float mudW = (.01 + .025 * tide) * (1. + flats) + px * .5;
  float mud = kind.z * max(1. - smoothstep(mudW * .6, mudW, edge), flats * (1. - smoothstep(.04, .16, edge)) * smoothstep(.4, .6, P) * .8) * near * smoothstep(.4, .12, px);
  veg = mix(veg, mix(vec3(.58, .52, .41), vec3(.47, .43, .35), mott), mud);
  veg = mix(veg, vec3(.82, .80, .74), (kind.z * (1. - tide * .8) + kind.y * .45) * smoothstep(.56, .38, p.wet) * smoothstep(.14, .02, eP) * near * .75);
  // bog iron: rust on the banks and in the shallows of fresh mires in a humid climate; a raised bog, fed by rain alone, has it only at its edge
  float fe = uSwampIron * (1. - kind.z) * (1. - kind.x * smoothstep(.1, .5, z) * .8) * smoothstep(.58, .70, p.wet) * smoothstep(.40, .66, vnoise(pk / 3.3 + 77.));
  veg = mix(veg, vec3(.62, .37, .15), fe * (1. - smoothstep(0., bankW * 1.6, edge)) * near * .6);

  // ---- water: pale and warm in the shallows, dark in the middle; then ice, and snow on the ice
  // (dark and dull, as standing water is from above: the sky is mirrored by L.gloss, not painted here)
  vec3 wcol = mix(kind.x * vec3(.15, .12, .08) + kind.y * vec3(.21, .29, .23) + kind.z * vec3(.44, .45, .37) + kind.w * vec3(.11, .16, .12),
    kind.x * vec3(.03, .035, .045) + kind.y * vec3(.07, .15, .17) + kind.z * vec3(.17, .28, .30) + kind.w * vec3(.05, .12, .13), smoothstep(0., .7, wdeep));
  float rust = fe * (1. - smoothstep(0., .35, wdeep)) * .75;                         // a rusty film in the shallowest water only
  wcol = mix(wcol, vec3(.47, .27, .11), rust);
  float pads = px < .09 ? (kind.y + kind.w * .6) * smoothstep(.62, .8, vnoise(pk / .11 + 31.)) * (1. - smoothstep(.15, .6, wdeep)) * smoothstep(.09, .03, px) : 0.;
  wcol = mix(wcol, vec3(.27, .40, .15), pads * .8);                                   // floating leaves in the shallows
  float frozen = smoothstep(-.1, .1, ice * 1.6 - .3 - wdeep * .9 - kind.z * .3);     // the shallow edges freeze first, the running middle last
  vec3 iceCol = mix(vec3(.52, .60, .64), vec3(.80, .85, .88), mott);
  iceCol = mix(iceCol, vec3(.94, .96, .98), smoothstep(.03, .3, snow));               // snow settles on the ice before it holds on the reeds
  wcol = mix(wcol, iceCol, frozen);
  float snowTop = 2980. - (p.ll.x - 37.) * 55. + uSnow;
  float snowed = max(smoothstep(-.1, .1, snow * 1.3 - (p.n2 * .55 + p.n3 * .45)), smoothstep(snowTop - 90., snowTop + 110., p.hl));   // where the land shader lays snow

  // ---- the forest: none on open mire; a flooded forest keeps its trees, with gaps, and they lean over the water
  float gap = kind.w > .01 ? (px < .2 ? mix(.45, smoothstep(.42, .62, swampNoise(pk / .36 + 41.)), smoothstep(.2, .08, px)) : .45) : 0.;
  float keep = kind.w * .8 * (1. - .9 * gap) * (1. - .8 * water) + kind.y * .06 * (1. - water);
  L.cover *= 1. - m * (1. - keep);
  L.col = mix(L.col, mix(veg, wcol, water), m * .94);
  L.gloss = max(L.gloss, m * (water * mix(.28 * (1. - pads * .8) * (1. - rust * .8), .10, frozen) + mud * tide * .06 * (1. - water)) * (1. - snowed) * (1. - L.cover));
}`;

const cam = (lat, lon, h, tilt = 0, heading = 0) => ({ lat, lon, h, tilt, heading });
const KINDS = ['bog', 'fen', 'salt', 'carr'], KIND_COL = [[.78, .33, .10], [.50, .86, .16], [.16, .56, .98], [.02, .50, .40]];

export default {
  id: 'swamp', title: 'Болота', glsl: GLSL,
  uniforms: { uSwampWater: { value: .5 }, uSwampIron: { value: 1 }, ...(S3 ? { uSwampKm: { value: 0 } } : {}) },
  params: [
    { key: 'swampWater', label: 'Вода в болотах', group: 'land', min: 0, max: 1, step: .05, value: .5, uniform: 'uSwampWater' },
    { key: 'swampIron', label: 'Болотное железо: ржавый оттенок', group: 'land', min: 0, max: 2, step: .1, value: 1, unit: '×', uniform: 'uSwampIron' },
    { key: 'swampFrost', label: 'Показ: мороз на болотах', group: 'modes', min: 0, max: 1, step: .05, value: 0 },
    { key: 'swampMap', label: 'Карта болот', group: 'modes', type: 'select', value: '', options: [['', 'нет'], ['share', 'Доля болота'], ['kind', 'Вид болота'], ['iron', 'Болотное железо']] },
  ],
  pages: [
    { id: 'swamp-salt', group: 'Болота', title: 'Приморские марши: устье Гвадалквивира', note: 'Низкий берег, куда заходит море: приливные протоки ветвятся, вдоль них голый ил, между ними серо-зелёные солончаковые луга.', p: { forest3d: 0 }, cam: cam(36.95, -6.3, 35, 45, 20) },
    { id: 'swamp-fen', group: 'Болота', title: 'Тростниковая топь: Таблас-де-Даймьель', note: 'Низинное болото в сухом климате: зелёные заросли тростника, тёмные плёсы и протоки, по краю осока.', p: { forest3d: 0 }, cam: cam(39.14, -3.7, 30, 48, 10) },
    { id: 'swamp-bog', group: 'Болота', title: 'Верховой торфяник: Серра-ду-Шистрал', note: 'Холодные мокрые горы: бурый и охристый мох, россыпи чёрных окон воды, леса нет.', p: { forest3d: 0 }, cam: cam(43.47, -7.6, 28, 50, 20) },
    { id: 'swamp-carr', group: 'Болота', title: 'Заболоченный лес: Ланды Гаскони', note: 'Тёплая сырая равнина: лес стоит в воде, между деревьями тёмные окна и протоки, на открытых местах тростник.', p: { forest3d: 0 }, cam: cam(44.15, -0.75, 28, 50, 20) },
    { id: 'swamp-200', group: 'Болота', title: 'Болота с 200 км: низовья Гвадалквивира', note: 'Обычная игровая высота. Болото читается пятном своего цвета с сетью проток; край неровный.', p: {}, cam: cam(36.9, -6.2, 200, 40, 0) },
    { id: 'swamp-winter', group: 'Болота', title: 'Зима на болоте', note: 'Двигайте «Показ: мороз на болотах» (раздел «Режимы и бедствия»): сначала замерзают мелкие края окон, потом протоки; на лёд ложится снег, тростник желтеет.', p: { look: 'winter', swampFrost: .8, forest3d: 0 }, cam: cam(39.14, -3.7, 30, 48, 10) },
    { id: 'swamp-iron', group: 'Болота', title: 'Болотное железо', note: 'Ржавый оттенок берегов и мелкой воды там, где в болоте оседает железо: пресные болота влажного климата. Сила оттенка — «Болотное железо» (раздел «Земля»).', p: { swampIron: 1.6, forest3d: 0 }, cam: cam(44.3, -0.9, 24, 45, 0) },
    { id: 'swamp-seam', group: 'Болота', title: 'Стык чанков: край болота', note: 'У соседних чанков разная доля болота. Границы по сетке не видно: при малой доле остаются только самые низкие и мокрые места.', p: { forest3d: 0 }, cam: cam(37.22, -6.2, 110, 25, 0) },
    { id: 'swamp-seam-grid', group: 'Болота', title: 'Тот же стык с сеткой и числами', note: 'Цвет чанка — доля болота в нём. Картинка рисуется из этих чисел.', p: { grid: 1, swampMap: 'share', forest3d: 0, towns: 0, labels: 0 }, cam: cam(37.22, -6.2, 110, 25, 0) },
    { id: 'swamp-map', group: 'Болота', title: 'Карта болот региона', note: 'Все чанки с болотом до осушения. Цвет — вид болота: бурый — верховой торфяник, зелёный — тростниковая топь, синий — приморские марши, тёмно-зелёный — заболоченный лес.', p: { swampMap: 'kind', forest3d: 0, towns: 0, labels: 0, roadsOn: 0 }, cam: cam(40.5, -3.0, 1750) },
    { id: 'swamp-map-iron', group: 'Болота', title: 'Карта болотного железа', note: 'Чанки, где в болоте есть железо: болота не меньше десятой части чанка, выше досягаемости моря, во влажном климате. Это вид болот, а не сырьё: в ресурсах болотное железо — то же железо.', p: { swampMap: 'iron', forest3d: 0, towns: 0, labels: 0, roadsOn: 0 }, cam: cam(40.5, -3.0, 1750) },
  ],
  async init(album) {
    const ch = album.chunks, p = album.params;
    let wetlands = [];
    try { wetlands = wetlandsOfStage((await (await fetch('assets/album/swamp/wetlands.json')).json()).wetlands); } catch (e) { console.warn('[album] swamp: no list of wetlands,', e.message); }
    const natural = naturalSwamp(ch, album.data.base.at, { wetlands });
    for (let k = 0; k < ch.count; k++) ch.setNatural('swamp', k, natural[k]);
    const centres = Array.from({ length: ch.count }, (_, k) => ch.centre(k));
    const kindOf = k => swampKind(centres[k].lat, centres[k].lon, ch.height[k]), ironOf = k => swampIron(ch.get('swamp', k), centres[k].lat, centres[k].lon, ch.height[k]);
    album.swamp = { natural, wetlands, kindOf, ironOf };
    // (stage 3) the swamp of the chunks of 1 km²: km — a byte a chunk, kmVersion — grows when it changes. The
    // settlements watch the version and write the array into their texture; until they have, the shader lays the
    // swamp by its noise (uSwampKm 0).
    let kmSeen = !S3;
    if (S3) {
      const t0 = performance.now();
      album.swamp.km = swampKmOf(ch, album.data.base.at, natural, { rivers: album.data.vectors?.rivers || [] }); album.swamp.kmVersion = 1;
      console.info(`[album] swamp of the chunks of 1 km²: ${Math.round(performance.now() - t0)} ms`);
    }

    // a demonstration of winter: the swamps freeze, light snow lies on the land, more of it on the open mire
    ch.onReset(c => {
      const f = p.get('swampFrost'); if (!f) return;
      for (let k = 0; k < c.count; k++) {
        if (c.kind[k] !== 1) continue;
        const s = c.get('swamp', k);
        if (s > 0) c.set('ice', k, Math.max(c.get('ice', k), f));
        c.set('snow', k, Math.max(c.get('snow', k), f * (.24 + .2 * s)));
      }
    });
    // the swamps of the region as squares over the map (chunks.show)
    const v = new Float32Array(ch.count);
    function showMap() {
      const id = p.get('swampMap'); if (!id) return false;
      for (let k = 0; k < ch.count; k++) {
        const s = ch.get('swamp', k);
        if (!(s > 0) || ch.kind[k] !== 1) { v[k] = 0; continue; }
        if (id === 'kind') { const kd = kindOf(k); let best = 0; for (let i = 1; i < 4; i++) if (kd[KINDS[i]] > kd[KINDS[best]]) best = i; v[k] = (best + .6 + .38 * s) / 4; }
        else v[k] = id === 'iron' ? ironOf(k) : s;
      }
      if (id === 'kind') ch.show(v, { ramp: t => { const i = Math.min(3, Math.floor(t * 4)), f = t * 4 - i, c = KIND_COL[i]; return c.map(x => .92 + (x - .92) * f); }, alpha: .85 });
      else if (id === 'iron') ch.show(v, { ramp: t => [.93 - .18 * t, .80 - .50 * t, .55 - .47 * t], alpha: .85 });
      else ch.show(v, { ramp: t => [.86 - .72 * t, .92 - .50 * t, .90 - .42 * t], alpha: .8 });
      return true;
    }
    let shown = -1;
    p.on(key => {
      if (key === 'swampFrost') p.setMany({});                       // lays every demonstration over the natural state again
      else if (key == null || key === 'swampMap') { if (showMap()) shown = ch.version; else if (key === 'swampMap') ch.show(null); }
    });
    if (p.get('swampFrost')) ch.reset();
    if (showMap()) shown = ch.version;
    return { id: 'swamp', update() {
      if (p.get('swampMap') && shown !== ch.version) { showMap(); shown = ch.version; }
      if (!kmSeen && swampKmMirrored(album.swamp.km)) { kmSeen = true; album.terrain.u.uSwampKm.value = 1; }
    } };
  },
};
