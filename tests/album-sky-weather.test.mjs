// The weather of the album (src/album/sky/weather.js, docs/album/sky.md): the field of the clouds, where it rains,
// the fog of the morning. What it looks like is checked by eye (harness acap … "page=sky-rain", "page=sky-fog"), and
// whether its shaders compile by `harness acheck … "page=sky-rain&ui=0&p.fog=1"`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOUD_KM, CLOUD_N, WIND, RAIN_LAG, RAIN_EDGE, WEATHER, WX, planeOf, llOfPlane, cloudNoise, cloudAt, cloudOffset, cloudThreshold, rainCover, rainMask, rainAt,
  fogByHour, fogNumbers, fogFloor, fogFloorAt, needClouds, SNOW_DROP, SNOW_BAND, snowLine, snowfallLine, snowShare, snowNumbers } from '../src/album/sky/weather.js';
import { readFileSync } from 'node:fs';
import { LIGHT } from '../src/album/light.js';
import { postShader, POST_CLOUDS, POST_RAIN, POST_FOG } from '../src/album/post.js';
import { sunTimes } from '../src/album/sky/astro.js';
import { BBOX, CENTRE } from '../src/album/geo.js';
import sky from '../src/album/aspects/sky.js';
import { DEFS } from '../src/album/params.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} is not within ${eps} of ${b}`);
const NOISE = cloudNoise(), page = id => sky.pages.find(p => p.id === id), def = k => DEFS.find(d => d.key === k);

test('weather: the plane it is laid out on', () => {
  const o = planeOf(CENTRE.lat, CENTRE.lon); near(o[0], 0, 1e-6); near(o[1], 0, 1e-6);
  // km east and km south of the middle of the map
  assert.ok(planeOf(CENTRE.lat, CENTRE.lon + 1)[0] > 80 && planeOf(CENTRE.lat + 1, CENTRE.lon)[1] < -105);
  for (const [la, lo] of [[36, -9], [44.5, 4], [40, -2.75], [42.63, .66]]) { const p = planeOf(la, lo), ll = llOfPlane(p[0], p[1]); near(ll.lat, la, 1e-6); near(ll.lon, lo, 1e-6); near(ll.h, 0, 1e-6); }
});

test('weather: the field of the clouds is one picture that repeats without a seam', () => {
  assert.equal(NOISE.length, CLOUD_N * CLOUD_N);
  assert.deepEqual(Array.from(cloudNoise(64).slice(0, 200)), Array.from(cloudNoise(64).slice(0, 200)), 'the same picture every time');
  // spread around .5 with a deviation of .125: the knob of the clouds always means the same share of the sky
  let m = 0, d = 0; for (const v of NOISE) m += v / 255; m /= NOISE.length; for (const v of NOISE) d += (v / 255 - m) ** 2;
  near(m, .5, .005); near(Math.sqrt(d / NOISE.length), .125, .005);
  // no seam: across the edge of the picture neighbours differ no more than neighbours inside it
  let edge = 0, inside = 0, N = CLOUD_N;
  for (let j = 0; j < N; j++) { edge += Math.abs(NOISE[j * N] - NOISE[j * N + N - 1]) + Math.abs(NOISE[j] - NOISE[(N - 1) * N + j]); inside += Math.abs(NOISE[j * N + 300] - NOISE[j * N + 301]) + Math.abs(NOISE[300 * N + j] - NOISE[301 * N + j]); }
  assert.ok(edge < inside * 1.4 && edge > 0, `edge ${edge}, inside ${inside}`);
  near(cloudAt(NOISE, 123, -456), cloudAt(NOISE, 123 + CLOUD_KM, -456 - CLOUD_KM), 1e-9, 'it repeats');
  // the wind carries it toward the east-north-east: what was over a place is, after 100 km of the way, 100 km downwind
  near(Math.hypot(...WIND), 1, 1e-3); assert.ok(WIND[0] > .8 && WIND[1] < -.2, 'east, and a little north');
  near(cloudAt(NOISE, 250 + WIND[0] * 100, -80 + WIND[1] * 100, 100), cloudAt(NOISE, 250, -80, 0), 1e-9);
  assert.deepEqual(cloudOffset(0), [-37, 11]);
  // more of the knob, more of the sky under cloud
  const share = cover => { let c = 0; for (const v of NOISE) if (v / 255 > cloudThreshold(cover)) c++; return c / NOISE.length; };
  assert.ok(share(.2) < share(.45) && share(.45) < share(.8)); assert.ok(share(.45) > .15 && share(.45) < .45, `${share(.45)}`);
});

test('weather: it rains under some of the clouds, nearly to their edge', () => {
  assert.ok(rainCover(1) > rainCover(.3) && rainCover(.1) > .3 && rainCover(1) < .75, 'rain brings clouds, but not a whole grey sky');
  assert.ok(rainMask(1) < rainMask(.3), 'harder rain: more of the clouds rain');
  const force = def('rainForce').value, cover = rainCover(force), thr = cloudThreshold(cover);
  let n = 0, wet = 0, wetHard = 0, wetWeak = 0;
  for (let la = BBOX.lat0 + .2; la < BBOX.lat1; la += .15) for (let lo = BBOX.lon0 + .2; lo < BBOX.lon1; lo += .15) {
    const r = rainAt(NOISE, la, lo, cover, force); n++;
    if (r > .5) wet++; if (rainAt(NOISE, la, lo, rainCover(1), 1) > .5) wetHard++; if (rainAt(NOISE, la, lo, rainCover(.3), .3) > .5) wetWeak++;
    // no rain out of a clear sky: where it rains, the cloud stands over the place the rain fell from
    if (r > .01) { const p = planeOf(la, lo); assert.ok(cloudAt(NOISE, p[0] + WIND[0] * RAIN_LAG, p[1] + WIND[1] * RAIN_LAG) > thr + RAIN_EDGE - 1e-6, `${la}, ${lo}`); }
  }
  assert.ok(wet / n > .04 && wet / n < .2, `share of the map under rain ${wet / n}`); assert.ok(wetWeak < wet && wet < wetHard);
  // the album's pages of rain show rain: north of the camera on «Дождь с высоты», ahead of it on «Дождь вблизи», which stands at the edge
  const far = page('sky-rain'), edge = page('sky-rain-near'), mid = page('sky-rain-200');
  assert.ok(rainAt(NOISE, far.cam.lat + 1, far.cam.lon, cover, force) > .9 && rainAt(NOISE, far.cam.lat, far.cam.lon, cover, force) < .1 && far.cam.heading === 0);
  assert.ok(rainAt(NOISE, mid.cam.lat, mid.cam.lon, cover, force) > .9);
  assert.ok(rainAt(NOISE, edge.cam.lat, edge.cam.lon, cover, force) < .1 && rainAt(NOISE, edge.cam.lat, edge.cam.lon + .4, cover, force) > .3 && edge.cam.heading > 45 && edge.cam.heading < 135);
  for (const pg of [far, edge, mid]) assert.equal(pg.p.rain, 1);
});

test('weather: above the line of snowfall it snows, below it rains', () => {
  // the line hangs on the snow line of the ground shader: if that rule changes there, it must change here
  assert.match(readFileSync(new URL('../src/album/terrain.js', import.meta.url), 'utf8'), /snowline = 2980\. - \(lat - 37\.\) \* 55\./);
  near(snowLine(37), 2980, 1e-9); near(snowLine(42.63), 2980 - 5.63 * 55, 1e-9); near(snowLine(40, -250), snowLine(40) - 250, 1e-9);
  near(snowfallLine(42.63), snowLine(42.63) - SNOW_DROP, 1e-9); assert.ok(SNOW_DROP >= 500 && SNOW_DROP <= 1500, 'fresh snow lies below the lasting snow, but not on the plains in summer');
  // rain well below the line, snow well above, half and half on it
  const line = snowfallLine(42.63);
  assert.equal(snowShare(42.63, line - SNOW_BAND - 1), 0); assert.equal(snowShare(42.63, line + SNOW_BAND + 1), 1); near(snowShare(42.63, line), .5, 1e-9);
  // Aneto (3404 m) is in snow, Benasque in the valley under it (1140 m) in rain; with the winter look the valley snows too
  assert.equal(snowShare(42.63, 3404), 1); assert.equal(snowShare(42.6, 1140), 0); assert.equal(snowShare(42.6, 1140, -2150), 1);
  assert.equal(snowShare(37.05, 3479), 1, 'Sierra Nevada'); assert.equal(snowShare(40.4, 660), 0, 'Madrid');
  // the same line as the shaders get it: on the plane of the weather, in km of the world
  for (const exag of [1, 1.6]) for (const shift of [0, -2150]) {
    const [at0, perKm, band] = snowNumbers(shift, exag); near(band, SNOW_BAND * exag / 1000, 1e-12);
    for (const lat of [36, 40, 42.63, 44.5]) near((at0 + planeOf(lat, CENTRE.lon)[1] * perKm) / exag * 1000, snowfallLine(lat, shift), 3, `lat ${lat}`);
  }
  // the pages of snowfall: it rains over the place with the clouds moved as the page moves them, and the mountains there are above the line
  const force = def('rainForce').value, cover = rainCover(force);
  for (const id of ['sky-snow', 'sky-snow-near', 'sky-snow-200']) {
    const pg = page(id); assert.equal(pg.p.rain, 1, id);
    assert.ok(rainAt(NOISE, pg.cam.lat, pg.cam.lon, cover, force, pg.p.cloudShift) > .9, id); assert.ok(snowfallLine(pg.cam.lat) < 2500, id);
  }
  assert.equal(def('cloudShift').value, 0); assert.ok(!def('cloudShift').map, 'a knob of the album, not a switch of the map');
  // in the finishing pass: with the rain only
  const rain = postShader(POST_CLOUDS | POST_RAIN);
  assert.ok(/wxFlakes\(az/.test(rain) && /wxSnowAir\(Pa/.test(rain) && /uSnowF\.w > 0\./.test(rain));
  assert.ok(!/wxFlakes|wxSnowAir\(Pa/.test(postShader(POST_CLOUDS)) && !/wxFlakes/.test(postShader(POST_FOG)));
});

test('weather: the fog is of the morning', () => {
  const rise = sunTimes(172, 41.65).rise;
  assert.equal(fogByHour(0, rise), 1, 'in the light of the map the switch shows fog');
  for (const h of [2, 3, rise, rise + 1, rise + 1.5]) near(fogByHour(h, rise), 1, 1e-9, `hour ${h}`);
  for (const h of [12, 13, 16, 20]) assert.equal(fogByHour(h, rise), 0, `hour ${h}`);
  // it thins all the morning, gathers again through the night, and never jumps
  for (let h = rise + 1.5; h < 12; h += .25) assert.ok(fogByHour(h + .25, rise) < fogByHour(h, rise), `hour ${h}`);
  assert.ok(fogByHour(22, rise) > 0 && fogByHour(22, rise) < fogByHour(23.75, rise) && fogByHour(23.75, rise) < fogByHour(1, rise));
  for (let h = .25; h < 23.75; h += .25) assert.ok(Math.abs(fogByHour(h + .25, rise) - fogByHour(h, rise)) < .2, `hour ${h}`);
  near(fogByHour(8, 6), fogByHour(32, 6), 1e-12, 'a day later, the same');
  // a winter sunrise is late: the fog stays longer
  assert.ok(fogByHour(10, 7.4) > fogByHour(10, 4.6));
  // the pages: thick at half past six, half gone two hours later
  const early = page('sky-fog'), late = page('sky-fog-late');
  assert.ok(fogByHour(early.p.hour, rise) > .9); assert.ok(fogByHour(late.p.hour, rise) > .3 && fogByHour(late.p.hour, rise) < .8);
  assert.deepEqual(early.cam, late.cam, 'the same place'); assert.equal(page('sky-fog-far').p.fog, 1);
  // more fog: a thicker layer and more banks of it; none: no layer at all
  const a = fogNumbers(.3), b = fogNumbers(1); assert.equal(fogNumbers(0).thick, 0);
  assert.ok(a.thick < b.thick && b.thick > 200 && b.thick < 400 && a.bank > b.bank && a.soft < b.soft && a.soft > 5);
});

test('weather: fog fills the land from the floor of the valley and the sea', () => {
  // a made-up land: a plain at 500 m, a valley along the 41st parallel cut down to 200 m, the sea west of 8° W
  const land = (lat, lon) => (lon < -8 ? -100 : Math.min(500, 200 + Math.abs(lat - 41) * 111 * 30));
  const ff = fogFloor(land, 8, 2), at = (la, lo) => fogFloorAt(ff, la, lo);
  assert.ok(ff.w * ff.cell > 1150 && ff.h * ff.cell > 1000 && ff.floor.length === ff.w * ff.h && ff.weight.length === ff.w * ff.h);
  // in the valley the floor is the bottom of the valley; a few km up its side it is still nearly the bottom — so the
  // side rises out of the fog; far away on the plain it is the plain itself
  assert.ok(at(41, -3).floor < 260, `${at(41, -3).floor}`); assert.ok(at(41.1, -3).floor < 300 && land(41.1, -3) - at(41.1, -3).floor > 200);
  near(at(43, -3).floor, 500, 5); near(at(38, -3).floor, 500, 5);
  // (and the mean height of the land around: what the snowfall asks about the air over a place)
  near(at(43, -3).mean, 500, 5); assert.ok(at(41, -3).mean > at(41, -3).floor + 50 && at(41, -3).mean < 500); assert.equal(ff.mean.length, ff.w * ff.h);
  assert.ok(at(41, -3).weight > at(43, -3).weight && at(43, -3).weight >= 1, 'fog likes a valley more than an open plain');
  // the sea: its floor is the sea itself; fog stands off the coast and thins out to nothing in the open sea
  near(at(40, -9.9).floor, 0, 1e-6); near(at(40, -9.9).sea, 1, 1e-6); near(at(40, -9.9).weight, 0, .02); near(at(38, -3).sea, 0, 1e-6);
  assert.ok(at(40, -8.05).weight > .6 && at(40, -8.4).weight < at(40, -8.05).weight && at(40, -8.4).weight > at(40, -9.9).weight);
});

test('weather: nothing of it in the shaders of the land, and nothing at all while it is off', () => {
  // the shared light, which every shader of the land pastes, knows no weather and reads no texture
  assert.ok(!/sampler|albumCloud|wxRain|wxFog|tCloud|tFog/.test(LIGHT)); assert.equal(sky.glsl, '', 'the sky paints nothing in the ground shader');
  for (const k of ['tCloud', 'tFog', 'uRain', 'uFog', 'uFogRect', 'uSnowF']) assert.ok(!(k in sky.uniforms), `${k} is not among the uniforms of the ground`);
  // the GLSL of the weather: what post.js and layers/clouds.js call
  for (const sig of ['vec2 wxPlane(vec3 wpos)', 'float wxCloudN(vec2 q, float lod)', 'float albumCloudField(vec3 wpos)', 'float albumCloudShade(vec3 wpos)', 'float wxRainMask(vec2 q)', 'float wxRainCloud(vec2 q, float lod)', 'float wxRainAt(vec2 q, float lod)',
    'float wxFogTop(vec2 q)', 'float wxSnowy(vec2 q, float alt)', 'float wxSnowAir(vec2 q)']) assert.ok(WEATHER.includes(sig), sig);
  assert.ok(!/vnoise|fbm|worley/.test(WEATHER), 'the weather reads its two pictures and counts no noise');
  for (const k of Object.keys(WX)) assert.match(WEATHER, new RegExp(`\\b${k}\\b`), k);
  // off by default, and the pictures are not even built
  assert.equal(WX.uRain.value.x, 0); assert.equal(WX.uFog.value.x, 0); assert.equal(WX.tFog.value, null);
  for (const k of ['rain', 'fog', 'clouds']) assert.equal(def(k).value, 0, k);
  // the finishing pass without weather is the plain pass: no weather in its text
  const plain = postShader(0); assert.ok(!/wx[A-Z]|uRain|uFog|tCloud|albumCloud|albumHaze/.test(plain), 'the plain pass');
  // each piece is there only with its own switch
  const clouds = postShader(POST_CLOUDS), rain = postShader(POST_CLOUDS | POST_RAIN), fog = postShader(POST_FOG);
  assert.ok(/albumCloudShade\(wpos\)/.test(clouds) && !/wxLines|wxFogTop\(P/.test(clouds));
  assert.ok(/wxLines\(az/.test(rain) && /wxRainAt\(qw/.test(rain) && /albumCloudShade\(wpos\)/.test(rain) && !/wxFogTop\(P/.test(rain));
  assert.ok(/wxFogTop\(P/.test(fog) && !/wxLines|albumCloudShade\(wpos\)/.test(fog));
  // the picture of the clouds, once asked for: repeating, one byte a point
  needClouds(); const t = WX.tCloud.value; assert.ok(t && t.image.width === CLOUD_N && t.image.data.length === CLOUD_N * CLOUD_N); needClouds(); assert.equal(WX.tCloud.value, t, 'built once');
});
