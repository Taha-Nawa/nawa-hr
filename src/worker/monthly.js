/**
 * التقرير الشهري للموظف: قراءة/حفظ/سجل الأشهر.
 * المحتوى (data) JSON بأربعة أقسام تطابق نموذج الجمعية: tasks (المهام المنجزة) · meetings (الاجتماعات والنشاطات) ·
 * attachments (المرفقات: أسماء فقط، لا ملفات) · plan (مهام الشهر اللاحق) + notes (ملاحظات ثابتة اختيارية).
 * الصلاحيات من authz.js، والتزامن بـ «رمز تفاؤلي» (updated_at): من يكتب على نسخة قديمة يُرفض بدل أن يمحو عمل جهاز آخر.
 */
import { json, isDate, clip } from './util.js';
import { canReadEmployee, canWriteReport } from './authz.js';
import { auditStmt } from './audit.js';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const LIMITS = { tasks: 80, meetings: 60, attachments: 30, plan: 80 };
const MAX_BODY = 256 * 1024;

const bad = (msg, status = 400) => json({ ok: false, error: msg }, status);
const forbidden = () => json({ ok: false, error: 'لا تملك صلاحية هذا الإجراء' }, 403);

const rows = (v) => (Array.isArray(v) ? v : []);
const date = (v) => (typeof v === 'string' && isDate(v) ? v : '');

/**
 * ينظّف جسم الطلب إلى الشكل المخزَّن. يُرجع { data, submitDate } أو { error }.
 * الصفوف الفارغة تُحذف؛ تجاوز الحد الأقصى يُرفض (لا يُقتطع بصمت)؛ التاريخ الفاسد يُرفض بدل أن يُخزَّن.
 */
export function sanitizeReport(body) {
  for (const [k, max] of Object.entries(LIMITS)) {
    if (rows(body[k]).length > max) return { error: `عدد صفوف «${k}» أكبر من المسموح (${max})` };
  }
  const dateErr = (label, v) => (v && !date(v) ? `تاريخ غير صالح في ${label}` : null);

  const data = { tasks: [], meetings: [], attachments: [], plan: [], notes: clip(body.notes, 1000) || '' };
  for (const r of rows(body.tasks)) {
    const t = clip(r?.t, 600);
    if (!t) continue;
    data.tasks.push({ t, s: clip(r.s, 40) || '', c: clip(r.c, 500) || '' });
  }
  for (const r of rows(body.meetings)) {
    const t = clip(r?.t, 400);
    if (!t) continue;
    const e = dateErr('الاجتماعات', r.d);
    if (e) return { error: e };
    data.meetings.push({ t, s: clip(r.s, 800) || '', p: clip(r.p, 120) || '', d: date(r.d) });
  }
  for (const r of rows(body.attachments)) {
    const t = clip(typeof r === 'string' ? r : r?.t, 300);
    if (t) data.attachments.push({ t });
  }
  for (const r of rows(body.plan)) {
    const t = clip(r?.t, 600);
    if (!t) continue;
    const e = dateErr('الخطة اللاحقة', r.sd) || dateErr('الخطة اللاحقة', r.ed);
    if (e) return { error: e };
    data.plan.push({ t, i: clip(r.i, 40) || '', sd: date(r.sd), ed: date(r.ed) });
  }
  const se = dateErr('تاريخ التقديم', body.submitDate);
  if (se) return { error: se };
  return { data, submitDate: date(body.submitDate) };
}

const prevMonth = (month) => {
  let [y, m] = month.split('-').map(Number);
  m -= 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
};

async function target(db, user, url) {
  const month = url.searchParams.get('month');
  if (!MONTH_RE.test(month || '')) return { error: bad('الشهر غير صالح (الصيغة YYYY-MM)') };
  const id = Number(url.searchParams.get('employee')) || user.employeeId;
  if (!Number.isInteger(id) || id <= 0) return { error: bad('حسابك غير مرتبط بملف موظف، راجع الموارد البشرية') };
  const emp = await db
    .prepare(
      `SELECT e.id, e.code, e.name, e.manager_id AS manager_id, e.job_title AS jobTitle, e.department, c.name AS center
       FROM employees e LEFT JOIN centers c ON c.id = e.center_id WHERE e.id = ?`,
    )
    .bind(id)
    .first();
  if (!emp) return { error: json({ ok: false, error: 'الموظف غير موجود' }, 404) };
  if (!canReadEmployee(user, emp)) return { error: forbidden() };
  return { emp, month };
}

const parse = (row) => (row ? { ...JSON.parse(row.data), submitDate: row.submit_date || '', updatedAt: row.updated_at, updatedBy: row.updated_by || '' } : null);

/** GET /api/reports/monthly?month=YYYY-MM[&employee=ID] — التقرير + خطة الشهر السابق (للاستيراد) + هل يحق التعديل. */
export async function getMonthlyReport({ db, user, url }) {
  const t = await target(db, user, url);
  if (t.error) return t.error;
  const { emp, month } = t;
  const [cur, prev] = await Promise.all([
    db.prepare('SELECT data, submit_date, updated_by, updated_at FROM monthly_reports WHERE employee_id = ? AND month = ?').bind(emp.id, month).first(),
    db.prepare('SELECT data FROM monthly_reports WHERE employee_id = ? AND month = ?').bind(emp.id, prevMonth(month)).first(),
  ]);
  const { manager_id: _m, ...employee } = emp;
  return json({
    ok: true,
    month,
    employee,
    report: parse(cur),
    prevPlan: prev ? JSON.parse(prev.data).plan || [] : [],
    canEdit: canWriteReport(user, emp),
  });
}

/** PUT /api/reports/monthly?month=…[&employee=ID] — يحفظ التقرير كاملاً. body.base = updatedAt الذي قرأه العميل ('' لتقرير جديد). */
export async function putMonthlyReport({ request, db, user, url }) {
  const t = await target(db, user, url);
  if (t.error) return t.error;
  const { emp, month } = t;
  if (!canWriteReport(user, emp)) return forbidden();

  const ct = request.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return bad('نوع المحتوى يجب أن يكون JSON', 415);
  const text = await request.text();
  if (text.length > MAX_BODY) return bad('الطلب أكبر من المسموح', 413);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return bad('صيغة الطلب غير صالحة');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('صيغة الطلب غير صالحة');

  const clean = sanitizeReport(body);
  if (clean.error) return bad(clean.error);

  const existing = await db.prepare('SELECT updated_at FROM monthly_reports WHERE employee_id = ? AND month = ?').bind(emp.id, month).first();
  if (existing && existing.updated_at !== (body.base || '')) {
    return json({ ok: false, error: 'عُدِّل هذا التقرير من جهاز أو مستخدم آخر، أعد تحميل الصفحة كي لا تُفقد التعديلات.', code: 'conflict' }, 409);
  }

  const updatedAt = new Date().toISOString();
  const stmts = [
    db
      .prepare(
        `INSERT INTO monthly_reports (employee_id, month, data, submit_date, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(employee_id, month) DO UPDATE SET data = ?3, submit_date = ?4, updated_by = ?5, updated_at = ?6`,
      )
      .bind(emp.id, month, JSON.stringify(clean.data), clean.submitDate || null, user.email, updatedAt),
  ];
  // الحفظ التلقائي لصاحب التقرير لا يُغرق سجل التدقيق؛ يُسجَّل فقط تعديل شخص آخر لتقرير موظف.
  if (user.employeeId !== emp.id) stmts.push(auditStmt(db, user, 'report.monthly.edit', 'employee', emp.id, { month, tasks: clean.data.tasks.length }));
  await db.batch(stmts);
  return json({ ok: true, updatedAt });
}

/** GET /api/reports/monthly/list[?employee=ID] — الأشهر المحفوظة (للتنقل السريع). */
export async function listMonthlyReports({ db, user, url }) {
  url.searchParams.set('month', '2000-01'); // target() يتحقق من الموظف والصلاحية فقط؛ الشهر هنا شكلي
  const t = await target(db, user, url);
  if (t.error) return t.error;
  const r = await db
    .prepare(
      `SELECT month, updated_at AS updatedAt, json_array_length(data, '$.tasks') AS tasks, json_array_length(data, '$.meetings') AS meetings,
              json_array_length(data, '$.plan') AS plan
       FROM monthly_reports WHERE employee_id = ? ORDER BY month DESC LIMIT 60`,
    )
    .bind(t.emp.id)
    .all();
  return json({ ok: true, months: r.results });
}
