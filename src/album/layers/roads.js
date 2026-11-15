// The roads of the album, drawn. They are laid beforehand (roads/routes.js; the network is kept in
// public/assets/album/roads/roads.bin.gz and laid anew only when the land is divided otherwise): main roads from the
// town of a province to the towns of the provinces next to it and along the great roads of history, lesser roads
// between districts, tracks over hard ground; a great road takes a range at its real pass. A road lies on the ground (layers/ribbon.js): on the slope, in the same
// light and shade as the land, the colour of trodden earth, with a cleared verge that reads as a ride where it runs
// through a forest. From high up it is a thin thread, and the lesser kinds go first. It stops at the first houses
// of a settlement — inside, the streets of the settlement take over — and where it meets a river there is a bridge
// or a ford (roads/crossings.js).
import { makeRibbons, smoothLine } from './ribbon.js';
import { roadNetwork, roadLine, decodeNet, encodeNet, netSignature, fineCache, crossedPairs } from '../roads/routes.js';
import { riverCrossings, squareBridges, cutAtTowns, townIndex, nearIndex, BRIDGE } from '../roads/crossings.js';
import { sheetPull } from '../aspects/water.js';
import { riverDrawn } from './rivers.js';
import { dense, fineCover } from '../roads/shape.js';
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
// the cleared strip, both sides and the road, in widths of the road: that wide in the woods (a ride of some forty
// metres), two thirds of it on open land (the worn verge); what the two look like
const VERGE = { verge: 3.4, vergeColour: 0x77714a, vergeAlpha: .42, rideColour: 0x58803c };
// a bridge by the kind of its road: stone on a main road, timber on a lesser one (a track has none)
const DECK = [{ light: 0xa2957f, ink: 0x3a2a1c, look: 1 }, { light: 0x8a6f4c, ink: 0x4a3622, look: 2 }];
const DECK_RIM = { verge: 1.82, vergeColour: 0x3a342b, vergeAlpha: .8 };     // the parapets and the shade of the deck on the water
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
  let ribbons = [], decks = [], net = null, drawn = [], fords = [], modelSeen, near = null, version = 0, spanSeen = '';
  const towns = () => album.layers.towns?.model?.() || null;
  const drop = list => { for (const r of list) { album.scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); } };

  // the ribbons: every line as it is drawn, cut where it enters a settlement; the decks of the bridges
  function draw() {
    drop(ribbons); drop(decks);
    const model = towns(); modelSeen = model;
    // (sx, sy: how far the middle of a town lies from its point, where the settlements say so)
    const outside = townIndex((model?.towns || []).map(t => ({ x: t.x + (t.sx || 0), y: t.y + (t.sy || 0), r: t.R }))), sets = LOOK.map(() => []);
    for (const l of drawn) for (const c of cutAtTowns(l.km, outside)) sets[l.set].push({ pts: c.pts.map(q => { const g = llOf(q[0], q[1]); return [g.lon, g.lat]; }), fade: c.fade, width: LOOK[l.set].w });
    ribbons = sets.map((lines, k) => ({ ...makeRibbons(album, lines, { colour: LOOK[k].light, minPx: LOOK[k].px[0], lift: .005, ground: true, ...VERGE }), set: k }));
    decks = DECK.map((d, kind) => {
      const list = fords.filter(f => f.type === 'bridge' && f.road === kind); if (!list.length) return null;
      const rib = makeRibbons(album, list.map(f => ({ pts: [[0, 40], [0, 40]], width: LOOK[d.look].w * BRIDGE.wide })), { colour: d.light, minPx: LOOK[d.look].px[0] * BRIDGE.wide, lift: .005, ground: true, sea: false, woods: 0, ...DECK_RIM });
      rib.mesh.renderOrder = -4;                                    // over the water of the rivers (−5)
      return { ...rib, kind, list };
    }).filter(Boolean);
    spanSeen = ''; sync();
  }
  // A deck reaches from bank to bank of the river as it is drawn: from high up a river is wider than life (it is never
  // thinner than a few pixels), and its bridge grows with it. px: km in a pixel; kr: the «Ширина рек» knob
  function span(px, kr) {
    for (const d of decks) {
      const ll = d.mesh.geometry.attributes.aLL, dir = d.mesh.geometry.attributes.aDir;
      d.list.forEach((f, i) => {
        const half = riverDrawn(f.width * kr, px) / f.sin / 2 + BRIDGE.abut + px * .5;
        const a = llOf(f.x - f.dx * half, f.y - f.dy * half), b = llOf(f.x + f.dx * half, f.y + f.dy * half), c = Math.cos(a.lat * Math.PI / 180);
        let ex = (b.lon - a.lon) * c, ey = b.lat - a.lat; const len = Math.hypot(ex, ey) || 1; ex /= len; ey /= len;
        for (let v = 0; v < 4; v++) { const q = v < 2 ? a : b; ll.setXY(i * 4 + v, q.lat, q.lon); dir.setXY(i * 4 + v, ex, ey); }
      });
      ll.needsUpdate = dir.needsUpdate = true;
    }
  }
  function build() {
    const div = division.data, t0 = performance.now();
    // the network: from the file if it was laid for this very division, else laid now
    // the places stand where their houses really are (a settlement by a river is moved off the water)
    const founded = new Map((towns()?.towns || []).map(t => [t.index, t]));
    const places = album.data.vectors.places.map((pl, i) => { const t = founded.get(i); return t ? { ...llOf(t.x, t.y), pop: pl.pop } : pl; });
    let from = 'from the file'; net = file ? decodeNet(file, div, div.centres, places) : null;
    if (!net) { from = file ? 'laid anew — the file is for another division: node scripts/album/bake-roads.mjs' : 'laid now, no file'; // (the shape of the mountain legs is taken from the stale file wherever a leg is still the same: finding it anew takes seconds)
      net = roadNetwork(div, div.centres, places, undefined, { heightAt: album.terrain?.heightAt || div.raster.heightAt, courses: album.data.courses || null, reuse: file ? fineCache(file, div, div.centres) : null }); }
    // every line as the ribbons draw it: the steps of the chunks ironed out, the points on a straight dropped, in flat km
    drawn = net.lines.map(l => ({ set: setOf(l), kind: l.kind, km: smoothLine(roadLine(l.pts), .35, 2).map(q => kmOf(q[1], q[0])) }));
    fords = album.data.courses ? squareBridges(drawn, riverCrossings(drawn, album.data.courses)) : [];   // a bridge stands square across its river, the road turns to it
    // Over the fine heights of the mountains the ribbon gets a corner every 120 m, not every 350: between two corners
    // it runs straight, and fine ground would rise over it (roads/shape.js, dense). The line itself is the same.
    const cover = fineCover(album.data.meta?.fine); let corners = 0;
    if (cover) for (const l of drawn) { corners -= l.km.length; l.km = dense(l.km, cover); corners += l.km.length; }
    near = null; version++;
    const s = net.stats, nb = fords.filter(f => f.type === 'bridge').length;
    album.roadNet = { main: s.main, minor: s.lesser, tracks: s.track, km: s.km, crossings: net.crossings, impassable: s.hard, lines: net.lines, legs: net.legs, stats: s, capitals: net.capitals, fords, version,
      // the passes: { x, y (flat km), h (metres), name, kind (of the road), a, b (districts), rank (0 a pass of history, 1 of a main road, 2 other), leg }
      passes: net.passes,
      // the pairs of districts whose common boundary a road crosses: Set of a · 65536 + b, a < b (no wall of the division stands there)
      crossed: crossedPairs(div, net.legs), fromFile: from === 'from the file',
      // km from a point of the flat km plane to the nearest road as it is drawn (1e9 when none within 300 m): for whoever must keep off the roads
      near: (x, y) => (near ||= nearIndex(drawn.map(l => l.km), 2, .3))(x, y),
      signature: () => netSignature(div, div.centres, net.capitals),
      // the network as the file keeps it, base64 (scripts/album/bake-roads.mjs)
      encode: () => { const u = new Uint8Array(encodeNet(net, div, div.centres)); let b = ''; for (let i = 0; i < u.length; i += 8192) b += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(b); } };
    console.log(`[album] roads (${from}): ${s.main} main, ${s.lesser} lesser, ${s.track} track legs (${s.km.join(', ')} km), ${fords.length} river crossings with ${nb} bridges, ${s.hard} impassable, ${s.unreached} districts without a road, ${net.passes.length} passes (${s.passes[0]} of history), ${s.shaped} legs shaped${s.reused ? ' (' + s.reused + ' from the file)' : ''}${corners ? ', ' + corners + ' corners added over the fine heights' : ''} (${(performance.now() - t0).toFixed(0)} ms)`);
    draw();
  }
  function sync() {
    const dark = p.get('look') === 'paper' || p.get('look') === 'atlas';
    for (const r of ribbons) { r.u.uK.value = p.get('roads'); r.u.uColour.value.set(dark ? LOOK[r.set].ink : LOOK[r.set].light); }
    for (const d of decks) { d.u.uK.value = p.get('roads'); d.u.uColour.value.set(dark ? DECK[d.kind].ink : DECK[d.kind].light); }
  }
  build();
  division.onChange(build); p.on(sync);
  return { id: 'roads', net: () => net, fords: () => fords,
    update(dt, t, cam) {
      if (towns() !== modelSeen) draw();                           // settlements grew or went: the roads stop at their new edges
      const dom = album.renderer.domElement, px = 2 * cam.s.h * Math.tan(cam.cam.fov * Math.PI / 360) / Math.max(1, dom.clientHeight);
      const on = !!p.get('roadsOn') && p.get('roads') > 0;
      // a road is seen through what stands on the ground: its depth is pulled toward the eye over the tallest crown
      const crown = typeof album.layers.forest?.top === 'number' ? album.layers.forest.top : 0, pull = crown > 0 ? crown * 1.04 + .002 : 0;
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
      }
      // a bridge is seen while it is a few pixels long; it lies over the water, which itself is pulled over the crowns
      const bf = 1 - ss(BRIDGE.fade[0], BRIDGE.fade[1], px), kr = p.get('riversOn') ? p.get('rivers') ?? 1 : 0, over = sheetPull(album, cam) + .006;
      const key = `${Math.round(Math.log(px) * 12)}|${kr}`; if (bf > 0 && kr > 0 && key !== spanSeen) { spanSeen = key; span(px, kr); }
      for (const d of decks) {
        d.mesh.visible = on && bf > 0 && kr > 0 && p.get(LOOK[d.kind ? 2 : 1].key) !== 0; if (!d.mesh.visible) continue;
        d.setPx(cam, dom); d.u.uLift.value = over; d.u.uAlpha.value = bf;
      }
    } };
}
