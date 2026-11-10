// The owner's marks: { pageId: { mark: 'ok' | 'no' | '', note } }, kept in localStorage; feedbackText() turns them
// into plain text for pasting into the chat (it also lists the knobs he moved away from the page's own values).
import { DEFS } from './params.js';

const KEY = 'passionaris-album-feedback';
export function loadFeedback() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
export function saveFeedback(fb) { try { localStorage.setItem(KEY, JSON.stringify(fb)); } catch { /* private mode or blocked storage */ } }

export function feedbackText(album, fb, version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '') {
  const by = m => album.pages.filter(pg => (fb[pg.id]?.mark || '') === m);
  const line = pg => `- ${pg.title}${fb[pg.id]?.note ? ` — ${fb[pg.id].note.trim()}` : ''}`;
  const out = [`Альбом графики Passionaris ${version}: мой отзыв`.replace('  ', ' ')];
  const ok = by('ok'), no = by('no'), noted = by('').filter(pg => fb[pg.id]?.note?.trim());
  if (ok.length) out.push('', 'Подходит:', ...ok.map(line));
  if (no.length) out.push('', 'Не то:', ...no.map(line));
  if (noted.length) out.push('', 'Заметки без оценки:', ...noted.map(line));
  if (!ok.length && !no.length && !noted.length) out.push('', 'Оценок пока нет.');
  const base = { ...Object.fromEntries(DEFS.map(d => [d.key, d.value])), ...(album.page?.p || {}) };
  const moved = DEFS.filter(d => album.params.get(d.key) !== base[d.key]).map(d => `${d.label}: ${album.params.get(d.key)}`);
  if (moved.length) out.push('', `Сейчас открыта страница «${album.page.title}», мои настройки на ней:`, ...moved.map(s => `- ${s}`));
  const c = album.cam.s;
  out.push('', `Камера: высота ${Math.round(c.h)} км, наклон ${Math.round(c.tilt)}°, ${c.lat.toFixed(2)}° с. ш., ${c.lon.toFixed(2)}° в. д.`);
  return out.join('\n');
}
