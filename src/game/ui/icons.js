// Simple geometric line icons (stroke = currentColor) for the map-mode buttons.
const svg = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="miter" stroke-linecap="square" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  relief: svg('<path d="M2 20 L9 7 L13 13 L16 9 L22 20 Z"/><path d="M7.5 11 L9 7 L10.6 10"/>'),
  terrain: svg('<path d="M12 3 L17 11 H14.5 L19 18 H5 L9.5 11 H7 Z"/><path d="M12 18 V22"/>'),
  temperature: svg('<path d="M10 4 a2 2 0 0 1 4 0 V14 a4 4 0 1 1 -4 0 Z"/><path d="M12 9 V16"/>'),
  precipitation: svg('<path d="M12 3 C12 3 6 10.5 6 14.5 a6 6 0 0 0 12 0 C18 10.5 12 3 12 3 Z"/>'),
  hazards: svg('<path d="M3 21 L9 9 H15 L21 21 Z"/><path d="M10.5 9 L9.5 5 M13.5 9 L14.5 5 M12 9 V3"/>'),
  regions: svg('<path d="M8 3 L14 3 L17 8 L14 13 L8 13 L5 8 Z"/><path d="M14 13 L17 18 L14 23 M8 13 L5 18 L8 23 M5 18 H2"/>'),
  currents: svg('<path d="M2 9 C6 5 10 13 14 9 S20 7 22 9"/><path d="M2 15 C6 11 10 19 14 15 S20 13 22 15"/>'),
  // climate belts: a globe with its zones
  koppen: svg('<circle cx="12" cy="12" r="9"/><path d="M4.2 7.5 H19.8 M3 12 H21 M4.2 16.5 H19.8"/>'),
  // a sprout over the furrow
  fertility: svg('<path d="M12 20 V10.5"/><path d="M12 13.5 C7.5 13.5 5 11 5 6.5 C9.5 6.5 12 9 12 13.5 Z"/><path d="M12 10.5 C12 6.5 14.5 4 19 4 C19 8.5 16.5 10.5 12 10.5 Z"/><path d="M5 20.5 H19"/>'),
  // an angular cloud with rain
  weather: svg('<path d="M4 14 L6 10 H9 L11 6.5 H15.5 L17.5 10 H19 L21 14 Z"/><path d="M8 17 L7 20.5 M12.5 17 L11.5 20.5 M17 17 L16 20.5"/>'),
  // haze and ash in the air
  air: svg('<path d="M3 7.5 H11 M14 7.5 H21 M6 12 H16 M19 12 H21 M3 16.5 H9 M12 16.5 H20"/><path d="M15.5 3.5 L16.5 4.5 M8 20 L9 21"/>'),
  // wind streaks with curls
  winds: svg('<path d="M3 8.5 H14.5 a2.75 2.75 0 1 0 -2.75 -2.75"/><path d="M3 12.5 H18 a3 3 0 1 1 -3 3"/><path d="M3 16.5 H9"/>'),
  // the climate group: sun behind a cloud
  climate: svg('<circle cx="9" cy="8.5" r="3.2"/><path d="M9 2.5 V3.8 M3 8.5 H4.3 M4.8 4.3 L5.7 5.2 M13.2 4.3 L12.3 5.2"/><path d="M6.5 19 L8.5 15 H11.5 L13.5 11.5 H17.5 L19.5 15 H20 L21.5 19 Z"/>'),
};

// Map modes. `needs` = a feature key of the world systems (src/game/world/systems.js); `group` gathers modes under
// one button whose column opens above it (keeps the row short).
export const MODE_GROUPS = {
  climate: { name: 'Климат и погода', hint: 'температура, осадки, пояса, погода, воздух, ветры' },
};
export const MODE_DEFS = [
  { id: 'relief', name: 'Рельеф', hint: 'Топографическая карта высот' },
  { id: 'terrain', name: 'Местность', hint: 'Леса, степи, пустыни, льды' },
  { id: 'fertility', name: 'Плодородие', hint: 'Где можно жить и возделывать землю: тепло, вода, реки, рельеф', needs: 'climate' },
  { id: 'temperature', group: 'climate', name: 'Температура', hint: 'Средняя температура месяца', needs: 'climate' },
  { id: 'precipitation', group: 'climate', name: 'Осадки', hint: 'Осадки месяца', needs: 'climate' },
  { id: 'koppen', group: 'climate', name: 'Климатические пояса', hint: 'Типы климата по Кёппену для этой эпохи', needs: 'climate' },
  { id: 'weather', group: 'climate', name: 'Погода сегодня', hint: 'Дожди и снегопады, снег, засуха, отклонение от нормы', needs: 'weather' },
  { id: 'air', group: 'climate', name: 'Воздух', hint: 'Вулканический пепел, дым пожаров, пыль, дымка', needs: 'aerosols' },
  { id: 'winds', group: 'climate', name: 'Ветры и течения', hint: 'Преобладающие ветры и морские течения', needs: 'wind' },
  { id: 'hazards', name: 'Опасности', hint: 'Землетрясения, вулканы, цунами', needs: 'hazards' },
  { id: 'regions', name: 'Районы', hint: 'Природные районы и морские зоны', needs: 'regions' },
];

const CARET = '<i class="mode-caret" aria-hidden="true"></i>';
let closerBound = false;

// The row of map-mode buttons (bottom right). available: Set of feature keys. Grouped modes sit in a column above their group's
// button (opens on hover or click, each with its name on a slip); a group with one member is a plain button.
export function buildModeButtons(el, onSelect, available) {
  el.innerHTML = '';
  const groups = new Map();
  const modeBtn = m => {
    const b = document.createElement('button');
    b.className = 'mode-btn'; b.dataset.mode = m.id; b.title = `${m.name} — ${m.hint}`;
    b.setAttribute('aria-label', m.name);
    b.innerHTML = ICONS[m.id] || '';
    b.onclick = () => { b.closest('.mode-group')?.classList.remove('open'); onSelect(m.id); };
    return b;
  };
  for (const m of MODE_DEFS) {
    if (m.needs && !available.has(m.needs)) continue;
    const b = modeBtn(m);
    if (!m.group) { el.appendChild(b); continue; }
    let g = groups.get(m.group);
    if (!g) {
      const def = MODE_GROUPS[m.group] || { name: m.group, hint: '' };
      const wrap = document.createElement('div');
      wrap.className = 'mode-group'; wrap.dataset.group = m.group;
      const head = document.createElement('button');
      head.className = 'mode-btn mode-head'; head.title = `${def.name} — ${def.hint}`;
      head.setAttribute('aria-label', def.name); head.setAttribute('aria-haspopup', 'true');
      head.innerHTML = (ICONS[m.group] || '') + CARET;
      head.onclick = () => wrap.classList.toggle('open');
      const fly = document.createElement('div');
      fly.className = 'mode-fly';
      wrap.append(fly, head);
      el.appendChild(wrap);
      g = { wrap, fly };
      groups.set(m.group, g);
    }
    const item = document.createElement('div');
    item.className = 'mode-item';
    const label = document.createElement('span');
    label.className = 'mode-label'; label.textContent = m.name;
    label.onclick = () => b.click();
    item.append(label, b);
    g.fly.appendChild(item);
  }
  for (const g of groups.values()) {
    if (g.fly.children.length === 1) g.wrap.replaceWith(g.fly.querySelector('.mode-btn'));
  }
  if (!closerBound) {
    closerBound = true;
    document.addEventListener('pointerdown', e => {
      for (const g of document.querySelectorAll('.mode-group.open')) if (!g.contains(e.target)) g.classList.remove('open');
    });
  }
}

// Marks the active mode; a group's button takes the icon and the name of its active member.
export function markModeButtons(el, id) {
  for (const b of el.querySelectorAll('.mode-btn[data-mode]')) b.classList.toggle('active', b.dataset.mode === id);
  for (const g of el.querySelectorAll('.mode-group')) {
    const key = g.dataset.group, def = MODE_GROUPS[key] || { name: key, hint: '' };
    const m = MODE_DEFS.find(d => d.id === id && d.group === key && g.querySelector(`.mode-btn[data-mode="${id}"]`));
    const head = g.querySelector('.mode-head');
    head.classList.toggle('active', !!m);
    head.innerHTML = (ICONS[m ? m.id : key] || '') + CARET;
    head.title = m ? `${def.name}: ${m.name} — ${m.hint}` : `${def.name} — ${def.hint}`;
  }
}
