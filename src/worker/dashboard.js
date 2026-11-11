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

  // يحتاج متابعة: من تكرر غيابه أو تأخره منذ أول الشهر حتى أمس (اليوم لم ينتهِ بعد)، مرتّبين، مع نسبة الالتزام بالساعات
  add('GET', '/api/dashboard/watch', async ({ env, db, user }) => {
    const today = localDate(tzOf(env), nowOf(env));
    const first = `${today.slice(0, 7)}-01`;
    const to = addDays(today, -1);
    if (to < first) return json({ ok: true, from: first, to, people: [], totals: { approved: 0, required: 0, pct: null } });
    const scope = employeeScope(user, 'e');
    const rows = (await db.prepare(
      `SELECT e.id, e.name, c.name AS center,
         SUM(r.status = 'غياب') AS absent, SUM(r.status = 'متأخر') AS late, SUM(r.late_minutes) AS lateMinutes,
         SUM(r.approved_hours) AS approved, SUM(r.required_hours) AS required
       FROM daily_results r JOIN employees e ON e.id = r.employee_id AND e.status = 'active' LEFT JOIN centers c ON c.id = e.center_id
       WHERE r.date BETWEEN ? AND ? AND ${scope.sql} GROUP BY e.id`,
    ).bind(first, to, ...scope.params).all()).results;
    const approved = rows.reduce((s, r) => s + (r.approved || 0), 0);
    const required = rows.reduce((s, r) => s + (r.required || 0), 0);
    const people = rows.filter((r) => r.absent > 0 || r.late > 1)
      .sort((a, b) => b.absent - a.absent || b.lateMinutes - a.lateMinutes || b.late - a.late).slice(0, 8)
      .map((r) => ({ id: r.id, name: r.name, center: r.center, absent: r.absent || 0, late: r.late || 0, lateMinutes: r.lateMinutes || 0 }));
    return json({ ok: true, from: first, to, people, totals: { approved: Math.round(approved * 10) / 10, required: Math.round(required * 10) / 10, pct: required > 0 ? Math.round((approved / required) * 100) : null } });
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
