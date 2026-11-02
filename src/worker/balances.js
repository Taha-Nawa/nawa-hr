/**
 * أرصدة الإجازات.
 *
 *  - الرصيد الفعلي (employee × سنة × غرض) = الرصيد الخاص في leave_balances إن وُجد، وإلا الافتراضي في settings['requests'].entitlement.
 *  - «المستهلك» و«المعلّق» و«المتبقي» تُحسب دائماً من الطلبات (لا تُخزَّن)، فاعتماد الطلب يخصم وإلغاء اعتماده يردّ تلقائياً.
 *  - التوزيع (الكتابة) للموارد البشرية والمسؤول (balance.manage)؛ القراءة بنطاق الموظف المعتاد: نفسه / فريقه / الكل.
 */
import { json, localDate } from './util.js';
import { can, employeeScope } from './authz.js';
import { tzOf } from './close.js';
import { PURPOSES } from '../engine/requests.js';

const PURPOSE_KEYS = Object.keys(PURPOSES);
const MAX_EMPLOYEES = 500;
const round2 = (n) => Math.round(n * 100) / 100;
/** مضاعفات نصف اليوم فقط، بين 0 و366 */
const validDays = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 366 && Number.isInteger(v * 2);
const validYear = (y) => Number.isInteger(y) && y >= 2020 && y <= 2100;

/** يحوّل علامات ? المجهولة إلى ?N مرقّمة ابتداءً من from (D1 يرفض خلط الأنماط) */
const numbered = (sql, from) => {
  let n = from - 1;
  return sql.replace(/\?/g, () => `?${++n}`);
};

/**
 * رصيد موظف واحد في سنة: عناصر لكل غرض له رصيد (خاص أو افتراضي).
 * rules: ناتج mergeRules. يُرجع [] إن لم يكن لأي غرض رصيد.
 */
export async function employeeBalance(db, employeeId, year, rules) {
  const [personal, used] = await Promise.all([
    db.prepare('SELECT purpose, days FROM leave_balances WHERE employee_id = ? AND year = ?').bind(employeeId, year).all(),
    db
      .prepare(
        `SELECT purpose, status, SUM(days) AS days FROM requests
         WHERE employee_id = ? AND kind = 'leave' AND mission = 0 AND status IN ('approved', 'pending') AND from_date BETWEEN ? AND ?
         GROUP BY purpose, status`,
      )
      .bind(employeeId, `${year}-01-01`, `${year}-12-31`)
      .all(),
  ]);
  const own = new Map(personal.results.map((r) => [r.purpose, r.days]));
  const sum = (st, p) => round2(used.results.filter((r) => r.status === st && r.purpose === p).reduce((a, r) => a + r.days, 0));
  const items = [];
  for (const purpose of PURPOSE_KEYS) {
    const total = own.has(purpose) ? own.get(purpose) : rules.entitlement[purpose];
    if (total === undefined) continue;
    const approved = sum('approved', purpose);
    items.push({ purpose, total, source: own.has(purpose) ? 'personal' : 'default', used: approved, pending: sum('pending', purpose), remaining: round2(total - approved) });
  }
  return items;
}

export function registerBalanceRoutes(add, kit) {
  const { bad, forbidden, readJson, auditStmt } = kit;

  async function loadRules(db) {
    const { mergeRules } = await import('../engine/requests.js');
    const row = await db.prepare("SELECT value FROM settings WHERE key = 'requests'").first();
    try {
      return mergeRules(row ? JSON.parse(row.value) : null);
    } catch {
      return mergeRules(null);
    }
  }

  // ------------------------------------------------------------ القراءة: جدول الأرصدة لسنة (نطاق المستخدم)
  add('GET', '/api/balances', async ({ env, db, user, url }) => {
    const raw = url.searchParams.get('year');
    const year = raw === null ? Number(localDate(tzOf(env)).slice(0, 4)) : Number(raw);
    if (!validYear(year)) return bad('السنة غير صالحة');
    const scope = employeeScope(user, 'e');
    const [rules, emps, bal, reqs] = await Promise.all([
      loadRules(db),
      db
        .prepare(
          `SELECT e.id, e.code, e.name, e.department, e.center_id AS centerId, c.name AS center, e.manager_id AS managerId
           FROM employees e LEFT JOIN centers c ON c.id = e.center_id
           WHERE e.status = 'active' AND ${scope.sql} ORDER BY c.name, e.department, e.code`,
        )
        .bind(...scope.params)
        .all(),
      db
        .prepare(
          `SELECT b.employee_id AS id, b.purpose, b.days FROM leave_balances b JOIN employees e ON e.id = b.employee_id
           WHERE b.year = ?1 AND e.status = 'active' AND ${numbered(scope.sql, 2)}`,
        )
        .bind(year, ...scope.params)
        .all(),
      db
        .prepare(
          `SELECT r.employee_id AS id, r.purpose, r.status, COUNT(*) AS n, SUM(r.days) AS days
           FROM requests r JOIN employees e ON e.id = r.employee_id
           WHERE r.kind = 'leave' AND r.mission = 0 AND r.from_date BETWEEN ?1 AND ?2 AND e.status = 'active' AND ${numbered(scope.sql, 3)}
           GROUP BY r.employee_id, r.purpose, r.status`,
        )
        .bind(`${year}-01-01`, `${year}-12-31`, ...scope.params)
        .all(),
    ]);

    const own = new Map(); // `${id}:${purpose}` -> days
    for (const r of bal.results) own.set(`${r.id}:${r.purpose}`, r.days);
    const byEmp = new Map();
    for (const r of reqs.results) {
      if (!byEmp.has(r.id)) byEmp.set(r.id, []);
      byEmp.get(r.id).push(r);
    }

    const employees = emps.results.map((e) => {
      const rows = byEmp.get(e.id) || [];
      const pick = (status, purpose) => rows.filter((r) => r.status === status && (!purpose || r.purpose === purpose));
      const balances = {};
      for (const purpose of PURPOSE_KEYS) {
        const has = own.has(`${e.id}:${purpose}`);
        const total = has ? own.get(`${e.id}:${purpose}`) : rules.entitlement[purpose];
        const used = round2(pick('approved', purpose).reduce((a, r) => a + r.days, 0));
        const pending = round2(pick('pending', purpose).reduce((a, r) => a + r.days, 0));
        balances[purpose] = {
          total: total === undefined ? null : total,
          source: total === undefined ? null : has ? 'personal' : 'default',
          used,
          pending,
          remaining: total === undefined ? null : round2(total - used),
        };
      }
      const count = (status) => pick(status).reduce((a, r) => a + r.n, 0);
      return { ...e, balances, requests: { approved: count('approved'), pending: count('pending'), rejected: count('rejected'), cancelled: count('cancelled') } };
    });

    return json({ ok: true, year, employees, defaults: rules.entitlement, canEdit: can(user, 'balance.manage') });
  });

  // ------------------------------------------------------------ التوزيع: تعيين أو إزالة الرصيد لعدة موظفين دفعة واحدة
  add('PUT', '/api/balances', async ({ request, db, user }) => {
    if (!can(user, 'balance.manage')) return forbidden();
    const { body, error } = await readJson(request);
    if (error) return error;
    const year = body?.year;
    if (!validYear(year)) return bad('السنة غير صالحة');
    const ids = Array.isArray(body.employeeIds) ? [...new Set(body.employeeIds)] : [];
    if (!ids.length) return bad('حدّد موظفاً واحداً على الأقل');
    if (ids.length > MAX_EMPLOYEES || ids.some((n) => !Number.isInteger(n) || n <= 0)) return bad('قائمة الموظفين غير صالحة');
    const items = body.items && typeof body.items === 'object' ? body.items : {};
    const keys = Object.keys(items);
    if (!keys.length) return bad('حدّد رصيداً واحداً على الأقل');
    for (const k of keys) {
      if (!PURPOSES[k]) return bad('نوع الإجازة غير معروف');
      // null = إزالة الرصيد الخاص (يعود للافتراضي)، وإلا عدد أيام بمضاعفات نصف اليوم
      if (items[k] !== null && !validDays(items[k])) return bad('الرصيد يجب أن يكون بين 0 و366 يوماً (يقبل نصف يوم)');
    }
    const idsJson = JSON.stringify(ids);
    const found = await db.prepare("SELECT COUNT(*) AS n FROM employees WHERE status = 'active' AND id IN (SELECT value FROM json_each(?))").bind(idsJson).first('n');
    if (found !== ids.length) return bad('موظف غير موجود أو غير فعّال', 404);

    const stmts = [];
    for (const k of keys) {
      if (items[k] === null) {
        stmts.push(db.prepare('DELETE FROM leave_balances WHERE year = ? AND purpose = ? AND employee_id IN (SELECT value FROM json_each(?))').bind(year, k, idsJson));
      } else {
        stmts.push(
          db
            .prepare(
              `INSERT INTO leave_balances (employee_id, year, purpose, days, updated_by)
               SELECT value, ?, ?, ?, ? FROM json_each(?) WHERE 1
               ON CONFLICT (employee_id, year, purpose) DO UPDATE SET days = excluded.days, updated_by = excluded.updated_by, updated_at = datetime('now')`,
            )
            .bind(year, k, items[k], user.email, idsJson),
        );
      }
    }
    stmts.push(auditStmt(db, user, 'balance.set', 'balances', String(year), { employees: ids.length, ids: ids.length <= 20 ? ids : undefined, items }));
    await db.batch(stmts);
    return json({ ok: true, employees: ids.length });
  });

  // ------------------------------------------------------------ تخطيط السنة التالية: نسخ توزيع سنة إلى أخرى (لا يطغى على ما حُدِّد فيها)
  add('POST', '/api/balances/copy', async ({ request, db, user }) => {
    if (!can(user, 'balance.manage')) return forbidden();
    const { body, error } = await readJson(request);
    if (error) return error;
    const from = body?.from;
    const to = body?.to;
    if (!validYear(from) || !validYear(to) || from === to) return bad('اختر سنتين مختلفتين');
    const res = await db
      .prepare(
        `INSERT INTO leave_balances (employee_id, year, purpose, days, updated_by)
         SELECT b.employee_id, ?, b.purpose, b.days, ? FROM leave_balances b JOIN employees e ON e.id = b.employee_id
         WHERE b.year = ? AND e.status = 'active' ON CONFLICT (employee_id, year, purpose) DO NOTHING`,
      )
      .bind(to, user.email, from)
      .run();
    await db.batch([auditStmt(db, user, 'balance.copy', 'balances', String(to), { from, to, copied: res.meta.changes })]);
    return json({ ok: true, copied: res.meta.changes });
  });
}
