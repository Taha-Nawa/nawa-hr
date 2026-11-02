// كشف حضور وغياب المتطوع الشهري للطباعة (يطابق نموذج «كشف حضور وغياب / جمعية نوى للثقافة والفنون»).
import { h, icon, AR_DAYS } from '../dom.js';
import { get } from '../api.js';
import { fitToScreen, fontNote } from '../print-ui.js';
import { printableDays, compact12, totalsOf } from '../sheet-lib.js';
import { monthLabel } from './volunteers.js';

const pf = (label, value, cls = '') => h('div', { class: `pf ${cls}`.trim() }, h('span', { class: 'pl' }, label), h('span', { class: 'pv' }, value || ''));
const dmy = (date) => `${date.slice(8)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
const COLS = [['اليوم', 'c-day'], ['التاريخ', 'c-date'], ['ساعة الوصول', 'c-time'], ['ساعة الانصراف', 'c-time'], ['التوقيع', 'c-sign'], ['ساعة المغادرة', 'c-time'], ['ساعة الوصول', 'c-time'], ['السبب', 'c-why']];

export default async function render({ params }) {
  const { volunteer: v, days, month } = await get(`/api/volunteers/${Number(params.id)}/month?month=${params.month}`);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const t = totalsOf(days);

  const body = printableDays(month, days).map(({ date, dow }) => {
    const d = byDate.get(date) || {};
    return h('tr', { class: dow === 5 ? 'off' : '' },
      h('td', null, AR_DAYS[dow]), h('td', null, dmy(date)),
      h('td', null, compact12(d.arrive)), h('td', null, compact12(d.depart)), h('td'),
      h('td', null, compact12(d.exit)), h('td', null, compact12(d.ret)), h('td', null, d.reason || ''));
  });

  const paper = h('article', { class: 'paper vol-paper' },
    h('header', { class: 'phead' }, h('img', { src: '/logo.png', alt: 'جمعية نوى للثقافة والفنون' }), h('h2', null, 'كشف حضور وغياب / جمعية نوى للثقافة والفنون')),
    h('p', { class: 'vol-month' }, `لشهر ${monthLabel(month)}`),
    h('div', { class: 'vol-ident' }, pf('الاسم /', v.name), pf('المركز:', v.center), v.project ? pf('المشروع:', v.project) : null),
    h('table', { class: 'vol-tbl' }, h('thead', null, h('tr', null, COLS.map(([x, c]) => h('th', { class: c }, x)))), h('tbody', null, body)),
    t.days ? h('p', { class: 'vol-total' }, `إجمالي الشهر: ${t.days} يوم حضور — ${t.hours} ساعة`) : null,
    h('div', { class: 'vol-foot' },
      h('div', { class: 'col' }, pf('الاسم :', v.name), pf('التوقيع :', '')),
      h('div', { class: 'col' }, pf('منسق المشروع :', v.coordinator), pf('التوقيع :', ''))));

  const frame = h('div', { class: 'paper-frame' }, h('div', { class: 'paper-sheet' }, paper));
  fitToScreen(frame);
  return h('div', { class: 'page print-page' },
    h('header', { class: 'page-head no-print' },
      h('div', null, h('a', { href: `#/volunteers/${v.id}/${month}`, class: 'back' }, 'إدخال الحضور'), h('h1', null, `كشف ${v.name}`), h('p', { class: 'sub' }, monthLabel(month))),
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => window.print() }, icon('printer'), 'طباعة'))),
    fontNote(),
    frame);
}
