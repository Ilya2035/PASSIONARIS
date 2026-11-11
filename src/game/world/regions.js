// Natural districts integration (regions module: public/assets/regions/).
//   district ~100 km (between rivers; mountain massifs and lakes apart) → province ~500 km → region ~1000 km,
//   plus sea zones whose borders show only up close, and thin "logical" roads between neighbouring districts.
//
// GPU cell raster (R32UI, MAP grid 8192x4096) after this module:
//   0 open ocean (unassigned), 1 lake, 2.. land district (id + 1), SEA_BIT | id sea zone.
// The shader's cellAt() masks SEA_BIT to 0 (water), rawAt() keeps it for sea-zone borders.
import * as THREE from 'three';
import { RIVER_VERT, RIVER_FRAG } from '../shaders.js';
import { loadCoastFix, fixDistricts } from '../terrain/coast.js';

export const SEA_BIT = 0x40000000;
const BASE = 'assets/regions/';
const TYPE_RU = { land: 'Равнина', mountain: 'Горы', lake: 'Озеро', sea: 'Морская зона' };

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(ds).arrayBuffer());
  }
  return buf;
}

// muted, period-appropriate families (no loud primaries); each region takes one, provinces and districts vary its shade
const FAMILIES = [
  [0.72, 0.42, 0.33], [0.42, 0.55, 0.38], [0.36, 0.48, 0.62], [0.78, 0.63, 0.34], [0.55, 0.42, 0.58],
  [0.33, 0.58, 0.56], [0.66, 0.5, 0.36], [0.6, 0.62, 0.36], [0.47, 0.42, 0.66], [0.74, 0.5, 0.52],
  [0.4, 0.5, 0.48], [0.68, 0.58, 0.48],
];
const hash = n => { let x = (n | 0) * 0x45d9f3b; x = ((x >>> 16) ^ x) * 0x45d9f3b; x = (x >>> 16) ^ x; return (x >>> 0) / 4294967296; };

// greedy graph colouring of regions so neighbours never share a family
function assignFamilies(regions) {
  const fam = new Map();
  const order = regions.slice().sort((a, b) => (b.neighbors?.length || 0) - (a.neighbors?.length || 0));
  for (const r of order) {
    const used = new Set((r.neighbors || []).map(n => fam.get(n)).filter(v => v !== undefined));
    let pick = Math.floor(hash(r.id) * FAMILIES.length);
    for (let k = 0; k < FAMILIES.length && used.has(pick); k++) pick = (pick + 1) % FAMILIES.length;
    fam.set(r.id, pick);
  }
  return fam;
}

export async function createRegions({ globe, scene, settings, infoW }) {
  const [meta, raster, coast] = await Promise.all([
    fetch(BASE + 'regions.json').then(r => { if (!r.ok) throw new Error(`regions.json: ${r.status}`); return r.json(); }),
    fetchBytes(BASE + 'districts.bin.gz'),
    loadCoastFix(),
  ]);
  const { W, H } = globe.data;
  if (meta.grid.width !== W || meta.grid.height !== H) throw new Error('regions: grid size differs from the map');
  const ids = new Uint16Array(raster.buffer, raster.byteOffset, W * H);
  // one coastline for every zoom, as in 5000 BC: lost islands, reservoirs, the IJsselmeer basin (terrain/coast.js)
  fixDistricts(ids, coast, meta.districts.length);

  const maxId = meta.districts.reduce((m, d) => Math.max(m, d.id), 0);
  const dist = new Array(maxId + 1);
  for (const d of meta.districts) dist[d.id] = d;
  const prov = new Map(meta.provinces.map(p => [p.id, p]));
  const reg = new Map(meta.regions.map(r => [r.id, r]));
  const kind = new Uint8Array(maxId + 1); // 0 none, 1 land, 2 mountain, 3 lake, 4 sea
  for (const d of meta.districts) kind[d.id] = d.type === 'land' ? 1 : d.type === 'mountain' ? 2 : d.type === 'lake' ? 3 : 4;

  // ---- new cell raster (keeps the old land / water decision where a pixel is unassigned)
  const old = globe.data.cells;
  const cells = new Uint32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const d = ids[i];
    const k = d ? kind[d] : 0;
    if (k === 1 || k === 2) cells[i] = d + 1;
    else if (k === 3) cells[i] = 1;
    else if (k === 4) cells[i] = (SEA_BIT | d) >>> 0;
    else cells[i] = old[i] >= 2 ? 2 : old[i];
  }

  // ---- info (province, region) and colour per encoded land id
  const rows = Math.ceil((maxId + 2) / infoW);
  const info = new Uint16Array(infoW * rows * 2);
  const colors = new Uint8Array(infoW * rows * 4);
  const fam = assignFamilies(meta.regions);
  for (const d of meta.districts) {
    if (d.type !== 'land' && d.type !== 'mountain') continue;
    const e = d.id + 1;
    info[e * 2] = d.province;
    info[e * 2 + 1] = d.region;
    const base = FAMILIES[fam.get(d.region) ?? 0];
    const pv = (hash(d.province * 7 + 3) - 0.5) * 0.34;   // province shade within the family
    const ph = (hash(d.province * 11 + 5) - 0.5) * 0.12;  // and a slight warm / cool turn
    const dv = (hash(d.id * 13 + 1) - 0.5) * 0.08;        // district shimmer
    const k = 1 + pv + dv;
    let c = base.map((v, j) => Math.min(1, Math.max(0, v * k + (pv > 0 ? pv * 0.18 : 0) + ph * [1, 0.2, -1][j])));
    if (d.type === 'mountain') c = c.map((v, j) => v * 0.78 + [0.5, 0.47, 0.44][j] * 0.22);
    colors.set([Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255), 205], e * 4);
  }
  globe.setRegions({ cells, info, colors, rows });

  // ---- roads: thin ink lines between district centres, along the cheapest relief path
  let roads = null;
  try {
    const [rjson, rbytes] = await Promise.all([
      fetch(BASE + 'roads.json').then(r => (r.ok ? r.json() : null)),
      fetchBytes(BASE + 'roads.bin.gz'),
    ]);
    if (rjson) {
      const pts = new Float32Array(rbytes.buffer, rbytes.byteOffset, rbytes.byteLength >> 2);
      const list = Array.isArray(rjson) ? rjson : rjson.roads;
      let nSeg = 0;
      for (const r of list) nSeg += Math.max(0, r.count - 1);
      const pos = new Float32Array(nSeg * 6);
      let o = 0;
      for (const r of list) {
        for (let k = 0; k < r.count - 1; k++) {
          const a = (r.offset + k) * 2, b = a + 2;
          pos[o++] = pts[a]; pos[o++] = pts[a + 1]; pos[o++] = 0;
          pos[o++] = pts[b]; pos[o++] = pts[b + 1]; pos[o++] = 0;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: RIVER_VERT,
        fragmentShader: RIVER_FRAG,
        uniforms: { ...globe.shared, uLift: { value: 0 }, uMaxRank: { value: 99 }, uOpacity: { value: 0 }, uRiverC: { value: new THREE.Color(0.36, 0.27, 0.19) } },
        transparent: true,
        depthWrite: false,
      });
      const lines = new THREE.LineSegments(g, mat);
      lines.frustumCulled = false;
      lines.renderOrder = 2;
      lines.visible = false;
      scene.add(lines);
      roads = { lines, mat, count: list.length };
    }
  } catch (e) { console.warn('roads', e); }

  // ---- lookups
  const idAt = (lat, lon) => {
    const x = Math.min(W - 1, Math.max(0, Math.floor((lon + 180) / 360 * W)));
    const y = Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / 180 * H)));
    return ids[y * W + x];
  };
  const encoded = d => (!d ? 0 : kind[d] === 1 || kind[d] === 2 ? d + 1 : 0);

  let mode = 'terrain', hover = 0, selected = 0;
  return {
    meta, ids, dist, prov, reg, roads,
    idAt,
    setMode(m) { mode = m; globe.setHover(mode === 'regions' ? hover : 0); globe.setSelected(mode === 'regions' ? selected : 0); },
    onHover(geo) { hover = geo ? encoded(idAt(geo.lat, geo.lon)) : 0; if (mode === 'regions') globe.setHover(hover); },
    onSelect(geo) { selected = geo ? encoded(idAt(geo.lat, geo.lon)) : 0; if (mode === 'regions') globe.setSelected(selected); },
    update(gcam) {
      if (!roads) return;
      const show = settings.showRoads !== false && gcam.alt < 0.5 && (mode === 'regions' || mode === 'terrain' || mode === 'relief');
      roads.lines.visible = show;
      if (show) {
        roads.mat.uniforms.uLift.value = gcam.alt * 0.0015;
        const k = Math.min(1, Math.max(0, (Math.log(0.5) - Math.log(gcam.alt)) / (Math.log(0.5) - Math.log(0.12))));
        roads.mat.uniforms.uOpacity.value = (mode === 'regions' ? 0.42 : 0.2) * k;
      }
    },
    // info window rows + title for a point (regions mode shows the district as the title)
    describe(lat, lon) {
      const d = dist[idAt(lat, lon)];
      if (!d) return null;
      const p = prov.get(d.province), r = reg.get(d.region);
      const rows = [
        ['Район', `${d.nameRu} · ${TYPE_RU[d.type] || d.type}`],
        ['Площадь', `${Math.round(d.areaKm2).toLocaleString('ru-RU')} км²`],
      ];
      if (p) rows.push(['Провинция', p.nameRu]);
      if (r) rows.push(['Регион', r.nameRu]);
      return { title: d.nameRu, kicker: r?.nameRu, rows, type: d.type };
    },
  };
}
