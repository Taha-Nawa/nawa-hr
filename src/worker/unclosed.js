/**
 * «لم يسجّلوا الانصراف»: من سجّل حضوره في يوم ولم يسجّل انصرافه، يوماً بيوم، فيبقى في القائمة حتى يُسجَّل الانصراف أو يُصحَّح اليوم.
 *   - الموظفون: daily_results.alert = «انصراف غير مسجّل» (يحسبه المحرك عند كل حركة أو تصحيح؛ لا إنذار في الإجازة أو العطلة
 *     أو بعد انصراف يدوي أو إخلاء طارئ، فلا نكرّر قواعده هنا). فهرس جزئي (0018) يجعل الاستعلام لا يمسح الجدول.
 *   - مزوّدو الخدمة: أيام فيها «حضور» بلا «انصراف» في provider_movements، لمزوّد فعّال ودون طارئ فعّال لمركزه ذلك اليوم.
 * يخدم لوحة اليوم (GET /api/unclosed بنطاق صلاحيات المستخدم) وتطبيق البوابة (GET /api/gate?action=unclosed بنطاق الجهاز).
 */
import { json, localDate, nowOf, addDays, isDate } from './util.js';
import { can, employeeScope } from './authz.js';
import { providerScope } from './providers.js';
import { tzOf } from './close.js';
import { ALERT } from '../engine/attendance.js';

export const DEFAULT_DAYS = 7;
export const MAX_DAYS = 31;
const LIMIT = 500;
const NONE = { sql: '0 = 1', params: [] };

export const clampDays = (v, max = MAX_DAYS) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : DEFAULT_DAYS;
};

// الحرف الحرفي لا المتغيّر: الفهرس الجزئي 0018 لا يُستعمل إلا إن طابق نص الشرط حرفياً.
export const EMP_SQL = (scope) => `
SELECT r.date, e.id, e.code, e.name, COALESCE(c.name, '') AS center, r.check_in AS checkIn,
  (SELECT m.type FROM movements m WHERE m.employee_id = r.employee_id AND m.date = r.date ORDER BY m.time DESC, m.iso DESC LIMIT 1) AS lastType,
  (SELECT m.time FROM movements m WHERE m.employee_id = r.employee_id AND m.date = r.date ORDER BY m.time DESC, m.iso DESC LIMIT 1) AS lastTime
FROM daily_results r
JOIN employees e ON e.id = r.employee_id AND e.status = 'active'
LEFT JOIN centers c ON c.id = e.center_id
WHERE r.date BETWEEN ? AND ? AND r.alert = '${ALERT.NO_DEPARTURE}' AND ${scope.sql}
  AND NOT EXISTS (SELECT 1 FROM unclosed_dismissed d WHERE d.kind = 'employee' AND d.person_id = e.id AND d.date = r.date)
ORDER BY r.date DESC, e.name
LIMIT ${LIMIT}`;

export const PROV_SQL = (scope) => `
SELECT m.date, p.id, p.code, p.name, COALESCE(c.name, '') AS center, MIN(CASE WHEN m.type = 'حضور' THEN m.time END) AS checkIn,
  (SELECT x.type FROM provider_movements x WHERE x.provider_id = m.provider_id AND x.date = m.date ORDER BY x.time DESC, x.iso DESC LIMIT 1) AS lastType,
  (SELECT x.time FROM provider_movements x WHERE x.provider_id = m.provider_id AND x.date = m.date ORDER BY x.time DESC, x.iso DESC LIMIT 1) AS lastTime
FROM provider_movements m
JOIN providers p ON p.id = m.provider_id AND p.active = 1
LEFT JOIN centers c ON c.id = p.center_id
WHERE m.date BETWEEN ? AND ? AND ${scope.sql}
  AND NOT EXISTS (SELECT 1 FROM unclosed_dismissed d WHERE d.kind = 'provider' AND d.person_id = p.id AND d.date = m.date)
  AND NOT EXISTS (SELECT 1 FROM emergencies em WHERE em.date = m.date AND em.status = 'active' AND (em.center_id IS NULL OR em.center_id = p.center_id))
GROUP BY m.provider_id, m.date
HAVING SUM(m.type = 'حضور') > 0 AND SUM(m.type = 'انصراف') = 0
ORDER BY m.date DESC, p.name
LIMIT ${LIMIT}`;

/** { today, from, days:[{date, isToday, items}], total, past } — أيام فيها غير منصرفين فقط، الأحدث أولاً. */
export async function loadUnclosed(db, { today, days, emp, prov }) {
  const from = addDays(today, -(days - 1));
  const run = (withDismissed) => {
    const strip = (q) => (withDismissed ? q : q.replace(/\n\s*AND NOT EXISTS \(SELECT 1 FROM unclosed_dismissed[^\n]*/g, ''));
    return Promise.all([
      emp.sql === NONE.sql ? { results: [] } : db.prepare(strip(EMP_SQL(emp))).bind(from, today, ...emp.params).all(),
      prov.sql === NONE.sql ? { results: [] } : db.prepare(strip(PROV_SQL(prov))).bind(from, today, ...prov.params).all(),
    ]);
  };
  let e, p;
  try {
    [e, p] = await run(true);
  } catch (err) {
    // الهجرة 0019 لم تُطبَّق بعد على هذه القاعدة: تبقى القائمة تعمل (دون «تجاهل») بدل أن تتعطل
    if (!/no such table: unclosed_dismissed/.test(String(err?.message || err))) throw err;
    [e, p] = await run(false);
  }
  const byDate = new Map();
  const add = (kind, r) => {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push({ kind, id: r.id, code: r.code, name: r.name, center: r.center, checkIn: r.checkIn || null, lastType: r.lastType || null, lastTime: r.lastTime || null });
  };
  for (const r of e.results) add('employee', r);
  for (const r of p.results) add('provider', r);
  const list = [...byDate.keys()].sort().reverse().map((date) => ({ date, isToday: date === today, items: byDate.get(date).sort((a, b) => a.name.localeCompare(b.name, 'ar')) }));
  const total = list.reduce((n, d) => n + d.items.length, 0);
  const todayN = list.find((d) => d.isToday)?.items.length || 0;
  return { today, from, days: list, total, past: total - todayN };
}

/** نطاق جهاز البوابة: أشخاص مركزه، ومن سُجّل حضوره على هذا الجهاز نفسه. جهاز بلا مركز يرى الجميع. */
function deviceScopes(device) {
  if (device.center_id == null) return { emp: { sql: '1 = 1', params: [] }, prov: { sql: '1 = 1', params: [] } };
  return {
    emp: { sql: "(e.center_id = ? OR EXISTS (SELECT 1 FROM movements g WHERE g.employee_id = e.id AND g.date = r.date AND g.type = 'حضور' AND g.device_id = ?))", params: [device.center_id, device.id] },
    prov: { sql: "(p.center_id = ? OR EXISTS (SELECT 1 FROM provider_movements g WHERE g.provider_id = p.id AND g.date = m.date AND g.type = 'حضور' AND g.device_id = ?))", params: [device.center_id, device.id] },
  };
}

export async function gateUnclosed(env, device, daysParam) {
  const today = localDate(tzOf(env), nowOf(env));
  return { ok: true, ...(await loadUnclosed(env.DB, { today, days: clampDays(daysParam, 14), ...deviceScopes(device) })) };
}

export function registerUnclosedRoutes(add, { bad, readJson, auditStmt } = {}) {
  add('GET', '/api/unclosed', async ({ env, db, user, url }) => {
    const today = localDate(tzOf(env), nowOf(env));
    const emp = employeeScope(user, 'e');
    const prov = can(user, 'provider.read') ? providerScope(user, 'p') : NONE;
    return json({ ok: true, ...(await loadUnclosed(db, { today, days: clampDays(url.searchParams.get('days')), emp, prov })) });
  });

  // تجاهل يوم بعينه (الموارد البشرية والمسؤول فقط): لأيام سابقة ضمن آخر MAX_DAYS يوماً؛ اليوم الحاضر لا يُتجاهل (قد يكون الموظف في الدوام).
  add('POST', '/api/unclosed/dismiss', async ({ env, db, user, request }) => {
    if (!['hr', 'admin'].includes(user.role)) return json({ ok: false, error: 'لا تملك صلاحية هذا الإجراء' }, 403);
    const r = await readJson(request);
    if (r.error) return r.error;
    const { kind, id, date } = r.body;
    if (kind !== 'employee' && kind !== 'provider') return bad('النوع غير صالح');
    if (!Number.isInteger(id) || id <= 0 || !isDate(date)) return bad('البيانات غير صالحة');
    const today = localDate(tzOf(env), nowOf(env));
    if (date >= today) return bad('لا يُتجاهل اليوم الحاضر؛ انتظر نهاية الدوام');
    if (date < addDays(today, -(MAX_DAYS - 1))) return bad('اليوم أقدم من الفترة المعروضة');
    const exists = await db.prepare(kind === 'employee' ? 'SELECT 1 AS x FROM employees WHERE id = ?' : 'SELECT 1 AS x FROM providers WHERE id = ?').bind(id).first();
    if (!exists) return json({ ok: false, error: 'الشخص غير موجود' }, 404);
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO unclosed_dismissed (kind, person_id, date, by_email) VALUES (?, ?, ?, ?)').bind(kind, id, date, user.email),
      auditStmt(db, user, 'unclosed.dismiss', kind, id, { date }),
    ]);
    return json({ ok: true });
  });
}
