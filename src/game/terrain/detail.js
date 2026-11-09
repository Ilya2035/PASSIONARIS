import * as THREE from 'three';

// Streams detailed heights (~1.2 km, public/assets/terrain/z7) into a 2048x2048 toroidal window around the camera.
// Tile (gx, gy) lives in slot (gx mod 8, gy mod 8); the texture wraps, so bilinear/mips work across slots.
// New slots are first filled from the global 8192x4096 heights (no holes), then replaced by detail tiles.
const SLOTS = 8, T = 256, WIN = SLOTS * T;
const OFF = 12500;

let LUT = null;
function halfLUT() {
  if (!LUT) { LUT = new Uint16Array(2 * OFF + 1); for (let v = -OFF; v <= OFF; v++) LUT[v + OFF] = THREE.DataUtils.toHalfFloat(v); }
  return LUT;
}

async function fetchGz(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(ds).arrayBuffer());
  }
  return buf;
}

export class DetailTerrain {
  constructor(globe, data, base = 'assets/terrain/z7/') {
    this.globe = globe;
    this.data = data; // { W, H, height: Int16Array }
    this.base = base;
    this.maskBase = base.replace('/z7/', '/z7m/');
    this.index = null;
    this.kept = null;
    this.slotTile = new Int32Array(SLOTS * SLOTS).fill(-1);
    this.f32 = new Float32Array(WIN * WIN);
    // mip chain (CPU) as half floats
    this.levels = [];
    for (let s = WIN; s >= 1; s >>= 1) this.levels.push({ data: new Uint16Array(s * s), width: s, height: s });
    const tex = new THREE.DataTexture(this.levels[0].data, WIN, WIN, THREE.RedFormat, THREE.HalfFloatType);
    tex.internalFormat = 'R16F';
    tex.mipmaps = this.levels;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    this.tex = tex;
    // land coverage mask (R8, GPU mips)
    this.mask = new Uint8Array(WIN * WIN);
    const mt = new THREE.DataTexture(this.mask, WIN, WIN, THREE.RedFormat, THREE.UnsignedByteType);
    mt.minFilter = THREE.LinearMipmapLinearFilter; mt.magFilter = THREE.LinearFilter;
    mt.wrapS = mt.wrapT = THREE.RepeatWrapping; mt.generateMipmaps = true;
    this.maskTex = mt;
    this.origin = null;
    this.queue = []; this.inflight = 0; this.dirty = false; this.lastUpload = 0;
    this.enabled = false;
    const sh = globe.shared;
    sh.uDetail.value = tex;
    sh.uDetailMask.value = this.maskTex;
    this.ready = fetch(`${base}index.json`).then(r => (r.ok ? r.json() : null)).then(j => {
      if (!j) return;
      this.index = j; this.TX = j.tiles[0]; this.TY = j.tiles[1];
      this.kept = new Uint8Array(this.TX * this.TY);
      for (const k of j.kept) this.kept[k] = 1;
    }).catch(() => {});
  }

  // fill a slot from the global coarse heights (bilinear), so the window never shows holes
  prefill(gx, gy) {
    const { W, H, height } = this.data;
    const sx = (gx % SLOTS) * T, sy = (gy % SLOTS) * T;
    const ratio = (this.TX * T) / W; // detail texels per global texel (4)
    for (let y = 0; y < T; y++) {
      const fy = Math.max(0, Math.min(H - 1.001, (gy * T + y + 0.5) / ratio - 0.5));
      const y0 = Math.floor(fy), ty = fy - y0, y1 = Math.min(H - 1, y0 + 1);
      const row = (sy + y) * WIN + sx;
      for (let x = 0; x < T; x++) {
        const fx = (gx * T + x + 0.5) / ratio - 0.5;
        const xf = Math.floor(fx), tx = fx - xf;
        const x0 = ((xf % W) + W) % W, x1 = (x0 + 1) % W;
        const a = height[y0 * W + x0], b = height[y0 * W + x1], c = height[y1 * W + x0], d = height[y1 * W + x1];
        this.f32[row + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
      }
    }
    // coarse land mask from the global cells until the 1.2 km mask arrives
    const cells = this.data.cells;
    for (let y = 0; y < T; y++) {
      const cy = Math.min(H - 1, Math.floor((gy * T + y) / ratio));
      for (let x = 0; x < T; x++) {
        const cx = Math.floor((gx * T + x) / ratio) % W;
        this.mask[(sy + y) * WIN + sx + x] = cells[cy * W + cx] >= 2 ? 255 : 0;
      }
    }
    this.maskDirty = true;
    this.writeSlot(gx, gy);
  }

  // f32 slot region -> half-float level 0 + local mips
  writeSlot(gx, gy) {
    const lut = halfLUT();
    const sx = (gx % SLOTS) * T, sy = (gy % SLOTS) * T;
    let src = null, size = T, lw = WIN;
    for (let l = 0; l < this.levels.length && size >= 1; l++) {
      const L = this.levels[l];
      const ox = sx >> l, oy = sy >> l;
      if (l === 0) {
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
          const v = this.f32[(sy + y) * WIN + sx + x];
          L.data[(oy + y) * L.width + ox + x] = lut[Math.max(-OFF, Math.min(OFF, Math.round(v))) + OFF];
        }
        src = new Float32Array(T * T);
        for (let y = 0; y < T; y++) src.set(this.f32.subarray((sy + y) * WIN + sx, (sy + y) * WIN + sx + T), y * T);
      } else {
        const ns = size, ps = size * 2, dst = new Float32Array(ns * ns);
        for (let y = 0; y < ns; y++) for (let x = 0; x < ns; x++) {
          const i = 2 * y * ps + 2 * x;
          const v = (src[i] + src[i + 1] + src[i + ps] + src[i + ps + 1]) * 0.25;
          dst[y * ns + x] = v;
          L.data[(oy + y) * L.width + ox + x] = lut[Math.max(-OFF, Math.min(OFF, Math.round(v))) + OFF];
        }
        src = dst;
      }
      size >>= 1; lw >>= 1;
    }
    // the coarsest levels (smaller than one slot) mix all slots: rebuild them from level log2(SLOTS)
    const firstShared = Math.log2(T) + 1; // level where a slot is < 1 texel
    for (let l = firstShared; l < this.levels.length; l++) {
      const P = this.levels[l - 1], L = this.levels[l];
      for (let y = 0; y < L.height; y++) for (let x = 0; x < L.width; x++) {
        const i = 2 * y * P.width + 2 * x;
        const v = (THREE.DataUtils.fromHalfFloat(P.data[i]) + THREE.DataUtils.fromHalfFloat(P.data[i + 1]) + THREE.DataUtils.fromHalfFloat(P.data[i + P.width]) + THREE.DataUtils.fromHalfFloat(P.data[i + P.width + 1])) * 0.25;
        L.data[y * L.width + x] = THREE.DataUtils.toHalfFloat(v);
      }
    }
    this.dirty = true;
  }

  async loadTile(gx, gy, key) {
    try {
      const bytes = await fetchGz(`${this.base}${gx}_${gy}.bin.gz`);
      if (this.slotTile[(gy % SLOTS) * SLOTS + (gx % SLOTS)] !== key) return; // slot reassigned meanwhile
      const d = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
      const sx = (gx % SLOTS) * T, sy = (gy % SLOTS) * T;
      for (let y = 0; y < T; y++) {
        let acc = 0;
        const row = (sy + y) * WIN + sx;
        for (let x = 0; x < T; x++) { acc += d[y * T + x]; this.f32[row + x] = acc; }
      }
      this.writeSlot(gx, gy);
      const mb = await fetchGz(this.maskBase + `${gx}_${gy}.bin.gz`).catch(() => null);
      if (mb && mb.length === T * T && this.slotTile[(gy % SLOTS) * SLOTS + (gx % SLOTS)] === key) {
        for (let y = 0; y < T; y++) this.mask.set(mb.subarray(y * T, y * T + T), (sy + y) * WIN + sx);
        this.maskDirty = true;
      }
    } catch { /* keep coarse prefill */ }
  }

  pump() {
    while (this.inflight < 6 && this.queue.length) {
      const job = this.queue.shift();
      if (this.slotTile[(job.gy % SLOTS) * SLOTS + (job.gx % SLOTS)] !== job.key) continue;
      this.inflight++;
      this.loadTile(job.gx, job.gy, job.key).finally(() => { this.inflight--; this.pump(); });
    }
  }

  retarget(ox, oy) {
    this.origin = [ox, oy];
    const jobs = [];
    for (let j = 0; j < SLOTS; j++) for (let i = 0; i < SLOTS; i++) {
      const gx = (((ox + i) % this.TX) + this.TX) % this.TX, gy = oy + j;
      const key = gy * this.TX + gx;
      const slot = (gy % SLOTS) * SLOTS + (gx % SLOTS);
      if (this.slotTile[slot] === key) continue;
      this.slotTile[slot] = key;
      this.prefill(gx, gy);
      if (this.kept[key]) jobs.push({ gx, gy, key, d: Math.hypot(i - 3.5, j - 3.5) });
    }
    jobs.sort((a, b) => a.d - b.d);
    this.queue = jobs.concat(this.queue);
    this.pump();
  }

  update(gcam, timeMs) {
    const sh = this.globe.shared;
    if (!this.index) { sh.uDetailOn.value = 0; return; }
    const on = gcam.alt < 0.22;
    sh.uDetailOn.value = on ? Math.min(1, (0.22 - gcam.alt) / 0.06) : 0;
    if (!on) return;
    const lat = Math.asin(Math.max(-1, Math.min(1, gcam.F.y))) * 180 / Math.PI, lon = Math.atan2(gcam.F.x, gcam.F.z) * 180 / Math.PI;
    const ctx = Math.floor((lon + 180) / 360 * this.TX), cty = Math.floor((90 - lat) / 180 * this.TY);
    const ox = ctx - 4, oy = Math.max(0, Math.min(this.TY - SLOTS, cty - 4));
    if (!this.origin || Math.abs(((ox - this.origin[0] + this.TX * 1.5) % this.TX) - this.TX / 2) >= 2 || Math.abs(oy - this.origin[1]) >= 2) this.retarget(ox, oy);
    sh.uDetailOrigin.value.set(this.origin[0], this.origin[1]);
    if ((this.dirty || this.maskDirty) && timeMs - this.lastUpload > 250) {
      if (this.dirty) { this.tex.needsUpdate = true; this.dirty = false; }
      if (this.maskDirty) { this.maskTex.needsUpdate = true; this.maskDirty = false; }
      this.lastUpload = timeMs;
    }
  }
}
