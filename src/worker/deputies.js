/**
 * نائب المدير المعتمد: تعيّنه الموارد البشرية والمسؤول بتاريخ من/إلى. خلال المدة يعتمد النائب طلبات وخطط فريق المدير
 * ويصله إشعار الطلبات الجديدة؛ ولا يملك سوى ذلك (لا يرى غير ما يخصّ فريق المدير). الحساب في authz.managedIds.
 */
import { json, clip, isDate } from './util.js';
import { can } from './authz.js';

const rowOut = (r) => ({ id: r.id, managerId: r.manager_id, deputyId: r.deputy_id, deputyName: r.deputyName, managerName: r.managerName, fromDate: r.from_date, toDate: r.to_date, note: r.note });

export function registerDeputyRoutes(add, kit) {
  const { bad, forbidden, notFound, readJson, auditStmt } = kit;
  const LIST = `SELECT d.*, dep.name AS deputyName, m.name AS managerName FROM manager_deputies d
    JOIN employees dep ON dep.id = d.deputy_id JOIN employees m ON m.id = d.manager_id`;

  add('GET', '/api/employees/:id/deputies', async ({ db, user, params }) => {
    if (!can(user, 'deputy.manage')) return forbidden();
    let rows = [];
    try { rows = (await db.prepare(`${LIST} WHERE d.manager_id = ? ORDER BY d.from_date DESC`).bind(Number(params.id)).all()).results; } catch { /* الترحيل 0027 لم يُطبَّق */ }
    return json({ ok: true, deputies: rows.map(rowOut) });
  });

  add('POST', '/api/employees/:id/deputies', async ({ request, db, user, params }) => {
    if (!can(user, 'deputy.manage')) return forbidden();
    const mid = Number(params.id);
    const mgr = await db.prepare('SELECT id, code FROM employees WHERE id = ?').bind(mid).first();
    if (!mgr) return notFound('المدير');
    const { body, error } = await readJson(request);
    if (error) return error;
    const did = Number(body.deputyId);
    if (!Number.isInteger(did) || did === mid) return bad('اختر نائباً غير المدير نفسه');
    const dep = await db.prepare("SELECT e.id, e.name FROM employees e WHERE e.id = ? AND e.status = 'active'").bind(did).first();
    if (!dep) return bad('النائب غير موجود أو غير فعّال');
    if (!(await db.prepare('SELECT 1 AS x FROM users WHERE employee_id = ? AND active = 1').bind(did).first())) return bad('النائب بلا حساب فعّال في النظام؛ أنشئ له حساباً أولاً');
    if (!isDate(body.fromDate) || !isDate(body.toDate)) return bad('حدّد تاريخ البداية والنهاية');
    if (body.toDate < body.fromDate) return bad('تاريخ النهاية قبل البداية');
    const clash = await db.prepare('SELECT 1 AS x FROM manager_deputies WHERE manager_id = ? AND from_date <= ? AND to_date >= ?').bind(mid, body.toDate, body.fromDate).first();
    if (clash) return bad('للمدير نائب آخر في هذه المدة؛ احذفه أو عدّل التواريخ');
    const note = clip(body.note, 200);
    const r = await db.prepare('INSERT INTO manager_deputies (manager_id, deputy_id, from_date, to_date, note, created_by) VALUES (?, ?, ?, ?, ?, ?)').bind(mid, did, body.fromDate, body.toDate, note || null, user.email || null).run();
    await auditStmt(db, user, 'deputy.add', 'employee', mgr.code, { deputyId: did, from: body.fromDate, to: body.toDate }).run();
    return json({ ok: true, id: r.meta?.last_row_id ?? null }, 201);
  });

  add('DELETE', '/api/deputies/:did', async ({ db, user, params }) => {
    if (!can(user, 'deputy.manage')) return forbidden();
    const old = await db.prepare('SELECT d.*, m.code AS mcode FROM manager_deputies d JOIN employees m ON m.id = d.manager_id WHERE d.id = ?').bind(Number(params.did)).first();
    if (!old) return notFound('التعيين');
    await db.batch([db.prepare('DELETE FROM manager_deputies WHERE id = ?').bind(old.id), auditStmt(db, user, 'deputy.delete', 'employee', old.mcode, { deputyId: old.deputy_id, from: old.from_date, to: old.to_date })]);
    return json({ ok: true });
  });
}
