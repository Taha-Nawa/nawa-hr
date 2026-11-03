// مزوّدو الخدمة: نصوص وألوان الحالات وتنسيق المدد. نقي بلا DOM كي يُختبر على Node.
import { fmt12, fmtRange12 } from './time12.js';

const DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5]; // يبدأ الأسبوع بالسبت كباقي النظام

/** الحالة الحيّة (لوحة «من في المركز الآن»): تسمية + صنف الشارة + شدة (للترتيب والتلوين) */
export const LIVE = {
  noshow: { label: 'لم يحضر', chip: 'chip-absent', tone: 'bad' },
  waiting: { label: 'بانتظار حضوره', chip: 'chip-late', tone: 'warn' },
  present_late: { label: 'في المركز (تأخر)', chip: 'chip-late', tone: 'warn' },
  out: { label: 'خرج مؤقتاً', chip: 'chip-leave', tone: 'info' },
  present: { label: 'في المركز', chip: 'chip-present', tone: 'ok' },
  left: { label: 'انصرف قبل نهاية الحصة', chip: 'chip-late', tone: 'warn' },
  break: { label: 'بين حصتين', chip: 'chip-leave', tone: 'info' },
  extra: { label: 'في المركز خارج الجدول', chip: 'chip-leave', tone: 'info' },
  upcoming: { label: 'حصته لم تبدأ', chip: 'chip-none', tone: 'idle' },
  done: { label: 'أنهى حصته', chip: 'chip-off', tone: 'idle' },
  absent: { label: 'غائب', chip: 'chip-absent', tone: 'bad' },
  off: { label: 'لا حصة اليوم', chip: 'chip-none', tone: 'idle' },
};

/** حالة يوم في كشف الشهر */
export const DAY = {
  ok: { label: 'ملتزم', chip: 'chip-present' },
  late: { label: 'متأخر', chip: 'chip-late' },
  early: { label: 'انصراف مبكر', chip: 'chip-late' },
  late_early: { label: 'تأخر وانصراف مبكر', chip: 'chip-late' },
  absent: { label: 'غائب', chip: 'chip-absent' },
  partial: { label: 'غياب عن بعض الحصص', chip: 'chip-late' },
  unclosed: { label: 'انصراف غير مسجّل', chip: 'chip-absent' },
  extra: { label: 'حضور خارج الجدول', chip: 'chip-leave' },
  live: { label: 'اليوم', chip: 'chip-leave' },
  future: { label: 'قادم', chip: 'chip-none' },
  none: { label: '—', chip: 'chip-none' },
};

export const CONTRACT = {
  active: { label: 'ساري', chip: 'chip-present' },
  upcoming: { label: 'لم يبدأ', chip: 'chip-leave' },
  ended: { label: 'منتهٍ', chip: 'chip-off' },
};

export const liveInfo = (s) => LIVE[s] || LIVE.off;
export const dayInfo = (s) => DAY[s] || DAY.none;

/** دقائق -> «3 س 30 د» (أو «—» للصفر) */
export function fmtMin(min) {
  if (!min) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h ? `${h} س` : '', m ? `${m} د` : ''].filter(Boolean).join(' ');
}

/** ساعات عشرية: 7.5 -> «7.5» (أو «—») */
export const fmtHours = (n) => (n ? String(Math.round(n * 100) / 100) : '—');

/** وصف الجدول: «السبت والإثنين: 9:00 ص – 1:00 م» ويفصل الأوقات المختلفة بسطر. [{weekday,start,end}] -> string[] */
export function scheduleLines(schedule) {
  const by = new Map();
  for (const s of schedule || []) {
    const k = `${s.start}-${s.end}`;
    (by.get(k) || by.set(k, { start: s.start, end: s.end, days: [] }).get(k)).days.push(s.weekday);
  }
  return [...by.values()]
    .map((g) => ({ ...g, days: [...new Set(g.days)].sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b)) }))
    .sort((a, b) => WEEK_ORDER.indexOf(a.days[0]) - WEEK_ORDER.indexOf(b.days[0]))
    .map((g) => `${g.days.map((d) => DAYS[d]).join(' و')}: ${fmtRange12(g.start, g.end)}`);
}

/** ملخص قصير لعمود القائمة: «حصتان أسبوعياً · 8 س» */
export function scheduleSummary(schedule) {
  const n = (schedule || []).length;
  const mins = (schedule || []).reduce((a, s) => a + (toMin(s.end) - toMin(s.start)), 0);
  return `${n === 1 ? 'حصة واحدة' : n === 2 ? 'حصتان' : `${n} حصص`} أسبوعياً · ${fmtMin(mins)}`;
}
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** عقد: «ينتهي بعد 5 أيام» / «ينتهي اليوم» / «انتهى منذ 3 أيام» / «يبدأ بعد يومين» */
export function contractNote(c) {
  const days = (n) => (n === 1 ? 'يوم' : n === 2 ? 'يومين' : `${n} أيام`);
  if (!c) return '';
  if (c.state === 'active') return c.daysLeft === 0 ? 'ينتهي اليوم' : `ينتهي بعد ${days(c.daysLeft)}`;
  if (c.state === 'upcoming') return `يبدأ بعد ${days(c.daysTo)}`;
  return `انتهى منذ ${days(c.daysAgo)}`;
}
/** يقترب الانتهاء (خلال 7 أيام) فيُلفت النظر لتجديد العقد أو إيقاف البطاقة */
export const endingSoon = (c) => c?.state === 'active' && c.daysLeft <= 7;

export const dmy = (date) => (date ? `${date.slice(8)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : '');

/** حركات اليوم -> أوقات للعرض: الخروج/العودة أزواج «11:00 ص ← 11:30 ص» */
export function exitsText(exits) {
  return (exits || []).map((x) => `${fmt12(x.out)}${x.back ? ` ← ${fmt12(x.back)}` : ' ← لم يعد'}`).join('، ');
}

export const AR_DAY_NAME = (dow) => DAYS[dow];

/** ملاحظات اليوم النصية لمن يراجع الكشف */
export function dayNotes(d) {
  const out = [];
  if (d.lateMin > 0 && d.status !== 'extra') out.push(`تأخر ${fmtMin(d.lateMin)}`);
  if (d.earlyMin > 0) out.push(`انصرف قبل النهاية بـ ${fmtMin(d.earlyMin)}`);
  if (d.flags?.includes('no_depart')) out.push('لم يُسجَّل الانصراف');
  if (d.flags?.includes('no_checkin')) out.push('لم يُسجَّل الحضور');
  if (d.flags?.includes('exit_no_return')) out.push('خروج بلا عودة');
  if (d.outsideContract) out.push('خارج مدة العقد');
  if (d.moves?.some((m) => m.manual)) out.push('تعديل يدوي');
  return out;
}
