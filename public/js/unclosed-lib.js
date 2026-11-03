// «لم يسجّلوا الانصراف»: دوال نقية (بلا DOM) لتسمية الأيام ووصف آخر حركة.
import { AR_DAYS, AR_MONTHS } from './dom.js';

const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** «اليوم» / «أمس» / «الأحد 1 نوفمبر» */
export function dayLabel(date, today) {
  if (date === today) return 'اليوم';
  if (date === addDays(today, -1)) return 'أمس';
  const d = new Date(`${date}T00:00:00Z`);
  return `${AR_DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${AR_MONTHS[d.getUTCMonth()]}`;
}

const MOVE_WORD = { حضور: 'حضور', خروج: 'مغادرة', عودة: 'عودة', انصراف: 'انصراف' };

/** وصف سطر الشخص: «حضور 8:30 ص — آخر حركة: مغادرة 11:00 ص (لم يعد)». fmt: دالة تنسيق الوقت (12 ساعة). */
export function movePhrase(item, fmt = (t) => t) {
  const parts = [];
  if (item.checkIn) parts.push(`حضور ${fmt(item.checkIn)}`);
  if (item.lastType && item.lastType !== 'حضور' && item.lastTime) {
    parts.push(`آخر حركة: ${MOVE_WORD[item.lastType] || item.lastType} ${fmt(item.lastTime)}${item.lastType === 'خروج' ? ' (لم يعد)' : ''}`);
  }
  return parts.join(' — ');
}

/** ما يُكتب على الشارة: العدد الكلي، ونبرة التحذير إن وُجد من الأيام السابقة. */
export function badgeOf(data) {
  const total = data?.total || 0;
  return { n: total, warn: (data?.past || 0) > 0 };
}
