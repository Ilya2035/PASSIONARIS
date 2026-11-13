// The edges of smoothstep() of the ground shader, kept in a table instead of in its code.
//
// Why. The ground shader is one very long program, and it has some 270 calls of smoothstep() with both edges written
// as numbers. On the weak video card the checks run on (integrated AMD, through Direct3D) such calls are what makes
// the whole shader slow: past a certain count of them every frame takes about 40 % longer — whether the code that
// holds them ever runs or not. Measured 13.11.2026, one window, 3600 × 2025, the view of «land-200»:
//   64 more colours written as numbers        fast          64 more noises            fast (2 ms a noise)
//   32 more smoothstep() with their own edges   +135 ms       the same 64 from a table   fast
// Before this was known, three parts hit that step one after another (docs/album/ground.md, «Скорость»).
// With the edges read from a uniform the step is gone, and the shader that was fast is faster still (292 → 277 ms).
//
// How. stepTable() rewrites the finished text of a shader: every `smoothstep(number, number,` becomes
// `stepAt(uStep[i].xy-or-zw, ` — the edge and 1 / (the other edge − the edge) of that pair, read from the table — and
// the table comes back with it. The picture is the same: stepAt() is what smoothstep() does. Nobody has to write
// anything differently: `smoothstep(.2, .5, x)` stays the way to write it, in every part.
const NUM = '-?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
const CALL = new RegExp(`\\bsmoothstep\\(\\s*(${NUM})\\s*,\\s*(${NUM})\\s*,`, 'g');

// the functions the rewritten text calls, for a float and for vectors
export const STEP_GLSL = /* glsl */`
float stepAt(vec2 ek, float x) { float t = clamp((x - ek.x) * ek.y, 0., 1.); return t * t * (3. - 2. * t); }
vec2 stepAt(vec2 ek, vec2 x) { vec2 t = clamp((x - ek.x) * ek.y, 0., 1.); return t * t * (3. - 2. * t); }
vec3 stepAt(vec2 ek, vec3 x) { vec3 t = clamp((x - ek.x) * ek.y, 0., 1.); return t * t * (3. - 2. * t); }
vec4 stepAt(vec2 ek, vec4 x) { vec4 t = clamp((x - ek.x) * ek.y, 0., 1.); return t * t * (3. - 2. * t); }
`;

// glsl: the whole text of a shader → { glsl: the text to compile, table: Float32Array for the uniform uStep (vec4[]),
// calls: how many calls were rewritten, pairs: how many different pairs of edges they had }
export function stepTable(glsl) {
  const pairs = [], at = new Map();
  let calls = 0;
  const body = glsl.replace(CALL, (m, e0, e1) => {
    calls++;
    const a = +e0, b = +e1, key = `${a},${b}`;
    let i = at.get(key);
    if (i === undefined) { i = pairs.length; pairs.push([a, b === a ? 1e9 : 1 / (b - a)]); at.set(key, i); }   // (edges that meet: a plain step)
    return `stepAt(uStep[${i >> 1}].${i & 1 ? 'zw' : 'xy'},`;
  });
  const n = Math.max(1, Math.ceil(pairs.length / 2)), table = new Float32Array(n * 4);
  pairs.forEach((p, i) => { table[i * 2] = p[0]; table[i * 2 + 1] = p[1]; });
  return { glsl: `uniform vec4 uStep[${n}];\n${STEP_GLSL}\n${body}`, table, calls, pairs: pairs.length };
}
