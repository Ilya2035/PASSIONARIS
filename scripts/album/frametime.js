// Time of one album frame, for `scripts/harness.sh atime`. A capture window is hidden and its frames come about once
// a second, so the frame rate there says nothing; this draws the picture several times in a row, reading a pixel back
// after each one so the GPU has to finish, and reports the average.
(async () => {
  const a = window.__album, gl = a.renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'), px = new Uint8Array(4);
  const one = () => { a.draw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  for (let i = 0; i < 3; i++) one();
  const N = 12, t0 = performance.now(); for (let i = 0; i < N; i++) one();
  const ms = (performance.now() - t0) / N;
  return `frame=${ms.toFixed(1)}ms (${(1000 / ms).toFixed(0)} fps) size=${gl.drawingBufferWidth}x${gl.drawingBufferHeight} tris=${a.renderer.info.render.triangles} gpu=${(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?').slice(0, 60)}`;
})()
