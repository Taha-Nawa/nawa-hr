/**
 * لوحة اليوم الذكية: بيانات مجمّعة تتغير حسب الدور. المجموع محصور بنطاق المستخدم (employeeScope)، فالمدير يرى فريقه والموظف نفسه.
 *  - /api/dashboard/trend : اتجاه الحضور اليومي لآخر N يوماً (حاضر/متأخر/غياب/إجازة/عطلة/بلا نتيجة) لرسم الاتجاه ونسبة الشهر.
 *  - /api/dashboard/alerts: تنبيهات إدارية للموارد البشرية والمدير العام والمسؤول (عودة الأمومة، انتهاء عقود).
 */
import { json, localDate, nowOf, addDays } from './util.js';
import { tzOf } from './close.js';
import { employeeScope, can } from './authz.js';
import { returnDateOf, hourEndOf } from '../engine/maternity.js';

const MAX_DAYS = 45;

export function registerDashboardRoutes(add, kit) {
  const { bad, forbidden } = kit;

  add('GET', '/api/dashboard/trend', async ({ env, db, user, url }) => {
    const n = Number(url.searchParams.get('days') || 14);
    if (!Number.isInteger(n) || n < 1 || n > MAX_DAYS) return bad(`عدد الأيام بين 1 و${MAX_DAYS}`);
    const to = localDate(tzOf(env), nowOf(env));
    const from = addDays(to, -(n - 1));
    const scope = employeeScope(user, 'e');
    const rows = (await db.prepare(
      `SELECT r.date,
         SUM(r.status = 'حاضر') AS present, SUM(r.status = 'متأخر') AS late, SUM(r.status = 'غياب') AS absent,
         SUM(r.status IN ('عطلة أسبوعية', 'عطلة رسمية')) AS off,
         SUM(r.status IS NOT NULL AND r.status NOT IN ('حاضر', 'متأخر', 'غياب', 'عطلة أسبوعية', 'عطلة رسمية')) AS leave,
         SUM(r.late_minutes) AS lateMinutes, SUM(r.approved_hours) AS approved, SUM(r.required_hours) AS required, SUM(r.overtime_hours) AS overtime
       FROM daily_results r JOIN employees e ON e.id = r.employee_id AND e.status = 'active'
       WHERE r.date BETWEEN ? AND ? AND ${scope.sql} GROUP BY r.date ORDER BY r.date`,
    ).bind(from, to, ...scope.params).all()).results;
    return json({ ok: true, from, to, days: rows.map((r) => ({ ...r, present: r.present || 0, late: r.late || 0, absent: r.absent || 0, off: r.off || 0, leave: r.leave || 0, lateMinutes: r.lateMinutes || 0, approved: Math.round((r.approved || 0) * 100) / 100, required: Math.round((r.required || 0) * 100) / 100, overtime: Math.round((r.overtime || 0) * 100) / 100 })) });
  });

  add('GET', '/api/dashboard/alerts', async ({ env, db, user }) => {
    if (!(can(user, 'employee.update') || ['director', 'admin'].includes(user.role))) return forbidden();
    const today = localDate(tzOf(env), nowOf(env));
    const soon = addDays(today, 30);
    let maternity = [];
    try {
      const rows = (await db.prepare("SELECT m.id, m.employee_id AS employeeId, m.delivery_date AS deliveryDate, m.leave_days AS leaveDays, m.hour_pos AS hourPos, e.name FROM maternity m JOIN employees e ON e.id = m.employee_id WHERE e.status = 'active'").all()).results;
      maternity = rows.map((r) => ({ ...r, returnDate: returnDateOf(r), hourEnd: hourEndOf(r) }))
        .filter((r) => (r.returnDate >= today && r.returnDate <= addDays(today, 14)) || (r.hourPos === null && r.returnDate < today && r.hourEnd >= today) || (r.hourPos && r.hourEnd >= today && r.hourEnd <= soon))
        .map((r) => ({ employeeId: r.employeeId, name: r.name, returnDate: r.returnDate, hourEnd: r.hourEnd, hourPos: r.hourPos, state: r.returnDate >= today ? 'returning' : r.hourPos === null ? 'needs_hour' : 'hour_ending' }))
        .sort((a, b) => (a.returnDate < b.returnDate ? -1 : 1));
    } catch { /* الترحيل 0025 لم يُطبَّق */ }
    const [providers, staff] = await Promise.all([
      db.prepare("SELECT id, name, contract_end AS endDate FROM providers WHERE active = 1 AND contract_end BETWEEN ? AND ? ORDER BY contract_end").bind(today, soon).all(),
      db.prepare("SELECT id, name, end_date AS endDate FROM employees WHERE status = 'active' AND end_date IS NOT NULL AND end_date BETWEEN ? AND ? ORDER BY end_date").bind(today, soon).all(),
    ]);
    return json({ ok: true, today, maternity, providersEnding: providers.results, staffEnding: staff.results });
  });
}
