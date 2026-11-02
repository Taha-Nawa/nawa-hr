// نموذج الطباعة: يطابق شكل النماذج الورقية المعتمدة (طلب إجازة / إذن مغادرة / إذن تأخير)
// وتُعبَّأ بياناته من الطلب، وتترك خانات التوقيع فارغة ليوقّع عليها الموظف والمسؤول يدوياً.
import { h, icon } from '../dom.js';
import { get } from '../api.js';
import { KIND, purposeLabels, fmtDate, fmtDays, fmtMinutes } from '../requests-lib.js';

const pf = (label, value, cls = '') => h('div', { class: `pf ${cls}`.trim() }, h('span', { class: 'pl' }, label), h('span', { class: 'pv' }, value || ''));
const band = (text) => h('div', { class: 'pband' }, text);
const cb = (on, text, extra) => h('div', { class: 'pcb' }, h('i', { class: `box${on ? ' on' : ''}`, 'aria-hidden': 'true' }), h('span', null, text), extra || null);

const A4_PX = (210 * 96) / 25.4; // عرض الورقة بالبكسل (المليمتر ثابت في CSS)

/** على الشاشات الضيقة تُصغَّر الورقة كاملة للمعاينة فقط؛ الطباعة دائماً بالحجم الحقيقي (انظر @media print). */
function fitToScreen(frame) {
  const apply = () => frame.style.setProperty('--fit', String(Math.min(1, (frame.clientWidth || A4_PX) / A4_PX).toFixed(4)));
  if (typeof ResizeObserver === 'function') new ResizeObserver(apply).observe(frame);
  else window.addEventListener('resize', apply);
  requestAnimationFrame(apply);
}

/** Sakkal Majalla خط مايكروسوفت: نكتشف وجوده بقياس العرض مقابل خط احتياطي. */
function hasMajalla() {
  try {
    const c = document.createElement('canvas').getContext('2d');
    const w = (font) => { c.font = font; return c.measureText('جمعية نوى للثقافة والفنون 0123').width; };
    return ['serif', 'monospace'].some((f) => w(`40px "Sakkal Majalla", ${f}`) !== w(`40px ${f}`));
  } catch {
    return true;
  }
}

const fontNote = () => hasMajalla() ? null
  : h('div', { class: 'notice no-print' }, 'خط النموذج الأصلي (Sakkal Majalla) غير مثبّت على هذا الجهاز، فيُستعمل خط قريب بحجم مكافئ. للحصول على الخط نفسه اطبع من جهاز ويندوز أو فيه Microsoft Office.');

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
    h('div', { class: 'pf wide tall' }, h('span', { class: 'pl' }, isLeave ? 'الغرض من الإجازة:' : `الغرض من ${word}:`),
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
        h('span', null, isLeave ? `المحتسب: ${fmtDays(r.days)}` : `المحتسب: ${fmtMinutes(r.minutes)}`))));

  const statusNote = approved ? null
    : h('div', { class: 'notice notice-warn no-print' }, rejected ? 'هذا الطلب مرفوض؛ تُطبع خانة «لا أوافق» مع السبب.' : r.status === 'pending' ? 'هذا الطلب لم يُعتمد بعد؛ تُطبع خانة موافقة المسؤول فارغة ليعبّئها المسؤول بخطّ يده، أو اعتمده أولاً من صفحة الطلبات.' : 'هذا الطلب ملغى.');

  const frame = h('div', { class: 'paper-frame' }, h('div', { class: 'paper-sheet' }, paper));
  fitToScreen(frame);

  return h('div', { class: 'page print-page' },
    h('header', { class: 'page-head no-print' },
      h('div', null, h('a', { href: '#/requests', class: 'back' }, 'كل الطلبات'), h('h1', null, `${KIND[r.kind].label} #${r.id}`)),
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => window.print() }, icon('printer'), 'طباعة'))),
    statusNote,
    fontNote(),
    frame);
}
