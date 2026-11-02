/**
 * طوارئ الدوام: إعلان في يوم دوام لمركز (أو لكل المراكز) يترتب عليه، حسب اختيار المسؤول:
 *  - إخلاء فوري عند ساعة معيّنة: ينتهي الدوام الفعلي عندها فلا يُحسب عجز ولا انصراف مبكر (يُطبّقه المحرك عبر recompute.js).
 *  - احتساب اليوم كاملاً بنوع إجازة من إعدادات الدوام (طارئة أو أخرى أو غيرها): يُكتب لكل موظف فعّال في النطاق في day_overrides.
 * الإعلان لا يمسّ إجازة معتمدة ولا تصحيحاً يدوياً قائماً على اليوم نفسه، وإلغاؤه يزيل ما كتبه فقط ويعيد حساب الأيام.
 */
import { loadWorkSettings } from './settings.js';
import { recomputePairs } from './recompute.js';
import { tzOf } from './close.js';
import { json, isDate, isTime, clip, localDate, addDays } from './util.js';
import { can } from './authz.js';
import { dayTypeOf, DAY_WORK, toMin } from '../engine/attendance.js';

const MAX_BACK_DAYS = 366;

/** الموظفون الفعّالون في نطاق الإعلان في ذلك اليوم (?1 = المركز أو NULL للكل، ?2 = التاريخ) */
const SCOPE_WHERE = `e.status = 'active' AND (?1 IS NULL OR e.center_id = ?1)
  AND (e.start_date IS NULL OR e.start_date <= ?2) AND (e.end_date IS NULL OR e.end_date >= ?2)`;

export function registerEmergencyRoutes(add, kit) {
  const { bad, forbidden, notFound, readJson, auditStmt } = kit;

  const scopeIds = async (db, centerId, date) =>
    (await db.prepare(`SELECT e.id FROM employees e WHERE ${SCOPE_WHERE}`).bind(centerId, date).all()).results.map((r) => r.id);

  async function recomputeScope(db, centerId, date, settings) {
    const ids = await scopeIds(db, centerId, date);
    await recomputePairs(db, ids.map((e) => ({ e, d: date })), settings);
    return ids.length;
  }

  add('GET', '/api/emergencies', async ({ db, user }) => {
    if (!can(user, 'settings.read')) return forbidden();
    const rows = (
      await db
        .prepare(
          `SELECT em.id, em.date, em.center_id AS centerId, c.name AS center, em.dismiss_time AS dismissTime, em.leave_type AS leaveType,
                  em.note, em.status, em.created_by AS createdBy, em.created_at AS createdAt, em.cancelled_by AS cancelledBy, em.cancelled_at AS cancelledAt
           FROM emergencies em LEFT JOIN centers c ON c.id = em.center_id ORDER BY em.date DESC, em.id DESC LIMIT 50`,
        )
        .all()
    ).results;
    return json({ ok: true, emergencies: rows, canManage: can(user, 'emergency.manage') });
  });

  add('POST', '/api/emergencies', async ({ env, db, user, request }) => {
    if (!can(user, 'emergency.manage')) return forbidden();
    const { body, error } = await readJson(request);
    if (error) return error;
    const settings = await loadWorkSettings(db);
    if (!settings) return bad('إعدادات الدوام غير مكتملة', 409);

    const today = localDate(tzOf(env));
    const date = body?.date;
    if (!isDate(date)) return bad('التاريخ غير صالح');
    if (date > today) return bad('لا يُعلن طارئ ليوم لم يأتِ بعد');
    if (date < addDays(today, -MAX_BACK_DAYS)) return bad('التاريخ أقدم من المسموح');

    let centerId = null;
    if (body.centerId !== null && body.centerId !== undefined && body.centerId !== '') {
      centerId = Number(body.centerId);
      if (!Number.isInteger(centerId) || !(await db.prepare('SELECT 1 FROM centers WHERE id = ?').bind(centerId).first())) return bad('المركز غير موجود', 404);
    }

    const dismissTime = body.dismissTime ? String(body.dismissTime) : null;
    if (dismissTime !== null && (!isTime(dismissTime) || toMin(dismissTime) <= toMin(settings.start) || toMin(dismissTime) >= toMin(settings.end))) {
      return bad(`وقت الإخلاء يجب أن يقع بين بداية الدوام (${settings.start}) ونهايته (${settings.end})`);
    }
    const leaveType = body.leaveType ? String(body.leaveType) : null;
    if (leaveType !== null && !(leaveType in settings.leaveTypes)) return bad('اختر نوع الإجازة كما في إعدادات الدوام');
    if (dismissTime === null && leaveType === null) return bad('حدّد إخلاءً فورياً أو احتساب اليوم كاملاً (أو الاثنين)');

    const hol = await db.prepare('SELECT 1 FROM holidays WHERE date = ?').bind(date).first();
    if (dayTypeOf(date, settings, new Set(hol ? [date] : [])) !== DAY_WORK) return bad('هذا اليوم عطلة وليس يوم دوام');

    const dup = await db.prepare("SELECT id FROM emergencies WHERE status = 'active' AND date = ? AND center_id IS ?").bind(date, centerId).first();
    if (dup) return bad(`يوجد إعلان نشط لليوم والمركز نفسيهما (#${dup.id}). ألغِه ثم أعلن من جديد.`, 409);

    const note = clip(body.note, 300) || null;
    const ins = await db
      .prepare('INSERT INTO emergencies (date, center_id, dismiss_time, leave_type, note, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(date, centerId, dismissTime, leaveType, note, user.email)
      .run();
    const id = ins.meta.last_row_id;
    try {
      const stmts = [];
      if (leaveType !== null) {
        // لا يطغى على إجازة معتمدة أو نوع مسجّل مسبقاً في اليوم نفسه (WHERE في DO UPDATE)، ويحفظ أوقات أي تصحيح يدوي قائم
        stmts.push(
          db
            .prepare(
              `INSERT INTO day_overrides (employee_id, date, leave_type, reason, updated_by, emergency_id)
               SELECT e.id, ?2, ?3, ?4, ?5, ?6 FROM employees e WHERE ${SCOPE_WHERE}
               ON CONFLICT(employee_id, date) DO UPDATE SET leave_type = excluded.leave_type, emergency_id = excluded.emergency_id,
                 updated_by = excluded.updated_by, updated_at = datetime('now') WHERE day_overrides.leave_type IS NULL`,
            )
            .bind(centerId, date, leaveType, `emg:${id}`, user.email, id),
        );
      }
      stmts.push(auditStmt(db, user, 'emergency.declare', 'emergency', id, { date, centerId, dismissTime, leaveType, note }));
      await db.batch(stmts);
    } catch (e) {
      await db.prepare('DELETE FROM emergencies WHERE id = ?').bind(id).run();
      throw e;
    }
    const employees = await recomputeScope(db, centerId, date, settings);
    return json({ ok: true, id, employees }, 201);
  });

  add('POST', '/api/emergencies/:id/cancel', async ({ db, user, params }) => {
    if (!can(user, 'emergency.manage')) return forbidden();
    const id = Number(params.id);
    const em = Number.isInteger(id) ? await db.prepare('SELECT id, date, center_id AS centerId, status FROM emergencies WHERE id = ?').bind(id).first() : null;
    if (!em) return notFound();
    if (em.status !== 'active') return bad('الإعلان ملغى مسبقاً', 409);
    const settings = await loadWorkSettings(db);
    await db.batch([
      db.prepare("UPDATE emergencies SET status = 'cancelled', cancelled_by = ?, cancelled_at = datetime('now') WHERE id = ? AND status = 'active'").bind(user.email, id),
      // نفس نمط إلغاء الإجازة: يُحذف سطر الإعلان إن لم يكن فيه تصحيح يدوي، وإلا يُنزع منه النوع فقط
      db.prepare('DELETE FROM day_overrides WHERE emergency_id = ? AND in_time IS NULL AND out_time IS NULL AND ret_time IS NULL AND dep_time IS NULL').bind(id),
      db.prepare('UPDATE day_overrides SET leave_type = NULL, emergency_id = NULL WHERE emergency_id = ?').bind(id),
      auditStmt(db, user, 'emergency.cancel', 'emergency', id, { date: em.date, centerId: em.centerId }),
    ]);
    const employees = settings ? await recomputeScope(db, em.centerId, em.date, settings) : 0;
    return json({ ok: true, employees });
  });
}
