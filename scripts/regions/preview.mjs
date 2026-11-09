// Preview PNGs for visual sanity checks of the regions bake.
import sharp from 'sharp';

function hashRGB(n, sat, lig) {
  const h = (Math.imul(n + 1, 2654435761) >>> 0) % 360;
  const s = sat + ((Math.imul(n + 7, 40503) >>> 0) % 14) / 100;
  const l = lig + ((Math.imul(n + 3, 9973) >>> 0) % 12) / 100 - 0.06;
  const k = x => (x + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = x => Math.round((l - a * Math.max(-1, Math.min(k(x) - 3, 9 - k(x), 1))) * 255);
  return [f(0), f(8), f(4)];
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// layers: { did (Int32/Uint16 final ids), typeOf(id) -> 'land'|'mountain'|'lake'|'sea', provOf(id), regOf(id),
//           height, barrier, roads: [{coords: Float32Array lon,lat...}], labels: [{lon,lat,text}] }
export async function renderPreview(grid, layers, { lon0, lon1, lat0, lat1, scale = 1, title = '' }, file) {
  const { W, H } = grid;
  const x0 = Math.floor(grid.lonToX(lon0)), x1 = Math.ceil(grid.lonToX(lon1));
  const y0 = Math.floor(grid.latToY(lat1)), y1 = Math.ceil(grid.latToY(lat0));
  const tw = x1 - x0, th = y1 - y0;
  const ow = tw * scale, oh = th * scale;
  const img = new Uint8Array(ow * oh * 3);
  const { did, typeOf, provOf, regOf, height, barrier } = layers;
  const tex = (tx, ty) => { const yy = Math.min(H - 1, Math.max(0, ty)); const xx = ((tx % W) + W) % W; return yy * W + xx; };
  for (let py = 0; py < oh; py++) {
    const ty = y0 + Math.floor(py / scale);
    for (let px = 0; px < ow; px++) {
      const tx = x0 + Math.floor(px / scale);
      const i = tex(tx, ty);
      const id = did[i];
      const t = id ? typeOf(id) : 'none';
      let c;
      if (t === 'sea') c = hashRGB(id, 0.25, 0.62).map((v, k) => Math.round(v * 0.35 + [120, 150, 185][k] * 0.65));
      else if (t === 'lake') c = [140, 180, 205];
      else if (t === 'land' || t === 'mountain') {
        // hue per province, lightness jitter per district
        const j = 0.88 + 0.24 * (((Math.imul(id + 11, 2246822519) >>> 0) % 1000) / 1000);
        c = hashRGB(provOf(id) * 7 + 3, 0.38, 0.64).map(v => Math.min(255, Math.round(v * j)));
        if (t === 'mountain') c = c.map((v, k) => Math.round(v * 0.5 + [110, 98, 86][k] * 0.5));
      }
      else c = [255, 0, 255];
      // hillshade on land
      if (t === 'land' || t === 'mountain') {
        const he = height[tex(tx + 1, ty)], hw = height[tex(tx - 1, ty)], hn = height[tex(tx, ty - 1)], hs = height[tex(tx, ty + 1)];
        const sh = Math.max(0.6, Math.min(1.25, 1 + ((hw - he) + (hn - hs)) / 2500));
        c = c.map(v => Math.min(255, Math.round(v * sh)));
      }
      // borders: compare with the texel right / below in output space
      const iR = tex(x0 + Math.floor((px + 1) / scale), ty), iD = tex(tx, y0 + Math.floor((py + 1) / scale));
      const edge = (a, b) => did[a] !== did[b];
      if (edge(i, iR) || edge(i, iD)) {
        const other = edge(i, iR) ? did[iR] : did[iD];
        const ta = typeOf(id), tb = other ? typeOf(other) : 'none';
        const bothLand = (ta === 'land' || ta === 'mountain') && (tb === 'land' || tb === 'mountain');
        const coastal = (ta === 'land' || ta === 'mountain') !== (tb === 'land' || tb === 'mountain');
        let ink = 0.55;
        if (coastal) ink = 0.25;
        else if (bothLand && regOf(id) !== regOf(other)) { c = [150, 30, 30]; ink = 1; }
        else if (provOf(id) !== provOf(other)) ink = 0.32;
        else if (!bothLand) ink = 0.75;
        if (ink < 1) c = c.map(v => Math.round(v * ink));
      }
      if (barrier && barrier[i] && (t === 'land' || t === 'mountain')) c = [40, 90, 200];
      const o = (py * ow + px) * 3;
      img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2];
    }
  }
  // roads
  const toPx = (lon, lat) => [(grid.lonToX(lon) - x0) * scale, (grid.latToY(lat) - y0) * scale];
  const plot = (x, y, col) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= ow || yi >= oh) return;
    const o = (yi * ow + xi) * 3;
    img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2];
  };
  for (const r of layers.roads || []) {
    const p = r.coords;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const [ax, ay] = toPx(p[k], p[k + 1]), [bx, by] = toPx(p[k + 2], p[k + 3]);
      if (Math.abs(bx - ax) > ow) continue;
      const n = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay))) + 1;
      for (let s = 0; s <= n; s++) plot(ax + (bx - ax) * s / n, ay + (by - ay) * s / n, [95, 55, 25]);
    }
  }
  let svg = '';
  const labels = (layers.labels || []).filter(l => l.lon >= lon0 && l.lon <= lon1 && l.lat >= lat0 && l.lat <= lat1);
  if (labels.length || title) {
    const fs = Math.max(9, Math.min(14, Math.round(scale * 4)));
    svg = `<svg width="${ow}" height="${oh}" xmlns="http://www.w3.org/2000/svg"><style>text{font-family:Arial,sans-serif;font-size:${fs}px;fill:#111;paint-order:stroke;stroke:#fff;stroke-width:2.5px;stroke-opacity:0.8}</style>`;
    for (const l of labels) {
      const [x, y] = toPx(l.lon, l.lat);
      svg += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle">${esc(l.text)}</text>`;
    }
    if (title) svg += `<text x="8" y="${fs + 6}" style="font-size:${fs + 4}px">${esc(title)}</text>`;
    svg += '</svg>';
  }
  let pipe = sharp(Buffer.from(img), { raw: { width: ow, height: oh, channels: 3 } });
  if (svg) pipe = pipe.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]);
  await pipe.png({ compressionLevel: 9 }).toFile(file);
  return { width: ow, height: oh };
}
