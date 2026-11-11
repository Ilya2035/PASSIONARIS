// Tab strip (launcher: changelog/plan panel and the settings modal): grey tabs, the chosen one blue (launcher.css).
//
//   const tabs = createTabs({ strip, panes: id => element, items: [{id, label}], storageKey, onChange });
//   tabs.select('graphics');  tabs.current
//
// The chosen tab is remembered per player in localStorage (a convenience: everything works without it).

const readKey = key => { try { return key ? localStorage.getItem(key) : null; } catch { return null; } };
const writeKey = (key, v) => { try { if (key) localStorage.setItem(key, v); } catch { /* private mode */ } };

export function createTabs({ strip, panes, items, initial, storageKey, onChange }) {
  strip.setAttribute('role', 'tablist');
  const buttons = new Map();
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab';
    b.id = `tab-${strip.id || 'x'}-${it.id}`;
    b.setAttribute('role', 'tab');
    if (it.short) {
      // a short label for narrow panels (CSS container queries pick one)
      b.append(Object.assign(document.createElement('span'), { className: 't-long', textContent: it.label }),
        Object.assign(document.createElement('span'), { className: 't-short', textContent: it.short }));
      b.setAttribute('aria-label', it.label);
    } else b.textContent = it.label;
    if (it.title) b.title = it.title;
    b.onclick = () => select(it.id, true);
    strip.appendChild(b);
    buttons.set(it.id, b);
    const pane = panes(it.id);
    if (pane) { pane.setAttribute('role', 'tabpanel'); pane.setAttribute('aria-labelledby', b.id); }
  }
  // arrow keys move between tabs (WAI-ARIA tabs pattern)
  strip.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    const ids = items.map(i => i.id);
    let k = ids.indexOf(current);
    if (e.key === 'ArrowLeft') k = (k - 1 + ids.length) % ids.length;
    else if (e.key === 'ArrowRight') k = (k + 1) % ids.length;
    else k = e.key === 'Home' ? 0 : ids.length - 1;
    select(ids[k], true);
    buttons.get(ids[k]).focus();
    e.preventDefault();
  });

  let current = null;
  function select(id, user = false) {
    if (!buttons.has(id)) id = items[0].id;
    current = id;
    for (const [k, b] of buttons) {
      const on = k === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      const pane = panes(k);
      if (pane) pane.hidden = !on;
    }
    if (user) writeKey(storageKey, id);
    onChange?.(id);
  }
  select(readKey(storageKey) || initial || items[0].id);
  return { select, get current() { return current; }, button: id => buttons.get(id) };
}
