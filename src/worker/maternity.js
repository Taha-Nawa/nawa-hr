/**
 * إجازة الوضع وساعة الأمومة (قرار 2026-11-11). للموظفات فقط؛ تحدّدها الموارد البشرية والمسؤول.
 *  - إجازة الوضع: 70 يوماً تقويمياً (قابلة للتعديل) من يوم الولادة؛ تُكتب أيامها في day_overrides بنوع «إجازة وضع» فتظهر في التايم شيت (Others).
 *  - ساعة الأمومة: بعد العودة ولمدة سنة تقويمية، يُقصَّر دوامها ساعة في بدايته أو نهايته، وتظهر الساعة في صف Others.
 *  - تذكير 9 صباحاً للموارد البشرية بانتهاء الإجازة (قبل أسبوع وفي يوم العودة) إن لم تُحدَّد الساعة.
 * الحساب في src/engine/maternity.js وsrc/engine/attendance.js.
 */
import { json, clip, localDate, localTime, nowOf } from './util.js';
import { can } from './authz.js';
import { tzOf } from './close.js';
import { mailerFor, logMailFailure } from './mail.js';
import { mergeRules } from '../engine/requests.js';
import { loadWorkSettings } from './settings.js';
import { recomputePairs } from './recompute.js';
import {
  MATERNITY_LEAVE_TYPE, HOUR_POS, validateMaternity, leaveDates, leaveEndOf, returnDateOf, hourEndOf, hourPosOn, addDaysTo,
} from '../engine/maternity.js';

const DEFAULT_ORIGIN = 'https://nawa-hr.nawa-attendance.workers.dev';
const MAX_MAILS = 20;
export const OVERRIDE_UPSERT = `
  INSERT INTO day_overrides (employee_id, date, leave_type, reason, updated_by)
  SELECT ?1, value, ?2, ?3, ?4 FROM json_each(?5) WHERE true
  ON CONFLICT(employee_id, date) DO UPDATE SET leave_type = excluded.leave_type, reason = excluded.reason, updated_by = excluded.updated_by, updated_at = datetime('now')`;

const rowOut = (r) => {
  const rec = { deliveryDate: r.delivery_date, leaveDays: r.leave_days, hourPos: r.hour_pos };
  return {
    id: r.id, employeeId: r.employee_id, deliveryDate: rec.deliveryDate, leaveDays: rec.leaveDays, hourPos: rec.hourPos, note: r.note,
    leaveEnd: leaveEndOf(rec), returnDate: returnDateOf(rec), hourEnd: hourEndOf(rec), createdBy: r.created_by,
  };
};

/** سجلات الأمومة لموظفين: خريطة employeeId ← [{deliveryDate, leaveDays, hourPos}]. بلا الجدول (قبل الترحيل) = فارغة. */
export async function loadMaternityMap(db, ids) {
  const map = new Map();
  if (!ids.length) return map;
  try {
    const rows = (await db.prepare('SELECT employee_id AS e, delivery_date AS deliveryDate, leave_days AS leaveDays, hour_pos AS hourPos FROM maternity WHERE employee_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all()).results;
    for (const r of rows) map.set(r.e, [...(map.get(r.e) || []), r]);
  } catch { /* الترحيل 0025 لم يُطبَّق */ }
  return map;
}

/** يضيف matHours = 1 لأيام الدوام التي تسري فيها ساعة الأمومة (يوم عمل بلا إجازة). daysBy: Map(employeeId ← {date: row}) */
export function applyMatHours(daysBy, matMap) {
  for (const [eid, recs] of matMap) {
    const days = daysBy.get(eid);
    if (!days) continue;
    for (const [date, row] of Object.entries(days)) if (row.dayType === 'عمل' && !row.leaveType && hourPosOn(date, recs)) row.matHours = 1;
  }
}

export async function recomputeRange(db, employeeId, from, to, today) {
  const settings = await loadWorkSettings(db);
  if (!settings) return;
  const hi = to < today ? to : today;
  const pairs = [];
  for (let d = from; d <= hi; d = addDaysTo(d, 1)) pairs.push({ e: employeeId, d });
  if (pairs.length) await recomputePairs(db, pairs, settings);
}

export function registerMaternityRoutes(add, kit) {
  const { bad, forbidden, notFound, readJson, auditStmt } = kit;

  const employeeOf = (db, id) => db.prepare('SELECT id, code, name, gender FROM employees WHERE id = ?').bind(id).first();

  add('GET', '/api/employees/:id/maternity', async ({ db, user, params }) => {
    if (!can(user, 'maternity.manage')) return forbidden();
    const e = await employeeOf(db, Number(params.id));
    if (!e) return notFound('الموظف');
    const rows = (await db.prepare('SELECT * FROM maternity WHERE employee_id = ? ORDER BY delivery_date DESC').bind(e.id).all()).results;
    return json({ ok: true, gender: e.gender, records: rows.map(rowOut) });
  });

  add('PUT', '/api/employees/:id/gender', async ({ request, db, user, params }) => {
    if (!can(user, 'maternity.manage')) return forbidden();
    const e = await employeeOf(db, Number(params.id));
    if (!e) return notFound('الموظف');
    const { body, error } = await readJson(request);
    if (error) return error;
    const g = body.gender === 'F' || body.gender === 'M' ? body.gender : null;
    if (g !== 'F' && (await db.prepare('SELECT COUNT(*) AS n FROM maternity WHERE employee_id = ?').bind(e.id).first('n')) > 0) return bad('للموظفة سجل إجازة وضع؛ احذفه أولاً قبل تغيير الجنس');
    await db.batch([db.prepare('UPDATE employees SET gender = ? WHERE id = ?').bind(g, e.id), auditStmt(db, user, 'employee.gender', 'employee', e.code, { gender: g })]);
    return json({ ok: true, gender: g });
  });

  add('POST', '/api/employees/:id/maternity', async ({ request, env, db, user, params }) => {
    if (!can(user, 'maternity.manage')) return forbidden();
    const e = await employeeOf(db, Number(params.id));
    if (!e) return notFound('الموظف');
    if (e.gender !== 'F') return bad('إجازة الوضع وساعة الأمومة للموظفات فقط؛ حدّد جنس الموظفة (أنثى) أولاً');
    const { body, error } = await readJson(request);
    if (error) return error;
    const v = validateMaternity(body);
    if (v.error) return bad(v.error);
    const rec = v.value;
    const overlap = (await db.prepare('SELECT delivery_date, leave_days FROM maternity WHERE employee_id = ?').bind(e.id).all()).results
      .some((r) => rec.deliveryDate <= leaveEndOf({ deliveryDate: r.delivery_date, leaveDays: r.leave_days }) && leaveEndOf(rec) >= r.delivery_date);
    if (overlap) return bad('تتداخل مع إجازة وضع أخرى لها');
    const note = clip(body.note, 200);
    const r = await db.prepare('INSERT INTO maternity (employee_id, delivery_date, leave_days, hour_pos, note, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(e.id, rec.deliveryDate, rec.leaveDays, rec.hourPos, note || null, user.email || null).run();
    await db.batch([
      db.prepare(OVERRIDE_UPSERT).bind(e.id, MATERNITY_LEAVE_TYPE, 'إجازة وضع', user.email || null, JSON.stringify(leaveDates(rec))),
      auditStmt(db, user, 'maternity.add', 'employee', e.code, { ...rec, note }),
    ]);
    const today = localDate(tzOf(env), nowOf(env));
    await recomputeRange(db, e.id, rec.deliveryDate, rec.hourPos ? hourEndOf(rec) : leaveEndOf(rec), today);
    return json({ ok: true, id: r.meta?.last_row_id ?? null }, 201);
  });

  // تعديل: عدد الأيام وموضع الساعة (تُحدَّد غالباً بعد العودة)
  add('PATCH', '/api/maternity/:mid', async ({ request, env, db, user, params }) => {
    if (!can(user, 'maternity.manage')) return forbidden();
    const old = await db.prepare('SELECT * FROM maternity WHERE id = ?').bind(Number(params.mid)).first();
    if (!old) return notFound('السجل');
    const e = await employeeOf(db, old.employee_id);
    const { body, error } = await readJson(request);
    if (error) return error;
    const v = validateMaternity({
      deliveryDate: body.deliveryDate ?? old.delivery_date,
      leaveDays: body.leaveDays ?? old.leave_days,
      hourPos: body.hourPos === undefined ? old.hour_pos : body.hourPos,
    });
    if (v.error) return bad(v.error);
    const rec = v.value;
    const before = { deliveryDate: old.delivery_date, leaveDays: old.leave_days, hourPos: old.hour_pos };
    const others = (await db.prepare('SELECT delivery_date, leave_days FROM maternity WHERE employee_id = ? AND id <> ?').bind(old.employee_id, old.id).all()).results;
    if (others.some((r) => rec.deliveryDate <= leaveEndOf({ deliveryDate: r.delivery_date, leaveDays: r.leave_days }) && leaveEndOf(rec) >= r.delivery_date)) return bad('تتداخل مع إجازة وضع أخرى لها');
    const stmts = [
      db.prepare('UPDATE maternity SET delivery_date = ?, leave_days = ?, hour_pos = ?, note = COALESCE(?, note) WHERE id = ?').bind(rec.deliveryDate, rec.leaveDays, rec.hourPos, body.note === undefined ? null : clip(body.note, 200), old.id),
      // أيام الإجازة القديمة التي لا تصحيح يدوياً فيها تُزال، ثم تُكتب الجديدة
      db.prepare(`DELETE FROM day_overrides WHERE employee_id = ?1 AND leave_type = ?2 AND date IN (SELECT value FROM json_each(?3)) AND in_time IS NULL AND out_time IS NULL AND ret_time IS NULL AND dep_time IS NULL AND request_id IS NULL`).bind(old.employee_id, MATERNITY_LEAVE_TYPE, JSON.stringify(leaveDates(before))),
      db.prepare(OVERRIDE_UPSERT).bind(old.employee_id, MATERNITY_LEAVE_TYPE, 'إجازة وضع', user.email || null, JSON.stringify(leaveDates(rec))),
      auditStmt(db, user, 'maternity.update', 'employee', e.code, { before, after: rec }),
    ];
    await db.batch(stmts);
    const today = localDate(tzOf(env), nowOf(env));
    const lo = before.deliveryDate < rec.deliveryDate ? before.deliveryDate : rec.deliveryDate;
    const end = (r) => (r.hourPos ? hourEndOf(r) : leaveEndOf(r));
    const hi = end(before) > end(rec) ? end(before) : end(rec);
    await recomputeRange(db, old.employee_id, lo, hi, today);
    return json({ ok: true });
  });

  add('DELETE', '/api/maternity/:mid', async ({ env, db, user, params }) => {
    if (!can(user, 'maternity.manage')) return forbidden();
    const old = await db.prepare('SELECT * FROM maternity WHERE id = ?').bind(Number(params.mid)).first();
    if (!old) return notFound('السجل');
    const e = await employeeOf(db, old.employee_id);
    const rec = { deliveryDate: old.delivery_date, leaveDays: old.leave_days, hourPos: old.hour_pos };
    await db.batch([
      db.prepare('DELETE FROM maternity WHERE id = ?').bind(old.id),
      db.prepare('DELETE FROM maternity_reminders WHERE maternity_id = ?').bind(old.id),
      db.prepare(`DELETE FROM day_overrides WHERE employee_id = ?1 AND leave_type = ?2 AND date IN (SELECT value FROM json_each(?3)) AND in_time IS NULL AND out_time IS NULL AND ret_time IS NULL AND dep_time IS NULL AND request_id IS NULL`).bind(old.employee_id, MATERNITY_LEAVE_TYPE, JSON.stringify(leaveDates(rec))),
      db.prepare(`UPDATE day_overrides SET leave_type = NULL WHERE employee_id = ?1 AND leave_type = ?2 AND date IN (SELECT value FROM json_each(?3))`).bind(old.employee_id, MATERNITY_LEAVE_TYPE, JSON.stringify(leaveDates(rec))),
      auditStmt(db, user, 'maternity.delete', 'employee', e.code, rec),
    ]);
    const today = localDate(tzOf(env), nowOf(env));
    await recomputeRange(db, old.employee_id, rec.deliveryDate, rec.hourPos ? hourEndOf(rec) : leaveEndOf(rec), today);
    return json({ ok: true });
  });
}

// ---------------------------------------------------------------- تذكير 9 صباحاً بانتهاء إجازة الوضع
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function reminderMessage(stage, { name, returnDate }, origin, employeeId) {
  const link = `${origin}/#/employees/${employeeId}`;
  const subject = stage === 'day' ? `اليوم عودة ${name} من إجازة الوضع: حدّد ساعة الأمومة` : `تعود ${name} من إجازة الوضع بتاريخ ${returnDate}: حدّد ساعة الأمومة`;
  const body = `${stage === 'day' ? 'عادت' : 'ستعود'} ${name} إلى العمل ${stage === 'day' ? 'اليوم' : `بتاريخ ${returnDate}`} بعد إجازة الوضع. لم تُحدَّد ساعة الأمومة لها بعد: افتح ملفها وحدّد إن كانت في بداية الدوام أو نهايته (تسري سنة تقويمية كاملة من العودة).`;
  const text = `${subject}\n\n${body}\n\nفتح ملف الموظفة: ${link}\n— نظام نوى للشؤون الإدارية، جمعية نوى للثقافة والفنون`;
  const html = `<div dir="rtl" lang="ar" style="font-family:Segoe UI,Tahoma,Arial,sans-serif;max-width:480px;margin:auto;padding:22px;border:1px solid #e6dccf;border-radius:14px;color:#2a1410"><p style="margin:0 0 12px;font-weight:700;font-size:16px">${esc(subject)}</p><p style="margin:0 0 14px;color:#5a4a45">${esc(body)}</p><p style="margin:0 0 16px"><a href="${esc(link)}" style="display:inline-block;background:#a21008;color:#fff;text-decoration:none;padding:9px 18px;border-radius:9px;font-weight:700">فتح ملف الموظفة</a></p><p style="margin:0;color:#72655f;font-size:12px">نظام نوى للشؤون الإدارية — جمعية نوى للثقافة والفنون</p></div>`;
  return { subject, text, html };
}

/** مرة يومياً (9 صباحاً محلياً): للموارد البشرية والمسؤول، قبل العودة بأسبوع (7 أيام فأقل) وفي يوم العودة وبعده، إن لم تُحدَّد الساعة. */
export async function maternityReminders(env, { origin = DEFAULT_ORIGIN, now = nowOf(env) } = {}) {
  const db = env.DB;
  const today = localDate(tzOf(env), now);
  const mailer = mailerFor(env);
  if (!mailer) return { sent: 0, reason: 'no_mail' };
  const stored = await db.prepare("SELECT value FROM settings WHERE key = 'requests'").first();
  let enabled = true;
  try { enabled = mergeRules(stored ? JSON.parse(stored.value) : null).notify.enabled; } catch { enabled = true; }
  if (!enabled) return { sent: 0, reason: 'disabled' };
  let rows;
  try {
    rows = (await db.prepare(
      `SELECT m.id, m.employee_id AS employeeId, m.delivery_date AS deliveryDate, m.leave_days AS leaveDays, e.name
         FROM maternity m JOIN employees e ON e.id = m.employee_id WHERE m.hour_pos IS NULL AND e.status = 'active'`,
    ).all()).results;
  } catch { return { sent: 0, reason: 'no_table' }; }
  const due = rows.map((r) => ({ ...r, returnDate: returnDateOf(r) })).map((r) => {
    const toReturn = Math.round((Date.parse(`${r.returnDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    return { ...r, stage: toReturn <= 0 ? 'day' : toReturn <= 7 ? 'week' : null };
  }).filter((r) => r.stage && today <= hourEndOf(r));
  if (!due.length) return { sent: 0, reason: 'none' };
  const users = (await db.prepare("SELECT id, email FROM users WHERE active = 1 AND role IN ('hr', 'admin')").all()).results.filter((u) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email || ''));
  const done = new Set((await db.prepare('SELECT maternity_id AS m, user_id AS u, stage FROM maternity_reminders').all()).results.map((r) => `${r.m}|${r.u}|${r.stage}`));
  let sent = 0;
  for (const r of due) {
    for (const u of users) {
      if (sent >= MAX_MAILS) return { sent };
      if (done.has(`${r.id}|${u.id}|${r.stage}`)) continue;
      try {
        await mailer.send({ to: u.email, ...reminderMessage(r.stage, r, origin, r.employeeId) });
        await db.prepare('INSERT OR IGNORE INTO maternity_reminders (maternity_id, user_id, stage) VALUES (?, ?, ?)').bind(r.id, u.id, r.stage).run();
        sent += 1;
      } catch (e) {
        await logMailFailure(db, 'maternity', r.id, e);
        return { sent, reason: 'mail_error' };
      }
    }
  }
  return { sent };
}
