/**
 * الدخول الفعلي يلغي الإجازة المعتمدة لذلك اليوم (قرار 2 نوفمبر 2026).
 *
 * إجازة اعتُمدت ثم غيّر الموظف رأيه وحضر وسجّل دخوله على البوابة: حركة دخول حقيقية مرهونة بانصرافه آخر الدوام،
 * فلا يصحّ أن يبقى يومه «إجازة». نُفرج عن ذلك اليوم وحده من الطلب:
 *   - يُحذف من day_overrides (أو يُنزع منه نوع الإجازة إن كان عليه تصحيح يدوي بأوقات) فيُحسب يوم حضور،
 *   - تنقص أيام الطلب فيعود اليوم إلى الرصيد، وإن لم يبقَ يوم صار الطلب «ملغى» بسبب مكتوب،
 *   - يُسجَّل اليوم في leave_released (مَن/لماذا/متى) وفي سجل التدقيق، ويُشعَر الموظف ومعتمِد الإجازة.
 * يُستعمل أيضاً عند الحضور اليدوي (الموارد البشرية) بتأكيدها، بالإجراء نفسه.
 * كل شيء بعبارات جماعية عبر json_each فعدد الاستعلامات ثابت مهما كان عدد الأيام.
 */
import { mergeRules } from '../engine/requests.js';

const TRIPLES = `(SELECT json_extract(value,'$.e'), json_extract(value,'$.d'), json_extract(value,'$.rid') FROM json_each(?1))`;
const RIDS = `(SELECT DISTINCT json_extract(value,'$.rid') FROM json_each(?1))`;

export async function loadRules(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'requests'").first();
  try {
    return mergeRules(row ? JSON.parse(row.value) : null);
  } catch {
    return mergeRules(null);
  }
}

/** من أزواج (موظف، يوم) يُرجع التي عليها إجازة معتمدة من طلب: [{e, d, rid}] */
export async function findLeaveDays(db, pairs) {
  if (!pairs.length) return [];
  const key = JSON.stringify(pairs.map((p) => ({ e: p.e, d: p.d })));
  const r = await db
    .prepare(
      `SELECT o.employee_id AS e, o.date AS d, o.request_id AS rid FROM day_overrides o
       WHERE o.request_id IS NOT NULL AND o.leave_type IS NOT NULL
         AND (o.employee_id, o.date) IN (SELECT json_extract(value,'$.e'), json_extract(value,'$.d') FROM json_each(?))`,
    )
    .bind(key)
    .all();
  return r.results;
}

/**
 * يُفرج عن الأيام الموجودة (من findLeaveDays). يُرجع [{ requestId, employeeId, dates, cancelled, days }] لكل طلب.
 * بعد الاستدعاء على المستدعي أن يعيد حساب الأيام (recomputePairs).
 */
export async function releaseLeaveDays(db, found, { source, by, note }) {
  if (!found.length) return [];
  const key = JSON.stringify(found.map((f) => ({ e: f.e, d: f.d, rid: f.rid })));
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO leave_released (request_id, employee_id, date, source, released_by)
       SELECT json_extract(value,'$.rid'), json_extract(value,'$.e'), json_extract(value,'$.d'), ?2, ?3 FROM json_each(?1) WHERE true`).bind(key, source, by),
    db.prepare(`UPDATE leave_plan_days SET status = 'withdrawn' WHERE status = 'approved'
         AND (request_id, date) IN (SELECT json_extract(value,'$.rid'), json_extract(value,'$.d') FROM json_each(?1))`).bind(key),
    db.prepare(`DELETE FROM day_overrides WHERE (employee_id, date, request_id) IN ${TRIPLES}
         AND in_time IS NULL AND out_time IS NULL AND ret_time IS NULL AND dep_time IS NULL`).bind(key),
    db.prepare(`UPDATE day_overrides SET leave_type = NULL, request_id = NULL, updated_at = datetime('now')
         WHERE (employee_id, date, request_id) IN ${TRIPLES}`).bind(key),
    // لم يبقَ يوم: الطلب كله ملغى بسبب مكتوب
    db.prepare(`UPDATE requests SET status = 'cancelled', decided_by = ?2, decided_at = datetime('now'), decision_note = ?3
       WHERE id IN ${RIDS} AND status = 'approved'
         AND NOT EXISTS (SELECT 1 FROM day_overrides o WHERE o.request_id = requests.id AND o.leave_type IS NOT NULL)`).bind(key, by, note),
    // بقيت أيام: يُعاد عدّ المحتسب منها
    db.prepare(`UPDATE requests SET days = (SELECT COUNT(*) FROM day_overrides o WHERE o.request_id = requests.id AND o.leave_type IS NOT NULL)
       WHERE id IN ${RIDS} AND status = 'approved'`).bind(key),
    db.prepare(`INSERT INTO audit_log (actor, action, entity, entity_id, detail)
       SELECT ?2, 'request.release-day', 'request', json_extract(value,'$.rid'),
              json_object('employeeId', json_extract(value,'$.e'), 'date', json_extract(value,'$.d'), 'source', ?3, 'note', ?4)
       FROM json_each(?1) WHERE true`).bind(key, by, source, note),
  ]);
  const ids = JSON.stringify([...new Set(found.map((f) => f.rid))]);
  const now = (await db.prepare('SELECT id, employee_id AS employeeId, status, days FROM requests WHERE id IN (SELECT value FROM json_each(?))').bind(ids).all()).results;
  return now.map((r) => ({
    requestId: r.id,
    employeeId: r.employeeId,
    dates: found.filter((f) => f.rid === r.id).map((f) => f.d).sort(),
    cancelled: r.status === 'cancelled',
    days: r.days,
  }));
}

/** عند وصول حركة «حضور» حقيقية: يُفرج عن أيام الإجازة المعتمدة لأصحابها (إن كانت القاعدة مفعّلة). */
export async function releaseOnCheckIn(db, pairs) {
  const found = await findLeaveDays(db, pairs);
  if (!found.length) return [];
  if (!(await loadRules(db)).leave.cancelOnCheckIn) return [];
  return releaseLeaveDays(db, found, { source: 'checkin', by: 'system', note: 'أُلغي تلقائياً: سجّل الموظف دخولاً فعلياً على البوابة' });
}
