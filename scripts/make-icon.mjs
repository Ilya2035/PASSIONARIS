// Application icon: a bronze stipple globe with a sharp diamond, on dark archive paper.
// Writes public/assets/ui/icon.png (256 px) and icon.ico (PNG-in-ICO, 16…256 px) for the window and shortcuts.
//   node scripts/make-icon.mjs
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, '../public/assets/ui');
mkdirSync(OUT, { recursive: true });

let s = 20261110;
const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };

function svg(size, detail) {
  const c = size / 2, R = size * 0.35, cy = size * 0.46;
  const parts = [];
  parts.push(`<defs>
    <radialGradient id="g" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#f2dcaa"/><stop offset=".55" stop-color="#b9894e"/><stop offset="1" stop-color="#5e4024"/></radialGradient>
    <radialGradient id="bg" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#2a231b"/><stop offset="1" stop-color="#110f0c"/></radialGradient>
    <clipPath id="clip"><circle cx="${c}" cy="${cy}" r="${R}"/></clipPath>
  </defs>`);
  parts.push(`<rect x="${size * 0.03}" y="${size * 0.03}" width="${size * 0.94}" height="${size * 0.94}" rx="${size * 0.16}" fill="url(#bg)" stroke="#6b4e2c" stroke-width="${Math.max(1, size * 0.012)}"/>`);
  parts.push(`<circle cx="${c}" cy="${cy}" r="${R}" fill="url(#g)"/>`);
  // stipple: light dots on the lit side, dark dots on the night side
  if (detail) {
    const dots = [];
    for (let i = 0; i < size * size * 0.06; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R;
      const x = c + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      const lit = ((x - c) * -0.6 + (y - cy) * -0.8) / R;
      const dark = rnd() < 0.5 + lit * 0.4;
      dots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(size / 256 * (0.6 + rnd() * 0.7)).toFixed(2)}" fill="${dark ? '#f6e6c0' : '#3a2814'}" opacity="${(0.25 + rnd() * 0.35).toFixed(2)}"/>`);
    }
    parts.push(`<g clip-path="url(#clip)">${dots.join('')}</g>`);
  }
  // graticule: three meridians, two parallels
  const lw = Math.max(1, size * (detail ? 0.009 : 0.02));
  const g = [];
  for (const k of [0.38, 0.72]) g.push(`<ellipse cx="${c}" cy="${cy}" rx="${R * k}" ry="${R}" fill="none"/>`);
  g.push(`<line x1="${c}" y1="${cy - R}" x2="${c}" y2="${cy + R}"/>`);
  for (const k of [-0.45, 0, 0.45]) { const y = cy + R * k, w = Math.sqrt(1 - k * k) * R; g.push(`<line x1="${c - w}" y1="${y}" x2="${c + w}" y2="${y}"/>`); }
  parts.push(`<g stroke="#3b2a17" stroke-width="${lw}" opacity=".55" clip-path="url(#clip)">${g.join('')}</g>`);
  parts.push(`<circle cx="${c}" cy="${cy}" r="${R}" fill="none" stroke="#2a1d0f" stroke-width="${Math.max(1, size * 0.014)}"/>`);
  // the diamond of the logo, below the globe
  const dy = cy + R + size * 0.07, dw = size * 0.075, dh = size * 0.05;
  parts.push(`<path d="M${c} ${dy - dh} L${c + dw} ${dy} L${c} ${dy + dh} L${c - dw} ${dy} Z" fill="#e3c286" stroke="#2a1d0f" stroke-width="${Math.max(0.6, size * 0.006)}"/>`);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${parts.join('')}</svg>`);
}

const sizes = [256, 128, 64, 48, 32, 24, 16];
const pngs = [];
for (const z of sizes) pngs.push(await sharp(svg(z >= 48 ? 256 : z * 4, z >= 32)).resize(z, z).png().toBuffer());
writeFileSync(resolve(OUT, 'icon.png'), pngs[0]);

// ICO container: header, one directory entry per size, PNG payloads
const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
const dir = Buffer.alloc(16 * sizes.length);
let off = 6 + dir.length;
sizes.forEach((z, i) => {
  const e = i * 16;
  dir.writeUInt8(z >= 256 ? 0 : z, e); dir.writeUInt8(z >= 256 ? 0 : z, e + 1);
  dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
  dir.writeUInt32LE(pngs[i].length, e + 8); dir.writeUInt32LE(off, e + 12);
  off += pngs[i].length;
});
writeFileSync(resolve(OUT, 'icon.ico'), Buffer.concat([head, dir, ...pngs]));
console.log('icon.png + icon.ico →', OUT);
