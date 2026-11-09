// Tests for the ocean currents module: data (public/assets/ocean/currents.json) and
// the renderer (src/game/fx/currents.js), which is built here without WebGL.
// Run: tools/node/node.exe --test tests/currents.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {
  OUT, SRC, loadWaterMask, isWater, slerpGeo, arcDeg, validateCurrents, bake, segmentFractions, SEG_STEP_KM,
} from './currents-bake.mjs';
import {
  Currents, buildCurrentsGeometryData, createCurrentsGeometry, seasonalState, visualSpeed,
  displayHalfWidthKm, currentsVertexShader, CURRENTS_FRAG, KIND_INDEX,
} from '../src/game/fx/currents.js';

const data = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const mask = loadWaterMask();
const byId = Object.fromEntries(data.currents.map(c => [c.id, c]));

// ---------------------------------------------------------------- data
test('currents.json: schema and validator report no problems', () => {
  assert.equal(data.version, 1);
  assert.equal(data.count, data.currents.length);
  const errs = validateCurrents(data, mask);
  assert.deepEqual(errs, []);
  for (const c of data.currents) {
    assert.deepEqual(Object.keys(c).sort(), ['id', 'kind', 'nameEn', 'nameRu', 'path', 'seasonal', 'speed', 'widthKm'].sort(), c.id);
  }
});

test('currents.json: counts, kinds and the named currents are present', () => {
  assert.ok(data.currents.length >= 50, `only ${data.currents.length} currents`);
  const kinds = new Set(data.currents.map(c => c.kind));
  for (const k of ['warm', 'cold']) assert.ok(kinds.has(k), k);
  const required = [
    'gulf_stream', 'florida', 'antilles', 'caribbean', 'loop', 'north_atlantic', 'norwegian', 'east_greenland',
    'west_greenland', 'labrador', 'irminger', 'canary', 'portugal', 'north_equatorial_atl', 'south_equatorial_atl',
    'north_equatorial_pac', 'south_equatorial_pac', 'south_equatorial_ind', 'north_equatorial_cc_atl',
    'north_equatorial_cc_pac', 'equatorial_cc_ind', 'guinea', 'brazil', 'benguela', 'falkland', 'south_atlantic',
    'agulhas', 'agulhas_return', 'mozambique', 'somali', 'sw_monsoon', 'ne_monsoon', 'west_australian', 'leeuwin',
    'east_australian', 'humboldt', 'kuroshio', 'oyashio', 'north_pacific', 'california', 'alaska', 'aleutian',
    'kamchatka', 'tsushima', 'mindanao', 'indonesian_throughflow', 'davidson',
  ];
  for (const id of required) assert.ok(byId[id], `missing ${id}`);
  assert.ok(data.currents.filter(c => c.id.startsWith('acc_')).length >= 3, 'ACC in several segments');
  assert.equal(byId.gulf_stream.kind, 'warm');
  assert.equal(byId.humboldt.kind, 'cold');
  assert.equal(byId.somali.seasonal.reverse, true);
  assert.ok(byId.sw_monsoon.seasonal && byId.ne_monsoon.seasonal);
  // total drawn length is substantial (km)
  const km = data.currents.reduce((s, c) => s + c.path.slice(1).reduce((a, p, i) => a + arcDeg(c.path[i], p) * 111.195, 0), 0);
  assert.ok(km > 150000, `total length ${km}`);
});

test('currents.json: every point and the whole of every segment (sampled < 1 MAP texel) lie on open ocean', () => {
  let points = 0, mids = 0;
  for (const c of data.currents) {
    c.path.forEach((p, i) => {
      assert.ok(isWater(mask, p[0], p[1]), `${c.id}[${i}] ${p} on land`);
      points++;
      if (i === 0) return;
      const q = c.path[i - 1];
      const fr = segmentFractions(q, p);
      // samples are finer than a MAP texel (~4.9 km N-S) along the great-circle arc
      assert.ok(arcDeg(q, p) * 111.195 / (fr.length + 1) <= SEG_STEP_KM + 1e-6);
      for (const t of fr) {
        const m = slerpGeo(q, p, t);
        assert.ok(isWater(mask, m[0], m[1]), `${c.id}[${i - 1}->${i}] t=${t} ${m} on land`);
        mids++;
      }
    });
  }
  assert.ok(points > 1500 && mids > 150000, `${points} points, ${mids} segment samples`);
});

test('validator catches a path across land (point and segment)', () => {
  const base = { id: 'probe', nameRu: 'Проба', nameEn: 'Probe', kind: 'warm', speed: 0.5, widthKm: 100, seasonal: null };
  // straight across the Isthmus of Panama: both ends at sea, the middle on land
  assert.ok(isWater(mask, -80.0, 7.0) && isWater(mask, -79.0, 9.8));
  const across = validateCurrents({ currents: [{ ...base, path: [[-80.0, 7.0], [-79.0, 9.8]] }] }, mask);
  assert.ok(across.some(e => /\[0->1\].*on land/.test(e)), across.join('; '));
  const onLand = validateCurrents({ currents: [{ ...base, path: [[10, 50], [10.5, 50.5]] }] }, mask);
  assert.ok(onLand.some(e => /\[0\].*on land/.test(e)), onLand.join('; '));
  assert.deepEqual(validateCurrents({ currents: [{ ...base, path: [[-30, 0], [-29, 0.5]] }] }, mask), []);
});

test('currents.json: no NaN, ranges, step sizes, antimeridian crossings are short steps', () => {
  let crossings = 0;
  for (const c of data.currents) {
    for (let i = 0; i < c.path.length; i++) {
      const [lon, lat] = c.path[i];
      assert.ok(Number.isFinite(lon) && Number.isFinite(lat), c.id);
      assert.ok(lon >= -180 && lon <= 180 && lat > -90 && lat < 90, c.id);
      if (i) {
        const d = arcDeg(c.path[i - 1], c.path[i]);
        assert.ok(d > 0.01 && d <= 3.5, `${c.id}[${i}] step ${d}`);
        if (Math.abs(lon - c.path[i - 1][0]) > 180) crossings++;
      }
    }
  }
  assert.ok(crossings >= 6, `antimeridian crossings: ${crossings}`);
  for (const id of ['north_equatorial_pac', 'south_equatorial_pac', 'north_pacific', 'acc_pacific', 'alaska']) {
    const c = byId[id];
    assert.ok(c.path.some((p, i) => i && Math.abs(p[0] - c.path[i - 1][0]) > 180), `${id} crosses the antimeridian`);
  }
});

test('currents.json is exactly what the baker makes from currents.src.json (deterministic)', () => {
  const src = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const again = bake(src, mask);
  assert.equal(again.currents.length, data.currents.length);
  for (let i = 0; i < again.currents.length; i++) assert.deepEqual(again.currents[i], data.currents[i], again.currents[i].id);
});

// ---------------------------------------------------------------- renderer (pure)
test('seasonalState: reversing and seasonal-only currents', () => {
  const som = byId.somali.seasonal;
  assert.deepEqual(seasonalState(null, 5), { dir: 1, intensity: 1 });
  assert.equal(seasonalState(som, 7).dir, 1);
  assert.equal(seasonalState(som, 1).dir, -1);
  assert.equal(seasonalState(som, 13).dir, -1);          // wraps to January
  const mid = seasonalState(som, 11.5);                  // Nov -> Dec boundary: turning
  assert.ok(Math.abs(mid.dir) < 1e-9);
  const sw = byId.sw_monsoon.seasonal;
  assert.equal(seasonalState(sw, 7).intensity, 1);
  assert.equal(seasonalState(sw, 1).intensity, 0);
  assert.ok(seasonalState(sw, 5).intensity > 0 && seasonalState(sw, 5).intensity < 1);
  for (let m = 1; m <= 12; m += 0.25) {
    const s = seasonalState(som, m);
    assert.ok(s.dir >= -1 && s.dir <= 1 && s.intensity >= 0 && s.intensity <= 1);
  }
  // allocation-free form writes into the given object; garbage months never yield NaN
  const out = { dir: 0, intensity: 0 };
  assert.equal(seasonalState(som, 1, out), out);
  assert.equal(out.dir, -1);
  for (const bad of [NaN, Infinity, undefined]) {
    const s = seasonalState(sw, bad);
    assert.ok(Number.isFinite(s.dir) && Number.isFinite(s.intensity), String(bad));
  }
});

test('helpers: visual speed keeps order, half width is bounded', () => {
  assert.ok(visualSpeed(0.04) < visualSpeed(0.4) && visualSpeed(0.4) < visualSpeed(1.6));
  assert.ok(displayHalfWidthKm(10) >= 25 && displayHalfWidthKm(5000) <= 210);
});

test('buildCurrentsGeometryData: ribbon buffers are consistent, finite and antimeridian-safe', () => {
  const b = buildCurrentsGeometryData(data);
  const n = b.vertexCount;
  assert.equal(n % 2, 0);
  assert.equal(b.position.length, n * 3);
  assert.equal(b.tangent.length, n * 3);
  assert.equal(b.flow.length, n * 4);
  assert.equal(b.shape.length, n * 3);
  assert.equal(b.index.length, b.triangleCount * 3);
  assert.equal(b.currents.length, data.currents.length);
  assert.ok(n > 8000 && n < 60000, `vertices ${n}`);
  for (const arr of [b.position, b.tangent, b.flow, b.shape]) for (let i = 0; i < arr.length; i++) assert.ok(Number.isFinite(arr[i]));
  for (let i = 0; i < b.index.length; i++) assert.ok(b.index[i] < n);
  // tangents are unit vectors perpendicular to the point's position
  for (let v = 0; v < n; v++) {
    const lon = b.position[v * 3] * Math.PI / 180, lat = b.position[v * 3 + 1] * Math.PI / 180;
    const g = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
    const t = [b.tangent[v * 3], b.tangent[v * 3 + 1], b.tangent[v * 3 + 2]];
    assert.ok(Math.abs(Math.hypot(...t) - 1) < 1e-3);
    assert.ok(Math.abs(g[0] * t[0] + g[1] * t[1] + g[2] * t[2]) < 1e-3);
    assert.ok(Math.abs(b.position[v * 3 + 2]) === 1);
  }
  // no triangle wraps across the antimeridian or spans a long arc (<= 0.5 deg steps)
  for (let k = 0; k < b.index.length; k += 3) {
    const vs = [0, 1, 2].map(j => [b.position[b.index[k + j] * 3], b.position[b.index[k + j] * 3 + 1]]);
    const ls = vs.map(p => p[0]);
    assert.ok(Math.max(...ls) - Math.min(...ls) < 180, `triangle ${k / 3} wraps: ${ls}`);
    for (const [a, c] of [[0, 1], [1, 2], [0, 2]]) assert.ok(arcDeg(vs[a], vs[c]) <= 0.51, `triangle ${k / 3} too long`);
  }
  // crossing currents were split into several strips at exactly +-180
  const sep = b.currents.find(c => c.id === 'south_equatorial_pac');
  assert.ok(sep.strips >= 2);
  let seam = 0;
  for (let v = 0; v < n; v++) if (Math.abs(b.position[v * 3]) === 180) seam++;
  assert.ok(seam >= 4 * 6);
  // along-path distance increases monotonically inside every current
  for (const c of b.currents) {
    let prev = -1;
    for (let v = c.firstVertex; v < c.firstVertex + c.vertexCount; v += 2) {
      const d = b.flow[v * 4];
      assert.ok(d >= prev - 1e-3, `${c.id} distance not monotonic`);
      prev = d;
      assert.equal(b.flow[v * 4 + 2], b.currents.indexOf(c));
      assert.equal(b.flow[v * 4 + 3], KIND_INDEX[c.kind]);
    }
    assert.ok(Math.abs(prev - c.lengthKm) < 1e-2 * c.lengthKm + 1);
  }
  // chained currents get only a short partial fade at junctions (negative), free ends a full one
  const gs = b.currents.find(c => c.id === 'gulf_stream');
  assert.ok(b.shape[gs.firstVertex * 3 + 1] < 0 && b.shape[gs.firstVertex * 3 + 2] < 0);
  const med = b.currents.find(c => c.id === 'mediterranean');
  assert.ok(b.shape[med.firstVertex * 3 + 2] > 0, 'free end of the Mediterranean current fades out');
});

test('shaders: vertex shader reuses the globe morph chunk and declares the ribbon attributes', () => {
  const vs = currentsVertexShader(80);
  assert.match(vs, /vec3 morphPos\(/);
  // surface height exactly as RIVER_VERT samples it (global grid + streamed detail window)
  assert.match(vs, /heightAt\(geoToUV\(g\), 0\.0, 0\.0\)/);
  for (const a of ['aTangent', 'aFlow', 'aShape']) assert.match(vs, new RegExp(`in vec[34] ${a};`));
  assert.match(vs, /#define MAXC 80/);
  assert.match(CURRENTS_FRAG, /out vec4 fragColor/);
  assert.match(CURRENTS_FRAG, /mod\(floor\(u\), 1024\.0\)/);
});

// ---------------------------------------------------------------- renderer (THREE objects, no WebGL)
function fakeGlobe() {
  return {
    shared: {
      uF: { value: new THREE.Vector3(0, 0, 1) }, uR: { value: new THREE.Vector3(1, 0, 0) }, uU: { value: new THREE.Vector3(0, 1, 0) },
      uCurv: { value: 1 }, uExag: { value: 20 / 6371000 }, uHeight: { value: null }, uGrid: { value: new THREE.Vector2(8192, 4096) },
    },
  };
}

test('Currents: builds one mesh, animates, follows seasons, fades, disposes', async () => {
  const scene = new THREE.Scene();
  const globe = fakeGlobe();
  const cur = new Currents(scene, globe, 'graphite', data);
  await cur.ready;
  assert.ok(cur.mesh instanceof THREE.Mesh);
  assert.equal(scene.children.filter(o => o.name === 'currents').length, 1);
  const g = cur.mesh.geometry;
  for (const a of ['position', 'aTangent', 'aFlow', 'aShape']) assert.ok(g.getAttribute(a), a);
  assert.equal(cur.material.glslVersion, THREE.GLSL3);
  assert.ok(cur.material.transparent && !cur.material.depthWrite);
  assert.equal(cur.material.uniforms.uF, globe.shared.uF, 'morph uniforms are shared live with the globe');

  const cam = new THREE.PerspectiveCamera(34, 1.6, 0.001, 50);
  const gcam = { alt: 2.15, cam };
  cur.setMonth(7);
  cur.update(gcam, 0);
  const st = cur.material.uniforms.uState.value;
  const i = cur.list.findIndex(c => c.id === 'somali');
  const j = cur.list.findIndex(c => c.id === 'sw_monsoon');
  assert.equal(st[i * 4 + 2], 1);
  assert.equal(st[j * 4 + 3], 1);
  const ph0 = st[0];
  for (let k = 1; k <= 30; k++) cur.update(gcam, k / 30);
  for (let k = 0; k < st.length; k++) assert.ok(Number.isFinite(st[k]));
  assert.notEqual(st[0], ph0, 'phase advances');
  const op = cur.material.uniforms.uOpacity.value;
  assert.ok(op > 0.9);

  // January: Somali current reverses, the SW monsoon current disappears (eased over ~1-3 s)
  cur.setMonth(1);
  for (let k = 1; k <= 200; k++) cur.update(gcam, 1 + k / 30);
  assert.ok(st[i * 4 + 2] < -0.95, `somali dir ${st[i * 4 + 2]}`);
  assert.ok(st[j * 4 + 3] < 0.02, `sw monsoon strength ${st[j * 4 + 3]}`);
  const n = cur.nearest(50.4, 7.6, 200);
  assert.equal(n.id, 'somali');
  assert.equal(n.reversed, true);
  assert.equal(cur.nearest(-100, 40, 50), null);
  // tooltips never name a current that is not drawn: the SW monsoon current is gone in January
  const swPt = byId.sw_monsoon.path[Math.floor(byId.sw_monsoon.path.length / 2)];
  const hit = cur.nearest(swPt[0], swPt[1], 60);
  assert.ok(hit === null || hit.id !== 'sw_monsoon', `January tooltip names ${hit && hit.id}`);
  assert.ok(hit === null || hit.strength >= 0.15);

  // garbage input is ignored instead of poisoning the phases with NaN
  const before = Array.from(st);
  cur.update(gcam, NaN);
  cur.update({ alt: undefined, cam }, 7.9);
  cur.setMonth(NaN);
  assert.deepEqual(Array.from(st), before);
  // setMonth is idempotent and cheap when the month does not change
  cur.setMonth(1); cur.setMonth(1);
  assert.equal(cur.month, 1);

  // close to the ground the overlay is subtle
  cur.update({ alt: 0.01, cam }, 8);
  for (let k = 1; k <= 60; k++) cur.update({ alt: 0.01, cam }, 8 + k / 30);
  assert.ok(cur.material.uniforms.uOpacity.value < 0.4);

  cur.setVisible(false);
  for (let k = 1; k <= 60; k++) cur.update(gcam, 11 + k / 30);
  assert.equal(cur.mesh.visible, false);
  assert.equal(cur.nearest(50.4, 7.6, 200), null, 'hidden layer gives no tooltip');
  cur.setVisible(true);
  cur.update(gcam, 13);
  assert.equal(cur.mesh.visible, true);

  cur.dispose();
  assert.equal(scene.children.filter(o => o.name === 'currents').length, 0);
});

test('Currents: palette overrides and plain-geometry factory', () => {
  const b = buildCurrentsGeometryData(data);
  const geo = createCurrentsGeometry(b);
  assert.equal(geo.getAttribute('position').count, b.vertexCount);
  assert.equal(geo.index.count, b.index.length);
  const cur = new Currents(new THREE.Scene(), fakeGlobe(), { map: { currentWarm: [1, 0, 0] } }, data);
  assert.deepEqual(cur.material.uniforms.uWarm.value.toArray(), [1, 0, 0]);
  cur.dispose();
  // ENGINE contract form new Currents(scene, globe): palette comes from globe.settings.palette
  const g2 = fakeGlobe();
  g2.settings = { palette: 'sepia' };
  const c2 = new Currents(new THREE.Scene(), g2, undefined, data);
  const ink = [0.16, 0.11, 0.07].map(v => Math.min(1, v * 1.1 + 0.02));
  c2.material.uniforms.uShadow.value.toArray().forEach((v, k) => assert.ok(Math.abs(v - ink[k]) < 1e-6));
  c2.dispose();
});

test('Currents: the season is in place before the first update (tooltips work at once)', () => {
  const cur = new Currents(new THREE.Scene(), fakeGlobe(), 'graphite', data);
  // default month = January: the Somali Current already runs reversed, at full strength
  const n = cur.nearest(50.4, 7.6, 200);
  assert.equal(n?.id, 'somali');
  assert.equal(n.reversed, true);
  assert.equal(n.strength, 1);
  cur.dispose();
});
