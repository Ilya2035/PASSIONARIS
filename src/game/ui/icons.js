// Simple geometric line icons (stroke = currentColor), sharp joins to match the angular style.
const svg = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="miter" stroke-linecap="square" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  relief: svg('<path d="M2 20 L9 7 L13 13 L16 9 L22 20 Z"/><path d="M7.5 11 L9 7 L10.6 10"/>'),
  terrain: svg('<path d="M12 3 L17 11 H14.5 L19 18 H5 L9.5 11 H7 Z"/><path d="M12 18 V22"/>'),
  temperature: svg('<path d="M10 4 a2 2 0 0 1 4 0 V14 a4 4 0 1 1 -4 0 Z"/><path d="M12 9 V16"/>'),
  precipitation: svg('<path d="M12 3 C12 3 6 10.5 6 14.5 a6 6 0 0 0 12 0 C18 10.5 12 3 12 3 Z"/>'),
  hazards: svg('<path d="M3 21 L9 9 H15 L21 21 Z"/><path d="M10.5 9 L9.5 5 M13.5 9 L14.5 5 M12 9 V3"/>'),
  regions: svg('<path d="M8 3 L14 3 L17 8 L14 13 L8 13 L5 8 Z"/><path d="M14 13 L17 18 L14 23 M8 13 L5 18 L8 23 M5 18 H2"/>'),
  currents: svg('<path d="M2 9 C6 5 10 13 14 9 S20 7 22 9"/><path d="M2 15 C6 11 10 19 14 15 S20 13 22 15"/>'),
};

export const MODE_DEFS = [
  { id: 'relief', name: 'Рельеф', hint: 'Топографическая карта высот' },
  { id: 'terrain', name: 'Местность', hint: 'Леса, степи, пустыни, льды' },
  { id: 'temperature', name: 'Температура', hint: 'Средняя температура месяца', needs: 'climate' },
  { id: 'precipitation', name: 'Осадки', hint: 'Осадки месяца', needs: 'climate' },
  { id: 'hazards', name: 'Опасности', hint: 'Землетрясения, вулканы, цунами', needs: 'hazards' },
  { id: 'regions', name: 'Районы', hint: 'Природные районы и морские зоны', needs: 'regions' },
];
