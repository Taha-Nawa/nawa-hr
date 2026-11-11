/**
 * إجازة الوضع وساعة الأمومة: دوال نقية (تواريخ فقط).
 *  - إجازة الوضع: `leaveDays` يوماً تقويمياً (لا أيام عمل) تبدأ من يوم الولادة نفسه، فآخر يوم فيها deliveryDate + leaveDays − 1.
 *  - العودة: اليوم التالي لآخر يوم في الإجازة.
 *  - ساعة الأمومة: من يوم العودة ولمدة سنة تقويمية كاملة، ساعة واحدة يوميّاً في أول الدوام أو آخره.
 */
export const MATERNITY_LEAVE_TYPE = 'إجازة وضع';
export const MATERNITY_DEFAULT_DAYS = 70;
export const MATERNITY_HOUR_MIN = 60;
export const HOUR_POS = { start: 'بداية الدوام', end: 'نهاية الدوام' };

const MS = 86400000;
const ymd = (t) => new Date(t).toISOString().slice(0, 10);
export const addDaysTo = (date, n) => ymd(Date.parse(`${date}T00:00:00Z`) + n * MS);

/** يوم العودة بعد الإجازة */
export const returnDateOf = (rec) => addDaysTo(rec.deliveryDate, rec.leaveDays);

/** آخر يوم في إجازة الوضع */
export const leaveEndOf = (rec) => addDaysTo(rec.deliveryDate, rec.leaveDays - 1);

/** نفس اليوم من السنة التالية ناقص يوم (سنة تقويمية كاملة تبدأ من تاريخ العودة) */
export function hourEndOf(rec) {
  const r = returnDateOf(rec);
  const y = Number(r.slice(0, 4)) + 1;
  let next = `${y}${r.slice(4)}`;
  if (Number.isNaN(Date.parse(next))) next = `${y}-03-01`; // 29 فبراير → 1 مارس
  else if (ymd(Date.parse(`${next}T00:00:00Z`)) !== next) next = `${y}-03-01`;
  return addDaysTo(next, -1);
}

/** كل أيام الإجازة (YYYY-MM-DD) */
export function leaveDates(rec) {
  return Array.from({ length: rec.leaveDays }, (_, i) => addDaysTo(rec.deliveryDate, i));
}

/** موضع ساعة الأمومة في تاريخ ما ('start' | 'end' | null) من سجلات الموظفة */
export function hourPosOn(date, records) {
  for (const r of records || []) {
    if (!r.hourPos) continue;
    if (date >= returnDateOf(r) && date <= hourEndOf(r)) return r.hourPos;
  }
  return null;
}

/** هل التاريخ ضمن إجازة وضع؟ */
export const onLeaveOn = (date, records) => (records || []).some((r) => date >= r.deliveryDate && date <= leaveEndOf(r));

export function validateMaternity(input) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.deliveryDate || '') && !Number.isNaN(Date.parse(`${input.deliveryDate}T00:00:00Z`)) ? input.deliveryDate : null;
  if (!date) return { error: 'تاريخ الولادة غير صالح' };
  const days = input.leaveDays === undefined || input.leaveDays === null || input.leaveDays === '' ? MATERNITY_DEFAULT_DAYS : Number(input.leaveDays);
  if (!Number.isInteger(days) || days < 1 || days > 365) return { error: 'عدد أيام الإجازة بين 1 و365 يوماً تقويمياً' };
  const pos = input.hourPos === undefined || input.hourPos === null || input.hourPos === '' ? null : input.hourPos;
  if (pos !== null && !(pos in HOUR_POS)) return { error: 'موضع ساعة الأمومة: بداية الدوام أو نهايته' };
  return { ok: true, value: { deliveryDate: date, leaveDays: days, hourPos: pos } };
}
