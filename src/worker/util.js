/** أدوات مشتركة صغيرة. لا اعتماد على أي مكتبة (قيد 10 مللي ثانية CPU في الخطة المجانية). */

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 32 بايت عشوائي بصيغة hex (رموز الأجهزة والجلسات) */
export function randomToken(bytes = 32) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

export function isTime(s) {
  if (typeof s !== 'string' || !/^\d{2}:\d{2}$/.test(s)) return false;
  const [h, m] = s.split(':').map(Number);
  return h <= 23 && m <= 59;
}

/** عرض وقت HH:MM بنظام 12 ساعة (ص/م) للرسائل والبريد؛ التخزين يبقى 24 ساعة. (نسخة مطابقة لـ public/js/time12.js) */
export function fmt12(hhmm) {
  if (hhmm === null || hhmm === undefined || hhmm === '') return '';
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(hhmm));
  if (!m) return String(hhmm);
  const hr = Number(m[1]);
  if (hr > 23 || Number(m[2]) > 59) return String(hhmm);
  return `${hr % 12 === 0 ? 12 : hr % 12}:${m[2]} ${hr < 12 ? 'ص' : 'م'}`;
}

/** قصّ نص إلى طول أقصى (أو null) */
export function clip(v, max) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s.slice(0, max);
}

/** تاريخ اليوم بتوقيت المنطقة (YYYY-MM-DD). المنطقة من إعداد النشر TIMEZONE (الافتراضي القدس/الخليل). */
export function localDate(tz = 'Asia/Hebron', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(date, n) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/** الآن (للاختبارات فقط يمكن تثبيته بـ env.__NOW؛ لا يوجد هذا المتغيّر في النشر الحقيقي). */
export function nowOf(env) {
  return env?.__NOW ? new Date(env.__NOW) : new Date();
}

/** الوقت الحالي HH:MM بتوقيت المنطقة. */
export function localTime(tz = 'Asia/Hebron', now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
}
