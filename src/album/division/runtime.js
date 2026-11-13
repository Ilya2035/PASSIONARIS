// The division at work on the album page: works it out from the chunks and the list of historical lands (build.js,
// public/assets/album/division/), hands it to the shader (gpu.js), writes the names of the lands (labels.js), answers
// the cursor (hover lights a district up, a click opens what it holds) and serves the other aspects:
//   album.division = { districtOf(k), chunksOf(d), provinceOf(d), regionOf(p), neighbours(d), kind(d), name(d), … }
//   album.districts = { count, of(k), name(i) } — the same, in the form the resources work asked for
import { buildDivision, districtSummary, districtNames, stateMask, KIND_ID, LAND, levelSizes } from './build.js';
import { divisionTexture, districtOfTexel } from './gpu.js';
import { districtCentres } from './centres.js';
import { loadSites } from '../town/sites.js';
import { createPanel } from './panel.js';
import { createLabels } from './labels.js';
import { createLines } from './lines.js';
import { districtByLines } from './border.js';
import { pickGround } from '../pick.js';
import { kmOf } from '../chunks.js';
import { KN as FN, KKM as FKM, kmFacts, kmOrder, kmData, chunkAt, seedOf, CLASS_TITLE, livingOf } from './km.js';
import { BBOX } from '../geo.js';

const inside = (lat, lon) => lat > BBOX.lat0 && lat < BBOX.lat1 && lon > BBOX.lon0 && lon < BBOX.lon1;
const load = async name => (await fetch(`assets/album/division/${name}`)).json();

export async function startDivision(album, U) {
  const ch = album.chunks, p = album.params, data = album.data, dom = album.renderer.domElement;
  const [lands, admin, osmSites] = await Promise.all([load('lands.json'), load('admin.json'), loadSites()]);
  // where people settled, the most important first: the places the album draws (where their houses really stand: a
  // settlement by a river is moved off the water), then the real towns and villages of the region (town/sites.js)
  const founded = new Map((album.layers.towns?.model?.()?.towns || []).map(t => [t.index, t]));
  const own = (data.vectors.places || []).map((pl, i) => { const t = founded.get(i), [x, y] = t ? [t.x, t.y] : kmOf(pl.lat, pl.lon); return { x, y, pop: pl.pop, name: pl.name }; });
  // (a town the album draws is in the other list too, a kilometre or two away: left out there, or the district next
  // door would take the same town for its centre)
  const sites = [...own, ...osmSites.filter(s => { const [x, y] = kmOf(s.lat, s.lon); return !own.some(o => Math.hypot(o.x - x, o.y - y) < 6); })];
  const opts = { lands, admin, heightAt: data.base.at, lakes: data.vectors.lakes || [], rivers: data.vectors.rivers || [] };
  const cache = new Map();                              // size → { div, tex, state }: switching the size back costs nothing
  const listeners = [], labels = createLabels(album);
  let cur = null, hover = -1, sel = -1, last = null, down = null, shownVersion = -1, tick = 0, lines = null, farmShown = -1, pinned = -1;

  const active = () => p.get('division') > 0 || !!p.get('divPick');
  // ---- the chunk of 1 km² under the cursor, while the chunks are shown (knob «Чанки 1 км²»)
  const kmInfo = document.createElement('div'); kmInfo.className = 'S km-info';
  kmInfo.style.cssText = 'position:fixed;left:50%;bottom:104px;transform:translateX(-50%);padding:6px 14px;background:rgba(12,16,24,.88);color:#fff;border-radius:3px;pointer-events:none;white-space:nowrap;display:none;z-index:5';
  document.body.appendChild(kmInfo);
  function chunkUnder(e) {
    const ll = e ? pickGround(album, e.clientX, e.clientY) : null; if (!ll || !inside(ll.lat, ll.lon)) return null;
    const d = districtAt(ll.lat, ll.lon); if (d < 0) return null;
    const [x, y] = kmOf(ll.lat, ll.lon), c = chunkAt(cur.div.cells, x, y, d); if (c < 0) return null;
    const dv = cur.div, land = dv.kinds[d] === LAND, parts = [`Чанк ${c % FN} · ${Math.floor(c / FN)}`, `район «${dv.names[d]}», чанков в нём ${kmData(dv).box.num[d]}`];
    if (land) {
      const f = kmFacts(dv, data.base.at), o = kmOrder(dv, data.base.at), k = f.cls[c], lv = livingOf(k), farm = album.layers.towns?.farm?.()?.km[c] || 0;
      parts.push(`высота ${Math.round(dv.raster.hgt[c])} м`, `класс ${k} — ${CLASS_TITLE[k]}`, lv === 2 ? 'жилой' : lv === 1 ? 'едва жилой' : 'нежилой', `в порядке освоения района № ${o.rank[c] + 1}`, farm ? `под полями ${Math.max(1, Math.round(farm / 2.55))} %` : 'полей нет');
    } else parts.push('вода');
    return parts.join(' · ');
  }
  function use(size) {
    if (!cache.has(size)) {
      const div = buildDivision(ch, { ...opts, size });
      div.names = districtNames(ch, div, data.vectors.places || []);
      // the centre of every land district (centres.js); a district is called after the settlement at its centre
      div.centres = districtCentres(div, sites);
      for (let d = 0; d < div.count; d++) { const s = div.centres.site[d]; if (s >= 0 && sites[s].name) div.names[d] = sites[s].name; }
      cache.set(size, { div, tex: null, state: null });
    }
    const next = cache.get(size);
    if (next === cur) return;
    cur = next; cur.lines = undefined; hover = -1; select(-1); api.version++;
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
    // what every chunk is like goes into the texture only when the chunks are shown: working it out takes a moment
    cur.facts = p.get('km') > 1 || cur.facts ? kmFacts(cur.div, data.base.at) : null;
    // the fields of the chunks (the settlement work keeps them: layers/towns.js) only while they are the thing shown
    const towns = album.layers.towns, farm = p.get('km') === 4 ? towns?.farm?.() : null; farmShown = farm ? towns.farmVersion() : -1;
    cur.tex = divisionTexture(ch, cur.div, mask, cur.facts, farm ? farm.km : null); cur.state = id;
    U.tDiv.value = cur.tex; U.uDivState.value = id ? 1 : 0; U.uDivOn.value = 1;
    const rows = cur.tex.userData.rows; U.uDivGeo.value.set(cur.div.geo ? rows.L0 : 0, cur.div.geo ? rows.S0 : 0);
    if (cur.lines !== id) { cur.lines = id; lines?.dispose(); lines = createLines(album, ch, cur.div, mask, data.vectors.rivers); lines.mark(hover, sel); }
  }
  // the district at a point of the ground, as the shader draws it: by the side of the nearest border line
  // (border.js); a point of land in a square of water (or the other way round, at the shore) takes the nearest
  // square of its own kind
  function districtAt(lat, lon) {
    if (!inside(lat, lon)) return -1;
    const k = ch.at(lat, lon); if (k < 0) return -1;
    const land = data.base.at(lat, lon) > 0, dv = cur.div, of = t => districtOfTexel(ch, dv, t);
    const [x, y] = kmOf(lat, lon);
    if (dv.geo) { const d = districtByLines(dv.geo, dv.cells, dv.kinds, x, y, land ? 0 : 1); if (d >= 0) return d; }
    const tx = Math.max(0, Math.min(FN - 1, Math.floor((x + 880) / FKM))), ty = Math.max(0, Math.min(FN - 1, Math.floor((y - 3880) / FKM))), here = of(ty * FN + tx);
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
  // what a district holds, with its settlements (the settlement work counts them: layers/towns.js)
  // (the fields of a district are those of its own chunks of 1 km², not the share of the natural cells it lies over)
  const summaryOf = d => { const s = districtSummary(cur.div, d, ch), t = album.layers?.towns?.districtInfo?.(d); if (t) { s.settle = t; if (s.chunks) s.share.fields = t.fieldsKm2 / s.chunks; } return s; };
  function select(d) {
    sel = d; U.uDivSel.value = d; lines?.mark(hover, sel);
    panel.show(d >= 0 ? summaryOf(d) : null);
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
    if ((key == null || key === 'km') && ((p.get('km') > 1 && !cur.facts) || (p.get('km') === 4) !== (farmShown >= 0))) paintState(true);
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
    // the centre of a land district: where its town stands and its roads meet → { x, y (flat km), site } or null
    centre: d => (cur.div.centres && cur.div.centres.texel[d] >= 0 ? { x: cur.div.centres.x[d], y: cur.div.centres.y[d], site: cur.div.centres.site[d] >= 0 ? sites[cur.div.centres.site[d]] : null } : null),
    sites,
    districtAt,
    // the chunk of 1 km² at a point (its number: square j · KN + i of division/km.js), −1 outside the album
    chunkAt: (lat, lon) => { const d = districtAt(lat, lon); return d < 0 ? -1 : chunkAt(cur.div.cells, ...kmOf(lat, lon), d); },
    districtOfChunk: c => cur.div.cells[c] ?? -1,
    chunkSeed: c => seedOf(c % FN, Math.floor(c / FN)),
    // what the chunks are like: { cls (0 water, 1..5), slope, steep, num } and the order a district takes them up in
    chunkFacts: () => kmFacts(cur.div, data.base.at),
    chunkOrder: () => kmOrder(cur.div, data.base.at),
    chunkCount: d => kmData(cur.div).box.num[d] ?? 0,
    summary: summaryOf,
    select, get selected() { return sel; },
    // light a district up as if it were under the cursor while the cursor is away (pictures for the notes), −1 none
    hover: d => { pinned = d; },
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
    const h = active() && last && !p.get('brush') && !down ? atScreen(last.clientX, last.clientY) : active() ? pinned : -1;
    if (h !== hover) { hover = h; U.uDivHover.value = h; dom.style.cursor = h >= 0 ? 'pointer' : ''; lines?.mark(hover, sel); }
    if (p.get('km') === 4 && tick % 15 === 1 && (album.layers.towns?.farmVersion?.() ?? -1) !== farmShown) paintState(true);   // the fields have changed
    const text = p.get('km') > 0 && last ? chunkUnder(last) : null;
    kmInfo.textContent = text || ''; kmInfo.style.display = text && !album.shot ? 'block' : 'none';
    if (sel >= 0 && shownVersion !== ch.version && tick % 15 === 1) { panel.show(summaryOf(sel)); shownVersion = ch.version; }
  } };
}
