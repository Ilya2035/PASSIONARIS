// Rivers of the region (Natural Earth centre lines) as water ribbons with a width by rank.
import { makeRibbons, smoothLine } from './ribbon.js';

const COLOURS = { natural: 0x4a93bd, vivid: 0x3fa0d6, autumn: 0x4f93b6, winter: 0x6f9cbd, atlas: 0x3d78b8, paper: 0x5f8fb5, night: 0x6f8fb0 };
export default async function init(album) {
  const lines = album.data.vectors.rivers.filter(r => r.pts.length > 2).map(r => ({ pts: smoothLine(r.pts, 1.2, 2), width: r.rank <= 6 ? .32 : r.rank <= 8 ? .2 : .12, name: r.name }));
  const rib = makeRibbons(album, lines, { colour: COLOURS.natural, minPx: 2.6, lift: .003 });
  const p = album.params;
  const sync = () => {
    rib.mesh.visible = !!p.get('riversOn') && p.get('rivers') > 0;
    rib.u.uK.value = p.get('rivers'); rib.u.uColour.value.set(COLOURS[p.get('look')] || COLOURS.natural);
  };
  p.on(sync); sync();
  return { id: 'rivers', update(dt, t, cam) { rib.setPx(cam, album.renderer.domElement); } };
}
