/**
 * إقفال اليوم وإعادة الحساب الشاملة.
 * - closeDay: كل ليلة (مهمة مجدولة) يُحسب «أمس» لكل موظف فعّال، فيظهر الغياب والعطل رغم عدم وجود حركات.
 * - recomputeSlice: شريحة من (موظف × يوم) بلا حالة على الخادم: العميل يكرّر الاستدعاء بإزاحة متزايدة حتى النهاية.
 *   هذا يبقي كل طلب ضمن حدود D1/Workers المجانية (≈4 استعلامات و≤100 يوماً لكل شريحة).
 */
import { loadWorkSettings } from './settings.js';
import { recomputePairs } from './recompute.js';
import { addDays, daysBetween, localDate } from './util.js';

export const SLICE = 100;

export const tzOf = (env) => env.TIMEZONE || 'Asia/Hebron';

/** هل الموظف على رأس عمله في هذا اليوم؟ (لا غياب قبل التعيين أو بعد انتهاء الخدمة) */
export function eligible(emp, date) {
  return (!emp.start_date || emp.start_date <= date) && (!emp.end_date || emp.end_date >= date);
}

export async function closeDay(env, date) {
  const d = date || addDays(localDate(tzOf(env)), -1);
  const settings = await loadWorkSettings(env.DB);
  if (!settings) return { date: d, skipped: 'settings_missing' };
  const emps = (await env.DB.prepare("SELECT id, start_date, end_date FROM employees WHERE status = 'active'").all()).results;
  const pairs = emps.filter((e) => eligible(e, d)).map((e) => ({ e: e.id, d }));
  const written = await recomputePairs(env.DB, pairs, settings);
  await env.DB.prepare("INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES ('system', 'close-day', 'day', ?, ?)")
    .bind(d, JSON.stringify({ employees: written })).run();
  return { date: d, employees: written };
}

/**
 * from..to شاملة، ولا تتجاوز اليوم (لا نسجّل غياباً لأيام لم تأتِ بعد).
 * offset: ترتيب الزوج (موظف، يوم) الذي نبدأ منه؛ الترتيب: الموظفون بالـ id ثم الأيام تصاعدياً.
 */
export async function recomputeSlice(env, { from, to, offset = 0 }) {
  const settings = await loadWorkSettings(env.DB);
  if (!settings) return { error: 'settings_missing' };
  const today = localDate(tzOf(env));
  const last = to > today ? today : to;
  const days = last < from ? 0 : daysBetween(from, last) + 1;
  const emps = (await env.DB.prepare("SELECT id, start_date, end_date FROM employees WHERE status = 'active' ORDER BY id").all()).results;
  const total = emps.length * days;
  const pairs = [];
  let k = offset;
  for (; k < total && k < offset + SLICE; k++) {
    const emp = emps[Math.floor(k / days)];
    const d = addDays(from, k % days);
    if (eligible(emp, d)) pairs.push({ e: emp.id, d });
  }
  const written = await recomputePairs(env.DB, pairs, settings);
  return { processed: k - offset, written, total, nextOffset: k < total ? k : null };
}
