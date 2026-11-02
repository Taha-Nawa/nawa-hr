// نموذج الطباعة: يطابق شكل النماذج الورقية المعتمدة (طلب إجازة / إذن مغادرة / إذن تأخير)
// وتُعبَّأ بياناته من الطلب، وتترك خانات التوقيع فارغة ليوقّع عليها الموظف والمسؤول يدوياً.
import { h, icon } from '../dom.js';
import { get } from '../api.js';
import { KIND, kindOf, purposeLabels, fmtDate, fmtDays, fmtMinutes } from '../requests-lib.js';
import { fmt12 } from '../time12.js';
import { fitToScreen, fontNote } from '../print-ui.js';

const pf = (label, value, cls = '') => h('div', { class: `pf ${cls}`.trim() }, h('span', { class: 'pl' }, label), h('span', { class: 'pv' }, value || ''));
const band = (text) => h('div', { class: 'pband' }, text);
const cb = (on, text, extra) => h('div', { class: 'pcb' }, h('i', { class: `box${on ? ' on' : ''}`, 'aria-hidden': 'true' }), h('span', null, text), extra || null);

export default async function render({ params }) {
  const { request: r } = await get(`/api/requests/${Number(params.id)}`);
  const isLeave = r.kind === 'leave';
  const word = r.mission ? 'المهمة' : { leave: 'الاجازة', exit: 'المغادرة', late: 'التأخير' }[r.kind];
  const labels = purposeLabels(r.kind);
  const approved = r.status === 'approved';
  const rejected = r.status === 'rejected';

  // المهمة على نموذج الإجازة نفسه: خانة واحدة مؤشَّرة بدل خانات أنواع الإجازة
  const purposes = r.mission ? [cb(true, 'مهمة عمل')] : ['annual', 'emergency', 'sick'].map((p) => cb(r.purpose === p, labels[p]));
  if (!r.mission) purposes.push(cb(r.purpose === 'other', 'أخرى ، حدد:', h('span', { class: 'pline' }, r.purpose === 'other' ? r.purposeOther : '')));

  const period = isLeave
    ? [pf(`تاريخ بدء ${word}:`, fmtDate(r.fromDate)), pf(`تاريخ انتهاء ${word}:`, fmtDate(r.toDate)), pf(`مدة ${word}:`, fmtDays(r.days))]
    : [pf('التاريخ:', fmtDate(r.fromDate)), pf('من الساعة:', fmt12(r.fromTime)), pf('حتى الساعة:', fmt12(r.toTime)), pf(`مدة ${word}:`, fmtMinutes(r.minutes))];

  const grantText = r.mission ? 'أوافق على اعتماد المهمة ابتداء من تاريخ' : isLeave ? 'أوافق على منحه الاجازة ابتداء من تاريخ' : `أوافق على منحه مدة ${word === 'المغادرة' ? 'للمغادرة' : 'للتأخير'} ابتداء من الساعة`;
  const denyText = r.mission ? 'لا أوافق على اعتماد المهمة' : isLeave ? 'لا أوافق على منحه الاجازة' : `لا أوافق على منحه مدة ${word === 'المغادرة' ? 'للمغادرة' : 'للتأخير'}`;
  const from = isLeave ? fmtDate(r.fromDate) : fmt12(r.fromTime);

  const paper = h('article', { class: 'paper' },
    h('header', { class: 'phead' }, h('img', { src: '/logo.png', alt: 'جمعية نوى للثقافة والفنون' }), h('h2', null, KIND[kindOf(r)].label)),
    h('div', { class: 'pgrid' },
      pf('الاسم:', r.employeeName), pf('التاريخ:', fmtDate(r.requestDate)),
      pf('الوظيفة:', r.jobTitle), pf('الرقم الوظيفي:', r.employeeCode),
      pf('مكان العمل:', r.center)),
    band(r.mission ? 'نوع الطلب:' : isLeave ? 'نوع الاجازة والغرض منها:' : `الغرض من ${word}:`),
    h('div', { class: 'pchecks' }, purposes),
    h('div', { class: 'pf wide tall' }, h('span', { class: 'pl' }, r.mission ? 'مكان المهمة والغرض منها:' : isLeave ? 'الغرض من الإجازة:' : `الغرض من ${word}:`),
      h('span', { class: 'pv' }, h('span', { class: 'pln' }, r.reason || ''), h('span', { class: 'pln' }))),
    band(`مدة ${word}:`),
    h('div', { class: 'pgrid' }, period),
    h('div', { class: 'psign' }, pf('الاسم:', r.employeeName), pf('التوقيع والتاريخ:', '')),
    h('div', { class: 'pgap' }),
    h('div', { class: 'pbold' }, 'موافقة المسؤول/ة:'),
    h('div', { class: 'pchecks one' },
      cb(approved, grantText, h('span', { class: 'pline' }, approved ? from : '')),
      cb(rejected, denyText)),
    pf('السبب:', rejected ? r.decisionNote : '', 'wide'),
    h('div', { class: 'psign' }, pf('الاسم:', approved || rejected ? r.decidedByName || r.decidedBy : ''), pf('التوقيع والتاريخ:', '')),
    h('footer', { class: 'pfoot' },
      h('span', null, 'صفحة | 1'),
      h('span', { class: 'pmeta' },
        h('span', null, `طلب رقم ${r.id}`),
        approved && r.leaveType ? h('span', null, `النوع في السجل: ${r.leaveType}`) : null,
        r.medicalBy ? h('span', null, 'ورقة طبية: مؤكَّدة') : null,
        h('span', null, isLeave ? `المحتسب: ${fmtDays(r.days)}` : `المحتسب: ${fmtMinutes(r.minutes)}`))));

  const statusNote = approved ? null
    : h('div', { class: 'notice notice-warn no-print' }, rejected ? 'هذا الطلب مرفوض؛ تُطبع خانة «لا أوافق» مع السبب.' : r.status === 'pending' ? 'هذا الطلب لم يُعتمد بعد؛ تُطبع خانة موافقة المسؤول فارغة ليعبّئها المسؤول بخطّ يده، أو اعتمده أولاً من صفحة الطلبات.' : 'هذا الطلب ملغى.');

  const frame = h('div', { class: 'paper-frame' }, h('div', { class: 'paper-sheet' }, paper));
  fitToScreen(frame);

  return h('div', { class: 'page print-page' },
    h('header', { class: 'page-head no-print' },
      h('div', null, h('a', { href: '#/requests', class: 'back' }, 'كل الطلبات'), h('h1', null, `${KIND[kindOf(r)].label} #${r.id}`)),
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => window.print() }, icon('printer'), 'طباعة'))),
    statusNote,
    fontNote(),
    frame);
}
