// The division at work on the album page: works it out from the chunks and the list of historical lands (build.js,
// public/assets/album/division/), hands it to the shader (gpu.js), writes the names of the lands (labels.js), answers
// the cursor (hover lights a district up, a click opens what it holds) and serves the other aspects:
//   album.division = { districtOf(k), chunksOf(d), provinceOf(d), regionOf(p), neighbours(d), kind(d), name(d), … }
//   album.districts = { count, of(k), name(i) } — the same, in the form the resources work asked for
import { buildDivision, districtSummary, districtNames, stateMask, KIND_ID, LAND, levelSizes } from './build.js';
import { divisionTexture, districtOfTexel } from './gpu.js';
import { createPanel } from './panel.js';
import { createLabels } from './labels.js';
import { createLines } from './lines.js';
import { pickGround } from '../pick.js';
import { FN, FKM, kmOf } from '../chunks.js';
import { BBOX } from '../geo.js';

const inside = (lat, lon) => lat > BBOX.lat0 && lat < BBOX.lat1 && lon > BBOX.lon0 && lon < BBOX.lon1;
const load = async name => (await fetch(`assets/album/division/${name}`)).json();

export async function startDivision(album, U) {
  const ch = album.chunks, p = album.params, data = album.data, dom = album.renderer.domElement;
  const [lands, admin] = await Promise.all([load('lands.json'), load('admin.json')]);
  const opts = { lands, admin, heightAt: data.base.at, lakes: data.vectors.lakes || [], rivers: data.vectors.rivers || [] };
  const cache = new Map();                              // size → { div, tex, state }: switching the size back costs nothing
  const listeners = [], labels = createLabels(album);
  let cur = null, hover = -1, sel = -1, last = null, down = null, shownVersion = -1, tick = 0, lines = null;

  const active = () => p.get('division') > 0 || !!p.get('divPick');
  function use(size) {
    if (!cache.has(size)) {
      const div = buildDivision(ch, { ...opts, size });
      div.names = districtNames(ch, div, data.vectors.places || []);
      cache.set(size, { div, tex: null, state: null });
    }
    const next = cache.get(size);
    if (next === cur) return;
    cur = next; hover = -1; select(-1); api.version++;
    const s = levelSizes(cur.div.size); U.uDivSize.value.set(s.district, s.province, s.region);
    paintState(true);
    console.log(`[album] division ${size} km: ${cur.div.count} districts, ${cur.div.provinceCount} provinces, ${cur.div.regionCount} regions, ${cur.div.moved.length} slopes moved to their valleys (${cur.div.ms.toFixed(0)} ms)`);
    for (const f of listeners) f(api);
  }
  // the state of history shown (knob «Деление: государство»): one bit per chunk in the texture
  function paintState(force) {
    const id = p.get('divState') || '';
    if (!force && cur.state === id) return;
    cur.tex?.dispose();
    const mask = id ? stateMask(cur.div, lands, id) : null;
    cur.tex = divisionTexture(ch, cur.div, mask); cur.state = id;
    U.tDiv.value = cur.tex; U.uDivState.value = id ? 1 : 0; U.uDivOn.value = 1;
    lines?.dispose(); lines = createLines(album, ch, cur.div, mask, data.vectors.rivers);
  }
  // the district at a point of the ground, as the shader draws it: the district of the texel of the fine raster
  // there (division/cells.js); a point of land in a texel of water (or the other way round, at the shore) takes the
  // nearest texel of its own kind
  function districtAt(lat, lon) {
    if (!inside(lat, lon)) return -1;
    const k = ch.at(lat, lon); if (k < 0) return -1;
    const land = data.base.at(lat, lon) > 0, dv = cur.div, of = t => districtOfTexel(ch, dv, t);
    const [x, y] = kmOf(lat, lon), tx = Math.max(0, Math.min(FN - 1, Math.floor((x + 880) / FKM))), ty = Math.max(0, Math.min(FN - 1, Math.floor((y - 3880) / FKM))), here = of(ty * FN + tx);
    if ((dv.kinds[here] === LAND) === land) return here;
    for (let r = 1; r <= 2; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const u = tx + dx, v = ty + dy; if (u < 0 || v < 0 || u >= FN || v >= FN) continue;
      const d = of(v * FN + u);
      if ((dv.kinds[d] === LAND) === land) return d;
    }
    return here;
  }
  const atScreen = (x, y) => { const ll = pickGround(album, x, y); return ll ? districtAt(ll.lat, ll.lon) : -1; };

  const panel = createPanel(() => select(-1));
  function select(d) {
    sel = d; U.uDivSel.value = d;
    panel.show(d >= 0 ? districtSummary(cur.div, d, ch) : null);
    shownVersion = ch.version;
  }
  // which names the map carries: regions in the regions mode, provinces otherwise, the state when one is shown
  function syncLabels() {
    const mode = p.get('division'), st = p.get('divState');
    if (!mode || !p.get('divLabels')) return labels.hide();
    const L = cur.div.labels, list = [];
    if (mode === 3) L.region.forEach((u, i) => u && list.push({ ...u, level: 'region', sea: cur.div.regions[i].kind !== LAND }));
    else L.province.forEach((u, i) => u && cur.div.provinces[i].kind === LAND && list.push({ ...u, level: 'province' }));
    if (st) {
      const s = lands.states.find(x => x.id === st), mask = stateMask(cur.div, lands, st);
      let sx = 0, sy = 0, sa = 0; for (let k = 0; k < ch.count; k++) if (mask[k]) { sx += ch.cx[k] * ch.area[k]; sy += ch.cy[k] * ch.area[k]; sa += ch.area[k]; }
      if (s && sa) { let best = -1, bd = Infinity; for (let k = 0; k < ch.count; k++) if (mask[k]) { const dd = (ch.cx[k] - sx / sa) ** 2 + (ch.cy[k] - sy / sa) ** 2; if (dd < bd) { bd = dd; best = k; } } list.push({ name: s.name, level: 'state', area: sa * 4, ...ch.centre(best) }); }
    }
    labels.set(list, `${cur.div.size}|${mode}|${st}|${list.length}`);
  }

  // a click without moving the mouse picks a district; a drag moves the camera (camera.js); with the brush on, the
  // click belongs to the brush (chunktool.js)
  dom.addEventListener('pointerdown', e => { down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null; });
  dom.addEventListener('pointerup', e => {
    const d0 = down; down = null;
    if (!d0 || Math.hypot(e.clientX - d0.x, e.clientY - d0.y) >= 5 || p.get('brush') || !active()) return;
    select(atScreen(e.clientX, e.clientY));
  });
  dom.addEventListener('pointermove', e => { last = e; });
  dom.addEventListener('pointerleave', () => { last = null; });

  // a page may open with one district chosen: page.divAt = [lat, lon]
  p.on(key => {
    if (key == null || key === 'divSize') use(+p.get('divSize') || 20);
    if (key == null || key === 'divState') paintState(false);
    if (!active() && key !== null && sel >= 0) select(-1);
    if (key == null) { const at = album.page?.divAt; select(at ? districtAt(at[0], at[1]) : -1); }
    syncLabels();
  });

  const api = {
    version: 0,
    get size() { return cur.div.size; },
    get count() { return cur.div.count; },
    get provinces() { return cur.div.provinceCount; },
    get regions() { return cur.div.regionCount; },
    districtOf: k => cur.div.district[k] ?? -1,
    chunksOf: d => cur.div.chunks[d] || [],
    provinceOf: d => cur.div.province[d] ?? -1,
    regionOf: pv => cur.div.region[pv] ?? -1,
    provinceName: pv => cur.div.provinces[pv]?.name ?? '',
    // for every chunk: its province (on land; a lake belongs to the land around it) and its sea (on water, else −1)
    provinceOfChunk: k => (cur.div.district[k] >= 0 ? cur.div.province[cur.div.district[k]] : -1),
    seaOfChunk: k => cur.div.seaOf[k] ?? -1,
    get seas() { return lands.seas.length; },
    // the name at a level: 'district', 'province', 'region' or 'sea' (the sea's number from seaOfChunk); name(d) alone —
    // the name of district d, as before
    name: (level, id) => (typeof level === 'number' ? cur.div.names[level] : level === 'district' ? cur.div.names[id] : level === 'province' ? cur.div.provinces[id]?.name
      : level === 'region' ? cur.div.regions[id]?.name : level === 'sea' ? lands.seas[id]?.name : undefined) ?? '',
    regionName: r => cur.div.regions[r]?.name ?? '',
    neighbours: d => cur.div.neighbours[d] || [],
    kind: d => KIND_ID[cur.div.kinds[d]],
    districtName: d => cur.div.names[d],
    districtAt,
    summary: d => districtSummary(cur.div, d, ch),
    select, get selected() { return sel; },
    onChange: fn => listeners.push(fn),
    get data() { return cur.div; },
    lands,
  };
  album.division = api;
  album.districts = { get count() { return cur.div.count; }, of: k => cur.div.district[k], name: i => cur.div.names[i], onChange: api.onChange };
  use(+p.get('divSize') || 20);

  // The borders are lines laid on the ground at every height, clear and of steady width: a line that runs beside a
  // river lies on the river itself (lines.js), which the outline of texels of 1.25 km cannot do — drawn by the ground
  // shader it wove from one bank to the other. The shader still fills the districts and lights the chosen one.
  const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function drawLines(cam) {
    const mode = p.get('division'), pxKm = 2 * cam.s.h * Math.tan(cam.cam.fov * Math.PI / 360) / Math.max(1, dom.clientHeight);
    const far = mode ? 1 : 0;
    U.uDivFar.value = far;
    if (!lines) return;
    const base = mode === 1 ? [.8, .9, 1] : mode === 2 ? [.35, .9, 1] : mode === 3 ? [0, .45, 1] : [0, 0, 0];
    const s = levelSizes(cur.div.size), fade = [ss(9, 24, s.district / pxKm), ss(9, 24, s.province / pxKm), 1];
    const alpha = {};
    for (let l = 0; l < 3; l++) { alpha[l * 2] = base[l] * fade[l] * far; alpha[l * 2 + 1] = base[l] * fade[l] * far * .6; }
    alpha[6] = mode && p.get('divState') ? far : 0;
    lines.update(cam, dom, alpha, p.get('look'));
  }

  return { id: 'division', update(dt, t, cam) {
    drawLines(cam);
    if (p.get('division') && p.get('divLabels')) labels.update(cam, p.get('look'));
    if (tick++ % 3) return;
    const h = active() && last && !p.get('brush') && !down ? atScreen(last.clientX, last.clientY) : -1;
    if (h !== hover) { hover = h; U.uDivHover.value = h; dom.style.cursor = h >= 0 ? 'pointer' : ''; }
    if (sel >= 0 && shownVersion !== ch.version && tick % 15 === 1) { panel.show(districtSummary(cur.div, sel, ch)); shownVersion = ch.version; }
  } };
}
