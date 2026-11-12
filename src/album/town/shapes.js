// The buildings of the album, made here from a few flat faces each. The unit is not a house but a BLOCK as it is seen
// from above: wings of houses under pitched roofs around a court, rows of houses ridge to ridge, flat-roofed cubes,
// a farmstead. Heights are close to real against the plan (a storey ≈ .038 of a block), so the volume is slight.
//
// Every shape fits the footprint −.5 .. .5 by −.5 .. .5; z is up, in the same unit. All shapes go into one small
// texture (two rows of bytes per shape: corner + material, normal + openness), and every block on the map is one
// instance of the same strip of SLOTS corners that looks its corners up in that texture — one draw call for all.
import { MAT } from './rules.js';

export const MAX_TRIS = 56, SLOTS = MAX_TRIS * 3;
const SK = -.04;                                                    // walls begin under the ground: nothing floats on a slope

class Shape {
  constructor() { this.t = []; }                                   // per triangle: 9 coordinates, normal, material, variant, openness
  // a triangle wound counter-clockwise as seen from the side `hint` points to
  tri(a, b, c, hint, mat, open = 1, v = 0) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return this;
    nx /= l; ny /= l; nz /= l;
    if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { [b, c] = [c, b]; nx = -nx; ny = -ny; nz = -nz; }
    this.t.push({ p: [a, b, c], n: [nx, ny, nz], mat, open, v });
    return this;
  }
  quad(a, b, c, d, hint, mat, open, v) { return this.tri(a, b, c, hint, mat, open, v).tri(a, c, d, hint, mat, open, v); }
  // a flat-topped box; faces: which walls to make (n s e w), '' for none
  box(x0, y0, x1, y1, z1, { z0 = SK, top = MAT.flat, side = MAT.wall, faces = 'nsew', v = 0, open = .75, lid = true } = {}) {
    if (lid) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], top, 1, v);
    if (faces.includes('n')) this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], side, open, v);
    if (faces.includes('s')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], side, open, v);
    if (faces.includes('e')) this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], side, open, v);
    if (faces.includes('w')) this.quad([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [-1, 0, 0], side, open, v);
    return this;
  }
  // a row of houses under one pitched roof: the ridge runs along the longer side. ends / sides: which of the two
  // gable ends and the two long walls to make ('a' the lower coordinate, 'b' the higher)
  bar(x0, y0, x1, y1, eave, { rise, ends = 'ab', sides = 'ab', roof = MAT.roof, wall = MAT.wall, v = 0, z0 = SK } = {}) {
    const alongX = x1 - x0 >= y1 - y0;
    const P = (u, w, z) => (alongX ? [u, w, z] : [w, u, z]), H = (u, w, z) => (alongX ? [u, w, z] : [w, u, z]);
    const [u0, u1, w0, w1] = alongX ? [x0, x1, y0, y1] : [y0, y1, x0, x1], wm = (w0 + w1) / 2, half = (w1 - w0) / 2;
    const zr = eave + (rise ?? half * .4);                          // a low pitch, as tiled roofs have
    this.quad(P(u0, wm, zr), P(u1, wm, zr), P(u1, w1, eave), P(u0, w1, eave), H(0, zr - eave, half), roof, 1, v);
    this.quad(P(u0, wm, zr), P(u1, wm, zr), P(u1, w0, eave), P(u0, w0, eave), H(0, eave - zr, half), roof, 1, v);
    if (sides.includes('b')) this.quad(P(u0, w1, z0), P(u1, w1, z0), P(u1, w1, eave), P(u0, w1, eave), H(0, 1, 0), wall, .75, v);
    if (sides.includes('a')) this.quad(P(u0, w0, z0), P(u1, w0, z0), P(u1, w0, eave), P(u0, w0, eave), H(0, -1, 0), wall, .75, v);
    for (const [e, u, s] of [['a', u0, -1], ['b', u1, 1]]) if (ends.includes(e)) {
      this.quad(P(u, w0, z0), P(u, w1, z0), P(u, w1, eave), P(u, w0, eave), H(s, 0, 0), wall, .75, v);
      this.tri(P(u, w0, eave), P(u, w1, eave), P(u, wm, zr), H(s, 0, 0), wall, .75, v);
    }
    return this;
  }
  // a lean-to against a taller wall: the roof falls away from the side `high` (n s e w)
  leanto(x0, y0, x1, y1, zLow, zHigh, high, { roof = MAT.roof, wall = MAT.wall, v = 0, z0 = SK } = {}) {
    const ns = high === 'n' || high === 's', hi = high === 'n' || high === 'e';
    const P = (u, w, z) => (ns ? [u, w, z] : [w, u, z]);
    const [u0, u1, w0, w1] = ns ? [x0, x1, y0, y1] : [y0, y1, x0, x1], wl = hi ? w0 : w1, wh = hi ? w1 : w0, s = hi ? -1 : 1;
    this.quad(P(u0, wl, zLow), P(u1, wl, zLow), P(u1, wh, zHigh), P(u0, wh, zHigh), P(0, s * (zHigh - zLow), Math.abs(wh - wl)), roof, 1, v);
    this.quad(P(u0, wl, z0), P(u1, wl, z0), P(u1, wl, zLow), P(u0, wl, zLow), P(0, s, 0), wall, .75, v);
    this.quad(P(u0, wl, z0), P(u0, wh, z0), P(u0, wh, zHigh), P(u0, wl, zLow), P(-1, 0, 0), wall, .75, v);
    this.quad(P(u1, wl, z0), P(u1, wh, z0), P(u1, wh, zHigh), P(u1, wl, zLow), P(1, 0, 0), wall, .75, v);
    return this;
  }
  pyramid(x0, y0, x1, y1, z0, z1, mat, v = 0) {
    const c = [(x0 + x1) / 2, (y0 + y1) / 2, z1], q = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; this.tri([a[0], a[1], z0], [b[0], b[1], z0], c, [(a[0] + b[0]) / 2 - c[0], (a[1] + b[1]) / 2 - c[1], .3], mat, 1, v); }
    return this;
  }
  // an n-sided tower, r0 at the foot, r1 at the top; cone() closes it
  prism(cx, cy, r0, r1, z0, z1, n, mat, v = 0, a0 = 0) {
    for (let i = 0; i < n; i++) {
      const a = a0 + i / n * 6.2831853, b = a0 + (i + 1) / n * 6.2831853, m = (a + b) / 2;
      this.quad([cx + r0 * Math.cos(a), cy + r0 * Math.sin(a), z0], [cx + r0 * Math.cos(b), cy + r0 * Math.sin(b), z0],
        [cx + r1 * Math.cos(b), cy + r1 * Math.sin(b), z1], [cx + r1 * Math.cos(a), cy + r1 * Math.sin(a), z1], [Math.cos(m), Math.sin(m), 0], mat, .8, v);
    }
    return this;
  }
  cone(cx, cy, r, z0, z1, n, mat, v = 0, a0 = 0) {
    for (let i = 0; i < n; i++) {
      const a = a0 + i / n * 6.2831853, b = a0 + (i + 1) / n * 6.2831853, m = (a + b) / 2;
      this.tri([cx + r * Math.cos(a), cy + r * Math.sin(a), z0], [cx + r * Math.cos(b), cy + r * Math.sin(b), z0], [cx, cy, z1], [Math.cos(m), Math.sin(m), .4], mat, 1, v);
    }
    return this;
  }
}

// ---- the kinds. Order = row in the texture = `kind` of an instance.
const S = () => new Shape();
// the plot of a yard: one flat face just over the ground, the whole footprint
const plot = s => s.quad([-.5, -.5, .0025], [.5, -.5, .0025], [.5, .5, .0025], [-.5, .5, .0025], [0, 0, 1], MAT.plot, 1, 2);
const DEFS = [
  // квартал: four wings of houses of different heights around an inner court
  ['quarter', 'Квартал с двором', () => S()
    .bar(-.5, .23, .25, .5, .075, { ends: 'a', v: 0 })
    .bar(.25, -.21, .5, .5, .11, { v: 1 })
    .bar(-.26, -.5, .5, -.21, .075, { v: 2 })
    .bar(-.5, -.5, -.26, .23, .06, { ends: 'a', v: 3 })],
  // ряды: three rows of houses, two of them ridge to ridge, a lane and a small yard
  ['rows', 'Ряды домов с проходом', () => S()
    .bar(-.5, .16, .5, .5, .075, { v: 0 })
    .bar(-.5, -.16, .32, .16, .075, { sides: 'a', v: 1 })
    .bar(-.36, -.5, .5, -.28, .11, { v: 2 })],
  // плоские крыши: whitewashed cubes of different heights around a patio
  ['terrace', 'Дома с плоскими крышами', () => S()
    .box(-.5, -.04, -.06, .5, .08, { v: 0 })
    .box(-.06, .12, .5, .5, .115, { v: 1 })
    .box(.14, -.5, .5, .12, .075, { v: 2 })
    .box(-.5, -.5, .14, -.2, .095, { v: 3 })
    .box(.1, .22, .3, .4, .15, { z0: .115, v: 1 })],
  // дворы: three separate houses around a yard
  ['cluster', 'Группа домов', () => S()
    .bar(-.48, .12, -.04, .44, .045, { v: 0 })
    .bar(.12, -.12, .44, .48, .075, { v: 1 })
    .bar(-.34, -.46, .2, -.18, .045, { v: 2 })],
  // двор-хутор: a house and a barn at a right angle, a low wall around the yard, a haystack
  ['farm', 'Двор-хутор', () => S()
    .bar(-.5, .2, .18, .5, .075, { v: 0 })
    .bar(.24, -.42, .5, .5, .05, { v: 2 })
    .box(-.5, -.44, -.46, .2, .022, { top: MAT.fence, side: MAT.fence, faces: 'ew', open: .9 })
    .box(-.46, -.44, .24, -.4, .022, { top: MAT.fence, side: MAT.fence, faces: 'ns', open: .9 })
    .cone(-.16, -.12, .1, 0, .075, 5, MAT.hay)],
  // дом: one house with a lower annex (its garden is painted on the ground)
  ['house', 'Дом с огородом', () => S()
    .bar(-.5, -.5, .24, .5, .07, { rise: .045, v: 0 })
    .box(.24, -.34, .5, .5, .04, { top: MAT.roof, faces: 'nse', v: 1 })],
  // храм: a nave with two lower aisles, an apse and a bell tower
  ['temple', 'Храм', () => { const s = S()
    .bar(-.3, -.13, .34, .13, .16, { rise: .06, wall: MAT.stone, v: 0 })
    .leanto(-.3, .13, .34, .27, .085, .125, 's', { wall: MAT.stone, v: 2 })
    .leanto(-.3, -.27, .34, -.13, .085, .125, 'n', { wall: MAT.stone, v: 2 })
    .box(-.5, -.1, -.3, .1, .3, { side: MAT.stone, lid: false })
    .pyramid(-.5, -.1, -.3, .1, .3, .37, MAT.roof, 1);
    const ap = [[.34, -.12], [.444, -.06], [.444, .06], [.34, .12]];     // the apse: half of a hexagon
    for (let i = 0; i < 3; i++) { const a = ap[i], b = ap[i + 1], out = [(a[0] + b[0]) / 2 - .34, (a[1] + b[1]) / 2, 0];
      s.quad([a[0], a[1], SK], [b[0], b[1], SK], [b[0], b[1], .13], [a[0], a[1], .13], out, MAT.stone, .75, 0);
      s.tri([a[0], a[1], .13], [b[0], b[1], .13], [.34, 0, .175], [out[0], out[1], .1], MAT.roof, 1, 3); }
    return s; }],
  // площадь с рынком: arcades on two sides of an open square (painted on the ground), stalls under cloth
  ['market', 'Площадь с рынком', () => { const s = S()
    .bar(-.5, .3, .5, .5, .075, { v: 0 })
    .bar(-.5, -.32, -.32, .3, .06, { ends: 'a', v: 3 });
    [[-.14, .04], [.14, .04], [-.14, -.2], [.14, -.2]].forEach(([x, y], i) => s.box(x, y, x + .17, y + .1, .03, { top: MAT.cloth, side: MAT.timber, faces: 'se', v: i * 5 + 1, open: .9 }));
    return s; }],
  // укрепление: a square of walls with two corner towers and a keep
  ['fort', 'Укрепление', () => S()
    .box(-.5, .43, .5, .5, .1, { top: MAT.stone, side: MAT.stone, faces: 'ns' })
    .box(-.5, -.5, .5, -.43, .1, { top: MAT.stone, side: MAT.stone, faces: 'ns' })
    .box(.43, -.43, .5, .43, .1, { top: MAT.stone, side: MAT.stone, faces: 'ew' })
    .box(-.5, -.43, -.43, .43, .1, { top: MAT.stone, side: MAT.stone, faces: 'ew' })
    .box(.3, .3, .5, .5, .17, { top: MAT.stone, side: MAT.stone, v: 4 })
    .box(-.5, -.5, -.3, -.3, .17, { top: MAT.stone, side: MAT.stone, v: 4 })
    .box(-.12, -.1, .16, .14, .22, { top: MAT.flat, side: MAT.stone, v: 2 })],
  // мельница: a round tower under a cap, with crossed sails
  ['mill', 'Мельница', () => { const s = S()
    .prism(0, 0, .32, .24, SK, .2, 6, MAT.wall)
    .cone(0, 0, .27, .2, .3, 6, MAT.timber);
    for (const [ax, az, bx, bz] of [[-.3, .08, .3, .34], [-.3, .34, .3, .08]]) {
      const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz), px = -dz / l * .022, pz = dx / l * .022, y = -.34;
      const q = [[ax + px, y, az + pz], [bx + px, y, bz + pz], [bx - px, y, bz - pz], [ax - px, y, az - pz]];
      s.quad(...q, [0, -1, 0], MAT.timber, 1, 3).quad(...q, [0, 1, 0], MAT.timber, 1, 3);     // seen from both sides
    }
    return s; }],
  // причал: a shed on the shore, a jetty over the water (+x) and two boats
  ['pier', 'Причал', () => { const s = S()
    .bar(-.5, -.3, -.2, .3, .05, { v: 2 })
    .box(-.2, -.07, .5, .07, .014, { top: MAT.timber, side: MAT.timber, faces: 'nse', open: .9 });
    for (const [cx, cy] of [[.2, .2], [.02, -.19]]) {
      const a = [cx - .13, cy], b = [cx, cy - .045], c = [cx + .13, cy], d = [cx, cy + .045], z = .016, q = [a, b, c, d];
      s.quad([...a, z], [...b, z], [...c, z], [...d, z], [0, 0, 1], MAT.timber, 1, 0);
      for (let i = 0; i < 4; i++) { const p = q[i], r = q[(i + 1) % 4]; s.quad([...p, SK], [...r, SK], [...r, z], [...p, z], [(p[0] + r[0]) / 2 - cx, (p[1] + r[1]) / 2 - cy, 0], MAT.hull, .8, 0); }
    }
    return s; }],
  // стройка: foundations, one finished piece of wall, a scaffold pole, timber and sand
  ['site', 'Стройка', () => S()
    .box(-.4, .34, .4, .4, .024, { top: MAT.fence, side: MAT.fence, faces: 'ns', open: .9 })
    .box(-.4, -.4, .4, -.34, .024, { top: MAT.fence, side: MAT.fence, faces: 'ns', open: .9 })
    .box(.34, -.34, .4, .34, .024, { top: MAT.fence, side: MAT.fence, faces: 'ew', open: .9 })
    .box(-.4, -.34, -.34, .34, .024, { top: MAT.fence, side: MAT.fence, faces: 'ew', open: .9 })
    .box(-.4, .1, -.33, .4, .08, { top: MAT.wall, v: 1 })
    .box(.02, -.22, .26, -.06, .03, { top: MAT.timber, side: MAT.timber, faces: 'se', v: 2 })
    .box(.14, .12, .17, .15, .14, { side: MAT.timber, lid: false, v: 2 })
    .pyramid(-.2, -.2, -.02, -.02, 0, .04, MAT.hay)],
  // ---- more shapes of the same things, so that no two streets look alike
  // квартал покоем: three wings around a court that opens to the street behind a low wall
  ['quarterU', 'Квартал покоем', () => S()
    .bar(-.5, .24, .5, .5, .075, { v: 0 })
    .bar(.26, -.5, .5, .24, .09, { ends: 'a', v: 1 })
    .bar(-.5, -.5, -.26, .24, .06, { ends: 'a', v: 3 })
    .box(-.26, -.5, .26, -.46, .03, { top: MAT.fence, side: MAT.fence, faces: 'ns', open: .9 })],
  // квартал углом: two wings at a right angle and two small houses in the yard
  ['quarterL', 'Квартал углом', () => S()
    .bar(-.5, .2, .5, .5, .075, { v: 0 })
    .bar(.2, -.5, .5, .2, .11, { ends: 'a', v: 1 })
    .bar(-.46, -.2, -.1, .06, .045, { v: 2 })
    .bar(-.4, -.48, .06, -.3, .045, { v: 3 })],
  // большой дом: a hall, two wings toward the street and a tower over the roofs
  ['palace', 'Большой дом с башней', () => S()
    .bar(-.5, .1, .5, .42, .11, { v: 0 })
    .bar(-.5, -.44, -.2, .1, .09, { ends: 'a', v: 1 })
    .bar(.2, -.44, .5, .1, .09, { ends: 'a', v: 2 })
    .box(-.1, .18, .1, .34, .2, { side: MAT.stone, lid: false })
    .pyramid(-.1, .18, .1, .34, .2, .25, MAT.roof, 3)],
  // переулки: four short rows of houses side by side with lanes between
  ['lanes', 'Ряды с переулками', () => S()
    .bar(-.5, -.5, -.3, .5, .075, { v: 0 })
    .bar(-.22, -.3, -.02, .5, .045, { v: 1 })
    .bar(.06, -.5, .26, .36, .075, { v: 2 })
    .bar(.32, -.5, .5, .5, .06, { v: 3 })],
  // усадьба: a large house with a wing, a walled garden and a round dovecote
  ['villa', 'Усадьба', () => S()
    .bar(-.5, .1, .3, .5, .09, { v: 0 })
    .bar(.3, -.2, .5, .5, .06, { v: 1 })
    .box(-.5, -.5, -.46, .1, .025, { top: MAT.fence, side: MAT.fence, faces: 'ew', open: .9 })
    .box(-.46, -.5, .5, -.46, .025, { top: MAT.fence, side: MAT.fence, faces: 'ns', open: .9 })
    .prism(-.2, -.2, .09, .08, SK, .1, 5, MAT.wall)
    .cone(-.2, -.2, .1, .1, .15, 5, MAT.roof, 2)],
  // дом-башня: a tall house under a pointed roof with a low annex
  ['tower', 'Дом-башня', () => S()
    .box(-.5, -.3, .1, .5, .15, { lid: false })
    .pyramid(-.5, -.3, .1, .5, .15, .2, MAT.roof, 1)
    .box(.1, -.3, .5, .3, .05, { top: MAT.roof, faces: 'nse', v: 2 })],
  // ---- yards that stand alone among the fields (town/yards.js): light ones, there are thousands of them. No
  // ground is painted under them, so each brings its own plot: the beds of a kitchen garden and trodden earth
  // двор: a house, a shed under a single slope at a right angle to it, a haystack, a piece of the yard wall
  ['yard', 'Двор среди полей', () => plot(S())
    .bar(-.42, .08, .14, .4, .07, { v: 0 })
    .leanto(.2, -.3, .4, .4, .03, .06, 'e', { v: 2 })
    .cone(-.18, -.2, .09, 0, .075, 5, MAT.hay)
    .box(-.5, -.5, .5, -.47, .02, { top: MAT.fence, side: MAT.fence, faces: 's', open: .9 })],
  // длинный дом: people and cattle under one long roof, a lean-to along it, a haystack
  ['longyard', 'Длинный дом', () => plot(S())
    .bar(-.44, -.02, .44, .32, .065, { v: 1 })
    .leanto(-.28, -.24, .2, -.02, .028, .05, 'n', { v: 3 })
    .cone(.33, -.28, .08, 0, .07, 5, MAT.hay)],
  // дом среди полей: one house with a low annex in the corner of its garden
  ['cot', 'Дом среди полей', () => plot(S())
    .bar(-.36, 0, .2, .34, .07, { rise: .045, v: 0 })
    .box(.2, .06, .4, .34, .04, { top: MAT.roof, faces: 'nse', v: 1 })],
];

export const KINDS = DEFS.map(d => d[0]);
export const KIND = Object.fromEntries(KINDS.map((k, i) => [k, i]));
export const KIND_TITLES = DEFS.map(d => d[1]);

const qx = v => Math.max(0, Math.min(255, Math.round(v * 200) + 128)), qz = v => Math.max(0, Math.min(255, Math.round(v * 400) + 16));
// the bytes of the shape texture: SLOTS × (2 × kinds), RGBA. Row 2k: x, y, z, material + 16 × variant of every corner
// of kind k; row 2k + 1: its normal and how open to the sky the face is.
export function buildShapes() {
  const shapes = DEFS.map(d => d[2]()), w = SLOTS, h = shapes.length * 2, data = new Uint8Array(w * h * 4), tris = [];
  shapes.forEach((s, k) => {
    if (s.t.length > MAX_TRIS) throw new Error(`shape ${KINDS[k]}: ${s.t.length} triangles, at most ${MAX_TRIS}`);
    tris.push(s.t.length);
    for (let i = 0; i < w; i++) {
      const t = s.t[(i / 3) | 0], a = (k * 2 * w + i) * 4, b = ((k * 2 + 1) * w + i) * 4;
      if (!t) { data[a] = data[a + 1] = 128; data[a + 2] = 16; data[b] = data[b + 1] = 128; data[b + 2] = 255; continue; }   // an empty corner: no area
      const p = t.p[i % 3];
      data[a] = qx(p[0]); data[a + 1] = qx(p[1]); data[a + 2] = qz(p[2]); data[a + 3] = t.mat + 16 * (t.v & 15);
      data[b] = Math.round(t.n[0] * 127) + 128; data[b + 1] = Math.round(t.n[1] * 127) + 128; data[b + 2] = Math.round(t.n[2] * 127) + 128; data[b + 3] = Math.round(Math.min(1.5, t.open) / 1.5 * 255);
    }
  });
  return { data, width: w, height: h, tris, shapes };
}
