// The weather of the album (src/album/sky/weather.js, docs/album/sky.md): the field of the clouds, where it rains,
// the fog of the morning. What it looks like is checked by eye (harness acap … "page=sky-rain", "page=sky-fog"), and
// whether its shaders compile by `harness acheck … "page=sky-rain&ui=0&p.fog=1"`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_NEAR, CLOUD_KM, GROW_KM, CELL_KM, GROW, GROW_LOD, GROW_DEV, FIELD_DEV, softNoise, ROUND, CLOUD_N, WIND, GROW_WIND, CELL_WIND, RAIN_LAG, RAIN_EDGE, WEATHER, WX, planeOf, llOfPlane, mapOf, llOfMap, MAP_ROUND, MAP_K, MAP_AXIS, MAP_E0, MAP_E1,
  cloudNoise, cloudAt, cellAt, cloudOffset, growOffset, cellOffset, cloudThreshold, rainCover, rainMask, rainAt,
  COVER_REST, WILL_REST, skyShare, coverOfShare, rainWill, coverAt, rainMaskAt, climatePicture, climateAt, climUV, CLIM_W, CLIM_H, precOf,
  fogByHour, fogByHeight, FOG_NEAR, FOG_FAR, fogNumbers, fogFloor, fogFloorAt, needClouds, SNOW_DROP, SNOW_BAND, snowLine, snowfallLine, snowShare, snowNumbers,
  HILL_FILL, HILL_FROM, CAP_CREST, CAP_HIGH, CAP_UNDER, CAP_OVER, capBank, capAt } from '../src/album/sky/weather.js';
import { readFileSync } from 'node:fs';
import { cloudShader, LUMPS, BANK_STEP, SHELL_REACH, cloudShow, rainCloudShow } from '../src/album/layers/clouds.js';
import { LIGHT } from '../src/album/light.js';
import { postShader, POST_CLOUDS, POST_RAIN, POST_FOG } from '../src/album/post.js';
import { sunTimes } from '../src/album/sky/astro.js';
import { BBOX, CENTRE, R, COS_REF, toWorld } from '../src/album/geo.js';
import { H_MAX } from '../src/album/camera.js';
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

test('weather: the map of the whole Earth the clouds and the rain are laid out on', () => {
  const o = mapOf(CENTRE.lat, CENTRE.lon); near(o[0], 0, 1e-9); near(o[1], 0, 1e-9); near(MAP_K, R * COS_REF, 1e-9); near(MAP_ROUND, 2 * Math.PI * MAP_K, 1e-9);
  // near the middle of the album it is the plane of the album: km east and km south
  for (const [la, lo] of [[40.5, -2], [41, -4], [39, -1.5], [40, -2.75]]) { const m = mapOf(la, lo), p = planeOf(la, lo); near(m[0], p[0], 3); near(m[1], p[1], 3); }
  // any place of the Earth has its place on it, and comes back from it
  for (const [la, lo] of [[36, -9], [0, 0], [60, 30], [-33.9, 151.2], [-54.8, -68.3], [78, 15], [40, 177], [40, -179], [-85, 100]]) {
    const m = mapOf(la, lo), ll = llOfMap(m[0], m[1]); near(ll.lat, la, 1e-6); near(ll.lon, lo, 1e-6); assert.ok(Math.abs(m[0]) <= MAP_ROUND / 2 + 1e-6, `${la}, ${lo}`);
  }
  // it closes on itself around the Earth: the two sides of the line opposite the album lie MAP_ROUND apart
  near(mapOf(40, CENTRE.lon + 179.999)[0] - mapOf(40, CENTRE.lon - 179.999)[0], MAP_ROUND, 1);
  // every read of the picture repeats a whole number of times around it, so nothing shows along that line
  assert.deepEqual(ROUND, [4, 3, 2]); for (const k of [CLOUD_KM, GROW_KM, CELL_KM, ...LUMPS.map(l => MAP_ROUND / l[0])]) near(MAP_ROUND / k, Math.round(MAP_ROUND / k), 1e-9);
  for (const [x, y] of [[1234, -456], [-9000, 3000]]) { near(cloudAt(NOISE, x, y, 700), cloudAt(NOISE, x + MAP_ROUND, y, 700), 1e-9); near(cellAt(NOISE, x, y, 700), cellAt(NOISE, x - MAP_ROUND, y, 700), 1e-9); }
  // the three directions the shaders find a place by: the axis of the Earth and two places on the equator
  const dir = (la, lo) => { const v = toWorld(la, lo, 0); return [v.x / R, (v.y + R) / R, v.z / R]; }, dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  near(dot(MAP_AXIS, MAP_E0), 0, 1e-9); near(dot(MAP_AXIS, MAP_E1), 0, 1e-9); near(dot(MAP_E0, MAP_E1), 0, 1e-9);
  for (const [la, lo] of [[40, -2.75], [-20, 100], [70, -150]]) {
    const e = dir(la, lo), s = dot(e, MAP_AXIS), lon = Math.atan2(dot(e, MAP_E1), dot(e, MAP_E0)), m = mapOf(la, lo);
    near(s, Math.sin(la * Math.PI / 180), 1e-9); near(lon * MAP_K, m[0], 1e-6); near(Math.atanh(Math.sin(CENTRE.lat * Math.PI / 180)) * MAP_K - Math.atanh(s) * MAP_K, m[1], 1e-6);
    near(lon / (2 * Math.PI) + (CENTRE.lon + 180) / 360, climUV(la, lo)[0] + (climUV(la, lo)[0] < (CENTRE.lon + 180) / 360 - .5 ? 1 : 0), 1e-9); near(.5 - .5 * s, climUV(la, lo)[1], 1e-9);
  }
  assert.ok(WEATHER.includes('atanh(s)') && WEATHER.includes('x = dot(e, WX_E0), y = dot(e, WX_E1)') && WEATHER.includes(': atan(y, x);'));
  // (near the meridian of the album the shaders count the arctangent by a short series: the same to a twentieth of a km)
  for (const t of [0, .05, -.2, MAP_NEAR, -MAP_NEAR]) near(t * (1 - t * t * (.3333333 - t * t * (.2 - t * t * .1428571))) * MAP_K, Math.atan(t) * MAP_K, .06, `t ${t}`);
  assert.ok(Math.atan(MAP_NEAR) * 180 / Math.PI > 15, 'the album and well around it');
  // the shell of the clouds is the half of a sphere that faces the eye: it reaches past the edge of the ball seen from the greatest height
  assert.ok(SHELL_REACH > Math.acos(R / (R + H_MAX)) + .1 && SHELL_REACH < Math.PI / 2);
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
  // the wind carries the clouds toward the east-north-east; what makes them grow and melt slides the other way, and
  // the cells of rain lag behind the clouds
  near(Math.hypot(...WIND), 1, 1e-3); assert.ok(WIND[0] > .8 && WIND[1] < -.2, 'east, and a little north');
  assert.deepEqual(cloudOffset(0), [-37, 11]); assert.deepEqual(cloudOffset(100), [-37 - 100 * WIND[0], 11 - 100 * WIND[1]]);
  assert.ok(GROW_WIND[0] * WIND[0] + GROW_WIND[1] * WIND[1] < -.3, 'against the wind'); assert.ok(Math.hypot(...GROW_WIND) > .3 && Math.hypot(...GROW_WIND) < .8);
  const along = CELL_WIND[0] * WIND[0] + CELL_WIND[1] * WIND[1]; assert.ok(along > .5 && along < .85, `${along}`);
  assert.deepEqual(growOffset(0), [2051, 977]); assert.deepEqual(cellOffset(100), [-100 * CELL_WIND[0], -100 * CELL_WIND[1]]);
  // So a cloud is not a thing that flies over the map for ever. Followed downwind, the sky over a place that moves
  // with the wind changes: a little in 30 km of the way, and after 1500 km it is another sky altogether.
  let d30 = 0, d1500 = 0, n = 0;
  for (let y = -2000; y < 2000; y += 211) for (let x = -3000; x < 3000; x += 197) {
    const a = cloudAt(NOISE, x, y, 0); n++;
    d30 += Math.abs(cloudAt(NOISE, x + WIND[0] * 30, y + WIND[1] * 30, 30) - a); d1500 += Math.abs(cloudAt(NOISE, x + WIND[0] * 1500, y + WIND[1] * 1500, 1500) - a);
  }
  assert.ok(d30 / n < .03 && d30 > 0, `${d30 / n}`); assert.ok(d1500 / n > .05, `${d1500 / n}`);
  // (what makes them grow and melt is the picture read softly: only its large shapes, so that whole clouds come and
  // go and their small parts do not flicker)
  const soft = softNoise(NOISE); assert.equal(soft.length, (CLOUD_N >> GROW_LOD) ** 2); assert.equal(softNoise(NOISE), soft, 'made once');
  let sm = 0, sv = 0; for (const v of soft) { sm += v / 255; sv += (v / 255) ** 2; } near(sm / soft.length, .5, .005); near(Math.sqrt(sv / soft.length - (sm / soft.length) ** 2), GROW_DEV, .002);
  assert.ok(GROW_DEV < .125 && GROW_DEV > .09); assert.match(WEATHER, /uGrow\.xy\) \/ [\d.]+, lod \+ 3\.0\)/);
  // the field is the two reads added: spread around .5 with the deviation the threshold is counted by
  let m2 = 0, v2 = 0, k2 = 0; const share = cover => { let c = 0, t = 0; for (let y = -3000; y < 3000; y += 53) for (let x = -15000; x < 15000; x += 59) { t++; if (cloudAt(NOISE, x, y) > cloudThreshold(cover)) c++; } return c / t; };
  for (let y = -3000; y < 3000; y += 53) for (let x = -15000; x < 15000; x += 59) { const v = cloudAt(NOISE, x, y); m2 += v; v2 += v * v; k2++; }
  near(m2 / k2, .5, .01); near(Math.sqrt(v2 / k2 - (m2 / k2) ** 2), FIELD_DEV, .008); near(FIELD_DEV, Math.hypot(.125, GROW * GROW_DEV), 1e-12);
  // more of the knob, more of the sky under cloud: about a quarter at its rest
  assert.ok(share(.2) < share(.45) && share(.45) < share(.8)); assert.ok(share(.45) > .2 && share(.45) < .36, `${share(.45)}`); assert.equal(COVER_REST, def('cloudCover').value);
});

test('weather: how much cloud and rain a place has goes by its climate', () => {
  // more precipitation in the month: more of the sky under cloud, clouds that rain more willingly
  for (const mm of [0, 5, 20, 60, 150, 300]) { assert.ok(skyShare(mm + 10) > skyShare(mm)); assert.ok(rainWill(mm + 10) > rainWill(mm)); }
  assert.ok(skyShare(0) < .1 && skyShare(25) > .25 && skyShare(25) < .45 && skyShare(150) > .7 && skyShare(600) < .9, 'a desert, Spain in June, the north Atlantic');
  near(rainWill(0), 0, 1e-12); assert.ok(rainWill(300) > .9);
  // the knob that leaves a share of the sky under cloud: counted back through the threshold, it gives that share
  for (const f of [.08, .3, .6, .85]) {
    const thr = cloudThreshold(coverOfShare(f)); let c = 0, t = 0;
    for (let y = -3000; y < 3000; y += 53) for (let x = -15000; x < 15000; x += 59) { t++; if (cloudAt(NOISE, x, y) > thr) c++; }
    near(c / t, f, .05, `a share of ${f}`);
  }
  // the climate of a place moves the knob: at its rest the climate rules, and the knob adds to it or takes away
  assert.equal(coverAt(.45, null), .45); assert.equal(coverAt(.7, undefined), .7);
  near(coverAt(COVER_REST, { cover: .8, will: .5 }), .8, 1e-12); near(coverAt(COVER_REST + .1, { cover: .3, will: 0 }), .4, 1e-12); assert.equal(coverAt(0, { cover: .1, will: 0 }), .02); assert.equal(coverAt(1, { cover: .9, will: 0 }), 1);
  near(rainMaskAt(.6, null), rainMask(.6), 1e-12); near(rainMaskAt(.6, { cover: .5, will: WILL_REST }), rainMask(.6), 1e-12);
  assert.ok(rainMaskAt(.6, { cover: .5, will: .9 }) < rainMask(.6) - .2 && rainMaskAt(.6, { cover: .5, will: 0 }) > rainMask(.6), 'a wet climate: more of the clouds rain');
  // the picture of the climate, from a made-up one: dry everywhere in January and July, but a wet belt along the
  // equator in July, and a wet spot at 40° N, 100° E all the year
  const W = 720, H = 360, prec = new Uint16Array(12 * W * H);
  for (let m = 0; m < 12; m++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const lat = 90 - (y + .5) / 2, lon = -180 + (x + .5) / 2;
    prec[m * W * H + y * W + x] = (Math.abs(lat - 40) < 6 && Math.abs(lon - 100) < 8) ? 220 : (m === 6 && Math.abs(lat) < 8 ? 300 : 4);
  }
  const jul = climatePicture(prec, 198), jan = climatePicture(prec, 15), mid = climatePicture(prec, 181);
  assert.equal(jul.length, CLIM_W * CLIM_H * 4);
  const dry = climateAt(jul, 25, 10), wet = climateAt(jul, 0, 10), spot = climateAt(jan, 40, 100);
  near(dry.cover, coverOfShare(skyShare(4)), .01); near(dry.will, rainWill(4), .01); near(wet.cover, coverOfShare(skyShare(300)), .01); near(wet.will, rainWill(300), .01);
  near(spot.cover, coverOfShare(skyShare(220)), .01); near(climateAt(jan, 0, 10).cover, dry.cover, .01, 'no belt in January');
  // between the middles of two months the two are mixed; the picture closes around the Earth
  const half = climateAt(mid, 0, 10).cover; assert.ok(half > climateAt(climatePicture(prec, 166), 0, 10).cover + .05 && half < wet.cover - .05, `${half}`);
  near(climateAt(jul, 0, 179.9).cover, climateAt(jul, 0, -179.9).cover, .01); assert.deepEqual(climUV(0, -180), [0, .5]); near(climUV(90, 0)[1], 0, 1e-12);
  // it rains more where the climate is wet: over the whole map, with the same clouds
  const force = def('rainForce').value, cover = rainCover(force); let rDry = 0, rWet = 0;
  for (let la = -20; la < 60; la += 1.7) for (let lo = -60; lo < 60; lo += 1.9) { rDry += rainAt(NOISE, la, lo, cover, force, 0, dry); rWet += rainAt(NOISE, la, lo, cover, force, 0, wet); }
  assert.ok(rWet > rDry * 4 && rDry >= 0, `dry ${rDry}, wet ${rWet}`);
  // the file of the open climate: the precipitation stands after the temperature
  const buf = new ArrayBuffer(12441600 + 16); new Uint16Array(buf, 6220800, 2).set([77, 78]); const p = precOf(buf); assert.equal(p.length, 12 * 360 * 720); assert.deepEqual([p[0], p[1]], [77, 78]);
  // until the climate has come the picture is one point that says «as the knobs say»
  needClouds(); const d = WX.tClim.value.image.data; near(d[0] / 255, COVER_REST, .003); near(d[1] / 255, WILL_REST, .003);
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
    if (r > .01) { const p = mapOf(la, lo); assert.ok(cloudAt(NOISE, p[0] + WIND[0] * RAIN_LAG, p[1] + WIND[1] * RAIN_LAG) > thr + RAIN_EDGE - 1e-6, `${la}, ${lo}`); }
  }
  assert.ok(wet / n > .04 && wet / n < .2, `share of the map under rain ${wet / n}`); assert.ok(wetWeak < wet && wet < wetHard);
  // a cloud rains while it stands in a cell of rain: the cells lag behind the clouds, so rain begins and ends
  assert.ok(Math.abs(cellAt(NOISE, 500 + WIND[0] * 900, -300 + WIND[1] * 900, 900) - cellAt(NOISE, 500, -300, 0)) > 1e-4);
  near(cellAt(NOISE, 500 + CELL_WIND[0] * 900, -300 + CELL_WIND[1] * 900, 900), cellAt(NOISE, 500, -300, 0), 1e-9);
  // the album's pages of rain show rain: north of the camera on «Дождь с высоты», ahead of it on «Дождь вблизи», which stands at the edge
  const far = page('sky-rain'), edge = page('sky-rain-near'), mid = page('sky-rain-200'), at = (pg, dLat, dLon) => rainAt(NOISE, pg.cam.lat + dLat, pg.cam.lon + dLon, cover, force, pg.p.cloudShift || 0);
  assert.ok(at(far, 1, 0) > .9 && at(far, 0, 0) < .1 && far.cam.heading === 0);
  assert.ok(at(mid, 0, 0) > .9);
  assert.ok(at(edge, 0, 0) < .1 && at(edge, 0, .4) > .3 && edge.cam.heading > 45 && edge.cam.heading < 135);
  for (const pg of [far, edge, mid]) { assert.equal(pg.p.rain, 1); assert.ok((pg.p.cloudShift || 0) <= def('cloudShift').max); }
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
  // south of the equator the line goes by the distance from it, the same way; at the equator it is highest
  near(snowLine(-42.63), snowLine(42.63), 1e-9); assert.ok(snowLine(0) > 5000); assert.equal(snowShare(-50.5, 2500), 1, 'Patagonia'); assert.equal(snowShare(0, 3900), 0);
  // the same line as the shaders get it: by the latitude, in km of the world
  for (const exag of [1, 1.6]) for (const shift of [0, -2150]) {
    const [at0, perDeg, band] = snowNumbers(shift, exag); near(band, SNOW_BAND * exag / 1000, 1e-12);
    for (const lat of [36, 40, 42.63, 44.5, 0, -30, 70]) near((at0 - Math.abs(lat) * perDeg) / exag * 1000, snowfallLine(lat, shift), 1e-6, `lat ${lat}`);
  }
  assert.match(WEATHER, /float wxSnowLine\(float s\) \{ return uSnowF\.x - abs\(degrees\(asin\(s\)\)\) \* uSnowF\.y; \}/);
  // the pages of snowfall: it rains over the place with the clouds moved as the page moves them, and the mountains there are above the line
  const force = def('rainForce').value, cover = rainCover(force);
  for (const id of ['sky-snow', 'sky-snow-near']) {
    const pg = page(id); assert.equal(pg.p.rain, 1, id);
    assert.ok(rainAt(NOISE, pg.cam.lat, pg.cam.lon, cover, force, pg.p.cloudShift) > .9, id); assert.ok(snowfallLine(pg.cam.lat) < 2500, id);
  }
  // «След снегопада»: the cloud has gone on downwind — no rain over the place now, rain 110 km downwind of it — and
  // has left its white trail on the mountains
  const trail = page('sky-snow-200'), cl = Math.cos(trail.cam.lat * Math.PI / 180), dn = km => [trail.cam.lat - WIND[1] * km / 111.2, trail.cam.lon + WIND[0] * km / (111.2 * cl)];
  assert.equal(trail.p.rain, 1); assert.ok(rainAt(NOISE, trail.cam.lat, trail.cam.lon, cover, force, trail.p.cloudShift) < .1); assert.ok(rainAt(NOISE, ...dn(60), cover, force, trail.p.cloudShift) > .9 && rainAt(NOISE, ...dn(110), cover, force, trail.p.cloudShift) > .5);
  assert.equal(def('cloudShift').value, 0); assert.ok(!def('cloudShift').map, 'a knob of the album, not a switch of the map');
  // in the finishing pass: with the rain only
  const rain = postShader(POST_CLOUDS | POST_RAIN);
  assert.ok(/wxFlakes\(az/.test(rain) && /wxSnowAir\(uEye/.test(rain) && /uSnowF\.w > 0\./.test(rain));
  assert.ok(!/wxFlakes|wxSnowAir\(uEye/.test(postShader(POST_CLOUDS)) && !/wxFlakes/.test(postShader(POST_FOG)));
});

test('weather: a storm cloud from a height, a grey sky from below', () => {
  // from a height: nearer than 60 km no clouds over the map, from 350 km all of them; a cloud that rains is half seen
  // from 120 km down (the map under the rain must be readable) and whole from 200 km — a storm as a satellite sees it
  assert.equal(cloudShow(50), 0); assert.equal(cloudShow(400), 1); assert.equal(rainCloudShow(25), 0);
  assert.ok(rainCloudShow(100) > .3 && rainCloudShow(100) < .6); assert.ok(rainCloudShow(200) > .95 && rainCloudShow(2000) > .95);
  for (let h = 20; h < 2000; h *= 1.2) assert.ok(rainCloudShow(h * 1.2) >= rainCloudShow(h) - 1e-9 && cloudShow(h * 1.2) >= cloudShow(h), `height ${h}`);
  // its lumps are the picture of the clouds read small — no noise counted in the pixel; they do not drown the field itself
  assert.ok(!/vnoise|fbm|worley/.test(cloudShader.replace(/float vnoise[\s\S]*?\n}/, '').split('uniform float uShow')[1]), 'no noise in the shell');
  assert.ok(LUMPS.length === 2 && LUMPS[0][0] < LUMPS[1][0] && MAP_ROUND / LUMPS[0][0] < CLOUD_KM / 8 && MAP_ROUND / LUMPS[1][0] > 100 && LUMPS[0][1] + LUMPS[1][1] < .6);
  // a whole cloud has a lit side and a far side: the field asked a little way toward the Sun; a cloud that rains is dark
  assert.ok(BANK_STEP > 10 && BANK_STEP < 60); assert.match(cloudShader, /float bank = smoothstep\(-\.008, \.06, toSun\)/); assert.match(cloudShader, /\(\.02 \+ \.13 \* smoothstep\(-\.075, \.05, slope\)\)/);
  assert.match(cloudShader, /float cloudTex\(vec2 uv, float lod\)/);
  // from below: the sky under the clouds is a piece of the finishing pass that comes with the clouds, for pixels of sky only
  const clouds = postShader(POST_CLOUDS);
  assert.ok(/uCloud\.x > 0\. && !ground && uRain\.w > 0\./.test(clouds) && /wxCloudN\(mc\.xy/.test(clouds));
  assert.ok(!/wxCloudN\(mc\.xy/.test(postShader(POST_FOG)) && !/wxCloudN\(mc\.xy/.test(postShader(0)));
  // the page: a look along the ground toward the rain
  const pg = page('sky-overcast'), force = def('rainForce').value;
  assert.ok(pg.cam.tilt >= 80 && pg.cam.h <= 30 && pg.cam.heading === 0 && pg.p.rain === 1);
  assert.ok(rainAt(NOISE, pg.cam.lat + .5, pg.cam.lon, rainCover(force), force, pg.p.cloudShift) > .9, 'it rains ahead');
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
  assert.deepEqual(early.cam, late.cam, 'the same place');
  // fog is weather seen from near: whole up to FOG_NEAR km of the camera's height, none from FOG_FAR — the owner,
  // 15.11.2026: from the atmosphere it is not seen
  assert.equal(fogByHeight(20), 1); assert.equal(fogByHeight(FOG_NEAR), 1); assert.equal(fogByHeight(FOG_FAR), 0); assert.equal(fogByHeight(2000), 0);
  for (let h = FOG_NEAR; h < FOG_FAR; h += 10) assert.ok(fogByHeight(h + 10) < fogByHeight(h), `${h}`);
  assert.ok(FOG_NEAR >= 40 && FOG_FAR <= 300); for (const id of ['sky-fog', 'sky-fog-late', 'sky-valley-clouds']) assert.ok(fogByHeight(page(id).cam.h) === 1, id);
  const high = page('sky-fog-high'); assert.ok(high.p.fog === 1 && fogByHeight(high.cam.h) === 0 && fogByHour(high.p.hour, rise) > .9);
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

test('weather: clouds in the mountains — a sea of cloud in the valleys, caps on the crests', () => {
  // a made-up land: a plain at 400 m and a range along 42.5° N whose crest stands at 3000 m, 20 km from its foot
  const land = (lat, lon) => 400 + 2600 * Math.max(0, 1 - Math.abs(lat - 42.5) * 111.2 / 20);
  const ff = fogFloor(land, 8, 2), at = (la, lo) => fogFloorAt(ff, la, lo);
  assert.equal(ff.pw, ff.w * 2); assert.equal(ff.ph, ff.h * 2); assert.equal(ff.peak.length, ff.pw * ff.ph);
  // the crests are kept on a grid twice as fine, as the highest ground of a cell, only a little rounded
  const crest = at(42.5, 0), foot = at(42.0, 0), plain = at(40, 0);
  assert.ok(crest.peak > 2400 && crest.peak <= 3000, `${crest.peak}`); assert.ok(crest.mean < crest.peak - 300 && crest.mean > 1200, `${crest.mean}`); near(plain.peak, 400, 1);
  // a crest wears a cap: high ground that stands well above the land around it; a plain or a low hill does not
  assert.ok(capAt(crest) > .2, `${capAt(crest)}`); assert.equal(capAt(plain), 0); assert.equal(capAt({ peak: 1200, mean: 500 }), 0, 'a low hill'); assert.equal(capAt({ peak: 2600, mean: 2500 }), 0, 'a high plateau');
  near(capAt({ peak: 3200, mean: 2000 }), 1, 1e-9); assert.ok(capAt(foot) < capAt(crest));
  assert.ok(CAP_CREST[0] < CAP_CREST[1] && CAP_HIGH[0] >= 1200 && CAP_HIGH[1] <= 2500 && CAP_UNDER > 100 && CAP_OVER > 100 && CAP_UNDER + CAP_OVER < 1000);
  // more of the knob «Облачность»: more crests in caps
  assert.ok(capBank(.2) > capBank(.9) && capBank(1) > .2 && capBank(.05) < .7);
  // the cloud of a mountain valley fills the way from the floor of the land nearly to its mean height: the crests stay out
  assert.ok(HILL_FILL > .5 && HILL_FILL <= 1.5 && HILL_FROM >= 200); assert.ok(crest.floor + HILL_FILL * (crest.mean - crest.floor - HILL_FROM) < crest.peak - 150, `${crest.floor} ${crest.mean} ${crest.peak}`);
  // (a plain keeps its fog as it was: its relief is under HILL_FROM)
  assert.ok(plain.mean - plain.floor < HILL_FROM);
  // the pieces of the shader: both come with the walk of the fog
  const fog = postShader(POST_FOG);
  assert.ok(/wxFogTop\(P\.xz/.test(fog) && /wxCap\(qf\)/.test(fog) && /uLow\.w > 0\./.test(fog) && /uLow\.y > 0\. && f0\.a > 650\./.test(fog)); assert.ok(!/wxCap\(qf\)/.test(postShader(POST_CLOUDS)));
  assert.match(WEATHER, /uLow\.x \* max\(f\.a - f\.r - 300\.0, 0\.\)/);
  // the pages
  const sea = page('sky-valley-clouds'), caps = page('sky-caps'), rise = sunTimes(172, sea.cam.lat).rise;
  assert.ok(sea.p.fog === 1 && fogByHour(sea.p.hour, rise) > .9 && !sea.p.clouds); assert.ok(caps.p.clouds === 1 && !caps.p.fog && caps.cam.h <= 30);
});

test('weather: nothing of it in the shaders of the land, and nothing at all while it is off', () => {
  // the shared light, which every shader of the land pastes, knows no weather and reads no texture
  assert.ok(!/sampler|albumCloud|wxRain|wxFog|tCloud|tFog/.test(LIGHT)); assert.equal(sky.glsl, '', 'the sky paints nothing in the ground shader');
  for (const k of ['tCloud', 'tFog', 'tPeak', 'tClim', 'uRain', 'uGrow', 'uSunMap', 'uFog', 'uFogRect', 'uSnowF', 'uLow']) assert.ok(!(k in sky.uniforms), `${k} is not among the uniforms of the ground`);
  // the GLSL of the weather: what post.js and layers/clouds.js call
  for (const sig of ['vec4 wxMap(vec3 P)', 'vec4 wxMapOf(vec3 wpos)', 'float wxPolar(float s)', 'vec2 wxClim(vec4 m)', 'vec2 wxPlane(vec3 wpos)', 'float wxCloudN(vec2 q, float lod)', 'float wxThr(float c)', 'float albumCloudField(vec3 wpos)', 'float albumCloudShade(vec3 wpos)',
    'float wxCells(vec2 q)', 'float wxRainMask(vec2 q, float will)', 'float wxBase(vec2 q, float lod)', 'float wxGrow(vec2 q, float lod)', 'float wxRainCloud(vec2 q, float thr, float g, float lod)', 'float wxRainAt(vec4 m, float lod)', 'float wxFogTop(vec2 q)', 'vec2 wxCap(vec2 q)', 'float wxSnowLine(float s)', 'float wxSnowy(float s, float alt)',
    'float wxSnowAir(vec3 wpos)']) assert.ok(WEATHER.includes(sig), sig);
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
  assert.ok(/wxLines\(az/.test(rain) && /wxRainCloud\(q0, thw, gw, pol\)/.test(rain) && /albumCloudShade\(wpos\)/.test(rain) && !/wxFogTop\(P/.test(rain));
  assert.ok(/wxFogTop\(P/.test(fog) && !/wxLines|albumCloudShade\(wpos\)/.test(fog));
  // the picture of the clouds, once asked for: repeating, one byte a point
  needClouds(); const t = WX.tCloud.value; assert.ok(t && t.image.width === CLOUD_N && t.image.data.length === CLOUD_N * CLOUD_N); needClouds(); assert.equal(WX.tCloud.value, t, 'built once');
});
