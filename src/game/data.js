import * as THREE from 'three';

const BASE = 'assets/map/';

async function fetchBytes(url, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); n += value.length; onBytes?.(value.length);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  // the dev server may or may not have decoded the gzip already
  if (out[0] === 0x1f && out[1] === 0x8b) {
    const ds = new Blob([out]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(ds).arrayBuffer());
  }
  return out;
}

const typed = (bytes, Type) => new Type(bytes.buffer, bytes.byteOffset, bytes.byteLength / Type.BYTES_PER_ELEMENT);

export async function loadWorld(onProgress) {
  const expected = 36e6 + 2.6e6 + 1.6e6 + 2.3e6 + 2.9e6;
  let got = 0;
  const tick = b => { got += b; onProgress?.(Math.min(0.97, got / expected)); };

  // the 8192x4096 imagery is decoded off the main thread (createImageBitmap) while the other files load; an <img>
  // would be decoded synchronously at its first upload (~0.2 s of a frozen first frame). No colour conversion and
  // no flip, like the plain image upload before (the globe keeps flipY = false: row 0 = north)
  const albedoP = (typeof createImageBitmap === 'function'
    ? new THREE.ImageBitmapLoader().setOptions({ premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'from-image' })
      .loadAsync(BASE + 'albedo.jpg').then(bmp => new THREE.Texture(bmp))
    : Promise.reject(new Error('no createImageBitmap'))
  ).catch(() => new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(BASE + 'albedo.jpg', resolve, undefined, reject);
  })).then(t => { tick(2.9e6); return t; });

  const [worldBytes, hBytes, cBytes, rBytes, rkBytes, albedo] = await Promise.all([
    fetchBytes(BASE + 'world.json', tick),
    fetchBytes(BASE + 'height.delta.bin.gz', tick),
    fetchBytes(BASE + 'cells.bin.gz', tick),
    fetchBytes(BASE + 'rivers.bin.gz', tick),
    fetchBytes(BASE + 'rivers-rank.bin.gz', tick),
    albedoP,
  ]);
  const world = JSON.parse(new TextDecoder().decode(worldBytes));
  const { width: W, height: H } = world.grid;

  // integrate delta-encoded rows
  const height = typed(hBytes, Int16Array);
  for (let y = 0; y < H; y++) {
    let acc = 0;
    const row = y * W;
    for (let x = 0; x < W; x++) { acc += height[row + x]; height[row + x] = acc; }
  }
  const cells = typed(cBytes, Uint32Array);
  const rivers = typed(rBytes, Float32Array);
  const riverRank = rkBytes;
  onProgress?.(1);
  return { world, W, H, height, cells, rivers, riverRank, albedo };
}

// ------------------------------------------------------------- GPU textures

export function makeHeightTexture(height, W, H) {
  // half-float with hand-made mip chain (integer metres through a LUT)
  const OFF = 12500;
  const lut = new Uint16Array(2 * OFF + 1);
  for (let v = -OFF; v <= OFF; v++) lut[v + OFF] = THREE.DataUtils.toHalfFloat(v);
  const toHalf = (src, n) => {
    const out = new Uint16Array(n);
    for (let i = 0; i < n; i++) out[i] = lut[Math.max(-OFF, Math.min(OFF, Math.round(src[i]))) + OFF];
    return out;
  };
  const mipmaps = [{ data: toHalf(height, W * H), width: W, height: H }];
  let src = height, w = W, h = H;
  while (w > 1 && h > 1) {
    const nw = w >> 1, nh = h >> 1;
    const dst = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const i = 2 * y * w + 2 * x;
      dst[y * nw + x] = (src[i] + src[i + 1] + src[i + w] + src[i + w + 1]) * 0.25;
    }
    mipmaps.push({ data: toHalf(dst, nw * nh), width: nw, height: nh });
    src = dst; w = nw; h = nh;
  }
  const tex = new THREE.DataTexture(mipmaps[0].data, W, H, THREE.RedFormat, THREE.HalfFloatType);
  tex.internalFormat = 'R16F';
  tex.mipmaps = mipmaps;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export function makeCellTexture(cells, W, H) {
  const tex = new THREE.DataTexture(cells, W, H, THREE.RedIntegerFormat, THREE.UnsignedIntType);
  tex.internalFormat = 'R32UI';
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export const INFO_W = 1024;

export function makeInfoTexture(world) {
  const D = world.districts.count;
  const rows = Math.ceil(D / INFO_W);
  const data = new Uint16Array(INFO_W * rows * 2);
  for (let id = 2; id < D; id++) {
    const pv = world.districts.province[id];
    data[id * 2] = pv;
    data[id * 2 + 1] = world.provinces[pv]?.country ?? 0;
  }
  const tex = new THREE.DataTexture(data, INFO_W, rows, THREE.RGIntegerFormat, THREE.UnsignedShortType);
  tex.internalFormat = 'RG16UI';
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export function makeColorTexture(world) {
  const rows = Math.ceil(world.districts.count / INFO_W);
  const tex = new THREE.DataTexture(new Uint8Array(INFO_W * rows * 4), INFO_W, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const hexRGB = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function hashColor(n, sat = 0.45, lig = 0.55) {
  const h = (Math.imul(n + 1, 2654435761) >>> 0) % 360;
  const s = sat + ((Math.imul(n + 7, 40503) >>> 0) % 15) / 100;
  const l = lig + ((Math.imul(n + 3, 9973) >>> 0) % 12) / 100 - 0.06;
  const k = x => (x + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = x => Math.round((l - a * Math.max(-1, Math.min(k(x) - 3, 9 - k(x), 1))) * 255);
  return [f(0), f(8), f(4)];
}

export const MAP_MODES = [
  { id: 'political', key: '1', name: 'Политическая' },
  { id: 'terrain', key: '2', name: 'Рельеф' },
  { id: 'provinces', key: '3', name: 'Провинции' },
  { id: 'districts', key: '4', name: 'Районы' },
];

export function fillMapMode(tex, world, mode) {
  const data = tex.image.data;
  const { count, province } = world.districts;
  const countryRGB = world.countries.map(c => hexRGB(c.color));
  data.fill(0);
  for (let id = 2; id < count; id++) {
    const pv = province[id];
    const c = world.provinces[pv]?.country ?? 0;
    let rgb, a;
    switch (mode) {
      case 'political': rgb = countryRGB[c]; a = 0.66; break;
      case 'provinces': rgb = hashColor(pv * 13 + 5); a = 0.6; break;
      case 'districts': rgb = hashColor(id, 0.38, 0.58); a = 0.55; break;
      default: rgb = [0, 0, 0]; a = 0;
    }
    data[id * 4] = rgb[0]; data[id * 4 + 1] = rgb[1]; data[id * 4 + 2] = rgb[2]; data[id * 4 + 3] = Math.round(a * 255);
  }
  tex.needsUpdate = true;
}
