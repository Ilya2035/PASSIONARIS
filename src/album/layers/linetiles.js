// The lines of the album — roads, rivers, borders — are ribbons built once for the whole region: at stage 3 two
// million corners of rivers alone. Whatever the camera looks at, all of them went to the GPU every frame (the lead,
// 16.11.2026: the Pyrenees from 20 km cost 27 ms more on the large polygon than on the small one, and all of it was
// ribbons far outside the picture). Here the pieces of such a mesh are sorted into squares, and a frame draws only
// the squares the camera can see.
//
// Nothing is copied and nothing is rebuilt as the camera moves:
//   • the corners of a mesh stay as they were; only its INDEX is put in another order — square by square, the
//     squares along a Z curve, so that the squares of any larger square (two, four, eight leaves a side) stand
//     together in it. A square of any size is then one range of the index;
//   • a frame walks the tree of squares: a square outside the picture is dropped whole, a square wholly inside it is
//     taken whole, the others are opened. What is left is a handful of ranges; neighbours are joined;
//   • a mesh can draw one range (geometry.drawRange). The mesh itself draws the first; the others are drawn by a few
//     child meshes whose geometries are made of the very same buffers. From high up, where everything is in the
//     picture, there is one range and one draw call, as before.
// The picture is the same: what is left out could not be seen. The order of the pieces inside a square is kept, so
// lines that cross are still blended in the order they were.
import { Frustum, Matrix4, Sphere, Mesh, BufferGeometry } from 'three';
import { toWorld, KM_PER_DEG, COS_REF } from '../geo.js';

export const LEAF_KM = 64;             // the side of the smallest square
export const MAX_RANGES = 12;          // a frame draws no more ranges of one mesh than this: the nearest are joined
export const MIN_PIECES = 3000;        // a mesh with fewer pieces is left as it is

// the bits of two numbers under 2^15, interleaved (x in the even places)
const spread = v => { v &= 0x7fff; v = (v | (v << 8)) & 0x00ff00ff; v = (v | (v << 4)) & 0x0f0f0f0f; v = (v | (v << 2)) & 0x33333333; return (v | (v << 1)) & 0x55555555; };
export const zcode = (x, y) => spread(x) + spread(y) * 2;

// The ball that holds a box of the globe (degrees) at sea level: its middle and how far its corners are, km.
function ballOf(box) {
  const [la0, lo0, la1, lo1] = box, c = toWorld((la0 + la1) / 2, (lo0 + lo1) / 2, 0); let r = 0;
  for (const la of [la0, (la0 + la1) / 2, la1]) for (const lo of [lo0, (lo0 + lo1) / 2, lo1]) r = Math.max(r, c.distanceTo(toWorld(la, lo, 0)));
  return new Sphere(c, r);
}

// n pieces of lines; lat[i], lon[i] (degrees): where piece i lies. →
//   order   Uint32Array: the pieces square by square — the order to write the index in;
//   root    the tree of squares: { start, count (pieces of `order`), box: [lat0, lon0, lat1, lon1], ball (Sphere, sea
//           level, no margin), kids: [node …] or null for a leaf }; null when there are no pieces;
//   leaves  how many smallest squares hold a piece.
export function tilePieces(n, lat, lon, leaf = LEAF_KM) {
  if (!n) return { order: new Uint32Array(0), root: null, leaves: 0 };
  const KX = KM_PER_DEG * COS_REF, KY = KM_PER_DEG; let x0 = 1e18, y0 = 1e18;
  for (let i = 0; i < n; i++) { const x = lon[i] * KX, y = lat[i] * KY; if (x < x0) x0 = x; if (y < y0) y0 = y; }
  const code = new Uint32Array(n), count = new Map(); let top = 0;
  for (let i = 0; i < n; i++) { const tx = Math.floor((lon[i] * KX - x0) / leaf), ty = Math.floor((lat[i] * KY - y0) / leaf), c = code[i] = zcode(tx, ty); count.set(c, (count.get(c) || 0) + 1); if (tx > top) top = tx; if (ty > top) top = ty; }
  // the squares along the Z curve; where each begins in the order
  const codes = [...count.keys()].sort((a, b) => a - b), slot = new Map(), start = new Uint32Array(codes.length + 1);
  codes.forEach((c, k) => { slot.set(c, k); start[k + 1] = start[k] + count.get(c); });
  const order = new Uint32Array(n), fill = start.slice(0, codes.length), box = new Float64Array(codes.length * 4);
  for (let k = 0; k < codes.length; k++) { box[k * 4] = box[k * 4 + 1] = 1e9; box[k * 4 + 2] = box[k * 4 + 3] = -1e9; }
  for (let i = 0; i < n; i++) { const k = slot.get(code[i]); order[fill[k]++] = i;                              // (in a square the pieces keep the order they came in)
    if (lat[i] < box[k * 4]) box[k * 4] = lat[i]; if (lon[i] < box[k * 4 + 1]) box[k * 4 + 1] = lon[i]; if (lat[i] > box[k * 4 + 2]) box[k * 4 + 2] = lat[i]; if (lon[i] > box[k * 4 + 3]) box[k * 4 + 3] = lon[i]; }
  // the tree: squares a[lo, hi) of the list share the bits of their code above `bits`
  let levels = 0; while ((1 << levels) <= top) levels++;
  const node = (lo, hi, bits) => {
    if (hi - lo === 1) { const b = Array.from(box.subarray(lo * 4, lo * 4 + 4)); return { start: start[lo], count: start[hi] - start[lo], box: b, ball: ballOf(b), kids: null }; }
    const kids = []; let a = lo;
    while (a < hi) { const q = Math.floor(codes[a] / 2 ** (bits - 2)); let b = a + 1; while (b < hi && Math.floor(codes[b] / 2 ** (bits - 2)) === q) b++; kids.push(node(a, b, bits - 2)); a = b; }
    if (kids.length === 1) return kids[0];                                                                      // a square with one square in it is that square
    const b = [1e9, 1e9, -1e9, -1e9]; for (const k of kids) { b[0] = Math.min(b[0], k.box[0]); b[1] = Math.min(b[1], k.box[1]); b[2] = Math.max(b[2], k.box[2]); b[3] = Math.max(b[3], k.box[3]); }
    return { start: start[lo], count: start[hi] - start[lo], box: b, ball: ballOf(b), kids };
  };
  return { order, root: node(0, codes.length, levels * 2), leaves: codes.length };
}

// The same with the pieces in classes first (tier[i]: 0 … tiers − 1; a river by its width): class by class, and in a
// class square by square. A frame can then leave whole classes out — the narrow rivers from high up — and of the
// others draws the squares in the picture. → { order, tiers: [{ start, count, root } or null for an empty class] }
export function tileTiers(n, lat, lon, tier, tiers, leaf = LEAF_KM) {
  const at = Array.from({ length: tiers }, () => []);
  for (let i = 0; i < n; i++) at[tier[i]].push(i);
  const order = new Uint32Array(n), out = []; let start = 0;
  for (const list of at) {
    if (!list.length) { out.push(null); continue; }
    const la = new Float64Array(list.length), lo = new Float64Array(list.length); list.forEach((i, k) => { la[k] = lat[i]; lo[k] = lon[i]; });
    const t = tilePieces(list.length, la, lo, leaf);
    for (let k = 0; k < list.length; k++) order[start + k] = list[t.order[k]];
    const shift = nd => { nd.start += start; if (nd.kids) nd.kids.forEach(shift); }; shift(t.root);
    out.push({ start, count: list.length, root: t.root, leaves: t.leaves }); start += list.length;
  }
  return { order, tiers: out };
}

const M = new Matrix4(), F = new Frustum();
// the picture of a camera as six planes (one shared object: use it at once)
export function frustumOf(camera) { M.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); return F.setFromProjectionMatrix(M, camera.coordinateSystem, camera.reversedDepth); }

// The ranges of pieces of a tree a frame has to draw, added to `out`: [[start, count] …], in order; a range that
// begins where the last one ends is joined to it. pad: km a corner may stand away from its place on the sea-level
// globe (the height of the land, the width of the ribbon, the slide of a river toward its smoother line) — a square
// is dropped only when it is that far outside the picture.
export function collectRanges(root, frustum, pad = 0, out = []) {
  if (!root) return out;
  const P = frustum.planes;
  const walk = nd => {
    const c = nd.ball.center, r = nd.ball.radius; let inside = true;
    for (let i = 0; i < 6; i++) { const d = P[i].distanceToPoint(c); if (d < -(r + pad)) return; if (d < r) inside = false; }
    if (!inside && nd.kids) { for (const k of nd.kids) walk(k); return; }
    const last = out[out.length - 1]; if (last && last[0] + last[1] === nd.start) last[1] += nd.count; else out.push([nd.start, nd.count]);
  };
  walk(root);
  return out;
}
// no more than `max` ranges: while there are more, the two with the least between them become one (what lies between
// is drawn too: a little work for nothing, never a hole)
export function capRanges(out, max = MAX_RANGES) {
  while (out.length > max) {
    let at = 1, gap = Infinity; for (let i = 1; i < out.length; i++) { const g = out[i][0] - out[i - 1][0] - out[i - 1][1]; if (g < gap) { gap = g; at = i; } }
    out[at - 1][1] = out[at][0] + out[at][1] - out[at - 1][0]; out.splice(at, 1);
  }
  return out;
}
export const visibleRanges = (root, frustum, pad = 0, max = MAX_RANGES) => capRanges(collectRanges(root, frustum, pad), max);

// Lets a mesh draw several ranges of its index. per: indices a piece. → draw(ranges): the mesh draws the first range,
// its children made here the others; draw(null): everything, as a mesh does by itself. The children take the
// material and the render order of the mesh as they are at that moment, and are hidden with it.
export function rangeDrawer(mesh, per = 6) {
  const geo = mesh.geometry, kids = [], whole = geo.dispose.bind(geo);
  geo.dispose = () => { for (const k of kids) k.geometry.dispose(); whole(); };
  return ranges => {
    if (!ranges) geo.setDrawRange(0, Infinity); else if (!ranges.length) geo.setDrawRange(0, 0); else geo.setDrawRange(ranges[0][0] * per, ranges[0][1] * per);
    const n = ranges ? ranges.length : 0;
    for (let i = 1; i < n; i++) {
      let k = kids[i - 1];
      if (!k) { const g = new BufferGeometry(); for (const name in geo.attributes) g.setAttribute(name, geo.attributes[name]); g.setIndex(geo.index); k = kids[i - 1] = new Mesh(g, mesh.material); k.frustumCulled = false; mesh.add(k); }
      k.geometry.setDrawRange(ranges[i][0] * per, ranges[i][1] * per); k.material = mesh.material; k.renderOrder = mesh.renderOrder; k.visible = true;
    }
    for (let i = Math.max(0, n - 1); i < kids.length; i++) kids[i].visible = false;
    return n;
  };
}
