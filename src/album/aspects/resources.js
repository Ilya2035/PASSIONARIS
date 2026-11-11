// ASPECT «Ресурсы»: what lies in every chunk — fish, timber, stone, ores. This file belongs to the resources work;
// the contract with the rest of the album is in docs/ALBUM-CHUNKS.md. Nothing is drawn by a shader of its own:
//   album.chunks.layer('iron', { title: 'Железо', unit: 'т', sum: true }).data   one number per chunk (Float32Array)
//   album.chunks.show(values, { min, max, ramp })                                paints any such numbers over the map
// A district sums the layers of its chunks. Empty for now.
export default {
  id: 'resources', title: 'Ресурсы', glsl: '', uniforms: {}, params: [], pages: [],
};
