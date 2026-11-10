// Disasters shown the way they would look, not as icons. Fire: a small cellular model on the 10 km territories around
// the camera target — it creeps from territory to territory with the wind, leaves char behind and feeds a smoke plume.
// Earthquake: every district is tinted by what it felt, and a rupture line runs through the epicentre.
import { DataTexture, RGBAFormat, UnsignedByteType, LinearFilter, ClampToEdgeWrapping, BufferGeometry, BufferAttribute, Points, ShaderMaterial, NormalBlending } from 'three';
import { toWorld, KM_PER_DEG } from '../geo.js';

const N = 48, CELL = 10, SMOKE = 900;
export default async function init(album) {
  const T = album.terrain.u, at = album.data.base.at, p = album.params;
  const px = new Uint8Array(N * N * 4), tex = new DataTexture(px, N, N, RGBAFormat, UnsignedByteType);
  tex.magFilter = tex.minFilter = LinearFilter; tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  T.uFire.value = tex;
  let fuel, burn, burnt, origin = null, acc = 0, seed = 1;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const wind = { e: .9, n: .35 };           // blows toward the east-north-east
  function startFire() {
    const c = album.cam.t, dLat = CELL / KM_PER_DEG, dLon = CELL / (KM_PER_DEG * Math.cos(c.lat * Math.PI / 180));
    origin = { lat0: c.lat - N / 2 * dLat, lon0: c.lon - N / 2 * dLon, dLat, dLon };
    fuel = new Float32Array(N * N); burn = new Float32Array(N * N); burnt = new Float32Array(N * N); seed = 7;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const h = at(origin.lat0 + (j + .5) * dLat, origin.lon0 + (i + .5) * dLon); fuel[j * N + i] = h > 2 && h < 1900 ? .55 + .45 * rnd() : 0; }
    for (let k = 0; k < 3; k++) { const i = N / 2 - 3 + k, j = N / 2 - 2 + (k % 2); if (fuel[j * N + i]) burn[j * N + i] = 1; }
    T.uFireRect.value.set(origin.lon0, origin.lat0, 1 / (N * dLon), 1 / (N * dLat)); T.uFireOn.value = 1;
    for (let i = 0; i < SMOKE; i++) life[i] = 0;
  }
  function step() {
    const nb = burn.slice();
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const k = j * N + i, b = burn[k];
      if (b > 0) { nb[k] = b - .16; if (nb[k] <= 0) { nb[k] = 0; burnt[k] = 1; fuel[k] = 0; } }
      else if (fuel[k] > 0) {
        let pr = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const s = burn[k - dj * N - di]; if ((di || dj) && s > .25) pr += .042 * (1 + 1.6 * Math.max(0, di * wind.e + dj * wind.n)); }
        if (pr > 0 && rnd() < pr * fuel[k]) nb[k] = 1;
      }
    }
    burn = nb;
    for (let k = 0; k < N * N; k++) { px[k * 4] = burn[k] * 255; px[k * 4 + 1] = burnt[k] * 255; px[k * 4 + 3] = 255; }
    tex.needsUpdate = true;
  }
  // smoke: soft puffs rising from burning territories and drifting downwind
  const pos = new Float32Array(SMOKE * 3), aux = new Float32Array(SMOKE * 2), life = new Float32Array(SMOKE), st = new Float32Array(SMOKE * 4);
  const geo = new BufferGeometry(); geo.setAttribute('position', new BufferAttribute(pos, 3)); geo.setAttribute('aAux', new BufferAttribute(aux, 2));
  const smoke = new Points(geo, new ShaderMaterial({
    transparent: true, depthWrite: false, blending: NormalBlending, uniforms: { uScale: { value: 1 }, uSun: T.uSun },
    vertexShader: `attribute vec2 aAux; uniform float uScale; varying float vA;
      void main() { vec4 mv = viewMatrix * vec4(position, 1.); vA = aAux.y; gl_PointSize = min(240., aAux.x * uScale / max(1., -mv.z)); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uSun; varying float vA;
      void main() { vec2 q = gl_PointCoord - .5; float d = length(q) * 2.; float a = (1. - smoothstep(.15, 1., d)) * vA;
        float day = smoothstep(-.08, .15, uSun.z); vec3 c = mix(vec3(.30, .26, .23), vec3(.72, .68, .64), smoothstep(-.4, .5, -q.y)) * (.25 + .75 * day);
        gl_FragColor = vec4(c, a * .33); }`,
  }));
  smoke.frustumCulled = false; smoke.renderOrder = 8; smoke.visible = false; album.scene.add(smoke);
  const v = toWorld(0, 0);
  function updateSmoke(dt, cam) {
    const burning = []; for (let k = 0; k < N * N; k++) if (burn[k] > .2) burning.push(k);
    let spawn = Math.min(14, burning.length);
    for (let i = 0; i < SMOKE; i++) {
      if (life[i] <= 0) {
        if (!spawn || !burning.length) { aux[i * 2 + 1] = 0; continue; }
        spawn--; const k = burning[(rnd() * burning.length) | 0];
        st[i * 4] = origin.lat0 + (((k / N) | 0) + rnd()) * origin.dLat; st[i * 4 + 1] = origin.lon0 + ((k % N) + rnd()) * origin.dLon; st[i * 4 + 2] = .3; st[i * 4 + 3] = 6 + rnd() * 6; life[i] = 1;
      }
      life[i] -= dt * .055; const age = 1 - life[i];
      st[i * 4] += wind.n * dt * 1.6 / KM_PER_DEG; st[i * 4 + 1] += wind.e * dt * 1.6 / (KM_PER_DEG * .76); st[i * 4 + 2] += dt * .35 * (1 - age);
      toWorld(st[i * 4], st[i * 4 + 1], (Math.max(0, at(st[i * 4], st[i * 4 + 1])) / 1000 + st[i * 4 + 2]) * cam.exag, v);
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
      aux[i * 2] = st[i * 4 + 3] * (1 + age * 3.5); aux[i * 2 + 1] = Math.min(1, age * 6) * Math.max(0, life[i]);
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.aAux.needsUpdate = true;
    smoke.material.uniforms.uScale.value = album.renderer.domElement.height / (2 * Math.tan(cam.cam.fov * Math.PI / 360));
  }
  let mode = '', quakeT = 0, warm = false;
  function sync() {
    const m = p.get('hazard'); if (m === mode) return; mode = m; warm = false;
    T.uFireOn.value = 0; T.uQuake.value.set(0, 0, 0, 0); smoke.visible = false;
    if (m === 'fire') { startFire(); smoke.visible = true; }
    if (m === 'quake') { quakeT = 0; T.uQuake.value.set(album.cam.t.lat, album.cam.t.lon, 7.2, 0); }
  }
  p.on(sync); album.restartHazard = () => { mode = null; sync(); };
  return { id: 'hazards', update(dt, t, cam) {
    if (mode === null) sync();
    const sp = p.get('play');
    if (album.shot && !warm) { // a still capture: show the disaster well under way
      warm = true;
      if (mode === 'fire') { for (let i = 0; i < 22; i++) { step(); for (let k = 0; k < 4; k++) updateSmoke(.3, cam); } }
      if (mode === 'quake') quakeT = 8;
    }
    if (mode === 'fire') { acc += dt * sp; while (acc > .45) { acc -= .45; step(); } updateSmoke(dt * sp, cam); }
    if (mode === 'quake') { quakeT += dt * sp; T.uQuake.value.w = quakeT; }
  } };
}
