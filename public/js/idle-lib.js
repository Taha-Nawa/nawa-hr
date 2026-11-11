// وضع السكون: منطق صرف (بلا DOM) ليُختبر بسهولة.
// بعد REST_MS بلا استعمال تظهر شاشة هادئة بالساعة وفانوس حكمة، وبعد LOCK_MS يُقفل النظام ويُطلب الـ PIN.
import { ITEMS, dayNumber, itemFor } from './daily-pop-lib.js';

export const REST_MS = 5 * 60_000;
export const LOCK_MS = 90 * 60_000;

/** مرحلة الخمول من مدته بالمللي ثانية: active | rest | lock. المدة السالبة (ساعة رجعت للوراء) تُعدّ نشاطاً. */
export function idleStage(ms) {
  if (!(ms >= REST_MS)) return 'active';
  return ms >= LOCK_MS ? 'lock' : 'rest';
}

/** حكمة السكون: تختلف عن حكمة الصباح لليوم نفسه، وتتبدّل كل ساعة حتى لا تتكرر في كل سكون. */
export function idleItem(date, hour = 0) {
  const today = itemFor(date);
  const n = ITEMS.length;
  let i = (dayNumber(date) + 7 + hour * 3) % n;
  if (ITEMS[i] === today) i = (i + 1) % n;
  return ITEMS[i];
}
