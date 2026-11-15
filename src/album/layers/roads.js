// The roads of the album, drawn. They are laid beforehand (roads/routes.js; the network is kept in
// public/assets/album/roads/roads.bin.gz and laid anew only when the land is divided otherwise): main roads from the
// town of a province to the towns of the provinces next to it and along the great roads of history, lesser roads
// between districts, tracks over hard ground; a great road takes a range at its real pass. A road lies on the ground (layers/ribbon.js): on the slope, in the same
// light and shade as the land, the colour of trodden earth, with a cleared verge that reads as a ride where it runs
// through a forest. From high up it is a thin thread, and the lesser kinds go first. It stops at the first houses
// of a settlement — inside, the streets of the settlement take over — and where it meets a river there is a bridge,
// a ford or a ferry (roads/crossings.js): a bridge of stone, of timber, a footbridge — things with volume
// (roads/works.js) —, the pale shallow of a ford, the hut and the boat of a ferry. The fords of the rivers are marked
// all along them, whether a road comes to them or not.
import { makeRibbons, smoothLine } from './ribbon.js';
import { roadNetwork, roadLine, decodeNet, encodeNet, netSignature, fineCache, crossedPairs, roadGround, chunkKinds, wayToMain } from '../roads/routes.js';
import { infraLevels } from '../roads/infra.js';
import { KN, KNY, KKM, KX0, KY0, rowScale } from '../division/km.js';
import { riverCrossings, squareBridges, fordSites, cutAtTowns, townIndex, nearIndex, BRIDGE, FORD_MIN } from '../roads/crossings.js';
import { makeWorks } from '../roads/works.js';
import { sheetPull } from '../aspects/water.js';
import { riverDrawn, riverFar, MID } from './rivers.js';
import { dense, fineCover } from '../roads/shape.js';
import { hugBanks } from '../roads/banks.js';
import { decodeTile } from '../ground/fine.js';
import { kmOf, llOf } from '../chunks.js';

// What a kind of road looks like: width on the ground km (a little wider than life, as the owner allows: «совсем
// незначительно… то же самое и с дорогами»), least width in pixels near and from high up, colour on the natural land
// (as seen on screen) and on paper, and where it goes as the camera rises: `fade` — between which sizes of a pixel
// (km), `high` — between which heights of the camera (km). A great road of history, a main road between provinces,
// a lesser road, a track.
export const LOOK = [
  { id: 'trunk', key: 'roadMain', w: .012, px: [2.3, 1.2], light: 0xc9b58c, ink: 0x5e4022, high: [1000, 1200] },
  { id: 'main', key: 'roadMain', w: .011, px: [2.1, 1.1], light: 0xc4b088, ink: 0x6b4a2a, high: [1000, 1200] },
  { id: 'lesser', key: 'roadMinor', w: .008, px: [1.6, 1.2], light: 0xb9a680, ink: 0x7a5a38, fade: [.14, .19] },
  { id: 'track', key: 'roadTracks', w: .005, px: [1.2, 1.0], light: 0xab9974, ink: 0x8a6c4a, fade: [.065, .085] },
];
// From high up (the owner, 15.11.2026: «Дорога должна пропадать после 1000 километров… С 1000 километров прям отлично
// видно дороги. И там на 1200 они уже растворяются»; тропы — «со 100 нормально»). A pixel is .19 km from 300 km of
// height, .38 from 600, .52 from 820 (the height the game opens at) in a window 900 pixels high.
//   • a track goes between 100 and 130 km, a lesser road between 220 and 300 km — by the size of a pixel, as before;
//   • a main road and a great road of history are whole up to 1000 km and gone by 1200 km — by the height of the
//     camera itself, the same in a window of any size: that is how the owner names it;
//   • every road thins from its near width to its far one between 300 and 600 km: from high up it is a thin thread.
export const THIN = [.19, .38];
// how set `set` of LOOK is drawn when a pixel is px km and the camera stands h km high: its least width in pixels and
// how strong it is (0: not drawn)
export function roadFar(set, px, h = 0) {
  const L = LOOK[set];
  return { minPx: L.px[0] + (L.px[1] - L.px[0]) * ss(THIN[0], THIN[1], px), alpha: (L.fade ? 1 - ss(L.fade[0], L.fade[1], px) : 1) * (L.high ? 1 - ss(L.high[0], L.high[1], h) : 1) };
}
// Near the ground a road is a thing with volume (the owner, 15.11.2026: «Где-то уже на 100-м километре они
// превращаются в 3D-объекты. Потихонечку. От 100 до 50 километров»): between these heights of the camera (km) the
// level bed, the banks cut into a slope or built up, the causeway over a bog come in (layers/ribbon.js, uVol).
export const VOL = [50, 100];
// The bed of each kind of road: how many metres it stands over level ground (a main road is a low causeway; a track
// is worn into the ground), and how much of its paint the road keeps near the ground («Малая дорога вблизи: текстура
// дороги должна быть очень незаметной. Вблизи можно будет её увидеть как маленький 3D-объект»).
export const BED = [{ raise: .9, soft: 1 }, { raise: .8, soft: 1 }, { raise: .6, soft: .72 }, { raise: -.5, soft: .62 }];
// the cleared strip, both sides and the road, in widths of the road: that wide in the woods (a ride of some forty
// metres), two thirds of it on open land (the worn verge); what the two look like
const VERGE = { verge: 3.4, vergeColour: 0x77714a, vergeAlpha: .42, rideColour: 0x58803c };
// What lies flat on the water where a road meets it. Under a bridge — the shade of its deck (the bridge itself has
// volume: roads/works.js; on paper the flat deck is the bridge, in ink): of stone on a main road, of timber on a
// lesser one, a footbridge on a track. At a ford — the pale shallow from bank to bank. look: whose road (LOOK);
// wide: against the road; alpha: how strong on the natural land.
const DECK = [
  { type: 'bridge', road: 0, look: 1, wide: BRIDGE.wide, light: 0x25262a, ink: 0x3a2a1c, alpha: .4 },
  { type: 'bridge', road: 1, look: 2, wide: BRIDGE.wide, light: 0x25262a, ink: 0x4a3622, alpha: .4 },
  { type: 'bridge', road: 2, look: 3, wide: BRIDGE.wide * .5, light: 0x25262a, ink: 0x4a3622, alpha: .36 },
  { type: 'ford', road: -1, look: 2, wide: 2.6, light: 0xd9cfab, ink: 0x8f7c58, alpha: .55 },
];
const DECK_RIM = { verge: 1.5, vergeColour: 0x25262a, vergeAlpha: .35 };     // the soft edge of the shade
const WORK = ['stone', 'timber', 'foot'];                                    // the bridge of a main road, of a lesser one, of a track
// how much darker a road is in the woods: near the ground, from high up; between which sizes of a pixel (km) the one gives way to the other (60 and 110 km of height)
export const WOODS_DIM = [.3, .5], WOODS_NEAR = [.04, .07];
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const setOf = l => (l.kind === 0 ? (l.name ? 0 : 1) : l.kind + 1);

async function loadFile() {
  try {
    const r = await fetch('assets/album/roads/roads.bin.gz'); if (!r.ok) return null;
    return await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  } catch { return null; }
}

export default async function init(album) {
  const p = album.params, division = album.division;
  if (!division?.data?.cells) { console.warn('[album] roads: no division to lay them over'); return null; }
  const file = await loadFile();
  let ribbons = [], decks = [], works = [], sites = [], net = null, drawn = [], fords = [], modelSeen, near = null, version = 0, spanSeen = '';
  let ground = null, kinds = null, levels = null, ways = new Map();       // for toMain() and infra(): made when first asked for
  const towns = () => album.layers.towns?.model?.() || null;
  const drop = list => { for (const r of list) { album.scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); } };

  // the ribbons: every line as it is drawn, cut where it enters a settlement; the decks of the bridges
  function draw() {
    drop(ribbons); drop(decks); drop(works);
    const model = towns(); modelSeen = model;
    // (sx, sy: how far the middle of a town lies from its point, where the settlements say so)
    const outside = townIndex((model?.towns || []).map(t => ({ x: t.x + (t.sx || 0), y: t.y + (t.sy || 0), r: t.R }))), sets = LOOK.map(() => []);
    // (bank: a corner on the bank of a river says which way the water lies and how wide it is — roads/banks.js)
    for (const l of drawn) for (const c of cutAtTowns(l.km, outside)) sets[l.set].push({ pts: c.pts.map(q => { const g = llOf(q[0], q[1]); return [g.lon, g.lat]; }), bank: c.pts.some(q => q.bank) ? c.pts.map(q => q.bank || null) : null, fade: c.fade, width: LOOK[l.set].w });
    ribbons = sets.map((lines, k) => ({ ...makeRibbons(album, lines, { colour: LOOK[k].light, minPx: LOOK[k].px[0], lift: .005, ground: true, ...VERGE }), set: k }));
    for (const r of ribbons) { r.u.uRiverLeast.value[0] = MID.least[0]; r.u.uRiverLeast.value[1] = MID.least[1]; r.u.uRaise.value = BED[r.set].raise; r.u.uSoft.value = BED[r.set].soft; }
    decks = DECK.map((d, kind) => {
      // (a ford is marked where a road wades water that is more than a step wide, and at the fords of the rivers no road comes to)
      const list = d.type === 'ford' ? [...fords.filter(f => f.type === 'ford' && !f.weave && f.width >= FORD_MIN), ...sites.map(s => ({ ...s, sin: 1, site: true }))] : fords.filter(f => f.type === 'bridge' && f.road === d.road); if (!list.length) return null;
      const rib = makeRibbons(album, list.map(f => ({ pts: [[0, 40], [0, 40]], width: LOOK[d.look].w * d.wide })), { colour: d.light, minPx: LOOK[d.look].px[0] * d.wide, lift: .005, ground: true, sea: false, woods: 0, ...(d.type === 'ford' ? {} : DECK_RIM) });
      rib.mesh.renderOrder = -4;                                    // over the water of the rivers (−5)
      return { ...rib, kind, list, d };
    }).filter(Boolean);
    // the bridges themselves and the ferries: by the kind of their road, so that each can be switched off with it
    works = WORK.map((name, kind) => {
      const list = fords.filter(f => (f.type === 'bridge' || f.type === 'ferry') && f.road === kind).map(f => { const g = llOf(f.x, f.y); return { lat: g.lat, lon: g.lon, dx: f.dx, dy: f.dy, width: f.width, sin: f.sin, kind: f.type === 'ferry' ? 'ferry' : name, road: LOOK[kind + 1].w, minPx: LOOK[kind + 1].px[0] }; });
      return list.length ? { ...makeWorks(album, list, { wide: BRIDGE.wide }), kind } : null;
    }).filter(Boolean);
    for (const w of works) { w.u.uRiverLeast.value[0] = MID.least[0]; w.u.uRiverLeast.value[1] = MID.least[1]; }
    spanSeen = ''; sync();
  }
  // A deck reaches from bank to bank of the river as it is drawn: from high up a river is wider than life (it is never
  // thinner than a few pixels), and its bridge grows with it. px: km in a pixel; kr: the «Ширина рек» knob
  function span(px, kr) {
    for (const d of decks) {
      const ll = d.mesh.geometry.attributes.aLL, dir = d.mesh.geometry.attributes.aDir;
      d.list.forEach((f, i) => {
        const half = riverDrawn(f.width * kr, px) / f.sin / 2 + (d.d.type === 'ford' ? .002 : BRIDGE.abut) + px * .5;
        const a = llOf(f.x - f.dx * half, f.y - f.dy * half), b = llOf(f.x + f.dx * half, f.y + f.dy * half), c = Math.cos(a.lat * Math.PI / 180);
        let ex = (b.lon - a.lon) * c, ey = b.lat - a.lat; const len = Math.hypot(ex, ey) || 1; ex /= len; ey /= len;
        for (let v = 0; v < 4; v++) { const q = v < 2 ? a : b; ll.setXY(i * 4 + v, q.lat, q.lon); dir.setXY(i * 4 + v, ex, ey); }
      });
      ll.needsUpdate = dir.needsUpdate = true;
    }
  }
  // fineAt(lat, lon) → metres: the heights to lay the network on anew, whatever the file says (rebake(), below)
  function build(fineAt = null) {
    const div = division.data, t0 = performance.now(), baseAt = album.terrain?.heightAt || div.raster.heightAt;
    // the network: from the file if it was laid for this very division, else laid now
    // the places stand where their houses really are (a settlement by a river is moved off the water)
    const founded = new Map((towns()?.towns || []).map(t => [t.index, t]));
    const places = album.data.vectors.places.map((pl, i) => { const t = founded.get(i); return t ? { ...llOf(t.x, t.y), pop: pl.pop } : pl; });
    let from = 'from the file'; net = file && !fineAt ? decodeNet(file, div, div.centres, places) : null;
    if (!net) { from = fineAt ? 'laid anew on the fine heights' : file ? 'laid anew — the file is for another division: node scripts/album/bake-roads.mjs' : 'laid now, no file'; // (the shape of the mountain legs is taken from the stale file wherever a leg is still the same: finding it anew takes seconds)
      net = roadNetwork(div, div.centres, places, undefined, { heightAt: fineAt || baseAt, courses: album.data.courses || null, reuse: file && !fineAt ? fineCache(file, div, div.centres) : null }); }
    // every line as the ribbons draw it: the steps of the chunks ironed out, the points on a straight dropped, in flat km
    drawn = net.lines.map(l => ({ set: setOf(l), kind: l.kind, km: smoothLine(roadLine(l.pts), .35, 2).map(q => kmOf(q[1], q[0])) }));
    // a road that runs along a river over ground that stands above it — in a gorge — is laid on the bank of that river
    const banks = album.data.courses && baseAt ? hugBanks(drawn, album.data.courses, (x, y) => { const g = llOf(x, y); return baseAt(g.lat, g.lon); }) : { stretches: 0, km: 0 };
    const atKm0 = baseAt ? (x, y) => { const g = llOf(x, y); return baseAt(g.lat, g.lon); } : null;
    fords = album.data.courses ? squareBridges(drawn, riverCrossings(drawn, album.data.courses, 1, atKm0)) : [];   // a bridge stands square across its river, the road turns to it
    sites = album.data.courses && atKm0 ? fordSites(album.data.courses, atKm0, fords) : [];                        // the fords of the rivers that no road comes to
    // Over the fine heights of the mountains the ribbon gets a corner every 120 m, not every 350: between two corners
    // it runs straight, and fine ground would rise over it (roads/shape.js, dense). The line itself is the same.
    const cover = fineCover(album.data.meta?.fine); let corners = 0;
    if (cover) for (const l of drawn) { corners -= l.km.length; l.km = dense(l.km, cover); corners += l.km.length; }
    near = null; ground = kinds = levels = null; ways = new Map(); version++;
    // The way from a point of the flat km plane to the nearest main road — over the land as a walker goes, along the
    // roads and tracks that are there (roads/routes.js, wayToMain). → { km, cost (km of level ground it is worth),
    // road (km of it along roads), pts: [[x, y] …] } or null where no way can be laid. For the settlements: a village
    // knows how far it is from a main road. Worked out when asked, a few milliseconds a place, and kept.
    const atKm = (x, y) => { const g = llOf(x, y); return baseAt(g.lat, g.lon); };
    const toMain = (x, y) => {
      const tx = Math.floor((x - KX0) / KKM), ty = Math.floor((y - KY0) / KKM); if (!(tx >= 0 && ty >= 0 && tx < KN && ty < KNY)) return null;
      const t = ty * KN + tx; if (ways.has(t)) return ways.get(t);
      ground ||= roadGround(div); kinds ||= chunkKinds(net.legs);
      const w = wayToMain(ground, t, kinds, baseAt ? atKm : null), r = w ? { km: w.km, cost: w.cost, road: w.road, pts: w.path.map(u => [KX0 + (u % KN + .5) * KKM, KY0 + (Math.floor(u / KN) + .5) * KKM]) } : null;
      ways.set(t, r); return r;
    };
    const s = net.stats, nb = fords.filter(f => f.type === 'bridge').length;
    album.roadNet = { main: s.main, minor: s.lesser, tracks: s.track, km: s.km, crossings: net.crossings, impassable: s.hard, lines: net.lines, legs: net.legs, stats: s, capitals: net.capitals, fords, version,
      // the fords of the rivers no road comes to: [{ x, y, width, river, dx, dy (across the river), rx, ry }] (roads/crossings.js, fordSites)
      fordSites: sites,
      // the passes: { x, y (flat km), h (metres), name, kind (of the road), a, b (districts), rank (0 a pass of history, 1 of a main road, 2 other), leg }
      passes: net.passes,
      // the pairs of districts whose common boundary a road crosses: Set of a · 65536 + b, a < b (no wall of the division stands there)
      crossed: crossedPairs(div, net.legs), fromFile: from === 'from the file',
      // km of road laid on the banks of the rivers it runs along (roads/banks.js); the network laid anew on the fine heights (the bake)
      banks, rebake, toMain,
      // for every chunk (Uint8Array, KN × KNY): the greatest road that runs through it — 3 main, 2 lesser, 1 track, 0 none;
      // and what can be laid through it — the same numbers (roads/infra.js: the limits the network is laid by), never less than the road that is there
      chunkKinds: () => (kinds ||= chunkKinds(net.legs)),
      infra: () => { if (!levels) { const land = new Uint8Array(KN * KNY); for (let t = 0; t < land.length; t++) { const d = div.cells[t]; land[t] = d >= 0 && div.kinds[d] === 0 ? 1 : 0; } levels = infraLevels(div.raster.hgt, land, KN, KKM, kinds ||= chunkKinds(net.legs), KNY, rowScale); } return levels; },
      // km from a point of the flat km plane to the nearest road as it is drawn (1e9 when none within 300 m): for whoever must keep off the roads
      near: (x, y) => (near ||= nearIndex(drawn.map(l => l.km), 2, .3))(x, y),
      signature: () => netSignature(div, div.centres, net.capitals),
      // the network as the file keeps it, base64 (scripts/album/bake-roads.mjs)
      encode: () => { const u = new Uint8Array(encodeNet(net, div, div.centres)); let b = ''; for (let i = 0; i < u.length; i += 8192) b += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(b); } };
    console.log(`[album] roads (${from}): ${s.main} main, ${s.lesser} lesser, ${s.track} track legs (${s.km.join(', ')} km), ${fords.length} river crossings with ${nb} bridges, ${fords.filter(f => f.type === 'ferry').length} ferries and ${fords.filter(f => f.type === 'ford' && !f.weave && f.width >= FORD_MIN).length} fords, ${sites.length} fords more along the rivers, ${s.hard} impassable, ${s.unreached} districts without a road, ${net.passes.length} passes (${s.passes[0]} of history), ${s.shaped} legs shaped${s.reused ? ' (' + s.reused + ' from the file)' : ''}${corners ? ', ' + corners + ' corners added over the fine heights' : ''}, ${banks.km} km on the banks of rivers (${(performance.now() - t0).toFixed(0)} ms)`);
    draw();
  }
  function sync() {
    const dark = p.get('look') === 'paper' || p.get('look') === 'atlas';
    for (const r of ribbons) { r.u.uK.value = p.get('roads'); r.u.uColour.value.set(dark ? LOOK[r.set].ink : LOOK[r.set].light); }
    for (const d of decks) { d.u.uK.value = p.get('roads'); d.u.uColour.value.set(dark ? d.d.ink : d.d.light); d.dark = dark; }
    for (const w of works) { w.u.uK.value = p.get('roads'); w.dark = dark; }
  }
  // The network laid anew on the fine heights of the mountains (a point every 57 m; the page itself keeps a point
  // every 230 m in memory): for the bake only — scripts/album/bake-roads.mjs. Every fine tile is read, a hundred
  // megabytes of heights. The gorge that the coarse heights do not have is there, and so is the true height of a
  // pass. → how many tiles were read
  // Only the tiles under the roads are read (a larger region has thousands of them). The way of every leg chunk by
  // chunk does not depend on the fine heights, so the network is laid once by the heights of the page, and the
  // tiles within 2.6 km of its legs — more than the strip a fine way may use — are the ones the second laying needs.
  async function rebake() {
    const fine = album.data.meta?.fine, base = album.terrain?.heightAt || division.data.raster.heightAt;
    if (!fine?.tiles?.length) { build(base); return 0; }
    const N = 2 ** fine.z, tiles = new Map(), have = new Set(fine.tiles.map(t => t[0] * 65536 + t[1])), want = new Set(), M = 2.6;
    build(base);
    const mark = (x, y) => { const g = llOf(x, y), s = Math.sin(g.lat * Math.PI / 180), k = Math.floor((g.lon + 180) / 360 * N) * 65536 + Math.floor((.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * N); if (have.has(k)) want.add(k); };
    for (const L of net.legs) if (L.kind !== 3 && L.path) for (const t of L.path) { const x = KX0 + (t % KN + .5) * KKM, y = KY0 + (Math.floor(t / KN) + .5) * KKM; mark(x, y); mark(x - M, y - M); mark(x + M, y - M); mark(x - M, y + M); mark(x + M, y + M); }
    const list = [...want].map(k => [Math.floor(k / 65536), k % 65536]);
    const get = async ([x, y]) => { try { const r = await fetch(`album-data/${fine.dir}${x}_${y}.u16d.gz`); if (!r.ok) return; tiles.set(x * 65536 + y, decodeTile(new Uint16Array(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()))); } catch { /* a tile that cannot be read: the base heights serve there */ } };
    for (let i = 0; i < list.length; i += 24) await Promise.all(list.slice(i, i + 24).map(get));
    const pt = (i, j) => { const t = tiles.get((i >> 8) * 65536 + (j >> 8)); return t ? t[(j & 255) * 256 + (i & 255)] / 4 - 8192 : null; };
    build((lat, lon) => {
      const mx = (lon + 180) / 360 * N * 256 - .5, s = Math.sin(lat * Math.PI / 180), my = (.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * N * 256 - .5;
      const i = Math.floor(mx), j = Math.floor(my), fx = mx - i, fy = my - j, a = pt(i, j), b = pt(i + 1, j), c = pt(i, j + 1), d = pt(i + 1, j + 1);
      return a === null || b === null || c === null || d === null ? base(lat, lon) : (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    });
    return tiles.size;
  }
  build();
  division.onChange(() => build()); p.on(sync);
  return { id: 'roads', net: () => net, fords: () => fords,
    update(dt, t, cam) {
      if (towns() !== modelSeen) draw();                           // settlements grew or went: the roads stop at their new edges
      const dom = album.renderer.domElement, px = 2 * cam.s.h * Math.tan(cam.cam.fov * Math.PI / 360) / Math.max(1, dom.clientHeight);
      const on = !!p.get('roadsOn') && p.get('roads') > 0;
      // a road is seen through what stands on the ground: its depth is pulled toward the eye over the tallest crown
      const crown = typeof album.layers.forest?.top === 'number' ? album.layers.forest.top : 0, pull = crown > 0 ? crown * 1.04 + .002 : 0;
      // the rivers as they are drawn now: a road on a bank moves aside with the water, which from high up is wider than life
      const kr = p.get('riversOn') ? p.get('rivers') ?? 1 : 0, rf = riverFar(px);
      const look = p.get('look'), vol = look === 'paper' || look === 'atlas' ? 0 : 1 - ss(VOL[0], VOL[1], cam.s.h);   // on paper a road is a drawn line at any height
      for (const r of ribbons) {
        const far = roadFar(r.set, px, cam.s.h);
        r.mesh.visible = on && far.alpha > 0 && p.get(LOOK[r.set].key) !== 0;
        if (!r.mesh.visible) continue;
        r.setPx(cam, dom);
        r.u.uLift.value = pull;
        r.u.uMinPx.value = far.minPx;
        r.u.uAlpha.value = far.alpha;
        // the cleared strip beside a road is a thing of the near view
        r.u.uNear.value = 1 - ss(.02, .05, px);
        r.u.uVerge.value = px < .05 ? VERGE.verge : 1;
        // in the woods a road is darker, as it was from high up; below some 60 km less so: a road over a pass must be seen in the dark forest of the mountains
        r.u.uDim.value = WOODS_DIM[1] + (WOODS_DIM[0] - WOODS_DIM[1]) * (1 - ss(WOODS_NEAR[0], WOODS_NEAR[1], px));
        r.u.uRiver.value[0] = px * rf.minPx; r.u.uRiver.value[1] = rf.lean; r.u.uRiver.value[2] = kr; r.u.uVol.value = vol;
      }
      // a bridge is seen while it is a few pixels long; it lies over the water, which itself is pulled over the crowns
      const bf = 1 - ss(BRIDGE.fade[0], BRIDGE.fade[1], px), over = sheetPull(album, cam) + .006;
      const key = `${Math.round(Math.log(px) * 12)}|${kr}`; if (bf > 0 && kr > 0 && key !== spanSeen) { spanSeen = key; span(px, kr); }
      for (const d of decks) {
        d.mesh.visible = on && bf > 0 && kr > 0 && (d.d.type === 'ford' ? p.get('roadTracks') !== 0 : p.get(LOOK[d.d.look].key) !== 0); if (!d.mesh.visible) continue;
        d.setPx(cam, dom); d.u.uLift.value = over; d.u.uAlpha.value = bf * (d.dark ? 1 : d.d.alpha);
      }
      // the bridges and the ferries: things with volume, on the natural land (on paper the flat deck is the bridge)
      for (const w of works) {
        w.mesh.visible = on && bf > 0 && kr > 0 && !w.dark && p.get(LOOK[w.kind + 1].key) !== 0; if (!w.mesh.visible) continue;
        w.u.uPx.value = px; w.u.uAlpha.value = bf; w.u.uPull.value = .6 * (.02 + cam.s.h * .0005);
        w.u.uRiver.value[0] = px * rf.minPx; w.u.uRiver.value[1] = rf.lean; w.u.uRiver.value[2] = kr;
      }
    } };
}
