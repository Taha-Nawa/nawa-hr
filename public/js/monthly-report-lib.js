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

/** توحيد المسافات لمقارنة النصوص عند الاستيراد. */
export const normText = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

/** لا يُكرَّر سطر بمفتاحه نفسه عند الاستيراد (الافتراضي: العنوان بعد توحيد المسافات؛ والاجتماع مفتاحه العنوان + التاريخ). */
export function appendUnique(existing, incoming, key = (t) => normText(t.title)) {
  const seen = new Set(existing.map(key));
  return [...existing, ...incoming.filter((t) => !seen.has(key(t)) && seen.add(key(t)))];
}

export const meetingKey = (m) => `${normText(m.title)}|${m.date || ''}`;

// ---------------------------------------------------------------------------------------------------------------
// فحص اكتمال التقرير قبل التقديم. نقي: يأخذ حالة المحرّر ويُرجع قائمة ملاحظات { id, level, text }.
//   must   : يمنع التقديم (الخادم يرفضه أصلاً)         should: يستحق المراجعة لكن لا يمنع       tip: تلميح فقط
// أسطر فارغة تماماً تُتجاهل (يحذفها الخادم عند الحفظ).
const has = (v) => String(v ?? '').trim() !== '';
const filled = (o) => Object.values(o).some(has);

export function reportChecks({ tasks = [], meetings = [], next = [] }, { month, employee = {}, logTasks = [], logMeets = [] } = {}) {
  const out = [];
  const add = (id, level, text) => out.push({ id, level, text });
  const T = tasks.filter(filled);
  const M = meetings.filter(filled);
  const N = next.filter(filled);
  const count = (list, fn) => list.filter(fn).length;

  // المهام الرئيسية
  if (!T.length) add('tasks-none', 'must', 'أضف مهمة رئيسية واحدة على الأقل (شرط التقديم)');
  const tNoTitle = count(T, (t) => !has(t.title));
  if (tNoTitle) add('tasks-untitled', 'must', `${tNoTitle} سطر في المهام الرئيسية بلا عنوان`);
  const tNoStatus = count(T, (t) => has(t.title) && !has(t.status));
  if (tNoStatus) add('tasks-status', 'should', `${tNoStatus} مهمة بلا حالة (تم الإنجاز، قيد التنفيذ…)`);
  const open = T.filter((t) => has(t.title) && has(t.status) && !isDone(t.status));
  const noWhy = count(open, (t) => !has(t.challenges));
  if (noWhy) add('tasks-why', 'should', `${noWhy} مهمة غير منجزة بلا ذكر للتحديات أو سبب عدم الإنجاز`);

  // الاجتماعات والنشاطات
  const mNoTitle = count(M, (m) => !has(m.title));
  if (mNoTitle) add('meet-untitled', 'must', `${mNoTitle} سطر في الاجتماعات والنشاطات بلا عنوان`);
  if (month) {
    const { from, to } = monthBounds(month);
    const out_ = count(M, (m) => has(m.date) && (m.date < from || m.date > to));
    if (out_) add('meet-range', 'must', `${out_} اجتماع بتاريخ خارج شهر التقرير`);
  }
  const mNoDate = count(M, (m) => has(m.title) && !has(m.date));
  if (mNoDate) add('meet-date', 'should', `${mNoDate} اجتماع أو نشاط بلا تاريخ`);
  const mNoPlace = count(M, (m) => has(m.title) && !has(m.place));
  if (mNoPlace) add('meet-place', 'tip', `${mNoPlace} اجتماع أو نشاط بلا مكان`);
  if (!M.length) add('meet-none', 'tip', 'لا اجتماعات ولا نشاطات خارجية مسجّلة؛ تجاهل هذا إن لم يكن لديك شيء في هذا الشهر');

  // مهام الشهر اللاحق
  if (!N.length) add('next-none', 'should', 'لم تكتب المهام الرئيسية للشهر القادم');
  const nNoTitle = count(N, (n) => !has(n.title));
  if (nNoTitle) add('next-untitled', 'must', `${nNoTitle} سطر في مهام الشهر القادم بلا عنوان`);
  const nBadRange = count(N, (n) => has(n.start) && has(n.end) && n.end < n.start);
  if (nBadRange) add('next-range', 'must', `${nBadRange} مهمة قادمة تاريخ انتهائها قبل تاريخ بدئها`);
  const nNoDates = count(N, (n) => has(n.title) && (!has(n.start) || !has(n.end)));
  if (nNoDates) add('next-dates', 'should', `${nNoDates} مهمة قادمة بلا تاريخ بدء أو انتهاء`);
  const nNoImp = count(N, (n) => has(n.title) && !has(n.importance));
  if (nNoImp) add('next-importance', 'tip', `${nNoImp} مهمة قادمة بلا درجة أهمية`);

  // الترحيل: المهام غير المنجزة يُتوقع أن تظهر في اللاحقة
  const nextTitles = new Set(N.map((n) => normText(n.title)));
  const notCarried = open.filter((t) => !nextTitles.has(normText(t.title))).length;
  if (notCarried) add('carry', 'should', `${notCarried} مهمة غير منجزة لم تُرحَّل إلى مهام الشهر القادم (زر «ترحيل غير المنجز»)`);

  // سجل صاحب التقرير اليومي
  const haveTasks = new Set(T.map((t) => normText(t.title)));
  const missTasks = logTasks.filter((t) => !haveTasks.has(normText(t.title))).length;
  if (missTasks) add('log-tasks', 'should', `في سجلك اليومي ${missTasks} إنجاز لم يُستورد إلى المهام الرئيسية بعد`);
  const haveMeets = new Set(M.map(meetingKey));
  const missMeets = logMeets.filter((m) => !haveMeets.has(meetingKey(m))).length;
  if (missMeets) add('log-meets', 'should', `في سجلك اليومي ${missMeets} اجتماع أو نشاط لم يُستورد بعد`);

  // رأس النموذج المطبوع
  if (!has(employee.jobTitle) || !has(employee.department)) add('header', 'should', 'الوظيفة أو الإدارة فارغة في بطاقتك فتظهر خانتها فارغة في النموذج المطبوع (اطلب من الموارد البشرية استكمالها)');
  return out;
}

export const checkCounts = (checks) => ({ must: checks.filter((c) => c.level === 'must').length, should: checks.filter((c) => c.level === 'should').length, tip: checks.filter((c) => c.level === 'tip').length });
