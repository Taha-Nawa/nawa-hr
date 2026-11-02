/**
 * المتطوعون وحضورهم الشهري (قرار 2 نوفمبر 2026): قائمة متطوعين لكل مركز، وكشف شهري لكل متطوع يُدخَل ويُطبع
 * بصيغة «كشف حضور وغياب / جمعية نوى للثقافة والفنون». الصلاحية: الموارد البشرية والمسؤول يديران، والمدير العام يطّلع.
 */
import { json, clip, isDate, addDays } from './util.js';
import { can } from './authz.js';
import { validateVolunteerDay, volunteerHours, monthTotals } from '../engine/volunteers.js';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthBounds = (m) => {
  const from = `${m}-01`;
  const next = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1)).toISOString().slice(0, 10);
  return { from, to: addDays(next, -1) };
};
const toDay = (r) => ({ date: r.date, arrive: r.arrive, depart: r.depart, exit: r.exit_at, ret: r.return_at, reason: r.reason });

export function registerVolunteerRoutes(add, kit) {
  const { bad, forbidden, notFound, readJson, auditStmt } = kit;

  add('GET', '/api/volunteers', async ({ db, user, url }) => {
    if (!can(user, 'volunteer.read')) return forbidden();
    const month = url.searchParams.get('month');
    if (month !== null && !MONTH_RE.test(month)) return bad('الشهر غير صالح (YYYY-MM)');
    const list = (await db.prepare(
      `SELECT v.id, v.name, v.center_id AS centerId, c.name AS center, v.project, v.coordinator, v.phone, v.active
         FROM volunteers v LEFT JOIN centers c ON c.id = v.center_id ORDER BY v.active DESC, c.name, v.name`,
    ).all()).results;
    let totals = new Map();
    if (month) {
      const { from, to } = monthBounds(month);
      const rows = (await db.prepare('SELECT volunteer_id AS id, date, arrive, depart, exit_at, return_at FROM volunteer_days WHERE date >= ? AND date <= ?').bind(from, to).all()).results;
      const by = new Map();
      for (const r of rows) (by.get(r.id) || by.set(r.id, []).get(r.id)).push(toDay(r));
      totals = new Map([...by].map(([id, days]) => [id, monthTotals(days)]));
    }
    return json({ ok: true, canEdit: can(user, 'volunteer.manage'), volunteers: list.map((v) => ({ ...v, ...(month ? { month: totals.get(v.id) || { days: 0, hours: 0 } } : {}) })) });
  });

  const readBody = async (request) => {
    const { body, error } = await readJson(request);
    if (error) return { error };
    const name = clip(body.name, 120);
    if (body.name !== undefined && !name) return { bad: 'اكتب اسم المتطوع' };
    return { body, name };
  };

  add('POST', '/api/volunteers', async ({ request, db, user }) => {
    if (!can(user, 'volunteer.manage')) return forbidden();
    const r = await readBody(request);
    if (r.error) return r.error;
    if (r.bad || !r.name) return bad(r.bad || 'اكتب اسم المتطوع');
    const centerId = r.body.centerId === null || r.body.centerId === undefined || r.body.centerId === '' ? null : Number(r.body.centerId);
    if (centerId !== null && !(await db.prepare('SELECT 1 FROM centers WHERE id = ?').bind(centerId).first())) return bad('المركز غير موجود');
    const res = await db.prepare('INSERT INTO volunteers (name, center_id, project, coordinator, phone) VALUES (?, ?, ?, ?, ?)')
      .bind(r.name, centerId, clip(r.body.project, 120), clip(r.body.coordinator, 120), clip(r.body.phone, 40)).run();
    const id = res.meta.last_row_id;
    await auditStmt(db, user, 'volunteer.create', 'volunteer', id, { name: r.name, centerId }).run();
    return json({ ok: true, id }, 201);
  });

  add('PATCH', '/api/volunteers/:id', async ({ request, db, user, params }) => {
    if (!can(user, 'volunteer.manage')) return forbidden();
    const id = Number(params.id);
    const cur = await db.prepare('SELECT * FROM volunteers WHERE id = ?').bind(id).first();
    if (!cur) return notFound('المتطوع');
    const r = await readBody(request);
    if (r.error) return r.error;
    if (r.bad) return bad(r.bad);
    const b = r.body;
    const centerId = b.centerId === undefined ? cur.center_id : b.centerId === null || b.centerId === '' ? null : Number(b.centerId);
    if (centerId !== null && !(await db.prepare('SELECT 1 FROM centers WHERE id = ?').bind(centerId).first())) return bad('المركز غير موجود');
    await db.batch([
      db.prepare('UPDATE volunteers SET name = ?, center_id = ?, project = ?, coordinator = ?, phone = ?, active = ? WHERE id = ?').bind(
        r.name ?? cur.name, centerId,
        b.project === undefined ? cur.project : clip(b.project, 120),
        b.coordinator === undefined ? cur.coordinator : clip(b.coordinator, 120),
        b.phone === undefined ? cur.phone : clip(b.phone, 40),
        b.active === undefined ? cur.active : b.active ? 1 : 0, id),
      auditStmt(db, user, 'volunteer.update', 'volunteer', id, { name: r.name ?? cur.name, active: b.active }),
    ]);
    return json({ ok: true });
  });

  add('GET', '/api/volunteers/:id/month', async ({ db, user, params, url }) => {
    if (!can(user, 'volunteer.read')) return forbidden();
    const id = Number(params.id);
    const month = url.searchParams.get('month');
    if (!MONTH_RE.test(month || '')) return bad('الشهر غير صالح (YYYY-MM)');
    const v = await db.prepare('SELECT v.id, v.name, v.project, v.coordinator, c.name AS center FROM volunteers v LEFT JOIN centers c ON c.id = v.center_id WHERE v.id = ?').bind(id).first();
    if (!v) return notFound('المتطوع');
    const { from, to } = monthBounds(month);
    const rows = (await db.prepare('SELECT date, arrive, depart, exit_at, return_at, reason FROM volunteer_days WHERE volunteer_id = ? AND date >= ? AND date <= ? ORDER BY date').bind(id, from, to).all()).results;
    const days = rows.map((r) => ({ ...toDay(r), hours: volunteerHours(toDay(r)) }));
    return json({ ok: true, volunteer: v, month, from, to, days, totals: monthTotals(days) });
  });

  // يحفظ الشهر كله: الأيام المرسَلة تُحفظ (أو تُحذف إن كانت فارغة)، وما لم يُرسل يبقى كما هو.
  add('PUT', '/api/volunteers/:id/month', async ({ request, db, user, params }) => {
    if (!can(user, 'volunteer.manage')) return forbidden();
    const id = Number(params.id);
    const { body, error } = await readJson(request);
    if (error) return error;
    if (!MONTH_RE.test(body?.month || '')) return bad('الشهر غير صالح (YYYY-MM)');
    if (!Array.isArray(body.days) || body.days.length > 31) return bad('أيام الشهر غير صالحة');
    const v = await db.prepare('SELECT id FROM volunteers WHERE id = ?').bind(id).first();
    if (!v) return notFound('المتطوع');
    const { from, to } = monthBounds(body.month);
    const keep = [];
    const drop = [];
    const seen = new Set();
    for (const d of body.days) {
      if (!isDate(d?.date) || d.date < from || d.date > to) return bad(`تاريخ خارج الشهر: ${d?.date}`);
      if (seen.has(d.date)) return bad(`تاريخ مكرر: ${d.date}`);
      seen.add(d.date);
      const val = validateVolunteerDay(d);
      if (val.error) return bad(`${d.date}: ${val.error}`);
      const x = val.value;
      if (!x.arrive && !x.depart && !x.exit && !x.ret && !x.reason) drop.push(d.date);
      else keep.push({ date: d.date, ...x });
    }
    const stmts = [];
    if (keep.length) {
      stmts.push(db.prepare(
        `INSERT INTO volunteer_days (volunteer_id, date, arrive, depart, exit_at, return_at, reason, updated_by)
         SELECT ?1, json_extract(j.value, '$.date'), json_extract(j.value, '$.arrive'), json_extract(j.value, '$.depart'), json_extract(j.value, '$.exit'), json_extract(j.value, '$.ret'), json_extract(j.value, '$.reason'), ?2
           FROM json_each(?3) j WHERE true
         ON CONFLICT(volunteer_id, date) DO UPDATE SET arrive = excluded.arrive, depart = excluded.depart, exit_at = excluded.exit_at, return_at = excluded.return_at, reason = excluded.reason, updated_by = excluded.updated_by, updated_at = datetime('now')`,
      ).bind(id, user.email, JSON.stringify(keep)));
    }
    if (drop.length) stmts.push(db.prepare('DELETE FROM volunteer_days WHERE volunteer_id = ? AND date IN (SELECT value FROM json_each(?))').bind(id, JSON.stringify(drop)));
    stmts.push(auditStmt(db, user, 'volunteer.month', 'volunteer', id, { month: body.month, saved: keep.length, removed: drop.length }));
    await db.batch(stmts);
    return json({ ok: true, saved: keep.length, removed: drop.length });
  });
}
