/**
 * صفحة «الروابط»: مكان واحد داخل النظام لكل روابط التشغيل (البوابة، الجداول، المجلدات، المستودعات، لوحات الاستضافة).
 * القائمة تُخزَّن في جدول settings (المفتاح 'links') ويعدّلها المسؤول من الصفحة نفسها بلا تعديل في الشيفرة.
 * الروابط الخاصة (جداول Google، لوحة Cloudflare) تُضاف بالبيانات لا بالشيفرة لأن المستودع عام.
 * لكل رابط جمهور: all = كل من سجّل دخوله، staff = الموارد البشرية والمدير العام والمسؤول، admin = المسؤول فقط.
 * الفلترة تتم في الخادم: ما لا يحق للدور رؤيته لا يصله أصلاً.
 */
import { clip } from './util.js';
import { randomToken } from './util.js';

export const AUDIENCES = ['all', 'staff', 'admin'];
export const MAX_LINKS = 60;

const STAFF = new Set(['hr', 'director', 'admin']);

export const GATE_URL = 'https://nawa-hr.nawa-attendance.workers.dev/gate/';
const OLD_GATE_URL = 'https://tahaat.github.io/nawa-attendance/';

/** روابط عامة وغير حساسة تظهر قبل أن يعدّل المسؤول أي شيء. */
export const DEFAULT_LINKS = [
  { id: 'kiosk', group: 'البوابة', title: 'صفحة تسجيل الحضور (تُفتح على جهاز البوابة)', url: GATE_URL, note: 'بوابة النظام الجديد: افتحها على جهاز المركز ثم أضفها إلى الشاشة الرئيسية. تعمل للموظفين ومزوّدي الخدمة والمتطوعين.', audience: 'staff' },
  { id: 'badges', group: 'البوابة', title: 'طباعة بطاقات الموظفين', url: 'https://tahaat.github.io/nawa-attendance/badges.html', note: 'تقرأ قائمة الموظفين وتطبع بطاقات QR.', audience: 'staff' },
  { id: 'repo-gate', group: 'التقنية', title: 'مستودع صفحة البوابة (GitHub)', url: 'https://github.com/tahaat/nawa-attendance', note: 'حساب tahaat. أي تعديل على index.html ينشر فوراً على الأجهزة.', audience: 'admin' },
  { id: 'repo-hr', group: 'التقنية', title: 'مستودع نظام نوى للشؤون الإدارية (GitHub)', url: 'https://github.com/Taha-Nawa/nawa-hr', note: 'الدفع إلى main يشغّل الاختبارات ثم النشر التلقائي.', audience: 'admin' },
];

export function visibleTo(role, link) {
  if (link.audience === 'all') return true;
  if (link.audience === 'staff') return STAFF.has(role);
  return role === 'admin';
}

function cleanUrl(v) {
  const s = String(v ?? '').trim();
  if (s.length === 0 || s.length > 600 || /\s/.test(s)) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && u.hostname.includes('.') ? u.href : null;
  } catch {
    return null;
  }
}

/** يُرجع { links } منظّفة أو { error }. المعرّفات المفقودة تُولَّد، والمكرر يُرفض. */
export function validateLinks(input) {
  if (!Array.isArray(input)) return { error: 'قائمة الروابط مطلوبة' };
  if (input.length > MAX_LINKS) return { error: `الحد الأقصى ${MAX_LINKS} رابطاً` };
  const seen = new Set();
  const links = [];
  for (const [i, l] of input.entries()) {
    const n = i + 1;
    const title = clip(l?.title, 120);
    if (!title) return { error: `الرابط ${n}: العنوان مطلوب` };
    const url = cleanUrl(l?.url);
    if (!url) return { error: `الرابط ${n}: يجب أن يكون عنوان https صالحاً` };
    const audience = l?.audience ?? 'staff';
    if (!AUDIENCES.includes(audience)) return { error: `الرابط ${n}: الجمهور غير معروف` };
    let id = typeof l?.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(l.id) ? l.id : randomToken(5);
    if (seen.has(id)) id = randomToken(5);
    seen.add(id);
    links.push({ id, group: clip(l?.group, 60) || 'أخرى', title, url, note: clip(l?.note, 300) || '', audience });
  }
  return { links };
}

export async function loadLinks(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'links'").first();
  if (!row) return DEFAULT_LINKS;
  try {
    const v = validateLinks(JSON.parse(row.value));
    // رابط البوابة القديم المحفوظ سابقاً يُستبدل تلقائياً برابط بوابة النظام الجديد
    return v.links?.map((l) => (l.id === 'kiosk' && l.url === OLD_GATE_URL ? { ...l, url: GATE_URL, note: DEFAULT_LINKS[0].note } : l)) ?? DEFAULT_LINKS;
  } catch {
    return DEFAULT_LINKS;
  }
}
