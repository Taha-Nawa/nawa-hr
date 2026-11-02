/**
 * السجل اليومي «ماذا أنجزت اليوم»: سطر سريع لكل إنجاز أو اجتماع أو تدريب/نشاط خارجي أو مهمة قادمة.
 * خاص بصاحبه بالكامل (لا مدير ولا موارد بشرية ولا مسؤول)؛ المشترك هو التقرير الشهري الذي يستورد منه صاحبه ويقدّمه.
 * لا يُسجَّل في سجل التدقيق (ملاحظات عمل شخصية، ولئلا يمتلئ السجل بأسطر يومية).
 */
import { json, localDate, nowOf } from './util.js';
import { tzOf } from './close.js';
import { isMonth, monthBounds } from '../engine/monthly-report.js';
import { validateEntry, LIMITS } from '../engine/work-log.js';

const COLS = 'id, date, kind, title, status, details, place, importance, end_date AS endDate';

export function registerWorkLogRoutes(add, kit) {
  const { bad, forbidden, notFound, readJson } = kit;
  const unlinked = () => json({ ok: false, error: 'حسابك غير مرتبط ببطاقة موظف، اطلب من مسؤول النظام ربطه' }, 403);

  add('GET', '/api/work-log', async ({ db, user, url }) => {
    if (user.employeeId == null) return unlinked();
    const month = url.searchParams.get('month');
    if (!isMonth(month)) return bad('الشهر غير صالح (YYYY-MM)');
    const { from, to } = monthBounds(month);
    const rows = (await db.prepare(`SELECT ${COLS} FROM work_log WHERE employee_id = ? AND date >= ? AND date <= ? ORDER BY date, id LIMIT ?`)
      .bind(user.employeeId, from, to, LIMITS.perMonth).all()).results;
    return json({ ok: true, month, entries: rows });
  });

  add('POST', '/api/work-log', async ({ request, db, user, env }) => {
    if (user.employeeId == null) return unlinked();
    const { body, error } = await readJson(request);
    if (error) return error;
    const today = localDate(tzOf(env), nowOf(env));
    const v = validateEntry(body, today);
    if (!v.ok) return bad(v.error);
    const e = v.value;
    const { from, to } = monthBounds(e.date.slice(0, 7));
    const n = await db.prepare('SELECT COUNT(*) AS n FROM work_log WHERE employee_id = ? AND date >= ? AND date <= ?').bind(user.employeeId, from, to).first('n');
    if (n >= LIMITS.perMonth) return bad(`بلغ السجل الحد الأقصى لهذا الشهر (${LIMITS.perMonth} سطراً)`);
    const res = await db.prepare(
      'INSERT INTO work_log (employee_id, date, kind, title, status, details, place, importance, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(user.employeeId, e.date, e.kind, e.title, e.status, e.details, e.place, e.importance, e.endDate).run();
    return json({ ok: true, entry: { id: res.meta.last_row_id, ...e } }, 201);
  });

  add('PATCH', '/api/work-log/:id', async ({ request, db, user, env, params }) => {
    if (user.employeeId == null) return unlinked();
    const id = Number(params.id);
    const cur = await db.prepare(`SELECT ${COLS}, employee_id AS owner FROM work_log WHERE id = ?`).bind(id).first();
    if (!cur) return notFound('السطر');
    if (cur.owner !== user.employeeId) return forbidden();
    const { body, error } = await readJson(request);
    if (error) return error;
    const merged = { ...cur, ...body };
    if (body.endDate === undefined) merged.endDate = cur.endDate;
    const v = validateEntry(merged, localDate(tzOf(env), nowOf(env)));
    if (!v.ok) return bad(v.error);
    const e = v.value;
    await db.prepare("UPDATE work_log SET date = ?, kind = ?, title = ?, status = ?, details = ?, place = ?, importance = ?, end_date = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(e.date, e.kind, e.title, e.status, e.details, e.place, e.importance, e.endDate, id).run();
    return json({ ok: true, entry: { id, ...e } });
  });

  add('DELETE', '/api/work-log/:id', async ({ db, user, params }) => {
    if (user.employeeId == null) return unlinked();
    const id = Number(params.id);
    const cur = await db.prepare('SELECT employee_id AS owner FROM work_log WHERE id = ?').bind(id).first();
    if (!cur) return notFound('السطر');
    if (cur.owner !== user.employeeId) return forbidden();
    await db.prepare('DELETE FROM work_log WHERE id = ?').bind(id).run();
    return json({ ok: true });
  });
}
