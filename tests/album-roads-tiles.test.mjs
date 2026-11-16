// The ribbons of the album drawn by squares (src/album/layers/linetiles.js): the pieces of a mesh sorted into squares
// along a Z curve, the tree of squares, the ranges of the index a camera has to draw, the meshes that draw them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, BufferGeometry, BufferAttribute, Mesh, MeshBasicMaterial } from 'three';
import { tilePieces, tileTiers, visibleRanges, collectRanges, capRanges, frustumOf, rangeDrawer, zcode, LEAF_KM, MAX_RANGES, NEAR } from '../src/album/layers/linetiles.js';
import { TIERS, RANGES, riverFar } from '../src/album/layers/rivers.js';
import { toWorld, KM_PER_DEG, COS_REF, BBOXES } from '../src/album/geo.js';

// pieces scattered over the rectangle of stage 3, the same every run
const B = BBOXES[3], N = 24000, lat = new Float64Array(N), lon = new Float64Array(N);
{ let s = 12345; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; for (let i = 0; i < N; i++) { lat[i] = B.lat0 + rnd() * (B.lat1 - B.lat0); lon[i] = B.lon0 + rnd() * (B.lon1 - B.lon0); } }
const T = tilePieces(N, lat, lon);
const camera = (at, h, to) => { const c = new PerspectiveCamera(32, 16 / 9, .5, 20000); c.position.copy(toWorld(at[0], at[1], h)); c.up.set(0, 1, 0); c.lookAt(toWorld(to[0], to[1], 0)); c.updateMatrixWorld(); c.updateProjectionMatrix(); return c; };
const covered = (ranges, at) => ranges.some(r => at >= r[0] && at < r[0] + r[1]);

test('line tiles: the Z code keeps the squares of a larger square together', () => {
  assert.equal(zcode(0, 0), 0); assert.equal(zcode(1, 0), 1); assert.equal(zcode(0, 1), 2); assert.equal(zcode(3, 3), 15); assert.equal(zcode(4, 0), 16);
  // the sixteen squares of a square four a side take sixteen codes in a row
  for (const [x0, y0] of [[0, 0], [4, 8], [12, 4]]) { const c = []; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) c.push(zcode(x0 + x, y0 + y)); c.sort((a, b) => a - b); assert.equal(c[15] - c[0], 15); }
});

test('line tiles: every piece once, square by square, in a square in the order it came', () => {
  const seen = new Uint8Array(N); for (const i of T.order) { assert.equal(seen[i], 0); seen[i] = 1; }
  assert.equal(T.order.length, N); assert.ok(T.leaves > 300 && T.leaves < 3000, T.leaves + ' squares');
  const leaves = []; const walk = nd => { if (!nd.kids) { leaves.push(nd); return; } let at = nd.start, total = 0;
    for (const k of nd.kids) { assert.equal(k.start, at, 'the squares of a square stand in a row'); at += k.count; total += k.count; walk(k); }
    assert.equal(total, nd.count); assert.ok(nd.kids.length >= 2 && nd.kids.length <= 4); };
  walk(T.root); assert.equal(T.root.start, 0); assert.equal(T.root.count, N); assert.equal(leaves.length, T.leaves);
  const dLat = LEAF_KM / KM_PER_DEG, dLon = LEAF_KM / (KM_PER_DEG * COS_REF);
  for (const l of leaves) {
    assert.ok(l.box[2] - l.box[0] <= dLat + 1e-9 && l.box[3] - l.box[1] <= dLon + 1e-9, 'a square is no larger than ' + LEAF_KM + ' km');
    for (let k = l.start; k < l.start + l.count; k++) { const i = T.order[k]; assert.ok(lat[i] >= l.box[0] && lat[i] <= l.box[2] && lon[i] >= l.box[1] && lon[i] <= l.box[3]); if (k > l.start) assert.ok(i > T.order[k - 1], 'the order of the pieces is kept'); }
    const c = toWorld((l.box[0] + l.box[2]) / 2, (l.box[1] + l.box[3]) / 2, 0); assert.ok(l.ball.center.distanceTo(c) < 1e-6 && l.ball.radius < LEAF_KM);
  }
  // a square that holds others holds their pieces too
  const inside = (nd, box) => { for (let k = nd.start; k < nd.start + nd.count; k += 97) { const i = T.order[k]; assert.ok(lat[i] >= box[0] && lat[i] <= box[2] && lon[i] >= box[1] && lon[i] <= box[3]); } };
  inside(T.root, T.root.box); for (const k of T.root.kids) inside(k, k.box);
  assert.deepEqual(tilePieces(0, [], []), { order: new Uint32Array(0), root: null, leaves: 0 });
  const one = tilePieces(3, [40, 40.01, 40.02], [0, .01, .02]); assert.equal(one.leaves, 1); assert.equal(one.root.kids, null); assert.deepEqual(Array.from(one.order), [0, 1, 2]);
});

test('line tiles: a camera near the ground draws a small part, and everything it can see', () => {
  // the Pyrenees from 25 km, looking south-east; Paris from 60 km, looking north; the delta of the Rhine straight down
  for (const [name, at, h, to, most] of [['pyrenees', [42.9, .5], 25, [42.6, .7], .3], ['paris', [48.3, 2.3], 60, [48.9, 2.35], .4], ['delta', [51.75, 4.3], 60, [51.76, 4.3], .05]]) {
    const cam = camera(at, h, to), fr = frustumOf(cam), ranges = visibleRanges(T.root, fr, 10, MAX_RANGES, 0);
    assert.ok(ranges.length >= 1 && ranges.length <= MAX_RANGES, name + ': ' + ranges.length + ' ranges');
    let drawn = 0; for (let k = 0; k < ranges.length; k++) { drawn += ranges[k][1]; if (k) assert.ok(ranges[k][0] > ranges[k - 1][0] + ranges[k - 1][1], 'in order, none touching the next'); }
    assert.ok(drawn < N * most, name + ': ' + drawn + ' of ' + N + ' pieces drawn');
    // nothing that is in the picture is left out
    const pos = new Uint32Array(N); T.order.forEach((i, k) => { pos[i] = k; }); let seen = 0;
    for (let i = 0; i < N; i++) if (fr.containsPoint(toWorld(lat[i], lon[i], 0))) { seen++; assert.ok(covered(ranges, pos[i]), name + ': a piece in the picture is drawn'); }
    assert.ok(seen > 0 && seen <= drawn, name + ': ' + seen + ' pieces in the picture');
    // … with a margin, more is drawn, never less
    const wide = visibleRanges(T.root, fr, 60, MAX_RANGES, 0); let more = 0; for (const r of wide) more += r[1]; assert.ok(more >= drawn);
    // … and with few ranges allowed, the same pieces and more
    const few = visibleRanges(T.root, fr, 10, 2, 0); assert.ok(few.length <= 2); for (const r of ranges) assert.ok(covered(few, r[0]) && covered(few, r[0] + r[1] - 1));
  }
});

test('line tiles: from high up everything is one range; a camera that looks away draws nothing', () => {
  const high = visibleRanges(T.root, frustumOf(camera([41.5, .7], 7000, [41.6, .7])), 10);
  assert.deepEqual(high, [[0, N]]);
  const away = visibleRanges(T.root, frustumOf(camera([-30, 150], 40, [-30.2, 150])), 10);       // over Australia
  assert.deepEqual(away, []);
  assert.deepEqual(visibleRanges(null, frustumOf(camera([40, 0], 40, [40.1, 0])), 10), []);
});

test('line tiles: a mesh draws the first range itself, its children the others, from the same buffers', () => {
  const geo = new BufferGeometry(); geo.setAttribute('aLL', new BufferAttribute(new Float32Array(400), 2)); geo.setIndex(new BufferAttribute(new Uint32Array(600), 1));
  const mesh = new Mesh(geo, new MeshBasicMaterial()); mesh.renderOrder = -5;
  const draw = rangeDrawer(mesh);
  assert.equal(draw([[10, 5], [40, 20], [70, 1]]), 3);
  assert.deepEqual([geo.drawRange.start, geo.drawRange.count], [60, 30]);
  assert.equal(mesh.children.length, 2);
  const [a, b] = mesh.children;
  assert.deepEqual([a.geometry.drawRange.start, a.geometry.drawRange.count, b.geometry.drawRange.start, b.geometry.drawRange.count], [240, 120, 420, 6]);
  assert.ok(a.geometry.index === geo.index && a.geometry.attributes.aLL === geo.attributes.aLL, 'the same buffers, nothing copied');
  assert.ok(a.material === mesh.material && a.renderOrder === -5 && a.visible && b.visible && a.frustumCulled === false);
  // fewer ranges: the children that are not needed are hidden, none is made anew
  mesh.renderOrder = 6; draw([[0, 100]]);
  assert.deepEqual([geo.drawRange.start, geo.drawRange.count], [0, 600]); assert.ok(!a.visible && !b.visible && mesh.children.length === 2);
  draw([[0, 1], [50, 2]]); assert.ok(a.visible && !b.visible && a.renderOrder === 6);
  draw([]); assert.equal(geo.drawRange.count, 0); assert.ok(!a.visible);
  draw(null); assert.equal(geo.drawRange.count, Infinity);
  // the geometry of the mesh is disposed of by its owner: the children's go with it
  let gone = 0; a.geometry.addEventListener('dispose', () => gone++); b.geometry.addEventListener('dispose', () => gone++); geo.addEventListener('dispose', () => gone++);
  geo.dispose(); assert.equal(gone, 3);
});

test('line tiles: by classes first — class by class, in a class square by square; a frame joins what it draws of each', () => {
  // the class of a piece: 0 the few wide ones … 3 the many narrow ones; class 2 is empty
  const tier = new Uint8Array(N); for (let i = 0; i < N; i++) tier[i] = i % 50 === 0 ? 0 : i % 7 === 0 ? 1 : 3;
  const C = tileTiers(N, lat, lon, tier, 4);
  assert.equal(C.tiers.length, 4); assert.equal(C.tiers[2], null);
  const seen = new Uint8Array(N); let at = 0;
  for (const [k, t] of C.tiers.entries()) { if (!t) continue;
    assert.equal(t.start, at); assert.equal(t.root.start, t.start); assert.equal(t.root.count, t.count);
    for (let j = t.start; j < t.start + t.count; j++) { const i = C.order[j]; assert.equal(tier[i], k, 'a piece stands in its class'); assert.equal(seen[i], 0); seen[i] = 1; }
    at += t.count; }
  assert.equal(at, N);
  // the squares of a class are those of its own pieces: the few wide ones take far fewer squares
  assert.ok(C.tiers[0].leaves < C.tiers[3].leaves && C.tiers[0].count === N / 50);
  // a frame: the classes it wants, each by the squares in the picture, as one list of ranges
  const fr = frustumOf(camera([42.9, .5], 25, [42.6, .7])), r = [];
  for (const k of [0, 1, 3]) collectRanges(C.tiers[k].root, fr, 10, r);
  for (let k = 1; k < r.length; k++) assert.ok(r[k][0] > r[k - 1][0] + r[k - 1][1]);
  const pos = new Uint32Array(N); C.order.forEach((i, k) => { pos[i] = k; });
  for (let i = 0; i < N; i++) if (fr.containsPoint(toWorld(lat[i], lon[i], 0))) assert.ok(covered(r, pos[i]));
  // without the narrow class nothing of it is drawn
  const wideOnly = collectRanges(C.tiers[0].root, fr, 10); for (const q of wideOnly) assert.ok(q[0] + q[1] <= C.tiers[0].count);
  // too many ranges: the nearest are joined, what was drawn is still drawn
  const many = [[0, 5], [10, 5], [16, 4], [100, 10], [300, 1]], few = capRanges(many.map(q => q.slice()), 3, 0);
  assert.deepEqual(few, [[0, 20], [100, 10], [300, 1]]);
  assert.deepEqual(capRanges([[3, 4]], 1), [[3, 4]]); assert.deepEqual(capRanges([], 2), []);
  // ranges with only a few pieces between them are drawn as one: a draw call costs more than those pieces
  assert.deepEqual(capRanges(many.map(q => q.slice()), 9, 5), [[0, 20], [100, 10], [300, 1]]);
  assert.deepEqual(capRanges(many.map(q => q.slice()), 9, 80), [[0, 110], [300, 1]]);
  assert.ok(NEAR > 50 && NEAR < 5000);
});

test('line tiles: the sheets of the rivers go by classes of width, the widest first', () => {
  assert.ok(TIERS.length >= 4 && TIERS.every((w, k) => w > 0 && (!k || w < TIERS[k - 1])), 'the widest first');
  assert.ok(TIERS[0] >= .1 && TIERS[TIERS.length - 1] <= .012, 'from the great rivers down to the brooks');
  assert.ok(RANGES >= MAX_RANGES);
  // from 1700 km water under 76 m is left out, from 820 km under 36 m: whole classes go
  const thin = h => { const px = 2 * h * Math.tan(16 * Math.PI / 180) / 900; return riverFar(px).show[0] * px; };
  assert.ok(TIERS.filter(w => w <= thin(1700)).length >= 3 && TIERS.filter(w => w <= thin(820)).length >= 2 && TIERS.filter(w => w <= thin(25)).length === 0);
});
