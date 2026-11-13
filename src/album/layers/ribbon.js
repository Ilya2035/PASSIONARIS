// Lines laid on the ground as ribbons whose width never falls under a few pixels: the higher the camera, the wider
// they are drawn relative to the land — the album's "scale system" for linear things.
//
// A ribbon is drawn in one of two ways.
//   • A ROAD lies on the ground (the owner, 13.11.2026: дороги «идут поверх. А должны идти по рельефу»). Its corners
//     stand at the height the ground itself is drawn at there (the same level of the height data as the grid of
//     terrain.js under that point), each edge on its own side of the slope, so the line never hangs over a valley or
//     slides off it when the camera tilts. It is lit as the ground is — the same sun, the shadows of the relief, the
//     same air — so in the shade of a mountain the road is in the shade too. What stands on the ground (trees) must
//     not hide it: its depth is written `uLift` km toward the eye, the way the rivers do it.
//   • A MARK (a border of a land) floats `lift` km above the ground and is drawn in its own flat colour, as before.
// makeRibbons() takes a road for a ribbon with lift ≤ .006 unless told otherwise (`ground`): the callers that lay
// roads and tracks pass .005, the borders .015.
import { BufferGeometry, BufferAttribute, Mesh, ShaderMaterial, Color, DoubleSide } from 'three';
import { COMMON, CHUNK_GLSL, LIGHT, lightUniforms } from '../glsl.js';
import { KM_PER_DEG } from '../geo.js';

const D = Math.PI / 180;
// Chaikin corner cutting, then resampling to a fixed step in km
export function smoothLine(pts, step = 1.5, rounds = 2) {
  let p = pts;
  for (let r = 0; r < rounds; r++) {
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) { const a = p[i], b = p[i + 1]; q.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]); }
    q.push(p[p.length - 1]); p = q;
  }
  const out = [p[0]]; let acc = 0;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i], c = Math.cos(a[1] * D), dx = (b[0] - a[0]) * KM_PER_DEG * c, dy = (b[1] - a[1]) * KM_PER_DEG, len = Math.hypot(dx, dy);
    let t = step - acc;
    while (t <= len) { out.push([a[0] + (b[0] - a[0]) * t / len, a[1] + (b[1] - a[1]) * t / len]); t += step; }
    acc = (acc + len) % step;
  }
  out.push(p[p.length - 1]);
  return out;
}

// The light of the ground at a point, for a thing that lies flat on it: the slope toward the sun, the shadow the
// relief casts, how open the place is — the same sums as the ground shader (terrain.js), from the same heights.
// At night the ground also takes the faint light of the Moon, once the light of the album knows it (light.js,
// albumMoonLit: the part «Небо и свет»); a road on a moonlit slope must not be darker than the ground it lies on.
const MOON = LIGHT.includes('albumMoonLit(') ? ' + albumMoonLit(n)' : '';
export const GROUND_LIGHT = /* glsl */`
uniform float uShade;
vec3 groundLight(vec2 ll, float px) {
  float cl = cos(radians(ll.x)), e = clamp(px * 1.3, .035, 6.), lod0 = log2(max(px, .234) / .234);
  float h0 = heightLod(ll, lod0), hE = heightLod(ll + vec2(0., e / (KM * cl)), lod0), hN = heightLod(ll + vec2(e / KM, 0.), lod0), hl = max(h0, 0.);
  vec3 n = normalize(vec3(-vec2(hE - h0, hN - h0) / (e * 1000.) * uExag * uShade, 1.));
  vec2 sd = normalize(uSun.xy + 1e-4); float tanEl = uSun.z / max(1e-3, length(uSun.xy)), sh = 1., d = max(e * 2., .4);
  for (int i = 0; i < 5; i++) {
    vec2 q = ll + vec2(sd.y * d / KM, sd.x * d / (KM * cl));
    float occ = (max(heightLod(q, lod0 + float(i) * .8), 0.) - hl) * uExag - d * 1000. * tanEl;
    sh = min(sh, 1. - clamp(occ / (d * 90. + 4.), 0., 1.)); d *= 2.2;
  }
  float rad = .234 * exp2(lod0 + 3.5), ao = 1. - clamp((max(heightLod(ll, lod0 + 3.5), 0.) - hl) * uExag / (rad * 260.), 0., 1.) * .72;
  return albumSunCol() * max(dot(n, uSun), 0.) * sh * 1.25 + albumSkyCol() * (.4 + .6 * n.z) * ao${MOON};
}`;

// lines: [{ pts: [[lon, lat], ...], width: km, fade: [0..1 for every point] (may be left out) }]
// ground: the ribbon is a road that lies on the ground (see above); verge: how many widths of the road the cleared
// strip beside it takes, both sides together with the road (1: none), vergeColour, vergeAlpha: what it looks like;
// sea: false for a ribbon that may lie over water (the deck of a bridge) — a road is not drawn where the sea is;
// woods: how much darker and fainter a road is where forest stands (0: not at all)
export function makeRibbons(album, lines, { colour = 0x2a6a8a, minPx = 2.2, dash = 0, lift = .004, ground = lift <= .006, verge = 1, vergeColour = 0x6f6a42, vergeAlpha = .5, sea = true, woods = .8 } = {}) {
  let n = 0; for (const l of lines) n += l.pts.length;
  const ll = new Float32Array(n * 4), dir = new Float32Array(n * 4), side = new Float32Array(n * 2), wk = new Float32Array(n * 4), fd = new Float32Array(n * 2), pos = new Float32Array(n * 6), idx = [];
  let v = 0;
  for (const l of lines) {
    let dist = 0;
    for (let i = 0; i < l.pts.length; i++) {
      const p = l.pts[i], a = l.pts[Math.max(0, i - 1)], b = l.pts[Math.min(l.pts.length - 1, i + 1)], c = Math.cos(p[1] * D);
      let dx = (b[0] - a[0]) * c, dy = b[1] - a[1]; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      if (i) dist += Math.hypot((p[0] - l.pts[i - 1][0]) * c, p[1] - l.pts[i - 1][1]) * KM_PER_DEG;
      for (let s = 0; s < 2; s++, v++) {
        ll[v * 2] = p[1]; ll[v * 2 + 1] = p[0]; dir[v * 2] = dx; dir[v * 2 + 1] = dy; side[v] = s ? 1 : -1; wk[v * 2] = l.width; wk[v * 2 + 1] = dist; fd[v] = l.fade ? l.fade[i] : 1;
      }
      if (i) { const k = v - 4; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3)); geo.setAttribute('aLL', new BufferAttribute(ll, 2)); geo.setAttribute('aDir', new BufferAttribute(dir, 2));
  geo.setAttribute('aSide', new BufferAttribute(side, 1)); geo.setAttribute('aW', new BufferAttribute(wk, 2)); geo.setAttribute('aFade', new BufferAttribute(fd, 1)); geo.setIndex(idx);
  const T = album.terrain.u;
  const uniforms = { uBase: T.uBase, uBaseRect: T.uBaseRect, uDet: T.uDet, uDetRect: T.uDetRect, uDetOn: T.uDetOn, uExag: T.uExag, uShade: T.uShade, ...lightUniforms(T),
    uPx: { value: .1 }, uK: { value: 1 }, uMinPx: { value: minPx }, uColour: { value: new Color(colour) }, uDash: { value: dash }, uLift: { value: lift }, uAlpha: { value: 1 },
    uMesh: { value: [40, -3, 1, .03] }, uVerge: { value: Math.max(1, verge) }, uVergeCol: { value: new Color(vergeColour) }, uVergeA: { value: vergeAlpha }, uSea: { value: sea ? 1 : 0 }, uWoods: { value: ground ? woods : 0 }, ...(ground ? album.chunks.uniforms : {}),
    // (albumWet() of glsl.js may read the baked climate: the ground shader brings these two for it, when it has them)
    ...(ground && T.tClimate ? { tClimate: T.tClimate, uClimRect: T.uClimRect } : {}) };
  const mat = ground ? new ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, side: DoubleSide,
    vertexShader: `${COMMON}
      attribute vec2 aLL, aDir, aW; attribute float aSide, aFade; uniform float uPx, uK, uMinPx, uLift, uVerge; uniform vec4 uMesh;   // uMesh: the point the camera looks at (lat, lon), the finest cell of the ground grid km, the least pull km
      varying float vX, vRoad, vDist, vFade; varying vec3 vWorld; varying vec2 vLL, vZW;
      // the cell of the grid the ground is drawn with at a point: nested squares around the camera target, each twice as coarse (terrain.js)
      float groundCell(vec2 ll) {
        vec2 d = abs(vec2((ll.y - uMesh.y) * KM * COSREF, (ll.x - uMesh.x) * KM));
        return uMesh.z * exp2(clamp(ceil(log2(max(max(d.x, d.y), 1e-3) / (79. * uMesh.z))), 0., 8.));
      }
      void main() {
        float road = max(aW.x * uK, uMinPx * uPx), full = max(road * uVerge, road + 2.5 * uPx);                  // room for the soft edge of a thin line
        vec2 off = vec2(-aDir.y, aDir.x) * aSide * full * .5;
        vec2 ll = aLL + vec2(off.y / KM, off.x / (KM * cos(radians(aLL.x))));
        float c = groundCell(ll), h = max(heightLod(ll, max(0., log2(c / .234))), 0.) * uExag / 1000. + .0012;      // on the slope, where the ground is drawn
        vX = aSide * full * .5; vRoad = road * .5; vDist = aW.y; vFade = aFade; vLL = ll;
        vWorld = worldOf(ll, h);
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.);
        vec3 eye = normalize(cameraPosition - vWorld);                                                            // seen aslant, a crown hides more of the ground behind it
        vZW = (projectionMatrix * viewMatrix * vec4(vWorld + eye * max(uLift, uMesh.w) / max(dot(eye, normalize(vWorld + vec3(0., RKM, 0.))), .3), 1.)).zw;
      }`,
    fragmentShader: `${COMMON}
      ${CHUNK_GLSL}
      ${LIGHT}
      ${GROUND_LIGHT}
      uniform vec3 uColour, uVergeCol; uniform float uDash, uAlpha, uVerge, uVergeA, uSea, uWoods; varying float vX, vRoad, vDist, vFade; varying vec3 vWorld; varying vec2 vLL, vZW;
      void main() {
        float pk = max(fwidth(vX), 1e-7), x = abs(vX) / pk, hw = vRoad / pk, px = length(fwidth(vWorld));       // this pixel across the road, km; from the middle of the road, pixels; half the road, pixels
        float core = clamp(hw + .5 - x, 0., 1.) - clamp(.5 - hw - x, 0., 1.);                                    // how much of the pixel the road covers
        float wide = smoothstep(.8, 2., hw);                                                                    // the worn edges show once the road is a few pixels wide
        float verge = uVerge > 1.01 ? (1. - smoothstep(hw, hw * uVerge, x)) * uVergeA * smoothstep(1.5, 3., hw * uVerge) : 0.;
        float cover = core + verge * (1. - core), a = cover * uAlpha * vFade;
        if (uDash > 0.) a *= step(fract(vDist / uDash), .62);
        if (a < .004) discard;                                                                                  // the soft margin of the ribbon ends here, before the costly sums
        float h0 = heightLod(vLL, 0.);
        if (uSea > 0.) a *= smoothstep(-2., .5, h0);                                                             // a road is not drawn over the sea (a bridge is: uSea 0)
        // In the woods a road is dark earth under the trees, not a pale line across the green: darker and fainter
        // where the land is wet enough for forest and the forest of the chunk still stands.
        vec2 pkm = vec2(vLL.y * KM * COSREF, vLL.x * KM);
        float woods = uWoods > 0. ? uWoods * smoothstep(.36, .58, albumWet(vLL, max(h0, 0.), fbm(pkm / 38.))) * textureLod(tChunkA, chunkUV(pkm), 0.).r : 0.;
        a *= 1. - .22 * woods;
        if (a < .004) discard;
        vec3 seen = (1. - .5 * woods) * mix(uVergeCol, uColour * (1. - .2 * wide * smoothstep(.5, 1., x / max(hw, .5))), core / max(cover, 1e-4));
        vec3 col = uStyle == 2 || uStyle == 3 || uStyle == 6 ? mix(pow(seen * (.35 + .65 * albumDay()), vec3(1. / 2.2)), albumFinish(albumHazeCol()), albumHaze(vWorld))
          : albumFinish(albumAir(seen * groundLight(vLL, px), vWorld));
        gl_FragColor = vec4(col, a);
        gl_FragDepth = clamp(vZW.x / vZW.y * .5 + .5, 0., 1.);
      }`,
  }) : new ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -12,
    vertexShader: `${COMMON}
      attribute vec2 aLL, aDir, aW; attribute float aSide; uniform float uPx, uK, uMinPx, uLift; varying float vSide, vDist, vW; varying vec3 vWorld;
      void main() {
        float w = max(aW.x, uMinPx * uPx) * uK;
        vec2 off = vec2(-aDir.y, aDir.x) * aSide * w * .5;
        vec2 ll = aLL + vec2(off.y / KM, off.x / (KM * cos(radians(aLL.x))));
        float h = max(heightLod(aLL, 0.), 0.) * uExag / 1000. + uLift + w * .01;
        vSide = aSide; vDist = aW.y; vW = w / max(uPx, 1e-4);
        vWorld = worldOf(ll, h);
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.);
      }`,
    fragmentShader: `${COMMON}
      ${LIGHT}
      uniform vec3 uColour; uniform float uDash, uAlpha; varying float vSide, vDist, vW; varying vec3 vWorld;
      void main() {
        float edge = 1. - smoothstep(1. - 1.6 / max(vW, 1.6), 1., abs(vSide));
        float a = edge * uAlpha;
        if (uDash > 0.) a *= step(fract(vDist / uDash), .62);
        float day = smoothstep(-.08, .15, uSun.z);
        vec3 c = uColour * (.35 + .65 * day) * (1.08 - .62 * smoothstep(.4, .95, abs(vSide)));
        gl_FragColor = vec4(mix(pow(c, vec3(1. / 2.2)), albumFinish(albumHazeCol()), albumHaze(vWorld)), a);   // the same air as over the land
      }`,
  });
  const mesh = new Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 5;
  album.scene.add(mesh);
  return { mesh, u: uniforms, ground,
    setPx(cam, dom) {
      const h = cam.s.h; uniforms.uPx.value = 2 * h * Math.tan(cam.cam.fov * Math.PI / 360) / Math.max(1, dom.clientHeight);
      if (!ground) return;
      // where the grid of the ground is centred and how fine it is (terrain.js); the pull toward the eye that covers
      // what the grid cannot follow, a little less than the rivers pull, so that water still lies over a road
      const cell = album.terrain.levels?.[0]?.material.uniforms.uCell.value || 2 ** Math.round(Math.log2(Math.max(.03, Math.min(6, h * .0042))));
      const m = uniforms.uMesh.value; m[0] = cam.s.lat; m[1] = cam.s.lon; m[2] = cell; m[3] = .6 * (.02 + h * .0005);
    } };
}
