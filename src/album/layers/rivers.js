// Rivers as they really run (water/courses.js: OpenStreetMap courses, the width of the water at every point), drawn
// as sheets of the same water as the sea and the lakes. Everything is at its real size: the Ebro at Zaragoza is a
// hundred and fifty metres wide, a mountain stream a few metres. A sheet is the water and its banks: the water lies
// below the land, the banks slope down to it, one bank lit by the sun and the other in its own shade; the deep thread
// keeps to the outer bank of a bend and a pale bar lies on the inner one. From high up a river is never thinner than
// a pixel or three, and the brooks, far thinner than a pixel, are left out. A river freezes with its chunk, a little
// later than still water. Where the height data says sea, it ends. A river that is dry for a part of the year
// (a rambla) is a bed of pale gravel with a thread of water.
import { BufferGeometry, BufferAttribute, Mesh, ShaderMaterial, Color, DoubleSide, CustomBlending, SrcAlphaFactor, OneMinusSrcAlphaFactor } from 'three';
import { COMMON, CHUNK_GLSL, LIGHT } from '../glsl.js';
import { SHEET_VERT, SHEET_FRAG, sheetUniforms, sheetPull } from '../aspects/water.js';
import { KM_PER_DEG } from '../geo.js';

const D = Math.PI / 180;
const FLAT = { atlas: 0x3d78b8, paper: 0x5f8fb5, night: 0x6f8fb0 };          // looks that draw rivers as plain lines
export const MIN_PX = 3;               // a great river is never thinner than this on the screen; a small one .42 of it
export const SHOW = [.035, .1];        // a river is left out when its water is under SHOW[0] of a pixel, whole from SHOW[1]
// From high up (the owner, 13.11.2026: реки издалека «слишком жирные, потому что изогнутые… чтобы реки всё же
// выпрямлялись, когда мы отдалялись»). Near the ground nothing changes. As the camera rises:
//   • the line of a river is drawn smoother: its bends are evened out over GEN.w[0] km on each side, higher up over
//     GEN.w[1] km — the corners of every sheet slide toward the smoother line (GEN.t: between which sizes of a
//     pixel, km), so a river straightens without a jump and still meets the river it runs into;
//   • the least width falls from MIN_PX to FAR_PX pixels: a river does not grow fatter with height;
//   • fewer rivers are drawn: the widths SHOW are multiplied by up to FAR_SHOW, the small tributaries go first;
//   • the thin line turns a paler blue, FAR_TINT of it, so that it can be told in a dark forest.
// Between about 60 and 300 km (the lead, 14.11.2026, on the new light land: реки «стали тяжёлыми: тёмно-синяя толстая
// линия с тёмной каймой… Мансанарес и Харама читаются как большие реки»):
//   • a thin river is its water alone: the sheet no longer keeps room for banks that cannot be seen (MID.lean);
//   • a small river is far thinner than a great one: the least width goes by the width itself, from MID.least[0] of
//     the full least width for a brook to MID.least[1] for a river 160 m wide, and a small river is a little
//     transparent (MID.clear), so that it takes the tone of the land it runs through;
//   • the line is the grey-blue of water seen from above (MID.tint of it): darker than dry land, but not the deep
//     saturated blue of the near view.
// By 500 km all of this has given way to the rule of the far view above (MID.back), which stays as it was.
// And at no height does a river write its depth: the finishing pass shaded the step in depth as a dark rim.
export const GEN = { w: [.7, 3.5], t: [[.03, .1], [.16, .5]], range: 12 };
export const FAR_PX = 1.6, FAR_SHOW = 2, FAR_TINT = .7;
export const MID = { lean: [.03, .06], back: [.2, .32], least: [.42, 1.3], clear: .85, tint: .85, tintAt: [.03, .07] };
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// how a river is drawn when a pixel is px km: its least width in pixels, the widths it shows from, how far its line
// has slid toward the two smoother shapes
// … lean: how far the rule of the middle heights is in force (0 near the ground and from 500 km up); tint: how much
// of the soft blue of the middle heights and of the paler blue of the far view the thin line takes, and which of the two
export function riverFar(px) {
  const k = 1 + (FAR_SHOW - 1) * ss(.05, .55, px), back = ss(MID.back[0], MID.back[1], px);
  return { minPx: MIN_PX - (MIN_PX - FAR_PX) * ss(.03, .35, px), show: [SHOW[0] * k, SHOW[1] * k], gen: [ss(GEN.t[0][0], GEN.t[0][1], px), ss(GEN.t[1][0], GEN.t[1][1], px)],
    lean: ss(MID.lean[0], MID.lean[1], px) * (1 - back), tint: [MID.tint * ss(MID.tintAt[0], MID.tintAt[1], px), FAR_TINT * ss(.03, .2, px), back] };
}
// the water of a river `real` km wide as it is drawn when a pixel is px km (the same sums as the shader): km
export function riverDrawn(real, px) {
  const f = riverFar(px), s2 = Math.max(0, Math.min(1, real / .16)), size = Math.sqrt(s2);
  const least = (.42 + .58 * size) * (1 - f.lean) + (MID.least[0] + (MID.least[1] - MID.least[0]) * s2) * f.lean;
  return Math.max(real, px * f.minPx * least);
}

// The rivers as the sheets are built from them: [{ name, dry, n, ll (lon, lat pairs), w (km), dist (km from the
// source), curv (1/km, + bends to the left), fade (0 at an end in the sea .. 1), mouth }].
// heightAt(lat, lon) → metres: a river ends where it meets the sea for good (a kilometre and a half of it under
// water) and does not come out again on the shoals and islands beyond; its last kilometre fades into the sea.
export function riverSheets(courses, heightAt) {
  const out = [];
  for (const r of courses.rivers) {
    let n = r.n, mouth = false; const x = new Float64Array(n), y = new Float64Array(n), dist = new Float32Array(n);
    for (let i = 0; i < n; i++) { x[i] = r.ll[i * 2] * KM_PER_DEG * Math.cos(r.ll[i * 2 + 1] * D); y[i] = r.ll[i * 2 + 1] * KM_PER_DEG; if (i) dist[i] = dist[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]); }
    if (heightAt) for (let i = 0, wet = -1; i < n; i++) {
      if (heightAt(r.ll[i * 2 + 1], r.ll[i * 2]) < -.3) { if (wet < 0) wet = i; if (dist[i] - dist[wet] >= 1.5 || (i === n - 1 && !r.joins && wet > 0)) { n = wet + 1; mouth = true; break; } } else wet = -1;
    }
    if (n < 3 || dist[n - 1] < .6) continue;
    const curv = new Float32Array(n), fade = new Float32Array(n).fill(1), len = dist[n - 1];
    for (let i = 1; i < n - 1; i++) {                              // the turn at a point over the way to its neighbours, then evened out
      const ax = x[i] - x[i - 1], ay = y[i] - y[i - 1], bx = x[i + 1] - x[i], by = y[i + 1] - y[i];
      curv[i] = Math.atan2(ax * by - ay * bx, ax * bx + ay * by) / Math.max(.01, (Math.hypot(ax, ay) + Math.hypot(bx, by)) / 2);
    }
    const sm = new Float32Array(n);
    for (let i = 0, a = 0, b = 0, sum = 0; i < n; i++) { const span = Math.max(.08, r.w[i] * 1.5); while (b < n && dist[b] <= dist[i] + span) sum += curv[b++]; while (dist[a] < dist[i] - span) sum -= curv[a++]; sm[i] = sum / (b - a); }
    for (let i = 0; i < n; i++) fade[i] = (r.arm ? 1 : Math.min(1, dist[i] / .15 + .15)) * (mouth ? Math.min(1, (len - dist[i]) / 1) : 1);   // a source tapers in; an arm of a river does not
    out.push({ name: r.ru || r.name, dry: r.dry, n, ll: r.ll.subarray(0, n * 2), w: r.w.subarray(0, n), dist, curv: sm, fade, mouth, joins: !!r.joins && !mouth, arm: !!r.arm, acc: r.acc || 0 });
  }
  return out;
}

// The average of v(s) over w km on each side of every point of a line (dist: km along it). Past its ends the line is
// carried on by reflection through them, so an end stays where it is.
function boxed(v, dist, n, W, out) {
  const L = dist[n - 1], w = Math.min(W, L / 2), pre = new Float64Array(n);
  for (let i = 1; i < n; i++) pre[i] = pre[i - 1] + (dist[i] - dist[i - 1]) * (v[i] + v[i - 1]) / 2;
  const I = s => {
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (dist[m] <= s) lo = m; else hi = m; }
    const seg = dist[hi] - dist[lo], vs = v[lo] + (v[hi] - v[lo]) * (seg > 0 ? (s - dist[lo]) / seg : 0);
    return pre[lo] + (s - dist[lo]) * (v[lo] + vs) / 2;
  };
  const J = s => (s < 0 ? I(-s) + 2 * v[0] * s : s > L ? 2 * v[n - 1] * (s - L) + I(2 * L - s) : I(s));
  if (!(w > 0)) { for (let i = 0; i < n; i++) out[i] = v[i]; return; }
  for (let i = 0; i < n; i++) out[i] = (J(dist[i] + w) - J(dist[i] - w)) / (2 * w);
}
// The two smoother shapes of every river (GEN), for the far view. Adds to each line of riverSheets():
//   off     Float32Array, four numbers a point: how far (km east, north) the point lies from its place on the first
//           smoother line, and on the second
// A river that ends on another (or an arm that leaves one) follows the smoother line of that river with its end, so
// the two still meet.
export function riverGeneral(lines, widths = GEN.w) {
  const KM = KM_PER_DEG;
  for (const l of lines) {
    const n = l.n, lon = new Float64Array(n), lat = new Float64Array(n), sl = new Float64Array(n), sa = new Float64Array(n), off = l.off = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { lon[i] = l.ll[i * 2]; lat[i] = l.ll[i * 2 + 1]; }
    widths.forEach((W, k) => {
      boxed(lon, l.dist, n, W, sl); boxed(lat, l.dist, n, W, sa);
      for (let i = 0; i < n; i++) { off[i * 4 + k * 2] = (sl[i] - lon[i]) * KM * Math.cos(lat[i] * D); off[i * 4 + k * 2 + 1] = (sa[i] - lat[i]) * KM; }
    });
  }
  // ends that lie on another river: which point of which river
  const C = .3, grid = new Map(), ends = [], xy = (l, i) => [l.ll[i * 2] * KM * Math.cos(l.ll[i * 2 + 1] * D), l.ll[i * 2 + 1] * KM];
  lines.forEach((l, li) => { for (const [flag, i] of [[l.joins, l.n - 1], [l.arm, 0]]) if (flag) { const [x, y] = xy(l, i), e = { li, i, x, y, d: .25, to: -1, at: 0 }; ends.push(e);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const k = (Math.floor(x / C) + di) * 100003 + Math.floor(y / C) + dj; (grid.get(k) || grid.set(k, []).get(k)).push(e); } } });
  if (ends.length) lines.forEach((l, li) => { for (let i = 0; i < l.n; i++) { const [x, y] = xy(l, i), list = grid.get(Math.floor(x / C) * 100003 + Math.floor(y / C)); if (!list) continue;
    for (const e of list) { if (e.li === li) continue; const d = Math.hypot(x - e.x, y - e.y); if (d < e.d) { e.d = d; e.to = li; e.at = i; } } } });
  // the greater rivers first: an end takes the shift of the river it lies on and hands it on, fading, up its own line
  for (const e of ends.filter(e => e.to >= 0).sort((p, q) => lines[q.li].acc - lines[p.li].acc || p.li - q.li)) {
    const l = lines[e.li], par = lines[e.to].off, s0 = l.dist[e.i];
    for (let k = 0; k < widths.length; k++) {
      const px = par[e.at * 4 + k * 2] - l.off[e.i * 4 + k * 2], py = par[e.at * 4 + k * 2 + 1] - l.off[e.i * 4 + k * 2 + 1], R = widths[k] * 2.5;
      for (let i = 0; i < l.n; i++) { const g = 1 - ss(0, R, Math.abs(l.dist[i] - s0)); if (g <= 0) continue; l.off[i * 4 + k * 2] += px * g; l.off[i * 4 + k * 2 + 1] += py * g; }
    }
  }
  return lines;
}

const VERT = /* glsl */`${COMMON}
  ${SHEET_VERT}
  attribute vec2 aLL; attribute vec4 aW, aMisc, aGen, aGenDir; uniform float uPx, uK, uMinPx, uLean; uniform vec2 uShow, uGen;   // aMisc: the way the river runs (east, north), side −1 | 1, fade · aGen, aGenDir: where the two smoother lines lie and how they run
  varying float vSide; varying vec2 vEnd, vAcross; varying vec4 vRiv; varying float vWater;
  void main() {
    float real = aW.x * uK, s2 = clamp(real / .16, 0., 1.), size = sqrt(s2);        // the water from bank to bank, km
    // never thinner than a pixel or three; from the middle heights a small river is far thinner than a great one
    float water = max(real, uPx * uMinPx * mix(mix(.42, 1., size), mix(${MID.least[0].toFixed(2)}, ${MID.least[1].toFixed(2)}, s2), uLean));
    float show = smoothstep(uShow.x, uShow.y, real / max(uPx, 1e-5));               // brooks far thinner than a pixel are left out
    float full = water * 1.5 + min(water * .8, .03);                                // the banks stand beside the water
    float bed = mix(full, mix(water, full, smoothstep(5., 13., full / max(uPx, 1e-5))), uLean);   // … but a thin river seen from the middle heights is its water alone
    vec2 slide = mix(aGen.xy * uGen.x, aGen.zw, uGen.y) * ${GEN.range.toFixed(1)}, way = mix(mix(aMisc.xy, aGenDir.xy, uGen.x), aGenDir.zw, uGen.y);   // from high up the line is smoother
    vec2 at = aLL + vec2(slide.y / KM, slide.x / (KM * cos(radians(aLL.x))));
    float sd = sign(aMisc.z); vec2 across = normalize(vec2(-way.y, way.x) + 1e-6) * sd, off = across * bed * .5;
    vSide = sd; vEnd = vec2(aMisc.w * show * mix(1., mix(${MID.clear.toFixed(2)}, 1., s2), uLean), step(aW.z, 0.)); vRiv = vec4(bed, aW.y, abs(aW.z), aW.w); vAcross = across; vWater = water / bed;
    sheetVertex(at + vec2(off.y / KM, off.x / (KM * cos(radians(at.x)))), max(heightLod(at, 0.), 0.) * uExag / 1000. + .002);
    if (show <= 0.) gl_Position = vec4(0., 0., 2., 1.);
  }`;
const FRAG = /* glsl */`${COMMON}
  ${CHUNK_GLSL}
  ${LIGHT}
  ${SHEET_FRAG}
  uniform vec3 uFlat, uTint; uniform float uPass; varying float vSide; varying vec2 vEnd, vAcross; varying vec4 vRiv; varying float vWater;   // uPass: 0 the banks · 1 the water
  void main() {
    vec2 pk = sheetPk(); float px = sheetPx(pk);
    float bed = vRiv.x, s = vSide, wpx = bed / max(px, 1e-6), dry = step(.5, vEnd.y);
    float far = smoothstep(5., 13., wpx);                                           // 0 a thin line of water · 1 banks, bars and depth
    float bend = clamp(vRiv.w * bed * 1.6, -1., 1.) * far;                           // + the river turns left: its inner bank is on the left
    float inner = clamp(bend * s * 1.6, 0., 1.);                                     // 1 on the inside of a bend, where the bar lies
    float we = mix(1., vWater * mix(1., .34, dry), far);                             // where the water ends, in halves of the bed
    float c = -bend * (1. - we) * .7;                                                // the water leans to the outer bank
    float wob = (wNoise(vec2(vRiv.y / max(bed * .8, .03), vRiv.z + s * 2.)) - .5) * .16 * far;
    float x = (s - c) / we, aa = max(1.3 / max(wpx, 1.) / we, .01), edge = 1. - abs(x) + wob;
    float water = smoothstep(-aa, aa, edge);
    // beside the water: how far up the bank this pixel lies, 0 at the waterline .. 1 at the rim of the sheet
    float up = clamp((abs(x) - 1.) * we / max(1. - we * (1. - abs(c)), .05), 0., 1.);
    float rimN = (wNoise(vec2(vRiv.y / max(bed * 1.1, .04), vRiv.z + s * 3. + 5.)) - .5) * .35;
    float ground = (1. - smoothstep(.4 + .4 * inner, .8 + .2 * inner, up + rimN)) * far;   // a steep bank is narrow, a bar is broad; both melt into the land
    // the river ends where the height data says sea (the coarse data only, so it ends at the same place from any height)
    float sea = 1. - vEnd.x * smoothstep(-2.2, -.4, mix(-3200., textureLod(uBase, (merc(vLL) - uBaseRect.xy) * uBaseRect.zw, 1.5).r, inRegion(vLL)));
    // the banks of all rivers are drawn first and the water of all rivers after them: where two rivers meet, the
    // bank of one never lies across the water of the other
    float alpha = (uPass < .5 ? ground * (1. - water) : water) * (1. - sea);
    if (alpha < .004) discard;
    vec3 col;
    if (uStyle == 2 || uStyle == 3 || uStyle == 6) { if (uPass < .5) discard; col = uFlat * (.35 + .65 * albumDay()); alpha = (1. - smoothstep(.55, .75, abs(s) / mix(1., .8, far))) * (1. - sea); }
    else if (uPass < .5) {
      // The banks slope down to the water. A steep bank on the outside of a bend: wet dark earth at the waterline,
      // earth, then scrub. A bar on the inside: wet sand, then pale sand and gravel. The slope that faces the sun is
      // light, the other lies in its own shade.
      float grain = .9 + .2 * wNoise(pk / .03 + 2.);
      vec3 wet = vec3(.29, .27, .19), steep = mix(mix(wet, vec3(.41, .38, .25), smoothstep(0., .45, up)), vec3(.31, .36, .19), smoothstep(.35, .9, up));
      vec3 bar = mix(wet * 1.25, mix(vec3(.72, .67, .52), vec3(.80, .76, .64), dry), smoothstep(0., .3, up)) * grain;
      float slope = mix(1.7, .35, max(inner, dry)) * (1. - smoothstep(.6, 1., up));
      col = sheetGround(mix(steep, bar, max(inner, dry * .8)), vec3(-vAcross * slope, 1.));
    } else {
      Wtr w = sheetWater(2, pk, px);
      float deep = (2.4 + 5. * smoothstep(.012, .26, bed * vWater)) * mix(1., .25, dry), t = x + bend * .55;   // the deep thread hugs the outer bank
      w.depth = mix(deep, deep * clamp(1. - t * t * .85, .05, 1.) * smoothstep(0., .45, edge), far);
      w.cB.r = clamp(w.cB.r * 1.25 - .25, 0., 1.);                                    // running water freezes later than still water
      col = waterLit(w);
      // the thin line: from the middle heights a soft blue that sits in the land, from high up a paler line that can be told from a dark forest
      col = mix(col, mix(vec3(.05, .125, .19), vec3(.05, .15, .36), uTint.z) * (.2 + .8 * albumDay()), mix(uTint.x, uTint.y, uTint.z) * (1. - far) * (1. - w.cB.r));
      float foot = far * (1. - dry) * (1. - inner) * smoothstep(.35, 0., edge) * clamp(dot(vAcross, uSun.xy) * 1.5, 0., 1.) * .5;   // a steep bank shades the water at its foot
      col *= 1. - foot;
    }
    sheetOut(col, alpha, 1.);
  }`;

function build(lines) {
  let n = 0; for (const l of lines) n += l.n;
  const ll = new Float32Array(n * 4), misc = new Int8Array(n * 8), wk = new Float32Array(n * 8), gen = new Int16Array(n * 8), gdir = new Int8Array(n * 8), idx = new Uint32Array(Math.max(0, n - lines.length) * 6);
  const pack = v => Math.round(Math.max(-1, Math.min(1, v / GEN.range)) * 32767);
  let v = 0, q = 0;
  lines.forEach((l, li) => {
    const seed = ((li * 3.7 + 1.3) % 97 + 1) * (l.dry ? -1 : 1);     // a dry river says so by the sign of its seed
    const o = l.off;
    for (let i = 0; i < l.n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(l.n - 1, i + 1), lat = l.ll[i * 2 + 1], c = Math.cos(lat * D);
      let dx = (l.ll[b * 2] - l.ll[a * 2]) * c, dy = l.ll[b * 2 + 1] - l.ll[a * 2 + 1]; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      // the way each smoother line runs here (km east, north between its neighbours)
      const ex = (l.ll[b * 2] - l.ll[a * 2]) * KM_PER_DEG * c, ey = (l.ll[b * 2 + 1] - l.ll[a * 2 + 1]) * KM_PER_DEG, way = [dx, dy, dx, dy];
      if (o) for (let k = 0; k < 2; k++) { const gx = ex + o[b * 4 + k * 2] - o[a * 4 + k * 2], gy = ey + o[b * 4 + k * 2 + 1] - o[a * 4 + k * 2 + 1], gl = Math.hypot(gx, gy); if (gl > 1e-6) { way[k * 2] = gx / gl; way[k * 2 + 1] = gy / gl; } }
      for (let s = 0; s < 2; s++, v++) {
        ll[v * 2] = lat; ll[v * 2 + 1] = l.ll[i * 2]; misc[v * 4] = Math.round(dx * 127); misc[v * 4 + 1] = Math.round(dy * 127); misc[v * 4 + 2] = s ? 127 : -127; misc[v * 4 + 3] = Math.round(l.fade[i] * 127);
        wk[v * 4] = l.w[i]; wk[v * 4 + 1] = l.dist[i]; wk[v * 4 + 2] = seed; wk[v * 4 + 3] = l.curv[i];
        for (let k = 0; k < 4; k++) { gen[v * 4 + k] = o ? pack(o[i * 4 + k]) : 0; gdir[v * 4 + k] = Math.round(way[k] * 127); }
      }
      if (i) { const k = v - 4; idx[q++] = k; idx[q++] = k + 1; idx[q++] = k + 2; idx[q++] = k + 1; idx[q++] = k + 3; idx[q++] = k + 2; }
    }
  });
  const geo = new BufferGeometry();
  geo.setAttribute('aLL', new BufferAttribute(ll, 2)); geo.setAttribute('aW', new BufferAttribute(wk, 4)); geo.setAttribute('aMisc', new BufferAttribute(misc, 4, true));
  geo.setAttribute('aGen', new BufferAttribute(gen, 4, true)); geo.setAttribute('aGenDir', new BufferAttribute(gdir, 4, true)); geo.setIndex(new BufferAttribute(idx, 1));   // 40 bytes a corner
  return { geo, points: n };
}

export default async function init(album) {
  const courses = album.data.courses; if (!courses) { console.warn('[album] no river courses: assets/album/water/rivers.bin.gz'); return null; }
  const t0 = performance.now(), lines = riverGeneral(riverSheets(courses, album.data.base.at)), tGen = performance.now() - t0;
  // two meshes of one material: the brooks, which only show from low down, can be switched off whole
  const widest = l => { let m = 0; for (let i = 0; i < l.n; i++) if (l.w[i] > m) m = l.w[i]; return m; };
  const BROOK = .012, sets = [lines.filter(l => widest(l) >= BROOK), lines.filter(l => widest(l) < BROOK)];
  const u = { ...sheetUniforms(album), uPx: { value: .1 }, uK: { value: 1 }, uMinPx: { value: MIN_PX }, uShow: { value: [SHOW[0], SHOW[1]] }, uGen: { value: [0, 0] }, uLean: { value: 0 }, uTint: { value: [0, 0, 0] }, uFlat: { value: new Color(FLAT.atlas) } };
  // (Neither pass writes its depth. The depth of a sheet is pulled toward the eye, and the finishing pass took that
  // step for relief and shaded a dark rim along every river seen from above. What must stay under the water — the
  // roads — is drawn before it: layers/ribbon.js.)
  const material = pass => new ShaderMaterial({ uniforms: { ...u, uPass: { value: pass } }, depthWrite: false,
    transparent: false, blending: CustomBlending, blendSrc: SrcAlphaFactor, blendDst: OneMinusSrcAlphaFactor, side: DoubleSide, vertexShader: VERT, fragmentShader: FRAG });
  const banksMat = material(0), waterMat = material(1);
  // after the ground and the lakes, before trees and houses: first the banks of every river, then the water of every river
  const add = (geo, mat, order) => { const mesh = new Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = order; album.scene.add(mesh); return mesh; };
  const meshes = sets.map((set, i) => { const b = build(set); return { mesh: add(b.geo, waterMat, -5), banks: i ? null : add(b.geo, banksMat, -6), points: b.points }; });
  const p = album.params; let on = true;
  const sync = () => { on = !!p.get('riversOn') && p.get('rivers') > 0; u.uK.value = p.get('rivers'); u.uFlat.value.set(FLAT[p.get('look')] || FLAT.atlas); };
  p.on(sync); sync();
  console.log(`[album] rivers: ${lines.length} rivers, ${meshes[0].points + meshes[1].points} points, sheets and their smoother lines in ${tGen.toFixed(0)} ms`);
  return { id: 'rivers', lines, stats: () => ({ rivers: lines.length, points: meshes[0].points + meshes[1].points, brooks: sets[1].length }),
    update(dt, t, cam) {
      const px = u.uPx.value = 2 * cam.s.h * Math.tan(cam.cam.fov * Math.PI / 360) / Math.max(1, album.renderer.domElement.clientHeight), far = riverFar(px);
      u.uPull.value = sheetPull(album, cam);
      u.uMinPx.value = far.minPx; u.uShow.value[0] = far.show[0]; u.uShow.value[1] = far.show[1]; u.uGen.value[0] = far.gen[0]; u.uGen.value[1] = far.gen[1]; u.uLean.value = far.lean; u.uTint.value[0] = far.tint[0]; u.uTint.value[1] = far.tint[1]; u.uTint.value[2] = far.tint[2];
      meshes[0].mesh.visible = on; meshes[1].mesh.visible = on && BROOK * u.uK.value / px > far.show[0];
      meshes[0].banks.visible = on && u.uPx.value < .12;            // banks are drawn only while a great river is a few pixels wide
    } };
}
