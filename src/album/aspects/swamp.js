// ASPECT «Болота»: where the swamps of the region are and how they look. This file belongs to the swamp work; the
// contract with the rest of the album is in docs/ALBUM-CHUNKS.md, the rules and their sources in docs/album/swamp.md.
//   aspSwamp(p, L) → paints the swamp over the bare ground L.col, thins the forest (L.cover), adds open water (L.gloss)
// The state comes from the chunks: p.cA.a = share of the chunk's land under swamp, p.cB = (ice, snow, flood, spare).
// Which swamp grows at a place is not stored: it follows from the height, the wetness and the sea (swampKind).

import { FKM, FN, CHUNK_KM, CI0, CJ0 } from '../chunks.js';

// ---- rules on the CPU: the same numbers as in the GLSL below, for the natural state, the map of swamps, the tests
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const KMD = 111.195, COS = Math.cos(40 * Math.PI / 180), X0 = CI0 * CHUNK_KM, Y0 = CJ0 * CHUNK_KM;   // flat km, as in chunks.js
// the CPU twin of albumWet() in glsl.js, without its noise: 0 dry steppe .. 1 Atlantic forest
export function wetAt(lat, lon, h) {
  const g = (la, lo, s) => Math.exp(-((lat - la) ** 2 + (lon - lo) ** 2) / s);
  return .42 + .34 * ss(42.2, 43.4, lat) * ss(-.5, -2.5, lon) + .30 * ss(-6.2, -8.6, lon) * ss(38.2, 41.8, lat)
    + .22 * ss(42, 43.2, lat) * ss(3.5, .5, lon) + .25 * ss(43, 44.5, lat)
    - .24 * g(41.6, -.6, 1.7) - .30 * g(37.6, -1.8, 2.2) - .12 * g(39.3, -3, 2.6) + h * .00016;
}
// mean temperature of the year, °C (the same stand-in as the data mode of terrain.js)
export const tempAt = (lat, h) => 17.5 - (lat - 38) * .75 - h * .0062;
// which swamp grows here; the four shares add up to 1
//   salt  the lowest ground, where the sea reaches: tidal marsh, mud, salt
//   bog   cold and wet: raised and blanket peat bog
//   carr  warm and wet: flooded forest
//   fen   the rest: reed and sedge marsh
export function swampKind(lat, lon, h) {
  const wet = wetAt(lat, lon, h), salt = 1 - ss(3, 8, h);
  let rest = 1 - salt;
  const bog = rest * ss(11.5, 9, tempAt(lat, h)) * ss(.56, .70, wet); rest -= bog;
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
  const hgt = new Float32Array(FN * FN).fill(-1);
  for (let ty = 0, t = 0; ty < FN; ty++) {
    const lat = (Y0 + (ty + .5) * FKM) / KMD;
    for (let tx = 0; tx < FN; tx++, t++) if (isLand(cell[t])) hgt[t] = heightAt(lat, (X0 + (tx + .5) * FKM) / (KMD * COS));
  }
  // how much of the chunk is flat ground (water stands on it) and gentle ground (a blanket of peat holds on it):
  // the share of neighbouring points inside the chunk that differ by less than 9 m, and by less than 55 m
  const tex = new Uint32Array(n), pairs = new Uint32Array(n), fl = new Uint32Array(n), ge = new Uint32Array(n);
  for (let ty = 0, t = 0; ty < FN; ty++) for (let tx = 0; tx < FN; tx++, t++) {
    const k = cell[t], h = hgt[t]; tex[k]++;
    if (h <= 0) continue;
    for (let d = 0; d < 2; d++) {
      if (d ? ty >= FN - 1 : tx >= FN - 1) continue;
      const m = t + (d ? FN : 1); if (cell[m] !== k) continue;
      const g = hgt[m]; if (g <= 0) continue;
      const dh = Math.abs(g - h); pairs[k]++;
      if (dh < 1e-6 && h > 8) continue;              // a dead-level surface inland is a reservoir in the height data, not land
      if (dh < 9) fl[k]++; if (dh < 55) ge[k]++;
    }
  }
  const flat = k => pairs[k] ? fl[k] / pairs[k] : 0, gentle = k => pairs[k] ? ge[k] / pairs[k] : 0;
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
    const humid = ss(.56, .74, wet) * level * (.45 + .55 * basin);                  // level, badly drained ground in a wet climate
    const mire = ss(.72, .92, wet) * ss(9.5, 7, tempAt(c.lat, h)) * ss(.5, .9, gentle(k));      // cold wet uplands
    const v = Math.max(coast * .5, flood * .25, humid * .22, mire * .09) + mouth[k] * .12 * level;
    out[k] = v < .04 ? 0 : Math.min(.95, v);
  }
  // the wetlands known by name: a disc of their area (or an outline) laid over the chunks it covers, land only. Steep
  // ground holds half of it; what it does not hold lies on the level chunks beside it, so the area is kept.
  const PEAK = .85, TKM2 = FKM * FKM;
  const fit = k => { const c = ch.centre(k); return .5 + .5 * Math.max(ss(.3, .8, flat(k)), ss(11.5, 9, tempAt(c.lat, ch.height[k])) * ss(.4, .8, gentle(k))); };
  const clampT = v => Math.max(0, Math.min(FN - 1, Math.floor(v)));
  for (const w of wetlands) {
    const acc = new Map(), R = w.poly ? 0 : Math.sqrt(w.km2 / (Math.PI * PEAK)), wx = w.lon * KMD * COS, wy = w.lat * KMD;
    const xs = w.poly ? w.poly.map(q => q[1] * KMD * COS) : [wx - R * 1.3, wx + R * 1.3], ys = w.poly ? w.poly.map(q => q[0] * KMD) : [wy - R * 1.3, wy + R * 1.3];
    const tx0 = clampT((Math.min(...xs) - X0) / FKM), tx1 = clampT((Math.max(...xs) - X0) / FKM), ty0 = clampT((Math.min(...ys) - Y0) / FKM), ty1 = clampT((Math.max(...ys) - Y0) / FKM);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const k = cell[ty * FN + tx]; if (!isLand(k)) continue;
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
  for (let k = 0; k < n; k++) { if (!out[k]) continue; const c = ch.centre(k); if (c.lat < 35.15 || c.lat > 44.85 || c.lon < -10.05 || c.lon > 4.55) out[k] = 0; }
  return out;
}

// ---- rules in GLSL, shared with anything that must know what a swamp is at a point (the trees of layers/forest.js).
// They need COMMON of glsl.js (heightLod, vnoise) and nothing else: no uniforms, no screen derivatives.
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
  float t = 17.5 - (ll.x - 38.) * .75 - hs * .0062, salt = 1. - smoothstep(3., 8., hs), rest = 1. - salt;
  float bog = rest * smoothstep(11.5, 9., t) * smoothstep(.56, .70, wet); rest -= bog;
  float carr = rest * smoothstep(.58, .70, wet);
  return vec4(bog, rest - carr, salt, carr);
}
// 1 on the coasts of the ocean, where the tide comes in twice a day; 0 on the Mediterranean
float swampTide(vec2 ll) { return max(1. - smoothstep(-5.9, -5.3, ll.y), smoothstep(42.9, 43.2, ll.x) * (1. - smoothstep(-.6, .4, ll.y))); }
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
${SWAMP_RULES}
// a line of water of half-width w km, a km away from the middle of a pixel px km wide: the share of the pixel it covers
float swampLine(float a, float w, float px) { return clamp((min(w, a + .5 * px) - max(-w, a - .5 * px)) / px, 0., 1.); }

float fSwampW = 0.;   // how much of this pixel the swamp has painted, 0..1: for the aspects painted after it (the fields keep off it — aspects/settle.js)
void aspSwamp(Px p, inout Land L) {
  float s = p.cA.a;
  if (s < .004 || p.h < -1.) return;
  vec2 pk = p.pk; float px = p.px, far = smoothstep(1.5, 4.5, px), f = swampField(pk, p.n2, p.n3, px);
  if (s * 1.05 - f + .3 < -.07 && far <= 0.) return;                                  // dry even in the lowest hollow
  float hs = swampHeight(p.ll), slope = swampSlope(p.ll, hs);
  float hk = hs + (p.n2 - .5) * 3. + (p.n3 - .5) * 1.5;                               // a little unevenness, so the kinds do not change along the cells of the height data
  vec4 kind = swampKind(p.ll, hk, p.wet);
  float d = swampDepth(s, f, p.ll, hs, slope, kind.x);
  float m = mix(smoothstep(-.07, .07, d), clamp(s * 1.05, 0., 1.) * step(slope, .05), far);
  fSwampW = m; if (m < .004) return;
  float z = clamp(d * 2., 0., 1.);                                                    // 0 the edge of the swamp .. 1 its heart
  float glade = kind.w * smoothstep(.15, .5, z) * .85; kind.w -= glade; kind.y += glade;   // the heart of a flooded forest is open reed and water
  float tide = swampTide(p.ll), ice = p.cB.r, snow = p.cB.g, cold = max(ice, snow), mott = p.n3;
  float lvl = .5 + uSwampWater + p.cB.b;                                              // water level: 1 is the usual one; a flood of the chunk raises it
  float flats = kind.z * smoothstep(2.2, .5, hk);                                     // the lowest salt marsh: flats the sea covers
  float cw = dot(kind, vec4(.3, 1., 1.3, .8)) * lvl * (1. + flats * .5);              // how wide the creeks are
  float pa = dot(kind, vec4(.10, .30, .16 - .08 * tide, .20));                        // how much water stands in pools

  // ---- open water: creeks (the level lines of a noise: arms, and side creeks that taper away from them) and pools
  float water = 0., wdeep = 0., edge = 9., eP = 9., P = .5, near = 1. - smoothstep(.5, 1.5, px);
  if (near > 0.) {
    vec2 q = pk + (vec2(vnoise(pk / 2.3 + 3.), vnoise(pk / 2.3 + 47.)) - .5) * 1.1;
    float a1 = abs(swampNoise(q / 7.5 + 11.) - .5 - (p.n2 - .47) * .3) * 6.3;                     // ≈ km to the nearest arm
    float a2 = abs(swampNoise(q / 2.0 + 29.) - .5 - (mott - .5) * .15) * 1.65, f2 = smoothstep(.45, .15, px);   // ≈ km to the nearest side creek
    float w1 = max((.015 + .05 * z) * cw, px * .6 * smoothstep(0., .3, z)), w2 = (.005 + .02 * z) * cw * (1. - smoothstep(.1, .9, a1));
    float line = max(swampLine(a1, w1, px), swampLine(a2, w2, px) * f2), eL = min(a1 - w1, mix(9., a2 - w2, f2));
    wdeep = max(clamp(1. - a1 / max(w1, 1e-3), 0., 1.), clamp(1. - a2 / max(w2, 1e-3), 0., 1.) * f2) * 1.2;
    float o2 = px < .3 ? mix(.5, swampNoise(q / .34 + 5.), smoothstep(.3, .1, px)) : .5, o3 = px < .1 ? mix(.5, vnoise(q / .11 + 71.), smoothstep(.1, .035, px)) : .5;
    P = smoothstep(.3, .7, swampNoise(q / 1.15 + 13.) * .6 + o2 * .28 + o3 * .12 + .07 * (1. - smoothstep(0., .5, a2)) * f2);   // pools string along the creeks
    float A = pa * z * lvl, e = clamp(px * .9, .012, .3), pool = smoothstep(-e, e, P - (1. - A));
    eP = ((1. - A) - P) * .6;
    if (kind.x > .03 && px < .2) {                                                    // a raised bog keeps its water in clusters of small round pools
      vec2 wv = worley(q / .21 + 7.);
      float r = .16 + .30 * wv.y, pe = clamp(px / .21, .02, .4);
      float on = kind.x * smoothstep(.40, .62, P + z * .25 - .12) * step(wv.y, .25 + .6 * z * lvl) * smoothstep(.2, .1, px);
      pool = max(pool, on * (1. - smoothstep(r - pe, r + pe, wv.x)));
      eP = min(eP, mix(9., (wv.x - r) * .21, step(.5, on)));
    }
    water = max(line, pool);
    wdeep = max(wdeep, clamp(-eP * 6., 0., 1.));
    edge = min(eL, eP);
  }
  water = mix(z * (pa * .5 + .05 * cw) * lvl, water, near);                           // what is left of the water when it is smaller than a pixel

  // ---- what grows
  float fine = px < .12 ? mix(.5, vnoise(pk / .085 + 3.), smoothstep(.12, .04, px)) : .5;   // tussocks and hummocks
  vec3 vBog = mix(vec3(.46, .37, .18), vec3(.36, .37, .16), mott);                    // ochre moss and deer grass
  vBog = mix(vBog, vec3(.33, .22, .17), smoothstep(.52, .8, fine) * .6);              // russet hummocks of heather
  vBog = mix(vBog, vec3(.49, .46, .17), smoothstep(.38, .12, fine) * z * .55);        // bright wet moss in the hollows
  vec3 vFen = mix(vec3(.22, .38, .13), vec3(.37, .46, .16), mott * .6 + fine * .4);   // reed beds
  vFen = mix(vFen, vec3(.56, .51, .27), smoothstep(.55, .8, P * .5 + p.n2 * .5) * .45);     // stands of last year's straw
  vFen = mix(vec3(.47, .45, .22), vFen, smoothstep(0., .35, z));                      // sedge and wet grass at the dry edge
  vec3 vSalt = mix(vec3(.38, .46, .24), vec3(.52, .53, .30), mott * .6 + fine * .4);  // cord grass, sea purslane
  vSalt = mix(vSalt, vec3(.47, .33, .26), smoothstep(.5, .8, p.n2) * (1. - z * .5) * .45);  // red glasswort on the high marsh
  vSalt = mix(vSalt, vFen, (1. - tide) * .35);                                        // a tideless shore is half reed
  vec3 vCarr = mix(vec3(.12, .17, .08), vec3(.25, .31, .13), mott * .6 + fine * .4);  // wet black litter and sedge under alder and willow
  vec3 veg = kind.x * vBog + kind.y * vFen + kind.z * vSalt + kind.w * vCarr;
  vec3 dead = kind.x * vec3(.35, .26, .19) + kind.y * vec3(.63, .55, .34) + kind.z * vec3(.46, .42, .31) + kind.w * vec3(.21, .20, .14);
  veg = mix(veg, dead * (.85 + .3 * mott), smoothstep(.05, .5, cold) * .85);          // winter: reed and sedge die back to straw, moss darkens
  veg *= mix(vec3(1.), texDetail(tGrass, pk, px, p.pdx, p.pdy), .7);
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
  vec3 wcol = mix(kind.x * vec3(.15, .12, .08) + kind.y * vec3(.20, .33, .29) + kind.z * vec3(.47, .48, .39) + kind.w * vec3(.11, .16, .12),
    kind.x * vec3(.03, .035, .045) + kind.y * vec3(.06, .19, .29) + kind.z * vec3(.17, .34, .39) + kind.w * vec3(.05, .15, .21), smoothstep(0., .7, wdeep));
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
  L.gloss = max(L.gloss, m * (water * mix(.45 * (1. - pads * .8) * (1. - rust * .8), .10, frozen) + mud * tide * .06 * (1. - water)) * (1. - snowed) * (1. - L.cover));
}`;

const cam = (lat, lon, h, tilt = 0, heading = 0) => ({ lat, lon, h, tilt, heading });
const KINDS = ['bog', 'fen', 'salt', 'carr'], KIND_COL = [[.78, .33, .10], [.50, .86, .16], [.16, .56, .98], [.02, .50, .40]];

export default {
  id: 'swamp', title: 'Болота', glsl: GLSL,
  uniforms: { uSwampWater: { value: .5 }, uSwampIron: { value: 1 } },
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
    try { wetlands = (await (await fetch('assets/album/swamp/wetlands.json')).json()).wetlands; } catch (e) { console.warn('[album] swamp: no list of wetlands,', e.message); }
    const natural = naturalSwamp(ch, album.data.base.at, { wetlands });
    for (let k = 0; k < ch.count; k++) ch.setNatural('swamp', k, natural[k]);
    const centres = Array.from({ length: ch.count }, (_, k) => ch.centre(k));
    const kindOf = k => swampKind(centres[k].lat, centres[k].lon, ch.height[k]), ironOf = k => swampIron(ch.get('swamp', k), centres[k].lat, centres[k].lon, ch.height[k]);
    album.swamp = { natural, wetlands, kindOf, ironOf };

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
    return { id: 'swamp', update() { if (p.get('swampMap') && shown !== ch.version) { showMap(); shown = ch.version; } } };
  },
};
