// Sanity of the weather simulator on the real baked data (climate module normals + map land
// mask), compared with observed 1981-2010 climatology: hemispheric sea-ice extent (NSIDC: Arctic
// ~15.5 Mkm2 in March, ~6.5 in September; Antarctic ~3 in February, ~18.5 in September) and
// Northern Hemisphere snow cover (Rutgers: ~46 Mkm2 in February, ~2.5 incl. Greenland in July).
// Only the baked asset files are read (no climate-module code); skipped when they are missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createWeather, fromDate, parseNormals, maskFromCells, N, W, LAND, OCEAN } from '../src/sim/weather/core.js';

const ROOT = new URL('../', import.meta.url);
const files = ['public/assets/climate/normals.bin.gz', 'public/assets/climate/normals.json', 'public/assets/map/cells.bin.gz'].map(p => new URL(p, ROOT));
const have = files.every(f => existsSync(f));

test('real normals: sea ice and snow cover follow the observed seasonal cycle', { skip: !have && 'baked climate/map assets not found' }, () => {
  const raw = gunzipSync(readFileSync(files[0]));
  const normals = parseNormals(raw, JSON.parse(readFileSync(files[1], 'utf8')));
  const cb = gunzipSync(readFileSync(files[2]));
  const mask = maskFromCells(new Uint32Array(cb.buffer, cb.byteOffset, cb.byteLength / 4));
  const area = y => Math.cos(((90 - (y + 0.5) * 0.5) * Math.PI) / 180) * 55.6 * 55.6; // km2 per cell
  const sim = createWeather({ normals, mask, seed: 1, t: fromDate(1990, 8, 1), options: { events: false } });
  // Saharan lowland cells: never any snow, even in the coldest month
  const sahara = [];
  for (let c = 0; c < N; c++) {
    const y = (c / W) | 0, x = c % W, lat = 90 - (y + 0.5) / 2, lon = -180 + (x + 0.5) / 2;
    if (mask[c] === LAND && lat > 18 && lat < 28 && lon > -8 && lon < 30 && normals.elev[c] < 400) sahara.push(c);
  }
  const measure = () => {
    let iceN = 0, iceS = 0, snowN = 0;
    const g = sim.grid;
    for (let c = 0; c < N; c++) {
      const y = (c / W) | 0, a = area(y);
      if (mask[c] === LAND) { if (y < 180 && g[c * 4] >= 128) snowN += a; }
      else if (g[c * 4] >= 50) { if (y < 180) iceN += a; else iceS += a; }
    }
    const swe = sim.getField('swe');
    return { iceN: iceN / 1e6, iceS: iceS / 1e6, snowN: snowN / 1e6, sahSnow: sahara.filter(c => swe[c] > 0).length };
  };
  const out = {};
  for (const [k, y, m, d] of [['sep', 1990, 9, 15], ['jan', 1991, 1, 15], ['feb', 1991, 2, 20], ['mar', 1991, 3, 15], ['jul', 1991, 7, 15]]) {
    sim.step(fromDate(y, m, d));
    out[k] = measure();
  }
  const f = v => v.toFixed(1);
  console.log(`# real normals, Mkm2: Arctic ice Mar ${f(out.mar.iceN)} Sep ${f(out.sep.iceN)} | Antarctic ice Feb ${f(out.feb.iceS)} Sep ${f(out.sep.iceS)} | NH snow Feb ${f(out.feb.snowN)} Jul ${f(out.jul.snowN)}`);
  // NH includes lakes and the marginal seas; SH includes the ice shelves the land mask counts as water (~1.5 Mkm2)
  assert.ok(out.mar.iceN > 12 && out.mar.iceN < 21, 'Arctic March');
  assert.ok(out.sep.iceN > 3 && out.sep.iceN < 9, 'Arctic September');
  assert.ok(out.sep.iceS > 15 && out.sep.iceS < 23, 'Antarctic September');
  assert.ok(out.feb.iceS < 7, 'Antarctic summer minimum: the Southern Ocean ice melts back');
  assert.ok(out.feb.snowN > 30 && out.feb.snowN < 52, 'NH snow February');
  assert.ok(out.jul.snowN < 5, 'NH snow July (Greenland and high mountains)');
  assert.ok(sahara.length > 500, `Saharan lowland cells ${sahara.length}`);
  for (const k in out) assert.equal(out[k].sahSnow, 0, `snow in the Sahara lowlands (${k})`);
  assert.ok(mask.some(v => v === OCEAN));
});
