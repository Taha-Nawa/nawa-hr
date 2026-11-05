/**
 * الدوام الاستثنائي: موظف داوم في يوم عطلة (أسبوعية أو رسمية) بتكليف، مرة أو عدة مرات.
 *  - تسجّله الموارد البشرية/المسؤول لموظف ويوم، مع التعويض المتفق عليه (بلا / أجر إضافي / يوم بديل) وملاحظة.
 *  - «يُحتسب» (الافتراضي): يصير اليوم يوم عمل لهذا الموظف، فتتوزّع ساعاته المعتمدة على المشاريع في التايم شيت ويزول تظليله.
 *    غير محتسب: تسجيل فقط، ويبقى حساب اليوم كما هو (الزائد إضافي).
 *  - لا يُسجَّل ليوم دوام عادي، ولا ليوم لم يأتِ. الإلغاء يعيد حساب اليوم. كل عملية في سجل التدقيق.
 */
import { loadWorkSettings } from './settings.js';
import { recomputePairs } from './recompute.js';
import { tzOf } from './close.js';
import { json, isDate, clip, localDate, addDays } from './util.js';
import { can } from './authz.js';
import { dayTypeOf, DAY_WORK } from '../engine/attendance.js';

const MAX_BACK_DAYS = 366;
const COMPS = ['none', 'paid', 'leave'];

export function registerExceptionRoutes(add, kit) {
  const { bad, forbidden, notFound, readJson, auditStmt } = kit;

  add('GET', '/api/work-exceptions', async ({ db, user, url }) => {
    if (!can(user, 'settings.read')) return forbidden();
    const month = url.searchParams.get('month');
    const emp = Number(url.searchParams.get('employeeId'));
    const where = [];
    const params = [];
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      where.push('x.date LIKE ?');
      params.push(`${month}-%`);
    }
    if (Number.isInteger(emp) && emp > 0) {
      where.push('x.employee_id = ?');
      params.push(emp);
    }
    const rows = (
      await db
        .prepare(
          `SELECT x.employee_id AS employeeId, e.name, e.code, x.date, x.counted, x.comp, x.note, x.by_email AS byEmail, x.at,
                  r.net_hours AS netHours, r.approved_hours AS approvedHours, r.overtime_hours AS overtimeHours
           FROM work_exceptions x JOIN employees e ON e.id = x.employee_id
           LEFT JOIN daily_results r ON r.employee_id = x.employee_id AND r.date = x.date
           ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY x.date DESC, e.name LIMIT 200`,
        )
        .bind(...params)
        .all()
    ).results.map((r) => ({ ...r, counted: !!r.counted }));
    return json({ ok: true, exceptions: rows, canManage: can(user, 'exception.manage') });
  });

  add('POST', '/api/work-exceptions', async ({ env, db, user, request }) => {
    if (!can(user, 'exception.manage')) return forbidden();
    const { body, error } = await readJson(request);
    if (error) return error;
    const settings = await loadWorkSettings(db);
    if (!settings) return bad('إعدادات الدوام غير مكتملة', 409);

    const employeeId = Number(body?.employeeId);
    const date = body?.date;
    if (!Number.isInteger(employeeId) || !isDate(date)) return bad('الموظف أو التاريخ غير صالح');
    const today = localDate(tzOf(env));
    if (date > today) return bad('لا يُسجَّل دوام استثنائي ليوم لم يأتِ بعد');
    if (date < addDays(today, -MAX_BACK_DAYS)) return bad('التاريخ أقدم من المسموح');
    const emp = await db.prepare('SELECT id, start_date AS s, end_date AS e FROM employees WHERE id = ?').bind(employeeId).first();
    if (!emp) return notFound();
    if ((emp.s && emp.s > date) || (emp.e && emp.e < date)) return bad('الموظف ليس على رأس عمله في هذا التاريخ');

    const hol = await db.prepare('SELECT 1 FROM holidays WHERE date = ?').bind(date).first();
    if (dayTypeOf(date, settings, new Set(hol ? [date] : [])) === DAY_WORK) return bad('هذا يوم دوام عادي وليس عطلة');

    const counted = body.counted === false || body.counted === 0 ? 0 : 1;
    const comp = body.comp ? String(body.comp) : 'none';
    if (!COMPS.includes(comp)) return bad('التعويض غير صالح');
    const note = clip(body.note, 300) || null;

    await db.batch([
      db
        .prepare(
          `INSERT INTO work_exceptions (employee_id, date, counted, comp, note, by_email) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(employee_id, date) DO UPDATE SET counted = excluded.counted, comp = excluded.comp, note = excluded.note,
             by_email = excluded.by_email, at = datetime('now')`,
        )
        .bind(employeeId, date, counted, comp, note, user.email),
      auditStmt(db, user, 'exception.set', 'work_exception', employeeId, { date, counted, comp, note }),
    ]);
    await recomputePairs(db, [{ e: employeeId, d: date }], settings);
    return json({ ok: true }, 201);
  });

  add('POST', '/api/work-exceptions/cancel', async ({ db, user, request }) => {
    if (!can(user, 'exception.manage')) return forbidden();
    const { body, error } = await readJson(request);
    if (error) return error;
    const employeeId = Number(body?.employeeId);
    const date = body?.date;
    if (!Number.isInteger(employeeId) || !isDate(date)) return bad('الموظف أو التاريخ غير صالح');
    const ex = await db.prepare('SELECT 1 FROM work_exceptions WHERE employee_id = ? AND date = ?').bind(employeeId, date).first();
    if (!ex) return notFound();
    await db.batch([
      db.prepare('DELETE FROM work_exceptions WHERE employee_id = ? AND date = ?').bind(employeeId, date),
      auditStmt(db, user, 'exception.cancel', 'work_exception', employeeId, { date }),
    ]);
    const settings = await loadWorkSettings(db);
    if (settings) await recomputePairs(db, [{ e: employeeId, d: date }], settings);
    return json({ ok: true });
  });
}
