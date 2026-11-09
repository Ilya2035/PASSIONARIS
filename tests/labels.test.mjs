// Tests for the zone-label module (scripts/labels/**, src/game/fx/labels.js, public/assets/labels/zones.json).
// Run: tools/node/node.exe --test tests/labels.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import * as THREE from 'three';

import {
  toVec, toLonLat, makeAeqd, edtSq, pointInParts, distToPartsKm, partsOf, bendRange, gcKm, eastNorth, dot,
} from '../scripts/labels/geom.mjs';
import { keyOf, cleanRu, isCapePoint, MANUAL_PATH } from '../scripts/labels/zone-table.mjs';
import {
  collectGlyphs, buildGlyphAtlas, layoutLabel, labelText, isWater, glyphKey, sampleCurve, curveAt, _segDist2, WATER_KINDS, ZoneLabels,
} from '../src/game/fx/labels.js';
import { GlobeCamera } from '../src/game/camera.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const ZONES = path.join(ROOT, 'public', 'assets', 'labels', 'zones.json');
const RAW = path.join(ROOT, 'data', 'raw', 'labels');
const FONTS = path.join(ROOT, 'public', 'assets', 'labels', 'fonts');
const KINDS = new Set(['desert', 'range', 'plateau', 'basin', 'plain', 'lowland', 'tundra', 'peninsula', 'valley', 'delta',
  'ocean', 'sea', 'gulf', 'bay', 'strait', 'other']);

const doc = JSON.parse(fs.readFileSync(ZONES, 'utf8'));
const zones = doc.zones;

// ------------------------------------------------------------------ fake 2D canvas for the atlas
function fakeCanvas(w, h) {
  const ctx = {
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: '', textBaseline: '', textAlign: '',
    globalCompositeOperation: '', filter: 'none', drawn: [],
    measureText(t) {
      const n = [...t].length;
      return {
        width: n * 40, actualBoundingBoxLeft: 1, actualBoundingBoxRight: n * 40 - 1,
        actualBoundingBoxAscent: 50, actualBoundingBoxDescent: 14, fontBoundingBoxAscent: 58, fontBoundingBoxDescent: 18,
      };
    },
    fillRect() {},
    fillText(t, x, y) { this.drawn.push({ t, x, y, font: this.font, style: this.fillStyle }); },
    strokeText() {},
  };
  return { width: w, height: h, getContext: () => ctx };
}

// minimal TrueType cmap reader (formats 4 and 12) -> Set of code points
function fontCodePoints(file) {
  const buf = fs.readFileSync(file);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let cmap = -1;
  for (let i = 0; i < dv.getUint16(4); i++) {
    const r = 12 + i * 16;
    if (buf.toString('latin1', r, r + 4) === 'cmap') cmap = dv.getUint32(r + 8);
  }
  assert.ok(cmap > 0, 'cmap table');
  const out = new Set();
  for (let i = 0; i < dv.getUint16(cmap + 2); i++) {
    const sub = cmap + dv.getUint32(cmap + 4 + i * 8 + 4);
    const fmt = dv.getUint16(sub);
    if (fmt === 4) {
      const seg = dv.getUint16(sub + 6) / 2;
      const ends = sub + 14, starts = ends + seg * 2 + 2, deltas = starts + seg * 2, ranges = deltas + seg * 2;
      for (let s = 0; s < seg; s++) {
        const a = dv.getUint16(starts + s * 2), b = dv.getUint16(ends + s * 2);
        const delta = dv.getInt16(deltas + s * 2), ro = dv.getUint16(ranges + s * 2);
        for (let c = a; c <= b && c !== 0xffff; c++) {
          const gid = ro === 0 ? (c + delta) & 0xffff : dv.getUint16(ranges + s * 2 + ro + 2 * (c - a));
          if (gid) out.add(c);
        }
      }
    } else if (fmt === 12) {
      const n = dv.getUint32(sub + 12);
      for (let g = 0; g < n; g++) {
        const a = dv.getUint32(sub + 16 + g * 12), b = dv.getUint32(sub + 20 + g * 12);
        for (let c = a; c <= b; c++) out.add(c);
      }
    }
  }
  return out;
}

function deepFinite(v, where) {
  if (typeof v === 'number') assert.ok(Number.isFinite(v), `non-finite number at ${where}`);
  else if (Array.isArray(v)) v.forEach((x, i) => deepFinite(x, `${where}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) deepFinite(x, `${where}.${k}`);
}

// ------------------------------------------------------------------ zones.json
test('zones.json: structure and value ranges', () => {
  assert.equal(doc.version, 1);
  assert.equal(doc.count, zones.length);
  assert.ok(zones.length >= 500, `expected hundreds of zones, got ${zones.length}`);
  const ids = new Set();
  for (const z of zones) {
    assert.equal(typeof z.id, 'string');
    assert.ok(!ids.has(z.id), `duplicate id ${z.id}`);
    ids.add(z.id);
    assert.ok(typeof z.nameRu === 'string' && /[А-Яа-яЁё]/.test(z.nameRu), `${z.id}: Russian name`);
    assert.ok(!/[̀́]/.test(z.nameRu), `${z.id}: stress marks left in "${z.nameRu}"`);
    assert.ok(typeof z.nameEn === 'string' && z.nameEn.length > 0, `${z.id}: English name`);
    assert.ok(KINDS.has(z.kind), `${z.id}: kind ${z.kind}`);
    assert.equal(z.water, z.water === true);
    if (WATER_KINDS.has(z.kind)) assert.equal(z.water, true, `${z.id}: water kind must be water`);
    assert.ok(Number.isInteger(z.scalerank) && z.scalerank >= 0 && z.scalerank <= 10, `${z.id}: scalerank`);
    assert.ok(Array.isArray(z.path) && z.path.length >= 3 && z.path.length <= 9, `${z.id}: path has ${z.path.length} points`);
    for (const [lon, lat] of z.path) {
      assert.ok(lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90, `${z.id}: lon/lat range`);
    }
    assert.ok(z.lengthKm > 0 && z.letterHeightKm > 0, `${z.id}: sizes`);
    assert.ok(z.letterHeightKm * 1.2 <= z.lengthKm, `${z.id}: letters ${z.letterHeightKm} km vs length ${z.lengthKm} km`);
    assert.ok(z.minAltitude > 0 && z.minAltitude < z.maxAltitude, `${z.id}: altitude range`);
    assert.ok(z.baseM >= 0 && z.baseM < 9000, `${z.id}: baseM`);
    if (z.water) assert.equal(z.baseM, 0);
  }
});

test('zones.json: no NaN / Infinity anywhere', () => {
  deepFinite(doc, 'zones.json');
  assert.ok(!/NaN|Infinity/.test(fs.readFileSync(ZONES, 'utf8')));
});

test('zones.json: key zones are present with correct names', () => {
  const by = (ru, en) => zones.find(z => z.nameRu === ru && (!en || z.nameEn === en));
  const sahara = by('Сахара', 'Sahara');
  const himalayas = by('Гималаи', 'Himalayas');
  const med = by('Средиземное море', 'Mediterranean Sea');
  assert.ok(sahara && himalayas && med, 'Сахара, Гималаи, Средиземное море');
  assert.equal(sahara.kind, 'desert');
  assert.equal(himalayas.kind, 'range');
  assert.equal(med.kind, 'sea');
  assert.ok(sahara.lengthKm > 3000, 'Sahara label spans the desert');
  assert.ok(med.lengthKm > 1500, 'Mediterranean label spans the sea');
  for (const ru of ['Анды', 'Альпы', 'Тихий океан', 'Атлантический океан', 'Гоби', 'Чёрное море', 'Уральские горы']) {
    assert.ok(zones.some(z => z.nameRu === ru), ru);
  }
  // hand-fixed Natural Earth names
  assert.ok(zones.some(z => z.nameRu === 'Татры'), 'Tatra fix');
  assert.ok(!zones.some(z => /Кшемёнки|гора Скотт/.test(z.nameRu)), 'bad NE translations gone');
  // wrong NAME_EN values replaced; Russian names without English generic words ("залив Дарнли-Бэй")
  assert.ok(!zones.some(z => /^(Enugu Nigeria|Taitailei|Ahag|Serra do Espinho|Nullabor Plain|Appennino Ligure)$/.test(z.nameEn)), 'bad NE English names gone');
  assert.ok(zones.some(z => z.nameEn === 'Niger Delta' && z.nameRu === 'дельта Нигера'));
  assert.ok(!zones.some(z => /\S-Бэй$|Сено /.test(z.nameRu)), 'no "-Бэй" / "Сено" calques');
  // "Cape York Peninsula" is a peninsula, not a cape point
  const cy = zones.find(z => z.nameEn === 'Cape York Peninsula');
  assert.ok(cy && cy.kind === 'peninsula' && cy.nameRu === 'полуостров Кейп-Йорк', 'Cape York Peninsula');
  assert.equal(isCapePoint('Cape York Peninsula'), false);
  assert.equal(isCapePoint('CAPE YORK PEN.'), false);
  assert.equal(isCapePoint('Cape Chelyuskin'), true);
  assert.equal(isCapePoint('Point Barrow'), true);
});

test('zones.json: natural zones only — no countries', () => {
  const f = path.join(ROOT, 'data', 'raw', 'ne_10m_admin_0_countries.geojson');
  if (!fs.existsSync(f)) return;
  const countries = JSON.parse(fs.readFileSync(f, 'utf8')).features;
  const names = new Set(countries.flatMap(c => [c.properties.NAME_RU, c.properties.NAME_EN, c.properties.NAME]).filter(Boolean).map(s => s.toLowerCase()));
  const clash = zones.filter(z => names.has(z.nameRu.toLowerCase()));
  assert.deepEqual(clash.map(z => z.nameRu), []);
});

test('zones.json: labels read left-to-right (or bottom-to-top when vertical)', () => {
  for (const z of zones) {
    const a = toVec(...z.path[0]), b = toVec(...z.path[z.path.length - 1]);
    const mid = toVec(...z.path[z.path.length >> 1]);
    const { e, n } = eastNorth(mid);
    const ch = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ce = dot(ch, e), cn = dot(ch, n), cl = Math.hypot(ce, cn);
    if (Math.abs(ce) >= 0.17 * cl) assert.ok(ce > 0, `${z.id} runs right-to-left`);
    else assert.ok(cn > 0, `${z.id} vertical label must read bottom-to-top`);
  }
});

test('zones.json: every path point lies inside its source polygon', { skip: !fs.existsSync(path.join(RAW, 'ne_10m_geography_regions_polys.geojson')) && 'raw Natural Earth files missing' }, () => {
  const byKey = new Map();   // "src:key" -> parts (all same-name features, as merged by the baker)
  for (const [file, src, nameF] of [['ne_10m_geography_regions_polys.geojson', 'land', 'NAME'], ['ne_10m_geography_marine_polys.geojson', 'sea', 'name']]) {
    for (const f of JSON.parse(fs.readFileSync(path.join(RAW, file), 'utf8')).features) {
      let k = keyOf(f.properties[nameF]);
      if (k === 'queenmaudemountains') k = 'queenmaudmountains';
      const key = `${src}:${k}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(...partsOf(f.geometry));
    }
  }
  const bad = [];
  let checked = 0;
  for (const z of zones) {
    let k = keyOf(z.neName);
    if (k === 'queenmaudemountains') k = 'queenmaudmountains';
    const parts = byKey.get(`${z.water ? 'sea' : 'land'}:${k}`);
    assert.ok(parts, `${z.id}: source feature ${z.neName}`);
    for (const [lon, lat] of z.path) {
      checked++;
      if (pointInParts(lon, lat, parts)) continue;
      const d = distToPartsKm(lon, lat, parts);
      // degenerate source polygons (slivers / hand-placed) only need to be near their feature
      const tol = z.fallback ? Math.max(300, z.lengthKm) : Math.max(5, 0.01 * z.lengthKm);
      if (d > tol) bad.push(`${z.id} (${lon},${lat}) ${d.toFixed(1)} km outside`);
    }
  }
  assert.ok(checked > 2000);
  assert.deepEqual(bad, []);
});

// Cross-check with the game's own land/water grid (cells.bin.gz: 0 ocean, 1 lake, >= 2 land).
const CELLS = path.join(ROOT, 'public', 'assets', 'map', 'cells.bin.gz');
test('labels sit on the right side of the coastline (game land/water grid)', { skip: !fs.existsSync(CELLS) && 'map not baked' }, () => {
  const buf = zlib.gunzipSync(fs.readFileSync(CELLS));
  const W = 8192, H = 4096;
  const cells = new Uint32Array(buf.buffer, buf.byteOffset, W * H);
  const water = (lon, lat) => cells[Math.min(H - 1, Math.floor((90 - lat) / 180 * H)) * W + Math.min(W - 1, Math.floor((lon + 180) / 360 * W))] < 2;
  const bad = [];
  for (const z of zones) {
    const c = sampleCurve(z.path);
    let w = 0;
    const N = 40;
    for (let i = 0; i <= N; i++) if (water(...toLonLat(curveAt(c, c.length * i / N).p))) w++;
    const f = w / (N + 1);
    // narrow fjords and straits (a few km) are below the 4.9 km grid, hence the looser bound for small letters
    if (z.water && f < (z.letterHeightKm >= 8 ? 0.6 : 0.3)) bad.push(`${z.id}: water label ${(f * 100).toFixed(0)}% on water`);
    if (!z.water && f > 0.4) bad.push(`${z.id}: land label ${(f * 100).toFixed(0)}% on water`);
  }
  assert.deepEqual(bad, []);
  // hand-placed strait / bay lines lie entirely on water
  for (const [key, pts] of Object.entries(MANUAL_PATH)) for (const [lon, lat] of pts) assert.ok(water(lon, lat), `${key} (${lon},${lat}) on water`);
});

test('baker is deterministic and zones.json is up to date', async () => {
  if (!fs.existsSync(path.join(RAW, 'ne_10m_geography_regions_polys.geojson'))) return;
  const { bakeZone } = await import('../scripts/labels/bake-labels.mjs');
  const land = JSON.parse(fs.readFileSync(path.join(RAW, 'ne_10m_geography_regions_polys.geojson'), 'utf8'));
  for (const name of ['HIMALAYAS', 'SAHARA']) {
    const f = land.features.find(x => x.properties.NAME === name);
    const z = {
      key: keyOf(name), src: 'land', neClass: f.properties.FEATURECLA, neId: f.properties.NE_ID, kind: name === 'SAHARA' ? 'desert' : 'range',
      nameEn: f.properties.NAME_EN, nameRuNE: f.properties.NAME_RU, scalerank: f.properties.SCALERANK, minLabel: f.properties.MIN_LABEL,
      parts: partsOf(f.geometry),
    };
    const a = bakeZone(z, null).zone, b = bakeZone(z, null).zone;
    assert.deepEqual(a.path, b.path, 'deterministic');
    const stored = zones.find(x => x.neName === name);
    assert.deepEqual(a.path, stored.path, `${name}: zones.json matches the baker`);
    assert.equal(a.letterHeightKm, stored.letterHeightKm);
  }
});

// ------------------------------------------------------------------ glyph atlas
test('atlas covers every character used by the labels (ru and en)', () => {
  for (const lang of ['ru', 'en']) {
    const { regular, italic } = collectGlyphs(zones, lang);
    const atlas = buildGlyphAtlas({ regular, italic, createCanvas: fakeCanvas, emPx: 64 });
    for (const z of zones) {
      for (const ch of labelText(z, lang)) {
        if (/\s/.test(ch)) continue;
        assert.ok(atlas.glyphs.has(glyphKey(ch, isWater(z))), `${lang}: glyph "${ch}" for ${z.id}`);
      }
    }
    // cells inside the texture and not overlapping
    const cells = [...atlas.glyphs.values()].map(g => [g.u0 * atlas.width, g.v1 * atlas.height, g.u1 * atlas.width, g.v0 * atlas.height]);
    for (const [x0, y0, x1, y1] of cells) assert.ok(x0 >= 0 && y0 >= 0 && x1 <= atlas.width + 1e-6 && y1 <= atlas.height + 1e-6 && x1 > x0 && y1 > y0);
    for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i], b = cells[j];
      const overlap = a[0] < b[2] - 1e-6 && b[0] < a[2] - 1e-6 && a[1] < b[3] - 1e-6 && b[1] < a[3] - 1e-6;
      assert.ok(!overlap, 'atlas cells overlap');
    }
    assert.ok(atlas.width <= 2048);
  }
});

test('bundled Alegreya SC fonts contain every character used', { skip: !fs.existsSync(path.join(FONTS, 'AlegreyaSC-Medium.ttf')) && 'fonts not downloaded' }, () => {
  const { regular, italic } = collectGlyphs(zones, 'ru');
  const en = collectGlyphs(zones, 'en');
  const reg = fontCodePoints(path.join(FONTS, 'AlegreyaSC-Medium.ttf'));
  const ita = fontCodePoints(path.join(FONTS, 'AlegreyaSC-MediumItalic.ttf'));
  const miss = (set, cps) => [...set].filter(ch => !cps.has(ch.codePointAt(0)));
  assert.deepEqual(miss(regular, reg), []);
  assert.deepEqual(miss(italic, ita), []);
  assert.deepEqual(miss(en.regular, reg), []);
  assert.deepEqual(miss(en.italic, ita), []);
});

// ------------------------------------------------------------------ layout on the sphere
test('layout: glyph quads follow the curve, upright, both reading directions', () => {
  const { regular, italic } = collectGlyphs(zones, 'ru');
  const atlas = buildGlyphAtlas({ regular, italic, createCanvas: fakeCanvas, emPx: 64 });
  const sahara = zones.find(z => z.nameEn === 'Sahara');
  const lay = layoutLabel(sahara, sahara.nameRu, atlas);
  assert.equal(lay.quads.length, [...sahara.nameRu].length);
  for (const q of lay.quads) {
    for (const v of [...q.fwd, ...q.rev]) {
      assert.ok(v.every(Number.isFinite));
      assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-9);
    }
    // grid corner 0 = bottom-left, 6 = top-left (SUB = 2): top is north of bottom for a west->east label
    const lb = toLonLat(q.fwd[0]), lt = toLonLat(q.fwd[6]);
    assert.ok(lt[1] > lb[1], 'glyph top points north');
    const rb = toLonLat(q.rev[0]), rt = toLonLat(q.rev[6]);
    assert.ok(rt[1] < rb[1], 'reversed glyph is turned 180°');
  }
  // letters advance eastward along the label
  const firstLon = toLonLat(lay.quads[0].fwd[4])[0], lastLon = toLonLat(lay.quads[lay.quads.length - 1].fwd[4])[0];
  assert.ok(lastLon > firstLon);
  // the text spans most of the baked path
  assert.ok(lay.textLenKm > 0.8 * lay.curveLenKm && lay.textLenKm <= lay.curveLenKm * 1.0001);
  // letter size matches the baked height (font em = letterHeightKm)
  const g = lay.quads[0].glyph;
  const hKm = gcKm(lay.quads[0].fwd[0], lay.quads[0].fwd[6]);
  assert.ok(Math.abs(hKm - (g.y1 - g.y0) * lay.letterHeightKm) < 0.02 * hKm);
});

test('layout: every label builds without NaN', () => {
  const { regular, italic } = collectGlyphs(zones, 'ru');
  const atlas = buildGlyphAtlas({ regular, italic, createCanvas: fakeCanvas, emPx: 64 });
  let quads = 0;
  for (const z of zones) {
    const lay = layoutLabel(z, z.nameRu, atlas);
    assert.ok(lay.letterHeightKm > 0 && lay.letterHeightKm <= z.letterHeightKm + 1e-9, z.id);
    for (const q of lay.quads) for (const v of q.fwd) assert.ok(Number.isFinite(v[0] + v[1] + v[2]), z.id);
    for (const p of [lay.center, lay.centerUp, lay.centerAlong, ...lay.samples]) assert.ok(p.every(Number.isFinite), z.id);
    quads += lay.quads.length;
  }
  assert.ok(quads > 5000 && quads < 40000, `${quads} glyph quads`);
});

// ------------------------------------------------------------------ the runtime layer (no WebGL needed)
async function makeLayer({ palette, settings = { palette: 'sepia', showLabels: true } } = {}) {
  const scene = new THREE.Scene();
  // globe.shared as Globe builds it, but never updated here: the layer must not depend on it being current
  const globe = {
    settings,
    shared: {
      uF: { value: new THREE.Vector3(0, 0, 1) }, uR: { value: new THREE.Vector3(1, 0, 0) }, uU: { value: new THREE.Vector3(0, 1, 0) },
      uCurv: { value: 1 }, uExag: { value: 1 / 6371000 }, uHeight: { value: null }, uGrid: { value: new THREE.Vector2(8192, 4096) },
    },
  };
  const clock = { t: 100 };
  const gcam = new GlobeCamera(new THREE.PerspectiveCamera(34, 1920 / 1080, 0.001, 50), { unroll: 0.85, reliefScale: 1 });
  const layer = new ZoneLabels(scene, globe, {
    zones: doc, palette, createCanvas: fakeCanvas, now: () => clock.t,
    renderer: { domElement: { clientWidth: 1920, clientHeight: 1080 } },
  });
  await layer.ready$;
  assert.ok(layer.ready && scene.children.includes(layer.mesh));
  const look = (lat, lon, alt) => { gcam.lookAt(lat, lon, alt); gcam.alt = alt; gcam.update(0, 0); };
  const idx = id => layer.zones.findIndex(z => z.id === id);
  return { layer, gcam, globe, clock, look, idx, scene };
}

test('ZoneLabels: shows the right labels, independent of globe.update() order', async () => {
  const { layer, gcam, look, idx } = await makeLayer();
  look(22, 15, 2.0);
  for (let k = 0; k < 30; k++) layer.update(gcam, 10 + k * 0.1);
  const a = id => layer.alpha[idx(id)];
  assert.ok(a('sahara') > 0.9, `Сахара visible (alpha ${a('sahara')})`);
  assert.ok(a('mediterranean-sea') > 0.9, 'Средиземное море visible');
  assert.equal(a('pacific-ocean'), 0, 'far side of the globe stays hidden');
  assert.equal(a('danube-delta'), 0, 'tiny labels hidden from afar');
  assert.ok(layer.alpha.every(Number.isFinite));
  // GPU data texture mirrors alpha + flip; water flag set for seas
  assert.equal(layer.labelData[idx('sahara') * 4], layer.alpha[idx('sahara')]);
  assert.equal(layer.labelData[idx('mediterranean-sea') * 4 + 3], 1);
  assert.equal(layer.labelData[idx('sahara') * 4 + 3], 0);

  // zoomed in, the globe is "unrolled" (curv < 1): the CPU pass must use this frame's camera even when
  // globe.shared is stale (main.js runs world updaters before globe.update)
  const run = () => {
    layer.lastT = null; layer.alpha.fill(0); layer.flip.fill(0);
    look(46.5, 10, 0.4);
    for (let k = 0; k < 20; k++) layer.update(gcam, 50 + k * 0.1);
    return Float32Array.from(layer.alpha);
  };
  const stale = run();
  assert.ok(gcam.derived.curv < 0.9, 'unrolled view');
  const sh = layer.globe.shared;          // now as Globe.update() would set it
  sh.uF.value.copy(gcam.F); sh.uR.value.crossVectors(gcam.U, gcam.F); sh.uCurv.value = gcam.derived.curv; sh.uExag.value = gcam.derived.exag / 6371000;
  const fresh = run();
  assert.deepEqual(stale, fresh);
  assert.ok(fresh[idx('alps')] > 0.9, 'Альпы visible over the Alps at alt 0.4');
  layer.dispose();
  assert.equal(layer.mesh, null);
});

test('ZoneLabels: a degenerate camera frame (zero-size window) does not poison the fades', async () => {
  const { layer, gcam, look, idx } = await makeLayer();
  look(22, 15, 2.0);
  layer.update(gcam, 1);
  gcam.cam.aspect = 0 / 0;                  // innerWidth / innerHeight while minimised
  gcam.cam.updateProjectionMatrix();
  for (let k = 0; k < 5; k++) layer.update(gcam, 1.1 + k * 0.1);
  assert.ok(layer.alpha.every(Number.isFinite), 'no NaN after the bad frames');
  gcam.cam.aspect = 1920 / 1080;
  gcam.cam.updateProjectionMatrix();
  for (let k = 0; k < 30; k++) layer.update(gcam, 2 + k * 0.1);
  assert.ok(layer.alpha[idx('sahara')] > 0.9, 'labels come back once the window is restored');
  assert.ok(layer.labelData.every(Number.isFinite));
});

test('ZoneLabels: fades keep moving when timeSec is missing or constant (wall-clock fallback)', async () => {
  const { layer, gcam, look, idx, clock } = await makeLayer();
  look(22, 15, 2.0);
  layer.update(gcam, 0);                    // first frame snaps
  const s = idx('sahara');
  assert.ok(layer.alpha[s] > 0.9);
  look(22, 15, 0.12);                       // zoom in: the Sahara letters get far too big -> fade out
  const before = layer.alpha[s];
  for (let k = 0; k < 10; k++) { clock.t += 0.1; layer.update(gcam, 0); }   // constant timeSec
  assert.ok(layer.alpha[s] < before * 0.5, `faded with constant timeSec (${before} -> ${layer.alpha[s]})`);
  look(22, 15, 2.0);
  for (let k = 0; k < 15; k++) { clock.t += 0.1; layer.update(gcam); }      // no timeSec at all
  assert.ok(layer.alpha[s] > 0.9, 'faded back in without timeSec');
});

test('ZoneLabels: two-argument construction follows the game settings; undefined options keep defaults', async () => {
  const { layer } = await makeLayer({ settings: { palette: 'sepia', showLabels: false } });
  assert.equal(layer.visible, false, 'settings.showLabels = false');
  assert.equal(layer.mesh.visible, false);
  assert.equal(layer.opts.palette, 'sepia');
  assert.equal(layer.opts.fontFamily, 'Alegreya SC, Georgia, serif');
  const ink = layer.material.uniforms.uInk.value;
  assert.ok(Math.abs(ink.r - 0.16) < 1e-6 && Math.abs(ink.b - 0.07) < 1e-6, 'sepia ink');
  layer.setVisible(true);
  assert.equal(layer.mesh.visible, true);
  const l2 = new ZoneLabels(new THREE.Scene(), { shared: layer.globe.shared }, { zones: doc, fontFamily: undefined, createCanvas: fakeCanvas });
  assert.equal(l2.opts.fontFamily, 'Alegreya SC, Georgia, serif', 'explicit undefined does not wipe the default font');
  assert.equal(l2.visible, true);
  await l2.ready$;
  l2.dispose();
});

test('curve sampling across the antimeridian stays short', () => {
  const c = sampleCurve([[170, 10], [180, 12], [-170, 10]]);
  assert.ok(c.length > 2000 && c.length < 2400, `${c.length} km`);
});

// ------------------------------------------------------------------ helpers
test('geometry helpers', () => {
  const c = toVec(37.6, 55.7);
  const proj = makeAeqd(c);
  for (const [lon, lat] of [[37.6, 55.7], [30, 60], [100, -20], [-170, 70]]) {
    const v = toVec(lon, lat), p = proj.fwd(v), w = proj.inv(p[0], p[1]);
    assert.ok(Math.hypot(v[0] - w[0], v[1] - w[1], v[2] - w[2]) < 1e-9);
    assert.ok(Math.abs(Math.hypot(...p) - gcKm(c, v)) < 1e-6, 'radial distances are true');
  }
  // EDT of a 5x5 square inside a 9x9 grid: centre is 3 px from the outside
  const W = 9, m = new Uint8Array(W * W);
  for (let y = 2; y < 7; y++) for (let x = 2; x < 7; x++) m[y * W + x] = 1;
  const d = edtSq(m, W, W, 1);
  assert.equal(d[4 * W + 4], 9);
  assert.equal(d[2 * W + 2], 1);
  assert.equal(d[0], 0);
  assert.ok(bendRange([[0, 0], [1, 0], [2, 0]]) < 1e-12);
  assert.ok(Math.abs(bendRange([[0, 0], [1, 0], [1, 1], [0, 1]]) - Math.PI) < 1e-9);
});

test('segment distance matches brute force', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 100;
  for (let k = 0; k < 300; k++) {
    const s = [rnd(), rnd(), rnd(), rnd(), rnd(), rnd(), rnd(), rnd()];
    if (k % 10 === 0) { s[2] = s[0]; s[3] = s[1]; }       // degenerate segment
    let best = Infinity;
    for (let i = 0; i <= 200; i++) for (let j = 0; j <= 200; j++) {
      const a = i / 200, b = j / 200;
      const dx = s[0] + (s[2] - s[0]) * a - (s[4] + (s[6] - s[4]) * b), dy = s[1] + (s[3] - s[1]) * a - (s[5] + (s[7] - s[5]) * b);
      best = Math.min(best, dx * dx + dy * dy);
    }
    const got = _segDist2(...s);
    assert.ok(got <= best + 1e-6 && Math.sqrt(best) - Math.sqrt(got) < 1, `seg ${k}: ${got} vs ${best}`);
  }
});

test('name helpers', () => {
  assert.equal(keyOf('Yam Alin’ Range'), 'yamalinrange');
  assert.equal(keyOf('PEN. DE YUCATÁN'), 'pendeyucatan');
  assert.equal(cleanRu('Море Бофорта'), 'море Бофорта');
  assert.equal(cleanRu('Грампиа́нские го́ры'), 'Грампианские горы');
  assert.equal(cleanRu('Земля Дампира'), 'Земля Дампира');
});
