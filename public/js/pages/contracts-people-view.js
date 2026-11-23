// تبويب «مزوّدو الخدمات» داخل العقود: شخص واحد في سطر مع عقوده ومستحقاته وتنبيهاته.
import { h } from '../dom.js';
import { money } from '../contracts-lib.js';
import { buildPeople, personFlags, PPL_COLS } from '../contracts-people.js';
import { xlsxBlob } from '../contract-export.js';
import { saveBlob } from './contract-actions.js';

const dmy = (s) => (s ? s.split('-').reverse().join('/') : '—');

export function drawPeople(rows, go, initialMode = '') {
  const all = Object.values(buildPeople(rows)).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  let q = '';
  let mode = initialMode;
  const ov = all.reduce((a, p) => a + p.overlaps.length, 0);
  const tile = (k, v, s, accent, onclick) => h(onclick ? 'button' : 'div', { class: `ct-tile${accent ? ' accent' : ''}${onclick ? ' link' : ''}`, ...(onclick ? { type: 'button', onclick } : {}) }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, String(v)), h('div', { class: 's' }, s));
  const body = h('div', { class: 'table-wrap' });
  const filtered = () => all.filter((p) => {
    if (mode === 'multi' && p.recs.length < 2) return false;
    if (mode === 'flag' && !personFlags(p).length) return false;
    if (mode === 'overlap' && !p.overlaps.length) return false;
    if (mode === 'name' && !p.altNames.length) return false;
    if (q && !`${p.name} ${p.idno} ${p.phone || ''}`.includes(q)) return false;
    return true;
  });
  function draw() {
    const rs = filtered();
    if (!rs.length) { body.replaceChildren(h('p', { class: 'empty' }, 'لا يوجد مزوّدو خدمات مطابقون.')); return; }
    body.replaceChildren(h('table', { class: 'tbl ct-list' },
      h('thead', null, h('tr', null, ['م', 'الاسم', 'رقم الهوية', 'الجوال', 'التخصص', 'العقود', 'المشاريع', 'إجمالي المستحق', 'آخر عقد', 'تنبيهات', ''].map((t) => h('th', null, t)))),
      h('tbody', null, rs.map((p, i) => { const fl = personFlags(p); return h('tr', { class: fl.length ? 'rowflag' : '' },
        h('td', null, i + 1), h('td', null, h('strong', null, p.name)), h('td', { dir: 'ltr', class: 'ltr-cell' }, p.idno), h('td', { dir: 'ltr', class: 'ltr-cell' }, p.phone || ''),
        h('td', null, p.major || ''), h('td', null, p.recs.length), h('td', null, p.projects.length), h('td', null, money(p.total)), h('td', null, p.last ? dmy(p.last) : '—'),
        h('td', null, fl.length ? h('span', { class: 'chip chip-late', title: fl.map((x) => x.m).join('\n') }, `${fl.length} تنبيه`) : h('span', { class: 'chip chip-present' }, 'سليم')),
        h('td', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => go({ q: p.idno }) }, 'عقوده'))); }))));
  }
  const set = (m) => () => { mode = m; sel.value = m; draw(); };
  const sel = h('select', { 'aria-label': 'تصفية', value: mode, onchange: (e) => { mode = e.target.value; draw(); } },
    [['', 'الكل'], ['multi', 'من له أكثر من عقد'], ['flag', 'فيه تنبيه يحتاج مراجعة'], ['overlap', 'تداخل في فترات التنفيذ'], ['name', 'اختلاف في كتابة الاسم']]  .map(([v, t]) => h('option', { value: v, selected: v === mode }, t)));
  const el = h('div', { class: 'ct-dash' },
    h('div', { class: 'ct-tiles' },
      tile('مزوّدو الخدمات', all.length, 'شخص في السجل', true, set('')),
      tile('من له أكثر من عقد', all.filter((p) => p.recs.length > 1).length, 'يستحق متابعة المستحقات', false, set('multi')),
      tile('تداخل في الفترات', ov, ov ? 'يحتاج مراجعة' : 'لا يوجد', !!ov, set('overlap')),
      tile('اختلاف كتابة الاسم', all.filter((p) => p.altNames.length).length, 'توحيد مطلوب', false, set('name')),
      tile('إجمالي المستحقات', money(all.reduce((a, p) => a + p.total, 0)), 'لكل العقود', true)),
    h('div', { class: 'tools' },
      h('input', { type: 'search', class: 'search', placeholder: 'بحث بالاسم أو رقم الهوية…', 'aria-label': 'بحث', oninput: (e) => { q = e.target.value.trim(); draw(); } }), sel,
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { const rs = filtered(); rs.forEach((p, i) => { p._i = i + 1; }); saveBlob(xlsxBlob(PPL_COLS, rs), 'مزوّدو الخدمات - جمعية نوى.xlsx'); } }, 'تصدير مزوّدي الخدمات Excel')),
    body);
  draw();
  return el;
}

/** بنود إضافية لـ«ما يحتاجك اليوم» */
export function peopleTodo(rows, open) {
  const all = Object.values(buildPeople(rows));
  return [
    { k: 'تداخل في فترات التنفيذ', c: all.filter((p) => p.overlaps.length).length, hot: 1, s: 'نفس الشخص متعاقد على فترتين متداخلتين — تأكد أن الأيام لم تُحتسب مرتين', go: () => open('overlap') },
    { k: 'اختلاف في كتابة الاسم', c: all.filter((p) => p.altNames.length).length, warm: 1, s: 'رقم هوية واحد مسجّل بأكثر من صيغة للاسم', go: () => open('name') },
  ];
}
