// نموذج الطباعة: يطابق شكل النماذج الورقية المعتمدة (طلب إجازة / إذن مغادرة / إذن تأخير)
// وتُعبَّأ بياناته من الطلب، وتترك خانات التوقيع فارغة ليوقّع عليها الموظف والمسؤول يدوياً.
import { h, icon } from '../dom.js';
import { get } from '../api.js';
import { KIND, purposeLabels, fmtDate, fmtDays, fmtMinutes } from '../requests-lib.js';

const pf = (label, value, cls = '') => h('div', { class: `pf ${cls}`.trim() }, h('span', { class: 'pl' }, label), h('span', { class: 'pv' }, value || ''));
const band = (text) => h('div', { class: 'pband' }, text);
const cb = (on, text, extra) => h('div', { class: 'pcb' }, h('i', { class: `box${on ? ' on' : ''}`, 'aria-hidden': 'true' }), h('span', null, text), extra || null);

export default async function render({ params }) {
  const { request: r } = await get(`/api/requests/${Number(params.id)}`);
  const isLeave = r.kind === 'leave';
  const word = { leave: 'الاجازة', exit: 'المغادرة', late: 'التأخير' }[r.kind];
  const labels = purposeLabels(r.kind);
  const approved = r.status === 'approved';
  const rejected = r.status === 'rejected';

  const purposes = ['annual', 'emergency', 'sick'].map((p) => cb(r.purpose === p, labels[p]));
  purposes.push(cb(r.purpose === 'other', 'أخرى ، حدد:', h('span', { class: 'pline' }, r.purpose === 'other' ? r.purposeOther : '')));

  const period = isLeave
    ? [pf('تاريخ بدء الاجازة:', fmtDate(r.fromDate)), pf('تاريخ انتهاء الاجازة:', fmtDate(r.toDate)), pf('مدة الاجازة:', fmtDays(r.days))]
    : [pf('التاريخ:', fmtDate(r.fromDate)), pf('من الساعة:', r.fromTime), pf('حتى الساعة:', r.toTime), pf(`مدة ${word}:`, fmtMinutes(r.minutes))];

  const grantText = isLeave ? 'أوافق على منحه الاجازة ابتداء من تاريخ' : `أوافق على منحه مدة ${word === 'المغادرة' ? 'للمغادرة' : 'للتأخير'} ابتداء من الساعة`;
  const denyText = isLeave ? 'لا أوافق على منحه الاجازة' : `لا أوافق على منحه مدة ${word === 'المغادرة' ? 'للمغادرة' : 'للتأخير'}`;
  const from = isLeave ? fmtDate(r.fromDate) : r.fromTime;

  const paper = h('article', { class: 'paper' },
    h('header', { class: 'phead' }, h('img', { src: '/logo.png', alt: 'جمعية نوى للثقافة والفنون' }), h('h2', null, KIND[r.kind].label)),
    h('div', { class: 'pgrid' },
      pf('الاسم:', r.employeeName), pf('التاريخ:', fmtDate(r.requestDate)),
      pf('الوظيفة:', r.jobTitle), pf('الرقم الوظيفي:', r.employeeCode),
      pf('مكان العمل:', r.center)),
    band(isLeave ? 'نوع الاجازة والغرض منها:' : `الغرض من ${word}:`),
    h('div', { class: 'pchecks' }, purposes),
    pf(isLeave ? 'الغرض من الإجازة:' : `الغرض من ${word}:`, r.reason, 'wide tall'),
    band(`مدة ${word}:`),
    h('div', { class: 'pgrid' }, period),
    h('div', { class: 'psign' }, pf('الاسم:', r.employeeName), pf('التوقيع والتاريخ:', '')),
    band('موافقة المسؤول/ة:'),
    h('div', { class: 'pchecks one' },
      cb(approved, grantText, h('span', { class: 'pline' }, approved ? from : '')),
      cb(rejected, denyText)),
    pf('السبب:', rejected ? r.decisionNote : '', 'wide'),
    h('div', { class: 'psign' }, pf('الاسم:', approved || rejected ? r.decidedByName || r.decidedBy : ''), pf('التوقيع والتاريخ:', '')),
    h('footer', { class: 'pfoot' },
      h('span', null, `طلب رقم ${r.id}`),
      approved && r.leaveType ? h('span', null, `النوع في السجل: ${r.leaveType}`) : null,
      h('span', null, isLeave ? `المحتسب: ${fmtDays(r.days)}` : `المحتسب: ${fmtMinutes(r.minutes)}`)));

  const statusNote = approved ? null
    : h('div', { class: 'notice notice-warn no-print' }, rejected ? 'هذا الطلب مرفوض؛ تُطبع خانة «لا أوافق» مع السبب.' : r.status === 'pending' ? 'هذا الطلب لم يُعتمد بعد؛ تُطبع خانة موافقة المسؤول فارغة ليعبّئها المسؤول بخطّ يده، أو اعتمده أولاً من صفحة الطلبات.' : 'هذا الطلب ملغى.');

  return h('div', { class: 'page print-page' },
    h('header', { class: 'page-head no-print' },
      h('div', null, h('a', { href: '#/requests', class: 'back' }, 'كل الطلبات'), h('h1', null, `${KIND[r.kind].label} #${r.id}`)),
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => window.print() }, icon('printer'), 'طباعة'))),
    statusNote,
    h('div', { class: 'paper-frame' }, paper));
}
