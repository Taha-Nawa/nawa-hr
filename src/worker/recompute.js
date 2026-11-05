/**
 * ربط المحرك بالقاعدة: يقرأ حركات الأيام المتأثرة والتصحيحات والعطل، يحسب بالمحرك، ويكتب daily_results.
 *
 * قيود D1 المجانية التي صُمّم حولها:
 *  - 50 استعلاماً لكل طلب  → عدد الاستعلامات ثابت (≈4) مهما كان عدد الأيام، لأن كل شيء يمرّ عبر json_each.
 *  - 100 متغيّر مربوط لكل استعلام → نمرّر مصفوفة JSON واحدة بدل متغيّر لكل قيمة.
 *  - 100 كيلوبايت لنص الاستعلام → الكتابة على دفعات من CHUNK يوماً.
 */
import { computeDay, dayTypeOf } from '../engine/attendance.js';
import { mergeRules } from '../engine/requests.js';

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

    const queries = (withExc) => [
      db.prepare(
        `SELECT m.employee_id AS e, m.date AS d, m.type, m.time FROM movements m
         WHERE (m.employee_id, m.date) IN (SELECT json_extract(value,'$.e'), json_extract(value,'$.d') FROM json_each(?))`,
      ).bind(key),
      db.prepare(
        `SELECT o.employee_id AS e, o.date AS d, o.in_time, o.out_time, o.ret_time, o.dep_time, o.leave_type
         FROM day_overrides o
         WHERE (o.employee_id, o.date) IN (SELECT json_extract(value,'$.e'), json_extract(value,'$.d') FROM json_each(?))`,
      ).bind(key),
      // العطل الرسمية (e فارغ) والدوام الاستثنائي المحتسب (e = الموظف) في استعلام واحد لتبقى ميزانية الاستعلامات
      db.prepare(
        `SELECT date, NULL AS e FROM holidays WHERE date IN (SELECT value FROM json_each(?1))${withExc ? `
         UNION ALL
         SELECT date, employee_id FROM work_exceptions WHERE counted = 1
           AND (employee_id, date) IN (SELECT json_extract(value,'$.e'), json_extract(value,'$.d') FROM json_each(?2))` : ''}`,
      ).bind(...(withExc ? [dates, key] : [dates])),
      // دقائق الأذونات المعتمدة (مغادرة/تأخير) لهذه الأيام
      db.prepare(
        `SELECT r.employee_id AS e, r.from_date AS d, r.kind, SUM(r.minutes) AS m FROM requests r
         WHERE r.status = 'approved' AND r.kind IN ('exit', 'late')
           AND (r.employee_id, r.from_date) IN (SELECT json_extract(value,'$.e'), json_extract(value,'$.d') FROM json_each(?))
         GROUP BY r.employee_id, r.from_date, r.kind`,
      ).bind(key),
      db.prepare("SELECT value FROM settings WHERE key = 'requests'"),
      // إخلاء فوري معلَن (أبكر وقت إن تعدّدت الإعلانات) لمركز الموظف في هذا اليوم أو لكل المراكز
      db.prepare(
        `SELECT p.e, p.d, MIN(em.dismiss_time) AS t
         FROM (SELECT json_extract(value,'$.e') AS e, json_extract(value,'$.d') AS d FROM json_each(?)) p
         JOIN employees x ON x.id = p.e
         JOIN emergencies em ON em.status = 'active' AND em.dismiss_time IS NOT NULL AND em.date = p.d
           AND (em.center_id IS NULL OR em.center_id = x.center_id)
         GROUP BY p.e, p.d`,
      ).bind(key),
    ];
    let res;
    try {
      res = await db.batch(queries(true));
    } catch (e) {
      // الهجرة 0020 لم تُطبَّق بعد: يعمل الحساب بدون الدوام الاستثنائي
      if (!/no such table: work_exceptions/.test(String(e?.message || e))) throw e;
      res = await db.batch(queries(false));
    }
    const [mv, ov, hol, pm, rl, em] = res;
    const exceptional = new Set(hol.results.filter((r) => r.e !== null).map((r) => `${r.e}|${r.date}`));
    const dismiss = new Map(em.results.map((r) => [`${r.e}|${r.d}`, r.t]));
    let exempt = true;
    try {
      exempt = mergeRules(rl.results[0] ? JSON.parse(rl.results[0].value) : null).permits.exempt;
    } catch {
      exempt = true;
    }
    const permits = new Map();
    if (exempt) for (const r of pm.results) permits.set(`${r.e}|${r.d}`, { ...(permits.get(`${r.e}|${r.d}`) || {}), [r.kind]: r.m });

    const holidays = new Set(hol.results.filter((r) => r.e === null).map((r) => r.date));
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
          permit: permits.get(k),
          dismissAt: dismiss.get(k),
          exception: exceptional.has(k),
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
