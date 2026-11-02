// منطق نقي للتقرير الشهري (المحرّر والطباعة): لا يلمس DOM فيُختبر في Node.
import { AR_MONTHS } from './dom.js';
import { shiftMonthStr } from './sheet-lib.js';

export { shiftMonthStr };

export const monthLabel = (m) => `${AR_MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
export const dmy = (date) => (date ? `${date.slice(8)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : '');

export const monthBounds = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return { from: `${m}-01`, to: new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10) };
};

/** في أول أسبوع من الشهر غالباً يُكتب تقرير الشهر المنصرم؛ بعده تقرير الشهر الجاري. */
export const defaultMonth = (today) => (Number(today.slice(8)) <= 7 ? shiftMonthStr(today.slice(0, 7), -1) : today.slice(0, 7));

export const STATUS_SUGGESTIONS = ['تم الإنجاز', 'قيد التنفيذ', 'مؤجّل', 'لم يبدأ', 'متعثّر'];
export const IMPORTANCE_SUGGESTIONS = ['مهم جداً', 'مهم', 'عادي'];

/** هل الحالة تعني أن المهمة أُنجزت؟ (النص حر: «تم الانجاز»، «تم الإنجاز»، «منجز»…) */
export const isDone = (status) => /^\s*(تم|منجز|مكتمل|أنجز|انتهى)/.test(status || '');

/** مهام الشهر السابق «اللاحقة» ← أسطر قسم المهام الرئيسية في الشهر الجديد (الحالة والتحديات تُترك ليكتبها). */
export const tasksFromPrevious = (prevNext) => (prevNext || []).map((t) => ({ title: t.title, status: '', challenges: '' }));

/** مهام هذا الشهر غير المنجزة ← مقترح «المهام اللاحقة» للشهر التالي (بداية الشهر ونهايته). */
export function nextFromTasks(tasks, month) {
  const { from, to } = monthBounds(shiftMonthStr(month, 1));
  return tasks.filter((t) => t.title?.trim() && !isDone(t.status)).map((t) => ({ title: t.title, importance: 'مهم', start: from, end: to }));
}

/** الاجتماعات بترتيب التاريخ (بلا تاريخ في الآخر) مع ثبات الترتيب لمن تساووا. */
export const sortMeetings = (list) => list.map((m, i) => [m, i]).sort(([a, i], [b, j]) => (a.date && b.date ? (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) : a.date ? -1 : b.date ? 1 : 0) || i - j).map(([m]) => m);

/** لا يُكرَّر سطر بعنوانه نفسه عند الاستيراد (مقارنة بعد توحيد المسافات). */
export function appendUnique(existing, incoming) {
  const key = (t) => String(t.title || '').replace(/\s+/g, ' ').trim();
  const seen = new Set(existing.map(key));
  return [...existing, ...incoming.filter((t) => !seen.has(key(t)) && seen.add(key(t)))];
}
