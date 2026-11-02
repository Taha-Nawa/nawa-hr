/**
 * التقرير الشهري للموظف (قرار 2 نوفمبر 2026): يكتبه الموظف بنفسه (مسودة ثم تقديم)، ويقرؤه مديره المباشر والموارد البشرية
 * والمدير العام والمسؤول، ويكتب المدير المباشر (أو من فوقه) ملاحظاته. المسودة خاصة بصاحبها حتى يقدّمها.
 * لا مرفقات ملفات (R2 مؤجّل): قسم «المرفقات» أسماء/أوصاف نصية فقط.
 */
import { json, clip, localDate, nowOf } from './util.js';
import { canReadEmployee, canReviewReport, employeeScope } from './authz.js';
import { tzOf } from './close.js';
import { isMonth, monthBounds, prevMonth, validateReport, parseBody, reportWindows, LIMITS } from '../engine/monthly-report.js';

const EMPLOYEE_SQL = `SELECT e.id, e.code, e.name, e.job_title AS jobTitle, e.department, e.manager_id, c.name AS center
                        FROM employees e LEFT JOIN centers c ON c.id = e.center_id WHERE e.id = ?`;

export function registerMonthlyReportRoutes(add, kit) {
  const { bad, forbidden, notFound, readJson, auditStmt } = kit;

  const parseKey = (params) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id < 1) return { error: bad('معرّف الموظف غير صالح') };
    if (!isMonth(params.month)) return { error: bad('الشهر غير صالح (YYYY-MM)') };
    return { id, month: params.month };
  };

  // قائمة الشهر لمن يحق له رؤيتهم (الموظف: نفسه فقط)
  add('GET', '/api/monthly-reports', async ({ db, user, url }) => {
    const month = url.searchParams.get('month');
    if (!isMonth(month)) return bad('الشهر غير صالح (YYYY-MM)');
    const scope = employeeScope(user, 'e');
    const rows = (await db.prepare(
      `SELECT e.id, e.code, e.name, e.job_title AS jobTitle, c.name AS center,
              r.status, r.submit_date AS submitDate, r.updated_at AS updatedAt, (r.manager_notes IS NOT NULL) AS hasNotes,
              json_array_length(r.body, '$.tasks') AS tasks, json_array_length(r.body, '$.meetings') AS meetings, json_array_length(r.body, '$.next') AS next
         FROM employees e
         LEFT JOIN centers c ON c.id = e.center_id
         LEFT JOIN monthly_reports r ON r.employee_id = e.id AND r.month = ?
        WHERE (e.status = 'active' OR r.employee_id IS NOT NULL) AND ${scope.sql}
        ORDER BY c.name, e.name`,
    ).bind(month, ...scope.params).all()).results;
    const mine = user.employeeId ?? null;
    return json({
      ok: true, month, mine,
      reports: rows.map((r) => {
        const visible = r.status === 'submitted' || (r.status === 'draft' && r.id === mine);
        return { id: r.id, code: r.code, name: r.name, jobTitle: r.jobTitle, center: r.center, status: visible ? r.status : null,
          submitDate: visible ? r.submitDate : null, updatedAt: visible ? r.updatedAt : null, hasNotes: visible ? !!r.hasNotes : false,
          counts: visible ? { tasks: r.tasks || 0, meetings: r.meetings || 0, next: r.next || 0 } : null };
      }),
    });
  });

  // ما ينتظر تقديمه من صاحب الحساب اليوم (لتنبيه لوحة اليوم). المنتهي بالتقديم لا يظهر، ولا شهر سبق تعيينه.
  add('GET', '/api/monthly-reports/due', async ({ db, user, env }) => {
    if (user.employeeId == null) return json({ ok: true, items: [] });
    const today = localDate(tzOf(env), nowOf(env));
    const win = reportWindows(today).banner;
    if (!win.length) return json({ ok: true, today, items: [] });
    const emp = await db.prepare('SELECT status, start_date AS startDate, end_date AS endDate FROM employees WHERE id = ?').bind(user.employeeId).first();
    if (!emp || emp.status !== 'active') return json({ ok: true, today, items: [] });
    const ph = win.map(() => '?').join(', ');
    const rows = (await db.prepare(`SELECT month, status FROM monthly_reports WHERE employee_id = ? AND month IN (${ph})`).bind(user.employeeId, ...win.map((w) => w.month)).all()).results;
    const items = win
      .filter((w) => {
        const { from, to } = monthBounds(w.month);
        return (!emp.startDate || emp.startDate <= to) && (!emp.endDate || emp.endDate >= from) && rows.find((r) => r.month === w.month)?.status !== 'submitted';
      })
      .map((w) => ({ month: w.month, phase: w.phase, status: rows.find((r) => r.month === w.month)?.status || 'none' }));
    return json({ ok: true, today, employeeId: user.employeeId, items });
  });

  add('GET', '/api/monthly-reports/:id/:month', async ({ db, user, params }) => {
    const k = parseKey(params);
    if (k.error) return k.error;
    const target = await db.prepare(EMPLOYEE_SQL).bind(k.id).first();
    if (!target) return notFound('الموظف');
    if (!canReadEmployee(user, target)) return forbidden();
    const own = user.employeeId != null && user.employeeId === target.id;
    const row = await db.prepare('SELECT * FROM monthly_reports WHERE employee_id = ? AND month = ?').bind(k.id, k.month).first();
    if (!own && row?.status !== 'submitted') return json({ ok: false, error: 'لم يُقدَّم تقرير هذا الشهر بعد' }, 404);
    let prevNext = [];
    if (own) {
      const prev = await db.prepare('SELECT body FROM monthly_reports WHERE employee_id = ? AND month = ?').bind(k.id, prevMonth(k.month)).first();
      prevNext = prev ? parseBody(prev.body).next : [];
    }
    return json({
      ok: true, month: k.month, own,
      employee: { id: target.id, code: target.code, name: target.name, jobTitle: target.jobTitle, department: target.department, center: target.center },
      report: { status: row?.status || 'draft', submitDate: row?.submit_date || null, ...parseBody(row?.body), managerNotes: row?.manager_notes || '', notesBy: row?.notes_by || null, updatedAt: row?.updated_at || null, exists: !!row },
      canEdit: own, canReview: !!row && row.status === 'submitted' && canReviewReport(user, target),
      prevNext, limits: LIMITS,
    });
  });

  // الحفظ والتقديم: لصاحب التقرير فقط
  add('PUT', '/api/monthly-reports/:id/:month', async ({ request, db, user, params, env }) => {
    const k = parseKey(params);
    if (k.error) return k.error;
    if (user.employeeId == null || user.employeeId !== k.id) return forbidden();
    const now = nowOf(env);
    const today = localDate(tzOf(env), now);
    if (k.month > today.slice(0, 7)) return bad('لا يمكن كتابة تقرير لشهر لم يبدأ بعد');
    const { body, error } = await readJson(request);
    if (error) return error;
    const v = validateReport(body, k.month);
    if (!v.ok) return bad(v.error);
    const cur = await db.prepare('SELECT status, submit_date FROM monthly_reports WHERE employee_id = ? AND month = ?').bind(k.id, k.month).first();
    const status = body.status === 'submitted' ? 'submitted' : body.status === 'draft' ? 'draft' : cur?.status || 'draft';
    if (status === 'submitted' && !v.value.tasks.length) return bad('أدخل مهمة واحدة على الأقل في «المهام الرئيسية» قبل التقديم');
    let submitDate = body.submitDate === undefined ? cur?.submit_date || null : clip(body.submitDate, 10);
    if (submitDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(submitDate)) return bad('تاريخ تقديم التقرير غير صالح');
    if (submitDate !== null && submitDate < monthBounds(k.month).from) return bad('تاريخ تقديم التقرير قبل بداية الشهر');
    if (status === 'submitted' && submitDate === null) submitDate = today;
    const bodyJson = JSON.stringify(v.value);
    await db.batch([
      db.prepare(
        `INSERT INTO monthly_reports (employee_id, month, status, submit_date, body, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(employee_id, month) DO UPDATE SET status = excluded.status, submit_date = excluded.submit_date, body = excluded.body,
           updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      ).bind(k.id, k.month, status, submitDate, bodyJson, user.email),
      auditStmt(db, user, status === 'submitted' && cur?.status !== 'submitted' ? 'monthlyReport.submit' : 'monthlyReport.save', 'monthlyReport', k.id,
        { month: k.month, status, tasks: v.value.tasks.length, meetings: v.value.meetings.length, next: v.value.next.length }),
    ]);
    return json({ ok: true, status, submitDate });
  });

  // ملاحظات المدير المباشر على تقرير مُقدَّم
  add('PATCH', '/api/monthly-reports/:id/:month/notes', async ({ request, db, user, params }) => {
    const k = parseKey(params);
    if (k.error) return k.error;
    const target = await db.prepare(EMPLOYEE_SQL).bind(k.id).first();
    if (!target) return notFound('الموظف');
    if (!canReviewReport(user, target)) return forbidden();
    const row = await db.prepare('SELECT status FROM monthly_reports WHERE employee_id = ? AND month = ?').bind(k.id, k.month).first();
    if (row?.status !== 'submitted') return bad('لم يُقدَّم التقرير بعد');
    const { body, error } = await readJson(request);
    if (error) return error;
    const notes = clip(body.notes, LIMITS.notes);
    await db.batch([
      db.prepare('UPDATE monthly_reports SET manager_notes = ?, notes_by = ? WHERE employee_id = ? AND month = ?').bind(notes, notes ? user.email : null, k.id, k.month),
      auditStmt(db, user, 'monthlyReport.notes', 'monthlyReport', k.id, { month: k.month, cleared: !notes }),
    ]);
    return json({ ok: true });
  });
}
