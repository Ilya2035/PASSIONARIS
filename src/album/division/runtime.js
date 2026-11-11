// The division at work on the album page: works it out from the chunks (build.js), hands it to the shader (gpu.js),
// answers the cursor (hover lights a district up, a click opens what it holds) and serves the other aspects:
//   album.division = { districtOf(k), chunksOf(d), provinceOf(d), regionOf(p), neighbours(d), kind(d), name(d), … }
//   album.districts = { count, of(k), name(i) } — the same, in the form the resources work asked for
import { buildDivision, districtSummary, districtNames, KIND_ID, LAND, levelSizes } from './build.js';
import { divisionTexture } from './gpu.js';
import { createPanel } from './panel.js';
import { pickGround } from '../pick.js';
import { FN, FKM, kmOf } from '../chunks.js';
import { BBOX } from '../geo.js';

const inside = (lat, lon) => lat > BBOX.lat0 && lat < BBOX.lat1 && lon > BBOX.lon0 && lon < BBOX.lon1;

export function startDivision(album, U) {
  const ch = album.chunks, p = album.params, data = album.data, dom = album.renderer.domElement;
  const opts = { heightAt: data.base.at, lakes: data.vectors.lakes || [] };
  const cache = new Map();                              // size → { div, tex }: switching the size back costs nothing
  const listeners = [];
  let cur = null, hover = -1, sel = -1, last = null, down = null, shownVersion = -1, tick = 0;

  const active = () => p.get('division') > 0 || !!p.get('divPick');
  function use(size) {
    if (!cache.has(size)) {
      const div = buildDivision(ch, { ...opts, size });
      div.names = districtNames(ch, div, data.vectors.places || []);
      cache.set(size, { div, tex: divisionTexture(ch, div) });
    }
    const next = cache.get(size);
    if (next === cur) return;
    cur = next; hover = -1; select(-1); api.version++;
    U.tDiv.value = cur.tex;
    const s = levelSizes(cur.div.size); U.uDivSize.value.set(s.district, s.province, s.region);
    U.uDivOn.value = 1;
    console.log(`[album] division ${size} km: ${cur.div.count} districts, ${cur.div.provinceCount} provinces, ${cur.div.regionCount} regions (${cur.div.ms.toFixed(0)} ms)`);
    for (const f of listeners) f(api);
  }
  // the district at a point of the ground, as the shader draws it: the district of the chunk there; a point of land in
  // a chunk of water (or the other way round, at the shore) takes the nearest chunk of its own kind
  function districtAt(lat, lon) {
    if (!inside(lat, lon)) return -1;
    const k = ch.at(lat, lon); if (k < 0) return -1;
    const land = data.base.at(lat, lon) > 0, dv = cur.div;
    if ((dv.kinds[dv.district[k]] === LAND) === land) return dv.district[k];
    const [x, y] = kmOf(lat, lon), tx = Math.floor((x + 880) / FKM), ty = Math.floor((y - 3880) / FKM);
    for (let r = 1; r <= 2; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const u = tx + dx, v = ty + dy; if (u < 0 || v < 0 || u >= FN || v >= FN) continue;
      const d = dv.district[ch.cell[v * FN + u]];
      if ((dv.kinds[d] === LAND) === land) return d;
    }
    return dv.district[k];
  }
  const atScreen = (x, y) => { const ll = pickGround(album, x, y); return ll ? districtAt(ll.lat, ll.lon) : -1; };

  const panel = createPanel(() => select(-1));
  function select(d) {
    sel = d; U.uDivSel.value = d;
    panel.show(d >= 0 ? districtSummary(cur.div, d, ch) : null);
    shownVersion = ch.version;
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
    if (key == null || key === 'divSize') use(+p.get('divSize') || 30);
    if (!active() && key !== null && sel >= 0) select(-1);
    if (key == null) { const at = album.page?.divAt; select(at ? districtAt(at[0], at[1]) : -1); }
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
    neighbours: d => cur.div.neighbours[d] || [],
    kind: d => KIND_ID[cur.div.kinds[d]],
    name: d => cur.div.names[d],
    districtAt,
    summary: d => districtSummary(cur.div, d, ch),
    select, get selected() { return sel; },
    onChange: fn => listeners.push(fn),
    get data() { return cur.div; },
  };
  album.division = api;
  album.districts = { get count() { return cur.div.count; }, of: k => cur.div.district[k], name: i => cur.div.names[i], onChange: api.onChange };
  use(+p.get('divSize') || 30);

  return { id: 'division', update() {
    if (tick++ % 3) return;
    const h = active() && last && !p.get('brush') && !down ? atScreen(last.clientX, last.clientY) : -1;
    if (h !== hover) { hover = h; U.uDivHover.value = h; dom.style.cursor = h >= 0 ? 'pointer' : ''; }
    if (sel >= 0 && shownVersion !== ch.version && tick % 15 === 1) { panel.show(districtSummary(cur.div, sel, ch)); shownVersion = ch.version; }
  } };
}
