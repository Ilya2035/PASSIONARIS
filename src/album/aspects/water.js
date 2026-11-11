// ASPECT «Вода»: the sea, its shallows and surf, ice and snow on the water. This file and layers/rivers.js belong to
// the water work; the contract with the rest of the album is in docs/ALBUM-CHUNKS.md.
//   aspWater(p) → the finished, lit colour of the water at this pixel (linear light, before air and tone curve)
// The state comes from the chunks: p.cB = (ice 0 open .. 1 solid, snow, flood, spare).
const GLSL = /* glsl */`
// a floe of pack ice: x = distance to its edge (0 at the crack between two floes), y = a random number of its own
vec2 iceFloe(vec2 p) {
  vec2 i = floor(p), u = fract(p); float d1 = 9., d2 = 9., id = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), r = g + hash22(i + g) - u; float dd = dot(r, r);
    if (dd < d1) { d2 = d1; d1 = dd; id = hash21(i + g + 7.7); } else if (dd < d2) d2 = dd;
  }
  return vec2(sqrt(d2) - sqrt(d1), id);
}
vec3 aspWater(Px p) {
  float depth = max(-p.h, 0.), px = p.px; vec2 pk = p.pk;
  vec3 wc = mix(vec3(.15, .50, .52), vec3(.04, .27, .42), smoothstep(0., 45., depth));
  wc = mix(wc, vec3(.025, .12, .25), smoothstep(40., 1800., depth));
  wc = mix(vec3(.50, .62, .50), wc, smoothstep(0., 6., depth));
  wc = pow(wc, vec3(2.2)) * 1.6;
  vec2 wn = vec2(0.);
  for (int i = 0; i < 3; i++) {
    float s = i == 0 ? .22 : (i == 1 ? 1.3 : 7.), f = 1. - smoothstep(s * .18, s * .42, px);
    vec2 q = pk / s + uTime * vec2(.035, .021) * (1.5 - float(i) * .4);
    float a = vnoise(q); wn += f * vec2(vnoise(q + vec2(.3, 0.)) - a, vnoise(q + vec2(0., .3)) - a);
  }
  vec3 nW = normalize(vec3(-wn * .26, 1.)), Rv = reflect(-p.V, nW);
  float fres = .02 + .98 * pow(1. - max(dot(nW, p.V), 0.), 5.), sp = max(dot(Rv, uSun), 0.);
  vec3 skyRef = mix(vec3(.58, .72, .90), vec3(.22, .40, .70), clamp(Rv.z, 0., 1.)) * (.25 + .75 * p.day);
  vec3 sea = wc * (p.skyCol * 1.5 + p.sunCol * max(dot(nW, uSun), 0.) * .75);
  float glint = smoothstep(.22, .04, px);                          // sparkle only when waves are resolved
  sea = mix(sea, skyRef, fres * .7) + p.sunCol * (pow(sp, 420.) * .9 * glint + pow(sp, 22.) * .02 * smoothstep(1.2, .3, px)) * p.sh;
  float near = smoothstep(.35, .06, px);
  float shore = smoothstep(.0012, .006, p.slope);                  // surf only where the bottom rises to a shore, not on flats
  float foam = smoothstep(2.4, 0., depth) * (.5 + .5 * vnoise(pk / .045 + uTime * .25)) * (.35 + .65 * near) * shore;
  foam += smoothstep(12., 2., depth) * smoothstep(.6, .97, sin(depth * 1.1 - uTime * 1.3 + vnoise(pk / .6) * 6.)) * .3 * smoothstep(.1, .03, px) * shore;
  sea = mix(sea, vec3(.94, .97, 1.) * (p.skyCol + p.sunCol * .8), clamp(foam, 0., 1.) * .75);

  // ice by chunk — a first, plain version. A thin share of ice is scattered floes; as it grows the floes close up,
  // the leads of open water between them narrow to cracks, and the solid sheet keeps only a few of those.
  float ice = p.cB.r;
  if (ice > .003) {
    float fine = smoothstep(1.1, .25, px);
    float brk = fbm(pk / 2.6 + 31.) * .62 + mix(.19, vnoise(pk / .42 + 5.) * .38, smoothstep(.5, .12, px));
    vec2 fl = iceFloe(pk / 3.1 + vec2(vnoise(pk / 1.3), vnoise(pk / 1.3 + 7.)) * .35);   // angular floes a few km across, edges a little ragged
    float w = mix(.42, .02, smoothstep(.15, 1., ice));              // half-width of the open lead between floes
    float lead = mix(clamp(w * 1.4, 0., 1.), 1. - smoothstep(w, w + .05, fl.x), fine);
    float sheet = smoothstep(-.07, .07, ice * 1.3 - brk) * (1. - lead);
    float snow = smoothstep(-.1, .1, p.cB.g * 1.25 - (fbm(pk / 1.3 + 9.) * .7 + .15));
    vec3 iceCol = mix(vec3(.58, .73, .80), vec3(.84, .89, .93), vnoise(pk / .9 + 2.) * .5 + fl.y * .5 * fine);   // blue young ice, pale old ice
    iceCol *= 1. - .12 * (1. - smoothstep(w, w + .16, fl.x)) * fine;                                             // thinner, darker ice at the edge of a floe
    iceCol = mix(iceCol, vec3(.96, .97, .99) * (.94 + .06 * vnoise(pk / .3)), snow);
    sea = mix(sea, pow(iceCol, vec3(2.2)) * (p.sunCol * max(uSun.z, 0.) * p.sh * 1.15 + p.skyCol), sheet);
  }

  if (uStyle == 2) sea = mix(vec3(.72, .84, .90), vec3(.50, .68, .82), smoothstep(0., 2500., depth));
  else if (uStyle == 3) sea = mix(vec3(.70, .77, .80), vec3(.60, .69, .74), smoothstep(0., 1500., depth));
  else if (uStyle == 6) sea = mix(vec3(.035, .05, .08), vec3(.02, .03, .05), smoothstep(0., 800., depth)) + vec3(.85, .68, .38) * pow(sp, 60.) * .25;
  return sea;
}`;

export default {
  id: 'water', title: 'Вода', glsl: GLSL, uniforms: {},
  params: [
    { key: 'rivers', label: 'Ширина рек', group: 'scale', min: 0, max: 3, step: .05, value: 1, unit: '×' },
    { key: 'riversOn', label: 'Реки', group: 'layers', type: 'toggle', value: 1 },
  ],
  pages: [
    { id: 'sea-delta', group: 'Вода и свет', title: 'Берег и отмели: дельта Эбро', note: 'Глубина видна цветом, у берега пена.', p: {}, cam: { lat: 40.72, lon: .72, h: 60, tilt: 40, heading: -40 } },
  ],
  async init(album) { return (await import('../layers/rivers.js')).default(album); },
};
