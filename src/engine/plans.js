/**
 * الإجازات المتوقعة (التخطيط) — دوال نقيّة بلا قاعدة بيانات ولا ساعة نظام.
 *
 * الموظف يختار أياماً من تقويم شهري فتبقى «متوقعة» (مسودة) ثم يرسلها إلى مسؤوله، ويقرّر المسؤول يوماً يوماً:
 * معتمد أو مرفوض. المعتمد يتحوّل إلى طلب إجازة معتمد عادي (يدخل الحضور والرصيد والتايم شيت كأي إجازة).
 */
import { dayTypeOf, DAY_WORK } from './attendance.js';
import { workingDates } from './requests.js';
import { addDays, isDate, clip } from '../worker/util.js';

export const PLAN_PURPOSES = { annual: 'اعتيادي (سنوي)', other: 'أخرى' };
export const PLAN_STATUS = { draft: 'مسودة', submitted: 'بانتظار القرار', approved: 'معتمد', rejected: 'مرفوض', cancelled: 'ملغاة' };
export const MAX_PLAN_DAYS = 62; // أكثر ما يُخطَّط في خطة واحدة (كل يوم يُحسب في استعلامات الحفظ والاعتماد ضمن حدّ الطلب الواحد)

const fail = (error, status = 400) => ({ ok: false, error, status });

/** أقرب يوم يجوز تخطيطه: الاعتيادية بعد مهلة التقديم، وغيرها من اليوم. */
export function earliestPlanDate(purpose, today, rules) {
  return purpose === 'annual' ? addDays(today, rules.annual.minNoticeDays) : today;
}

/**
 * يتحقق من خطة قبل حفظها أو إرسالها.
 * @param {object} input  { purpose, note, dates }
 * @param {object} ctx    { today, rules, settings, holidays:Set }
 * @returns {{ok:true,value:{purpose,note,dates:string[]}}|{ok:false,error:string,status:number}}
 */
export function validatePlan(input, { today, rules, settings, holidays }) {
  if (!settings) return fail('لم تُدخل إعدادات الدوام بعد، راجع الموارد البشرية');
  const purpose = input?.purpose ?? 'annual';
  if (!(purpose in PLAN_PURPOSES)) return fail('اختر نوع الإجازة المتوقعة: اعتيادي أو أخرى');
  const note = clip(input?.note, 300) || '';
  if (purpose === 'other' && note.length < 2) return fail('اكتب سبب الإجازة (أخرى)');
  if (!Array.isArray(input?.dates) || input.dates.length === 0) return fail('اختر يوماً واحداً على الأقل من التقويم');
  if (input.dates.length > MAX_PLAN_DAYS * 2) return fail(`الحد الأقصى ${MAX_PLAN_DAYS} يوماً في الخطة الواحدة`);
  const dates = [...new Set(input.dates)].sort();
  if (dates.length > MAX_PLAN_DAYS) return fail(`الحد الأقصى ${MAX_PLAN_DAYS} يوماً في الخطة الواحدة، قسّمها إلى خطتين`);
  const min = earliestPlanDate(purpose, today, rules);
  const max = addDays(today, rules.maxAheadDays);
  for (const d of dates) {
    if (!isDate(d)) return fail('تاريخ غير صالح في الخطة');
    if (dayTypeOf(d, settings, holidays) !== DAY_WORK) return fail(`يوم ${d} ليس يوم عمل (عطلة أسبوعية أو رسمية)`);
    if (d < min) {
      return fail(purpose === 'annual' && rules.annual.minNoticeDays > 0 ? `يوم ${d} فات موعد تخطيطه: الاعتيادية تُخطَّط قبل موعدها بـ${rules.annual.minNoticeDays} يوم على الأقل` : `يوم ${d} مضى، اختر أياماً قادمة`);
    }
    if (d > max) return fail(`يوم ${d} أبعد من المسموح (${rules.maxAheadDays} يوماً من اليوم)`);
  }
  return { ok: true, value: { purpose, note, dates } };
}

/**
 * يجمع الأيام في فترات متصلة (تُعتبر متصلة إن لم يفصل بينها يوم عمل غير مشمول)؛ كل فترة تصير طلب إجازة واحداً.
 * dates مرتبة ومن أيام العمل.
 */
export function planRuns(dates, settings, holidays = new Set()) {
  const runs = [];
  for (const d of [...dates].sort()) {
    const last = runs[runs.length - 1];
    if (last) {
      const gap = workingDates(addDays(last.to, 1), addDays(d, -1), settings, holidays);
      if (gap.length === 0) {
        last.to = d;
        last.dates.push(d);
        continue;
      }
    }
    runs.push({ from: d, to: d, dates: [d] });
  }
  return runs;
}

/** «2026-12-01 → 2026-12-03، 2026-12-08» نصاً مختصراً للبريد والعرض. */
export function describeRuns(runs) {
  return runs.map((r) => (r.dates.length === 1 ? r.from : `${r.from} → ${r.to} (${r.dates.length} أيام)`)).join('، ');
}
