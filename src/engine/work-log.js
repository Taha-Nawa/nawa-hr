// السجل اليومي «ماذا أنجزت اليوم»: تحقق وتنظيف السطر الواحد. نقي بلا قاعدة بيانات.
import { isDate } from '../worker/util.js';

export const KINDS = ['done', 'meeting', 'training', 'todo'];
export const LIMITS = { title: 400, short: 80, details: 500, place: 120, perMonth: 600 };
export const DEFAULT_STATUS = 'تم الإنجاز';
export const DEFAULT_IMPORTANCE = 'مهم';

const str = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const orNull = (s) => (s === '' ? null : s);

/**
 * input: { date, kind, title, status, details, place, importance, endDate }. الحقول غير المناسبة للنوع تُهمَل (تُخزَّن null).
 * today: تاريخ اليوم المحلي؛ الإنجاز والاجتماع والتدريب لا يُسجَّل بتاريخ لم يأتِ بعد (المهمة القادمة فقط يجوز أن تكون لاحقة).
 */
export function validateEntry(input, today) {
  const kind = input?.kind;
  if (!KINDS.includes(kind)) return { ok: false, error: 'اختر نوع السطر: إنجاز أو اجتماع أو تدريب أو مهمة قادمة' };
  const title = str(input.title, LIMITS.title);
  if (!title) return { ok: false, error: 'اكتب نص السطر' };
  const date = str(input.date, 10);
  if (!isDate(date)) return { ok: false, error: 'التاريخ غير صالح' };
  if (kind !== 'todo' && date > today) return { ok: false, error: 'لا يمكن تسجيل إنجاز أو اجتماع بتاريخ لم يأتِ بعد' };
  const v = { date, kind, title, status: null, details: null, place: null, importance: null, endDate: null };
  if (kind === 'done') {
    v.status = str(input.status, LIMITS.short) || DEFAULT_STATUS;
    v.details = orNull(str(input.details, LIMITS.details));
  } else if (kind === 'todo') {
    v.importance = str(input.importance, LIMITS.short) || DEFAULT_IMPORTANCE;
    const end = str(input.endDate, 10);
    if (end && !isDate(end)) return { ok: false, error: 'تاريخ الانتهاء غير صالح' };
    if (end && end < date) return { ok: false, error: 'تاريخ الانتهاء قبل تاريخ البدء' };
    v.endDate = orNull(end);
    v.details = orNull(str(input.details, LIMITS.details));
  } else {
    v.details = orNull(str(input.details, LIMITS.details));
    v.place = orNull(str(input.place, LIMITS.place));
  }
  return { ok: true, value: v };
}
