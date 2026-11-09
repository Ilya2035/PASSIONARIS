// Tests of the baked regions data (run scripts/bake-regions.mjs first).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeGrid, readGz, typedOf } from '../scripts/regions/grid.mjs';
import { distanceKm } from '../scripts/regions/water.mjs';
import { parseRegions, districtAt, toLegacyCells, roadSegments, infoTable } from '../scripts/regions/client.mjs';
import { iceZone } from '../scripts/regions/terrain.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'public', 'assets', 'regions');
const W = 8192, H = 4096;
const grid = makeGrid(W, H);
const need = ['districts.bin.gz', 'regions.json', 'roads.bin.gz', 'roads.json'];
for (const f of need) {
  if (!fs.existsSync(path.join(OUT, f))) throw new Error(`missing ${f}: run tools/node/node.exe --max-old-space-size=8192 scripts/bake-regions.mjs`);
}
const map = typedOf(readGz(path.join(OUT, 'districts.bin.gz')), Uint16Array);
const data = JSON.parse(fs.readFileSync(path.join(OUT, 'regions.json'), 'utf8'));
const roadPts = typedOf(readGz(path.join(OUT, 'roads.bin.gz')), Float32Array);
const roads = JSON.parse(fs.readFileSync(path.join(OUT, 'roads.json'), 'utf8'));
const cells = typedOf(readGz(path.join(ROOT, 'public', 'assets', 'map', 'cells.bin.gz')), Uint32Array);
const D = data.districts;
const byId = id => D[id - 1];
const isLand = t => t === 'land' || t === 'mountain';

test('district ids are contiguous 1..N and match the table', () => {
  assert.equal(map.length, W * H);
  const n = D.length;
  D.forEach((d, k) => assert.equal(d.id, k + 1));
  const seen = new Uint8Array(n + 1);
  for (let i = 0; i < map.length; i++) {
    const v = map[i];
    assert.ok(v >= 1 && v <= n, `texel ${i} has id ${v}`);
    seen[v] = 1;
  }
  for (let id = 1; id <= n; id++) assert.equal(seen[id], 1, `id ${id} never used`);
  // types are grouped: land/mountain, then lakes, then seas
  const rank = t => ({ land: 0, mountain: 0, lake: 1, sea: 2 })[t];
  for (let k = 1; k < n; k++) assert.ok(rank(D[k - 1].type) <= rank(D[k].type));
});

test('every land texel belongs to a land or mountain district; open water to water ids', () => {
  let bad = 0;
  for (let i = 0; i < map.length; i++) {
    const t = byId(map[i]).type;
    if (cells[i] >= 2 && !isLand(t)) bad++;
  }
  assert.equal(bad, 0);
  // ocean texels are mostly sea zones (small pockets/lagoons may be absorbed by land)
  let ocean = 0, oceanSea = 0;
  for (let i = 0; i < map.length; i += 7) if (cells[i] === 0) { ocean++; if (byId(map[i]).type === 'sea') oceanSea++; }
  assert.ok(oceanSea / ocean > 0.995);
});

test('district counts and size distribution are reasonable', () => {
  const land = D.filter(d => isLand(d.type));
  assert.ok(land.length >= 12000 && land.length <= 20000, `land districts: ${land.length}`);
  // exclude ice sheets (larger targets) and isolated islets
  const temperate = land.filter(d => !iceZone(d.lon, d.lat));
  const areas = temperate.map(d => d.areaKm2).sort((a, b) => a - b);
  const median = areas[Math.floor(areas.length / 2)];
  assert.ok(median > 6000 && median < 14000, `median ${median}`);
  const inRange = areas.filter(a => a >= 2500 && a <= 25000).length / areas.length;
  assert.ok(inRange > 0.9, `share within 2,500-25,000 km2: ${inRange}`);
  assert.ok(areas[areas.length - 1] < 60000, `largest ${areas[areas.length - 1]}`);
  const small = temperate.filter(d => d.areaKm2 < 2500);
  // small districts are almost only islands without land neighbours
  const smallWithLandNb = small.filter(d => d.neighbors.some(n => isLand(byId(n).type)));
  assert.ok(smallWithLandNb.length < 0.01 * temperate.length, `small non-island districts: ${smallWithLandNb.length}`);
  const seas = D.filter(d => d.type === 'sea');
  assert.ok(seas.length > 1000 && seas.length < 8000, `sea zones: ${seas.length}`);
  for (const d of D) {
    assert.ok(typeof d.nameRu === 'string' && d.nameRu.length > 1);
    assert.ok(typeof d.nameKey === 'string' && d.nameKey.length > 1);
    assert.ok(d.province >= 1 && d.region >= 1);
  }
});

test('neighbour lists are symmetric and provinces / regions are consistent', () => {
  for (const d of D) for (const n of d.neighbors) assert.ok(byId(n).neighbors.includes(d.id), `${d.id} <-> ${n}`);
  const P = data.provinces, R = data.regions;
  P.forEach((p, k) => assert.equal(p.id, k + 1));
  R.forEach((r, k) => assert.equal(r.id, k + 1));
  for (const p of P) for (const id of p.districts) { assert.equal(byId(id).province, p.id); assert.equal(byId(id).region, p.region); }
  for (const r of R) for (const pid of r.provinces) assert.equal(P[pid - 1].region, r.id);
  const landP = P.filter(p => p.type === 'land');
  const sizes = landP.map(p => p.districts.filter(id => isLand(byId(id).type)).length).sort((a, b) => a - b);
  const med = sizes[Math.floor(sizes.length / 2)];
  assert.ok(med >= 12 && med <= 40, `median districts per province ${med}`);
  const landR = R.filter(r => r.type === 'land');
  const rp = landR.map(r => r.provinces.length).sort((a, b) => a - b);
  assert.ok(rp[Math.floor(rp.length / 2)] >= 2 && rp[Math.floor(rp.length / 2)] <= 7);
});

test('browser client helpers decode the baked files', () => {
  const R = parseRegions(data, readGz(path.join(OUT, 'districts.bin.gz')), readGz(path.join(OUT, 'roads.bin.gz')), roads);
  assert.equal(R.count, D.length);
  const paris = districtAt(R, 2.35, 48.85);
  assert.equal(byId(paris).type, 'land');
  assert.equal(R.province[paris], byId(paris).province);
  const legacy = toLegacyCells(R);
  let ok = true;
  for (let i = 0; i < legacy.length; i += 97) {
    const c = cells[i], v = legacy[i];
    if (c >= 2 && v < 2) ok = false;
    if (v >= 2 && !isLand(byId(v - 1).type)) ok = false;
  }
  assert.ok(ok);
  // with the original cells: the water mask stays exactly as in cells.bin, land gets district ids
  const inPlace = toLegacyCells(R, cells.slice());
  let water = 0, land = 0;
  for (let i = 0; i < cells.length; i += 13) {
    if (cells[i] < 2) { if (inPlace[i] !== cells[i]) water++; }
    else if (inPlace[i] !== map[i] + 1) land++;
  }
  assert.equal(water, 0, 'water texels changed');
  assert.equal(land, 0, 'land texels without their district id');
  const seg = roadSegments(R);
  assert.equal(seg.length % 6, 0);
  assert.equal(seg.length / 6, roads.reduce((s, r) => s + r.count - 1, 0));
  const info = infoTable(R);
  assert.equal(info.data[paris * 2], byId(paris).province);
  assert.equal(info.data[paris * 2 + 1], byId(paris).region);
});

// Rivers act as borders: texels on either side of the centre line belong to different districts.
function riverLines(names) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'raw', 'ne_10m_rivers_lake_centerlines.geojson'), 'utf8'));
  const out = [];
  for (const f of j.features) {
    if (f.properties.featurecla !== 'River' || !names.includes(f.properties.name)) continue;
    const g = f.geometry;
    for (const line of g.type === 'LineString' ? [g.coordinates] : g.coordinates) out.push(line);
  }
  return out;
}
function sideSplit(lines, offKm = 9) {
  let diff = 0, total = 0;
  for (const line of lines) {
    for (let k = 0; k + 1 < line.length; k++) {
      const [lo0, la0] = line[k], [lo1, la1] = line[k + 1];
      const mlo = (lo0 + lo1) / 2, mla = (la0 + la1) / 2;
      const c = Math.cos(mla * Math.PI / 180);
      const ex = (lo1 - lo0) * c, ny = la1 - la0, L = Math.hypot(ex, ny);
      if (L < 1e-6) continue;
      const px = -ny / L, py = ex / L; // unit normal in (east, north) degrees
      const dDeg = offKm / 111.2;
      const a = map[grid.texelOf(mlo + px * dDeg / c, mla + py * dDeg)];
      const b = map[grid.texelOf(mlo - px * dDeg / c, mla - py * dDeg)];
      if (!isLand(byId(a).type) || !isLand(byId(b).type)) continue;
      total++;
      if (a !== b) diff++;
    }
  }
  return { share: diff / total, total };
}
for (const [label, names] of [['Rhine', ['Rhine', 'Rhein', 'Rhin']], ['Loire', ['Loire']], ['Volga', ['Volga']]]) {
  test(`${label} is a district border`, () => {
    const { share, total } = sideSplit(riverLines(names));
    assert.ok(total > 20, `${label}: too few samples (${total})`);
    assert.ok(share >= 0.8, `${label}: only ${(share * 100).toFixed(1)}% of ${total} samples are split`);
  });
}

test('roads connect only neighbouring land districts and stay off open ocean', () => {
  assert.ok(roads.length > 20000, `roads: ${roads.length}`);
  let pts = 0;
  for (const r of roads) {
    const A = byId(r.a), B = byId(r.b);
    assert.ok(isLand(A.type) && isLand(B.type), `road ${r.a}-${r.b} touches water district`);
    assert.ok(A.neighbors.includes(r.b), `road ${r.a}-${r.b} between non-neighbours`);
    assert.ok(r.count >= 2 && r.offset + r.count <= roadPts.length / 2);
    assert.ok(r.lengthKm > 0 && r.lengthKm < 1500);
    pts += r.count;
  }
  assert.equal(pts, roadPts.length / 2);
  // open ocean = ocean texel farther than 10 km from land
  const landSrc = new Uint8Array(W * H);
  for (let i = 0; i < landSrc.length; i++) landSrc[i] = cells[i] >= 2 ? 1 : 0;
  const dLand = distanceKm(grid, landSrc);
  let bad = 0, samples = 0;
  for (const r of roads) {
    for (let k = 0; k + 1 < r.count; k++) {
      const o = (r.offset + k) * 2;
      const lo0 = roadPts[o], la0 = roadPts[o + 1], lo1 = roadPts[o + 2], la1 = roadPts[o + 3];
      let dl = lo1 - lo0; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
      const km = Math.hypot(dl * Math.cos((la0 + la1) * Math.PI / 360), la1 - la0) * 111.2;
      const n = Math.max(1, Math.ceil(km / 2));
      for (let s = 0; s <= n; s++) {
        let lo = lo0 + dl * s / n; if (lo >= 180) lo -= 360; if (lo < -180) lo += 360;
        const t = grid.texelOf(lo, la0 + (la1 - la0) * s / n);
        samples++;
        if (cells[t] === 0 && dLand[t] > 10) bad++;
      }
    }
  }
  assert.equal(bad, 0, `${bad} of ${samples} road samples over open ocean`);
});

test('names are unique Russian strings across land, lakes and seas', () => {
  const seen = new Map();
  for (const d of D) {
    assert.ok(!seen.has(d.nameRu), `duplicate district name "${d.nameRu}" (${seen.get(d.nameRu)} and ${d.id})`);
    seen.set(d.nameRu, d.id);
  }
  const all = [...D, ...data.provinces, ...data.regions];
  for (const x of all) {
    // Latin letters only as Roman numerals inside proper names (Земля Кристиана IX)
    assert.ok(!/[A-Za-z]/.test(x.nameRu.replace(/\b[IVXLCM]+\b/g, '')), `Latin letters in "${x.nameRu}"`);
    assert.ok(!/\s{2}|^\s|\s$|\.\s|undefined|null|NaN/.test(x.nameRu), `malformed name "${x.nameRu}"`);
    // never two compass adjectives in a row ("Восточный Западный Саян"); compound
    // proper adjectives ("Северная Западно-Сибирская равнина") are fine
    assert.ok(!/^\S+(ый|ий|ая|ое|ые|ее|яя|ие) ((Северн|Южн|Западн|Восточн|Центральн)|((Северо|Юго)-(Западн|Восточн)))(ый|ий|ая|ое|ые|ее|яя|ие) /.test(x.nameRu), `double compass in "${x.nameRu}"`);
  }
  // water bodies carry their generic noun, so they cannot be confused with islands
  assert.equal(byId(districtAtLL(33, -1)).type, 'lake');
  assert.match(byId(districtAtLL(33, -1)).nameRu, /озеро Виктория|Озеро Виктория/);
});

function districtAtLL(lon, lat) { return map[grid.texelOf(lon, lat)]; }

test('province and region label points lie inside their own group', () => {
  for (const p of data.provinces) assert.equal(byId(districtAtLL(p.lon, p.lat)).province, p.id, `province ${p.id} ${p.nameRu}`);
  for (const r of data.regions) assert.equal(byId(districtAtLL(r.lon, r.lat)).region, r.id, `region ${r.id} ${r.nameRu}`);
});

test('ice-sheet sizing only on Greenland / Antarctica; big islands keep their own regions', () => {
  // Iceland (~103,000 km2) is not an ice sheet: ~10,000 km2 districts, not ~25,000
  const ice = D.filter(d => isLand(d.type) && d.lon > -25 && d.lon < -13 && d.lat > 63 && d.lat < 67);
  assert.ok(ice.length >= 7, `Iceland districts: ${ice.length}`);
  // Great Britain does not share a region with continental Europe across the Channel
  const london = byId(districtAtLL(-0.1, 51.5)), paris = byId(districtAtLL(2.35, 48.85));
  assert.notEqual(london.region, paris.region);
});

test('regions.json is reproducible (no timestamps or timings)', () => {
  assert.equal(data.generated, undefined);
  assert.equal(data.stats.timingsSec, undefined);
});
