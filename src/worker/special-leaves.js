/**
 * الإجازات الخاصة (حج / وفاة قريب / علاج طويل): تسجّلها الموارد البشرية والمسؤول لأي موظف.
 * أيامها تقويمية تُكتب في day_overrides بنوع الإجازة فتظهر في صف Others، ولا تُخصم من رصيد.
 */
import { json, clip, localDate, nowOf } from './util.js';
import { can } from './authz.js';
import { tzOf } from './close.js';
import { OVERRIDE_UPSERT, recomputeRange } from './maternity.js';
import { SPECIAL_KINDS, datesOf, endOf, validateSpecial } from '../engine/special-leaves.js';

const rowOut = (r) => {
  const rec = { fromDate: r.from_date, days: r.days };
  return { id: r.id, employeeId: r.employee_id, kind: r.kind, label: SPECIAL_KINDS[r.kind]?.label, fromDate: r.from_date, days: r.days, toDate: endOf(rec), relation: r.relation, note: r.note, createdBy: r.created_by };
};
const NO_MANUAL = 'in_time IS NULL AND out_time IS NULL AND ret_time IS NULL AND dep_time IS NULL AND request_id IS NULL';

export function registerSpecialLeaveRoutes(add, kit) {
  const { bad, forbidden, notFound, readJson, auditStmt } = kit;
  const employeeOf = (db, id) => db.prepare('SELECT id, code FROM employees WHERE id = ?').bind(id).first();

  add('GET', '/api/employees/:id/special-leaves', async ({ db, user, params }) => {
    if (!can(user, 'special.manage')) return forbidden();
    const e = await employeeOf(db, Number(params.id));
    if (!e) return notFound('الموظف');
    let rows = [];
    try { rows = (await db.prepare('SELECT * FROM special_leaves WHERE employee_id = ? ORDER BY from_date DESC').bind(e.id).all()).results; } catch { /* الترحيل 0026 لم يُطبَّق */ }
    return json({ ok: true, records: rows.map(rowOut), kinds: Object.entries(SPECIAL_KINDS).map(([k, v]) => ({ kind: k, label: v.label, defaultDays: v.defaultDays })) });
  });

  add('POST', '/api/employees/:id/special-leaves', async ({ request, env, db, user, params }) => {
    if (!can(user, 'special.manage')) return forbidden();
    const e = await employeeOf(db, Number(params.id));
    if (!e) return notFound('الموظف');
    const { body, error } = await readJson(request);
    if (error) return error;
    const v = validateSpecial(body);
    if (v.error) return bad(v.error);
    const rec = v.value;
    const clash = (await db.prepare('SELECT from_date, days FROM special_leaves WHERE employee_id = ?').bind(e.id).all()).results
      .some((r) => rec.fromDate <= endOf({ fromDate: r.from_date, days: r.days }) && endOf(rec) >= r.from_date);
    if (clash) return bad('تتداخل مع إجازة خاصة أخرى لها');
    const note = clip(body.note, 200);
    const type = SPECIAL_KINDS[rec.kind].type;
    const r = await db.prepare('INSERT INTO special_leaves (employee_id, kind, from_date, days, relation, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(e.id, rec.kind, rec.fromDate, rec.days, rec.relation, note || null, user.email || null).run();
    await db.batch([
      db.prepare(OVERRIDE_UPSERT).bind(e.id, type, type, user.email || null, JSON.stringify(datesOf(rec))),
      auditStmt(db, user, 'special_leave.add', 'employee', e.code, { ...rec, note }),
    ]);
    await recomputeRange(db, e.id, rec.fromDate, endOf(rec), localDate(tzOf(env), nowOf(env)));
    return json({ ok: true, id: r.meta?.last_row_id ?? null }, 201);
  });

  add('DELETE', '/api/special-leaves/:sid', async ({ env, db, user, params }) => {
    if (!can(user, 'special.manage')) return forbidden();
    const old = await db.prepare('SELECT * FROM special_leaves WHERE id = ?').bind(Number(params.sid)).first();
    if (!old) return notFound('السجل');
    const e = await employeeOf(db, old.employee_id);
    const rec = { fromDate: old.from_date, days: old.days };
    const type = SPECIAL_KINDS[old.kind].type;
    const dates = JSON.stringify(datesOf(rec));
    await db.batch([
      db.prepare('DELETE FROM special_leaves WHERE id = ?').bind(old.id),
      db.prepare(`DELETE FROM day_overrides WHERE employee_id = ?1 AND leave_type = ?2 AND date IN (SELECT value FROM json_each(?3)) AND ${NO_MANUAL}`).bind(old.employee_id, type, dates),
      db.prepare('UPDATE day_overrides SET leave_type = NULL WHERE employee_id = ?1 AND leave_type = ?2 AND date IN (SELECT value FROM json_each(?3))').bind(old.employee_id, type, dates),
      auditStmt(db, user, 'special_leave.delete', 'employee', e.code, { kind: old.kind, ...rec }),
    ]);
    await recomputeRange(db, old.employee_id, rec.fromDate, endOf(rec), localDate(tzOf(env), nowOf(env)));
    return json({ ok: true });
  });
}
