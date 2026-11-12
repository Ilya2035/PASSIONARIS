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
    out.push({ name: r.ru || r.name, dry: r.dry, n, ll: r.ll.subarray(0, n * 2), w: r.w.subarray(0, n), dist, curv: sm, fade, mouth });
  }
  return out;
}

const VERT = /* glsl */`${COMMON}
  ${SHEET_VERT}
  attribute vec2 aLL; attribute vec4 aW, aMisc; uniform float uPx, uK, uMinPx; uniform vec2 uShow;   // aMisc: the way the river runs (east, north), side −1 | 1, fade
  varying float vSide; varying vec2 vEnd, vAcross; varying vec4 vRiv; varying float vWater;
  void main() {
    float real = aW.x * uK, size = sqrt(clamp(real / .16, 0., 1.));                 // the water from bank to bank, km
    float water = max(real, uPx * uMinPx * mix(.42, 1., size));                     // never thinner than a pixel or three
    float show = smoothstep(uShow.x, uShow.y, real / max(uPx, 1e-5));               // brooks far thinner than a pixel are left out
    float bed = water * 1.5 + min(water * .8, .03);                                 // the banks stand beside the water
    float sd = sign(aMisc.z); vec2 across = normalize(vec2(-aMisc.y, aMisc.x)) * sd, off = across * bed * .5;
    vSide = sd; vEnd = vec2(aMisc.w * show, step(aW.z, 0.)); vRiv = vec4(bed, aW.y, abs(aW.z), aW.w); vAcross = across; vWater = water / bed;
    sheetVertex(aLL + vec2(off.y / KM, off.x / (KM * cos(radians(aLL.x)))), max(heightLod(aLL, 0.), 0.) * uExag / 1000. + .002);
    if (show <= 0.) gl_Position = vec4(0., 0., 2., 1.);
  }`;
const FRAG = /* glsl */`${COMMON}
  ${CHUNK_GLSL}
  ${LIGHT}
  ${SHEET_FRAG}
  uniform vec3 uFlat; uniform float uPass; varying float vSide; varying vec2 vEnd, vAcross; varying vec4 vRiv; varying float vWater;   // uPass: 0 the banks · 1 the water
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
      float foot = far * (1. - dry) * (1. - inner) * smoothstep(.35, 0., edge) * clamp(dot(vAcross, uSun.xy) * 1.5, 0., 1.) * .5;   // a steep bank shades the water at its foot
      col *= 1. - foot;
    }
    sheetOut(col, alpha, 1.);
  }`;

function build(lines) {
  let n = 0; for (const l of lines) n += l.n;
  const ll = new Float32Array(n * 4), misc = new Int8Array(n * 8), wk = new Float32Array(n * 8), idx = new Uint32Array(Math.max(0, n - lines.length) * 6);
  let v = 0, q = 0;
  lines.forEach((l, li) => {
    const seed = ((li * 3.7 + 1.3) % 97 + 1) * (l.dry ? -1 : 1);     // a dry river says so by the sign of its seed
    for (let i = 0; i < l.n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(l.n - 1, i + 1), lat = l.ll[i * 2 + 1], c = Math.cos(lat * D);
      let dx = (l.ll[b * 2] - l.ll[a * 2]) * c, dy = l.ll[b * 2 + 1] - l.ll[a * 2 + 1]; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      for (let s = 0; s < 2; s++, v++) {
        ll[v * 2] = lat; ll[v * 2 + 1] = l.ll[i * 2]; misc[v * 4] = Math.round(dx * 127); misc[v * 4 + 1] = Math.round(dy * 127); misc[v * 4 + 2] = s ? 127 : -127; misc[v * 4 + 3] = Math.round(l.fade[i] * 127);
        wk[v * 4] = l.w[i]; wk[v * 4 + 1] = l.dist[i]; wk[v * 4 + 2] = seed; wk[v * 4 + 3] = l.curv[i];
      }
      if (i) { const k = v - 4; idx[q++] = k; idx[q++] = k + 1; idx[q++] = k + 2; idx[q++] = k + 1; idx[q++] = k + 3; idx[q++] = k + 2; }
    }
  });
  const geo = new BufferGeometry();
  geo.setAttribute('aLL', new BufferAttribute(ll, 2)); geo.setAttribute('aW', new BufferAttribute(wk, 4)); geo.setAttribute('aMisc', new BufferAttribute(misc, 4, true)); geo.setIndex(new BufferAttribute(idx, 1));   // 28 bytes a corner
  return { geo, points: n };
}

export default async function init(album) {
  const courses = album.data.courses; if (!courses) { console.warn('[album] no river courses: assets/album/water/rivers.bin.gz'); return null; }
  const lines = riverSheets(courses, album.data.base.at);
  // two meshes of one material: the brooks, which only show from low down, can be switched off whole
  const widest = l => { let m = 0; for (let i = 0; i < l.n; i++) if (l.w[i] > m) m = l.w[i]; return m; };
  const BROOK = .012, sets = [lines.filter(l => widest(l) >= BROOK), lines.filter(l => widest(l) < BROOK)];
  const u = { ...sheetUniforms(album), uPx: { value: .1 }, uK: { value: 1 }, uMinPx: { value: MIN_PX }, uShow: { value: [SHOW[0], SHOW[1]] }, uFlat: { value: new Color(FLAT.atlas) } };
  const material = pass => new ShaderMaterial({ uniforms: { ...u, uPass: { value: pass } }, depthWrite: pass === 1,
    transparent: false, blending: CustomBlending, blendSrc: SrcAlphaFactor, blendDst: OneMinusSrcAlphaFactor, side: DoubleSide, vertexShader: VERT, fragmentShader: FRAG });
  const banksMat = material(0), waterMat = material(1);
  // after the ground and the lakes, before trees and houses: first the banks of every river, then the water of every river
  const add = (geo, mat, order) => { const mesh = new Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = order; album.scene.add(mesh); return mesh; };
  const meshes = sets.map((set, i) => { const b = build(set); return { mesh: add(b.geo, waterMat, -5), banks: i ? null : add(b.geo, banksMat, -6), points: b.points }; });
  const p = album.params; let on = true;
  const sync = () => { on = !!p.get('riversOn') && p.get('rivers') > 0; u.uK.value = p.get('rivers'); u.uFlat.value.set(FLAT[p.get('look')] || FLAT.atlas); };
  p.on(sync); sync();
  return { id: 'rivers', lines, stats: () => ({ rivers: lines.length, points: meshes[0].points + meshes[1].points, brooks: sets[1].length }),
    update(dt, t, cam) {
      u.uPx.value = 2 * cam.s.h * Math.tan(cam.cam.fov * Math.PI / 360) / Math.max(1, album.renderer.domElement.clientHeight);
      u.uPull.value = sheetPull(album, cam);
      meshes[0].mesh.visible = on; meshes[1].mesh.visible = on && BROOK * u.uK.value / u.uPx.value > SHOW[0];
      meshes[0].banks.visible = on && u.uPx.value < .12;            // banks are drawn only while a great river is a few pixels wide
    } };
}
