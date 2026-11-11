// Fetches the 3D models of the graphics album into public/album-data/models/ (outside the repository):
// buildings, construction stages, walls, trees and rocks from "KayKit : Medieval Hexagon Pack 1.0" by Kay Lousberg
// (www.kaylousberg.com), licence CC0 — https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0
//   node scripts/album/fetch-models.mjs
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'public', 'album-data', 'models');
const BASE = 'https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0/main/addons/kaykit_medieval_hexagon_pack/Assets/gltf/';
export const MODELS = {
  'buildings/red': ['home_A', 'home_B', 'church', 'castle', 'tower_A', 'tower_B', 'tower_base', 'market', 'tavern', 'blacksmith', 'well', 'windmill', 'watermill', 'lumbermill', 'barracks', 'mine'].map(n => `building_${n}_red`),
  'buildings/neutral': ['building_stage_A', 'building_stage_B', 'building_stage_C', 'building_scaffolding', 'building_grain', 'building_dirt', 'building_bridge_A', 'wall_straight', 'wall_straight_gate', 'wall_corner_A_outside', 'fence_stone_straight', 'fence_wood_straight'],
  'decoration/nature': ['tree_single_A', 'tree_single_B', 'trees_A_small', 'trees_A_medium', 'trees_A_large', 'trees_B_small', 'trees_B_medium', 'trees_B_large', 'rock_single_A', 'rock_single_B', 'rock_single_C', 'rock_single_D', 'rock_single_E'],
};
async function get(url, file) {
  if (existsSync(file) && statSync(file).size > 0) return true;
  const r = await fetch(url, { headers: { 'User-Agent': 'passionaris-album/0.1 (open-source game prototype)' } });
  if (!r.ok) { console.log('  missing', url.slice(BASE.length), r.status); return false; }
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return true;
}
mkdirSync(OUT, { recursive: true });
const list = [];
await get(BASE + 'buildings/red/hexagons_medieval.png', join(OUT, 'hexagons_medieval.png'));
for (const [dir, names] of Object.entries(MODELS)) for (const n of names) {
  const ok = await get(`${BASE}${dir}/${n}.gltf`, join(OUT, `${n}.gltf`)) && await get(`${BASE}${dir}/${n}.bin`, join(OUT, `${n}.bin`));
  if (ok) list.push(n);
}
writeFileSync(join(OUT, 'models.json'), JSON.stringify({ source: 'KayKit : Medieval Hexagon Pack 1.0, Kay Lousberg, CC0', models: list }, null, 1));
console.log(`models: ${list.length} →`, OUT);
