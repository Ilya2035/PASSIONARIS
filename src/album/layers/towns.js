// Settlements. Every place gets a plan: a well, homes around it (a street grid in the old core, a loose spiral
// further out), then a tavern, a church, a market, a smithy, towers, a castle, a mill and fields at the edge — in the
// order a village grows into a town. The "Рост городов" knob moves along that order; buildings just beyond it stand as
// construction sites. Near the camera the plan is drawn with real 3D models (KayKit Medieval Hexagon Pack, CC0); from
// afar with plain blocks at the same spots. Nothing is drawn on water. Places are today's cities (Natural Earth) as
// stand-ins: the game has no peoples yet.
import { InstancedBufferGeometry, InstancedBufferAttribute, BoxGeometry, Mesh, ShaderMaterial, Box3, Vector3, SRGBColorSpace, NearestFilter } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { COMMON } from '../glsl.js';
import { distKm } from '../geo.js';

const rng = seed => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
// type: [model, block size w d h, block tint]
const TYPES = {
  well: ['building_well_red', .35, .35, .3, 2], homeA: ['building_home_A_red', .8, .8, .55, 0], homeB: ['building_home_B_red', .85, .8, .6, 0],
  tavern: ['building_tavern_red', 1, .9, .7, 0], church: ['building_church_red', 1, .7, 1.3, 2], market: ['building_market_red', 1.1, 1.1, .35, 1],
  smith: ['building_blacksmith_red', .9, .9, .6, 0], tower: ['building_tower_A_red', .5, .5, 1.5, 2], castle: ['building_castle_red', 1.6, 1.6, 1.2, 2],
  mill: ['building_windmill_red', .7, .7, 1.2, 2], field: ['building_grain', 1.15, 1.15, .05, 3], site: ['building_stage_B', .8, .8, .3, 1],
};
const SCALE = { well: .55, homeA: 1, homeB: 1.05, tavern: 1.25, church: 1.45, market: 1.4, smith: 1.15, tower: .9, castle: 2.3, mill: 1.2, field: 1.25, site: 1 };

export function planTown(pl, index) {
  const R = rng(index * 7919 + 17), n = Math.max(4, Math.min(150, Math.round(pl.pop ** .33))), items = [], ringy = pl.lat > 41.6 && pl.lon < -1.5;
  const tilt = R() * Math.PI, ct = Math.cos(tilt), st = Math.sin(tilt), core = ringy ? 0 : Math.round(n * .4), side = Math.max(2, Math.ceil(Math.sqrt(core)));
  const special = { 5: 'tavern', 8: 'church', 13: 'market', 19: 'smith', 31: 'tower', 58: 'castle', 76: 'tower', 110: 'tower' };
  items.push({ type: 'well', x: 0, y: 0, rot: 0, rank: 0 });
  for (let i = 0; i < n; i++) {
    let x, y, rot;
    if (i < core) { // old core: a street grid
      const gx = (i % side) - (side - 1) / 2, gy = Math.floor(i / side) - (side - 1) / 2;
      x = (gx * 1.3 + (gy % 2 ? .25 : 0)) * 1; y = gy * 1.45; const rx = x * ct - y * st; y = x * st + y * ct; x = rx; rot = -tilt + (R() < .5 ? 0 : Math.PI);
      if (!gx && !gy) { x += .9; }
    } else { // later growth: a loose spiral around the core
      const k = i - core + 2, r = (side * .78 + (ringy ? 1.5 : 1.15) * Math.sqrt(k)) * (ringy ? 1.1 : 1), a = k * 2.39996 + R() * .4;
      x = r * Math.cos(a); y = r * Math.sin(a); rot = Math.atan2(x, y) + (ringy ? R() * 6.28 : (R() - .5) * .7);
    }
    const type = special[i] && (!ringy || special[i] !== 'market') ? special[i] : (R() < .5 ? 'homeA' : 'homeB');
    items.push({ type, x, y, rot, rank: (i + 1) / (n + 1) });
  }
  const rEdge = Math.max(...items.map(it => Math.hypot(it.x, it.y))) + 1.4, fields = Math.max(2, Math.round(n * .18));
  for (let i = 0; i < fields; i++) { const a = i / fields * 6.283 + R(), r = rEdge + R() * 1.6; items.push({ type: i === 1 && n > 14 ? 'mill' : 'field', x: r * Math.cos(a), y: r * Math.sin(a), rot: R() * 3.14, rank: (.15 + .85 * i / fields) * .95 }); }
  return items;
}

const VERT = (uv) => `${COMMON}
  attribute vec2 aLL; attribute vec4 aOff; attribute vec3 aSize; attribute float aTint; ${uv ? 'varying vec2 vUv;' : ''}
  uniform float uUnit, uGrowth, uSite;
  varying vec3 vN; varying float vT, vY;
  void main() {
    float show = uSite > .5 ? step(uGrowth, aOff.w) * step(aOff.w, uGrowth + .07) : step(aOff.w, uGrowth);
    float cr = cos(aOff.z), sr = sin(aOff.z), cl = cos(radians(aLL.x));
    vec2 o = aOff.xy * uUnit;
    vec2 ll = aLL + vec2(o.y / KM, o.x / (KM * cl));
    float h0 = heightLod(ll, 0.);
    show *= step(.6, h0);                                           // never on water
    vec3 p = position * aSize * uUnit * show;
    vec2 xz = vec2(p.x * cr + p.z * sr, -p.x * sr + p.z * cr);
    vec3 up = normalize(worldOf(ll, 0.) + vec3(0., RKM, 0.)); float dl = radians(ll.y - LON0);
    vec3 east = normalize(vec3(cos(dl), -sin(dl) * C0, -sin(dl) * S0)), north = cross(up, east);
    vec2 nxz = vec2(normal.x * cr + normal.z * sr, -normal.x * sr + normal.z * cr);
    vN = vec3(nxz.x, -nxz.y, normal.y); vT = aTint; vY = position.y; ${uv ? 'vUv = uv;' : ''}
    gl_Position = projectionMatrix * viewMatrix * vec4(worldOf(ll, max(h0, 0.) * uExag / 1000.) + east * xz.x - north * xz.y + up * p.y, 1.);
  }`;
const LIGHT = `float day = smoothstep(-.08, .12, uSun.z), nl = max(dot(normalize(vN), uSun), 0.);
    c = pow(c, vec3(2.2)) * (vec3(1.22, 1.15, 1.02) * nl * 1.25 * day + mix(vec3(.26, .33, .52), vec3(.46, .58, .78), day) * .62 * (.5 + .5 * clamp(vY * 1.4, 0., 1.)));`;
const TONE = `c = (c * (2.51 * c + .03)) / (c * (2.43 * c + .59) + .14); gl_FragColor = vec4(pow(clamp(c, 0., 1.), vec3(1. / 2.2)), 1.);`;

export default async function init(album) {
  const T = album.terrain.u, p = album.params, places = album.data.vectors.places;
  const plans = places.map((pl, i) => planTown(pl, i));
  const shared = { uBase: T.uBase, uBaseRect: T.uBaseRect, uDet: T.uDet, uDetRect: T.uDetRect, uDetOn: T.uDetOn, uExag: T.uExag, uSun: T.uSun, uUnit: { value: .05 }, uGrowth: { value: 1 }, uPaper: { value: 0 } };
  const instanced = (src, cap) => {
    const g = new InstancedBufferGeometry(); g.index = src.index;
    for (const k of ['position', 'normal', 'uv']) if (src.getAttribute(k)) g.setAttribute(k, src.getAttribute(k));
    g.setAttribute('aLL', new InstancedBufferAttribute(new Float32Array(cap * 2), 2)); g.setAttribute('aOff', new InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    g.setAttribute('aSize', new InstancedBufferAttribute(new Float32Array(cap * 3), 3)); g.setAttribute('aTint', new InstancedBufferAttribute(new Float32Array(cap), 1));
    g.instanceCount = 0; return g;
  };
  const fill = (g, rows) => { // rows: [lat, lon, x, y, rot, rank, sx, sy, sz, tint]
    const a = g.attributes; let i = 0;
    for (const r of rows) { if (i >= a.aTint.count) break; a.aLL.setXY(i, r[0], r[1]); a.aOff.setXYZW(i, r[2], r[3], r[4], r[5]); a.aSize.setXYZ(i, r[6], r[7], r[8]); a.aTint.setX(i, r[9]); i++; }
    g.instanceCount = i; for (const k of ['aLL', 'aOff', 'aSize', 'aTint']) a[k].needsUpdate = true;
  };

  // ---- far: plain blocks at the planned spots
  const boxSrc = new BoxGeometry(1, 1, 1); boxSrc.translate(0, .5, 0);
  const rowsFar = [];
  places.forEach((pl, i) => { const R = rng(i + 5); for (const it of plans[i]) { const t = TYPES[it.type]; rowsFar.push([pl.lat, pl.lon, it.x, it.y, it.rot, it.rank, t[1], t[3], t[2], t[4] + R() * .9]); } });
  const boxGeo = instanced(boxSrc, rowsFar.length); fill(boxGeo, rowsFar);
  const boxMat = new ShaderMaterial({ uniforms: { ...shared, uSite: { value: 0 } }, vertexShader: VERT(false),
    fragmentShader: `uniform vec3 uSun; uniform float uPaper; varying vec3 vN; varying float vT, vY;
      void main() { float kind = floor(vT), r = fract(vT), roof = step(.5, vN.z);
        vec3 wall = kind < .5 ? mix(vec3(.84, .78, .66), vec3(.74, .68, .58), r) : kind < 1.5 ? vec3(.62, .52, .38) : kind < 2.5 ? mix(vec3(.72, .70, .66), vec3(.60, .58, .55), r) : mix(vec3(.74, .68, .30), vec3(.62, .64, .28), r);
        vec3 top = kind < .5 ? mix(vec3(.66, .32, .20), vec3(.58, .28, .18), r) : kind < 1.5 ? vec3(.60, .50, .36) : kind < 2.5 ? vec3(.50, .30, .22) : wall;
        vec3 c = mix(wall, top, roof); c = mix(c, vec3(.36, .28, .22), uPaper);
        ${LIGHT}
        c += vec3(1., .62, .25) * (1. - day) * (1. - roof) * step(.7, r) * step(kind, .5) * .9;
        ${TONE} }` });
  const boxes = new Mesh(boxGeo, boxMat); boxes.frustumCulled = false; album.scene.add(boxes);

  // ---- near: real models
  const models = {}, meshes = {}, shows = {}; let tex = null, ready = false;
  const modelMat = site => new ShaderMaterial({ uniforms: { ...shared, uSite: { value: site ? 1 : 0 }, uMap: { value: tex } }, vertexShader: VERT(true),
    fragmentShader: `uniform vec3 uSun; uniform float uPaper; uniform sampler2D uMap; varying vec3 vN; varying float vT, vY; varying vec2 vUv;
      void main() { vec3 c = texture(uMap, vUv).rgb; c = pow(c, vec3(1. / 2.2)); c = mix(c, vec3(dot(c, vec3(.33))) * vec3(.9, .8, .7), uPaper * .7);
        ${LIGHT}
        c += vec3(1., .6, .25) * (1. - day) * .05;
        ${TONE} }` });
  (async () => {
    try {
      const list = (await (await fetch('album-data/models/models.json')).json()).models, loader = new GLTFLoader();
      await Promise.all(list.map(async name => {
        const gltf = await loader.loadAsync(`album-data/models/${name}.gltf`); let mesh = null; gltf.scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
        if (!mesh) return;
        const g = mesh.geometry.clone(), b = new Box3().setFromBufferAttribute(g.getAttribute('position')), s = new Vector3(); b.getSize(s);
        const k = 1 / Math.max(s.x, s.z, 1e-3); g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2); g.scale(k, k, k);
        models[name] = g; if (!tex && mesh.material.map) { tex = mesh.material.map; tex.colorSpace = SRGBColorSpace; tex.magFilter = NearestFilter; }
      }));
      for (const [type, t] of Object.entries(TYPES)) if (models[t[0]]) { const m = new Mesh(instanced(models[t[0]], 1400), modelMat(type === 'site')); m.frustumCulled = false; m.visible = false; album.scene.add(m); meshes[type] = m; }
      for (const name of Object.keys(models)) { const m = new Mesh(instanced(models[name], 1), modelMat(false)); m.frustumCulled = false; m.visible = false; album.scene.add(m); shows[name] = m; }
      album.models = Object.keys(models); ready = !!meshes.homeA;
    } catch (e) { console.warn('[album] models not loaded, towns stay as blocks:', e.message); }
  })();
  let key = '', showKey = '';
  function showRows(cam) { // every model once, in rows of seven, around the point the camera looks at
    const c = cam.t, k = `${c.lat.toFixed(3)},${c.lon.toFixed(3)}`; if (k === showKey) return; showKey = k;
    const names = Object.keys(shows), cols = 7;
    names.forEach((n, i) => fill(shows[n].geometry, [[c.lat, c.lon, ((i % cols) - (cols - 1) / 2) * 2.5, (Math.floor(i / cols) - (Math.ceil(names.length / cols) - 1) / 2) * 2.7, .6, 0, 1.9, 1.9, 1.9, 0]]));
  }
  function nearRows(cam) {
    const s = cam.s, D = Math.max(70, s.h * 5), ids = []; places.forEach((pl, i) => { if (distKm(s, pl) < D) ids.push(i); });
    const k = ids.join(','); if (k === key) return; key = k;
    const by = {}; for (const t of Object.keys(TYPES)) by[t] = [];
    for (const i of ids) { const pl = places[i]; for (const it of plans[i]) { const sc = SCALE[it.type] || 1; by[it.type].push([pl.lat, pl.lon, it.x, it.y, it.rot, it.rank, sc, sc, sc, 0]); if (it.type !== 'field' && it.type !== 'well') by.site.push([pl.lat, pl.lon, it.x, it.y, it.rot, it.rank, 1, 1, 1, 0]); } }
    for (const [t, m] of Object.entries(meshes)) fill(m.geometry, by[t]);
  }
  return { id: 'towns', plans, update(dt, t, cam) {
    const show = ready && !!p.get('showcase');
    for (const m of Object.values(shows)) m.visible = show;
    if (show) { boxes.visible = false; for (const m of Object.values(meshes)) m.visible = false; shared.uUnit.value = cam.s.h * .04; shared.uGrowth.value = 1; showRows(cam); return; }
    showKey = '';
    const on = !!p.get('towns') && p.get('houses') > 0 && cam.s.h < 900, near = on && ready && cam.s.h < 85;
    boxes.visible = on && !near;
    for (const m of Object.values(meshes)) m.visible = near;
    if (!on) return;
    shared.uUnit.value = .066 * (cam.s.h / 20) ** .8 * p.get('houses');
    shared.uGrowth.value = p.get('growth'); shared.uPaper.value = ['paper', 'atlas'].includes(p.get('look')) ? 1 : 0;
    if (near) nearRows(cam);
  } };
}
