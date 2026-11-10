// Downloads the open climate inputs of scripts/climate/bake-normals.mjs into data/raw/climate-open/ (gitignored).
//
// 1. CHELSA V2.1 climatologies 1981–2010, monthly tas (K * 10) and pr (mm/month * 10), CC0 1.0
//    (https://www.chelsa-climate.org, EnviDat doi:10.16904/envidat.228). The published files are Cloud Optimized
//    GeoTIFFs of 43200x20880 px (30″, 84°N..90°S, ~150 MB tas / ~360 MB pr each, 6 GB for all 24). Only the
//    internal overview level 3 (1/8 resolution: 4′, 5400x2610 px, filtered means of the 30″ pixels) is read with
//    HTTP range requests: ~3.7 MB tas + ~9.6 MB pr per month, ~160 MB in all.
// 2. ETOPO 2022 v1 60″ surface elevation (ice-sheet surface, not bedrock), NOAA NCEI, CC0 1.0
//    (doi:10.25921/fd45-gt74), every 3rd row and column (3′, 7200x3600) through the official OPeNDAP service,
//    in four latitude bands (~104 MB of Float32 before transfer compression).
//
// Outputs: data/raw/climate-open/chelsa/{tas,pr}_MM.u16.gz   Uint16 5400x2610 little-endian, row 0 = 84°N, nodata 65535
//          data/raw/climate-open/etopo/surface_3m.i16.gz      Int16 7200x3600 m, row 0 = 90°N .. 89.95°N, col 0 = 180°W
//          data/raw/climate-open/manifest.json               URLs, sizes, Last-Modified, SHA-256 of the decoded rasters
// Files already present are kept (delete one to fetch it again). Nothing outside data/raw/climate-open is written.
//
// Run: tools/node/node.exe scripts/climate/download-open.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fromUrl } from 'geotiff';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const RAW = path.join(ROOT, 'data', 'raw', 'climate-open');
const CHELSA = 'https://os.unil.cloud.switch.ch/chelsa02/chelsa/global/climatologies';
const ETOPO = 'https://www.ngdc.noaa.gov/thredds/dodsC/global/ETOPO2022/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc';
const LEVEL = 3, CW = 5400, CH = 2610;          // CHELSA overview used
const EW = 7200, EH = 3600, STRIDE = 3;         // ETOPO subsample
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

fs.mkdirSync(path.join(RAW, 'chelsa'), { recursive: true });
fs.mkdirSync(path.join(RAW, 'etopo'), { recursive: true });
const manifestFile = path.join(RAW, 'manifest.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { files: {} };
const save = () => fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

// ------------------------------------------------------------------ CHELSA overviews
async function chelsa(v, m) {
  const mm = String(m).padStart(2, '0');
  const rel = `chelsa/${v}_${mm}.u16.gz`, out = path.join(RAW, rel);
  if (fs.existsSync(out) && manifest.files[rel]) return;
  const url = `${CHELSA}/${v}/1981-2010/CHELSA_${v}_${mm}_1981-2010_V.2.1.tif`;
  const head = await fetch(url, { method: 'HEAD' });
  if (!head.ok) throw new Error(`${url}: HTTP ${head.status}`);
  let fetched = 0;
  const tiff = await fromUrl(url, { allowFullFile: false, cacheSize: 2048 });
  const im = await tiff.getImage(LEVEL);
  if (im.getWidth() !== CW || im.getHeight() !== CH) throw new Error(`${url}: overview ${LEVEL} is ${im.getWidth()}x${im.getHeight()}`);
  const fd = im.fileDirectory;
  const counts = await (fd.loadValue ? fd.loadValue('TileByteCounts') : fd.getValue('TileByteCounts'));
  for (const c of counts) fetched += Number(c);
  const [a] = await im.readRasters();
  if (!(a instanceof Uint16Array) || a.length !== CW * CH) throw new Error(`${url}: unexpected raster type`);
  const buf = Buffer.from(a.buffer, a.byteOffset, a.byteLength);
  fs.writeFileSync(out, zlib.gzipSync(buf, { level: 6 }));
  manifest.files[rel] = {
    url, overview: LEVEL, width: CW, height: CH, type: 'Uint16', nodata: 65535,
    fileBytes: +head.headers.get('content-length'), lastModified: head.headers.get('last-modified'),
    overviewBytes: fetched, sha256: sha(buf),
  };
  save();
  log(`${rel}  overview ${(fetched / 1e6).toFixed(1)} MB of ${(+head.headers.get('content-length') / 1e6).toFixed(0)} MB`);
}

const jobs = [];
for (let m = 1; m <= 12; m++) for (const v of ['tas', 'pr']) jobs.push([v, m]);
const POOL = 3;
await Promise.all(Array.from({ length: POOL }, async () => {
  while (jobs.length) {
    const [v, m] = jobs.shift();
    for (let attempt = 1; ; attempt++) {
      try { await chelsa(v, m); break; } catch (e) {
        if (attempt >= 3) throw e;
        log(`${v} ${m}: ${e.message} — retry ${attempt}`);
        await new Promise(r => setTimeout(r, 3000 * attempt));
      }
    }
  }
}));
log('CHELSA done');

// ------------------------------------------------------------------ ETOPO 2022 via OPeNDAP (DAP2 binary)
// Response = DDS text, "Data:\n", then XDR: for each array (Grid: the array, then its maps in order)
// two big-endian uint32 element counts and the values (Float32 / Float64 big-endian).
function parseDods(buf) {
  const mark = buf.indexOf('\nData:\n');
  if (mark < 0) throw new Error(`OPeNDAP: no data section (${buf.subarray(0, 300).toString()})`);
  let o = mark + 7;
  const take = (bytes) => {
    const n = buf.readUInt32BE(o); o += 8;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++, o += bytes) out[i] = bytes === 4 ? buf.readFloatBE(o) : buf.readDoubleBE(o);
    return out;
  };
  const z = take(4), lat = take(8), lon = take(8);
  return { z, lat, lon };
}

const erel = 'etopo/surface_3m.i16.gz', eout = path.join(RAW, erel);
if (!(fs.existsSync(eout) && manifest.files[erel])) {
  const NROW = 10800, NCOL = 21600, BANDS = 4, per = NROW / BANDS;
  const elev = new Int16Array(EW * EH);
  let latS = null, transferred = 0;
  const parts = [];
  for (let b = 0; b < BANDS; b++) {
    const r0 = b * per, r1 = r0 + per - 1;
    const q = `z[${r0}:${STRIDE}:${r1}][0:${STRIDE}:${NCOL - 1}]`;
    const url = `${ETOPO}.dods?${q}`;
    let buf;
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        buf = Buffer.from(await res.arrayBuffer());
        break;
      } catch (e) {
        if (attempt >= 3) throw new Error(`${url}: ${e.message}`);
        log(`ETOPO band ${b}: ${e.message} — retry ${attempt}`);
        await new Promise(r => setTimeout(r, 5000 * attempt));
      }
    }
    transferred += buf.length;
    const { z, lat, lon } = parseDods(buf);
    const rows = lat.length;
    if (lon.length !== EW || z.length !== rows * EW) throw new Error(`ETOPO band ${b}: ${rows}x${lon.length}`);
    if (b === 0) latS = lat[0] < lat[lat.length - 1];   // netCDF rows south -> north?
    parts.push({ z, lat, rows });
    log(`ETOPO band ${b + 1}/${BANDS}: ${rows} rows, lat ${lat[0].toFixed(3)}..${lat[rows - 1].toFixed(3)}, lon ${lon[0].toFixed(3)}..${lon[EW - 1].toFixed(3)}`);
  }
  // write north-first
  const lats = parts.flatMap(p => Array.from(p.lat));
  if (lats.length !== EH) throw new Error(`ETOPO: ${lats.length} rows`);
  let y = 0;
  for (const p of parts) for (let r = 0; r < p.rows; r++, y++) {
    const dst = latS ? EH - 1 - y : y;
    for (let x = 0; x < EW; x++) {
      const v = p.z[r * EW + x];
      elev[dst * EW + x] = Number.isFinite(v) && v > -20000 ? Math.max(-11000, Math.min(9000, Math.round(v))) : 0;
    }
  }
  const latN = latS ? lats.slice().reverse() : lats;
  const buf = Buffer.from(elev.buffer);
  fs.writeFileSync(eout, zlib.gzipSync(buf, { level: 6 }));
  manifest.files[erel] = {
    url: `${ETOPO}.dods?z[r0:${STRIDE}:r1][0:${STRIDE}:${NCOL - 1}] (4 bands of ${per} rows)`,
    width: EW, height: EH, type: 'Int16', units: 'm', firstRowLat: +latN[0].toFixed(5), lastRowLat: +latN[EH - 1].toFixed(5),
    transferredBytes: transferred, sha256: sha(buf),
  };
  save();
  log(`${erel} written (${(transferred / 1e6).toFixed(0)} MB transferred)`);
}
log('done');
