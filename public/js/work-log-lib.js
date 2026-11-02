// منطق نقي للسجل اليومي «ماذا أنجزت اليوم»: أنواع الأسطر وتحويلها إلى أقسام التقرير الشهري. لا يلمس DOM فيُختبر في Node.
import { normText, isDone } from './monthly-report-lib.js';

export const KIND_META = {
  done: { label: 'أنجزت اليوم', chip: 'chip-present', icon: 'check', titleLabel: 'ماذا أنجزت؟' },
  meeting: { label: 'اجتماع', chip: 'chip-leave', icon: 'users', titleLabel: 'عنوان الاجتماع' },
  training: { label: 'تدريب أو نشاط خارجي', chip: 'chip-late', icon: 'calendar', titleLabel: 'عنوان التدريب أو النشاط' },
  todo: { label: 'مهمة قادمة', chip: 'chip-off', icon: 'clock', titleLabel: 'المهمة القادمة' },
};
export const KIND_ORDER = ['done', 'meeting', 'training', 'todo'];

/** أسطر «أنجزت» ← قسم المهام الرئيسية: السطور المتكررة بعنوان واحد تُدمج في مهمة واحدة (حالة آخر سطر، وتفاصيلها تصير تحديات). */
export function tasksFromLog(entries) {
  const groups = new Map();
  for (const e of entries) {
    if (e.kind !== 'done') continue;
    const key = normText(e.title);
    const g = groups.get(key) || { title: key, status: '', details: [] };
    g.status = e.status || g.status; // الأسطر مرتبة بالتاريخ فالأخير يغلب
    const d = normText(e.details);
    if (d && !g.details.includes(d)) g.details.push(d);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({ title: g.title, status: g.status, challenges: g.details.join('، ') }));
}

/** الاجتماعات والتدريبات والنشاطات الخارجية ← القسم الثاني (الاجتماع بالتاريخ؛ الترتيب يتولاه التقرير عند الطباعة). */
export const meetingsFromLog = (entries) => entries
  .filter((e) => e.kind === 'meeting' || e.kind === 'training')
  .map((e) => ({ title: e.title, summary: e.details || '', place: e.place || '', date: e.date }));

/** المهام القادمة ← القسم الثالث (تاريخ البدء = تاريخ السطر). */
export const nextFromLog = (entries) => entries
  .filter((e) => e.kind === 'todo')
  .map((e) => ({ title: e.title, importance: e.importance || '', start: e.date, end: e.endDate || '' }));

/** أعداد الأنواع لعرض ملخص الشهر. */
export function countKinds(entries) {
  const n = { done: 0, meeting: 0, training: 0, todo: 0 };
  for (const e of entries) if (e.kind in n) n[e.kind] += 1;
  return n;
}

/** تجميع الأسطر حسب اليوم (الأحدث أولاً) مع بقاء ترتيب إدخال اليوم الواحد. */
export function groupByDay(entries) {
  const days = new Map();
  for (const e of entries) {
    if (!days.has(e.date)) days.set(e.date, []);
    days.get(e.date).push(e);
  }
  return [...days.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([date, items]) => ({ date, items }));
}

/** هل المهمة القادمة قابلة للتحويل إلى إنجاز؟ (كل مهمة قادمة؛ والإنجاز يُسجَّل بتاريخ اليوم). */
export const doneFromTodo = (entry, today) => ({ kind: 'done', date: today, status: 'تم الإنجاز', title: entry.title, details: entry.details || '' });

export { isDone };

/**
 * اقتراحات الإدخال: من قائمة الخادم (الأحدث والأكثر تكراراً أولاً) تُرشَّح لنوع السطر وما كُتب في العنوان.
 * ما يبدأ بما كُتب يتقدم على ما يحويه فقط؛ والمطابق تماماً لا يُقترح. بلا نص: أحدث الاقتراحات.
 */
export function suggestFor(list, kind, typed = '', limit = 6) {
  const q = normText(typed).toLowerCase();
  const pool = (list || []).filter((s) => s.kind === kind && normText(s.title).toLowerCase() !== q);
  if (!q) return pool.slice(0, limit);
  const starts = [];
  const inside = [];
  for (const s of pool) {
    const t = normText(s.title).toLowerCase();
    if (t.startsWith(q)) starts.push(s);
    else if (t.includes(q)) inside.push(s);
  }
  return [...starts, ...inside].slice(0, limit);
}

/** ما يُنسخ من الاقتراح إلى النموذج: العنوان دائماً؛ المكان للاجتماع والتدريب؛ الأهمية للمهمة القادمة؛ الحالة فقط إن لم تكن «منجزة» (استمرار عمل). */
export function applySuggestion(vals, s) {
  const next = { ...vals, title: s.title };
  if ((s.kind === 'meeting' || s.kind === 'training') && s.place) next.place = s.place;
  if (s.kind === 'todo' && s.importance) next.importance = s.importance;
  if (s.kind === 'done' && s.status && !isDone(s.status)) next.status = s.status;
  return next;
}

/** نسخ سطر سابق إلى اليوم («كرّر اليوم»): الإنجاز والاجتماع والتدريب فقط؛ كل الحقول تُنسخ ما عدا التاريخ. */
export const repeatToday = (e, today) => ({ kind: e.kind, date: today, title: e.title, status: e.status || '', details: e.details || '', place: e.place || '' });
