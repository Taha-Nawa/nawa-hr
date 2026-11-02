/**
 * كشف الحضور والانصراف للطباعة (يطابق نموذج «كشف الحضور والانصراف» الأسبوعي): أوقات كل موظف في فترة قصيرة
 * (حتى 31 يوماً) لمركز أو لكل من يحق للمستخدم رؤيته. القراءة مقيَّدة بنطاق المستخدم كبقية التقارير.
 */
import { json, isDate, daysBetween } from './util.js';
import { employeeScope } from './authz.js';

const MAX_DAYS = 31;
const MAX_EMPLOYEES = 300;

export function registerSheetRoutes(add, kit) {
  const { bad } = kit;

  add('GET', '/api/attendance/sheet', async ({ db, user, url }) => {
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to') || from;
    if (!isDate(from) || !isDate(to)) return bad('التاريخ غير صالح');
    const span = daysBetween(from, to) + 1;
    if (span < 1 || span > MAX_DAYS) return bad(`الفترة من يوم إلى ${MAX_DAYS} يوماً`);
    const centerRaw = url.searchParams.get('center');
    const centerId = centerRaw === null || centerRaw === '' ? null : Number(centerRaw);
    if (centerId !== null && !Number.isInteger(centerId)) return bad('المركز غير صالح');

    const scope = employeeScope(user, 'e');
    const emps = (await db.prepare(
      `SELECT e.id, e.code, e.name, e.center_id AS centerId, c.name AS center
         FROM employees e LEFT JOIN centers c ON c.id = e.center_id
        WHERE e.status = 'active' AND ${scope.sql} ${centerId === null ? '' : 'AND e.center_id = ?'}
        ORDER BY e.code LIMIT ${MAX_EMPLOYEES + 1}`,
    ).bind(...scope.params, ...(centerId === null ? [] : [centerId])).all()).results;
    if (emps.length > MAX_EMPLOYEES) return bad('عدد الموظفين كبير: اختر مركزاً');
    if (!emps.length) return json({ ok: true, from, to, employees: [] });

    const rows = (await db.prepare(
      `SELECT employee_id AS e, date, day_type AS dayType, check_in AS checkIn, exit_first AS exitFirst, return_last AS returnLast, departure, status
         FROM daily_results WHERE date >= ? AND date <= ? AND employee_id IN (SELECT value FROM json_each(?))`,
    ).bind(from, to, JSON.stringify(emps.map((e) => e.id))).all()).results;
    const by = new Map();
    for (const r of rows) {
      if (!by.has(r.e)) by.set(r.e, {});
      by.get(r.e)[r.date] = { dayType: r.dayType, checkIn: r.checkIn, exitFirst: r.exitFirst, returnLast: r.returnLast, departure: r.departure, status: r.status };
    }
    return json({ ok: true, from, to, employees: emps.map((e) => ({ ...e, days: by.get(e.id) || {} })) });
  });
}
