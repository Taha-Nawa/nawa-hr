// التقرير الشهري للطباعة / حفظ PDF — مطابق لملف «التقرير الشهري» الأصلي (إكسل): نفس الترتيب والنصوص والخط والألوان والأحجام
// (انظر التعليق في app.css لمقياس الطباعة 49%). جدول واحد بخمسة أعمدة، ويتدفق على أكثر من صفحة إن طال.
import { h, icon } from '../dom.js';
import { get } from '../api.js';
import { fitToScreen, fontNote } from '../print-ui.js';
import { monthLabel, dmy, sortMeetings } from '../monthly-report-lib.js';

const cell = (tag, v, cls = '', extra = {}) => h(tag, { class: cls, ...extra }, v);
const td = (v, cls = '', extra = {}) => cell('td', v, cls, extra);
const th = (v, cls = '', extra = {}) => cell('th', v, cls, extra);
const heads = (cls, ...cols) => h('tr', { class: `mr-colhead ${cls}`.trim() }, cols.map(([text, span]) => th(text, '', span ? { colspan: span } : {})));
// أسطر البيانات: عند غياب بيانات يُطبع سطر فارغ واحد ليبقى الجدول مرئياً
const dataRows = (list, make) => (list.length ? list : [null]).map((x, i) => make(x, i));

export default async function render({ params }) {
  const d = await get(`/api/monthly-reports/${Number(params.id)}/${params.month}`);
  const { employee: e, report: r, month } = d;
  const meetings = sortMeetings(r.meetings);
  const att = r.attachments;
  const attRows = Math.max(3, att.length);

  const rows = [
    // ترويسة: اسم الجمعية، عنوان التقرير، بيانات الموظف
    h('tr', { class: 'mr-org' }, td('جمعية نوى للثقافة والفنون', '', { colspan: 5 })),
    h('tr', { class: 'mr-title' }, td('التقرير الشهري', '', { colspan: 5 })),
    h('tr', { class: 'mr-info' }, th('الاسم'), td(e.name, 'mr-b'), th('مدة التقرير', 'mr-c'), td(`شهر ${monthLabel(month)}`, 'mr-b', { colspan: 2 })),
    h('tr', { class: 'mr-info' }, th('الوظيفة'), td(e.jobTitle, 'mr-b'), th('تاريخ تقديم التقرير', 'mr-c'), td(dmy(r.submitDate), 'mr-b', { colspan: 2 })),
    h('tr', { class: 'mr-info' }, td(''), td(e.department, 'mr-b'), td('', '', { colspan: 3 })),

    // 1. المهام الرئيسية
    h('tr', { class: 'mr-band' }, td('1. المهمات الرئيسية خلال فترة التقرير', '', { colspan: 5 })),
    heads('', ['رقم'], ['المهمة'], ['الحالة'], ['التحديات والمعيقات', 2]),
    ...dataRows(r.tasks, (t, i) => h('tr', { class: 'mr-data' }, td(t ? String(i + 1) : ''), td(t?.title, 'mr-start'), td(t?.status), td(t?.challenges, '', { colspan: 2 }))),

    // 2. الاجتماعات والنشاطات (المكان والتاريخ بخط 12)
    h('tr', { class: 'mr-band' }, td('2. الاجتماعات والنشاطات الخارجية التي تمت خلال فترة التقرير', '', { colspan: 5 })),
    heads('mr-h2', ['رقم'], ['عنوان/ نشاط'], ['ملخص الاجتماع'], ['المكان'], ['التاريخ']),
    ...dataRows(meetings, (m, i) => h('tr', { class: 'mr-data' }, td(m ? String(i + 1) : ''), td(m?.title, 'mr-start'), td(m?.summary), td(m?.place, 'mr-s'), td(dmy(m?.date), 'mr-s'))),

    // المرفقات: خانة العنوان في العمود الأول، والأسطر مدموجة B:E
    h('tr', { class: 'mr-gap' }, td('', '', { colspan: 5 })),
    ...Array.from({ length: attRows }, (_, i) => h('tr', { class: 'mr-attach' }, i === 0 ? th('المرفقات') : td(''), td(att[i], '', { colspan: 4 }))),

    // 3. المهام اللاحقة (عنوان القسم رمادي F2F2F2 كالأصل)
    h('tr', { class: 'mr-band3' }, td('3. المهام الرئيسية خلال فترة التقرير اللاحقة', '', { colspan: 5 })),
    heads('mr-h2', ['رقم'], ['المهمة'], ['درجة الأهمية'], ['تاريخ البدء'], ['تاريخ الإنتهاء المتوقع']),
    ...dataRows(r.next, (t, i) => h('tr', { class: 'mr-data' }, td(t ? String(i + 1) : ''), td(t?.title, 'mr-start'), td(t?.importance), td(dmy(t?.start)), td(dmy(t?.end)))),
  ];

  const tail = h('tbody', null,
    h('tr', { class: 'mr-notes' }, td(''), th([('ملاحظات المدير المباشر:'), r.managerNotes ? h('span', { class: 'mr-notes-text' }, ` ${r.managerNotes}`) : null], 'mr-start', { colspan: 4 })),
    h('tr', { class: 'mr-sign' }, td(''), th('توقيع المدير المباشر:', 'mr-start'), td(''), td(''), td('')));

  const table = h('table', { class: 'mr-tbl' }, h('colgroup', null, Array.from({ length: 5 }, () => h('col'))), h('tbody', null, rows), tail);
  const paper = h('article', { class: 'paper mr-paper' }, table);
  const frame = h('div', { class: 'paper-frame mr-frame' }, h('div', { class: 'paper-sheet' }, paper));
  fitToScreen(frame);

  const draftNote = r.status !== 'submitted' ? h('div', { class: 'notice notice-warn no-print' }, 'هذا التقرير ما زال مسودة؛ قدّمه من صفحة التحرير ليصل إلى مديرك المباشر.') : null;
  return h('div', { class: 'page print-page' },
    h('header', { class: 'page-head no-print' },
      h('div', null, h('a', { href: `#/monthly-report/${e.id}/${month}`, class: 'back' }, 'العودة للتقرير'), h('h1', null, `تقرير ${e.name}`), h('p', { class: 'sub' }, `شهر ${monthLabel(month)}`)),
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => window.print() }, icon('printer'), 'طباعة / حفظ PDF'))),
    draftNote, fontNote(), frame);
}
