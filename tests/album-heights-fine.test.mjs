// The fine heights of the mountains (scripts/album/fetch-heights-fine.mjs): a baked tile decodes back to the heights it
// was made of, and the region where mountains are looked for is the one the script says.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeTile, decodeTile, REGION, STEP, tileName } from '../scripts/album/fetch-heights-fine.mjs';

test('a fine height tile decodes back to its heights, to half a metre', () => {
  // a slope with a ridge and a dip below the sea, written the way a terrarium PNG holds it
  const rgb = new Uint8Array(65536 * 3), want = new Float64Array(65536);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const h = -40 + i * 9.37 + Math.abs(128 - j) * 6.11 + 300 * Math.sin(i / 17) * Math.cos(j / 23), k = j * 256 + i, v = h + 32768;
    rgb[k * 3] = Math.floor(v / 256); rgb[k * 3 + 1] = Math.floor(v) % 256; rgb[k * 3 + 2] = Math.floor((v - Math.floor(v)) * 256);
    want[k] = rgb[k * 3] * 256 + rgb[k * 3 + 1] + rgb[k * 3 + 2] / 256 - 32768;
  }
  const e = encodeTile(rgb, 3), back = decodeTile(Buffer.from(e.d.buffer));
  let worst = 0;
  for (let k = 0; k < 65536; k++) { assert.equal(back[k], e.u[k]); worst = Math.max(worst, Math.abs(back[k] / 4 - 8192 - want[k])); }
  assert.ok(worst <= STEP / 2 + 1e-9, `off by ${worst} m`);
  assert.ok(Math.abs(e.lo - Math.min(...want)) < 1e-9 && Math.abs(e.hi - Math.max(...want)) < 1e-9);
});

test('mountains are looked for in Iberia and the Pyrenees, not in Africa or beyond the Pyrenees', () => {
  assert.ok(REGION(42.63, 0.66), 'Aneto');
  assert.ok(REGION(37.05, -3.31), 'Mulhacén');
  assert.ok(REGION(39.8, 2.8), 'Tramuntana of Mallorca');
  assert.ok(REGION(42.9, 0.1), 'the French side of the Pyrenees');
  assert.ok(!REGION(35.2, -4.5), 'the Rif');
  assert.ok(!REGION(36.5, 3), 'the Tell Atlas');
  assert.ok(!REGION(44.3, 3.5), 'the Cévennes');
  assert.equal(tileName(1027, 755), '1027_755.u16d.gz');
});
