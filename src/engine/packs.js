// Packs: mods and DLC for Passionaris (see docs/MODDING.md).
//
// A pack is a folder  public/packs/<id>/  with a manifest  pack.json ; the list of installed packs is
// public/packs/index.json  ({"packs": ["<id>", ...]}) because a web page cannot list folders.
// Data contributions (palettes, biome colours) are merged before the map is built; scripts (ES modules with
// `export function install(api)`) run once the world is up. A broken pack is skipped with a warning and never
// stops the game. The player switches packs in the launcher settings (settings.packs = {id: true|false}).
import { PALETTES } from '../shared/palettes.js';

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const KINDS = new Set(['mod', 'dlc']);
let cache = null;

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

/** Reads every installed pack manifest (once per page). Returns [{id, name, version, kind, description, author, manifest}]. */
export async function listPacks(base = 'packs/') {
  if (cache) return cache;
  let ids = [];
  try { ids = (await json(`${base}index.json`)).packs || []; } catch { ids = []; }
  const out = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !ID_RE.test(id)) { console.warn('[packs] bad id', id); continue; }
    try {
      const m = await json(`${base}${id}/pack.json`);
      if (m.id !== id) throw new Error(`pack.json id "${m.id}" differs from the folder "${id}"`);
      out.push({
        id, name: String(m.name || id), version: String(m.version || '0.0.0'),
        kind: KINDS.has(m.kind) ? m.kind : 'mod', description: String(m.description || ''), author: String(m.author || ''),
        enabledByDefault: m.enabledByDefault ?? m.kind === 'dlc', manifest: m,
      });
    } catch (e) { console.warn(`[packs] ${id} skipped:`, e.message || e); }
  }
  cache = out;
  return out;
}

export const isEnabled = (pack, settings) => settings?.packs?.[pack.id] ?? pack.enabledByDefault;

function addPalette(id, p, packId) {
  const base = PALETTES.graphite;
  if (!p || typeof p !== 'object') return;
  PALETTES[id] = {
    name: String(p.name || id),
    ui: { ...base.ui, ...(p.ui || {}) },
    map: { ...base.map, ...(p.map || {}) },
    pack: packId,
  };
}

/**
 * Applies the data part of every enabled pack. Call before the globe / UI read palettes and colours.
 * @param {object} settings
 * @param {{biomeColors?: object}} targets  objects that packs may extend in place
 */
export async function applyPackData(settings, targets = {}, base = 'packs/') {
  const packs = await listPacks(base);
  const enabled = packs.filter(p => isEnabled(p, settings));
  for (const p of enabled) {
    const m = p.manifest;
    try {
      for (const [id, pal] of Object.entries(m.palettes || {})) if (ID_RE.test(id)) addPalette(id, pal, p.id);
      if (m.biomeColors && targets.biomeColors) {
        for (const [k, v] of Object.entries(m.biomeColors)) if (/^#[0-9a-f]{6}$/i.test(v)) targets.biomeColors[k] = v;
      }
    } catch (e) { console.warn(`[packs] ${p.id} data skipped:`, e.message || e); }
  }
  return { packs, enabled };
}

/** Runs the scripts of enabled packs: each module may export install(api). */
export async function runPackScripts(enabled, api, base = 'packs/') {
  const loaded = [];
  for (const p of enabled) {
    for (const file of p.manifest.scripts || []) {
      if (typeof file !== 'string' || !/^[\w./-]+\.js$/.test(file) || file.includes('..')) continue;
      try {
        const url = new URL(`${base}${p.id}/${file}`, location.href).href;
        const mod = await import(/* @vite-ignore */ url);
        await mod.install?.({ ...api, pack: { id: p.id, name: p.name, version: p.version } });
        loaded.push(`${p.id}/${file}`);
      } catch (e) { console.warn(`[packs] ${p.id}/${file} failed:`, e.message || e); }
    }
  }
  return loaded;
}
