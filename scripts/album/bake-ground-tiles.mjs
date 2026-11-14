// The grain of the ground of the album, taken from the real ground: squares of about 10 km of Sentinel-2 pictures
// (10 m a pixel) over land of one kind — dry steppe, green meadow and wood, stony desert, dunes. From each the
// broad tones are taken out and only the fine pattern is kept, as a number around 1: gullies, scrub, the mottle of the
// soil. The ground shader lays it over its own colours at the true size (docs/album/ground.md), so from 20 km the land
// reads as it does from a satellite, not as an enlarged photograph of a handful of soil.
//
// Source: Copernicus Sentinel-2 L2A, bands B04, B03, B02 — free, full and open (the Copernicus data licence); the
// notice «Contains modified Copernicus Sentinel data [year]» is in data/ATTRIBUTION.md. Read as Cloud Optimized
// GeoTIFF from the public archive on AWS (registry.opendata.aws/sentinel-2-l2a-cogs), found through the Earth Search
// catalogue of Element 84. Only the window needed is fetched: about 3 MB per square.
// Output: public/assets/album/ground/<id>.webp, 1024 × 1024, tiles without a seam, mean exactly 128 in every channel.
//
//   node --no-network-family-autoselection scripts/album/bake-ground-tiles.mjs [--only id,id] [--png <folder for check pictures>] [--cache <folder>]
// (the flag of node: without it the archive on AWS often cannot be reached from a home network)
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { fromUrl } from 'geotiff';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const OUT = path.join(ROOT, 'public', 'assets', 'album', 'ground');
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const N = 1024;
// id → the middle of the square, the months to look in, and how far the tones are flattened (px: broader keeps
// larger shapes). hue: how much of the change of hue is kept (by default half). cloud: see cloudy() below.
// even (px): the pattern is made equally strong all over the square, counted over this far. bend: how many
// deviations from the mean a shape may stand out before it is bent back (by default 2).
// scene: a fixed picture, so that the bake gives the same file every time.
// The dry tiles (steppe, stone) keep only shapes up to about half a kilometre — rills, scrub, the mottle of the soil.
// With the broader shapes left in (flat 90) the one river bed of the square, with its pale banks, was seen again at
// every repeat: from 20–50 km the deserts of the map were laid with it in rows, like wallpaper.
export const SAMPLES = [
  { id: 'steppe', what: 'сухая степь (плато восточного Марокко, альфа)', lat: 33.60, lon: -2.60, from: '2022-06-01', to: '2022-09-30', flat: 22, even: 50, bend: 1.5, hue: .3, scene: 'S2B_30SWC_20220724_0_L2A' },
  // (the green land is taken far from Europe on purpose: on the moors of Britain and Spain the square always caught
  // a plantation or the walls of fields, and their straight lines showed in every meadow of the map)
  { id: 'heath', what: 'зелёная лесостепь: луга и перелески (север Монголии)', lat: 48.30, lon: 106.00, from: '2022-06-20', to: '2022-08-31', flat: 70, cloud: .13, hue: .3, scene: 'S2B_48UWU_20220830_0_L2A' },
  { id: 'stone', what: 'каменистая пустыня с руслами (плато Тадемаит, Сахара)', lat: 28.40, lon: 1.90, from: '2022-06-01', to: '2022-09-30', flat: 22, even: 50, bend: 1.5, hue: .3, scene: 'S2A_31RCM_20220603_0_L2A' },
  { id: 'dunes', what: 'барханы (Большой Западный Эрг)', lat: 30.30, lon: .90, from: '2022-06-01', to: '2022-09-30', flat: 110, hue: .15, scene: 'S2A_31RBP_20220613_0_L2A' },
];

// some addresses of the archive do not answer from every network: a request that could not connect is tried again
const plainFetch = globalThis.fetch;
globalThis.fetch = async (...a) => { for (let i = 0; ; i++) { try { return await plainFetch(...a); } catch (e) { if (i >= 8) throw e; await new Promise(r => setTimeout(r, 400)); } } };

const D = Math.PI / 180;
// WGS84 → UTM of a zone, metres (Snyder)
function utm(lat, lon, zone) {
  const a = 6378137, f = 1 / 298.257223563, k0 = .9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const fi = lat * D, s = Math.sin(fi), c = Math.cos(fi), t = Math.tan(fi), Nn = a / Math.sqrt(1 - e2 * s * s), T = t * t, C = ep2 * c * c, A = c * (lon - ((zone - 1) * 6 - 177)) * D;
  const M = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * fi - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * fi)
    + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * fi) - 35 * e2 ** 3 / 3072 * Math.sin(6 * fi));
  return [k0 * Nn * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000,
    k0 * (M + Nn * t * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720))];
}
async function findScene(s) {
  const body = { collections: ['sentinel-2-l2a'], intersects: { type: 'Point', coordinates: [s.lon, s.lat] }, datetime: `${s.from}T00:00:00Z/${s.to}T23:59:59Z`,
    query: { 'eo:cloud_cover': { lt: 5 } }, limit: 40 };
  const r = await fetch('https://earth-search.aws.element84.com/v1/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`catalogue: HTTP ${r.status}`);
  const items = (await r.json()).features;
  if (s.scene) return items.filter(f => f.id === s.scene);
  // the clearest pictures first; among equals the earliest name, so the choice does not depend on the order of the answer
  return items.sort((a, b) => a.properties['eo:cloud_cover'] - b.properties['eo:cloud_cover'] || (a.id < b.id ? -1 : 1)).slice(0, 8);
}
// reflectance of the three bands over the square, N × N, as Float32 0..1
async function readSquare(item, s) {
  const zone = item.properties['proj:epsg'] % 100, [x, y] = utm(s.lat, s.lon, zone), out = [];
  for (const band of ['red', 'green', 'blue']) {
    const im = await (await fromUrl(item.assets[band].href)).getImage(0), [ox, oy] = im.getOrigin(), [rx] = im.getResolution(), w = im.getWidth(), h = im.getHeight();
    const l = Math.max(0, Math.min(w - N, Math.round((x - ox) / rx - N / 2))), t = Math.max(0, Math.min(h - N, Math.round((oy - y) / rx - N / 2)));
    const [a] = await im.readRasters({ window: [l, t, l + N, t + N] }), v = new Float32Array(N * N);
    let empty = 0; for (let i = 0; i < v.length; i++) { if (a[i] === 0) empty++; v[i] = Math.max(1e-3, a[i] / 10000); }
    if (empty > v.length / 1000) return null;                         // the square runs off the edge of the picture
    out.push(v);
  }
  return out;
}
// A picture with few clouds may still have one over the square. Over land that is not desert anything bright in blue
// is cloud or haze (s.cloud: the reflectance in blue that leaves no doubt); such a square is passed over.
const cloudy = (s, bands) => { if (!s.cloud) return false; let n = 0; for (const v of bands[2]) if (v > s.cloud) n++; return n > bands[2].length / 2000; };
// blur by three passes of a box filter, edges mirrored: near enough to a Gaussian of that sigma
function blur(a, sigma) {
  const r = Math.max(1, Math.round(sigma * .9)), tmp = new Float32Array(a.length); let src = Float32Array.from(a);
  const mir = i => (i < 0 ? -i - 1 : i >= N ? 2 * N - 1 - i : i);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < N; y++) { let s = 0; for (let k = -r; k <= r; k++) s += src[y * N + mir(k)]; for (let x = 0; x < N; x++) { tmp[y * N + x] = s / (2 * r + 1); s += src[y * N + mir(x + r + 1)] - src[y * N + mir(x - r)]; } }
    for (let x = 0; x < N; x++) { let s = 0; for (let k = -r; k <= r; k++) s += tmp[mir(k) * N + x]; for (let y = 0; y < N; y++) { src[y * N + x] = s / (2 * r + 1); s += tmp[mir(y + r + 1) * N + x] - tmp[mir(y - r) * N + x]; } }
  }
  return src;
}
// The pattern of a band as the ratio of the picture to its own broad tone, in the scale of the screen (gamma 2.2).
function pattern(band, flat) { const low = blur(band, flat), out = new Float32Array(N * N); for (let i = 0; i < out.length; i++) out[i] = (band[i] / low[i]) ** (1 / 2.2) - 1; return out; }
// A tile without a seam: the square and the same square moved by half its side are laid over each other. Each hides
// the seam of the other; where both show, the sum is divided so that the contrast stays what it was.
// First along x (the result repeats from left to right), then the same along y.
function seamless(dev) {
  const h = N / 2, w1 = i => { const t = Math.abs((i + .5) / N - .5) * 2; const u = Math.max(0, Math.min(1, (1 - t) / .5)); return u * u * (3 - 2 * u); };
  const mid = new Float32Array(N * N), out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const a = w1(x), b = 1 - a; mid[y * N + x] = (a * dev[y * N + x] + b * dev[y * N + (x + h) % N]) / Math.sqrt(a * a + b * b); }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const a = w1(y), b = 1 - a; out[y * N + x] = (a * mid[y * N + x] + b * mid[((y + h) % N) * N + x]) / Math.sqrt(a * a + b * b); }
  return out;
}

const only = arg('--only')?.split(','), png = arg('--png'), cache = arg('--cache');
fs.mkdirSync(OUT, { recursive: true });
for (const s of SAMPLES) {
  if (only && !only.includes(s.id)) continue;
  let scene = null, bands = null;
  // (--cache <folder>: the squares as they were read, kept between runs while the treatment below is being tuned)
  const kept = cache && path.join(cache, `${s.id}-${s.lat}-${s.lon}.f32`);
  if (kept && fs.existsSync(kept)) {
    const b = fs.readFileSync(kept), all = new Float32Array(b.buffer, b.byteOffset, 3 * N * N);
    bands = [0, 1, 2].map(i => all.slice(i * N * N, (i + 1) * N * N)); scene = fs.readFileSync(kept + '.txt', 'utf8');
  } else {
    for (const it of await findScene(s)) { const b = await readSquare(it, s); if (b && !cloudy(s, b)) { scene = `${it.id} (cloud ${it.properties['eo:cloud_cover'].toFixed(1)} %)`; bands = b; break; } }
    if (!bands) { console.log(s.id, 'no clear picture found'); continue; }
    if (kept) { fs.mkdirSync(cache, { recursive: true }); const all = new Float32Array(3 * N * N); bands.forEach((b, i) => all.set(b, i * N * N)); fs.writeFileSync(kept, Buffer.from(all.buffer)); fs.writeFileSync(kept + '.txt', scene); }
  }
  // the three bands share most of their pattern; what differs between them is the change of hue, kept at half strength
  const dev = bands.map(b => pattern(b, s.flat)), grey = new Float32Array(N * N);
  for (let i = 0; i < grey.length; i++) grey[i] = (dev[0][i] + dev[1][i] + dev[2][i]) / 3;
  // Nothing may stand out of the pattern: one dark river bed or one white salt pan would be seen again at every
  // repeat of the tile. So the pattern is made equally strong all over the square (s.even: it is divided by its own
  // strength around the point, but a calm place is never raised more than threefold), and what lies further than
  // two deviations from the mean (s.bend) is bent back toward it.
  if (s.even) {
    const q = new Float32Array(N * N); for (let i = 0; i < q.length; i++) q[i] = grey[i] * grey[i];
    const e = blur(q, s.even); let m = 0; for (const v of e) m += Math.sqrt(v); m /= e.length;
    for (let i = 0; i < grey.length; i++) { const k = m / Math.max(Math.sqrt(e[i]), m * .35); grey[i] *= k; for (const d of dev) d[i] *= k; }
  }
  let gs = 0, gq = 0; for (const v of grey) { gs += v; gq += v * v; }
  const gm = gs / grey.length, lim = (s.bend ?? 2) * Math.sqrt(gq / grey.length - gm * gm), bend = v => gm + lim * Math.tanh((v - gm) / lim);
  const chan = dev.map(d => { const c = new Float32Array(N * N); for (let i = 0; i < c.length; i++) c[i] = bend(grey[i]) + (d[i] - grey[i]) * (s.hue ?? .5); return seamless(c); });
  // every tile has the same strength: a deviation of 0.14 around 1; the shader decides how strong the grain is
  let sum = 0, sq = 0; for (const c of chan) for (const v of c) { sum += v; sq += v * v; }
  const n3 = 3 * N * N, mean = sum / n3, k = .14 / Math.sqrt(sq / n3 - mean * mean), rgb = Buffer.alloc(n3);
  for (let ch = 0; ch < 3; ch++) {
    let m = 0; for (const v of chan[ch]) m += v; m /= N * N;
    for (let i = 0; i < N * N; i++) rgb[i * 3 + ch] = Math.max(0, Math.min(255, Math.round(128 + (chan[ch][i] - m) * k * 128)));
  }
  const file = path.join(OUT, `${s.id}.webp`);
  await sharp(rgb, { raw: { width: N, height: N, channels: 3 } }).webp({ quality: 82, effort: 6 }).toFile(file);
  console.log(`${s.id}: ${scene}, ${fs.statSync(file).size} bytes — ${s.what}`);
  if (png) {   // the square as the eye sees it, beside its pattern
    const nat = Buffer.alloc(n3); for (let i = 0; i < N * N; i++) for (let ch = 0; ch < 3; ch++) nat[i * 3 + ch] = Math.max(0, Math.min(255, Math.round(255 * (bands[ch][i] * 2.6) ** (1 / 2.2))));
    await sharp({ create: { width: N * 2, height: N, channels: 3, background: '#000' } }).composite([{ input: nat, raw: { width: N, height: N, channels: 3 }, left: 0, top: 0 }, { input: rgb, raw: { width: N, height: N, channels: 3 }, left: N, top: 0 }])
      .jpeg({ quality: 88 }).toFile(path.join(png, `tile-${s.id}.jpg`));
  }
}
