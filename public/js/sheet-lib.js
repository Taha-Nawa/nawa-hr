// منطق نقي لكشوف الحضور المطبوعة (الأسبوعي والمتطوعين): لا يلمس DOM فيُختبر في Node.
import { addDays } from './dom.js';
import { from24 } from './time12.js';

const dow = (date) => new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = الأحد … 6 = السبت

/** أقرب سبت في أو قبل التاريخ (بداية الأسبوع في النموذج الورقي: السبت → الخميس). */
export const weekStart = (date) => addDays(date, -((dow(date) + 1) % 7));

/** أيام الكشف الستة: السبت … الخميس. */
export const weekDates = (start) => Array.from({ length: 6 }, (_, i) => addDays(start, i));

export const ROWS_PER_PAGE = 16;

/** يقسّم قائمة إلى صفحات، وتُكمَّل الصفحة الأخيرة بصفوف فارغة (null) لتطابق النموذج الورقي ذي الصفوف الثابتة. */
export function paginate(list, per = ROWS_PER_PAGE) {
  const pages = [];
  for (let i = 0; i < list.length; i += per) pages.push(list.slice(i, i + per));
  return pages.map((p) => [...p, ...Array(per - p.length).fill(null)]);
}

/** مجموعات حسب المركز بترتيب أسماء المراكز؛ بلا مركز في آخرها. */
export function groupByCenter(employees) {
  const m = new Map();
  for (const e of employees) {
    const k = e.center || '';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(e);
  }
  return [...m.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'ar'))).map(([center, list]) => ({ center, list }));
}

const WORKED = new Set(['حاضر', 'متأخر']);

/**
 * خلايا يوم واحد لموظف:
 *  { kind: 'blank' }                                   — اتركها فارغة
 *  { kind: 'label', text }                             — عطلة أو إجازة أو غياب (تُدمج الخلايا الثلاث)
 *  { kind: 'times', in, out, ret, dep }                — أوقات (HH:MM) أو null
 * filled=false يعطي نموذجاً فارغاً للتعبئة اليدوية. الأيام غير الماضية (اليوم والمستقبل) لا يُكتب فيها «غياب».
 */
export function cellFor(day, date, today, filled = true) {
  if (!filled || !day || date > today) return { kind: 'blank' };
  if (day.dayType && day.dayType !== 'عمل') return { kind: 'label', text: day.dayType };
  const times = { kind: 'times', in: day.checkIn || null, out: day.exitFirst || null, ret: day.returnLast || null, dep: day.departure || null };
  if (day.checkIn || day.departure) return times;
  if (day.status === 'غياب') return date < today ? { kind: 'label', text: 'غياب' } : { kind: 'blank' };
  if (day.status && !WORKED.has(day.status)) return { kind: 'label', text: day.status };
  return { kind: 'blank' };
}

/** وقت مضغوط للخلية الضيقة: '2:05 م' ← '2:05م' (للطباعة فقط؛ العرض الكامل في بقية الصفحات). */
export function compact12(hhmm) {
  const p = from24(hhmm);
  return p ? `${p.hour}:${p.minute}${p.ap}` : '';
}

/** أيام شهر YYYY-MM كلها: [{ date, dow }]. */
export function monthDays(month) {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`;
    return { date, dow: dow(date) };
  });
}

export const shiftMonthStr = (month, delta) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** أيام الكشف المطبوع للمتطوع: كل أيام الشهر عدا الجمعة، ويُبقى أي جمعة سُجّل فيها حضور. */
export function printableDays(month, recorded) {
  const have = new Set(recorded.map((d) => d.date));
  return monthDays(month).filter((d) => d.dow !== 5 || have.has(d.date));
}

const toMin = (t) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);

/** ساعات يوم متطوع: (الانصراف − الوصول) − (العودة − المغادرة). نفس صيغة الخادم (src/engine/volunteers.js). */
export function hoursOf(d) {
  if (!d?.arrive || !d?.depart) return 0;
  let m = toMin(d.depart) - toMin(d.arrive);
  if (d.exit && d.ret) m -= toMin(d.ret) - toMin(d.exit);
  return Math.round((Math.max(0, m) / 60) * 100) / 100;
}

export function totalsOf(days) {
  const present = days.filter((d) => d.arrive);
  return { days: present.length, hours: Math.round(present.reduce((s, d) => s + hoursOf(d), 0) * 100) / 100 };
}
