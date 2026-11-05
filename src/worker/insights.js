/**
 * لوحات المراجعة للموارد البشرية والإدارة:
 *  - GET /api/insights/funders?month=YYYY-MM : تسوية الممولين — ساعات كل ممول/مشروع في الشهر من التايم شيت نفسه، وعدد موظفيه، وموظفون بتوزيع ناقص.
 *  - GET /api/insights/integrity : سلامة البيانات — نواقص تعطّل التقارير (أسماء إنجليزية، مدير، توزيع المشاريع، بطاقة، بوابة، أيام بلا انصراف).
 * قراءة فقط.
 */
import { json, localDate, addDays } from './util.js';
import { can } from './authz.js';
import { tzOf } from './close.js';
import { loadWorkSettings } from './settings.js';
import { toMin } from '../engine/attendance.js';
import { buildTimesheet, daysInMonth, mergeTimesheetConfig } from '../engine/timesheet.js';

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const EPS = 0.001;

export function registerInsightRoutes(add, { bad, forbidden }) {
  add('GET', '/api/insights/funders', async ({ db, user, url }) => {
    if (!can(user, 'insights.read')) return forbidden();
    const m = MONTH_RE.exec(url.searchParams.get('month') || '');
    if (!m) return bad('الشهر غير صالح (الصيغة YYYY-MM)');
    const settings = await loadWorkSettings(db);
    if (!settings) return bad('إعدادات الدوام غير مكتملة', 409);
    const year = Number(m[1]);
    const month = Number(m[2]);
    const first = `${m[1]}-${m[2]}-01`;
    const last = `${m[1]}-${m[2]}-${String(daysInMonth(year, month)).padStart(2, '0')}`;
    const dayHours = (toMin(settings.end) - toMin(settings.start)) / 60;

    const [emps, allocs, days, cfgRow] = await db.batch([
      db.prepare(`SELECT id, code, name FROM employees WHERE (start_date IS NULL OR start_date <= ?2) AND (end_date IS NULL OR end_date >= ?1) AND (status = 'active' OR end_date >= ?1) ORDER BY code`).bind(first, last),
      db.prepare('SELECT employee_id AS e, funder, share, from_date AS "from", to_date AS "to" FROM employee_projects WHERE from_date <= ?2 AND to_date >= ?1 ORDER BY employee_id, id').bind(first, last),
      db.prepare(
        `SELECT r.employee_id AS e, r.date, r.day_type AS dayType, r.approved_hours AS approvedHours, o.leave_type AS leaveType, x.employee_id IS NOT NULL AS exceptional
         FROM daily_results r
         LEFT JOIN day_overrides o ON o.employee_id = r.employee_id AND o.date = r.date
         LEFT JOIN work_exceptions x ON x.employee_id = r.employee_id AND x.date = r.date AND x.counted = 1
         WHERE r.date BETWEEN ?1 AND ?2`,
      ).bind(first, last),
      db.prepare("SELECT value FROM settings WHERE key = 'timesheet'"),
    ]);
    let config = null;
    try {
      config = mergeTimesheetConfig(cfgRow.results[0] ? JSON.parse(cfgRow.results[0].value) : null);
    } catch {
      config = null;
    }
    const allocBy = new Map();
    for (const a of allocs.results) allocBy.set(a.e, [...(allocBy.get(a.e) || []), a]);
    const daysBy = new Map();
    for (const d of days.results) {
      if (!daysBy.has(d.e)) daysBy.set(d.e, {});
      daysBy.get(d.e)[d.date] = { dayType: d.dayType, approvedHours: d.approvedHours, leaveType: d.leaveType || '', exceptional: !!d.exceptional };
    }

    const byFunder = new Map();
    const problems = [];
    let total = 0;
    for (const e of emps.results) {
      const al = allocBy.get(e.id) || [];
      const ts = buildTimesheet({ year, month, days: daysBy.get(e.id) || {}, allocations: al, dayHours, config });
      const worked = ts.funders.reduce((s, f) => s + f.total, 0);
      if (al.length === 0) {
        if ((daysBy.get(e.id) && Object.values(daysBy.get(e.id)).some((d) => d.approvedHours > 0)) || false) problems.push({ id: e.id, code: e.code, name: e.name, issue: 'عمل في الشهر بلا توزيع على مشروع', hours: Math.round(worked * 100) / 100 });
        continue;
      }
      // توزيع لا يبلغ 100% في أي يوم من الشهر؟ (نفحص مجموع النسب النشطة يوماً بيوم)
      let bad100 = false;
      for (const d of ts.dates) {
        const s = al.filter((a) => a.from <= d && d <= a.to).reduce((x, a) => x + a.share, 0);
        if (s > EPS && Math.abs(s - 1) > EPS) { bad100 = true; break; }
      }
      if (bad100) problems.push({ id: e.id, code: e.code, name: e.name, issue: 'مجموع نسب التوزيع لا يساوي 100% في بعض الأيام', hours: Math.round(worked * 100) / 100 });
      for (const f of ts.funders) {
        const cur = byFunder.get(f.funder) || { funder: f.funder, hours: 0, employees: 0 };
        cur.hours += f.total;
        if (f.total > 0) cur.employees += 1;
        byFunder.set(f.funder, cur);
        total += f.total;
      }
    }
    const funders = [...byFunder.values()]
      .map((f) => ({ ...f, hours: Math.round(f.hours * 100) / 100, percent: total ? f.hours / total : 0 }))
      .sort((a, b) => b.hours - a.hours);
    return json({ ok: true, month: `${m[1]}-${m[2]}`, totalHours: Math.round(total * 100) / 100, funders, problems });
  });

  add('GET', '/api/insights/integrity', async ({ env, db, user }) => {
    if (!can(user, 'insights.read')) return forbidden();
    const today = localDate(tzOf(env));
    const since = addDays(today, -31);
    const q = async (sql, ...p) => (await db.prepare(sql).bind(...p).all()).results;
    const act = "e.status = 'active'";
    const [noEn, noMgr, noEmail, noBadge, allocs, devices, unclosed] = await Promise.all([
      q(`SELECT e.id, e.code, e.name, CASE WHEN COALESCE(e.name_en,'') = '' THEN 'الاسم بالإنجليزية' ELSE 'المسمى بالإنجليزية' END AS detail FROM employees e WHERE ${act} AND (COALESCE(e.name_en,'') = '' OR COALESCE(e.job_title_en,'') = '') ORDER BY e.code`),
      q(`SELECT e.id, e.code, e.name, '' AS detail FROM employees e WHERE ${act} AND e.manager_id IS NULL ORDER BY e.code`),
      q(`SELECT e.id, e.code, e.name, '' AS detail FROM employees e WHERE ${act} AND COALESCE(e.email,'') = '' ORDER BY e.code`),
      q(`SELECT e.id, e.code, e.name, '' AS detail FROM employees e WHERE ${act} AND NOT EXISTS (SELECT 1 FROM badges b WHERE b.employee_id = e.id AND b.status = 'active') ORDER BY e.code`),
      q(`SELECT e.id, e.code, e.name, COALESCE(ROUND(SUM(p.share) * 100), 0) AS pct FROM employees e
         LEFT JOIN employee_projects p ON p.employee_id = e.id AND p.from_date <= ?1 AND p.to_date >= ?1
         WHERE ${act} GROUP BY e.id HAVING ABS(COALESCE(SUM(p.share), 0) - 1) > ${EPS} ORDER BY e.code`, today),
      q(`SELECT c.id, c.name, MAX(d.last_seen) AS lastSeen FROM centers c
         JOIN employees e ON e.center_id = c.id AND e.status = 'active'
         LEFT JOIN devices d ON d.center_id = c.id AND d.active = 1
         GROUP BY c.id HAVING lastSeen IS NULL OR lastSeen < datetime('now', '-2 day') ORDER BY c.name`),
      q(`SELECT e.id, e.code, e.name, COUNT(*) AS n FROM daily_results r JOIN employees e ON e.id = r.employee_id
         WHERE r.alert = 'انصراف غير مسجّل' AND r.date >= ?1 AND r.date < ?2 AND e.status = 'active'
         GROUP BY e.id HAVING n >= 3 ORDER BY n DESC`, since, today),
    ]);
    const emp = (rows, f = (r) => r.detail) => rows.map((r) => ({ id: r.id, name: `${r.code} — ${r.name}`, detail: f(r) }));
    const checks = [
      { key: 'allocation', title: 'توزيع المشاريع اليوم لا يساوي 100%', why: 'يفسد صفوف الممولين في التايم شيت', level: 'high', items: emp(allocs, (r) => `${r.pct}%`) },
      { key: 'english', title: 'اسم أو مسمى بالإنجليزية ناقص', why: 'يظهر فارغاً في التايم شيت المرسل للممولين', level: 'high', items: emp(noEn) },
      { key: 'unclosed', title: 'أيام متراكمة بلا تسجيل انصراف (3 فأكثر في 31 يوماً)', why: 'تعني نسيان المسح أو بطاقة تالفة', level: 'mid', items: emp(unclosed, (r) => `${r.n} أيام`) },
      { key: 'manager', title: 'بلا مدير مباشر', why: 'لا يصل طلباته أحد للاعتماد', level: 'mid', items: emp(noMgr) },
      { key: 'badge', title: 'بلا بطاقة سارية', why: 'لا يستطيع تسجيل الحضور على البوابة', level: 'mid', items: emp(noBadge) },
      { key: 'gate', title: 'مركز بلا بوابة متصلة منذ يومين', why: 'لا حركات تصل من هذا المركز', level: 'high', items: devices.map((d) => ({ id: d.id, name: d.name, detail: d.lastSeen ? `آخر اتصال ${d.lastSeen}` : 'لا بوابة مرتبطة' })) },
      { key: 'email', title: 'بلا بريد دخول', why: 'لا يستطيع دخول النظام بنفسه', level: 'low', items: emp(noEmail) },
    ];
    return json({ ok: true, checks, total: checks.reduce((s, c) => s + c.items.length, 0) });
  });
}
