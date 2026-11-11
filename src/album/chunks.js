// The chunk system (docs/ALBUM-CHUNKS.md). The land and the sea are divided into chunks of 10 × 10 km — the smallest
// unit of the game world: chunk → district → province → region. A chunk cannot be clicked; it only holds state (how
// much forest stands, how much ice, snow, swamp, houses, fields …). The picture is drawn from that state: every pixel
// reads the state of the chunks around it, joined smoothly (CHUNK_GLSL in glsl.js), so neighbouring chunks merge
// without a visible seam and a change of state (a forest cut down, a sea freezing) spreads chunk by chunk.
import { DataTexture, RGBAFormat, UnsignedByteType, LinearFilter, NearestFilter, ClampToEdgeWrapping, Vector3, Vector4 } from 'three';
import { KM_PER_DEG, COS_REF } from './geo.js';

export const CHUNK_KM = 10, CN = 128, CI0 = -88, CJ0 = 388;   // CN × CN chunks; chunk (CI0, CJ0) is texel (0, 0)

// Every number a chunk carries for the picture: name → [texture, byte, Russian label]. Values are 0..1.
// The textures are read by the ground shader, the trees, the houses — by everything, the same way.
export const CHANNELS = {
  forest: ['A', 0, 'лес'],            // how much of the natural forest stands: 0 cut down .. 1 untouched
  conifer: ['A', 1, 'хвойные'],       // share of conifers among the trees
  age: ['A', 2, 'возраст леса'],      // 0 young growth .. 1 old forest
  swamp: ['A', 3, 'болото'],          // share of the chunk under bog and marsh
  ice: ['B', 0, 'лёд'],               // ice on the water of the chunk: 0 open water .. 1 solid
  snow: ['B', 1, 'снег'],             // snow lying on the chunk, on land and on ice
  flood: ['B', 2, 'разлив'],          // extra water over the land: 0 none .. 1 flooded
  spareB: ['B', 3, 'запас'],
  built: ['C', 0, 'застройка'],       // share of the chunk under houses
  fields: ['C', 1, 'поля'],           // share under fields and pasture
  culture: ['C', 2, 'манера строить'], // building manner, index / 255
  burnt: ['C', 3, 'гарь'],            // 0 .. 1 burnt out
};
const DEFAULTS = { forest: 1, conifer: .3, age: .8 };

export const kmOf = (lat, lon) => [lon * KM_PER_DEG * COS_REF, lat * KM_PER_DEG];          // flat km: east, north
export const llOf = (x, y) => ({ lat: y / KM_PER_DEG, lon: x / (KM_PER_DEG * COS_REF) });

// colour ramps for show(): t 0..1 → [r, g, b] 0..1, as seen on screen
export const RAMPS = {
  green: t => [.93 - .75 * t, .90 - .42 * t, .80 - .66 * t],
  blue: t => [.92 - .74 * t, .94 - .52 * t, .97 - .22 * t],
  warm: t => [.96 - .12 * t, .90 - .62 * t, .70 - .58 * t],
  grey: t => [.95 - .75 * t, .95 - .75 * t, .95 - .75 * t],
};

export class Chunks {
  constructor(heightAt) {
    const n = CN * CN;
    this.n = CN; this.count = n;
    this.bytes = { A: new Uint8Array(n * 4), B: new Uint8Array(n * 4), C: new Uint8Array(n * 4), D: new Uint8Array(n * 4) };
    this.tex = {}; this.dirty = { A: true, B: true, C: true, D: true };
    for (const k of 'ABCD') {
      const t = this.tex[k] = new DataTexture(this.bytes[k], CN, CN, RGBAFormat, UnsignedByteType);
      t.magFilter = t.minFilter = k === 'D' ? NearestFilter : LinearFilter; t.wrapS = t.wrapT = ClampToEdgeWrapping; t.needsUpdate = true;
    }
    this.land = new Float32Array(n);     // share of the chunk that is land, 0..1
    this.height = new Float32Array(n);   // mean height of its land, metres
    this.layers = new Map();             // extra numbers per chunk that the shader does not read (resources …)
    this.version = 0;                    // grows with every change of state
    this.resetters = [];
    this.uniforms = {
      tChunkA: { value: this.tex.A }, tChunkB: { value: this.tex.B }, tChunkC: { value: this.tex.C }, tChunkD: { value: this.tex.D },
      uChunkRect: { value: new Vector4(CI0 * CHUNK_KM, CJ0 * CHUNK_KM, 1 / (CN * CHUNK_KM), 1 / (CN * CHUNK_KM)) },
      uChunkShow: { value: 0 }, uChunkHover: { value: new Vector3(0, 0, 0) },
    };
    this.natural = { A: new Uint8Array(n * 4), B: new Uint8Array(n * 4), C: new Uint8Array(n * 4) };
    for (const [name, v] of Object.entries(DEFAULTS)) for (let k = 0; k < n; k++) this.setNatural(name, k, v);
    if (heightAt) this.measure(heightAt);
  }
  // ---- geometry
  k(i, j) { const x = i - CI0, y = j - CJ0; return x >= 0 && y >= 0 && x < CN && y < CN ? y * CN + x : -1; }
  ij(k) { return { i: (k % CN) + CI0, j: ((k / CN) | 0) + CJ0 }; }
  at(lat, lon) { const [x, y] = kmOf(lat, lon); return this.k(Math.floor(x / CHUNK_KM), Math.floor(y / CHUNK_KM)); }
  centre(k) { const { i, j } = this.ij(k), x = (i + .5) * CHUNK_KM, y = (j + .5) * CHUNK_KM; return { ...llOf(x, y), x, y }; }
  neighbours(k) { const x = k % CN, y = (k / CN) | 0, out = []; if (x > 0) out.push(k - 1); if (x < CN - 1) out.push(k + 1); if (y > 0) out.push(k - CN); if (y < CN - 1) out.push(k + CN); return out; }
  // land share and mean land height of every chunk, from 5 × 5 height samples
  measure(heightAt) {
    for (let k = 0; k < this.count; k++) {
      const { i, j } = this.ij(k); let land = 0, sum = 0;
      for (let b = 0; b < 5; b++) for (let a = 0; a < 5; a++) {
        const p = llOf((i + (a + .5) / 5) * CHUNK_KM, (j + (b + .5) / 5) * CHUNK_KM), h = heightAt(p.lat, p.lon);
        if (h > 0) { land++; sum += h; }
      }
      this.land[k] = land / 25; this.height[k] = land ? sum / land : 0;
    }
  }
  // ---- state read by the shaders
  get(name, k) { const c = CHANNELS[name]; return this.bytes[c[0]][k * 4 + c[1]] / 255; }
  set(name, k, v) {
    const c = CHANNELS[name], b = Math.max(0, Math.min(255, Math.round(v * 255))), a = this.bytes[c[0]], o = k * 4 + c[1];
    if (a[o] !== b) { a[o] = b; this.dirty[c[0]] = true; this.version++; }
  }
  add(name, k, dv) { this.set(name, k, this.get(name, k) + dv); }
  fill(name, fn) { for (let k = 0; k < this.count; k++) this.set(name, k, fn(k)); }
  // the natural state: what a chunk is before anything happens to it. reset() returns every chunk to it.
  setNatural(name, k, v) { this.set(name, k, v); const c = CHANNELS[name]; this.natural[c[0]][k * 4 + c[1]] = this.bytes[c[0]][k * 4 + c[1]]; }
  getNatural(name, k) { const c = CHANNELS[name]; return this.natural[c[0]][k * 4 + c[1]] / 255; }
  // An aspect that changes chunks on its own (a model of felling, of freezing) registers with onReset() to lay its
  // state over the natural one again.
  reset() { for (const t of 'ABC') { this.bytes[t].set(this.natural[t]); this.dirty[t] = true; } this.version++; for (const fn of this.resetters) fn(this); }
  onReset(fn) { this.resetters.push(fn); }
  // ---- numbers the shaders do not read: resources, anything a district sums up
  layer(name, opts = {}) {
    if (!this.layers.has(name)) this.layers.set(name, { name, title: name, unit: '', sum: true, ...opts, data: new Float32Array(this.count) });
    return this.layers.get(name);
  }
  // paints one number per chunk over the map as flat squares; values = null switches the overlay off
  show(values, { min = 0, max = 1, ramp = RAMPS.green, alpha = .8, skip = v => v <= min } = {}) {
    if (!values) { this.uniforms.uChunkShow.value = 0; return; }
    const d = this.bytes.D;
    for (let k = 0; k < this.count; k++) {
      const v = values[k], t = Math.max(0, Math.min(1, (v - min) / (max - min || 1))), c = ramp(t);
      d[k * 4] = c[0] * 255; d[k * 4 + 1] = c[1] * 255; d[k * 4 + 2] = c[2] * 255; d[k * 4 + 3] = skip(v) ? 0 : 255;
    }
    this.dirty.D = true; this.uniforms.uChunkShow.value = alpha;
  }
  // uploads what changed; called once per frame
  flush() { for (const k of 'ABCD') if (this.dirty[k]) { this.tex[k].needsUpdate = true; this.dirty[k] = false; } }
}
