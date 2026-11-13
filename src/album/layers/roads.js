// The roads of the album, drawn. They are laid beforehand (roads/routes.js; the network is kept in
// public/assets/album/roads/roads.bin.gz and laid anew only when the land is divided otherwise): main roads from the
// town of a province to the towns of the provinces next to it and along the great roads of history, lesser roads
// between districts, tracks over the passes. A road lies on the ground (layers/ribbon.js): on the slope, in the same
// light and shade as the land, the colour of trodden earth, with a cleared verge that reads as a ride where it runs
// through a forest. From high up it is a thin thread, and the lesser kinds go first. It stops at the first houses
// of a settlement — inside, the streets of the settlement take over — and where it meets a river there is a bridge
// or a ford (roads/crossings.js).
import { makeRibbons, smoothLine } from './ribbon.js';
import { roadNetwork, roadLine, decodeNet, encodeNet, netSignature } from '../roads/routes.js';
import { riverCrossings, squareBridges, cutAtTowns, townIndex, nearIndex, BRIDGE } from '../roads/crossings.js';
import { sheetPull } from '../aspects/water.js';
import { MIN_PX as RIVER_MIN_PX } from './rivers.js';
import { kmOf, llOf } from '../chunks.js';

// What a kind of road looks like: width on the ground km (a little wider than life, as the owner allows: «совсем
// незначительно… то же самое и с дорогами»), least width in pixels near and from high up, colour on the natural land
// (as seen on screen) and on paper, how strong, and between which sizes of a pixel (km) it fades out as the camera
// rises. A great road of history, a main road between provinces, a lesser road, a track.
export const LOOK = [
  { id: 'trunk', key: 'roadMain', w: .012, px: [2.3, 1.3], light: 0xc9b58c, ink: 0x5e4022, alpha: .95, fade: null },
  { id: 'main', key: 'roadMain', w: .011, px: [2.1, 1.1], light: 0xc4b088, ink: 0x6b4a2a, alpha: .92, fade: [.38, .72] },
  { id: 'lesser', key: 'roadMinor', w: .008, px: [1.6, .9], light: 0xb9a680, ink: 0x7a5a38, alpha: .88, fade: [.08, .18] },
  { id: 'track', key: 'roadTracks', w: .005, px: [1.2, .8], light: 0xab9974, ink: 0x8a6c4a, alpha: .8, fade: [.04, .085] },
];
const VERGE = { verge: 2.8, vergeColour: 0x77714a, vergeAlpha: .42 };          // the cleared strip: both sides and the road, in widths of the road
// a bridge by the kind of its road: stone on a main road, timber on a lesser one (a track has none)
const DECK = [{ light: 0xa2957f, ink: 0x3a2a1c, look: 1 }, { light: 0x8a6f4c, ink: 0x4a3622, look: 2 }];
const DECK_RIM = { verge: 1.45, vergeColour: 0x3a342b, vergeAlpha: .8 };     // the parapets and the shade of the deck on the water
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
      rib.mesh.renderOrder = 6;
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
        const real = f.width * kr, water = Math.max(real, px * RIVER_MIN_PX * (.42 + .58 * Math.sqrt(Math.min(1, real / .16)))), half = water / f.sin / 2 + BRIDGE.abut + px * .5;
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
    if (!net) { from = file ? 'laid anew — the file is for another division: node scripts/album/bake-roads.mjs' : 'laid now, no file'; net = roadNetwork(div, div.centres, places); }
    // every line as the ribbons draw it: the steps of the chunks ironed out, in flat km
    drawn = net.lines.map(l => ({ set: setOf(l), kind: l.kind, km: smoothLine(roadLine(l.pts), .35, 2).map(q => kmOf(q[1], q[0])) }));
    fords = album.data.courses ? squareBridges(drawn, riverCrossings(drawn, album.data.courses)) : [];   // a bridge stands square across its river, the road turns to it
    near = null; version++;
    const s = net.stats, nb = fords.filter(f => f.type === 'bridge').length;
    album.roadNet = { main: s.main, minor: s.lesser, tracks: s.track, km: s.km, crossings: net.crossings, impassable: s.hard, lines: net.lines, legs: net.legs, stats: s, capitals: net.capitals, fords, version, fromFile: from === 'from the file',
      // km from a point of the flat km plane to the nearest road as it is drawn (1e9 when none within 300 m): for whoever must keep off the roads
      near: (x, y) => (near ||= nearIndex(drawn.map(l => l.km), 2, .3))(x, y),
      signature: () => netSignature(div, div.centres, net.capitals),
      // the network as the file keeps it, base64 (scripts/album/bake-roads.mjs)
      encode: () => { const u = new Uint8Array(encodeNet(net, div, div.centres)); let b = ''; for (let i = 0; i < u.length; i += 8192) b += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(b); } };
    console.log(`[album] roads (${from}): ${s.main} main, ${s.lesser} lesser, ${s.track} track legs (${s.km.join(', ')} km), ${fords.length} river crossings with ${nb} bridges, ${s.hard} impassable, ${s.unreached} districts without a road (${(performance.now() - t0).toFixed(0)} ms)`);
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
      const on = !!p.get('roadsOn') && p.get('roads') > 0, high = ss(.03, .15, px);
      // a road is seen through what stands on the ground: its depth is pulled toward the eye over the tallest crown
      const crown = typeof album.layers.forest?.top === 'number' ? album.layers.forest.top : 0, pull = crown > 0 ? crown * 1.04 + .002 : 0;
      for (const r of ribbons) {
        const L = LOOK[r.set], fade = L.fade ? 1 - ss(L.fade[0], L.fade[1], px) : 1;
        r.mesh.visible = on && fade > 0 && p.get(L.key) !== 0; if (!r.mesh.visible) continue;
        r.setPx(cam, dom); r.u.uLift.value = pull; r.u.uVergeA.value = VERGE.vergeAlpha * (1 - ss(.02, .05, px)); r.u.uVerge.value = px < .05 ? VERGE.verge : 1;   // the cleared strip is a thing of the near view r.u.uMinPx.value = L.px[0] + (L.px[1] - L.px[0]) * high; r.u.uAlpha.value = L.alpha * fade * (1 - (r.set ? .5 : .42) * ss(.03, .2, px));   // from high up a road is a faint thread: it must not argue with the land
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
