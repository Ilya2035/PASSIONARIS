// Small styled confirmation dialog (paper card) instead of window.confirm. Markup: #confirm in index.html.
//
//   if (await confirmDialog({ title: 'Удалить сохранение?', text: '…', yes: 'Удалить', danger: true })) …
//
// Esc / a click on the backdrop / «Отмена» → false. The safe button («Отмена») gets the focus first.

const $ = id => document.getElementById(id);
let pending = null;

export function isConfirmOpen() { return !!pending; }

export function confirmDialog({ title, text = '', note = '', yes = 'Да', no = 'Отмена', danger = false }) {
  if (pending) pending(false);
  const back = $('confirm');
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('confirm-text').hidden = !text;
  $('confirm-note').textContent = note;
  $('confirm-note').hidden = !note;
  const yesBtn = $('confirm-yes'), noBtn = $('confirm-no');
  yesBtn.textContent = yes;
  noBtn.textContent = no;
  yesBtn.classList.toggle('danger', danger);
  const before = document.activeElement;
  back.classList.add('open');
  noBtn.focus();
  return new Promise(resolve => {
    const done = v => {
      pending = null;
      back.classList.remove('open');
      yesBtn.onclick = noBtn.onclick = back.onclick = null;
      document.removeEventListener('keydown', onKey, true);
      try { before?.focus?.(); } catch { /* element gone */ }
      resolve(v);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      // keep Tab inside the dialog
      if (e.key === 'Tab') {
        e.preventDefault();
        (document.activeElement === yesBtn ? noBtn : yesBtn).focus();
      }
    };
    pending = done;
    yesBtn.onclick = () => done(true);
    noBtn.onclick = () => done(false);
    back.onclick = e => { if (e.target === back) done(false); };
    document.addEventListener('keydown', onKey, true);
  });
}
