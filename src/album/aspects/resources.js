// ASPECT «Ресурсы»: what lies in every chunk — fish, timber, stone, ores, coal, oil (docs/RESOURCES.md). This file
// belongs to the resources work; the contract with the rest of the album is in docs/ALBUM-CHUNKS.md.
// Nothing is drawn by a shader of its own:
//   album.chunks.layer(id, …).data   one number per chunk for each of the 18 resources (the chunk read-out shows them)
//   album.chunks.show(values, …)     the chosen resource painted over the map, by chunk or summed by district
//   points                           the deposits of the chosen resource: dot — on the surface, dot with a dark core —
//                                    shallow, ring — deep underground; pale — a place known only roughly, laid out
//                                    by the world seed
// The table is baked by scripts/resources/bake.mjs on the album's own chunk grid (same numbering as chunks.js).
// Districts: the division work will build them from whole chunks; until it offers album.districts, a district here is
// a block of 3 × 3 chunks (30 km).
import { BufferGeometry, BufferAttribute, Points, ShaderMaterial, NormalBlending } from 'three';
import { toWorld } from '../geo.js';
import { CN } from '../chunks.js';
import { pickGround } from '../pick.js';
import { RESOURCES, RES_INDEX, DEPTH_NAMES, openTable, withZones } from '../../../scripts/resources/lib.mjs';

const BASE = 'assets/resources/';
const RES_OPTIONS = [['', 'нет'], ...RESOURCES.map(r => [r.id, r.name])];
const hex = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16) / 255);
const fmt = v => v >= 100 ? String(Math.round(v)) : v >= 10 ? v.toFixed(0) : v.toFixed(1).replace('.0', '');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const era = y => y <= -5000 ? 'с начала' : y < 0 ? `с ${-y} г. до н. э.` : `с ${y} г.`;

async function fetchGz(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return new Uint8Array(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}

// a district for every chunk: album.districts from the division work when it exists, else 3 × 3 blocks
function districtsOf(album) {
  const d = album.districts;
  if (d?.of && d.count) return { of: k => d.of(k), count: d.count, name: i => d.name?.(i) ?? `Район ${i + 1}`, real: true };
  const B = 3, W = Math.ceil(CN / B);
  return { of: k => Math.floor(((k / CN) | 0) / B) * W + Math.floor((k % CN) / B), count: W * W, name: i => `Район ${i + 1}`, real: false };
}

const POINT_VS = /* glsl */`
attribute vec3 aStyle; attribute vec3 aCol; uniform float uPx; varying vec3 vStyle; varying vec3 vCol;
void main() { vStyle = aStyle; vCol = aCol; vec4 mv = viewMatrix * vec4(position, 1.); gl_PointSize = aStyle.x * uPx; gl_Position = projectionMatrix * mv; }`;
// aStyle: x size in css px, y depth (0 surface, 1 shallow, 2 deep), z 1 exact / .55 known only roughly.
// Surface: a filled disc. Shallow: a disc with a light centre. Deep: a thick ring. All with a thin light rim and a
// dark outline, so they read on pale paper and on dark forest alike.
const POINT_FS = /* glsl */`
varying vec3 vStyle; varying vec3 vCol;
void main() {
  vec2 q = gl_PointCoord - .5; float d = length(q) * 2., w = 2. / vStyle.x;    // w: one pixel in disc units
  float a = 1. - smoothstep(1. - w, 1., d);
  vec3 c = vCol;
  c = mix(c, vec3(.96, .95, .90), smoothstep(1. - w * 4., 1. - w * 3., d));    // light rim
  c = mix(c, vec3(.06, .05, .04), smoothstep(1. - w * 2., 1. - w * 1., d));    // dark outline
  if (vStyle.y > 1.5) a *= smoothstep(.40 - w, .40, d);                          // deep: a ring
  else if (vStyle.y > .5) c = mix(c, vec3(.96, .95, .90), 1. - smoothstep(.24 - w, .24, d));  // shallow: light centre
  if (a < .01) discard;
  gl_FragColor = vec4(pow(c, vec3(1. / 2.2)), a * vStyle.z);
}`;

export default {
  id: 'resources', title: 'Ресурсы', glsl: '', uniforms: {},
  params: [
    { key: 'res', label: 'Ресурсы', group: 'modes', type: 'select', options: RES_OPTIONS, value: '' },
    { key: 'resView', label: 'Ресурсы: показ', group: 'modes', type: 'select', options: [[0, 'по чанкам'], [1, 'сумма по районам']], value: 0 },
    { key: 'resKnown', label: 'Ресурсы: что известно', group: 'modes', type: 'select',
      options: [[2, 'всё, что есть'], [1, 'после простой разведки'], [0, 'видно сразу']], value: 2 },
    { key: 'resSeed', label: 'Ресурсы: зерно мира', group: 'modes', min: 1, max: 64, step: 1, value: 1 },
    { key: 'resMarks', label: 'Ресурсы: значки залежей', group: 'modes', type: 'toggle', value: 1 },
  ],
  pages: [
    { id: 'res-fish', group: 'Ресурсы', title: 'Рыба: шельф, апвеллинги, устья и реки', note: 'Богаче всего мелководья у Галисии и Португалии, дельта Эбро и устья; в реках рыбы меньше, в глубоком море мало. Хлорофилл со спутника VIIRS, глубины, реки.', p: { look: 'paper', forest3d: 0, roadsOn: 0, res: 'fish' }, cam: { lat: 40.2, lon: -3.4, h: 1500, tilt: 0, heading: 0 } },
    { id: 'res-wood', group: 'Ресурсы', title: 'Лес в мире 5000 г. до н. э.', note: 'Лес по природным зонам, без полей: густой на севере, реже в сухой долине Эбро и на юго-востоке.', p: { look: 'paper', forest3d: 0, roadsOn: 0, res: 'wood' }, cam: { lat: 40.2, lon: -3.4, h: 1500, tilt: 0, heading: 0 } },
    { id: 'res-copper', group: 'Ресурсы', title: 'Медь Иберийского пиритового пояса', note: 'Рио-Тинто, Тарсис, Невеш-Корву: колчеданные месторождения с тоннажом USGS. Точка с тёмной серединой — неглубоко, кольцо — глубоко.', p: { look: 'paper', forest3d: 0, roadsOn: 0, res: 'copper' }, cam: { lat: 37.75, lon: -7.0, h: 300, tilt: 25, heading: 0 } },
    { id: 'res-districts', group: 'Ресурсы', title: 'Сумма по районам: серебро', note: 'Чанк нажать нельзя — ресурсы района складываются из его чанков. Районы пока условные, 3 × 3 чанка; потом их даст часть «Деление».', p: { look: 'paper', forest3d: 0, roadsOn: 0, res: 'silver', resView: 1 }, cam: { lat: 38.0, lon: -5.0, h: 700, tilt: 0, heading: 0 } },
    { id: 'res-bogiron', group: 'Ресурсы', title: 'Болотное железо: место знаем неточно', note: 'Болотная руда в сырых низинах прохладного влажного климата: больше всего в Ландах и Жиронде (там её добывали веками), понемногу на севере Испании. Где именно — решает зерно мира: передвиньте ползунок «зерно», и залежи лягут иначе.', p: { look: 'paper', forest3d: 0, roadsOn: 0, res: 'bogiron', resSeed: 1 }, cam: { lat: 43.9, lon: -1.3, h: 560, tilt: 0, heading: 0 } },
    { id: 'res-deep', group: 'Ресурсы', title: 'Подземное: уголь Астурии', note: 'Кольца — глубокие залежи: шахты и неразведанная часть бассейна, которую найдут только поздней разведкой.', p: { look: 'paper', forest3d: 0, roadsOn: 0, res: 'coal' }, cam: { lat: 43.1, lon: -5.6, h: 320, tilt: 20, heading: 0 } },
    { id: 'res-known', group: 'Ресурсы', title: 'Что видно сразу: золото', note: 'Только россыпи и выходы на поверхность — то, что найдут первые люди. Переключите «что известно», чтобы увидеть остальное.', p: { look: 'paper', forest3d: 0, roadsOn: 0, res: 'gold', resKnown: 0 }, cam: { lat: 40.0, lon: -4.5, h: 1300, tilt: 0, heading: 0 } },
  ],

  async init(album) {
    const [meta, bytes] = await Promise.all([fetch(BASE + 'album.json').then(r => { if (!r.ok) throw new Error('album.json: ' + r.status); return r.json(); }), fetchGz(BASE + 'album.bin.gz')]);
    const table = openTable(meta, bytes);
    const ch = album.chunks, p = album.params;
    if (table.N !== ch.count) throw new Error(`resources: table has ${table.N} chunks, the album ${ch.count}`);
    // the division work may offer its districts later than this init: look again while they are the stand-ins
    let dist = districtsOf(album);
    const freshDistricts = () => { if (!dist.real && album.districts?.count) dist = districtsOf(album); };
    const layers = RESOURCES.map(r => ch.layer(r.id, { title: r.name, unit: '', sum: true }));
    let state = null, seed = -1;

    // the table with the roughly known deposits laid out by the world seed
    function place() {
      const s = Math.round(p.get('resSeed'));
      if (s === seed) return;
      seed = s;
      state = withZones(table, meta.zones, s);
      RESOURCES.forEach((r, k) => layers[k].data.set(state.amount.subarray(k * table.N, (k + 1) * table.N)));
    }

    // ---- painting the chosen resource over the map
    let showing = false;
    function paint() {
      freshDistricts();
      const id = p.get('res');
      // «Показать по чанкам» of the chunk tools, when chosen, keeps the overlay for itself
      if (!id || p.get('chunkData')) { if (showing && !p.get('chunkData')) ch.show(null); showing = false; return; }
      const r = RES_INDEX[id], known = +p.get('resKnown'), N = table.N;
      const v = new Float32Array(N);
      for (let k = 0; k < N; k++) {
        const a = state.amount[r * N + k];
        if (a && state.depth[r * N + k] <= known) v[k] = a;
      }
      let out = v;
      if (+p.get('resView') === 1) {
        const sum = new Float32Array(dist.count);
        for (let k = 0; k < N; k++) sum[dist.of(k)] += v[k];
        out = new Float32Array(N);
        for (let k = 0; k < N; k++) out[k] = sum[dist.of(k)];
      }
      // square root and a robust top (98th percentile), so one giant deposit does not wash the rest out
      const nz = [];
      for (let k = 0; k < N; k++) if (out[k] > 0) { out[k] = Math.sqrt(out[k]); nz.push(out[k]); }
      nz.sort((a, b) => a - b);
      const top = nz.length ? nz[Math.min(nz.length - 1, Math.floor(nz.length * .98))] : 1;
      const c = hex(RESOURCES[r].color), paper = [.95, .93, .86];
      const ramp = t => paper.map((pv, i) => pv + (c[i] - pv) * (.18 + .82 * t));
      ch.show(out, { min: 0, max: top, ramp, alpha: .85, skip: x => x <= 0 });
      showing = true;
    }

    // ---- deposit marks
    const MAX = 4000;
    const pos = new Float32Array(MAX * 3), sty = new Float32Array(MAX * 3), col = new Float32Array(MAX * 3);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aStyle', new BufferAttribute(sty, 3));
    geo.setAttribute('aCol', new BufferAttribute(col, 3));
    const marks = new Points(geo, new ShaderMaterial({
      transparent: true, depthWrite: false, blending: NormalBlending, uniforms: { uPx: { value: 1 } },
      vertexShader: POINT_VS, fragmentShader: POINT_FS,
    }));
    marks.frustumCulled = false; marks.renderOrder = 9; marks.visible = false;
    album.scene.add(marks);
    let markList = [], markExag = -1;
    function collectMarks() {
      const id = p.get('res'), known = +p.get('resKnown');
      markList = [];
      if (!id || !p.get('resMarks')) return;
      for (const d of meta.deposits) if (d.res === id && d.depth <= known) markList.push({ ...d, exact: true });
      for (const q of state.placed) {
        if (q.res !== id || q.depth > known) continue;
        const c = ch.centre(q.cell);
        markList.push({ lat: c.lat, lon: c.lon, amount: q.amount, depth: q.depth, cell: q.cell, exact: false, zone: q.zone });
      }
      markList.sort((a, b) => b.amount - a.amount);
      markList.length = Math.min(markList.length, MAX);
    }
    const v = toWorld(0, 0);
    function placeMarks(exag) {
      const c = hex(RESOURCES[RES_INDEX[p.get('res')] ?? 0].color);
      markList.forEach((d, i) => {
        toWorld(d.lat, d.lon, (Math.max(0, album.data.base.at(d.lat, d.lon)) / 1000 + .4) * exag, v);
        pos.set([v.x, v.y, v.z], i * 3);
        sty.set([Math.min(28, 10 + 5.5 * Math.log10(1 + d.amount)), d.depth, d.exact ? 1 : .55], i * 3);
        col.set(c, i * 3);
      });
      geo.setDrawRange(0, markList.length);
      for (const a of ['position', 'aStyle', 'aCol']) geo.attributes[a].needsUpdate = true;
      marks.visible = markList.length > 0;
      markExag = exag;
    }

    function sync(key) {
      if (key != null && !key.startsWith('res') && key !== 'chunkData') return;
      place(); paint(); collectMarks(); markExag = -1;
    }
    p.on(sync);
    place(); paint(); collectMarks();

    // ---- what the district under the cursor holds
    const dom = album.renderer.domElement;
    let last = null;
    dom.addEventListener('pointermove', e => { last = e; });
    dom.addEventListener('pointerleave', () => { last = null; });
    const info = document.createElement('div');
    info.className = 'S res-info';
    info.style.cssText = 'position:fixed;right:358px;bottom:20px;max-width:420px;padding:8px 12px;background:rgba(12,16,24,.88);color:#fff;border-radius:3px;pointer-events:none;display:none;z-index:5;line-height:1.45';
    document.body.appendChild(info);
    let tick = 0, lastKey = '';
    function readout() {
      freshDistricts();
      const id = p.get('res');
      const ll = id && last ? pickGround(album, last.clientX, last.clientY) : null, k = ll ? ch.at(ll.lat, ll.lon) : -1;
      if (k < 0 || album.shot) { info.style.display = 'none'; lastKey = ''; return; }
      const di = dist.of(k), key = `${id}|${di}|${k}|${seed}|${p.get('resKnown')}`;
      if (key === lastKey) return;
      lastKey = key;
      const known = +p.get('resKnown'), N = table.N, sums = new Float64Array(RESOURCES.length);
      for (let m = 0; m < N; m++) {
        if (dist.of(m) !== di) continue;
        for (let r = 0; r < RESOURCES.length; r++) if (state.depth[r * N + m] <= known) sums[r] += state.amount[r * N + m];
      }
      const lines = [`<b>${esc(dist.name(di))}</b>${dist.real ? '' : ' <span style="opacity:.6">(условный, 3 × 3 чанка)</span>'}`];
      const parts = RESOURCES.map((r, i) => sums[i] >= .5 ? `${r.id === id ? '<b>' : ''}${r.name} ${fmt(sums[i])}${r.id === id ? '</b>' : ''}` : '').filter(Boolean);
      lines.push(parts.join(' · ') || 'ничего');
      const r = RESOURCES[RES_INDEX[id]];
      lines.push(`<span style="opacity:.7">${r.name}: ${era(r.era)}</span>`);
      for (const d of meta.deposits) if (d.cell === k && d.res === id) lines.push(`${esc(d.name)}: ${fmt(d.amount)}, ${DEPTH_NAMES[d.depth]} <span style="opacity:.6">(${esc(d.src)})</span>`);
      for (const q of state.placed) if (q.cell === k && q.res === id) lines.push(`Неточное место: ${fmt(q.amount)}, ${DEPTH_NAMES[q.depth]}`);
      info.innerHTML = lines.join('<br>');
      info.style.display = 'block';
    }

    return {
      id: 'resources',
      update(dt, t, cam) {
        if (p.get('res') && showing && !ch.uniforms.uChunkShow.value && !p.get('chunkData')) paint();
        if (markExag !== cam.exag) placeMarks(cam.exag);
        marks.material.uniforms.uPx.value = album.renderer.getPixelRatio();
        if (tick++ % 4 === 0) readout();
      },
    };
  },
};
