/**
 * ترويسات الشعارات للتقرير الشهري: مجموعات مسمّاة، في كل منها شعارات لكل منها موضع (يمين/وسط/يسار) وعرض بالملّيمتر.
 * تُخزَّن صوراً مصغّرة (data URL) في settings['report_header']؛ وعند الطباعة يختار المستخدم «بلا ترويسة» أو إحدى المجموعات (والافتراضية تُحدَّد من المحرّر).
 * القراءة لكل مستخدم مسجّل (يحتاجها من يطبع تقريره)، والكتابة لـ header.manage.
 */
import { json, clip } from './util.js';
import { can } from './authz.js';

export const MAX_LOGOS = 4;
export const MAX_LOGO_CHARS = 160_000;
const MAX_REQUEST = 1_800_000;
const POS = ['right', 'center', 'left'];
const DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export const MAX_SETS = 6;

function validateLogos(list) {
  if (!Array.isArray(list)) return { error: 'قائمة الشعارات غير صالحة' };
  if (list.length > MAX_LOGOS) return { error: `الحد الأقصى ${MAX_LOGOS} شعارات في الترويسة` };
  const logos = [];
  for (const l of list) {
    if (typeof l?.data !== 'string' || !DATA_URL.test(l.data) || l.data.length > MAX_LOGO_CHARS) return { error: 'صورة شعار غير صالحة أو كبيرة (استعمل PNG أو JPG أو WebP صغيراً)' };
    if (!POS.includes(l.pos)) return { error: 'موضع الشعار غير صالح' };
    const width = Number(l.width);
    if (!Number.isFinite(width) || width < 8 || width > 90) return { error: 'عرض الشعار بين 8 و90 مم' };
    logos.push({ name: clip(l.name, 40) || 'شعار', data: l.data, pos: l.pos, width: Math.round(width * 10) / 10 });
  }
  return { logos };
}

/** { sets: [{id, name, logos}], default: id|null } — مجموعات ترويسات مسمّاة؛ «بلا ترويسة» اختيار دائم عند الطباعة لا يُخزَّن. */
export function validateHeader(input) {
  if (!Array.isArray(input?.sets)) return { error: 'قائمة الترويسات غير صالحة' };
  if (input.sets.length > MAX_SETS) return { error: `الحد الأقصى ${MAX_SETS} ترويسات` };
  const sets = [];
  const ids = new Set();
  for (const s of input.sets) {
    const id = clip(s?.id, 20);
    const name = clip(s?.name, 40);
    if (!id || ids.has(id)) return { error: 'معرّف الترويسة غير صالح' };
    if (!name) return { error: 'سمِّ كل ترويسة' };
    const v = validateLogos(s.logos);
    if (v.error) return { error: v.error };
    ids.add(id);
    sets.push({ id, name, logos: v.logos });
  }
  const def = input.default && ids.has(input.default) ? input.default : null;
  return { header: { sets, default: def } };
}

export function registerReportHeaderRoutes(add, { bad, forbidden, auditStmt }) {
  add('GET', '/api/report-header', async ({ db, user }) => {
    if (!user) return forbidden();
    const row = await db.prepare("SELECT value FROM settings WHERE key = 'report_header'").first();
    let header = { sets: [], default: null };
    try {
      if (row) header = JSON.parse(row.value);
    } catch {
      header = { sets: [], default: null };
    }
    if (!Array.isArray(header.sets)) header = { sets: [], default: null };
    return json({ ok: true, header, canEdit: can(user, 'header.manage'), max: MAX_LOGOS, maxSets: MAX_SETS });
  });

  add('PUT', '/api/report-header', async ({ db, user, request }) => {
    if (!can(user, 'header.manage')) return forbidden();
    const text = await request.text();
    if (text.length > MAX_REQUEST) return bad('الطلب أكبر من المسموح', 413);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return bad('صيغة الطلب غير صالحة');
    }
    const v = validateHeader(body);
    if (v.error) return bad(v.error);
    await db.batch([
      db.prepare("INSERT INTO settings (key, value) VALUES ('report_header', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(JSON.stringify(v.header)),
      // لا نكتب الصور في سجل التدقيق: الأسماء والمواضع والأعراض فقط
      auditStmt(db, user, 'settings.report_header', 'settings', 'report_header', { default: v.header.default, sets: v.header.sets.map((x) => ({ name: x.name, logos: x.logos.map(({ name, pos, width }) => ({ name, pos, width })) })) }),
    ]);
    return json({ ok: true, header: v.header });
  });
}
