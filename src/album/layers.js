// Things that stand on the land. Each layer: { id, update(dt, t, cam) } and reacts to params itself. The aspects
// (aspects/index.js) bring their own layers: the forest its trees, the settlements their houses, the water its rivers.
import { ASPECTS } from './aspects/index.js';

export async function initLayers(album) {
  const add = l => { for (const x of [].concat(l || [])) if (x?.id) album.layers[x.id] = x; };
  const load = async (name, mod) => {
    try { add(await (await mod()).default(album)); } catch (e) { console.warn(`[album] layer ${name} failed:`, e.message); }
  };
  await load('chunktool', () => import('./chunktool.js'));
  for (const a of ASPECTS) if (a.init) { try { add(await a.init(album)); } catch (e) { console.warn(`[album] aspect ${a.id} failed:`, e.message); } }
  await load('roads', () => import('./layers/roads.js'));
  await load('hazards', () => import('./layers/hazards.js'));
  await load('labels', () => import('./layers/labels.js'));
  await load('clouds', () => import('./layers/clouds.js'));
}
