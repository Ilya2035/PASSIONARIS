// Save thumbnails (browser only). Returns a small JPEG data URL for meta.thumbnail.
//
// A WebGL canvas without preserveDrawingBuffer is cleared after compositing: call this right after
// renderer.render(scene, camera) in the same task (e.g. at the end of the frame callback).

/**
 * @param {HTMLCanvasElement|OffscreenCanvas|ImageBitmap} source
 * @param {object} [o]  {width=320, height=180, type='image/jpeg', quality=0.72}
 * @returns {string|null} data URL, or null when it cannot be made (no DOM, tainted canvas)
 */
export function captureThumbnail(source, { width = 320, height = 180, type = 'image/jpeg', quality = 0.72 } = {}) {
  if (typeof document === 'undefined' || !source) return null;
  const sw = source.width, sh = source.height;
  if (!sw || !sh) return null;
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const g = c.getContext('2d');
  if (!g) return null;
  // cover-fit crop around the centre
  const scale = Math.max(width / sw, height / sh);
  const cw = width / scale, ch = height / scale;
  g.imageSmoothingQuality = 'high';
  try {
    g.drawImage(source, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, width, height);
    return c.toDataURL(type, quality);
  } catch {
    return null;
  }
}
