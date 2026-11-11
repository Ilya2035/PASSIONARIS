// ASPECT «Болота»: bog and marsh on the land of a chunk. This file belongs to the swamp work; the contract with the
// rest of the album is in docs/ALBUM-CHUNKS.md.
//   aspSwamp(p, L) → changes the ground colour L.col, may thin the forest (L.cover) and add shine of open water (L.gloss)
// The state comes from the chunks: p.cA.a = share of the chunk under swamp. This is a first, plain version.
const GLSL = /* glsl */`
void aspSwamp(Px p, inout Land L) {
  float s = p.cA.a;
  if (s < .003) return;
  float m = smoothstep(-.1, .1, s * 1.25 - (p.n2 * .6 + p.n3 * .4)) * (1. - smoothstep(.03, .12, p.slope));   // only flat ground holds water
  L.col = mix(L.col, mix(vec3(.30, .34, .18), vec3(.36, .30, .17), p.n3), m * .85);                          // sedge and peat
  float pool = m * smoothstep(.60, .68, vnoise(p.pk / .35 + 4.)) * smoothstep(.5, .12, p.px);                 // small pools of dark water
  L.col = mix(L.col, vec3(.12, .17, .17), pool);
  L.gloss = max(L.gloss, pool * .85);
  L.cover *= 1. - .65 * m;
}`;

export default {
  id: 'swamp', title: 'Болота', glsl: GLSL, uniforms: {}, params: [], pages: [],
};
