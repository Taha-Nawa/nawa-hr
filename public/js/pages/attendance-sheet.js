// كشف الحضور والانصراف الأسبوعي للطباعة: يطابق النموذج الورقي (أسبوع السبت ← الخميس، دخول/خروج/مغادرة لكل يوم،
// 16 موظفاً في الصفحة). يُعبَّأ من نتائج الحضور في النظام، أو يُطبع فارغاً للتعبئة اليدوية في مراكز بلا بوابة.
import { h, clear, icon, todayLocal, addDays, AR_DAYS } from '../dom.js';
import { get } from '../api.js';
import { fitToScreen, fontNote } from '../print-ui.js';
import { weekStart, weekDates, paginate, groupByCenter, cellFor, compact12 } from '../sheet-lib.js';

const DAY_ORDER = [6, 0, 1, 2, 3, 4]; // السبت … الخميس
const dayLabel = (date) => AR_DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
const shortDate = (date) => `${Number(date.slice(8))}/${Number(date.slice(5, 7))}`;
const SUBS = ['دخول', 'خروج', 'مغادرة'];

const t = (v) => (v ? h('span', { class: 'sh-t' }, compact12(v)) : null);

function dayCells(cell) {
  if (cell.kind === 'label') return [h('td', { class: 'sh-label', colspan: 3 }, cell.text)];
  if (cell.kind === 'blank') return [h('td'), h('td'), h('td')];
  return [
    h('td', null, t(cell.in)),
    h('td', null, t(cell.out), t(cell.ret)),
    h('td', null, t(cell.dep)),
  ];
}

function pageEl({ center, rows, dates, today, filled, from, to, no, of }) {
  const head1 = h('tr', null, h('th', { rowspan: 2, class: 'sh-name' }, 'اسم الموظف/ة'),
    dates.map((d) => h('th', { colspan: 3, class: 'sh-day' }, dayLabel(d), h('small', null, ` ${shortDate(d)}`))));
  const head2 = h('tr', { class: 'sh-sub' }, dates.map(() => SUBS.map((s) => h('th', null, s))));
  const body = rows.map((e) => h('tr', null,
    h('td', { class: 'sh-nm' }, e ? e.name : ''),
    dates.flatMap((d) => dayCells(e && filled ? cellFor(e.days[d], d, today, true) : { kind: 'blank' }))));

  return h('article', { class: 'paper sheet-paper' },
    h('header', { class: 'sh-head' },
      h('img', { src: '/logo.png', alt: 'جمعية نوى للثقافة والفنون' }),
      h('h2', null, 'كشف الحضور والانصراف'),
      h('div', { class: 'sh-meta' },
        h('span', null, h('b', null, 'الأسبوع: '), 'من ', h('i', { class: 'sh-fill' }, shortDate(from)), ' إلى ', h('i', { class: 'sh-fill' }, shortDate(to))),
        h('span', null, h('b', null, 'المركز: '), h('i', { class: 'sh-fill wide' }, center || '')),
        h('span', null, h('b', null, 'التاريخ: '), h('i', { class: 'sh-fill' }, today)),
        h('span', null, h('b', null, 'رقم الصفحة: '), h('i', { class: 'sh-fill sm' }, `${no} من ${of}`)))),
    h('table', { class: 'sh-tbl' }, h('thead', null, head1, head2), h('tbody', null, body)),
    h('footer', { class: 'pfoot' }, h('span', null, `صفحة | ${no}`),
      h('span', { class: 'pmeta' }, filled ? 'خانة الخروج: وقت الخروج ثم وقت العودة إن وُجدت' : '')));
}

export default async function render() {
  const today = todayLocal();
  let start = weekStart(today);
  let center = '';
  let filled = true;
  let centers = [];
  try {
    centers = (await get('/api/centers')).centers.filter((c) => c.active);
  } catch {
    /* القائمة اختيارية */
  }

  const dateInput = h('input', { type: 'date', 'aria-label': 'أي يوم من الأسبوع', value: start, onchange: (e) => e.target.value && go(weekStart(e.target.value)) });
  const centerSel = h('select', { 'aria-label': 'المركز', onchange: (e) => { center = e.target.value; go(start); } },
    h('option', { value: '' }, 'كل المراكز'), centers.map((c) => h('option', { value: c.id }, c.name)));
  const blankChk = h('input', { type: 'checkbox', onchange: (e) => { filled = !e.target.checked; go(start); } });
  const sub = h('p', { class: 'sub' });
  const printBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => window.print() }, icon('printer'), 'طباعة');
  const stage = h('div', { class: 'sheet-stage' });

  async function go(s) {
    start = s;
    dateInput.value = s;
    const dates = weekDates(s);
    const to = dates[5];
    sub.textContent = `من ${s} إلى ${to} (السبت ← الخميس)`;
    clear(stage).append(h('p', { class: 'loading' }, 'جارٍ التحميل…'));
    printBtn.disabled = true;
    let employees;
    try {
      employees = (await get(`/api/attendance/sheet?from=${s}&to=${to}${center ? `&center=${center}` : ''}`)).employees;
    } catch (e) {
      clear(stage).append(h('div', { class: 'notice notice-err' }, e.message));
      return;
    }
    if (!employees.length) {
      clear(stage).append(h('p', { class: 'empty' }, 'لا موظفين في هذا النطاق.'));
      return;
    }
    const pages = groupByCenter(employees).flatMap((g) => paginate(g.list).map((rows) => ({ center: g.center, rows })));
    const frame = h('div', { class: 'paper-frame land' },
      h('div', { class: 'paper-sheet' }, pages.map((p, i) => pageEl({ ...p, dates, today, filled, from: s, to, no: i + 1, of: pages.length }))));
    fitToScreen(frame, 297);
    clear(stage).append(frame);
    printBtn.disabled = false;
  }

  const page = h('div', { class: 'page print-page' },
    h('header', { class: 'page-head no-print' },
      h('div', null, h('h1', null, 'كشف الحضور الأسبوعي'), sub),
      h('div', { class: 'row-actions' }, printBtn)),
    h('div', { class: 'tools no-print' },
      h('button', { type: 'button', class: 'btn', onclick: () => go(addDays(start, -7)) }, 'الأسبوع السابق'),
      dateInput,
      h('button', { type: 'button', class: 'btn', onclick: () => go(addDays(start, 7)) }, 'الأسبوع التالي'),
      centerSel,
      h('label', { class: 'check-inline' }, blankChk, 'نموذج فارغ للتعبئة اليدوية')),
    fontNote(),
    h('div', { class: 'notice no-print' }, 'اختر «اطبع» ثم اجعل اتجاه الورقة أفقياً (يُضبط تلقائياً في أغلب المتصفحات). الأوقات من نتائج النظام ويمكن تعديلها من «الحضور اليدوي».'),
    stage);
  await go(start);
  return page;
}
