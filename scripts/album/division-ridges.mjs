// Do the borders of the districts lie on the crests in the mountains? (docs/album/division.md, «Горы: граница по
// гребню…»). Builds the division as the page does and walks the border lines of the land every 500 m in the four
// ranges of Spain: across the line it takes the heights ±3 km; where they rise and fall by less than 200 m the point
// is not counted. A crest is a top of that profile with the land 60 m lower on both sides within 1.5 km, a valley floor
// the other way round. A point within 750 m of a crest (and no nearer a floor) is on the crest; within 750 m of a floor,
// in the valley; a crest farther but within 2.5 km — on a slope below it; else elsewhere on a slope.
//   node scripts/album/division-ridges.mjs [--old] [--random]
//     --old     the districts laid as before the watersheds (MOUNTAIN.vote off)
//     --random  also the same lines moved by (3.1, 2.3) km: what the land gives a line that does not look for crests
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Chunks, llOf } from '../../src/album/chunks.js';
import { buildDivision } from '../../src/album/division/build.js';
import { MOUNTAIN } from '../../src/album/division/cells.js';
import { loadAlbumData } from '../../src/album/division/nodedata.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const json = f => JSON.parse(readFileSync(join(ROOT, 'public/assets/album/division', f), 'utf8'));
const data = loadAlbumData(ROOT); if (!data) { console.log('no album data (public/album-data)'); process.exit(1); }
if (process.argv.includes('--old')) MOUNTAIN.vote = false;
const lakes = (() => { try { return JSON.parse(readFileSync(join(ROOT, 'public/assets/album/water/lakes.json'), 'utf8')).lakes.filter(l => !l.shoal && l.ring); } catch { return []; } })();
const ch = new Chunks(data.base.at, data.vectors.rivers, lakes, data.worked);
const div = buildDivision(ch, { lands: json('lands.json'), admin: json('admin.json'), heightAt: data.base.at, lakes: data.vectors.lakes || [], rivers: data.vectors.rivers || [], size: 20, worked: data.worked });
const H = (x, y) => { const p = llOf(x, y); return data.base.at(p.lat, p.lon); };
const RANGES = { 'Пиренеи': [42.25, 43.25, -2.0, 3.3], 'Кантабрийские горы': [42.6, 43.45, -7.3, -3.4], 'Центральная Кордильера': [40.0, 41.3, -7.6, -3.1], 'Сьерра-Невада': [36.85, 37.3, -3.75, -2.5] };
const rangeOf = (x, y) => { const p = llOf(x, y); for (const [k, b] of Object.entries(RANGES)) if (p.lat >= b[0] && p.lat <= b[1] && p.lon >= b[2] && p.lon <= b[3]) return k; return null; };

function measure(lines, title) {
  const R = {}; for (const k of Object.keys(RANGES)) R[k] = [0, 1, 2].map(() => ({ km: 0, crest: 0, floor: 0, below: 0 }));
  for (const L of lines) {
    if (L.key & 1) continue;                                   // the land only
    const level = L.key >> 1;
    for (let i = 1; i < L.pts.length; i++) {
      const [ax, ay] = L.pts[i - 1], [bx, by] = L.pts[i], len = Math.hypot(bx - ax, by - ay); if (!len) continue;
      const nx = -(by - ay) / len, ny = (bx - ax) / len, steps = Math.max(1, Math.round(len / .5));
      for (let s = 0; s < steps; s++) {
        const t = (s + .5) / steps, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, k = rangeOf(x, y); if (!k) continue;
        const prof = []; for (let q = -12; q <= 12; q++) prof.push(H(x + nx * q * .25, y + ny * q * .25));
        if (Math.max(...prof) - Math.min(...prof) < 200) continue;
        const r = R[k][level], w = len / steps; r.km += w;
        let dc = 9, dv = 9;
        for (let c = 1; c < 24; c++) {
          const hc = prof[c], o = Math.abs(c - 12) * .25, left = prof.slice(Math.max(0, c - 6), c), right = prof.slice(c + 1, Math.min(25, c + 7));
          if (hc >= prof[c - 1] && hc >= prof[c + 1] && hc - Math.min(...left) >= 60 && hc - Math.min(...right) >= 60) dc = Math.min(dc, o);
          if (hc <= prof[c - 1] && hc <= prof[c + 1] && Math.max(...left) - hc >= 60 && Math.max(...right) - hc >= 60) dv = Math.min(dv, o);
        }
        if (dc <= .75 && dc <= dv) r.crest += w; else if (dv <= .75) r.floor += w; else if (dc <= 2.5) r.below += w;
      }
    }
  }
  console.log(title);
  const pc = (v, of) => (of ? (100 * v / of).toFixed(0) + ' %' : '—');
  for (const [k, lv] of Object.entries(R)) {
    const d = lv[0], up = { km: lv[1].km + lv[2].km, crest: lv[1].crest + lv[2].crest };
    console.log(`  ${k.padEnd(24)} districts ${d.km.toFixed(0).padStart(5)} km: on the crest ${pc(d.crest, d.km)}, in the valley ${pc(d.floor, d.km)}, on a slope below a crest ${pc(d.below, d.km)}; provinces and regions on the crest ${pc(up.crest, up.km)}`);
  }
}
measure(div.geo.lines, process.argv.includes('--old') ? 'as before the watersheds' : 'as the page draws them');
if (process.argv.includes('--random')) measure(div.geo.lines.map(L => ({ ...L, pts: L.pts.map(p => [p[0] + 3.1, p[1] + 2.3]) })), 'the same lines moved by (3.1, 2.3) km');
