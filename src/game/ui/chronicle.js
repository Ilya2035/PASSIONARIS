// Chronicle of the world: the notable events so far (great eruptions, quakes, tsunamis, meteorites from the
// hazards module; extreme weather spells from the weather module), newest first. A click flies to the place.
import { openModal, closeModal } from './menus.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function openChronicle({ items, onPick }) {
  const box = $('chronicle-list');
  box.innerHTML = items.length ? '' : '<div class="dim">Пока тихо: великих событий ещё не было. Запустите время.</div>';
  for (const it of items) {
    const row = document.createElement('div');
    row.className = `chr-row k-${it.kind}`;
    row.innerHTML = `<div class="when">${esc(it.when)}</div><div class="what">${esc(it.title)}<span class="sub">${esc(it.sub || '')}</span></div>`;
    row.onclick = () => { closeModal('chronicle'); onPick?.(it); };
    box.appendChild(row);
  }
  openModal('chronicle');
}
