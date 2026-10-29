/**
 * ربط المحرك بالقاعدة: يقرأ حركات الأيام المتأثرة والتصحيحات والعطل، يحسب بالمحرك، ويكتب daily_results.
 *
 * قيود D1 المجانية التي صُمّم حولها:
 *  - 50 استعلاماً لكل طلب  → عدد الاستعلامات ثابت (≈4) مهما كان عدد الأيام، لأن كل شيء يمرّ عبر json_each.
 *  - 100 متغيّر مربوط لكل استعلام → نمرّر مصفوفة JSON واحدة بدل متغيّر لكل قيمة.
 *  - 100 كيلوبايت لنص الاستعلام → الكتابة على دفعات من CHUNK يوماً.
 */
import { computeDay, dayTypeOf } from '../engine/attendance.js';

const CHUNK = 100;

/** pairs: [{e: employeeId, d: 'YYYY-MM-DD'}] — يُزال التكرار داخلياً */
function uniquePairs(pairs) {
  const seen = new Set();
  const out = [];
  for (const p of pairs) {
    const k = `${p.e}|${p.d}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ e: p.e, d: p.d });
    }
  }
  return out;
}

const UPSERT_SQL = `
INSERT INTO daily_results (employee_id, date, day_type, check_in, exit_first, return_last, departure, source,
  presence_hours, exit_hours, net_hours, required_hours, approved_hours, late_minutes, early_leave_minutes,
  deficit_hours, overtime_hours, status, alert, computed_at)
SELECT json_extract(value,'$.e'), json_extract(value,'$.d'), json_extract(value,'$.dayType'),
  json_extract(value,'$.checkIn'), json_extract(value,'$.exitFirst'), json_extract(value,'$.returnLast'),
  json_extract(value,'$.departure'), json_extract(value,'$.source'),
  json_extract(value,'$.presenceHours'), json_extract(value,'$.exitHours'), json_extract(value,'$.netHours'),
  json_extract(value,'$.requiredHours'), json_extract(value,'$.approvedHours'), json_extract(value,'$.lateMinutes'),
  json_extract(value,'$.earlyLeaveMinutes'), json_extract(value,'$.deficitHours'), json_extract(value,'$.overtimeHours'),
  json_extract(value,'$.status'), json_extract(value,'$.alert'), datetime('now')
FROM json_each(?) WHERE true
ON CONFLICT(employee_id, date) DO UPDATE SET
  day_type = excluded.day_type, check_in = excluded.check_in, exit_first = excluded.exit_first,
  return_last = excluded.return_last, departure = excluded.departure, source = excluded.source,
  presence_hours = excluded.presence_hours, exit_hours = excluded.exit_hours, net_hours = excluded.net_hours,
  required_hours = excluded.required_hours, approved_hours = excluded.approved_hours,
  late_minutes = excluded.late_minutes, early_leave_minutes = excluded.early_leave_minutes,
  deficit_hours = excluded.deficit_hours, overtime_hours = excluded.overtime_hours,
  status = excluded.status, alert = excluded.alert, computed_at = excluded.computed_at`;

/** إعادة حساب أزواج (موظف، يوم). يُرجع عدد الأيام المكتوبة. */
export async function recomputePairs(db, pairs, settings, extraStatements = []) {
  const list = uniquePairs(pairs);
  if (list.length === 0) {
    if (extraStatements.length) await db.batch(extraStatements);
    return 0;
  }
  let written = 0;
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    const key = JSON.stringify(chunk);
    const dates = JSON.stringify([...new Set(chunk.map((p) => p.d))]);

    const [mv, ov, hol] = await db.batch([
      db.prepare(
        `SELECT m.employee_id AS e, m.date AS d, m.type, m.time FROM movements m
         WHERE (m.employee_id, m.date) IN (SELECT json_extract(value,'$.e'), json_extract(value,'$.d') FROM json_each(?))`,
      ).bind(key),
      db.prepare(
        `SELECT o.employee_id AS e, o.date AS d, o.in_time, o.out_time, o.ret_time, o.dep_time, o.leave_type
         FROM day_overrides o
         WHERE (o.employee_id, o.date) IN (SELECT json_extract(value,'$.e'), json_extract(value,'$.d') FROM json_each(?))`,
      ).bind(key),
      db.prepare('SELECT date FROM holidays WHERE date IN (SELECT value FROM json_each(?))').bind(dates),
    ]);

    const holidays = new Set(hol.results.map((r) => r.date));
    const moves = new Map();
    for (const r of mv.results) {
      const k = `${r.e}|${r.d}`;
      if (!moves.has(k)) moves.set(k, []);
      moves.get(k).push({ type: r.type, time: r.time });
    }
    const overrides = new Map(ov.results.map((r) => [`${r.e}|${r.d}`, r]));

    const rows = chunk.map((p) => {
      const k = `${p.e}|${p.d}`;
      const o = overrides.get(k);
      const res = computeDay(
        {
          date: p.d,
          dayType: dayTypeOf(p.d, settings, holidays),
          movements: moves.get(k) || [],
          manual: o ? { in: o.in_time, out: o.out_time, ret: o.ret_time, dep: o.dep_time } : {},
          leaveType: o?.leave_type || '',
        },
        settings,
      );
      return { e: p.e, d: p.d, ...res };
    });

    const stmts = [db.prepare(UPSERT_SQL).bind(JSON.stringify(rows))];
    if (i + CHUNK >= list.length) stmts.push(...extraStatements); // آخر دفعة: نضمّ عبارات إضافية (مثل last_seen)
    await db.batch(stmts);
    written += rows.length;
  }
  return written;
}

/**
 * يحسب كل الأيام من from إلى to (شاملة) لموظف واحد حتى للأيام بلا حركات (غياب/عطلة).
 * يُستعمل في الاستيراد، وعند تغيير الإعدادات أو العطل، وفي الإقفال الليلي.
 */
export async function materializeRange(db, employeeId, from, to, settings) {
  const pairs = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86400000) {
    pairs.push({ e: employeeId, d: new Date(t).toISOString().slice(0, 10) });
  }
  return recomputePairs(db, pairs, settings);
}
