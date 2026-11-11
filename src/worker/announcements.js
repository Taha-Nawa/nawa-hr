/**
 * رسائل البوب: تنشرها الموارد البشرية أو المسؤول للموظفين (الكل أو مراكز أو أشخاص بعينهم) لمدة محددة كالستوري.
 * ولكل مسؤول فريق (منسق مشروع، مدير مباشر…) أن يرسل لفريقه فقط (كل من تحته في الشجرة، أو أشخاص منهم) ويدير رسائله وحدها.
 * تظهر للموظف مرة واحدة عند فتح النظام ثم تُسجَّل مشاهدتها فلا تتكرر، وتنتهي وحدها بانتهاء المدة أو تُسحب يدوياً.
 * تُعرض للمستخدم المرتبط بموظف فقط (الحساب بلا موظف لا يراها).
 */
import { json, clip, nowOf } from './util.js';
import { can } from './authz.js';

/** أشكال البوب (تطابق SHAPES في public/js/daily-pop-lib.js؛ يتحقق اختبار من التطابق). */
export const POP_SHAPES = ['lantern', 'bubble', 'arch', 'orb', 'scroll'];
const SUBTREE = `WITH RECURSIVE sub(id, depth) AS (
  SELECT id, 1 FROM employees WHERE manager_id = ?1 AND status = 'active' AND id <> ?1
  UNION SELECT e.id, s.depth + 1 FROM employees e JOIN sub s ON e.manager_id = s.id WHERE s.depth < 8 AND e.status = 'active' AND e.id <> ?1
) `;
const MAX_BODY = 400;
const MAX_HOURS = 24 * 30;
const MAX_AHEAD_DAYS = 90;

const parseIds = (s) => { try { const a = JSON.parse(s); return Array.isArray(a) ? a.map(Number) : []; } catch { return []; } };

export function registerAnnouncementRoutes(add, kit) {
  const { bad, forbidden, notFound, readJson, auditStmt } = kit;

  async function shapeOf(db) {
    try {
      const row = await db.prepare("SELECT value FROM settings WHERE key = 'pop_style'").first();
      const shape = row ? JSON.parse(row.value).shape : null;
      return POP_SHAPES.includes(shape) ? shape : POP_SHAPES[0];
    } catch { return POP_SHAPES[0]; }
  }

  const teamIds = async (db, empId) => (empId == null ? [] : (await db.prepare(`${SUBTREE} SELECT id FROM sub`).bind(empId).all()).results.map((r) => r.id));
  const isAdmin = (user) => can(user, 'announce.manage');

  // ما يستطيعه المستخدم: الكل (الموارد البشرية/المسؤول) وحجم فريقه
  add('GET', '/api/announcements/scope', async ({ db, user }) => {
    const team = await teamIds(db, user.employeeId);
    return json({ ok: true, all: isAdmin(user), team: team.length });
  });

  add('GET', '/api/pop-style', async ({ db }) => json({ ok: true, shape: await shapeOf(db), shapes: POP_SHAPES }));
  add('PUT', '/api/pop-style', async ({ request, db, user }) => {
    if (!can(user, 'announce.manage')) return forbidden();
    const { body, error } = await readJson(request);
    if (error) return error;
    if (!POP_SHAPES.includes(body.shape)) return bad('شكل غير معروف');
    await db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('pop_style', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(JSON.stringify({ shape: body.shape })).run();
    await auditStmt(db, user, 'popstyle.set', 'settings', 'pop_style', { shape: body.shape }).run();
    return json({ ok: true, shape: body.shape });
  });

  // ما يخصّ المستخدم ولم يره بعد (ومعه شكل البوب المعتمد)
  add('GET', '/api/announcements/active', async ({ env, db, user }) => {
    const shape = await shapeOf(db);
    if (user.employeeId == null) return json({ ok: true, items: [], shape });
    const now = nowOf(env).toISOString();
    let rows = [];
    try {
      rows = (await db.prepare(
        `SELECT a.id, a.title, a.body, a.ends_at, a.audience, a.audience_ids, a.sender_id, se.name AS fromName FROM announcements a LEFT JOIN employees se ON se.id = a.sender_id
         WHERE a.revoked = 0 AND a.starts_at <= ?1 AND a.ends_at > ?1
           AND NOT EXISTS (SELECT 1 FROM announcement_seen s WHERE s.announcement_id = a.id AND s.user_id = ?2)
         ORDER BY a.id`).bind(now, user.id).all()).results;
    } catch { return json({ ok: true, items: [], shape }); } // الترحيل 0029 لم يُطبَّق
    const emp = await db.prepare('SELECT center_id AS centerId FROM employees WHERE id = ?').bind(user.employeeId).first();
    const bossCache = new Map(); // مرسِل → هل المستخدم في فريقه
    const inTeam = async (sender) => {
      if (!bossCache.has(sender)) bossCache.set(sender, (await teamIds(db, sender)).includes(user.employeeId));
      return bossCache.get(sender);
    };
    const mine = [];
    for (const r of rows) {
      const ids = parseIds(r.audience_ids);
      let ok;
      if (r.audience === 'all') ok = true;
      else if (r.audience === 'center') ok = ids.includes(Number(emp?.centerId));
      else if (r.audience === 'team') ok = r.sender_id != null && r.sender_id !== user.employeeId && (await inTeam(r.sender_id));
      else ok = ids.includes(user.employeeId);
      if (ok) mine.push(r);
    }
    return json({ ok: true, items: mine.map((r) => ({ id: r.id, title: r.title, body: r.body, endsAt: r.ends_at, from: r.sender_id != null ? r.fromName || null : null })), shape });
  });

  add('POST', '/api/announcements/:id/seen', async ({ db, user, params }) => {
    const id = Number(params.id);
    try {
      await db.prepare('INSERT OR IGNORE INTO announcement_seen (announcement_id, user_id) SELECT id, ?2 FROM announcements WHERE id = ?1').bind(id, user.id).run();
    } catch { /* الترحيل 0029 لم يُطبَّق */ }
    return json({ ok: true });
  });

  // ---- الإدارة: الموارد البشرية والمسؤول يرون كل الرسائل، ومسؤول الفريق يرى رسائله فقط
  add('GET', '/api/announcements', async ({ env, db, user }) => {
    const admin = isAdmin(user);
    if (!admin && !(await teamIds(db, user.employeeId)).length) return forbidden();
    const now = nowOf(env).toISOString();
    let rows = [];
    try {
      rows = (await db.prepare(
        `SELECT a.*, (SELECT COUNT(*) FROM announcement_seen s WHERE s.announcement_id = a.id) AS seen FROM announcements a ${admin ? '' : 'WHERE a.created_by = ?1'} ORDER BY a.id DESC LIMIT 40`)
        .bind(...(admin ? [] : [user.email])).all()).results;
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
      } else if (r.audience === 'team') { target = (await teamIds(db, r.sender_id)).length; audienceText = 'فريقه كاملاً'; }
      else if (r.audience === 'employees') { target = ids.length; audienceText = `${ids.length} موظفاً محدَّداً`; }
      const status = r.revoked ? 'revoked' : r.ends_at <= now ? 'ended' : r.starts_at > now ? 'scheduled' : 'live';
      items.push({ id: r.id, title: r.title, body: r.body, startsAt: r.starts_at, endsAt: r.ends_at, audience: r.audience, audienceText, status, seen: r.seen, target });
    }
    return json({ ok: true, items });
  });

  add('POST', '/api/announcements', async ({ env, request, db, user }) => {
    const admin = isAdmin(user);
    const team = await teamIds(db, user.employeeId);
    if (!admin && !team.length) return forbidden();
    const { body, error } = await readJson(request);
    if (error) return error;
    const text = clip(body.body, MAX_BODY);
    if (!text || text.length < 2) return bad('اكتب نص الرسالة');
    // وقت الظهور والاختفاء: startsAt وendsAt (تاريخ وساعة)، أو hours من الآن للتوافق مع الاستعمال السابق
    const now = nowOf(env);
    let start;
    let end;
    if (body.endsAt !== undefined) {
      const parse = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v) : null);
      end = parse(body.endsAt);
      start = body.startsAt ? parse(body.startsAt) : now;
      if (!end || !start || Number.isNaN(+end) || Number.isNaN(+start)) return bad('وقت الظهور أو الاختفاء غير صالح');
      if (start < now) start = now; // بداية في الماضي = الآن
      if (start.getTime() > now.getTime() + MAX_AHEAD_DAYS * 86400000) return bad(`لا يُجدوَل الظهور أبعد من ${MAX_AHEAD_DAYS} يوماً`);
      if (end <= start) return bad('وقت الاختفاء يجب أن يكون بعد وقت الظهور');
      if (end.getTime() - start.getTime() > MAX_HOURS * 3600000) return bad('أقصى مدة ظهور شهر واحد');
      if (end.getTime() - start.getTime() < 5 * 60000) return bad('أقل مدة ظهور 5 دقائق');
    } else {
      const hours = Number(body.hours);
      if (!Number.isFinite(hours) || hours < 1 || hours > MAX_HOURS) return bad(`المدة بالساعات بين 1 و${MAX_HOURS}`);
      start = now;
      end = new Date(start.getTime() + hours * 3600000);
    }
    const audience = ['all', 'center', 'employees', 'team'].includes(body.audience) ? body.audience : null;
    if (!audience) return bad('اختر الفئة المستهدفة');
    if (!admin && !['team', 'employees'].includes(audience)) return forbidden(); // مسؤول الفريق لفريقه فقط
    if (audience === 'team' && !team.length) return bad('لا فريق لك لترسل إليه');
    let ids = [];
    if (audience === 'center' || audience === 'employees') {
      ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(Number))].filter((n) => Number.isInteger(n) && n > 0);
      if (!ids.length) return bad(audience === 'center' ? 'اختر مركزاً واحداً على الأقل' : 'اختر موظفاً واحداً على الأقل');
      if (ids.length > 400) return bad('عدد كبير: اختر المركز بدل تحديد الأشخاص');
      if (!admin && ids.some((i) => !team.includes(i))) return forbidden(); // أشخاص من فريقه فقط
    }
    const title = clip(body.title, 80);
    // الرسالة الصادرة من مسؤول فريق أو الموجَّهة لفريق تحمل اسم مرسِلها؛ رسائل الإدارة العامة تبقى «من الإدارة»
    const sender = !admin || audience === 'team' ? user.employeeId : null;
    const r = await db.prepare('INSERT INTO announcements (title, body, starts_at, ends_at, audience, audience_ids, created_by, sender_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(title || null, text, start.toISOString(), end.toISOString(), audience, JSON.stringify(ids), user.email || null, sender).run();
    await auditStmt(db, user, 'announcement.add', 'announcement', String(r.meta.last_row_id), { audience, startsAt: start.toISOString(), endsAt: end.toISOString(), count: ids.length }).run();
    return json({ ok: true, id: r.meta.last_row_id, startsAt: start.toISOString(), endsAt: end.toISOString() });
  });

  // سحب الرسالة قبل انتهاء مدتها: الإدارة أي رسالة، ومسؤول الفريق رسائله فقط
  add('DELETE', '/api/announcements/:id', async ({ db, user, params }) => {
    const id = Number(params.id);
    const row = await db.prepare('SELECT id, created_by FROM announcements WHERE id = ?').bind(id).first();
    if (!row) return notFound('الرسالة');
    if (!isAdmin(user) && row.created_by !== user.email) return forbidden();
    await db.prepare('UPDATE announcements SET revoked = 1 WHERE id = ?').bind(id).run();
    await auditStmt(db, user, 'announcement.revoke', 'announcement', String(id), {}).run();
    return json({ ok: true });
  });
}
