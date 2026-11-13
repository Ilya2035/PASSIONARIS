// The part «Небо, свет и камера» of the album (docs/album/sky.md): where the Sun and the Moon stand, the contract of
// the shared light, the rules of the camera controls. What the sky looks like is checked by eye in the album
// (harness acap … "page=sky-near"), and whether its shaders compile by `harness acheck`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sunDir, moonDir, moonLit, moonStrength, sunTimes, sunLongitude, equatorial } from '../src/album/sky/astro.js';
import { LIGHT, lightUniforms, lightNumbers, lightFrame, FRAME, sunAt, HAZE_KM } from '../src/album/light.js';
import { AlbumCamera, edgePush, keyPush, panStep, zoomAbout, H_MIN, H_MAX, TILT_MAX, EDGE_PX, PAN_RATE } from '../src/album/camera.js';
import { KM_PER_DEG, BBOX, R } from '../src/album/geo.js';
import sky from '../src/album/aspects/sky.js';
import { DEFS } from '../src/album/params.js';
import { PAGES } from '../src/album/pages.js';

const D = Math.PI / 180, len = v => Math.hypot(...v), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const elev = v => Math.asin(v[2]) / D, azim = v => (Math.atan2(v[0], v[1]) / D + 360) % 360;   // degrees; azimuth from north through east
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} is not within ${eps} of ${b}`);

test('sky: the Sun by the hour, the day of the year and the latitude', () => {
  // noon of 21 June at 40° N: due south, 90 − 40 + 23.44 high
  const noon = sunDir(12, 172, 40); near(len(noon), 1, 1e-9); near(elev(noon), 73.44, .1, 'summer noon'); near(azim(noon), 180, .01);
  near(elev(sunDir(12, 355, 40)), 90 - 40 - 23.44, .1, 'winter noon'); near(elev(sunDir(12, 80, 40)), 50, .1, 'equinox noon');
  // morning in the east, evening in the west, midnight under the horizon in the north
  assert.ok(sunDir(8, 172, 40)[0] > .5 && sunDir(17, 172, 40)[0] < -.5); const night = sunDir(24, 172, 40); assert.ok(night[2] < 0 && night[1] > 0);
  // the summer Sun rises in the north-east and sets in the north-west; at the equinox due east and west, at 6 and 18
  const s = sunTimes(172, 40); near(s.rise, 4.57, .05); near(s.set, 19.43, .05);
  near(elev(sunDir(s.rise, 172, 40)), 0, .05); near(azim(sunDir(s.rise, 172, 40)), 58.7, .5); near(azim(sunDir(s.set, 172, 40)), 301.3, .5);
  const e = sunTimes(80, 40); near(e.rise, 6, .02); near(e.set, 18, .02); near(azim(sunDir(6, 80, 40)), 90, .2);
  // higher latitudes have a lower Sun and a longer summer day; the pole has no sunrise in June
  assert.ok(elev(sunDir(12, 172, 60)) < elev(sunDir(12, 172, 40))); assert.ok(sunTimes(172, 60).set > s.set); assert.equal(sunTimes(172, 89), null);
  // every hour gives a unit vector; the path is smooth (no jump from one quarter of an hour to the next)
  for (let h = 0, prev = null; h <= 24; h += .25) { const v = sunDir(h, 172, 40); near(len(v), 1, 1e-9); if (prev) assert.ok(dot(v, prev) > .997, `hour ${h}`); prev = v; }
  near(equatorial(sunLongitude(172)).dec / D, 23.44, .05); near(equatorial(sunLongitude(80)).dec / D, 0, .01);
});

test('sky: sunAt — hour 0 is the light of the map, any other hour the real Sun', () => {
  const rest = sunAt(0); near(rest.length(), 1, 1e-6); near(rest.x, -.5 / Math.hypot(.5, .45, .74), 1e-6); near(rest.z, .74 / Math.hypot(.5, .45, .74), 1e-6);
  assert.deepEqual(sunAt(0).toArray(), sunAt().toArray(), 'no hour = the light of the map');
  const noon = sunAt(12); near(noon.z, Math.sin(73.44 * D), .002); assert.ok(noon.y < 0 && Math.abs(noon.x) < 1e-9);
  // the album's own pages of light: a low morning Sun in the east, a low evening Sun in the west, night at half past nine
  assert.ok(sunAt(7.5).x > 0 && sunAt(7.5).z > .3 && sunAt(18.75).x < 0 && sunAt(18.75).z > .05 && sunAt(18.75).z < .25 && sunAt(21.5).z < -.2);
  near(sunAt(12, 355, 40).z, Math.sin(26.56 * D), .003); assert.ok(sunAt(12, 172, 55).z < noon.z);
});

test('sky: the Moon goes with its phase', () => {
  // a full moon stands opposite the Sun, a new moon beside it; the quarters at a right angle
  for (const h of [0, 5, 13, 21.5]) {
    const s = sunDir(h, 172, 40); near(dot(s, moonDir(h, 172, 40, .5)), -1, 1e-9, 'full'); near(dot(s, moonDir(h, 172, 40, 0)), 1, 1e-9, 'new');
    near(dot(s, moonDir(h, 172, 40, .25)), 0, 1e-9, 'first quarter'); near(len(moonDir(h, 172, 40, .37)), 1, 1e-9);
  }
  assert.deepEqual([moonLit(0), moonLit(.5)].map(x => +x.toFixed(9)), [0, 1]); near(moonLit(.25), .5, 1e-9); near(moonLit(.75), .5, 1e-9);
  // the full moon of June is low at midnight, the full moon of December high; it rises as the Sun sets
  near(elev(moonDir(24, 172, 40, .5)), 90 - 40 - 23.44, .1); near(elev(moonDir(24, 355, 40, .5)), 90 - 40 + 23.44, .1);
  near(elev(moonDir(sunTimes(172, 40).set, 172, 40, .5)), 0, .1); assert.ok(moonDir(sunTimes(172, 40).set, 172, 40, .5)[0] > 0, 'in the east');
  // the first quarter is in the evening sky, the last quarter in the morning sky
  assert.ok(moonDir(20, 80, 40, .25)[2] > .3 && moonDir(20, 80, 40, .75)[2] < 0 && moonDir(5, 80, 40, .75)[2] > .3);
});

test('sky: moonlight is there only at night, with the Moon up, by its phase', () => {
  near(moonStrength(-.4, .6, .5), 1, 1e-9, 'full moon high in a dark sky');
  assert.equal(moonStrength(.5, .6, .5), 0, 'by day'); assert.equal(moonStrength(-.4, -.2, .5), 0, 'under the horizon'); assert.equal(moonStrength(-.4, .6, 0), 0, 'new moon');
  near(moonStrength(-.4, .6, .25), .5, 1e-9); assert.ok(moonStrength(-.4, .05, .5) < moonStrength(-.4, .3, .5), 'a low Moon gives less');
  assert.ok(moonStrength(-.05, .6, .5) > 0 && moonStrength(-.05, .6, .5) < 1, 'it comes in through the dusk');
  // the album's night page: the Sun well under the horizon, the full Moon a little over it
  const pg = sky.pages.find(p => p.id === 'sky-night'), s = sunDir(pg.p.hour, 172, pg.cam.lat), m = moonDir(pg.p.hour, 172, pg.cam.lat, pg.p.moon);
  assert.ok(elev(s) < -8 && elev(m) > 6 && elev(m) < 13, `sun ${elev(s)}, moon ${elev(m)}`); near(azim(m), pg.cam.heading, 6, 'the camera looks at the Moon');
  assert.ok(moonStrength(s[2], m[2], pg.p.moon) > .5);
});

test('sky: the shared light keeps its contract', () => {
  // the names and arguments every other part calls
  for (const sig of ['float albumDay()', 'vec3 albumSunCol()', 'vec3 albumSkyCol()', 'vec3 albumLit(vec3 seen, vec3 n, float open)', 'float albumHaze(vec3 wpos)',
    'vec3 albumHazeCol()', 'vec3 albumAir(vec3 col, vec3 wpos)', 'vec3 albumFinish(vec3 col)']) assert.ok(LIGHT.includes(sig), sig);
  // what the sky adds: the Moon, the horizon. (The clouds, the rain and the fog are not in the light: tests/album-sky-weather.test.mjs.)
  for (const sig of ['vec3 albumMoonCol()', 'vec3 albumMoonLit(vec3 n)', 'vec3 albumHorizon(vec3 dir)']) assert.ok(LIGHT.includes(sig), sig);
  assert.ok(!/albumCloud|vnoise|wx[A-Z]/.test(LIGHT), 'no weather and no noise in LIGHT');
  // the ground shader is at its limit of 16 textures: the light brings none
  assert.ok(!/sampler/.test(LIGHT), 'no texture in LIGHT');
  // the uniforms: the old ones as they were, and those of the sky — from the ground's uniforms, or harmless ones
  const T = { uSun: {}, uHaze: {}, uExposure: {}, uSat: {}, uWarm: {}, uStyle: {} }, u = lightUniforms(T);
  for (const k of ['uSun', 'uHaze', 'uExposure', 'uSat', 'uWarm', 'uStyle']) assert.equal(u[k], T[k], k);
  assert.equal(u.uMoon.value.w, 0, 'no moonlight'); assert.equal(u.uCloud.value.x, 0, 'no clouds'); assert.ok(u.uSunW.value.isVector3);
  const own = { ...T, ...sky.uniforms }; assert.equal(lightUniforms(own).uMoon, sky.uniforms.uMoon); assert.equal(lightUniforms(own).uCloud, sky.uniforms.uCloud); assert.equal(lightUniforms(own).uSunW, sky.uniforms.uSunW);
  for (const name of Object.keys(u)) assert.match(LIGHT, new RegExp(`\\b${name}\\b`), name);
  assert.ok(HAZE_KM > .5 && HAZE_KM < 4);
});

test('sky: the light of a frame is counted once, on the processor', () => {
  const day = lightNumbers({ sun: sunAt(0) });
  // the light of the map (hour 0) is what the shaders counted before: these are the colours every picture was taken with
  for (const [got, want] of [[day.A, [1.22, 1.15, 1.02, 1]], [day.B.slice(0, 3), [.46 * .62, .58 * .62, .78 * .62]], [day.C, [.55, .70, .92, 0]], [day.D, [0, 0, 0]]]) got.forEach((v, i) => near(v, want[i], 1e-9));
  // the thin air of one km of the way: the knob of the haze over the height of the eye
  near(lightNumbers({ sun: sunAt(0), haze: .09, alt: 500 }).B[3], .09 / (500 * 2.2 + 25), 1e-12); assert.ok(lightNumbers({ sun: sunAt(0), alt: 20 }).B[3] > lightNumbers({ sun: sunAt(0), alt: 2000 }).B[3]);
  // night: no sunlight; the sky keeps the light of the stars, and the Moon adds to it and gives a light of its own
  const dark = lightNumbers({ sun: sunAt(24), moon: 0 }), moonlit = lightNumbers({ sun: sunAt(24), moon: 1 });
  assert.deepEqual(dark.A, [0, 0, 0, 0]); assert.deepEqual(dark.D, [0, 0, 0]); assert.ok(moonlit.D[2] > moonlit.D[0] && moonlit.D[2] > .1, 'moonlight is cold');
  near(dark.B[2], .52 * .5 * .62, 1e-9); near(moonlit.B[2], .52 * .84 * .62, 1e-9); assert.ok(dark.B[2] < day.B[2] / 2 && dark.C[2] < day.C[2] / 5, 'night is dark');
  // a low Sun: orange sunlight, a warmer haze, the glow of sunset at full strength; none of it at noon or deep in the night
  const low = lightNumbers({ sun: { x: -1, y: 0, z: .02 } }); assert.ok(low.A[0] > 2 * low.A[2] && low.A[3] > .4 && low.A[3] < .8, `${low.A}`);
  assert.ok(low.C[3] > .95 && low.C[0] / low.C[2] > day.C[0] / day.C[2]); assert.equal(lightNumbers({ sun: sunAt(12) }).C[3], 0); assert.equal(lightNumbers({ sun: sunAt(24) }).C[3], 0);
  assert.ok(low.E[0] > low.E[1] && low.E[1] > low.E[2], 'the glow is orange');
  // a warm look reddens the sunlight; the paper and the night slate have their own air and no glow
  const warm = lightNumbers({ sun: sunAt(0), warm: 1 }); near(warm.A[0], 1.22 * 1.06, 1e-9); near(warm.A[2], 1.02 * .9, 1e-9);
  assert.deepEqual(lightNumbers({ sun: { x: -1, y: 0, z: .02 }, style: 3 }).C, [.84, .86, .86, 0]); assert.deepEqual(lightNumbers({ sun: sunAt(0), style: 6 }).C, [.05, .07, .11, 0]);
  // the uniforms: one set for every material, already holding the light of the map before the first frame
  const u = lightUniforms({ uSun: {}, uHaze: {}, uExposure: {}, uSat: {}, uWarm: {}, uStyle: {} });
  for (const k of ['uLightA', 'uLightB', 'uLightC', 'uLightD', 'uLightE']) { assert.equal(u[k], FRAME[k], k); assert.equal(sky.uniforms[k], FRAME[k], `${k}: the ground gets it with the sky's uniforms`); }
  lightFrame({ sun: sunAt(0) }); near(FRAME.uLightA.value.w, 1, 1e-9); near(FRAME.uLightC.value.z, .92, 1e-6);
  lightFrame({ sun: sunAt(24), moon: 1 }); assert.equal(FRAME.uLightA.value.w, 0); assert.ok(FRAME.uLightD.value.z > .1);
  lightFrame({ sun: sunAt(0) });
  // the ground shader is at a cliff of speed: what it calls from the light stays a hand of operations, nothing counted per pixel that a frame can count once
  for (const fn of ['albumDay', 'albumSunCol', 'albumSkyCol', 'albumHazeCol', 'albumMoonCol']) assert.match(LIGHT, new RegExp(`${fn}\\(\\) \\{ return uLight[A-E](\\.\\w+)?; \\}`), fn);
  const haze = LIGHT.match(/float albumHaze\(vec3 wpos\) \{([\s\S]*?)\n\}/)[1]; assert.ok(!/smoothstep|sqrt|pow|vnoise/.test(haze) && (haze.match(/exp\(/g) || []).length === 1, 'albumHaze: one exp, no more');
  const air = LIGHT.match(/vec3 albumAir\(vec3 col, vec3 wpos\) \{([^\n]*)\}/)[1]; assert.ok(!/Cloud/.test(air), 'the shadows of the clouds are not laid in albumAir');
});

test('sky: knobs and pages of the part', () => {
  const def = k => DEFS.find(d => d.key === k);
  // the hour knob stays, with the light of the map as its rest; the sky adds the day, the Moon, the clouds
  assert.equal(def('hour').value, 0); assert.equal(def('yday').value, 172); assert.equal(def('moon').value, .5);
  // nothing new is on until asked for: the pictures taken before stay as they were
  assert.equal(def('clouds').value, 0); assert.equal(def('dayRun').value, 0); assert.equal(def('rain').value, 0); assert.equal(def('fog').value, 0);
  // switches on the panel of the map
  for (const k of ['clouds', 'dayRun', 'edgePan', 'rain', 'fog']) { assert.equal(def(k).type, 'toggle', k); assert.ok(def(k).map.length > 3, k); }
  assert.equal(def('edgePan').value, 1);
  const ids = sky.pages.map(p => p.id); assert.equal(new Set(ids).size, ids.length);
  for (const id of ['sky-near', 'sky-200', 'sky-space', 'sky-dawn', 'sky-noon', 'sky-dusk', 'sky-night', 'sky-clouds', 'sky-rain', 'sky-rain-200', 'sky-rain-near', 'sky-fog', 'sky-fog-late', 'sky-fog-far']) {
    const pg = PAGES.find(p => p.id === id); assert.ok(pg, id); assert.ok(pg.title.length > 5 && pg.note.length > 20);
    assert.ok(pg.cam.h >= H_MIN && pg.cam.h <= H_MAX && pg.cam.tilt <= TILT_MAX && pg.cam.lat > BBOX.lat0 && pg.cam.lat < BBOX.lat1, id);
    for (const k of Object.keys(pg.p)) assert.ok(def(k), `${id}: no knob ${k}`);
    if (pg.p.hour) assert.ok(pg.p.hour >= def('hour').min && pg.p.hour <= def('hour').max, id);
  }
  // sunrise, noon, sunset and night are what their hours say on 21 June over the Pyrenees
  const up = id => { const pg = PAGES.find(p => p.id === id); return elev(sunDir(pg.p.hour, 172, pg.cam.lat)); };
  assert.ok(up('sky-dawn') > 1 && up('sky-dawn') < 9); assert.ok(up('sky-noon') > 65); assert.ok(up('sky-dusk') > 1 && up('sky-dusk') < 9); assert.ok(up('sky-night') < -8);
});

test('camera: the cursor at an edge of the window pushes the map', () => {
  const W = 1600, H = 900;
  assert.deepEqual(edgePush(800, 450, W, H), { x: 0, y: 0 }, 'the middle is still');
  assert.deepEqual(edgePush(EDGE_PX + 1, EDGE_PX + 1, W, H), { x: 0, y: 0 }); assert.deepEqual(edgePush(W - 2 - EDGE_PX, H - 2 - EDGE_PX, W, H), { x: 0, y: 0 });
  // at the very edge the push is full; toward the inside of the strip it falls to .4 and then stops
  near(edgePush(0, 450, W, H).x, -1, 1e-9); near(edgePush(W - 1, 450, W, H).x, 1, 1e-9); near(edgePush(800, 0, W, H).y, 1, 1e-9, 'top = away'); near(edgePush(800, H - 1, W, H).y, -1, 1e-9, 'bottom = back');
  const inner = edgePush(EDGE_PX - 1, 450, W, H).x; assert.ok(inner < -.39 && inner > -.5, `${inner}`);
  assert.ok(Math.abs(edgePush(4, 450, W, H).x) > Math.abs(edgePush(10, 450, W, H).x));
  // a corner pushes both ways; outside the window nothing moves
  const c = edgePush(0, 0, W, H); near(c.x, -1, 1e-9); near(c.y, 1, 1e-9);
  for (const [x, y] of [[-1, 450], [W, 450], [800, -5], [800, H], [NaN, 0]]) assert.deepEqual(edgePush(x, y, W, H), { x: 0, y: 0 });
});

test('camera: W A S D and the arrows move, Q and E turn, R and F tilt', () => {
  const k = (...c) => keyPush(new Set(c));
  assert.deepEqual([k('KeyW').y, k('KeyS').y, k('KeyA').x, k('KeyD').x], [1, -1, -1, 1]);
  assert.deepEqual([k('ArrowUp').y, k('ArrowDown').y, k('ArrowLeft').x, k('ArrowRight').x], [1, -1, -1, 1]);
  assert.deepEqual([k('KeyE').turn, k('KeyQ').turn, k('KeyR').tilt, k('KeyF').tilt], [1, -1, 1, -1]);
  assert.equal(k('KeyW', 'KeyS').y, 0, 'opposite keys cancel'); assert.equal(k('KeyW', 'ArrowUp').y, 1, 'two keys for one way are one push');
  assert.equal(k('KeyW', 'ShiftLeft').fast, true); assert.equal(k('KeyW').fast, false);
  // in the album the up and down arrows turn the pages: there they do not move the map, the side arrows still do
  const album = keyPush(new Set(['ArrowUp', 'ArrowRight']), false); assert.deepEqual([album.x, album.y], [1, 0]);
  assert.deepEqual(k(), { x: 0, y: 0, turn: 0, tilt: 0, fast: false });
});

test('camera: the speed of the move grows with the height, and goes where the view looks', () => {
  const s = { lat: 40, lon: -3, h: 200, tilt: 0, heading: 0 }, km = st => [st.lon * KM_PER_DEG * Math.cos(s.lat * D), st.lat * KM_PER_DEG];
  // one second forward at 200 km: PAN_RATE heights to the north
  let [e, n] = km(panStep(s, { x: 0, y: 1 }, 1)); near(n, 200 * PAN_RATE, 1e-6); near(e, 0, 1e-6);
  [e, n] = km(panStep(s, { x: 1, y: 0 }, 1)); near(e, 200 * PAN_RATE, 1e-6); near(n, 0, 1e-6);
  // ten times higher, ten times faster; Shift is faster still; twice the time, twice the way
  near(panStep({ ...s, h: 2000 }, { x: 0, y: 1 }, 1).lat / panStep(s, { x: 0, y: 1 }, 1).lat, 10, 1e-9);
  assert.ok(panStep(s, { x: 0, y: 1 }, 1, true).lat > 2 * panStep(s, { x: 0, y: 1 }, 1).lat); near(panStep(s, { x: 0, y: 1 }, .5).lat * 2, panStep(s, { x: 0, y: 1 }, 1).lat, 1e-12);
  // turned to the east, «forward» is east and «right» is south
  [e, n] = km(panStep({ ...s, heading: 90 }, { x: 0, y: 1 }, 1)); near(e, 200 * PAN_RATE, 1e-6); near(n, 0, 1e-6);
  [e, n] = km(panStep({ ...s, heading: 90 }, { x: 1, y: 0 }, 1)); near(n, -200 * PAN_RATE, 1e-6);
  // a corner of the window is not faster than an edge
  const diag = km(panStep(s, { x: 1, y: 1 }, 1)); near(Math.hypot(...diag), 200 * PAN_RATE, 1e-6);
  // a weak push (the inner side of the edge strip) is slower
  assert.ok(panStep(s, { x: 0, y: .4 }, 1).lat < .5 * panStep(s, { x: 0, y: 1 }, 1).lat);
  // tilted toward the horizon the ground ahead is foreshortened: forward covers more ground, but not without end
  const tilted = panStep({ ...s, tilt: 60 }, { x: 0, y: 1 }, 1).lat / panStep(s, { x: 0, y: 1 }, 1).lat; near(tilted, 2, 1e-9);
  assert.ok(panStep({ ...s, tilt: 88 }, { x: 0, y: 1 }, 1).lat / panStep(s, { x: 0, y: 1 }, 1).lat < 2.3);
});

test('camera: the wheel keeps the point under the cursor in place', () => {
  const s = { lat: 40, lon: -3, h: 400 }, P = { lat: 41.2, lon: -1.5 };
  for (const h1 of [200, 100, 800]) {
    const t = zoomAbout(s, P, h1); assert.equal(t.h, h1);
    // the view scales around P: P keeps its place in it, measured in heights of the camera
    near((P.lat - t.lat) / t.h, (P.lat - s.lat) / s.h, 1e-12); near((P.lon - t.lon) / t.h, (P.lon - s.lon) / s.h, 1e-12);
  }
  const closer = zoomAbout(s, P, 200); assert.ok(closer.lat > s.lat && closer.lon > s.lon, 'coming nearer, the view moves toward the cursor');
  const away = zoomAbout(s, P, 800); assert.ok(away.lat < s.lat && away.lon < s.lon);
  assert.deepEqual(zoomAbout(s, { lat: s.lat, lon: s.lon }, 100), { lat: 40, lon: -3, h: 100 }, 'the cursor on the middle: only the height changes');
});

test('camera: limits, easing, and the eye never under the ground', () => {
  const flat = new AlbumCamera(null, () => 0, { shot: true });
  flat.set({ lat: 99, lon: -99, h: 5, tilt: 120 }, true);
  assert.deepEqual([flat.t.lat, flat.t.lon, flat.t.h, flat.t.tilt], [BBOX.lat1, BBOX.lon0, H_MIN, TILT_MAX]);
  flat.set({ h: 1e6, tilt: -5 }, true); assert.deepEqual([flat.t.h, flat.t.tilt], [H_MAX, 0]);
  assert.ok(TILT_MAX > 80 && TILT_MAX < 90, 'the camera can look along the ground, at the horizon');
  // the shown state eases toward the target and arrives
  flat.set({ lat: 40, lon: -3, h: 500, tilt: 0, heading: 0 }, true); flat.update(1, 1.6); flat.set({ h: 100 });
  assert.equal(flat.update(.016, 1.6), true); assert.ok(flat.s.h < 500 && flat.s.h > 400, `${flat.s.h}`);
  for (let i = 0; i < 400; i++) flat.update(.016, 1.6);
  near(flat.s.h, 100, .01); assert.equal(flat.update(.016, 1.6), false, 'at rest');
  // looking straight down from 500 km the eye is 500 km up, and the far plane is beyond the horizon
  flat.set({ h: 500, tilt: 0 }, true); flat.update(1, 1.6); near(flat.alt, 500, .01); assert.ok(flat.cam.far > Math.sqrt(2 * R * 500)); assert.ok(flat.cam.near > 50 && flat.cam.near < 500);
  // the wheel anchor: while the height eases, the anchored point keeps its place in the view
  flat.set({ lat: 40, lon: -3, h: 400, tilt: 0 }, true); flat.update(1, 1.6);
  const P = { lat: 40.9, lon: -2.2 }; flat.anchor = { lat: P.lat, lon: P.lon, kLat: (flat.s.lat - P.lat) / flat.s.h, kLon: (flat.s.lon - P.lon) / flat.s.h };
  Object.assign(flat.t, zoomAbout(flat.s, P, 100)); const k0 = (P.lat - flat.s.lat) / flat.s.h;
  for (let i = 0; i < 30; i++) { flat.update(.016, 1.6); near((P.lat - flat.s.lat) / flat.s.h, k0, 1e-9, `frame ${i}`); }
  for (let i = 0; i < 600; i++) flat.update(.016, 1.6);
  near(flat.s.h, 100, .01); near(flat.s.lat, flat.t.lat, 1e-4); assert.equal(flat.anchor, null);
  // a plateau 2 km high everywhere: tilted to the limit at the lowest height, the eye still clears the ground under it
  const high = new AlbumCamera(null, () => 2000, { shot: true }); high.exag = 1.6;
  high.set({ lat: 40, lon: -3, h: H_MIN, tilt: TILT_MAX, heading: 30 }, true); high.update(1, 1.6);
  assert.ok(high.alt > 2000 * 1.6 / 1000 + .3, `eye at ${high.alt} km over a plateau at 3.2 km`);
  // a wall of mountains under the eye only (the target is on low ground): the eye is lifted over it
  const wall = new AlbumCamera(null, (lat) => (lat < 39.95 ? 3000 : 100), { shot: true }); wall.exag = 1.6;
  wall.set({ lat: 40, lon: -3, h: 20, tilt: 86, heading: 0 }, true); wall.update(1, 1.6);
  assert.ok(wall.alt > 4.8 + .3, `eye at ${wall.alt} km over a ridge at 4.8 km`); assert.ok(wall.lift > 2);
  // in a still capture nothing moves by itself
  assert.equal(flat.edgePan, false); assert.ok(PAN_RATE > .3 && PAN_RATE < 2);
});
