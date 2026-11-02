// التقارير الشهرية: قائمة الشهر لمن يراهم المستخدم (المدير المباشر، الموارد البشرية، المدير العام، المسؤول)،
// وللموظف تفتح تقريره مباشرة.
import { h, clear, icon, todayLocal, dash } from '../dom.js';
import { get } from '../api.js';
import { monthLabel, shiftMonthStr, defaultMonth, dmy } from '../monthly-report-lib.js';

let lastMonth = null;

export default async function render({ user }) {
  const today = todayLocal();
  let month = lastMonth || defaultMonth(today);
  const body = h('div', { class: 'table-wrap' });
  const head = h('header', { class: 'page-head' });
  const root = h('div', { class: 'page' }, head, body);
  let mine = null;

  async function load() {
    lastMonth = month;
    clear(body).append(h('p', { class: 'loading' }, 'جارٍ التحميل…'));
    let data;
    try {
      data = await get(`/api/monthly-reports?month=${month}`);
    } catch (e) {
      clear(body).append(h('div', { class: 'notice notice-err' }, e.message));
      return;
    }
    mine = data.mine;
    if (user.role === 'employee' && mine) { location.replace(`#/monthly-report/${mine}/${month}`); return; }
    drawHead(data.reports);
    if (!data.reports.length) { clear(body).append(h('p', { class: 'empty' }, 'لا موظفين ضمن صلاحياتك.')); return; }
    const done = data.reports.filter((r) => r.status === 'submitted').length;
    clear(body).append(
      h('p', { class: 'muted small' }, `قدّم ${done} من ${data.reports.length}. المسودات لا يراها غير أصحابها.`),
      h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['الموظف', 'المركز', 'الحالة', 'تاريخ التقديم', 'المهام', 'الاجتماعات', 'القادمة', 'ملاحظات المدير', ''].map((t, i) => h('th', { class: i >= 4 && i <= 6 ? 'num' : '' }, t)))),
        h('tbody', null, data.reports.map((r) => {
          const own = r.id === mine;
          const open = r.status !== null || own;
          const href = `#/monthly-report/${r.id}/${month}`;
          return h('tr', { class: r.status ? '' : 'row-off' },
            h('td', null, open ? h('a', { href, class: 'emp-link' }, r.name) : r.name, h('div', { class: 'code' }, [r.code, r.jobTitle].filter(Boolean).join(' · '))),
            h('td', { class: 'muted' }, dash(r.center)),
            h('td', null, r.status === 'submitted' ? h('span', { class: 'chip chip-present' }, 'مُقدَّم') : r.status === 'draft' ? h('span', { class: 'chip chip-late' }, 'مسودة') : h('span', { class: 'chip chip-none' }, 'لم يُقدَّم')),
            h('td', { class: 'muted' }, r.submitDate ? dmy(r.submitDate) : '—'),
            ...['tasks', 'meetings', 'next'].map((k) => h('td', { class: 'num' }, r.counts ? String(r.counts[k]) : '—')),
            h('td', { class: 'muted' }, r.hasNotes ? 'كُتبت' : '—'),
            h('td', { class: 'row-actions' }, open ? h('a', { href, class: 'btn btn-sm' }, own ? (r.status ? 'فتح تقريري' : 'ابدأ تقريري') : 'قراءة') : null));
        }))));
  }

  function drawHead() {
    clear(head).append(
      h('div', null, h('h1', null, 'التقرير الشهري'), h('p', { class: 'sub' }, `شهر ${monthLabel(month)}`)),
      h('div', { class: 'date-nav' },
        mine ? h('a', { class: 'btn btn-primary', href: `#/monthly-report/${mine}/${month}` }, icon('plus'), 'تقريري') : null,
        h('button', { type: 'button', class: 'btn', onclick: () => { month = shiftMonthStr(month, -1); load(); } }, 'الشهر السابق'),
        h('button', { type: 'button', class: 'btn', disabled: month >= today.slice(0, 7), onclick: () => { month = shiftMonthStr(month, 1); load(); } }, 'الشهر التالي')));
  }

  drawHead();
  await load();
  return root;
}
