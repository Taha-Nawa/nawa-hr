// معاينة التايم شيت الشهري كما سيُطبع: نسخة HTML من شيت «October» في ملف الإدارة (الشعار فوق العنوان، الجمعة والسبت مظلَّلان،
// خطوط 920000، ساعات بمنزلة عشرية)، لتُراجع على الشاشة ثم تُطبع A4 أفقياً.
import { h } from './dom.js';
import { employeeNumber, SIGN_ROLES } from './timesheet-sheet.js';

const fmt = (v) => (typeof v === 'number' && Number.isFinite(v) ? (Math.round(v * 10) / 10).toFixed(1) : '');
const COLS = 34; // A B C + 31 يوماً

const td = (text, cls, span = 1) => h('td', { class: cls || null, colspan: span > 1 ? span : null }, text ?? '');

/** صف حقول الترويسة: تسمية | قيمة بخط أحمر | فراغ | تسمية | قيمة | فراغ (أعمدة 2+10+1+5+12+4). */
function infoRow(l1, v1, l2, v2) {
  return h('tr', { class: 'ts-r' },
    td(l1, 'ts-lbl', 2), td(v1, 'ts-val', 10), td('', null, 1), td(l2, 'ts-lbl', 5), td(v2, 'ts-val', 12), td('', null, 4));
}

/**
 * @param {object} ts    ناتج buildTimesheet
 * @param {{name:string,code:string,post:string,place:string,supervisor:string,approver:string}} info
 */
export function timesheetPaper(ts, info) {
  const off = (i) => Boolean(ts.off?.[i]);
  const dayTds = (values, extra = '') => Array.from({ length: 31 }, (_, i) =>
    h('td', { class: `ts-d${off(i) ? ' off' : ''}${extra}` }, i < ts.daysInMonth ? fmt(values[i]) : ''));

  const rows = [];
  rows.push(h('tr', { class: 'ts-logo' }, h('td', { colspan: COLS }, h('img', { src: '/logo.png', alt: 'جمعية نوى للثقافة والفنون' }))));
  rows.push(h('tr', { class: 'ts-r' }, td('', null, COLS)));
  rows.push(h('tr', { class: 'ts-r' }, h('td', { colspan: COLS, class: 'ts-title' }, 'Monthly Timesheet')));
  rows.push(h('tr', { class: 'ts-r' }, td('', null, COLS)));
  rows.push(infoRow('Name:', info.name, 'Employee Number :', employeeNumber(info.code)));
  rows.push(infoRow('Post:', info.post, 'Month :', ts.monthName));
  rows.push(infoRow('Place of Work:', info.place, 'Year :', ts.year));
  rows.push(h('tr', { class: 'ts-r' }, td('', null, COLS)));

  rows.push(h('tr', { class: 'ts-r ts-hd' },
    td('Item', 'ts-h'), td('Cost Center', 'ts-h'), td('Work Hours', 'ts-h'),
    Array.from({ length: 31 }, (_, i) => h('td', { class: `ts-d ts-dn${off(i) ? ' off' : ''}` }, i + 1))));

  const funders = ts.funders.length ? ts.funders : [null];
  for (const f of funders) {
    rows.push(h('tr', { class: 'ts-r' },
      td(f?.funder || '', 'ts-item'), td(f ? `${Math.round(f.costCenter * 100)}%` : '', 'ts-c'), td(f ? fmt(f.total) : '', 'ts-c fill'), dayTds(f ? f.values : [])));
  }
  for (const row of [ts.official, ts.annual, ts.sick, ts.emergency, ts.others, ts.unpaid]) {
    rows.push(h('tr', { class: 'ts-r' }, td(row.label, 'ts-item'), td('', 'ts-c'), td(fmt(row.total), 'ts-c fill'), dayTds(row.values)));
  }
  rows.push(h('tr', { class: 'ts-r' }, td('Total', 'ts-tot', 2), td(fmt(ts.total.total), 'ts-c fill'), dayTds(ts.total.values)));
  rows.push(h('tr', { class: 'ts-r' }, td('', null, COLS)));

  rows.push(h('tr', { class: 'ts-r' }, td('', 'ts-bx fill', 4), td('Name', 'ts-bx fill', 15), td('Date & Signature', 'ts-bx fill', 15)));
  const names = [info.name, info.supervisor, info.approver];
  SIGN_ROLES.forEach((role, i) => {
    rows.push(h('tr', { class: `ts-r${i === 2 ? ' tall' : ''}` }, td(role, 'ts-bx fill', 4), td(names[i] || '', 'ts-bx', 15), td('Date:', 'ts-bx hint', 7), td('Signature:', 'ts-bx hint', 8)));
  });

  const cols = [168, 55, 52, ...Array(31).fill(35)].map((w) => h('col', { style: { width: `${w}px` } }));
  return h('article', { class: 'ts-paper' },
    h('div', { class: 'ts-fit' }, h('table', { class: 'ts-tbl' }, h('colgroup', null, cols), h('tbody', null, rows))));
}
