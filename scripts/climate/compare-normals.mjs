// Compares two baked normals files of the same format (e.g. the old WorldClim bake and the open CHELSA bake) on
// the land cells of the game map: per latitude band and month, the area-weighted mean and RMS temperature
// difference (B − A, °C) and the precipitation ratio (ΣB / ΣA), plus the share of land with the same Köppen class.
// Optionally the two biome rasters too (share of land pixels with the same class).
//
// Run: tools/node/node.exe scripts/climate/compare-normals.mjs <A normals.bin.gz> <B normals.bin.gz> [<A biome.bin.gz> <B biome.bin.gz>] [--md out.md]
import fs from 'node:fs';
import zlib from 'node:zlib';
import { loadNormals, loadLandFrac, W, H, N } from '../../src/sim/climate/climatology.js';
import { classifyKoppen, koppenCode, KOPPEN } from '../../src/sim/climate/koppen.js';
import { BIOMES } from '../../src/sim/climate/biomes.js';

const args = process.argv.slice(2);
const mdAt = args.indexOf('--md');
const mdFile = mdAt >= 0 ? args.splice(mdAt, 2)[1] : null;
const [fa, fb, ba, bb] = args;
if (!fa || !fb) { console.error('usage: compare-normals.mjs <A> <B> [<biomeA> <biomeB>] [--md out.md]'); process.exit(1); }
const A = await loadNormals(fa), B = await loadNormals(fb);
const lf = await loadLandFrac();

const BANDS = [
  ['60–90° с.ш.', 60, 90], ['30–60° с.ш.', 30, 60], ['0–30° с.ш.', 0, 30],
  ['0–30° ю.ш.', -30, 0], ['30–60° ю.ш.', -60, -30], ['60–90° ю.ш.', -90, -60], ['вся суша', -90, 90],
];
const MON = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const latOf = y => 90 - (y + 0.5) * 0.5;
const land = i => lf.land[i] >= 128;

const lines = [];
const out = s => { lines.push(s); console.log(s); };
const f1 = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);

// ---- temperature: mean and RMS difference per band and month
out(`A = ${fa}\nB = ${fb}\n`);
out('### Температура суши: средняя разница B − A (°C) / СКО (°C), по месяцам');
out(`| пояс | ${MON.join(' | ')} | год |`);
out(`|---|${MON.map(() => '---').join('|')}|---|`);
const tStats = {};
for (const [name, lo, hi] of BANDS) {
  const row = [];
  let sY = 0, s2Y = 0, wY = 0;
  for (let m = 0; m < 12; m++) {
    let s = 0, s2 = 0, w = 0;
    for (let y = 0; y < H; y++) {
      const lat = latOf(y);
      if (lat < lo || lat >= hi) continue;
      const cw = Math.cos(lat * Math.PI / 180);
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!land(i)) continue;
        const d = (B.tavg[m * N + i] - A.tavg[m * N + i]) * 0.1;
        s += cw * d; s2 += cw * d * d; w += cw;
      }
    }
    row.push(`${f1(s / w)} / ${Math.sqrt(s2 / w).toFixed(1)}`);
    sY += s; s2Y += s2; wY += w;
  }
  // annual mean difference and RMS of the annual mean difference
  let sa = 0, s2a = 0, wa = 0;
  for (let y = 0; y < H; y++) {
    const lat = latOf(y);
    if (lat < lo || lat >= hi) continue;
    const cw = Math.cos(lat * Math.PI / 180);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!land(i)) continue;
      let d = 0;
      for (let m = 0; m < 12; m++) d += (B.tavg[m * N + i] - A.tavg[m * N + i]) * 0.1;
      d /= 12;
      sa += cw * d; s2a += cw * d * d; wa += cw;
    }
  }
  tStats[name] = { mean: sa / wa, rms: Math.sqrt(s2a / wa), rmsMonthly: Math.sqrt(s2Y / wY) };
  out(`| ${name} | ${row.join(' | ')} | ${f1(sa / wa)} / ${Math.sqrt(s2a / wa).toFixed(1)} |`);
}

// ---- precipitation: ratio of area-weighted sums per band and month
out('\n### Осадки суши: отношение сумм ΣB / ΣA, по месяцам');
out(`| пояс | ${MON.join(' | ')} | год | медиана по клеткам (год) |`);
out(`|---|${MON.map(() => '---').join('|')}|---|---|`);
for (const [name, lo, hi] of BANDS) {
  const row = [];
  let ya = 0, yb = 0;
  for (let m = 0; m < 12; m++) {
    let sa = 0, sb = 0;
    for (let y = 0; y < H; y++) {
      const lat = latOf(y);
      if (lat < lo || lat >= hi) continue;
      const cw = Math.cos(lat * Math.PI / 180);
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!land(i)) continue;
        sa += cw * A.prec[m * N + i]; sb += cw * B.prec[m * N + i];
      }
    }
    row.push((sb / sa).toFixed(2));
    ya += sa; yb += sb;
  }
  const ratios = [];
  for (let y = 0; y < H; y++) {
    const lat = latOf(y);
    if (lat < lo || lat >= hi) continue;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!land(i)) continue;
      let a = 0, b = 0;
      for (let m = 0; m < 12; m++) { a += A.prec[m * N + i]; b += B.prec[m * N + i]; }
      if (a >= 50) ratios.push(b / a);
    }
  }
  ratios.sort((p, q) => p - q);
  out(`| ${name} | ${row.join(' | ')} | ${(yb / ya).toFixed(2)} | ${ratios.length ? ratios[ratios.length >> 1].toFixed(2) : '—'} |`);
}

// ---- Köppen agreement on land cells
{
  const TA = new Float64Array(12), PA = new Float64Array(12), TB = new Float64Array(12), PB = new Float64Array(12);
  let same = 0, sameGroup = 0, tot = 0;
  const conf = new Map();
  for (let y = 0; y < H; y++) {
    const lat = latOf(y), cw = Math.cos(lat * Math.PI / 180);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!land(i)) continue;
      for (let m = 0; m < 12; m++) {
        TA[m] = A.tavg[m * N + i] * 0.1; PA[m] = A.prec[m * N + i];
        TB[m] = B.tavg[m * N + i] * 0.1; PB[m] = B.prec[m * N + i];
      }
      const ka = classifyKoppen(TA, PA, lat), kb = classifyKoppen(TB, PB, lat);
      tot += cw;
      if (ka === kb) same += cw;
      else { const k = `${koppenCode(ka)}→${koppenCode(kb)}`; conf.set(k, (conf.get(k) || 0) + cw); }
      if (KOPPEN[ka].group === KOPPEN[kb].group) sameGroup += cw;
    }
  }
  out(`\n### Кёппен (клетки 0,5° суши, по площади): тот же класс ${(100 * same / tot).toFixed(1)} %, та же группа ${(100 * sameGroup / tot).toFixed(1)} %`);
  const top = [...conf.entries()].sort((p, q) => q[1] - p[1]).slice(0, 10);
  out(`Чаще всего меняются: ${top.map(([k, v]) => `${k} ${(100 * v / tot).toFixed(1)} %`).join(', ')}`);
}

// ---- stations: the cell value brought to the station height (6.5 °C/km) against the station normals
// (the 14 stations of tests/koppen.test.mjs, monthly means: lat, lon, station height m, T[12] °C, P[12] mm)
{
  const ST = {
    'Париж': [48.8, 2.35, 50, [5.0, 5.6, 8.8, 11.6, 15.3, 18.6, 20.6, 20.4, 16.9, 13.0, 8.4, 5.5], [50, 41, 46, 47, 63, 52, 59, 50, 47, 60, 52, 58]],
    'Каир': [30.1, 31.4, 64, [14.0, 15.3, 17.6, 21.3, 24.8, 27.2, 28.1, 28.0, 26.3, 23.6, 19.2, 15.4], [5, 4, 4, 1, 1, 0, 0, 0, 0, 1, 3, 5]],
    'Москва': [55.8, 37.6, 156, [-6.5, -6.7, -1.0, 6.7, 13.2, 17.0, 19.2, 17.0, 11.3, 5.6, -0.5, -4.7], [52, 41, 35, 37, 49, 80, 85, 82, 68, 71, 55, 52]],
    'Сингапур': [1.37, 103.98, 5, [26.5, 27.1, 27.5, 28.0, 28.3, 28.3, 27.9, 27.9, 27.6, 27.6, 27.0, 26.4], [222, 105, 154, 166, 171, 132, 159, 176, 169, 194, 256, 288]],
    'Якутск': [62.0, 129.7, 98, [-38.6, -33.8, -20.1, -4.8, 7.5, 16.4, 19.5, 15.2, 6.1, -7.8, -27.0, -37.6], [10, 8, 6, 9, 22, 38, 47, 39, 27, 19, 15, 11]],
    'Рим': [41.9, 12.5, 105, [7.5, 8.2, 10.2, 12.6, 17.2, 21.1, 24.1, 24.5, 20.8, 16.4, 11.4, 8.4], [67, 73, 58, 81, 53, 34, 19, 37, 73, 113, 115, 81]],
    'Сиэтл': [47.45, -122.3, 130, [5.3, 6.1, 7.7, 10.0, 13.3, 16.0, 19.1, 19.4, 16.6, 11.8, 7.7, 5.0], [142, 89, 95, 70, 52, 40, 16, 23, 38, 89, 165, 141]],
    'Пекин': [39.9, 116.4, 55, [-3.1, 0.3, 6.7, 14.8, 20.8, 24.9, 26.7, 25.5, 20.8, 13.7, 5.0, -0.9], [3, 6, 9, 26, 29, 71, 176, 182, 49, 19, 6, 2]],
    'Гонконг': [22.3, 114.17, 32, [16.3, 17.0, 19.2, 22.7, 26.0, 28.0, 28.7, 28.4, 27.6, 25.3, 21.6, 17.9], [33, 45, 75, 156, 289, 465, 377, 432, 327, 67, 34, 30]],
    'Финикс': [33.43, -112.0, 337, [12.8, 14.6, 17.6, 21.6, 26.6, 31.8, 34.6, 33.9, 31.0, 24.6, 17.3, 12.3], [23, 23, 25, 7, 3, 1, 26, 26, 17, 15, 17, 22]],
    'Денвер': [39.75, -104.87, 1611, [-0.6, 0.4, 4.6, 8.7, 14.1, 19.8, 23.6, 22.3, 17.4, 10.6, 3.9, -0.9], [10, 14, 25, 45, 58, 47, 54, 49, 32, 25, 18, 13]],
    'Уткиагвик': [71.29, -156.78, 10, [-25.6, -27.0, -25.6, -17.7, -6.2, 1.5, 4.7, 3.4, -0.4, -9.0, -17.3, -23.4], [4, 4, 3, 4, 4, 9, 24, 25, 16, 11, 5, 4]],
    'Южный полюс': [-89.99, 0, 2835, [-27.5, -40.1, -53.6, -57.8, -57.3, -57.6, -59.4, -59.6, -58.8, -51.0, -38.4, -27.8], null],
    'Сидней': [-33.86, 151.2, 39, [23.5, 23.4, 22.1, 19.5, 16.6, 14.2, 13.4, 14.5, 17.0, 19.0, 20.4, 22.1], [91, 131, 117, 115, 98, 135, 70, 77, 64, 70, 84, 77]],
  };
  const cellOf = (lat, lon) => Math.min(H - 1, Math.floor((90 - lat) / 0.5)) * W + Math.floor(((lon + 180) / 0.5) % W);
  out('\n### Сверка со станциями (клетка 0,5°, температура приведена к высоте станции, 6,5 °C/км)');
  out('| станция | ΔT A (°C) | СКО T A | ΔT B (°C) | СКО T B | осадки A / станция | осадки B / станция |');
  out('|---|---|---|---|---|---|---|');
  const acc = { A: [0, 0, 0, 0], B: [0, 0, 0, 0] };
  for (const [name, [lat, lon, z, T, P]] of Object.entries(ST)) {
    const i = cellOf(lat, lon), row = [name];
    const ratios = [];
    for (const [k, nm] of [['A', A], ['B', B]]) {
      let s = 0, s2 = 0, pa = 0;
      for (let m = 0; m < 12; m++) {
        const d = nm.tavg[m * N + i] * 0.1 + 0.0065 * (nm.elev[i] - z) - T[m];
        s += d; s2 += d * d; pa += nm.prec[m * N + i];
      }
      row.push(f1(s / 12), Math.sqrt(s2 / 12).toFixed(1));
      acc[k][0] += Math.abs(s / 12); acc[k][1] += Math.sqrt(s2 / 12);
      if (P) { const r = pa / P.reduce((a, b) => a + b, 0); ratios.push(r.toFixed(2)); acc[k][2] += Math.abs(Math.log(r)); acc[k][3]++; } else ratios.push('—');
    }
    out(`| ${row.join(' | ')} | ${ratios.join(' | ')} |`);
  }
  const n = Object.keys(ST).length;
  out(`| **среднее** | ${(acc.A[0] / n).toFixed(1)} (модуль) | ${(acc.A[1] / n).toFixed(1)} | ${(acc.B[0] / n).toFixed(1)} (модуль) | ${(acc.B[1] / n).toFixed(1)} | ×${Math.exp(acc.A[2] / acc.A[3]).toFixed(2)} (типичная ошибка) | ×${Math.exp(acc.B[2] / acc.B[3]).toFixed(2)} |`);
}

// ---- biome rasters
if (ba && bb) {
  const ra = zlib.gunzipSync(fs.readFileSync(ba)), rb = zlib.gunzipSync(fs.readFileSync(bb));
  const MW = 8192, MH = 4096;
  let same = 0, tot = 0;
  const shA = new Float64Array(BIOMES.length), shB = new Float64Array(BIOMES.length);
  for (let y = 0; y < MH; y++) {
    const cw = Math.cos((90 - (y + 0.5) * 180 / MH) * Math.PI / 180);
    for (let x = 0; x < MW; x++) {
      const i = y * MW + x;
      if (!ra[i] && !rb[i]) continue;
      tot += cw; if (ra[i] === rb[i]) same += cw;
      shA[ra[i]] += cw; shB[rb[i]] += cw;
    }
  }
  out(`\n### Природные зоны (карта 8192×4096, по площади суши): тот же класс ${(100 * same / tot).toFixed(1)} %`);
  out('| зона | доля A | доля B |');
  out('|---|---|---|');
  for (const c of BIOMES) if (c.id) out(`| ${c.nameRu} | ${(100 * shA[c.id] / tot).toFixed(1)} % | ${(100 * shB[c.id] / tot).toFixed(1)} % |`);
}

if (mdFile) fs.writeFileSync(mdFile, lines.join('\n') + '\n');
