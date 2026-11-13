// Tools for looking at the chunk system (chunks.js) at work: the natural state of every chunk, two plain
// demonstrations (people clearing forest around their settlements, snow falling on the land), a brush that changes
// chunks by a click, the read-out of the chunk under the cursor and a view of any chunk number, chunk by chunk.
// The demonstrations are stand-ins: the real rules of forest and settlements are the aspects' work. Ice on the water
// already is: the water aspect's own model (knob «Холод»).
import { CHANNELS, RAMPS } from './chunks.js';
import { pickGround } from './pick.js';

const D = Math.PI / 180;
// the CPU twin of albumWet() in glsl.js, without its noise
function wetAt(lat, lon, h) {
  const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const g = (la, lo, s) => Math.exp(-((lat - la) ** 2 + (lon - lo) ** 2) / s);
  return .42 + .34 * ss(42.2, 43.4, lat) * ss(-.5, -2.5, lon) + .30 * ss(-6.2, -8.6, lon) * ss(38.2, 41.8, lat)
    + .22 * ss(42, 43.2, lat) * ss(3.5, .5, lon) + .25 * ss(43, 44.5, lat)
    - .24 * g(41.6, -.6, 1.7) - .30 * g(37.6, -1.8, 2.2) - .12 * g(39.3, -3, 2.6) + h * .00016;
}
const DATA = {
  forest: ['green', 0, 1], conifer: ['green', 0, 1], swamp: ['blue', 0, 1], ice: ['blue', 0, 1], snow: ['grey', 0, 1], fields: ['warm', 0, 1], built: ['warm', 0, 1],
};

export default async function init(album) {
  const ch = album.chunks, p = album.params, dom = album.renderer.domElement, places = album.data.vectors.places;
  const centres = Array.from({ length: ch.count }, (_, k) => ch.centre(k));
  const hash = k => { let x = Math.imul(k + 1, 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) / 4294967296; };
  const town = places.map(pl => ({ x: pl.lon * 111.195 * Math.cos(40 * D), y: pl.lat * 111.195, r: 2.2 * Math.max(1, pl.pop) ** .24, big: Math.min(1, .25 + pl.pop / 8e5) }));

  const s = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // the natural share of conifers: mountains and the dry interior (until the forest work brings its own rule)
  for (let k = 0; k < ch.count; k++) { const c = centres[k], h = ch.height[k]; ch.setNatural('conifer', k, Math.min(1, s(1000, 1700, h) * .8 + (wetAt(c.lat, c.lon, h) < .52 ? .45 : 0))); }

  // every chunk back to its natural state, then the demonstrations on top
  function applyState() {
    const cut = p.get('demoCut'), snow = p.get('demoSnow');
    ch.reset();
    if (!cut && !snow) return;
    for (let k = 0; k < ch.count; k++) {
      const c = centres[k], land = ch.land[k], h = ch.height[k], jit = hash(k) - .5;
      if (cut > 0 && land > 0) {
        let forest = 1, fields = 0, built = 0;
        for (const t of town) {
          const d = Math.hypot(c.x - t.x, c.y - t.y), r = t.r * cut; if (d > r * 1.2 + 10) continue;
          forest = Math.min(forest, s(r * .55, r * 1.1, d)); fields = Math.max(fields, (1 - s(r * .3, r * .9, d)) * .85);
          built = Math.max(built, Math.max(0, 1 - d / 8) * t.big * cut);
        }
        ch.set('forest', k, Math.min(ch.get('forest', k), forest)); ch.set('fields', k, Math.max(ch.get('fields', k), fields)); ch.set('built', k, Math.max(ch.get('built', k), built));
      }
      // snow on the land only: ice on the water and the snow on it belong to the water aspect (its knob «Холод»)
      const line = 2600 * (1 - snow * 1.6) - (c.lat - 40) * 90;     // the snow line comes down as the knob goes up
      const snowV = snow > 0 && land > .5 ? s(line - 250, line + 150, h + jit * 120) : 0;
      if (snowV > 0) ch.set('snow', k, Math.max(ch.get('snow', k), snowV));
    }
  }
  function showData() {
    const id = p.get('chunkData');
    if (!id) return ch.show(null);
    if (id === 'land') return ch.show(ch.land, { ramp: RAMPS.warm, skip: () => false });
    if (id === 'height') return ch.show(ch.height, { max: 2600, ramp: RAMPS.warm });
    const d = DATA[id], v = new Float32Array(ch.count); for (let k = 0; k < ch.count; k++) v[k] = ch.get(id, k);
    ch.show(v, { ramp: RAMPS[d[0]], min: d[1], max: d[2], skip: () => false });
  }
  let shown = -1;
  p.on(key => { if (key == null || key.startsWith('demo')) applyState(); if (key == null || key === 'chunkData') { showData(); shown = ch.version; } });
  applyState(); showData();

  // ---- the brush: a click changes the chunk under the cursor and, more weakly, its neighbours
  function stroke(e) {
    const b = p.get('brush'); if (!b) return;
    const ll = pickGround(album, e.clientX, e.clientY); if (!ll) return;
    const k = ch.at(ll.lat, ll.lon); if (k < 0) return;
    const name = b.slice(0, -1), sign = b.endsWith('+') ? 1 : -1, r = Math.round(p.get('brushSize')) - 1;
    const water = name === 'ice';         // the brush stays on its own element: forest and fields on land, ice on water
    for (const [m, d] of ch.ring(k, r)) if (name === 'snow' || (ch.kind[m] === 0) === water) ch.add(name, m, sign * .5 * (1 - .5 * d / (r + 1)));
  }
  let down = null, last = null;
  dom.addEventListener('pointerdown', e => { down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null; });
  dom.addEventListener('pointerup', e => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) stroke(e); down = null; });
  dom.addEventListener('pointermove', e => { last = e; });
  dom.addEventListener('pointerleave', () => { last = null; });

  // ---- what the chunk under the cursor holds
  const info = document.createElement('div'); info.className = 'S chunk-info';
  info.style.cssText = 'position:fixed;left:50%;bottom:74px;transform:translateX(-50%);padding:6px 14px;background:rgba(12,16,24,.88);color:#fff;border-radius:3px;pointer-events:none;white-space:nowrap;display:none;z-index:5';
  document.body.appendChild(info);
  const pct = v => `${Math.round(v * 100)} %`;
  let tick = 0;
  return { id: 'chunktool', update() {
    if (p.get('chunkData') && shown !== ch.version) { showData(); shown = ch.version; }
    if (tick++ % 3) return;
    const on = !!p.get('chunkInfo') || !!p.get('brush');
    const ll = on && last ? pickGround(album, last.clientX, last.clientY) : null, k = ll ? ch.at(ll.lat, ll.lon) : -1;
    ch.uniforms.uChunkHoverId.value = k;
    if (k < 0) { info.style.display = 'none'; return; }
    const parts = [`Природная ячейка № ${k}`, ch.kind[k] ? 'суша' : ch.lake[k] >= 0 ? (ch.lakes[ch.lake[k]].name || 'озеро') : 'море', `${Math.round(ch.area[k])} км²`, `соседей ${ch.links[k].length}`];
    if (ch.kind[k] && ch.links[k].some(l => l.river)) parts.push('граница по реке');
    for (const name of ['forest', 'conifer', 'swamp', 'fields', 'built', 'ice', 'snow']) { const v = ch.get(name, k); if (v > .004 || (name === 'forest' && ch.kind[k])) parts.push(`${CHANNELS[name][2]} ${pct(v)}`); }
    for (const l of ch.layers.values()) if (l.data[k]) parts.push(`${l.title} ${Math.round(l.data[k] * 10) / 10}${l.unit ? ' ' + l.unit : ''}`);
    info.textContent = parts.join(' · '); info.style.display = album.shot ? 'none' : 'block';
  } };
}
