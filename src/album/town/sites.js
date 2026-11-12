// Where people really settled: public/assets/album/town/sites.json.gz, baked by scripts/album/bake-sites.mjs from
// OpenStreetMap (© OpenStreetMap contributors, ODbL 1.0) — the cities, towns and larger villages of the region, the
// most populous first. The centre of a district stands on the largest of them (division/centres.js).
// This file has no imports: the page, the tests and the scripts all read it.
export const SITE_KINDS = ['city', 'town', 'village'];
export const decodeSites = j => (j?.sites || []).map(s => ({ lon: s[0] / 1e4, lat: s[1] / 1e4, pop: s[2], kind: s[3], name: s[4] }));
// in the page: fetch and unzip; an empty list when the file is not there
export async function loadSites(url = 'assets/album/town/sites.json.gz') {
  try {
    const r = await fetch(url); if (!r.ok) return [];
    return decodeSites(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json());
  } catch { return []; }
}
