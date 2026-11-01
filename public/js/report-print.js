// طباعة/تصدير PDF للتقرير الشهري بنفس تنسيق نموذج الجمعية (الأعمدة والألوان والأقسام الثلاثة والتواقيع).
// الطباعة من المتصفح (حفظ كـ PDF) لأن الخادم المجاني لا يولّد ملفات، والمتصفح يشكّل الخط العربي صحيحاً.
// القواعد البصرية في css/print.css. الخط: Sakkal Majalla (خط النموذج الأصلي، مثبّت مع Office) ثم Alexandria المرفق.
import { h, AR_MONTHS } from './dom.js';

export const ORG = 'جمعية نوى للثقافة والفنون';
export const periodText = (month) => {
  const [y, m] = month.split('-').map(Number);
  return `شهر ${AR_MONTHS[m - 1]} ${y}`;
};
const dmy = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
export const reportFilename = (name, month) => `التقرير الشهري - ${name} - ${month.slice(5, 7)}-${month.slice(0, 4)}`;

const td = (cls, text, attrs = {}) => h('td', { class: cls, ...attrs }, text);

/** يبني جدول التقرير (عقدة DOM) من بيانات الموظف وأقسام التقرير. لا يلمس الصفحة. */
export function buildReportDoc({ employee, month, data, org = ORG, sakkal = false }) {
  const tasks = data.tasks.filter((t) => t.t.trim());
  const meetings = data.meetings.filter((m) => m.t.trim()).slice().sort((a, b) => (a.d || '').localeCompare(b.d || ''));
  const plan = data.plan.filter((p) => p.t.trim());
  const atts = data.attachments.map((a) => a.t.trim()).filter(Boolean);
  while (atts.length < 3) atts.push('');

  const rows = [];
  const row = (...cells) => rows.push(h('tr', null, ...cells));
  const head = (...labels) => row(...labels.map(([text, span]) => td('rp-h', text, span ? { colspan: span } : {})));

  row(td('rp-org', org, { colspan: 5 }));
  row(td('rp-title', 'التقرير الشهري', { colspan: 5 }));
  row(td('rp-h rp-lab', 'الاسم'), td('rp-v', employee.name), td('rp-h', 'مدة التقرير'), td('rp-v', periodText(month), { colspan: 2 }));
  row(td('rp-h rp-lab', 'الوظيفة'), td('rp-v', employee.jobTitle || ''), td('rp-h', 'تاريخ تقديم التقرير'), td('rp-v', dmy(data.submitDate), { colspan: 2 }));
  row(td('rp-h rp-lab rp-blank', ''), td('rp-v', employee.department || ''), td('rp-none', '', { colspan: 3 }));

  row(td('rp-sec', '1. المهمات الرئيسية خلال فترة التقرير', { colspan: 5 }));
  head(['رقم'], ['المهمة'], ['الحالة'], ['التحديات والمعيقات', 2]);
  tasks.forEach((t, i) => row(td('rp-n', i + 1), td('rp-v rp-start', t.t), td('rp-v', t.s), td('rp-v', t.c, { colspan: 2 })));

  row(td('rp-sec', '2. الاجتماعات والنشاطات الخارجية التي تمت خلال فترة التقرير', { colspan: 5 }));
  head(['رقم'], ['عنوان/ نشاط'], ['ملخص الاجتماع'], ['المكان'], ['التاريخ']);
  meetings.forEach((m, i) => row(td('rp-n', i + 1), td('rp-v rp-start', m.t), td('rp-v', m.s), td('rp-v rp-sm', m.p), td('rp-v rp-sm', dmy(m.d))));
  row(td('rp-v rp-gap', '', { colspan: 5 }));

  atts.forEach((a, i) => row(td(i === 0 ? 'rp-attl' : 'rp-none', i === 0 ? 'المرفقات' : ''), td('rp-v rp-start', a, { colspan: 4 })));

  row(td('rp-sec rp-sec3', '3. المهام الرئيسية خلال فترة التقرير اللاحقة', { colspan: 5 }));
  head(['رقم'], ['المهمة'], ['درجة الأهمية'], ['تاريخ البدء'], ['تاريخ الإنتهاء المتوقع']);
  plan.forEach((p, i) => row(td('rp-n', i + 1), td('rp-v rp-start', p.t), td('rp-v', p.i), td('rp-v', dmy(p.sd)), td('rp-v', dmy(p.ed))));

  row(td('rp-none', ''), td('rp-h rp-sign rp-start', `ملاحظات المدير المباشر:${data.notes ? ` ${data.notes}` : ''}`, { colspan: 4 }));
  row(td('rp-none', ''), td('rp-h rp-sign rp-start', 'توقيع المدير المباشر: ', { colspan: 4 }));

  return h('div', { id: 'print-root', class: `rp${sakkal ? ' rp-sk' : ''}`, dir: 'rtl', lang: 'ar' },
    h('table', { class: 'rp-t' },
      h('colgroup', null, ['c1', 'c2', 'c3', 'c4', 'c5'].map((c) => h('col', { class: `rp-${c}` }))),
      h('tbody', null, rows)));
}

/** هل خط النموذج الأصلي مثبّت على هذا الجهاز؟ (يُقاس بعرض نص عربي مقابل خط احتياطي) */
export function hasSakkal() {
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    const s = 'مرحبا بكم في جمعية نوى للثقافة';
    ctx.font = '40px monospace';
    const base = ctx.measureText(s).width;
    ctx.font = '40px "Sakkal Majalla", monospace';
    return ctx.measureText(s).width !== base;
  } catch {
    return false;
  }
}

/** يفتح نافذة الطباعة؛ اسم الملف المقترح عند «حفظ كـ PDF» = عنوان الصفحة المؤقت. */
export async function printReport({ employee, month, data }) {
  document.getElementById('print-root')?.remove();
  const root = buildReportDoc({ employee, month, data, sakkal: hasSakkal() });
  document.body.append(root);
  document.body.classList.add('printing');
  const title = document.title;
  document.title = reportFilename(employee.name, month);
  const restore = () => {
    document.title = title;
    document.body.classList.remove('printing');
    root.remove();
  };
  window.addEventListener('afterprint', restore, { once: true });
  try {
    await document.fonts?.ready;
  } catch { /* لا يهم */ }
  window.print();
}
