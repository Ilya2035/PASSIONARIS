// The state of the water of every chunk and how it changes (docs/album/water.md). Three numbers of a chunk are the
// water's own: ice, snow (on chunks that are mostly water) and spareB (the state of the sea, 0 calm .. 1 storm). A
// fourth, the melt water standing on the ice, has no channel in the chunks (flood is water over the land and belongs
// to the swamps): the model keeps it and hands it to the water's own texture. This file sets the natural values and
// runs the freeze model: ice grows from the shore and from the north, later over deep water, spreads from chunk to
// chunk, and melts back the same way.
import { CN } from '../chunks.js';
import { MELT_BYTES, WATER_UNIFORMS } from '../aspects/water.js';

const sat = x => Math.max(0, Math.min(1, x));
const ss = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const hash = k => { let x = Math.imul(k + 1, 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) / 4294967296; };

export const SPAN = .14;          // how much colder than its threshold a chunk must be to freeze solid
export const SEA_CHANNEL = 'spareB';
// rows of states laid side by side for the album pages ("Показ воды"): each band is two chunks wide
export const SHOWS = {
  sea: { title: 'Состояния моря', bands: [0, .22, .45, .7, 1], width: 3 },
  ice: { title: 'Стадии льда', bands: [.1, .26, .45, .62, .8, .9, 1], width: 2 },
  snow: { title: 'Снег на льду', bands: [0, .25, .5, .75, 1], width: 2 },
  melt: { title: 'Тающий лёд', bands: [0, .3, .55, .8, 1], width: 2 },
};

// ch: the chunks; heightAt(lat, lon) → metres; meltBytes: one byte per chunk the melt water is copied to (the water's
// texture), or nothing. Everything here is plain numbers, so the tests run it without a GPU.
export function makeFreeze(ch, heightAt, meltBytes) {
  const n = ch.count;
  const depth = new Float32Array(n), off = new Float32Array(n).fill(1e9), res = new Float32Array(n), seaNat = new Float32Array(n), water = new Uint8Array(n);
  const ice = new Float32Array(n), melt = new Float32Array(n), snow = new Float32Array(n), sea = new Float32Array(n);
  const seen = { ice: new Int16Array(n).fill(-1), snow: new Int16Array(n).fill(-1), [SEA_CHANNEL]: new Int16Array(n).fill(-1) };
  const state = { thaw: false, meltDirty: false };                    // is there melt water anywhere; has it changed since it was last looked at
  const centres = Array.from({ length: n }, (_, k) => ch.centre(k));

  // mean depth of the water of each chunk, and how far it lies from the land (in chunks)
  const queue = [];
  for (let k = 0; k < n; k++) {
    const { i, j } = ch.ij(k); let sum = 0, cnt = 0;
    if (heightAt && ch.land[k] < 1) for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) {
      const x = (i + (a + .5) / 4) * 10, y = (j + (b + .5) / 4) * 10, h = heightAt(y / 111.195, x / (111.195 * Math.cos(40 * Math.PI / 180)));
      if (h <= 0) { sum -= h; cnt++; }
    }
    depth[k] = cnt ? sum / cnt : 0; water[k] = ch.land[k] < .6 ? 1 : 0;
    if (ch.land[k] > .3) { off[k] = 0; queue.push(k); }
  }
  for (let q = 0; q < queue.length; q++) for (const m of ch.neighbours(queue[q])) if (off[m] > off[queue[q]] + 1) { off[m] = off[queue[q]] + 1; queue.push(m); }

  // how cold it must get before a chunk starts to freeze: 0 at once .. ~.86 last of all
  for (let k = 0; k < n; k++) {
    const c = centres[k], north = sat((c.lat - 35.2) / 9.6), jit = hash(k), land = ch.land[k];
    const onLand = .10 + .22 * (1 - north) - .12 * sat(ch.height[k] / 1500);                                   // lakes and rivers: mountain water first
    const atSea = .16 + .26 * (1 - north) + .20 * Math.sqrt(sat(depth[k] / 2000)) + .028 * Math.min(off[k] === 1e9 ? 8 : off[k], 8);   // salt, deep, far from the shore: last
    res[k] = Math.max(.02, onLand * land + atSea * (1 - land) + (jit - .5) * .03);
    // the natural state of the sea: the ocean is rougher than the inner sea, the open water rougher than the coast
    const ocean = ss(-5.2, -6.2, c.lon) + ss(43.2, 43.6, c.lat) * ss(-1.2, -2, c.lon), far = sat((off[k] === 1e9 ? 8 : off[k]) / 8);
    const patch = .5 + .5 * Math.sin(c.x * .021 + 1.3) * Math.cos(c.y * .017 + .4);
    seaNat[k] = land > .97 ? 0 : sat(.16 + .14 * Math.min(1, ocean) + .12 * far + .12 * patch);
  }

  const target = (k, o) => ss(0, SPAN, (o.cold || 0) - (o.thaw || 0) * .2 - res[k]);
  const band = (k, show) => { const s = SHOWS[show], x = k % CN; return s.bands[Math.floor(x / s.width) % s.bands.length]; };
  // where each number is headed under the knobs o = { cold, thaw, snow, sea, show }
  function aim(k, o, iceNow) {
    if (o.show && SHOWS[o.show]) {
      const v = band(k, o.show);
      if (o.show === 'sea') return { ice: 0, melt: 0, snow: 0, sea: v };
      if (o.show === 'ice') return { ice: v, melt: 0, snow: 0, sea: seaNat[k] };
      if (o.show === 'snow') return { ice: .96, melt: 0, snow: v, sea: seaNat[k] };
      return { ice: .9 - v * .12, melt: v, snow: .3, sea: seaNat[k] };
    }
    const T = target(k, o), i = iceNow === undefined ? T : iceNow;
    const m = i > .02 ? sat(Math.max((o.thaw || 0) * (.7 + .3 * hash(k + 77)), (i - T) * 3)) : 0;     // ice above its target is melting
    return { ice: T, melt: m, snow: water[k] ? (o.snow || 0) * ss(.5, .85, i) * (1 - m) : -1, sea: o.sea > 0 ? sat(o.sea * (.8 + .4 * seaNat[k] / .5)) : seaNat[k] };
  }
  // lays the model's numbers into the chunks (only where they changed)
  function write(o = {}) {
    let any = false;
    for (let k = 0; k < n; k++) {
      if (!o.keepIce) put('ice', k, ice[k]);
      if (!o.keepSnow && water[k]) put('snow', k, snow[k]);
      put(SEA_CHANNEL, k, sea[k]);
      const b = Math.round(sat(melt[k]) * 255); if (b) any = true;
      if (meltBytes && meltBytes[k] !== b) { meltBytes[k] = b; state.meltDirty = true; }
    }
    state.thaw = any;
  }
  function put(name, k, v) { ch.set(name, k, v); seen[name][k] = Math.round(ch.get(name, k) * 255); }
  // Someone else changed a chunk (the brush of the album, a demonstration): the model takes the chunk's number as the
  // truth and leaves that chunk alone from then on (pin: 1 its ice, 2 its snow) until the state is laid anew. Ice
  // frozen by hand stays; it can still pass its cold on to the neighbours if the weather lets them freeze.
  const pin = new Uint8Array(n);
  function adopt() {
    for (let k = 0; k < n; k++) {
      let b = Math.round(ch.get('ice', k) * 255); if (b !== seen.ice[k]) { ice[k] = b / 255; seen.ice[k] = b; pin[k] |= 1; }
      b = Math.round(ch.get('snow', k) * 255); if (water[k] && b !== seen.snow[k]) { snow[k] = b / 255; seen.snow[k] = b; pin[k] |= 2; }
    }
  }
  // everything at once to where it is headed: a page opens with its picture ready
  function settle(o) {
    pin.fill(0);
    for (let k = 0; k < n; k++) { const t = aim(k, o); ice[k] = t.ice; melt[k] = t.melt; if (t.snow >= 0) snow[k] = t.snow; sea[k] = t.sea; }
    write(o);
  }
  // one step of time, dt in seconds of album time
  function step(dt, o) {
    adopt();
    const next = new Float32Array(ice);
    for (let k = 0; k < n; k++) {
      const cur = ice[k], t = aim(k, o, cur);
      if (!o.keepIce && !(pin[k] & 1)) {
        if (t.ice > cur) {
          // ice comes from the shore and from a frozen neighbour, never out of the open sea
          let hold = off[k] <= 1 || cur > .2;
          if (!hold) for (const m of ch.neighbours(k)) if (ice[m] > .3) { hold = true; break; }
          if (hold) next[k] = Math.min(t.ice, cur + dt * .3);
        } else if (t.ice < cur) {
          let edge = false;                                           // the edge next to open water goes first
          for (const m of ch.neighbours(k)) if (ice[m] < cur - .15) { edge = true; break; }
          next[k] = Math.max(t.ice, cur - dt * (edge ? .22 : .07));
        }
      }
      melt[k] += Math.max(-dt * 1.2, Math.min(dt * .8, (cur > .02 ? t.melt : 0) - melt[k]));
      if (t.snow >= 0 && !o.keepSnow && !(pin[k] & 2)) snow[k] += Math.max(-dt * .5, Math.min(dt * .12, t.snow - snow[k]));
      sea[k] += Math.max(-dt * .25, Math.min(dt * .25, t.sea - sea[k]));
    }
    ice.set(next);
    write(o);
  }
  // the natural state: an open sea with its own weather, no ice
  function natural() { for (let k = 0; k < n; k++) { ch.setNatural(SEA_CHANNEL, k, seaNat[k]); sea[k] = seaNat[k]; seen[SEA_CHANNEL][k] = Math.round(ch.get(SEA_CHANNEL, k) * 255); } }
  // after chunks.reset(): the natural state is back in the chunks, lay the model's own over it again
  function relay(o) { pin.fill(0); for (const a of Object.values(seen)) a.fill(-1); write(o); }
  return { ice, melt, snow, sea, res, depth, off, water, seaNat, state, target, aim, settle, step, write, natural, relay };
}

// the winter that comes and goes ("Зима идёт по кругу"): 0 → 1 → 0 share of the page's cold over one round
export function winterPhase(t) {
  const u = (t % 110) / 110;
  return u < .4 ? ss(0, .4, u) : u < .5 ? 1 : u < .92 ? 1 - ss(.5, .92, u) : 0;
}

export default async function init(album) {
  const ch = album.chunks, p = album.params, model = album.water = makeFreeze(ch, album.data.base.at, MELT_BYTES);
  const upload = () => { if (model.state.meltDirty) { WATER_UNIFORMS.tWaterMelt.value.needsUpdate = true; model.state.meltDirty = false; } WATER_UNIFORMS.uWaterThaw.value = model.state.thaw ? 1 : 0; };
  model.natural();
  let settle = true, clock = 0;
  const knobs = () => {
    const cycle = !!p.get('winterCycle');
    return { cold: p.get('cold') * (cycle ? (album.shot ? .8 : winterPhase(clock)) : 1), thaw: p.get('thaw'), snow: p.get('iceSnow'), sea: p.get('seaState'), show: p.get('waterShow'),
      keepIce: p.get('demoIce') > 0, keepSnow: p.get('demoSnow') > 0 };          // the stand-in demonstrations of chunktool.js keep their say while they are on
  };
  p.on(key => { if (key == null || album.shot || !album.ready || key === 'waterShow' || key === 'winterCycle') { settle = true; if (key == null || key === 'winterCycle') clock = 0; } });
  ch.onReset(() => { model.relay(knobs()); upload(); });
  let acc = 0;
  return { id: 'freeze', update(dt) {
    if (settle) { settle = false; acc = 0; const o = knobs(); model.settle(p.get('winterCycle') && !album.shot ? { ...o, cold: 0 } : o); upload(); return; }
    acc += dt * p.get('play');
    if (acc < .1) return;                                             // ten steps a second are plenty for chunks
    clock += acc; model.step(acc, knobs()); acc = 0; upload();
  } };
}
