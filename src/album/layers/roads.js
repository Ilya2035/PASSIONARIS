// Roads laid over the real relief from the centre of one district to the centre of the next (roads/routes.js): main
// roads between the largest places, lesser roads to the other places, and a track into every district that has none.
// A road keeps to valleys, takes a range at a pass, crosses a river once; roads meet and part at the centres of
// districts, where the towns stand. They are drawn close to their real width: from high up a road is a thin line, and
// the tracks are left out. When the division changes (another size of districts), the roads are laid again.
import { makeRibbons, smoothLine } from './ribbon.js';
import { roadNetwork, roadLine } from '../roads/routes.js';
import { llOf } from '../chunks.js';

// main road, lesser road, track: width on the ground km, least width in pixels, colour on the natural land and on paper
const LOOK = [
  // (a little wider than life, as the owner allows: «совсем незначительно… то же самое и с дорогами»)
  { w: .030, px: 2.8, light: 0xf0d9a6, ink: 0x6b4a2a, alpha: 1 },
  { w: .020, px: 2.0, light: 0xe2c992, ink: 0x7a5a38, alpha: .9 },
  { w: .012, px: 1.4, light: 0xd6bc88, ink: 0x8a6c4a, alpha: .8 },
];
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export default async function init(album) {
  const p = album.params, division = album.division;
  if (!division?.data?.cells) { console.warn('[album] roads: no division to lay them over'); return null; }
  let ribbons = [], net = null;
  function build() {
    for (const r of ribbons) { album.scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); }
    const div = division.data, t0 = performance.now();
    // the places stand where their houses really are (a settlement by a river is moved off the water)
    const founded = new Map((album.layers.towns?.model?.()?.towns || []).map(t => [t.index, t]));
    const places = album.data.vectors.places.map((pl, i) => { const t = founded.get(i); return t ? { ...llOf(t.x, t.y), pop: pl.pop } : pl; });
    net = roadNetwork(div, div.centres, places);
    const byKind = [[], [], []];
    for (const l of net.lines) byKind[l.kind].push({ pts: smoothLine(roadLine(l.pts), .35, 2), width: LOOK[l.kind].w });
    ribbons = byKind.map((lines, k) => ({ ...makeRibbons(album, lines, { colour: LOOK[k].light, minPx: LOOK[k].px, lift: .005 }), kind: k }));
    const s = net.stats;
    album.roadNet = { main: s.main, minor: s.lesser, tracks: s.track, km: s.km, crossings: net.crossings, impassable: s.hard, lines: net.lines, legs: net.legs, stats: s };
    console.log(`[album] roads: ${s.main} main, ${s.lesser} lesser, ${s.track} track legs (${s.km.join(', ')} km), ${s.crossings} river crossings, ${s.hard} impassable, ${s.unreached} districts without a road (${(performance.now() - t0).toFixed(0)} ms)`);
    sync();
  }
  function sync() {
    const on = !!p.get('roadsOn') && p.get('roads') > 0, dark = p.get('look') === 'paper' || p.get('look') === 'atlas';
    for (const r of ribbons) { r.mesh.visible = on; r.u.uK.value = p.get('roads'); r.u.uColour.value.set(dark ? LOOK[r.kind].ink : LOOK[r.kind].light); }
  }
  build();
  division.onChange(build); p.on(sync);
  return { id: 'roads', net: () => net,
    update(dt, t, cam) {
      const dom = album.renderer.domElement, px = 2 * cam.s.h * Math.tan(cam.cam.fov * Math.PI / 360) / Math.max(1, dom.clientHeight);
      // from high up only the greater roads are left: tracks fade past 250 km, lesser roads past 700 km
      const fade = [1, 1 - ss(.45, .75, px), 1 - ss(.15, .27, px)];
      // a road is seen through the forest it runs in: it is drawn at the height of the tallest crown the forest draws now
      const crown = typeof album.layers.forest?.top === 'number' ? album.layers.forest.top : 0, lift = Math.max(.005, crown * 1.08 + .003);
      for (const r of ribbons) { r.setPx(cam, dom); r.u.uLift.value = lift; r.u.uAlpha.value = LOOK[r.kind].alpha * fade[r.kind]; if (fade[r.kind] <= 0) r.mesh.visible = false; else r.mesh.visible = !!p.get('roadsOn') && p.get('roads') > 0; }
    } };
}
