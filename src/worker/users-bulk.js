/**
 * إنشاء حسابات الدخول لعدد من الموظفين دفعة واحدة (مسؤول النظام فقط).
 * - الدور المسموح في الدفعة: موظف أو مدير مباشر فقط؛ رفع أحد إلى موارد بشرية/مدير عام/مسؤول يبقى فردياً ومقصوداً.
 * - يُرشَّح الدور «مدير مباشر» لمن له مرؤوسون فعّالون، والبريد من بطاقة الموظف (لا يُنشأ حساب بلا بريد).
 * - آمن التكرار: من له حساب (بالموظف أو بالبريد) يُتخطّى، ولا يتأثر شيء آخر.
 */
import { json, clip } from './util.js';
import { can } from './authz.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BULK_ROLES = ['employee', 'manager'];
const MAX_ITEMS = 200;

export function registerUserBulk(add, kit) {
  const { bad, forbidden, readJson, auditStmt } = kit;

  add('GET', '/api/users/candidates', async ({ db, user }) => {
    if (!can(user, 'user.manage')) return forbidden();
    const rows = (await db.prepare(
      `SELECT e.id, e.code, e.name, e.email, c.name AS center,
              (SELECT COUNT(*) FROM employees r WHERE r.manager_id = e.id AND r.status = 'active') AS reports,
              EXISTS (SELECT 1 FROM users u WHERE e.email IS NOT NULL AND u.email = e.email) AS emailTaken
         FROM employees e LEFT JOIN centers c ON c.id = e.center_id
        WHERE e.status = 'active' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.employee_id = e.id)
        ORDER BY e.code`,
    ).all()).results;
    return json({
      ok: true,
      candidates: rows.map((r) => ({
        id: r.id, code: r.code, name: r.name, email: r.email, center: r.center, reports: r.reports,
        suggestedRole: r.reports > 0 ? 'manager' : 'employee',
        blocked: !r.email ? 'no_email' : !EMAIL_RE.test(r.email) ? 'bad_email' : r.emailTaken ? 'email_taken' : null,
      })),
    });
  });

  add('POST', '/api/users/bulk', async ({ request, db, user }) => {
    if (!can(user, 'user.manage')) return forbidden();
    const { body, error } = await readJson(request);
    if (error) return error;
    const items = Array.isArray(body?.items) ? body.items : null;
    if (!items || !items.length) return bad('اختر موظفاً واحداً على الأقل');
    if (items.length > MAX_ITEMS) return bad(`الحد الأقصى ${MAX_ITEMS} حساباً في الدفعة`);
    const wanted = new Map();
    for (const it of items) {
      const id = Number(it?.employeeId);
      if (!Number.isInteger(id) || id < 1) return bad('معرّف موظف غير صالح');
      if (!BULK_ROLES.includes(it.role)) return bad('الدور في الإنشاء الجماعي: موظف أو مدير مباشر فقط');
      wanted.set(id, it.role);
    }
    const ids = [...wanted.keys()];
    const emps = (await db.prepare(
      `SELECT e.id, e.name, e.email, e.status,
              EXISTS (SELECT 1 FROM users u WHERE u.employee_id = e.id) AS hasUser,
              EXISTS (SELECT 1 FROM users u WHERE e.email IS NOT NULL AND u.email = e.email) AS emailTaken
         FROM employees e WHERE e.id IN (SELECT value FROM json_each(?))`,
    ).bind(JSON.stringify(ids)).all()).results;
    const byId = new Map(emps.map((e) => [e.id, e]));

    const skipped = [];
    const toCreate = [];
    for (const id of ids) {
      const e = byId.get(id);
      const email = clip(e?.email, 200)?.toLowerCase();
      if (!e) skipped.push({ employeeId: id, reason: 'الموظف غير موجود' });
      else if (e.status !== 'active') skipped.push({ employeeId: id, name: e.name, reason: 'الموظف غير فعّال' });
      else if (e.hasUser) skipped.push({ employeeId: id, name: e.name, reason: 'له حساب' });
      else if (!email || !EMAIL_RE.test(email)) skipped.push({ employeeId: id, name: e.name, reason: 'لا بريد صالح في بطاقته' });
      else if (e.emailTaken) skipped.push({ employeeId: id, name: e.name, reason: 'بريده مستعمل في حساب آخر' });
      else toCreate.push({ employeeId: id, email, role: wanted.get(id) });
    }

    let created = 0;
    if (toCreate.length) {
      const res = await db.batch([
        db.prepare(
          `INSERT OR IGNORE INTO users (email, role, employee_id)
           SELECT json_extract(j.value, '$.email'), json_extract(j.value, '$.role'), json_extract(j.value, '$.employeeId') FROM json_each(?) j`,
        ).bind(JSON.stringify(toCreate)),
        auditStmt(db, user, 'user.bulk-create', 'user', null, { count: toCreate.length, employeeIds: toCreate.map((x) => x.employeeId), roles: toCreate.map((x) => x.role) }),
      ]);
      created = res[0].meta.changes;
    }
    return json({ ok: true, created, skipped });
  });
}
