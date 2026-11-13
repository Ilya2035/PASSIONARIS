// Where people really settled: public/assets/album/town/sites.json.gz, baked by scripts/album/bake-sites.mjs from
// OpenStreetMap (© OpenStreetMap contributors, ODbL 1.0) — the cities, towns and larger villages of the region, the
// most populous first. The centre of a district stands on the largest of them (division/centres.js).
// This file has no imports: the page, the tests and the scripts all read it.
export const SITE_KINDS = ['city', 'town', 'village'];
// (name: in Russian — the Russian name of the data, or the local one transcribed when the data was prepared:
// town/translit.js; orig: the name as the data has it)
export const decodeSites = j => (j?.sites || []).map(s => ({ lon: s[0] / 1e4, lat: s[1] / 1e4, pop: s[2], kind: s[3], name: s[4], orig: s[5] || s[4] }));
// The places of the album itself (Natural Earth) have a list of Russian names beside them, for those the data names
// in Latin letters: public/assets/album/town/places-ru.json, { names: { name of the data: Russian name } }
export async function loadPlaceNames(url = 'assets/album/town/places-ru.json') {
  try { const r = await fetch(url); return r.ok ? (await r.json()).names || {} : {}; } catch { return {}; }
}
// puts the Russian names into a list of places [{ name }] (the name of the data stays in .orig); → how many were named
export function namePlaces(places, names) {
  let n = 0;
  for (const pl of places || []) { const key = String(pl.orig || pl.name || '').replace(/[‎‏]/g, '').trim(), ru = names[key]; if (ru && ru !== pl.name) { pl.orig = key; pl.name = ru; n++; } }
  return n;
}
// in the page: fetch and unzip; an empty list when the file is not there
export async function loadSites(url = 'assets/album/town/sites.json.gz') {
  try {
    const r = await fetch(url); if (!r.ok) return [];
    return decodeSites(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json());
  } catch { return []; }
}
