// ASPECT «Ресурсы»: the raw materials of every chunk — 52 kinds from fish and timber to copper, oil and helium
// (docs/RESOURCES.md). This file belongs to the resources work; the contract with the rest of the album is in
// docs/ALBUM-CHUNKS.md. Nothing is drawn by a shader of its own:
//   album.chunks.layer(id, …).data   the real stock of every chunk, a whole number in the resource's unit (t, kg, l, m³);
//                                    the district block of the division work sums them (sum: true)
//   album.chunks.show(values, …)     the chosen resource as colour, every chunk in its own outline, on the owner's
//                                    0–100 scale (100 = the richest 100 km² of the world), or summed by district
//   labels                           the names of the deposits of the chosen resource, with their 0–100 number
// This is the technical view: everything is open. In the game the player learns the map bit by bit (docs).
// The table is baked by scripts/resources/bake.mjs on 10 km squares; on loading it is spread over the natural chunks
// (spreadToChunks), the deposits go to the chunk under their coordinates and ease into the neighbours, and the places
// known only roughly are laid out over chunks by the world seed (zonesToChunks, withZones).
import { toWorld } from '../geo.js';
import { FN, FKM, CHUNK_KM } from '../chunks.js';
import { pickGround } from '../pick.js';
import { RESOURCES, RES_INDEX, DEPTH_NAMES, openTable, withZones, spreadToChunks, zonesToChunks, index100, fmtAmount, poolStocks } from '../../../scripts/resources/lib.mjs';

const BASE = 'assets/resources/';
const RES_OPTIONS = [['', 'нет'], ...RESOURCES.map(r => [r.id, r.name])];
const hex = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16) / 255);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const era = y => y <= -5000 ? 'с начала' : y < 0 ? `с ${-y} г. до н. э.` : `с ${y} г.`;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const UNIT_RU = { t: 'т', kg: 'кг', l: 'л', m3: 'м³' };
// a wide tone for one resource: almost paper → the full colour → a deep shade of it (t 0..1)
function rampOf(color) {
  const c = hex(color), paper = [.96, .94, .87], light = mix(paper, c, .14), deep = c.map(v => v * .42);
  return t => t < .55 ? mix(light, c, t / .55) : mix(c, deep, (t - .55) / .45);
}

async function fetchGz(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return new Uint8Array(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}

const P = { look: 'paper', forest3d: 0, roadsOn: 0 };
export default {
  id: 'resources', title: 'Ресурсы', glsl: '', uniforms: {},
  params: [
    { key: 'res', label: 'Ресурсы', group: 'modes', type: 'select', options: RES_OPTIONS, value: '' },
    { key: 'resView', label: 'Ресурсы: показ', group: 'modes', type: 'select', options: [[0, 'по чанкам'], [1, 'сумма по районам']], value: 0 },
    { key: 'resKnown', label: 'Ресурсы: что известно', group: 'modes', type: 'select',
      options: [[2, 'всё, что есть'], [1, 'после простой разведки'], [0, 'видно сразу']], value: 2 },
    { key: 'resSeed', label: 'Ресурсы: зерно мира', group: 'modes', min: 1, max: 64, step: 1, value: 1 },
    { key: 'resLabels', label: 'Ресурсы: названия месторождений', group: 'modes', type: 'toggle', value: 1 },
  ],
  pages: [
    { id: 'res-fish', group: 'Ресурсы', title: 'Рыба: шельф, апвеллинги, устья и реки', note: 'Живой запас в тоннах: богаче всего мелководья у Галисии и Португалии и устья; в глубоком море мало. Позже рыба будет считаться по морям, а не по чанкам.', p: { ...P, res: 'fish' }, cam: { lat: 40.2, lon: -3.4, h: 1500, tilt: 0, heading: 0 } },
    { id: 'res-wood', group: 'Ресурсы', title: 'Лес в мире 5000 г. до н. э.', note: 'Кубометры древесины природного леса без полей: густо на севере, реже в долине Эбро и на юго-востоке.', p: { ...P, res: 'wood' }, cam: { lat: 40.2, lon: -3.4, h: 1500, tilt: 0, heading: 0 } },
    { id: 'res-copper', group: 'Ресурсы', title: 'Медь Иберийского пиритового пояса', note: 'Число 0–100 — доля от самого богатого медного места мира (100 = Эль-Теньенте в Чили, ≈ 94 млн т). Рио-Тинто, Тарсис, Невеш-Корву.', p: { ...P, res: 'copper' }, cam: { lat: 37.75, lon: -7.0, h: 300, tilt: 25, heading: 0 } },
    { id: 'res-iron', group: 'Ресурсы', title: 'Железо: Бискайя, Ойос-Неграс, юг', note: 'Железо — одно сырьё, болотная руда в него входит; мелкую самодобычу люди ведут сами, она отдельно не считается.', p: { ...P, res: 'iron' }, cam: { lat: 40.4, lon: -3.0, h: 1300, tilt: 0, heading: 0 } },
    { id: 'res-districts', group: 'Ресурсы', title: 'Сумма по районам: серебро', note: 'Чанк нажать нельзя — запас района складывается из его чанков. Районы — части «Деление»; щелчок по району открывает её блок со всем сырьём района.', p: { ...P, res: 'silver', resView: 1 }, cam: { lat: 38.0, lon: -5.0, h: 700, tilt: 0, heading: 0 } },
    { id: 'res-deep', group: 'Ресурсы', title: 'Подземное: уголь Астурии', note: 'Глубокие залежи — шахты и неразведанная часть бассейна, которую найдут только поздней разведкой.', p: { ...P, res: 'coal' }, cam: { lat: 43.1, lon: -5.6, h: 320, tilt: 20, heading: 0 } },
    { id: 'res-known', group: 'Ресурсы', title: 'Что видно сразу: золото', note: 'Только россыпи и выходы на поверхность — то, что найдут первые люди. Переключите «что известно», чтобы увидеть остальное.', p: { ...P, res: 'gold', resKnown: 0 }, cam: { lat: 40.0, lon: -4.5, h: 1300, tilt: 0, heading: 0 } },
  ],

  async init(album) {
    const [meta, bytes] = await Promise.all([fetch(BASE + 'album.json').then(r => { if (!r.ok) throw new Error('album.json: ' + r.status); return r.json(); }), fetchGz(BASE + 'album.bin.gz')]);
    const table = openTable(meta, bytes);
    const ch = album.chunks, p = album.params, n = ch.count;
    if (table.N !== meta.grid.W * meta.grid.H || meta.grid.W * CHUNK_KM / FKM !== FN) throw new Error('resources: the table does not fit the chunk raster');
    const info = Object.fromEntries(meta.resources.map(r => [r.id, r]));       // unit, scale, ref100 of each resource
    // the squares of the table over the natural chunks
    const g = { count: n, kind: ch.kind, cell: ch.cell, FN, sub: CHUNK_KM / FKM, links: ch.links, at: (lat, lon) => ch.at(lat, lon) };
    const base = spreadToChunks(table, meta, g);
    // nothing outside the album's region: the album has no heights there and draws no land (as the swamp aspect)
    const bb = meta.grid.bbox, inside = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const c = ch.centre(k);
      if (c.lat >= bb.lat0 && c.lat <= bb.lat1 && c.lon >= bb.lon0 && c.lon <= bb.lon1) { inside[k] = 1; continue; }
      for (let r = 0; r < base.R; r++) { base.amount[r * n + k] = 0; base.depth[r * n + k] = 255; }
    }
    const keepInside = z => { const q = z.cells.map((k, i) => [k, z.weights[i]]).filter(([k]) => inside[k]); return { ...z, cells: q.map(x => x[0]), weights: q.map(x => x[1]) }; };
    const zones = zonesToChunks(meta.zones, meta, g).map(keepInside).filter(z => z.cells.length);
    const deposits = meta.deposits.map((d, q) => ({ ...d, chunk: base.depositChunk[q] })).filter(d => d.chunk >= 0 && inside[d.chunk]);
    const layers = RESOURCES.map(r => ch.layer(r.id, { title: r.name, unit: UNIT_RU[info[r.id].unit], sum: true }));
    let state = null, seed = -1;

    // the table with the roughly known deposits laid out by the world seed; stocks are whole numbers
    function place() {
      const s = Math.round(p.get('resSeed'));
      if (s === seed) return;
      seed = s;
      state = withZones(base, zones, s);
      for (let i = 0; i < state.amount.length; i++) state.amount[i] = Math.round(state.amount[i]);
      RESOURCES.forEach((r, k) => layers[k].data.set(state.amount.subarray(k * n, (k + 1) * n)));
    }
    const districts = () => (album.districts?.count && album.districts.of) ? album.districts : null;
    // Living stocks belong to a sea (fish, marine mammals) or a province (game). The division work will give
    // album.division.seaOfChunk(k), provinceOfChunk(k) and name(level, id); until then the pool is unknown (null)
    // and the stocks stay by chunk. Nothing else changes when they arrive.
    const poolOf = (r, k) => {
      const div = album.division;
      const id = r.pool === 'sea' ? div?.seaOfChunk?.(k) : r.pool === 'province' ? div?.provinceOfChunk?.(k) : null;
      return id == null || id < 0 ? null : `${r.pool}:${id}`;
    };
    let pools = null, poolsAt = -1;
    const poolTotals = () => { if (poolsAt !== seed) { pools = poolStocks(state.amount, n, poolOf); poolsAt = seed; } return pools; };
    album.districts?.onChange?.(() => { poolsAt = -1; });
    const known = () => +p.get('resKnown');
    const amountAt = (r, k) => state.depth[r * n + k] <= known() ? state.amount[r * n + k] : 0;

    // ---- the chosen resource as colour: 0–100 of the richest place of the world, every chunk in its own outline
    let showing = false;
    function paint() {
      const id = p.get('res');
      // «Показать по чанкам» of the chunk tools, when chosen, keeps the overlay for itself
      if (!id || p.get('chunkData')) { if (showing && !p.get('chunkData')) ch.show(null); showing = false; return; }
      const r = RES_INDEX[id], ref = info[id].ref100, v = new Float32Array(n);
      // the colour follows the stock per 100 km² on a log scale over four orders of magnitude below the world's
      // richest place (the owner: a compressed scale reads easier); the 0–100 number itself stays proportional
      const tone = (amount, area) => amount > 0 ? Math.max(0.04, Math.min(1, (Math.log10(amount / (area / 100) / ref) + 4) / 4)) : 0;
      const D = +p.get('resView') === 1 ? districts() : null;
      if (D) {
        const sum = new Float64Array(D.count), area = new Float64Array(D.count);
        for (let k = 0; k < n; k++) { const d = D.of(k); if (d >= 0) { sum[d] += amountAt(r, k); area[d] += ch.area[k]; } }
        for (let k = 0; k < n; k++) { const d = D.of(k); v[k] = d >= 0 ? tone(sum[d], area[d]) : 0; }
      } else {
        for (let k = 0; k < n; k++) v[k] = tone(amountAt(r, k), ch.area[k]);
      }
      ch.show(v, { min: 0, max: 1, ramp: rampOf(RESOURCES[r].color), alpha: .88, skip: x => x <= 0 });
      showing = true;
    }

    // ---- names of the deposits of the chosen resource, the biggest first, without overlapping
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:4;overflow:hidden';
    document.body.appendChild(box);
    const pool = [];
    let named = [];
    function collectNames() {
      const id = p.get('res');
      named = [];
      if (!id || !p.get('resLabels')) return;
      const ref = info[id].ref100;
      for (const d of deposits) if (d.res === id && d.depth <= known() && d.name) named.push({ ...d, idx: index100(d.amount, ref) });
      named.sort((a, b) => b.amount - a.amount);
      named.length = Math.min(named.length, 120);
    }
    const v3 = toWorld(0, 0);
    function placeNames(cam) {
      const w = innerWidth, hh = innerHeight, used = [];
      let shown = 0;
      for (const d of named) {
        if (shown >= 28) break;
        toWorld(d.lat, d.lon, Math.max(0, album.data.base.at(d.lat, d.lon)) * cam.exag / 1000, v3).project(cam.cam);
        const x = (v3.x * .5 + .5) * w, y = (-v3.y * .5 + .5) * hh;
        if (!(v3.z < 1 && x > 30 && x < w - 30 && y > 20 && y < hh - 20)) continue;
        if (used.some(u => Math.abs(u[0] - x) < 130 && Math.abs(u[1] - y) < 20)) continue;
        used.push([x, y]);
        let el = pool[shown];
        if (!el) {
          el = pool[shown] = document.createElement('div');
          el.style.cssText = 'position:absolute;left:0;top:0;font:600 12px/1.2 "Alegreya SC",serif;color:#fff;white-space:nowrap;text-shadow:0 0 3px #000,0 0 2px #000,0 1px 2px #000';
          box.appendChild(el);
        }
        el.textContent = `${d.name} · ${fmtAmount(d.amount, info[d.res].unit)}`;
        el.style.transform = `translate(${(x + 6).toFixed(1)}px, ${(y - 8).toFixed(1)}px)`;
        el.style.display = 'block';
        shown++;
      }
      for (let i = shown; i < pool.length; i++) pool[i].style.display = 'none';
    }

    function sync(key) {
      if (key != null && !key.startsWith('res') && key !== 'chunkData') return;
      place(); paint(); collectNames();
    }
    p.on(sync);
    album.districts?.onChange?.(() => { if (+p.get('resView') === 1) paint(); });
    place(); paint(); collectNames();

    // ---- the chunk under the cursor: its 0–100 and real stock of the chosen resource, the deposits in it; the whole
    // district is the division work's block (a click on the district), which sums every layer of this part
    const dom = album.renderer.domElement;
    let last = null;
    dom.addEventListener('pointermove', e => { last = e; });
    dom.addEventListener('pointerleave', () => { last = null; });
    const readBox = document.createElement('div');
    readBox.className = 'S res-info';
    readBox.style.cssText = 'position:fixed;right:358px;bottom:20px;max-width:440px;padding:8px 12px;background:rgba(12,16,24,.88);color:#fff;border-radius:3px;pointer-events:none;display:none;z-index:5;line-height:1.45';
    document.body.appendChild(readBox);
    let tick = 0, lastKey = '';
    function readout() {
      const id = p.get('res');
      const ll = id && last ? pickGround(album, last.clientX, last.clientY) : null, k = ll ? ch.at(ll.lat, ll.lon) : -1;
      if (k < 0 || album.shot) { readBox.style.display = 'none'; lastKey = ''; return; }
      const key = `${id}|${k}|${seed}|${known()}`;
      if (key === lastKey) return;
      lastKey = key;
      const r = RES_INDEX[id], res = RESOURCES[r], u = info[id].unit, here = amountAt(r, k);
      const D = districts(), d = D ? D.of(k) : -1;
      const lines = [`<b>${res.name}</b> в этом чанке: ${here > 0 ? `${index100(here, info[id].ref100, ch.area[k])} из 100 · ${fmtAmount(here, u)}` : 'нет'} <span style="opacity:.7">· ${era(res.era)}</span>`];
      for (const q of deposits) if (q.chunk === k && q.res === id && q.depth <= known()) lines.push(`${esc(q.name)}: ${fmtAmount(q.amount, u)}, ${DEPTH_NAMES[q.depth]} <span style="opacity:.6">(${esc(q.src)})</span>`);
      for (const q of state.placed) if (q.cell === k && q.res === id && q.depth <= known()) lines.push(`Место известно неточно: ${fmtAmount(q.amount, u)}, ${DEPTH_NAMES[q.depth]}`);
      if (res.kind === 'living') {
        const key = poolOf(res, k), total = key ? poolTotals().get(key)?.[id] : null;
        if (key && total) {
          const [lvl, num] = key.split(':'), sea = lvl === 'sea';
          const name = album.division?.name?.(lvl, +num) ?? `${sea ? 'Море' : 'Провинция'} ${+num + 1}`;
          lines.push(`Всего в ${sea ? 'море' : 'провинции'} «${esc(name)}»: ${fmtAmount(total, u)} — живой запас ходит по всему ${sea ? 'морю' : 'краю'}`);
        } else lines.push('<span style="opacity:.7">Живой запас; суммы по морям и провинциям появятся, когда их даст «Деление»</span>');
      }
      if (d >= 0) lines.push(`<span style="opacity:.7">${esc(D.name?.(d) ?? `Район ${d + 1}`)} — всё сырьё района по щелчку</span>`);
      readBox.innerHTML = lines.join('<br>');
      readBox.style.display = 'block';
    }

    return {
      id: 'resources',
      update(dt, t, cam) {
        if (p.get('res') && showing && !ch.uniforms.uChunkShow.value && !p.get('chunkData')) paint();
        if (tick++ % 3 === 0) { if (named.length) placeNames(cam); else for (const el of pool) el.style.display = 'none'; }
        if (tick % 4 === 0) readout();
      },
    };
  },
};
