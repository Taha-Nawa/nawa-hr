// طباعة بطاقات عدة موظفين (أو كلهم) دفعة واحدة على A4: تحديد الموظفين ثم معاينة ثم «طباعة / حفظ PDF».
// تُطبع البطاقات السارية فقط؛ من لا بطاقة له يُذكر ليُصدر له من صفحته.
import { h, clear, select, toast } from '../dom.js';
import { get } from '../api.js';
import { qrSvg } from '../qr.js';
import { idCard, cardSheet, ORIENT_OPTIONS } from '../id-card.js';

export default async function render() {
  const all = (await get('/api/employees')).employees.filter((e) => e.status === 'active');
  const picked = new Set();
  let q = '';
  let center = '';
  let orient = 'landscape';
  const centers = [...new Set(all.map((e) => e.center).filter(Boolean))].sort();

  const listBox = h('div', { class: 'ec-pick' });
  const info = h('p', { class: 'muted', role: 'status' });
  const sheet = h('div', { class: 'id-sheet' });
  const missing = h('div', { class: 'notice notice-warn', hidden: true });
  const printBtn = h('button', { type: 'button', class: 'btn btn-primary', disabled: true, onclick: () => window.print() }, 'طباعة / حفظ PDF (A4)');
  let built = []; // [{ e, qr }]

  const visible = () => all.filter((e) => (!center || e.center === center) && (!q || `${e.name} ${e.code} ${e.department || ''}`.includes(q)));
  function drawList() {
    const list = visible();
    clear(listBox).append(...list.map((e) => h('label', { class: 'check ec-pick-row' },
      h('input', { type: 'checkbox', checked: picked.has(e.id), onchange: (ev) => { if (ev.target.checked) picked.add(e.id); else picked.delete(e.id); drawInfo(); } }),
      h('span', null, e.name), h('span', { class: 'muted small' }, [e.jobTitle, e.center].filter(Boolean).join(' · ')))));
    drawInfo();
  }
  function drawInfo() { info.textContent = `${picked.size} محدَّد من ${all.length} موظفاً فعّالاً`; }
  function drawSheet() {
    clear(sheet).append(...built.flatMap(({ e, qr }) => cardSheet((o) => idCard({ kind: 'employee', name: e.name, line: [e.jobTitle, e.center], code: e.code, qr, orientation: o }), 1, orient)));
  }

  async function preview() {
    if (!picked.size) { toast('حدّد موظفاً واحداً على الأقل', 'err'); return; }
    printBtn.disabled = true;
    clear(sheet).append(h('p', { class: 'loading' }, 'جارٍ تجهيز البطاقات…'));
    try {
      const r = await get(`/api/employees/cards?ids=${[...picked].join(',')}`);
      built = await Promise.all(r.cards.map(async (c) => ({ e: c, qr: await qrSvg(c.card) })));
      missing.hidden = !r.missing.length;
      clear(missing).append(`لا بطاقة سارية لـ ${r.missing.length}: ${r.missing.map((m) => m.name).join('، ')}. أصدر لهم بطاقة من صفحة كل موظف ثم أعد المعاينة.`);
      drawSheet();
      printBtn.disabled = !built.length;
      if (!built.length) clear(sheet);
    } catch (e) { toast(e.message, 'err'); clear(sheet); }
  }

  drawList();
  return h('div', { class: 'page print-page' },
    h('header', { class: 'page-head no-print' }, h('div', null, h('a', { href: '#/employees', class: 'back' }, 'الموظفون'), h('h1', null, 'طباعة بطاقات الموظفين'))),
    h('section', { class: 'panel no-print' },
      h('div', { class: 'tools' },
        h('input', { type: 'search', class: 'search', placeholder: 'بحث بالاسم أو الكود أو القسم', 'aria-label': 'بحث', oninput: (e) => { q = e.target.value.trim(); drawList(); } }),
        select([['', 'كل المراكز'], ...centers.map((c) => [c, c])], '', { 'aria-label': 'المركز', onchange: (e) => { center = e.target.value; drawList(); } }),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { visible().forEach((e) => picked.add(e.id)); drawList(); } }, 'تحديد المعروضين'),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { picked.clear(); drawList(); } }, 'إلغاء التحديد')),
      listBox, info,
      h('div', { class: 'row-actions' },
        select(ORIENT_OPTIONS, 'landscape', { 'aria-label': 'اتجاه البطاقة', onchange: (e) => { orient = e.target.value; if (built.length) drawSheet(); } }),
        h('button', { type: 'button', class: 'btn', onclick: preview }, 'معاينة البطاقات'), printBtn)),
    missing, sheet);
}
