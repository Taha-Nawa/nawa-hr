/**
 * رسائل البوب: تنشرها الموارد البشرية أو المسؤول للموظفين (الكل أو مراكز أو أشخاص بعينهم) لمدة محددة كالستوري.
 * تظهر للموظف مرة واحدة عند فتح النظام ثم تُسجَّل مشاهدتها فلا تتكرر، وتنتهي وحدها بانتهاء المدة أو تُسحب يدوياً.
 * تُعرض للمستخدم المرتبط بموظف فقط (الحساب بلا موظف لا يراها).
 */
import { json, clip, nowOf } from './util.js';
import { can } from './authz.js';

const MAX_BODY = 400;
const MAX_HOURS = 24 * 30;

const parseIds = (s) => { try { const a = JSON.parse(s); return Array.isArray(a) ? a.map(Number) : []; } catch { return []; } };

export function registerAnnouncementRoutes(add, kit) {
  const { bad, forbidden, notFound, readJson, auditStmt } = kit;

  // ما يخصّ المستخدم ولم يره بعد
  add('GET', '/api/announcements/active', async ({ env, db, user }) => {
    if (user.employeeId == null) return json({ ok: true, items: [] });
    const now = nowOf(env).toISOString();
    let rows = [];
    try {
      rows = (await db.prepare(
        `SELECT a.id, a.title, a.body, a.ends_at, a.audience, a.audience_ids FROM announcements a
         WHERE a.revoked = 0 AND a.starts_at <= ?1 AND a.ends_at > ?1
           AND NOT EXISTS (SELECT 1 FROM announcement_seen s WHERE s.announcement_id = a.id AND s.user_id = ?2)
         ORDER BY a.id`).bind(now, user.id).all()).results;
    } catch { return json({ ok: true, items: [] }); } // الترحيل 0029 لم يُطبَّق
    const emp = await db.prepare('SELECT center_id AS centerId FROM employees WHERE id = ?').bind(user.employeeId).first();
    const mine = rows.filter((r) => {
      if (r.audience === 'all') return true;
      const ids = parseIds(r.audience_ids);
      return r.audience === 'center' ? ids.includes(Number(emp?.centerId)) : ids.includes(user.employeeId);
    });
    return json({ ok: true, items: mine.map((r) => ({ id: r.id, title: r.title, body: r.body, endsAt: r.ends_at })) });
  });

  add('POST', '/api/announcements/:id/seen', async ({ db, user, params }) => {
    const id = Number(params.id);
    try {
      await db.prepare('INSERT OR IGNORE INTO announcement_seen (announcement_id, user_id) SELECT id, ?2 FROM announcements WHERE id = ?1').bind(id, user.id).run();
    } catch { /* الترحيل 0029 لم يُطبَّق */ }
    return json({ ok: true });
  });

  // ---- الإدارة
  add('GET', '/api/announcements', async ({ env, db, user }) => {
    if (!can(user, 'announce.manage')) return forbidden();
    const now = nowOf(env).toISOString();
    let rows = [];
    try {
      rows = (await db.prepare(
        `SELECT a.*, (SELECT COUNT(*) FROM announcement_seen s WHERE s.announcement_id = a.id) AS seen FROM announcements a ORDER BY a.id DESC LIMIT 40`).all()).results;
    } catch { return json({ ok: true, items: [] }); }
    const total = await db.prepare("SELECT COUNT(*) AS n FROM employees WHERE status = 'active'").first('n');
    const centers = new Map((await db.prepare('SELECT id, name FROM centers').all()).results.map((c) => [c.id, c.name]));
    const items = [];
    for (const r of rows) {
      const ids = parseIds(r.audience_ids);
      let target = total;
      let audienceText = 'كل الموظفين';
      if (r.audience === 'center') {
        target = await db.prepare(`SELECT COUNT(*) AS n FROM employees WHERE status = 'active' AND center_id IN (${ids.map(() => '?').join(',') || 'NULL'})`).bind(...ids).first('n');
        audienceText = `مراكز: ${ids.map((i) => centers.get(i) || i).join('، ')}`;
      } else if (r.audience === 'employees') { target = ids.length; audienceText = `${ids.length} موظفاً محدَّداً`; }
      const status = r.revoked ? 'revoked' : r.ends_at <= now ? 'ended' : r.starts_at > now ? 'scheduled' : 'live';
      items.push({ id: r.id, title: r.title, body: r.body, startsAt: r.starts_at, endsAt: r.ends_at, audience: r.audience, audienceText, status, seen: r.seen, target });
    }
    return json({ ok: true, items });
  });

  add('POST', '/api/announcements', async ({ env, request, db, user }) => {
    if (!can(user, 'announce.manage')) return forbidden();
    const { body, error } = await readJson(request);
    if (error) return error;
    const text = clip(body.body, MAX_BODY);
    if (!text || text.length < 2) return bad('اكتب نص الرسالة');
    const hours = Number(body.hours);
    if (!Number.isFinite(hours) || hours < 1 || hours > MAX_HOURS) return bad(`المدة بالساعات بين 1 و${MAX_HOURS}`);
    const audience = ['all', 'center', 'employees'].includes(body.audience) ? body.audience : null;
    if (!audience) return bad('اختر الفئة المستهدفة');
    let ids = [];
    if (audience !== 'all') {
      ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(Number))].filter((n) => Number.isInteger(n) && n > 0);
      if (!ids.length) return bad(audience === 'center' ? 'اختر مركزاً واحداً على الأقل' : 'اختر موظفاً واحداً على الأقل');
      if (ids.length > 400) return bad('عدد كبير: اختر المركز بدل تحديد الأشخاص');
    }
    const start = nowOf(env);
    const end = new Date(start.getTime() + hours * 3600000);
    const title = clip(body.title, 80);
    const r = await db.prepare('INSERT INTO announcements (title, body, starts_at, ends_at, audience, audience_ids, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(title || null, text, start.toISOString(), end.toISOString(), audience, JSON.stringify(ids), user.email || null).run();
    await auditStmt(db, user, 'announcement.add', 'announcement', String(r.meta.last_row_id), { audience, hours, count: ids.length }).run();
    return json({ ok: true, id: r.meta.last_row_id, endsAt: end.toISOString() });
  });

  // سحب الرسالة قبل انتهاء مدتها
  add('DELETE', '/api/announcements/:id', async ({ db, user, params }) => {
    if (!can(user, 'announce.manage')) return forbidden();
    const id = Number(params.id);
    const row = await db.prepare('SELECT id FROM announcements WHERE id = ?').bind(id).first();
    if (!row) return notFound('الرسالة');
    await db.prepare('UPDATE announcements SET revoked = 1 WHERE id = ?').bind(id).run();
    await auditStmt(db, user, 'announcement.revoke', 'announcement', String(id), {}).run();
    return json({ ok: true });
  });
}
