// Things that stand on the land. Each layer: { update(dt, t, cam) } and reacts to params itself.
export async function initLayers(album) {
  const mods = await Promise.allSettled([
    import('./layers/rivers.js'), import('./layers/towns.js'), import('./layers/roads.js'), import('./layers/forest.js'),
    import('./layers/hazards.js'), import('./layers/labels.js'), import('./layers/clouds.js'),
  ]);
  for (const m of mods) {
    if (m.status !== 'fulfilled') { console.warn('[album] layer failed to load:', m.reason?.message); continue; }
    try { const l = await m.value.default(album); if (l) album.layers[l.id] = l; } catch (e) { console.warn('[album] layer failed:', e.message); }
  }
}
