// The weather of the album (docs/album/sky.md, «Погода»): where the clouds stand, where it rains under them, and
// where the fog of the morning lies. Nothing of it is counted in the shaders of the land: the clouds are a shell
// drawn over the finished picture (layers/clouds.js), and their shadows, the rain and the fog are laid over the
// finished picture by the finishing pass (post.js), from the depth of every pixel.
//
// The clouds and the rain cover the whole Earth. They are laid out on a map of the whole Earth (mapOf below) that fits
// the album at its middle, and three reads of one small picture of noise make them:
//   the clouds        the picture itself, carried by the wind
//   growing, melting  the same picture read larger, sliding the other way: where the two add up there is cloud, and
//                     as they slide past each other a cloud appears out of a clear sky, grows, and melts away
//   the cells of rain the same picture read larger still, moving slower than the clouds: a cloud that comes into a
//                     cell rains, and stops when it has left it
// How much cloud a place has, and how willingly its clouds rain, goes by its climate: the precipitation of the month
// (the open climate of the world, public/assets/climate/normals-open.bin.gz), in a small picture tClim.
//
// The fog, the cloud of the mountain valleys and the caps of the crests belong to the album's own piece of land (the
// polygon): they lie on a plane that touches the globe at its middle (planeOf), over a picture of the floor of the
// land (tFog) and of its crests (tPeak).
// All pictures are built on the first frame that needs them; while the weather is off they do not exist.
import { DataTexture, RedFormat, RGBAFormat, UnsignedByteType, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, ClampToEdgeWrapping, DataUtils, Vector2, Vector4 } from 'three';
import { R, BBOX, CENTRE, KM_PER_DEG, COS_REF, toWorld, fromWorld, wrapLon } from '../geo.js';

const D = Math.PI / 180;
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }, mix = (a, b, t) => a + (b - a) * t;

// ---- the plane of the album's own land: it touches the globe at the middle of the map; km east and km south
export function planeOf(lat, lon) { const v = toWorld(lat, lon, 0), k = R / (v.y + R); return [v.x * k, v.z * k]; }
export function llOfPlane(x, z) { const s = R / Math.hypot(x, R, z); return fromWorld({ x: x * s, y: R * s - R, z: z * s }); }

// ---- the map of the weather: the whole Earth
// A Mercator map, scaled so that at the middle of the album one km of it is one km of the ground, with that middle
// at (0, 0): x km east, y km south. Near the middle it is the plane above (they part by a few km in 500); around
// the Earth it closes on itself after MAP_ROUND km. Toward the poles the map stretches, so what is laid out on it
// evenly — the clouds — comes out smaller on the ground there: by the cosine of the latitude.
export const MAP_K = R * COS_REF, MAP_ROUND = 2 * Math.PI * MAP_K;
const MAP_Y0 = Math.atanh(Math.sin(CENTRE.lat * D)) * MAP_K, LAT_END = 89.5;
export function mapOf(lat, lon) { return [wrapLon(lon - CENTRE.lon) * D * MAP_K, MAP_Y0 - Math.atanh(Math.sin(Math.max(-LAT_END, Math.min(LAT_END, lat)) * D)) * MAP_K]; }
export function llOfMap(x, y) { return { lat: Math.asin(Math.tanh((MAP_Y0 - y) / MAP_K)) / D, lon: wrapLon(CENTRE.lon + x / MAP_K / D) }; }
// the three directions the shaders find a place of the map by: the axis of the Earth, and the places on the equator
// at the longitude of the middle of the album and 90° east of it — as directions of the world
const dirOf = (lat, lon) => { const v = toWorld(lat, lon, 0); return [v.x / R, (v.y + R) / R, v.z / R]; };
export const MAP_AXIS = dirOf(90, 0), MAP_E0 = dirOf(0, CENTRE.lon), MAP_E1 = dirOf(0, CENTRE.lon + 90);

// the tangent of the longitude (from the meridian of the album) up to which the shaders count the map by a series
export const MAP_NEAR = .36;

// ---- the field of the clouds
export const CLOUD_N = 1024;
// how many times each read of the picture repeats around the Earth: the clouds, what makes them grow and melt, the
// cells of rain. Whole numbers: the map closes on itself without a seam. Clouds of about 300, 110 and 45 km.
export const ROUND = [4, 3, 2];
export const CLOUD_KM = MAP_ROUND / ROUND[0], GROW_KM = MAP_ROUND / ROUND[1], CELL_KM = MAP_ROUND / ROUND[2];
// The second read is a soft one — the picture two levels of detail down, where only its large shapes are left
// (GROW_DEV: the deviation of the picture read so) — so that whole clouds come and go, and their small parts do not
// flicker. GROW: how much it adds to the first; FIELD_DEV: the deviation of their sum around .5.
export const GROW = .6, GROW_LOD = 3, GROW_DEV = .109, FIELD_DEV = Math.hypot(.125, GROW * GROW_DEV);
// The wind carries the clouds toward the east-north-east: (east, south) of one km of the way. The read that makes
// them grow and melt slides the other way, half as fast; the cells of rain follow the clouds at two thirds of
// their speed. (All three in km of the map for one km of the wind's way.)
export const WIND = [.924, -.383], GROW_WIND = [-.42, .31], CELL_WIND = [.62, -.2];
// how far each has gone after `drift` km of the way: what uCloud.yz and uGrow hold
export const cloudOffset = drift => [-drift * WIND[0] - 37, -drift * WIND[1] + 11];
export const growOffset = drift => [-drift * GROW_WIND[0] + 2051, -drift * GROW_WIND[1] + 977];
export const cellOffset = drift => [-drift * CELL_WIND[0], -drift * CELL_WIND[1]];
// its three sizes of cloud: how many cells of noise in one side of the picture, and their weight
const OCTAVES = [[26, .46], [70, .32], [174, .22]];
function mulberry(seed) { return () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// The picture itself, one byte a point: smooth noise (gradient noise, so that no square grain shows) whose left edge
// continues its right one and its top its bottom. Its values are spread around .5 with a deviation of .125 whatever
// the dice say, so that the knob «Облачность» always means the same share of the sky.
export function cloudNoise(N = CLOUD_N, seed = 20261114) {
  const f = new Float32Array(N * N), rnd = mulberry(seed), fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  for (const [cells, weight] of OCTAVES) {
    const gx = new Float32Array(cells * cells), gy = new Float32Array(cells * cells);
    for (let i = 0; i < gx.length; i++) { const a = rnd() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
    const i0 = new Int32Array(N), i1 = new Int32Array(N), fr = new Float32Array(N), fu = new Float32Array(N);
    for (let i = 0; i < N; i++) { const x = (i + .5) * cells / N, c = Math.floor(x); i0[i] = c % cells; i1[i] = (c + 1) % cells; fr[i] = x - c; fu[i] = fade(x - c); }
    for (let j = 0; j < N; j++) {
      const r0 = i0[j] * cells, r1 = i1[j] * cells, fy = fr[j], v = fu[j];
      for (let i = 0; i < N; i++) {
        const a = i0[i], b = i1[i], fx = fr[i], u = fu[i];
        const p = gx[r0 + a] * fx + gy[r0 + a] * fy, q = gx[r0 + b] * (fx - 1) + gy[r0 + b] * fy;
        const s = gx[r1 + a] * fx + gy[r1 + a] * (fy - 1), t = gx[r1 + b] * (fx - 1) + gy[r1 + b] * (fy - 1);
        f[j * N + i] += weight * mix(mix(p, q, u), mix(s, t, u), v);
      }
    }
  }
  let m = 0, d = 0; for (let i = 0; i < f.length; i++) m += f[i]; m /= f.length;
  for (let i = 0; i < f.length; i++) d += (f[i] - m) ** 2; d = Math.sqrt(d / f.length) || 1;
  const out = new Uint8Array(N * N);
  for (let i = 0; i < f.length; i++) out[i] = Math.max(0, Math.min(255, Math.round((.5 + (f[i] - m) / d * .125) * 255)));
  return out;
}
// the picture read as a texture reads it: (u, v) in sides of the picture, repeating
function fieldAt(noise, tu, tv) {
  const N = Math.round(Math.sqrt(noise.length)), wrap = k => ((k % N) + N) % N;
  const u = tu * N - .5, v = tv * N - .5, i = Math.floor(u), j = Math.floor(v), fx = u - i, fy = v - j, at = (a, b) => noise[wrap(b) * N + wrap(a)] / 255;
  return mix(mix(at(i, j), at(i + 1, j), fx), mix(at(i, j + 1), at(i + 1, j + 1), fx), fy);
}
// the picture GROW_LOD levels of detail down, as the graphics card keeps it: every point the mean of a square of points
const softs = new WeakMap();
export function softNoise(noise) {
  if (softs.has(noise)) return softs.get(noise);
  const N = Math.round(Math.sqrt(noise.length)), k = 1 << GROW_LOD, M = N / k, out = new Float32Array(M * M);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) { let s = 0; for (let b = 0; b < k; b++) for (let a = 0; a < k; a++) s += noise[(j * k + b) * N + i * k + a]; out[j * M + i] = s / (k * k); }
  softs.set(noise, out); return out;
}
// the field at a place of the map, around .5, as the shaders read it (wxCloudN): the clouds and what makes them grow
// and melt; for the tests and for choosing the pages
export function cloudAt(noise, x, y, drift = 0) {
  const o = cloudOffset(drift), g = growOffset(drift);
  return fieldAt(noise, (x + o[0]) / CLOUD_KM, (y + o[1]) / CLOUD_KM) + (fieldAt(softNoise(noise), (x + g[0]) / GROW_KM, (y + g[1]) / GROW_KM) - .5) * GROW;
}
// the cells of rain at a place of the map, 0..1 around .5 (wxRainMask reads the same)
export const RAIN_SHIFT = [.16, .16];
export function cellAt(noise, x, y, drift = 0) { const c = cellOffset(drift); return fieldAt(noise, (x + c[0]) / CELL_KM + RAIN_SHIFT[0], (y + c[1]) / CELL_KM + RAIN_SHIFT[1]); }
// The rules the shaders and the tests share. The field above the threshold is cloud; the knob «Облачность» at .45
// leaves about a quarter of the sky under cloud, at .8 three quarters.
export const cloudThreshold = cover => .5 + FIELD_DEV * (2.4 - 4 * cover);
// With the rain on, the sky is at least this cloudy. Not every cloud rains: only those that stand in a cell of rain —
// where the cells are above rainMask(). A cloud that rains, rains nearly to its edge: only so can its curtain of rain
// be seen under it from the side.
export const rainCover = force => .4 + .2 * force, rainMask = force => mix(.68, .46, force);
export const RAIN_EDGE = .02;
// how far behind its cloud the rain reaches the ground, km (the cloud moves on while the drops fall)
export const RAIN_LAG = 7;

// ---- the climate of a place
// The knob «Облачность» rests at COVER_REST; a place whose climate has other than that much cloud has the knob's
// value moved by the difference. The clouds of a place whose climate is wetter than WILL_REST rain more willingly.
export const COVER_REST = .45, WILL_REST = .2, WILL_GAIN = .35;
// the share of the sky under cloud by the precipitation of the month, mm: a desert 6 %, Spain in June a quarter,
// the north Atlantic three quarters, the rain belt of the tropics six sevenths
export const skyShare = mm => .06 + .8 * (1 - Math.exp(-mm / 55));
// the inverse of the normal distribution (Abramowitz and Stegun 26.2.23, good to 5e-4)
function probit(p) {
  const q = Math.min(p, 1 - p), t = Math.sqrt(-2 * Math.log(Math.max(q, 1e-9)));
  const x = t - (2.515517 + .802853 * t + .010328 * t * t) / (1 + 1.432788 * t + .189269 * t * t + .001308 * t * t * t);
  return p < .5 ? -x : x;
}
// the value of the knob that leaves that share of the sky under cloud (the inverse of cloudThreshold)
export const coverOfShare = share => (2.4 - probit(1 - share)) / 4;
// how willingly the clouds of a place rain, 0..1, by the precipitation of the month
export const rainWill = mm => 1 - Math.exp(-mm / 120);
// the cover at a place: the knob moved by the climate there (clim: { cover, will } or nothing — the knob alone)
export const coverAt = (knob, clim) => (clim ? Math.max(.02, Math.min(1, clim.cover + knob - COVER_REST)) : knob);
export const rainMaskAt = (force, clim) => rainMask(force) + (clim ? (WILL_REST - clim.will) * WILL_GAIN : 0);
// The picture of the climate for a day of the year: CLIM_W × CLIM_H, RGBA bytes — R the cover, G the rain will. Rows
// go by the sine of the latitude (row 0 at the north pole), so the shaders find a place without an arcsine; columns
// from 180° W. prec: the monthly precipitation of the open climate (Uint16, 12 × 360 × 720, row 0 at 90° N, column 0
// at 180° W); between the middles of two months the two are mixed.
export const CLIM_W = 360, CLIM_H = 180;
export function climatePicture(prec, yday = 172, W = 720, H = 360) {
  const mf = ((yday - 15.2) / 30.4375 % 12 + 12) % 12, m0 = Math.floor(mf), m1 = (m0 + 1) % 12, k = mf - m0, out = new Uint8Array(CLIM_W * CLIM_H * 4);
  for (let j = 0; j < CLIM_H; j++) {
    const lat = Math.asin(1 - 2 * (j + .5) / CLIM_H) / D, y = Math.max(0, Math.min(H - 1, Math.floor((90 - lat) / 180 * H)));
    for (let i = 0; i < CLIM_W; i++) {
      // (the mean of the cells of the climate that fall into one point of the picture, along the parallel)
      let a = 0, b = 0, n = 0;
      for (let x = Math.floor(i * W / CLIM_W); x < Math.floor((i + 1) * W / CLIM_W); x++) { a += prec[m0 * W * H + y * W + x]; b += prec[m1 * W * H + y * W + x]; n++; }
      const mm = mix(a, b, k) / n, o = (j * CLIM_W + i) * 4;
      out[o] = Math.round(coverOfShare(skyShare(mm)) * 255); out[o + 1] = Math.round(rainWill(mm) * 255); out[o + 3] = 255;
    }
  }
  return out;
}
// where a place is in that picture, in sides of it; and the climate read there as the shaders read it (for the tests)
export const climUV = (lat, lon) => [(wrapLon(lon) + 180) / 360, .5 - .5 * Math.sin(lat * D)];
export function climateAt(pic, lat, lon) {
  const [u, v] = climUV(lat, lon), x = u * CLIM_W - .5, y = Math.max(0, Math.min(CLIM_H - 1, v * CLIM_H - .5)), i = Math.floor(x), j = Math.min(CLIM_H - 2, Math.floor(y)), fx = x - i, fy = y - j;
  const at = (a, b, c) => pic[(b * CLIM_W + ((a % CLIM_W) + CLIM_W) % CLIM_W) * 4 + c] / 255, rd = c => mix(mix(at(i, j, c), at(i + 1, j, c), fx), mix(at(i, j + 1, c), at(i + 1, j + 1, c), fx), fy);
  return { cover: rd(0), will: rd(1) };
}
// how hard it rains on the ground at a place, 0..1 (wxRainAt in the shaders); clim: the climate there, if it counts
export function rainAt(noise, lat, lon, cover, force, drift = 0, clim) {
  const p = mapOf(lat, lon), x = p[0] + WIND[0] * RAIN_LAG, y = p[1] + WIND[1] * RAIN_LAG, t = cloudThreshold(coverAt(cover, clim)) + RAIN_EDGE, m = rainMaskAt(force, clim);
  return ss(t, t + .08, cloudAt(noise, x, y, drift)) * ss(m, m + .08, cellAt(noise, x, y, drift));
}

// ---- the thunderstorm
// Lightning lights a storm cloud from inside. The cloud is cut in cells STORM_KM across (they go with the clouds);
// every STORM_EVERY seconds half of the cells flash, each at its own moment, for STORM_FLASH of that time: a quick
// double flicker, brightest at the middle of the cell. In a still capture a flash lasts STORM_STILL of the time, so
// that a picture has some to show.
export const STORM_KM = 90, STORM_EVERY = 6, STORM_FLASH = .05, STORM_STILL = .45;
// is the cell of a place flashing at a time, 0 or the strength of the flicker (wxFlash without the fall toward the
// edge of the cell); hash: the hash of the cell, 0..1; pick: the dice of this period, 0..1
export function flashAt(time, hash, pick, share = STORM_FLASH) {
  const k = (((time / STORM_EVERY + hash * 61) % 1) + 1) % 1;
  return k > share || pick < .5 ? 0 : .5 + .5 * (((k / share * 2.5 + hash * 3) % 1) >= .5 ? 1 : 0);
}

// ---- snowfall
// What falls from a cloud is snow where the ground stands above the line of snowfall, and rain below it. That line
// is the line of lasting snow of the ground shader (terrain.js: 2980 m at 37° N, 55 m lower with every degree north,
// moved by the look of the map and by the knob «Снеговая линия»), lowered by SNOW_DROP: a snow cloud brings its own
// cold, and fresh snow lies well below the snow that lasts the summer. Over half of SNOW_BAND the snow turns to rain.
// South of the equator the line goes by the latitude the same way (by its distance from the equator).
export const SNOW_DROP = 900, SNOW_BAND = 120;
export const snowLine = (lat, shift = 0) => 2980 - (Math.abs(lat) - 37) * 55 + shift;
export const snowfallLine = (lat, shift = 0) => snowLine(lat, shift) - SNOW_DROP;
// how much of what falls at a place is snow, 0 rain .. 1 snow (wxSnowy in the shaders); height in m
export const snowShare = (lat, height, shift = 0) => ss(-SNOW_BAND, SNOW_BAND, height - snowfallLine(lat, shift));
// the same line for the shaders: its height at the equator, how much it falls with every degree of latitude, and
// the band — all in km of the world (heights there are stretched `exag` times)
export const snowNumbers = (shift, exag) => [snowfallLine(0, shift) * exag / 1000, 55 * exag / 1000, SNOW_BAND * exag / 1000];

// ---- the fog of the morning
// How much of the fog is left at an hour of the day, 0..1: it gathers through the night, is thickest at dawn, thins
// from an hour and a half after sunrise and is gone by noon. Hour 0 is the light of the map, not midnight: there the
// fog lies as on a morning, so that the switch always shows something.
export function fogByHour(hour, rise = 6) {
  if (!hour) return 1;
  const h = ((hour % 24) + 24) % 24, clear = Math.max(12, rise + 4);
  if (h >= rise - 3 && h <= clear) return 1 - ss(rise + 1.5, clear, h);
  return ss(20.5, 26, h < rise ? h + 24 : h);
}
// Fog is weather seen from near (the owner, 15.11.2026: «из атмосферы… так не происходит»): from FOG_NEAR km of the
// camera's height it thins, and from FOG_FAR km there is none.
export const FOG_NEAR = 70, FOG_FAR = 260;
export const fogByHeight = h => 1 - ss(FOG_NEAR, FOG_FAR, h);
// the numbers of the fog for the shaders, from how much of it there is (0..1): how thick its layer may be (m of real
// height), from which value of the field of its banks it lies, and how soft its top is (m)
export const fogNumbers = amount => ({ thick: amount * (110 + 190 * amount), bank: mix(.62, .18, amount), soft: 14 + 30 * amount });

// The floor of the land for the fog, on a grid over the map: for every cell the lowest ground around it (smoothed),
// m over the sea, and how willingly fog gathers there: 1 on the land .. 1.25 in a deep valley; over the sea .9 at the
// coast, falling to nothing 40 km out (sea fog lies in banks along the shore, not over the whole sea).
// at(lat, lon) gives the height of the ground in m (under the sea negative).
export function fogFloor(at, cell = 4, sub = 4, box = BBOX) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const la of [box.lat0, (box.lat0 + box.lat1) / 2, box.lat1]) for (const lo of [box.lon0, (box.lon0 + box.lon1) / 2, box.lon1]) {
    const [x, z] = planeOf(la, lo); x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  const w = Math.ceil((x1 - x0) / cell), h = Math.ceil((z1 - z0) / cell), n = w * h;
  let low = new Float32Array(n), mean = new Float32Array(n), sea = new Float32Array(n);
  // (and, on a grid twice as fine, the highest ground of every cell: the crests, for the caps of cloud they wear)
  const pw = w * 2, ph = h * 2, peak = new Float32Array(pw * ph), half = sub / 2;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let lo = Infinity, m = 0, s = 0;
    for (let b = 0; b < sub; b++) for (let a = 0; a < sub; a++) {
      const ll = llOfPlane(x0 + (i + (a + .5) / sub) * cell, z0 + (j + (b + .5) / sub) * cell), g = at(ll.lat, ll.lon), g0 = Math.max(g, 0);
      if (g0 < lo) lo = g0; m += g0; if (g <= 0) s++;
      const pi = (j * 2 + (b >= half ? 1 : 0)) * pw + i * 2 + (a >= half ? 1 : 0); if (g0 > peak[pi]) peak[pi] = g0;
    }
    low[j * w + i] = lo; mean[j * w + i] = m / (sub * sub); sea[j * w + i] = s / (sub * sub);
  }
  // one pass along the rows and one along the columns: the lowest, or the mean, of the cells within r of each
  const pass = (src, r, min) => {
    const tmp = new Float32Array(n), out = new Float32Array(n);
    for (const [a, b, len, lines, stride, step] of [[src, tmp, w, h, w, 1], [tmp, out, h, w, 1, w]]) {
      for (let l = 0; l < lines; l++) for (let k = 0; k < len; k++) {
        let acc = min ? Infinity : 0, c = 0;
        for (let d = -r; d <= r; d++) { const kk = k + d; if (kk < 0 || kk >= len) continue; const v = a[l * stride + kk * step]; if (min) { if (v < acc) acc = v; } else { acc += v; c++; } }
        b[l * stride + k * step] = min ? acc : acc / c;
      }
    }
    return out;
  };
  // (the lowest ground within 24 km: over a wide basin the top of the fog is then nearly level, and the land rising
  // away from the river comes out of it along its own contour — which is what gives fog its shape from above)
  const r8 = Math.max(1, Math.round(8 / cell)), r12 = Math.max(1, Math.round(12 / cell)), r24 = Math.max(1, Math.round(24 / cell));
  const open = pass(sea, Math.max(1, Math.round(40 / cell)), false);          // how much of the 40 km around is sea
  low = pass(pass(pass(low, r24, true), r12, false), r12, false); mean = pass(mean, Math.round(16 / cell) || 1, false); sea = pass(sea, r8, false);
  const weight = new Float32Array(n);
  for (let i = 0; i < n; i++) weight[i] = mix(1 + .25 * Math.max(0, Math.min(1, (mean[i] - low[i] - 60) / 340)), .9 * Math.min(1, (1 - open[i]) * 2.2), sea[i]);
  // (the crests a little rounded — the mean of a cell and its neighbours: a cap of cloud is not cut in facets)
  const round = new Float32Array(pw * ph);
  for (let j = 0; j < ph; j++) for (let i = 0; i < pw; i++) {
    let s = 0, c = 0;
    for (let b = Math.max(0, j - 1); b <= Math.min(ph - 1, j + 1); b++) for (let a = Math.max(0, i - 1); a <= Math.min(pw - 1, i + 1); a++) { s += peak[b * pw + a]; c++; }
    round[j * pw + i] = s / c;
  }
  return { w, h, cell, x0, z0, floor: low, weight, sea, mean, peak: round, pw, ph };
}
// the floor and the willingness at a place, as the shader reads them (for the tests)
export function fogFloorAt(ff, lat, lon) {
  const [x, z] = planeOf(lat, lon), i = Math.max(0, Math.min(ff.w - 1, Math.floor((x - ff.x0) / ff.cell))), j = Math.max(0, Math.min(ff.h - 1, Math.floor((z - ff.z0) / ff.cell)));
  const pi = Math.max(0, Math.min(ff.pw - 1, Math.floor((x - ff.x0) / ff.cell * 2))), pj = Math.max(0, Math.min(ff.ph - 1, Math.floor((z - ff.z0) / ff.cell * 2)));
  return { floor: ff.floor[j * ff.w + i], weight: ff.weight[j * ff.w + i], sea: ff.sea[j * ff.w + i], mean: ff.mean[j * ff.w + i], peak: ff.peak[pj * ff.pw + pi] };
}
// ---- clouds in the mountains
// With the fog on, the deep valleys of the mountains fill with cloud: to the layer of the fog is added HILL_FILL (at the
// most, from a fog of .7) of what the relief of the place — its mean height over its floor — has above HILL_FROM m.
// So a plain and a wide river valley keep their fog as it was, and in the mountains the cloud stands about up to the
// mean height of the land: the crests stand out of a sea of cloud. With the clouds on, a high crest wears a cap of
// cloud: a crest is ground that stands CAP_CREST[0]..[1] m above the mean of the land around it and
// CAP_HIGH[0]..[1] m above the sea; the cap lies from CAP_UNDER m below the crest to CAP_OVER m above it. Not every
// crest has one: only where the field of the banks is above capBank(cover).
export const HILL_FILL = 1.2, HILL_FROM = 300, CAP_CREST = [250, 600], CAP_HIGH = [1500, 2100], CAP_UNDER = 260, CAP_OVER = 240;
export const capBank = cover => mix(.60, .30, cover);
// how much of a cap the crest at a place may wear, 0..1 (before the banks), by the heights from fogFloorAt
export const capAt = f => ss(CAP_CREST[0], CAP_CREST[1], f.peak - f.mean) * ss(CAP_HIGH[0], CAP_HIGH[1], f.peak);
// the banks of the fog and of the caps are the picture of the clouds read at this size on the plane (it does not
// move with the wind, and has nothing to do with the map of the whole Earth)
export const BANK_KM = 8192;

// ---- what the shaders get
// uRain: x how hard it rains (0 = no rain) .. 1, y which cells rain (rainMask), z the time for the falling lines (s),
//        w how much of the lines of rain to show (1 near the ground .. 0 from a height).
// uGrow: xy how far the read that makes the clouds grow and melt has slid, zw how far the cells of rain have gone (km
//        of the map; where the clouds themselves are is uCloud.yz of the light).
// uFog:  x 1 while there is fog, y the greatest thickness of its layer (km of the world), z from which value of the
//        field of its banks it lies, w how soft its top is (km of the world).
// uFogRect: where tFog lies on the plane: (x0, z0, 1 / width, 1 / height), km.
// uSnowF: the line of snowfall (snowNumbers): x its height at the equator, y its fall with every degree of latitude,
//        z its band, all in km of the world; w 1 while precipitation can be snow.
// uLow:  the low clouds: x how much of the relief the cloud of a mountain valley fills (of the way from the floor of
//        the land to its mean height), y 1 while high crests wear caps of cloud, z from which value of the field of
//        the banks a crest has its cap, w 1 while there is fog itself. (uFog.x is 1 while there is fog or caps.)
// uStorm: x 1 while there is a thunderstorm, y its time (s), z how much of the time between two flashes a flash lasts.
// uSunMap: which way the Sun is on the map of the weather, at the place the camera looks at: (east, south), a unit vector.
// tPeak: the highest ground of every 2 km, m: the crests (laid over the same rect as tFog).
// tClim: the climate (climatePicture): until the open climate is read, one point that says «as the knobs say».
export const WX = { tCloud: { value: null }, tFog: { value: null }, tPeak: { value: null }, tClim: { value: null }, uFogRect: { value: new Vector4(0, 0, 1, 1) }, uRain: { value: new Vector4(0, .2, 0, 1) },
  uGrow: { value: new Vector4(2051, 977, 0, 0) }, uSunMap: { value: new Vector2(-.74, -.67) }, uStorm: { value: new Vector4(0, 0, STORM_FLASH, 0) }, uFog: { value: new Vector4(0, .3, .5, .05) }, uSnowF: { value: new Vector4(9, 0, .2, 0) }, uLow: { value: new Vector4(0, 0, .5, 0) } };
const climTexture = (data, w, h) => {
  const t = new DataTexture(data, w, h, RGBAFormat, UnsignedByteType);
  t.wrapS = RepeatWrapping; t.wrapT = ClampToEdgeWrapping; t.magFilter = t.minFilter = LinearFilter; t.needsUpdate = true; return t;
};
// builds the pictures when they are first needed
export function needClouds() {
  if (WX.tCloud.value) return;
  const t = new DataTexture(cloudNoise(), CLOUD_N, CLOUD_N, RedFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping; t.magFilter = LinearFilter; t.minFilter = LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  WX.tCloud.value = t;
  if (!WX.tClim.value) WX.tClim.value = climTexture(new Uint8Array([Math.round(COVER_REST * 255), Math.round(WILL_REST * 255), 0, 255]), 1, 1);
}
// The climate for the clouds: the open climate of the world is read once (4 MB), and its picture made again when the
// day of the year moves into another fortnight. Until it has come — and if it does not come — the weather goes by the
// knobs alone. fetchPrec(): a promise of the monthly precipitation (Uint16Array, 12 × 360 × 720).
const clim = { prec: null, asked: false, key: -1 };
export function needClimate(yday, fetchPrec) {
  if (!clim.asked) { clim.asked = true; fetchPrec().then(p => { clim.prec = p; clim.key = -1; }).catch(e => console.warn('[album] no climate for the clouds:', e.message || e)); }
  const key = Math.floor(yday / 15);
  if (!clim.prec || key === clim.key) return;
  clim.key = key; const old = WX.tClim.value; WX.tClim.value = climTexture(climatePicture(clim.prec, key * 15 + 7), CLIM_W, CLIM_H); old?.dispose?.();
  clim.pic = WX.tClim.value.image.data;
}
// the climate at a place as the clouds have it now (nothing until the open climate has come)
export const climateNow = (lat, lon) => (clim.pic ? climateAt(clim.pic, lat, lon) : null);
// the monthly precipitation out of the file of the open climate (gunzipped ArrayBuffer; normals.json: prec at 6 220 800)
export const precOf = buf => new Uint16Array(buf.slice(6220800, 12441600));
export function needFog(at) {
  if (WX.tFog.value) return;
  const ff = fogFloor(at), hf = new Uint16Array(ff.w * ff.h * 4);
  for (let i = 0; i < ff.w * ff.h; i++) { hf[i * 4] = DataUtils.toHalfFloat(ff.floor[i]); hf[i * 4 + 1] = DataUtils.toHalfFloat(ff.weight[i]); hf[i * 4 + 2] = DataUtils.toHalfFloat(ff.sea[i]); hf[i * 4 + 3] = DataUtils.toHalfFloat(ff.mean[i]); }
  const t = new DataTexture(hf, ff.w, ff.h, RGBAFormat, HalfFloatType);
  t.internalFormat = 'RGBA16F'; t.wrapS = t.wrapT = ClampToEdgeWrapping; t.magFilter = t.minFilter = LinearFilter; t.needsUpdate = true;
  WX.tFog.value = t; WX.uFogRect.value.set(ff.x0, ff.z0, 1 / (ff.w * ff.cell), 1 / (ff.h * ff.cell));
  const pk = new Uint16Array(ff.pw * ff.ph); for (let i = 0; i < pk.length; i++) pk[i] = DataUtils.toHalfFloat(ff.peak[i]);
  const tp = new DataTexture(pk, ff.pw, ff.ph, RedFormat, HalfFloatType);
  tp.internalFormat = 'R16F'; tp.wrapS = tp.wrapT = ClampToEdgeWrapping; tp.magFilter = tp.minFilter = LinearFilter; tp.needsUpdate = true;
  WX.tPeak.value = tp;
}

// ---- the GLSL of the weather: pasted after COMMON and LIGHT (it uses RKM, uExag, uCloud, uSun, uSunW, albumDay)
const v3 = a => `vec3(${a.map(x => x.toFixed(6)).join(', ')})`, f1 = x => x.toFixed(1), thrA = .5 + FIELD_DEV * 2.4, thrB = FIELD_DEV * 4;
export const WEATHER = /* glsl */`
uniform sampler2D tCloud, tFog, tPeak, tClim; uniform vec4 uRain, uGrow, uFog, uFogRect, uSnowF, uLow, uStorm; uniform vec2 uSunMap;
const vec2 WX_WIND = vec2(${WIND[0].toFixed(4)}, ${WIND[1].toFixed(4)});
#define RAIN_LAG ${f1(RAIN_LAG)}
#define MAP_ROUND ${MAP_ROUND.toFixed(3)}
const vec3 WX_AXIS = ${v3(MAP_AXIS)}, WX_E0 = ${v3(MAP_E0)}, WX_E1 = ${v3(MAP_E1)};
// A place of the world (P: from the centre of the Earth) on the map of the weather. xy: km east and south on a
// Mercator map of the whole Earth that fits the album at its middle; z: where the place is in the picture of the
// climate, around the Earth (0..1 from 180° W); w: the sine of its latitude.
vec4 wxMap(vec3 P) {
  vec3 e = normalize(P); float s = clamp(dot(e, WX_AXIS), -.99996, .99996), x = dot(e, WX_E0), y = dot(e, WX_E1), t = y / max(x, 1e-6);
  // (within 20° of the meridian of the album — over the album itself and well around it — the arctangent is a short
  // series, good to a twentieth of a km of the map; an arctangent in every pixel is what the weather cost most)
  float lon = x > 0. && abs(t) < ${MAP_NEAR.toFixed(2)} ? t * (1. - t * t * (.3333333 - t * t * (.2 - t * t * .1428571))) : atan(y, x);
  return vec4(lon * ${MAP_K.toFixed(3)}, ${MAP_Y0.toFixed(3)} - atanh(s) * ${MAP_K.toFixed(3)}, lon * .15915494 + ${((CENTRE.lon + 180) / 360).toFixed(6)}, s);
}
vec4 wxMapOf(vec3 wpos) { return wxMap(wpos + vec3(0., RKM, 0.)); }
// how many times smaller than on the map things are on the ground at a latitude (s: its sine), as a level of detail:
// toward the poles the field is read softer, so that its clouds do not turn to grain there
// (nothing to count on the album's own side of the latitude of its middle)
float wxPolar(float s) { return abs(s) > ${Math.sin(CENTRE.lat * D).toFixed(5)} ? -.5 * log2(max(1. - s * s, 1e-4)) - ${(-Math.log2(COS_REF)).toFixed(4)} : 0.; }
// the climate of the place: x the cover, y how willingly its clouds rain
vec2 wxClim(vec4 m) { return textureLod(tClim, vec2(m.z, .5 - .5 * m.w), 0.).rg; }
// km on the plane that touches the globe at the middle of the album: the fog and the snow of its land are laid on it
vec2 wxPlane(vec3 wpos) { vec3 P = wpos + vec3(0., RKM, 0.); return P.xz / max(P.y, 1.) * RKM; }
// the field of the clouds over a place of the map, around .5: the clouds, and what makes them grow and melt; a
// higher lod is a softer field
// (its two parts apart, for those who ask the field at several places close together: what makes the clouds grow
// and melt is far too large to differ between them, and is read once)
float wxBase(vec2 q, float lod) { return textureLod(tCloud, (q + uCloud.yz) / ${CLOUD_KM.toFixed(3)}, lod).r; }
float wxGrow(vec2 q, float lod) { return (textureLod(tCloud, (q + uGrow.xy) / ${GROW_KM.toFixed(3)}, lod + ${GROW_LOD.toFixed(1)}).r - .5) * ${GROW.toFixed(2)}; }
float wxCloudN(vec2 q, float lod) { return wxBase(q, lod) + wxGrow(q, lod); }
// from which value of the field there is cloud, for a cover of the place (c: wxClim().x); the knob moves it
float wxThr(float c) { return ${thrA.toFixed(5)} - ${thrB.toFixed(5)} * clamp(c + uCloud.x - ${COVER_REST.toFixed(2)}, .02, 1.); }
// the clouds over a point of the world, 0 clear sky .. 1 thick cloud
float albumCloudField(vec3 wpos) { vec4 m = wxMapOf(wpos); float thr = wxThr(wxClim(m).x); return smoothstep(thr - .05, thr + .14, wxCloudN(m.xy, wxPolar(m.w))); }
// how much sunlight the clouds leave at a point of the ground: 1 open .. about .5 under a thick cloud
float albumCloudShade(vec3 wpos) {
  if (uCloud.x <= 0.) return 1.;
  vec3 up = normalize(wpos + vec3(0., RKM, 0.));
  float rise = max(uCloud.w - (length(wpos + vec3(0., RKM, 0.)) - RKM), 0.);
  vec3 L = uSun.z > -.03 ? uSunW : normalize(up + vec3(.3, 0., .2));                   // by night the shade lies under the cloud
  float sh = albumCloudField(wpos + L * rise / max(dot(L, up), .22));
  return 1. - sh * mix(.22, .5, albumDay());
}
// the cells of rain over a place of the map, around .5; and which clouds rain, 0..1, for a will of the place (wxClim().y)
float wxCells(vec2 q) { return textureLod(tCloud, (q + uGrow.zw) / ${CELL_KM.toFixed(3)} + vec2(${RAIN_SHIFT[0]}, ${RAIN_SHIFT[1]}), 0.).r; }
float wxRainMask(vec2 q, float will) { float t = uRain.y + (${WILL_REST.toFixed(2)} - will) * ${WILL_GAIN.toFixed(2)}; return smoothstep(t, t + .08, wxCells(q)); }
// is there cloud enough over the place for rain, 0..1 (thr: wxThr of the place); whether that cloud rains is wxRainMask
// (g: wxGrow of the place, or of one near it)
float wxRainCloud(vec2 q, float thr, float g, float lod) { float t = thr + ${RAIN_EDGE.toFixed(3)}; return smoothstep(t, t + .08, wxBase(q, lod) + g); }
// rain over a place of the map, 0..1: under a cloud that rains, nearly to its edge
float wxRainAt(vec4 m, float lod) { vec2 c = wxClim(m); float l = lod + wxPolar(m.w); return wxRainCloud(m.xy, wxThr(c.x), wxGrow(m.xy, l), l) * wxRainMask(m.xy, c.y); }
// lightning over a place of the map, 0..1: the cells of the storm that flash now (hashCell: glsl.js)
float wxFlash(vec2 q) {
  if (uStorm.x <= 0.) return 0.;
  vec2 g = (q + uCloud.yz) / ${STORM_KM.toFixed(1)}, id = floor(g); float h = hashCell(id), ph = uStorm.y / ${STORM_EVERY.toFixed(1)} + h * 61., k = fract(ph);
  if (k > uStorm.z || hashCell(id + floor(ph) * 3.7) < .5) return 0.;
  // (brightest at the middle of the cell, nothing at its edge: a flash is round)
  return (.5 + .5 * step(.5, fract(k / uStorm.z * 2.5 + h * 3.))) * (1. - smoothstep(.08, .48, length(fract(g) - .5)));
}
// the line of snowfall at a latitude (s: its sine), km of the world over the sea
float wxSnowLine(float s) { return uSnowF.x - abs(degrees(asin(s))) * uSnowF.y; }
// how much of what falls is snow, 0 rain .. 1 snow: at a height (km of the world over the sea) at that latitude
float wxSnowy(float s, float alt) { return smoothstep(-uSnowF.z, uSnowF.z, alt - wxSnowLine(s)); }
// the same in the air over a point of the world: by the height of the land around it (the mean of 16 km) where the
// album knows it, and by the sea elsewhere
float wxSnowAir(vec3 wpos) {
  vec2 uv = (wxPlane(wpos) - uFogRect.xy) * uFogRect.zw; vec3 P = wpos + vec3(0., RKM, 0.);
  float land = uv == clamp(uv, 0., 1.) && P.y > 0. ? textureLod(tFog, uv, 0.).a * uExag * .001 : 0.;
  return wxSnowy(dot(normalize(P), WX_AXIS), land);
}
// the top of the fog over a point of the plane, km over the sea: the floor of the land there, and over it a layer
// whose thickness goes by the place and by the banks the fog lies in (over the sea the banks are fewer: sea fog
// stands off a stretch of the coast here and there, not along all of it)
// In the mountains the layer is thicker: it fills a part of the way from the floor of the land to its mean height,
// so that the crests stand out of a sea of cloud.
float wxFogTop(vec2 q) {
  vec4 f = textureLod(tFog, (q - uFogRect.xy) * uFogRect.zw, 0.);
  float lo = uFog.z + .22 * f.b, bank = smoothstep(lo, lo + .2, textureLod(tCloud, q / ${f1(BANK_KM)} * 2.3 + .37, 1.).r), k = uExag * .001;
  return f.r * k + (uFog.y * f.g + uLow.x * max(f.a - f.r - ${f1(HILL_FROM)}, 0.) * k) * bank;
}
// the cap of cloud a high crest wears over a point of the plane: its bottom and its top, km over the sea (no cap
// where the top is not above the bottom)
vec2 wxCap(vec2 q) {
  vec2 uv = (q - uFogRect.xy) * uFogRect.zw; float pk = textureLod(tPeak, uv, 0.).r;
  float crest = smoothstep(${f1(CAP_CREST[0])}, ${f1(CAP_CREST[1])}, pk - textureLod(tFog, uv, 0.).a) * smoothstep(${f1(CAP_HIGH[0])}, ${f1(CAP_HIGH[1])}, pk)
    * smoothstep(uLow.z, uLow.z + .1, textureLod(tCloud, q / ${f1(BANK_KM)} * 2.3 + .37, 1.).r);
  return vec2(pk - ${f1(CAP_UNDER)}, pk - ${f1(CAP_UNDER)} + ${f1(CAP_UNDER + CAP_OVER)} * crest) * uExag * .001;
}
`;
