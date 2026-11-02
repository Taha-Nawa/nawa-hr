// حضور المتطوعين: تحقق اليوم وحساب الساعات. نقي بلا اعتماد على قاعدة البيانات.
import { toMin } from './attendance.js';
import { isTime } from '../worker/util.js';

const clean = (v) => (v === undefined || v === null || v === '' ? null : v);
const round2 = (n) => Math.round(n * 100) / 100;

/** يتحقق من يوم واحد ويعيد { ok, value:{arrive, depart, exit, ret, reason} } أو { error }. كل الحقول اختيارية. */
export function validateVolunteerDay(d) {
  const arrive = clean(d?.arrive);
  const depart = clean(d?.depart);
  const exit = clean(d?.exit);
  const ret = clean(d?.ret);
  const reason = clean(d?.reason) === null ? null : String(d.reason).trim().slice(0, 80) || null;
  for (const [label, t] of [['الوصول', arrive], ['الانصراف', depart], ['المغادرة', exit], ['العودة', ret]]) {
    if (t !== null && !isTime(t)) return { error: `وقت ${label} غير صالح` };
  }
  if (depart && !arrive) return { error: 'سجّل ساعة الوصول قبل الانصراف' };
  if (arrive && depart && toMin(depart) <= toMin(arrive)) return { error: 'الانصراف يجب أن يكون بعد الوصول' };
  if (ret && !exit) return { error: 'العودة بلا مغادرة' };
  if (exit && !arrive) return { error: 'سجّل ساعة الوصول قبل المغادرة' };
  if (exit && toMin(exit) < toMin(arrive)) return { error: 'المغادرة قبل الوصول' };
  if (exit && depart && toMin(exit) > toMin(depart)) return { error: 'المغادرة بعد الانصراف' };
  if (ret && toMin(ret) <= toMin(exit)) return { error: 'العودة يجب أن تكون بعد المغادرة' };
  if (ret && depart && toMin(ret) > toMin(depart)) return { error: 'العودة بعد الانصراف' };
  return { ok: true, value: { arrive, depart, exit, ret, reason } };
}

/** ساعات يوم: (الانصراف − الوصول) − (العودة − المغادرة). 0 إن لم يكتمل الوصول والانصراف. */
export function volunteerHours(day) {
  if (!day?.arrive || !day?.depart) return 0;
  let m = toMin(day.depart) - toMin(day.arrive);
  if (day.exit && day.ret) m -= toMin(day.ret) - toMin(day.exit);
  return round2(Math.max(0, m) / 60);
}

export function monthTotals(days) {
  const present = days.filter((d) => d.arrive);
  return { days: present.length, hours: round2(present.reduce((s, d) => s + volunteerHours(d), 0)) };
}
