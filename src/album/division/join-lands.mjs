// Joins the lists of lands beyond the polygon of today (data/division/lands-*.json: France, Benelux with the left bank
// of the Rhine, the whole Maghreb) into the lands of the album (public/assets/album/division/lands.json): for the day
// the polygon takes them in (docs/BACKLOG.md, stage 3 of the third wave). Only Node; run once, in the release that
// widens the polygon, after the new admin.json (division/bake-admin.mjs) — before it the new provinces have no chunks.
//   node src/album/division/join-lands.mjs [--check]
//     --check   only say what would change, write nothing
// What a list may hold, all of it optional but lands and provinces:
//   regions          new regions (Corsica);            regionAbout      { id: about } of regions there are
//   lands            new historical lands;              landChanges      { id: { name, region } } of lands there are
//   provinces        new provinces (iso and town stay in the list: those are for people)
//   provinceChanges  { id: { admin, at, name, land, region } } of provinces there are: what is written replaces
//   seas             new seas;                          seaOutlines      { id: { about, outline } } of seas there are
// Run twice it changes nothing more: what is there already is left as it is.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// the lists, in the order they are joined (a later list may change what an earlier one added)
export const LISTS = ['lands-france.json', 'lands-benelux.json', 'lands-maghreb.json'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// lands: lands.json, list: one list → { lands: a new lands.json, log, twice } (the objects passed in are not changed).
// twice: units a province of the list grows from together with another province, where the list did not mean it
// (lands.json shares some units out between provinces on purpose — Béarn and Labourd —: a list says so in "shared")
export function joinList(lands, list) {
  const out = structuredClone(lands), log = [];
  const add = (key, items, what) => { const ids = new Set(out[key].map(x => x.id)); for (const x of items || []) if (!ids.has(x.id)) { out[key].push(structuredClone(x)); log.push(`${what} ${x.id}`); } };
  const change = (key, changes, what) => {
    for (const [id, ch] of Object.entries(changes || {})) {
      const x = out[key].find(q => q.id === id); if (!x) throw new Error(`no ${what} ${id} in lands.json`);
      for (const [k, v] of Object.entries(ch)) if (!same(x[k], v)) { x[k] = structuredClone(v); log.push(`${what} ${id}: ${k}`); }
    }
  };
  add('regions', list.regions, 'region'); change('regions', Object.fromEntries(Object.entries(list.regionAbout || {}).map(([id, about]) => [id, { about }])), 'region');
  add('lands', list.lands, 'land'); change('lands', list.landChanges, 'land');
  add('provinces', (list.provinces || []).map(({ iso, town, ...p }) => p), 'province'); change('provinces', list.provinceChanges, 'province');
  add('seas', list.seas, 'sea'); change('seas', list.seaOutlines, 'sea');
  const mine = new Set((list.provinces || []).map(p => p.id)), shared = new Set(list.shared || []), own = new Map();
  for (const p of out.provinces) for (const a of p.admin || []) own.set(a, [...(own.get(a) || []), p.id]);
  const twice = [...own].filter(([a, ps]) => ps.length > 1 && ps.some(id => mine.has(id)) && !shared.has(a));
  return { lands: out, log, twice };
}
// all the lists there are, one after another
export function joinLands(lands, lists) {
  let cur = lands; const log = [], twice = [];
  for (const [name, list] of lists) { const j = joinList(cur, list); cur = j.lands; log.push(...j.log.map(l => `${name}: ${l}`)); twice.push(...j.twice.map(t => [name, ...t])); }
  return { lands: cur, log, twice };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const file = join(ROOT, 'public/assets/album/division/lands.json'), lands = JSON.parse(readFileSync(file, 'utf8'));
  const lists = LISTS.map(f => join(ROOT, 'data/division', f)).filter(existsSync).map(f => [f.split(/[\\/]/).pop(), JSON.parse(readFileSync(f, 'utf8'))]);
  const { lands: out, log, twice } = joinLands(lands, lists);
  if (twice.length) console.log('units in two provinces not marked "shared":', twice.map(([n, a, ps]) => `${n} ${a} (${ps.join(', ')})`).join('; '));
  console.log(log.length ? `${log.length} changes:\n  ${log.join('\n  ')}` : 'nothing to change: the lists are joined');
  if (!process.argv.includes('--check') && log.length) { writeFileSync(file, JSON.stringify(out, null, 1)); console.log(`→ ${file}`); }
}
