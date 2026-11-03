// بطاقة الموظف: دوال نقية (بلا DOM) كي تُختبر على Node.

const strip = (w) => w.replace(/^ال/, '');

/** حرفا الأفقية: أول حرف من الاسم الأول وأول حرف من آخر كلمة (دون «ال» والألقاب مثل «أ.» و«د.»). «منى خالد العطار» ← «م.ع» */
export function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter((w) => w && !/\.$/.test(w));
  if (!words.length) return '؟';
  const first = [...words[0]][0];
  if (words.length === 1) return first;
  const last = [...strip(words[words.length - 1]) || words[words.length - 1]][0];
  return `${first}.${last}`;
}

const years = (n) => (n === 1 ? 'سنة' : n === 2 ? 'سنتان' : n <= 10 ? `${n} سنوات` : `${n} سنة`);
const months = (n) => (n === 1 ? 'شهر' : n === 2 ? 'شهران' : n <= 10 ? `${n} أشهر` : `${n} شهراً`);

/**
 * مدة الخدمة نصاً عربياً («3 سنوات و8 أشهر»): من تاريخ التعيين إلى انتهاء الخدمة إن انتهت، وإلا إلى اليوم.
 * التواريخ بصيغة YYYY-MM-DD. تُرجع '' إن لم يُعرف تاريخ التعيين.
 */
export function serviceSpan(start, end, today) {
  if (!start) return '';
  const stop = end && end < today ? end : today;
  if (start > stop) return 'لم تبدأ الخدمة بعد';
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = stop.split('-').map(Number);
  const total = (ey - sy) * 12 + (em - sm) - (ed < sd ? 1 : 0);
  if (total < 1) return 'أقل من شهر';
  const y = Math.floor(total / 12);
  const m = total % 12;
  return [y ? years(y) : '', m ? months(m) : ''].filter(Boolean).join(' و');
}

/** التوزيعات السارية في تاريخ معيّن مرتبة بالأكبر نسبة: [{ funder, percent }] (النسبة مئوية بكسرين عشريين). */
export function activeAllocations(allocations, today) {
  return (allocations || [])
    .filter((a) => a.share > 0 && (!a.from || a.from <= today) && (!a.to || a.to >= today))
    .map((a) => ({ funder: a.funder, percent: Math.round(a.share * 10000) / 100 }))
    .sort((a, b) => b.percent - a.percent);
}

/**
 * ملخّص مشاريع الموظف من توزيعه الساري اليوم (المصدر الوحيد للحقيقة؛ نص «المشروع / الممول» في بيانات الموظف وصف قديم قد لا يطابقه).
 * { count, names, short, full }: short للشارة («3 مشاريع» أو اسم المشروع الوحيد)، وfull للنموذج («ضمن 3 مشاريع: أ + ب + ج»).
 * count = 0 إن لم يكن له توزيع ساريّ اليوم، فيبقى النص القديم هو المعروض.
 */
export function projectSummary(allocations, today) {
  const names = [...new Set(activeAllocations(allocations, today).map((x) => x.funder))];
  const n = names.length;
  if (!n) return { count: 0, names, short: '', full: '' };
  const word = n === 2 ? 'مشروعين' : `${n} مشاريع`;
  return { count: n, names, short: n === 1 ? names[0] : n === 2 ? 'مشروعان' : word, full: n === 1 ? names[0] : `ضمن ${word}: ${names.join(' + ')}` };
}

/** «2023-03-01» ← «01/03/2023» */
export const dmy = (date) => (date ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : '');

const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;

/**
 * يفحص رابط صورة الموظف ويطبّعه قبل الحفظ. الصورة لا تُرفع ولا تُخزَّن عندنا: يُحفظ الرابط نصاً فقط ويحمّلها المتصفح من مصدرها.
 * يُرجع { url } (null إن كان فارغاً) أو { error }. يقبل https فقط، ويحوّل روابط المشاركة إلى روابط صورة مباشرة:
 *   - Google Drive (file/d/ID أو open?id=ID أو uc?id=ID) ← drive.google.com/thumbnail
 *   - OneDrive الشخصي (1drv.ms وonedrive.live.com) ← api.onedrive.com/v1.0/shares/u!…/root/content
 *   - OneDrive for Business وSharePoint (*.sharepoint.com) ← الرابط نفسه مع download=1
 * الرابط يجب أن يكون مشاركة «أي شخص لديه الرابط»؛ معاينة نموذج الموظف تُظهر فوراً هل يعمل.
 */
export function photoUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { url: null };
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { error: 'الرابط غير صالح' };
  }
  if (u.protocol !== 'https:') return { error: 'الرابط يجب أن يبدأ بـ https://' };
  if (u.username || u.password) return { error: 'الرابط غير صالح' };
  const host = u.hostname.toLowerCase();
  let url = raw;
  if (host === 'drive.google.com' || host === 'docs.google.com') {
    const id = (u.pathname.match(/\/d\/([^/]+)/) || [])[1] || u.searchParams.get('id');
    if (!id || !DRIVE_ID.test(id)) return { error: 'رابط Google Drive غير مفهوم؛ انسخ رابط المشاركة من الملف نفسه' };
    url = `https://drive.google.com/thumbnail?id=${id}&sz=w400`;
  } else if (host === '1drv.ms' || host === 'onedrive.live.com') {
    const b64 = btoa(u.href).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    url = `https://api.onedrive.com/v1.0/shares/u!${b64}/root/content`;
  } else if (host.endsWith('.sharepoint.com')) {
    u.searchParams.set('download', '1');
    url = u.href;
  }
  if (url.length > 500) return { error: 'الرابط أطول من 500 حرف' };
  return { url };
}
