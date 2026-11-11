/**
 * الإجازات الخاصة (حج / وفاة قريب / علاج طويل): دوال نقية. أيام تقويمية من تاريخ البداية، لا تُخصم من رصيد،
 * وتُحتسب كلها «Others» في التايم شيت. أسماء أنواعها لا تحوي «مرض» كي لا تذهب إلى صف المرضية.
 */
import { addDaysTo, MATERNITY_LEAVE_TYPE } from './maternity.js';

export const SPECIAL_KINDS = {
  hajj: { label: 'إجازة حج', type: 'إجازة حج', defaultDays: null },
  bereavement: { label: 'وفاة قريب من الدرجة الأولى', type: 'إجازة وفاة', defaultDays: 3 },
  long_treatment: { label: 'علاج طويل (بقرار الموارد البشرية والإدارة)', type: 'إجازة علاج طويلة', defaultDays: null },
};
export const RELATIONS = ['أب', 'أم', 'ابن', 'ابنة', 'زوج', 'زوجة'];
/** كل أنواع الإجازات التي تظهر في صف Others بدل الإجازة السنوية */
export const SPECIAL_TYPES = [MATERNITY_LEAVE_TYPE, ...Object.values(SPECIAL_KINDS).map((k) => k.type)];
export const isSpecialLeave = (type) => !!type && SPECIAL_TYPES.includes(type);

export const endOf = (r) => addDaysTo(r.fromDate, r.days - 1);
export const datesOf = (r) => Array.from({ length: r.days }, (_, i) => addDaysTo(r.fromDate, i));

export function validateSpecial(input) {
  const k = SPECIAL_KINDS[input.kind];
  if (!k) return { error: 'نوع الإجازة: حج أو وفاة قريب أو علاج طويل' };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.fromDate || '') && !Number.isNaN(Date.parse(`${input.fromDate}T00:00:00Z`)) ? input.fromDate : null;
  if (!date) return { error: 'تاريخ البداية غير صالح' };
  const raw = input.days === undefined || input.days === null || input.days === '' ? k.defaultDays : Number(input.days);
  if (!Number.isInteger(raw) || raw < 1 || raw > 365) return { error: 'حدّد عدد الأيام التقويمية (1 إلى 365)' };
  let relation = null;
  if (input.kind === 'bereavement') {
    if (!RELATIONS.includes(input.relation)) return { error: 'حدّد صلة القرابة (من الدرجة الأولى: الأب، الأم، الابن، الابنة، الزوج، الزوجة)' };
    relation = input.relation;
  }
  return { ok: true, value: { kind: input.kind, fromDate: date, days: raw, relation } };
}
