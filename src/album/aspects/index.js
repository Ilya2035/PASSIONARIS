// The aspects of the album's picture (docs/ALBUM-CHUNKS.md). Every aspect is one file with one owner:
//   { id, title, glsl, uniforms, params, pages, init(album) }
// glsl      functions the ground shader calls (their names and arguments are fixed by the contract)
// uniforms  extra uniforms of that glsl, merged into the ground material (album.terrain.u)
// params    knobs, same shape as DEFS in params.js    pages  album pages, same shape as PAGES in pages.js
// init      may create things that stand on the land; returns a layer { id, update(dt, t, cam) } or nothing
// The order below is the order the ground is painted in: swamp → people → forest; then water, modes, numbers.
import swamp from './swamp.js';
import settle from './settle.js';
import forest from './forest.js';
import water from './water.js';
import division from './division.js';
import resources from './resources.js';
import roads from './roads.js';
import sky from './sky.js';
import ground from './ground.js';

// (roads, sky and ground paint nothing through the contract functions: they are here for their knobs, pages and layers)
export const ASPECTS = [swamp, settle, forest, water, division, resources, roads, sky, ground];
export const ASPECT_GLSL = ASPECTS.map(a => `// ---- aspect: ${a.id}\n${a.glsl || ''}`).join('\n');
export const ASPECT_UNIFORMS = Object.assign({}, ...ASPECTS.map(a => a.uniforms || {}));
export const ASPECT_PARAMS = ASPECTS.flatMap(a => a.params || []);
export const ASPECT_PAGES = ASPECTS.flatMap(a => a.pages || []);
