// Dev helper: prints hazard levels at reference points and catalogue spot checks.
//   tools/node/node.exe scripts/hazards/inspect.mjs [lat lon]...
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
const OUT = path.resolve(import.meta.dirname, '..', '..', 'public', 'assets', 'hazards');
const meta = JSON.parse(fs.readFileSync(path.join(OUT, 'hazardLevels.json'), 'utf8'));
const bin = zlib.gunzipSync(fs.readFileSync(path.join(OUT, 'hazardLevels.bin.gz')));
const N = meta.layerBytes;
const L = Object.fromEntries(meta.layers.map(l => [l.name, bin.subarray(l.offset, l.offset + N)]));
const cell = (lat, lon) => Math.min(359, Math.floor((90 - lat) / 0.5)) * 720 + Math.min(719, Math.floor((lon + 180) / 0.5));
const pts = process.argv.length > 3 ? [[+process.argv[2], +process.argv[3], 'arg']] : [
  [35.7, 139.7, 'Tokyo'], [38.3, 141, 'Sendai'], [-33.4, -70.6, 'Santiago'], [-36.8, -73, 'Concepcion'], [-6.2, 106.8, 'Jakarta'], [-7.5, 110.4, 'Merapi'],
  [-0.9, 100.4, 'Padang'], [55.75, 37.6, 'Moscow'], [57, 45, 'C.Russia'], [60, 70, 'W.Siberia'], [62, 95, 'C.Siberia'], [-25, 134, 'Alice/AU'],
  [-28, 140, 'L.Eyre'], [-30, 125, 'Nullarbor'], [40.8, 14.4, 'Naples'], [38.7, -9.1, 'Lisbon'], [27.7, 85.3, 'Kathmandu'], [46, 8, 'Alps'],
  [28, 87, 'Everest'], [64, -19, 'Iceland'], [19.4, -155.3, 'Hawaii'], [37.8, -122.4, 'SF'], [52, 0, 'London'], [48.9, 2.3, 'Paris'], [0, -30, 'Atlantic'],
];
console.log('name       lat     lon   quake I10 tsu vol lsl slope land coast wet place');
for (const [la, lo, nm] of pts) {
  const c = cell(la, lo);
  console.log(nm.padEnd(10), String(la).padStart(6), String(lo).padStart(7), ' ', L.quake[c], ' ', String(L.quakeI10[c]).padStart(3), ' ', L.tsunami[c], ' ', L.volcano[c], ' ', L.landslide[c],
    String(L.slope[c]).padStart(5), String(L.land[c]).padStart(5), String(L.coast[c]).padStart(3), String(L.wet[c]).padStart(5), meta.places[L.placeLo[c] | (L.placeHi[c] << 8)]);
}
console.log(JSON.stringify(meta.stats));
