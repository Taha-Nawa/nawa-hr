/**
 * التقارير الشهرية. حالياً: التايم شيت الشهري للموظف (ملف الممولين) بقواعد شيت «monthly timesheet» في ملف الإدارة.
 * يُرجع البيانات منظّمة (JSON) والمتصفح يبني ملف الإكسل، فلا تُستهلك حصة المعالج في الخادم على توليد الملفات.
 */
import { json } from './util.js';
import { loadMaternityMap, applyMatHours } from './maternity.js';
import { loadWorkSettings } from './settings.js';
import { toMin } from '../engine/attendance.js';
import { buildTimesheet, daysInMonth, mergeTimesheetConfig } from '../engine/timesheet.js';
import { employeeScope } from './authz.js';

export const MAX_TIMESHEET_EMPLOYEES = 25;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

const bad = (msg, status = 400) => json({ ok: false, error: msg }, status);
/** يحوّل علامات ? المجهولة إلى ?N مرقّمة ابتداءً من from، كي لا تتداخل مع ?1 المستعمل أعلاه. */
const numbered = (sql, from) => {
  let n = from - 1;
  return sql.replace(/\?/g, () => `?${++n}`);
};

export async function timesheetReport({ db, user, url }) {
  const m = MONTH_RE.exec(url.searchParams.get('month') || '');
  if (!m) return bad('الشهر غير صالح (الصيغة YYYY-MM)');
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < 2020 || year > 2100) return bad('السنة خارج المدى');

  const ids = [...new Set((url.searchParams.get('employees') || '').split(',').filter(Boolean).map(Number))];
  if (ids.length === 0 || ids.some((n) => !Number.isInteger(n) || n <= 0)) return bad('حدّد موظفاً واحداً على الأقل');
  if (ids.length > MAX_TIMESHEET_EMPLOYEES) return bad(`الحد الأقصى ${MAX_TIMESHEET_EMPLOYEES} موظفاً في الطلب الواحد`);

  const settings = await loadWorkSettings(db);
  if (!settings) return bad('إعدادات الدوام غير مكتملة', 409);
  const dayHours = (toMin(settings.end) - toMin(settings.start)) / 60;

  const first = `${m[1]}-${m[2]}-01`;
  const last = `${m[1]}-${m[2]}-${String(daysInMonth(year, month)).padStart(2, '0')}`;
  const idsJson = JSON.stringify(ids);
  const scope = employeeScope(user, 'e');

  const emps = (
    await db
      .prepare(
        `SELECT e.id, e.code, e.name, e.name_en AS nameEn, e.job_title_en AS jobTitleEn, e.manager_label_en AS managerLabelEn,
                c.name AS center, c.name_en AS centerEn, mg.name_en AS managerNameEn, mg.job_title_en AS managerTitleEn
         FROM employees e
         LEFT JOIN centers c ON c.id = e.center_id
         LEFT JOIN employees mg ON mg.id = e.manager_id
         WHERE e.id IN (SELECT value FROM json_each(?1)) AND ${numbered(scope.sql, 2)}
         ORDER BY e.code`,
      )
      .bind(idsJson, ...scope.params)
      .all()
  ).results;
  if (emps.length !== ids.length) return bad('موظف غير موجود أو خارج صلاحيتك', 403);

  const [allocs, days, approver, cfgRow] = await Promise.all([
    db
      .prepare(
        `SELECT employee_id AS employeeId, funder, share, from_date AS "from", to_date AS "to"
         FROM employee_projects WHERE employee_id IN (SELECT value FROM json_each(?1)) AND from_date <= ?2 AND to_date >= ?3 ORDER BY employee_id, id`,
      )
      .bind(idsJson, last, first)
      .all(),
    db
      .prepare(
        `SELECT r.employee_id AS employeeId, r.date, r.day_type AS dayType, r.approved_hours AS approvedHours, o.leave_type AS leaveType, x.employee_id IS NOT NULL AS exceptional
         FROM daily_results r
         LEFT JOIN day_overrides o ON o.employee_id = r.employee_id AND o.date = r.date
         LEFT JOIN work_exceptions x ON x.employee_id = r.employee_id AND x.date = r.date AND x.counted = 1
         WHERE r.employee_id IN (SELECT value FROM json_each(?1)) AND r.date BETWEEN ?2 AND ?3`,
      )
      .bind(idsJson, first, last)
      .all(),
    db
      .prepare("SELECT name_en AS nameEn FROM employees WHERE status = 'active' AND job_title_en LIKE '%Finance%' AND job_title_en LIKE '%Manager%' ORDER BY code LIMIT 1")
      .first(),
    db.prepare("SELECT value FROM settings WHERE key = 'timesheet'").first(),
  ]);
  let config = null;
  try {
    config = mergeTimesheetConfig(cfgRow ? JSON.parse(cfgRow.value) : null);
  } catch {
    config = null;
  }

  const allocBy = new Map();
  for (const a of allocs.results) allocBy.set(a.employeeId, [...(allocBy.get(a.employeeId) || []), a]);
  const daysBy = new Map();
  for (const d of days.results) {
    if (!daysBy.has(d.employeeId)) daysBy.set(d.employeeId, {});
    daysBy.get(d.employeeId)[d.date] = { dayType: d.dayType, approvedHours: d.approvedHours, leaveType: d.leaveType || '', exceptional: !!d.exceptional };
  }

  applyMatHours(daysBy, await loadMaternityMap(db, ids));

  const sheets = emps.map((e) => ({
    employee: {
      id: e.id,
      code: e.code,
      name: e.nameEn || e.name,
      post: e.jobTitleEn || '',
      place: e.centerEn || e.center || '',
      supervisor: e.managerLabelEn || (e.managerNameEn ? [e.managerNameEn, e.managerTitleEn].filter(Boolean).join(' – ') : ''),
    },
    timesheet: buildTimesheet({ year, month, days: daysBy.get(e.id) || {}, allocations: allocBy.get(e.id) || [], dayHours, config }),
  }));
  return json({ ok: true, month: `${m[1]}-${m[2]}`, approver: approver?.nameEn || '', sheets });
}
