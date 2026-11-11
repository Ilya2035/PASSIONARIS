// For `scripts/harness.sh acheck`: are all shaders of the album compiled and linked? The tests run without a GPU and
// cannot see a shader error; a broken shader just leaves the land, the trees or the houses undrawn.
(() => {
  const a = window.__album, bad = [], progs = a.renderer.info.programs || [];
  for (const p of progs) {
    const d = p.diagnostics; if (!d || d.runnable) continue;
    bad.push(`${d.programLog || ''} VS: ${(d.vertexShader?.log || '').slice(0, 500)} FS: ${(d.fragmentShader?.log || '').slice(0, 900)}`);
  }
  return bad.length ? `SHADERS BROKEN (${bad.length} of ${progs.length}): ${bad.slice(0, 2).join(' ### ')}` : `shaders ok: ${progs.length} programs, chunks ${a.chunks.count}`;
})()
