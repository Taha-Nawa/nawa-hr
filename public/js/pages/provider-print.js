// كشف حضور مزوّد الخدمة الشهري للطباعة والتوقيع: الأيام الفعلية فقط (حصص أو حركات)، والساعات المحتسبة والملاحظات.
import { h, icon, AR_DAYS } from '../dom.js';
import { get } from '../api.js';
import { fitToScreen, fontNote } from '../print-ui.js';
import { fmt12, fmtRange12 } from '../time12.js';
import { monthLabel } from './providers.js';
import { fmtMin, fmtHours, dmy, exitsText, dayNotes } from '../providers-lib.js';

const pf = (label, value, cls = '') => h('div', { class: `pf ${cls}`.trim() }, h('span', { class: 'pl' }, label), h('span', { class: 'pv' }, value || ''));
const COLS = [['التاريخ', 'c-date'], ['اليوم', 'c-day'], ['الحصة', 'c-sess'], ['الوصول', 'c-time'], ['الخروج ← العودة', 'c-exit'], ['الانصراف', 'c-time'], ['المحتسب', 'c-hrs'], ['ملاحظات', 'c-why']];

export default async function render({ params }) {
  const { provider: p, days, month, totals: t } = await get(`/api/providers/${Number(params.id)}/month?month=${params.month}`);
  const rows = days.filter((d) => !d.future);

  const body = rows.map((d) => {
    const notes = [...(d.status === 'absent' ? ['غائب'] : []), ...dayNotes(d)];
    return h('tr', { class: d.status === 'absent' ? 'off' : '' },
      h('td', null, dmy(d.date).slice(0, 5)), h('td', null, AR_DAYS[d.dow]),
      h('td', null, d.sessions.length ? d.sessions.map((s) => h('div', null, fmtRange12(s.start, s.end))) : '—'),
      h('td', null, d.arrive ? fmt12(d.arrive) : ''), h('td', null, exitsText(d.exits)), h('td', null, d.depart ? fmt12(d.depart) : ''),
      h('td', null, d.sessions.length ? fmtMin(d.countedMin) : ''), h('td', { class: 'left' }, notes.join(' · ')));
  });

  const paper = h('article', { class: 'paper vol-paper prov-paper' },
    h('header', { class: 'phead' }, h('img', { src: '/logo.png', alt: 'جمعية نوى للثقافة والفنون' }), h('h2', null, 'كشف حضور مزوّد خدمة / جمعية نوى للثقافة والفنون')),
    h('p', { class: 'vol-month' }, `لشهر ${monthLabel(month)}`),
    h('div', { class: 'vol-ident prov-ident' },
      pf('الاسم /', p.name), pf('الرمز:', p.code),
      pf('المركز:', p.center), pf('نوع الخدمة:', p.service),
      pf('المشروع:', p.project), pf('مدة العقد:', `${dmy(p.contractStart)} ← ${dmy(p.contractEnd)}`)),
    h('table', { class: 'vol-tbl prov-tbl' }, h('thead', null, h('tr', null, COLS.map(([x, c]) => h('th', { class: c }, x)))), h('tbody', null, body)),
    rows.length ? null : h('p', { class: 'vol-total' }, 'لا حصص ولا حركات في هذا الشهر.'),
    h('p', { class: 'vol-total' },
      `المجدول: ${fmtHours(t.scheduledHours)} س — المحتسب: ${fmtHours(t.countedHours)} س — أيام الحضور: ${t.attendedDays} من ${t.sessionDays}`
      + `${t.absentDays ? ` — أيام الغياب: ${t.absentDays}` : ''}${t.lateDays ? ` — أيام التأخر: ${t.lateDays} (${fmtMin(t.lateMin)})` : ''}${t.earlyDays ? ` — انصراف مبكر: ${t.earlyDays} أيام` : ''}`),
    h('p', { class: 'prov-rule' }, 'الساعات المحتسبة: زمن الوجود في المركز خلال الحصص المجدولة فقط. التأخر أو الانصراف المبكر ضمن 10 دقائق لا يُخصم.'),
    h('div', { class: 'vol-foot prov-foot' },
      h('div', { class: 'col' }, pf('المزوّد :', p.name), pf('التوقيع :', '')),
      h('div', { class: 'col' }, pf('المشرف المسؤول :', p.supervisor), pf('التوقيع :', '')),
      h('div', { class: 'col' }, pf('الموارد البشرية :', ''), pf('التوقيع :', ''))));

  const frame = h('div', { class: 'paper-frame' }, h('div', { class: 'paper-sheet' }, paper));
  fitToScreen(frame);
  return h('div', { class: 'page print-page' },
    h('header', { class: 'page-head no-print' },
      h('div', null, h('a', { href: `#/providers/${p.id}/${month}`, class: 'back' }, 'ملف المزوّد'), h('h1', null, `كشف ${p.name}`), h('p', { class: 'sub' }, monthLabel(month))),
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => window.print() }, icon('printer'), 'طباعة'))),
    fontNote(),
    frame);
}
