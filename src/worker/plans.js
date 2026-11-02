/**
 * الإجازات المتوقعة (التخطيط المسبق) — قرار 2 نوفمبر 2026.
 *
 *  - الموظف يختار أياماً في تقويم شهري فتبقى «متوقعة» (مسودة) إلى أن يعتمدها من طرفه ويرسلها إلى مسؤوله.
 *  - المسؤول (المدير المباشر لمرؤوسه، أو الموارد البشرية/المدير العام/المسؤول) يقرّر يوماً يوماً: معتمد أو مرفوض (سبب الرفض إلزامي).
 *  - اعتماد الأيام يحوّلها إلى طلبات إجازة معتمدة عادية (طلب لكل فترة متصلة): تدخل الحضور والرصيد والتايم شيت كأي إجازة،
 *    وإلغاء الطلب بعدها يحرّر أيام الخطة. والدخول الفعلي على البوابة يلغي الإجازة كما في أي إجازة معتمدة.
 *  - لا أحد يقرّر خطته بنفسه. المسودات يراها صاحبها وحده. اليوم الواحد لا يكون في خطتين فعّالتين ولا فوق إجازة قائمة.
 *  - كل عملية كتابة دفعة واحدة ذرّية (db.batch) ضمن حدود الخطة المجانية (50 استعلاماً للطلب الواحد).
 */
import { loadWorkSettings } from './settings.js';
import { recomputePairs } from './recompute.js';
import { loadRules } from './release.js';
import { tzOf } from './close.js';
import { employeeBalance } from './balances.js';
import { notifyPlan } from './notify.js';
import { json, isDate, clip, localDate, nowOf, addDays, daysBetween } from './util.js';
import { canReadEmployee, canDecideRequest, canManageRequests, employeeScope } from './authz.js';
import { dayTypeOf, DAY_WORK } from '../engine/attendance.js';
import { workingDates, suggestLeaveType } from '../engine/requests.js';
import { validatePlan, planRuns, earliestPlanDate, MAX_PLAN_DAYS } from '../engine/plans.js';

const LIST_LIMIT = 200;
const CAL_EMPLOYEES = 300;
const CAL_MAX_DAYS = 400;
const DECIDERS = ['manager', 'hr', 'director', 'admin'];
const WIDE = ['hr', 'director', 'admin'];

const COLS = `p.id, p.employee_id AS employeeId, p.purpose, p.note, p.status, p.created_by AS createdBy, p.created_at AS createdAt,
  p.submitted_at AS submittedAt, p.decided_by AS decidedBy, p.decided_at AS decidedAt, p.decision_note AS decisionNote`;

const SUMMARY = `LEFT JOIN (SELECT plan_id, COUNT(*) AS n, MIN(date) AS first, MAX(date) AS last,
    SUM(status = 'approved') AS approved, SUM(status = 'rejected') AS rejected, SUM(status = 'planned') AS planned
  FROM leave_plan_days WHERE status != 'withdrawn' GROUP BY plan_id) s ON s.plan_id = p.id`;

const DETAIL_SQL = `SELECT ${COLS}, e.name AS employeeName, e.code AS employeeCode, e.job_title AS jobTitle, e.department,
  e.manager_id AS managerId, m.name AS managerName,
  (SELECT ee.name FROM users uu JOIN employees ee ON ee.id = uu.employee_id WHERE uu.email = p.decided_by) AS decidedByName
  FROM leave_plans p JOIN employees e ON e.id = p.employee_id LEFT JOIN employees m ON m.id = e.manager_id`;

/** أول يوم وآخر يوم في قائمة تواريخ صالحة (لجلب العطل)؛ بلا تواريخ صالحة: اليوم نفسه. */
function spanOf(dates, fallback) {
  const ok = (Array.isArray(dates) ? dates : []).filter(isDate).sort();
  return ok.length ? { from: ok[0], to: ok[ok.length - 1] } : { from: fallback, to: fallback };
}

export function registerPlanRoutes(add, kit) {
  const { bad, forbidden, notFound, readJson, auditStmt } = kit;

  async function context(env, db, from, to) {
    const tz = tzOf(env);
    const today = localDate(tz, nowOf(env));
    const [settings, rules, hol] = await Promise.all([
      loadWorkSettings(db),
      loadRules(db),
      from && to ? db.prepare('SELECT date FROM holidays WHERE date BETWEEN ? AND ?').bind(from, to).all() : { results: [] },
    ]);
    return { today, settings, rules, holidays: new Set(hol.results.map((r) => r.date)) };
  }

  /** من يملك حق اتخاذ قرار على خطط الآخرين. */
  const inboxWhere = (user) => {
    const own = user.employeeId ?? -1;
    if (WIDE.includes(user.role)) return { sql: "p.status = 'submitted' AND p.employee_id != ?", params: [own] };
    if (user.role === 'manager' && user.employeeId != null) return { sql: "p.status = 'submitted' AND e.manager_id = ? AND p.employee_id != ?", params: [own, own] };
    return null;
  };

  /** أول يوم من أيام الخطة يتعارض مع خطة أخرى أو طلب إجازة قائم أو إجازة مسجّلة (null = لا تعارض). */
  async function clashOf(db, employeeId, dates, exceptPlanId = 0, approvedOnly = false) {
    const row = await db
      .prepare(
        `SELECT * FROM (
           SELECT d.value AS date,
             CASE
               WHEN ?4 = 0 AND EXISTS (SELECT 1 FROM leave_plan_days x WHERE x.employee_id = ?1 AND x.date = d.value AND x.status IN ('planned', 'approved') AND x.plan_id != ?3) THEN 'plan'
               WHEN EXISTS (SELECT 1 FROM requests r WHERE r.employee_id = ?1 AND r.kind = 'leave' AND r.from_date <= d.value AND r.to_date >= d.value
                              AND r.status IN (SELECT value FROM json_each(CASE WHEN ?4 = 1 THEN '["approved"]' ELSE '["pending","approved"]' END))) THEN 'request'
               WHEN EXISTS (SELECT 1 FROM day_overrides o WHERE o.employee_id = ?1 AND o.date = d.value AND o.leave_type IS NOT NULL) THEN 'leave'
             END AS why
           FROM json_each(?2) d
         ) WHERE why IS NOT NULL ORDER BY date LIMIT 1`,
      )
      .bind(employeeId, JSON.stringify(dates), exceptPlanId, approvedOnly ? 1 : 0)
      .first();
    return row || null;
  }

  const clashText = (c) =>
    ({
      plan: `يوم ${c.date} موجود في خطة إجازات أخرى لك`,
      request: `يوم ${c.date} ضمن طلب إجازة قائم`,
      leave: `يوم ${c.date} عليه إجازة أو نوع يوم مسجّل مسبقاً`,
    })[c.why];

  /** تحميل خطة مع أيامها وصلاحيات المستخدم عليها. */
  async function loadPlan(db, user, id) {
    const row = await db.prepare(`${DETAIL_SQL} WHERE p.id = ?`).bind(id).first();
    if (!row) return { row: null };
    const target = { id: row.employeeId, manager_id: row.managerId };
    const owner = user.employeeId != null && user.employeeId === row.employeeId;
    // المسودة لصاحبها وحده؛ غيرها لمن يحق له قراءة الموظف
    if ((row.status === 'draft' && !owner) || !canReadEmployee(user, target)) return { row, forbidden: true };
    const mayManage = canManageRequests(user, target);
    const mayDecide = canDecideRequest(user, target);
    row.can = {
      edit: owner && row.status === 'draft',
      submit: owner && row.status === 'draft',
      withdraw: owner && row.status === 'submitted',
      cancel: (owner && ['draft', 'submitted'].includes(row.status)) || (row.status === 'submitted' && mayManage),
      decide: row.status === 'submitted' && mayDecide,
    };
    // owner/mayManage/mayDecide: للفصل بين «ممنوع» (403) و«الحالة لا تسمح» (409)
    return { row, target, owner, mayManage, mayDecide };
  }

  const daysOf = async (db, id) =>
    (await db.prepare('SELECT date, status, request_id AS requestId FROM leave_plan_days WHERE plan_id = ? ORDER BY date').bind(id).all()).results;

  const INSERT_DAYS = `INSERT INTO leave_plan_days (plan_id, employee_id, date, status)
    SELECT ?1, ?2, value, 'planned' FROM json_each(?3) WHERE true`;
  // خطة جديدة: رقمها هو last_insert_rowid() لأن الدفعة تُنفَّذ بالترتيب في معاملة واحدة
  const INSERT_DAYS_NEW = `INSERT INTO leave_plan_days (plan_id, employee_id, date, status)
    SELECT last_insert_rowid(), ?1, value, 'planned' FROM json_each(?2) WHERE true`;

  // ------------------------------------------------------------ بيانات الشاشة
  add('GET', '/api/plans/meta', async ({ env, db, user }) => {
    const ctx = await context(env, db);
    const ib = inboxWhere(user);
    const pending = ib ? await db.prepare(`SELECT COUNT(*) AS n FROM leave_plans p JOIN employees e ON e.id = p.employee_id WHERE ${ib.sql}`).bind(...ib.params).first('n') : 0;
    return json({
      ok: true,
      today: ctx.today,
      linked: user.employeeId != null,
      canDecide: DECIDERS.includes(user.role),
      pending,
      work: ctx.settings ? { weekdays: ctx.settings.weekdays } : null,
      rules: { minNoticeDays: ctx.rules.annual.minNoticeDays, maxAheadDays: ctx.rules.maxAheadDays, maxDays: MAX_PLAN_DAYS },
      earliest: { annual: earliestPlanDate('annual', ctx.today, ctx.rules), other: earliestPlanDate('other', ctx.today, ctx.rules) },
      leaveTypes: ctx.settings ? Object.keys(ctx.settings.leaveTypes) : [],
    });
  });

  /**
   * تقويم موظف أو فريق لمدى من الأيام (حتى 400 يوم):
   *   off      : أيام العطلة (أسبوعية/رسمية) ليظهر عمودها رمادياً
   *   employees: [{ id, name, code, job, department, days: { 'YYYY-MM-DD': { s, p, r } } }]
   *              s = draft | planned | approved | rejected ، p = رقم الخطة ، r = رقم طلب الإجازة
   * المسودات لا يراها غير صاحبها. معه رصيد صاحب التقويم في سنوات المدى (scope=mine).
   */
  add('GET', '/api/plans/calendar', async ({ env, db, user, url }) => {
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!isDate(from) || !isDate(to) || to < from || daysBetween(from, to) > CAL_MAX_DAYS) return bad('المدى غير صالح');
    const mine = url.searchParams.get('scope') === 'mine';
    if (mine && user.employeeId == null) return json({ ok: true, from, to, off: {}, employees: [], balance: [] });
    const ctx = await context(env, db, from, to);
    if (!ctx.settings) return bad('لم تُدخل إعدادات الدوام بعد', 409);
    const sc = mine ? { sql: 'e.id = ?', params: [user.employeeId] } : employeeScope(user, 'e');
    const emps = (
      await db
        .prepare(`SELECT e.id, e.name, e.code, e.job_title AS job, e.department FROM employees e WHERE e.status = 'active' AND ${sc.sql} ORDER BY e.name LIMIT ${CAL_EMPLOYEES}`)
        .bind(...sc.params)
        .all()
    ).results;
    const me = user.employeeId ?? -1;
    const [pd, ov, pend] = await Promise.all([
      db
        .prepare(
          `SELECT d.employee_id AS e, d.date, d.status, d.plan_id AS p, d.request_id AS r, pl.status AS planStatus
           FROM leave_plan_days d JOIN leave_plans pl ON pl.id = d.plan_id JOIN employees e ON e.id = d.employee_id
           WHERE d.date BETWEEN ? AND ? AND d.status != 'withdrawn' AND ${sc.sql} AND (pl.status != 'draft' OR d.employee_id = ?)`,
        )
        .bind(from, to, ...sc.params, me)
        .all(),
      db
        .prepare(
          `SELECT o.employee_id AS e, o.date, o.request_id AS r FROM day_overrides o JOIN employees e ON e.id = o.employee_id
           WHERE o.date BETWEEN ? AND ? AND o.leave_type IS NOT NULL AND o.request_id IS NOT NULL AND ${sc.sql}`,
        )
        .bind(from, to, ...sc.params)
        .all(),
      db
        .prepare(
          `SELECT r.employee_id AS e, r.id AS r, r.from_date AS f, r.to_date AS t FROM requests r JOIN employees e ON e.id = r.employee_id
           WHERE r.kind = 'leave' AND r.status = 'pending' AND r.to_date >= ? AND r.from_date <= ? AND ${sc.sql}`,
        )
        .bind(from, to, ...sc.params)
        .all(),
    ]);
    const days = new Map(emps.map((e) => [e.id, {}]));
    for (const x of pd.results) {
      const slot = days.get(x.e);
      if (!slot) continue;
      const s = x.status === 'planned' ? (x.planStatus === 'draft' ? 'draft' : 'planned') : x.status;
      slot[x.date] = { s, p: x.p, r: x.r };
    }
    for (const x of ov.results) {
      const slot = days.get(x.e);
      if (slot && !slot[x.date]) slot[x.date] = { s: 'approved', p: null, r: x.r };
    }
    for (const x of pend.results) {
      const slot = days.get(x.e);
      if (!slot) continue;
      for (const d of workingDates(x.f < from ? from : x.f, x.t > to ? to : x.t, ctx.settings, ctx.holidays)) if (!slot[d]) slot[d] = { s: 'planned', p: null, r: x.r };
    }
    const off = {};
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const t = dayTypeOf(d, ctx.settings, ctx.holidays);
      if (t !== DAY_WORK) off[d] = t;
    }
    let balance = [];
    if (mine) {
      const years = [...new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))])];
      balance = await Promise.all(years.map(async (year) => ({ year, items: await employeeBalance(db, user.employeeId, year, ctx.rules) })));
    }
    return json({ ok: true, from, to, today: ctx.today, off, employees: emps.map((e) => ({ ...e, days: days.get(e.id) })), balance });
  });

  // ------------------------------------------------------------ القوائم والتفاصيل
  add('GET', '/api/plans', async ({ db, user, url }) => {
    const scope = url.searchParams.get('scope') || 'mine';
    const where = [];
    const params = [];
    if (scope === 'mine') {
      if (user.employeeId == null) return json({ ok: true, plans: [] });
      where.push('p.employee_id = ?');
      params.push(user.employeeId);
    } else if (scope === 'inbox') {
      const ib = inboxWhere(user);
      if (!ib) return json({ ok: true, plans: [] });
      where.push(ib.sql);
      params.push(...ib.params);
    } else {
      const sc = employeeScope(user, 'e');
      where.push(sc.sql, "(p.status != 'draft' OR p.employee_id = ?)");
      params.push(...sc.params, user.employeeId ?? -1);
    }
    const status = url.searchParams.get('status');
    if (status && ['draft', 'submitted', 'approved', 'rejected', 'cancelled'].includes(status)) {
      where.push('p.status = ?');
      params.push(status);
    }
    const r = await db
      .prepare(
        `SELECT ${COLS}, e.name AS employeeName, e.code AS employeeCode, COALESCE(s.n, 0) AS dayCount, s.first AS firstDate, s.last AS lastDate,
           COALESCE(s.approved, 0) AS approvedCount, COALESCE(s.rejected, 0) AS rejectedCount, COALESCE(s.planned, 0) AS plannedCount
         FROM leave_plans p JOIN employees e ON e.id = p.employee_id ${SUMMARY}
         WHERE ${where.join(' AND ')} ORDER BY ${scope === 'inbox' ? 'p.submitted_at, p.id' : 'p.id DESC'} LIMIT ${LIST_LIMIT}`,
      )
      .bind(...params)
      .all();
    return json({ ok: true, plans: r.results });
  });

  add('GET', '/api/plans/:id', async ({ env, db, user, params }) => {
    const { row, forbidden: no } = await loadPlan(db, user, Number(params.id));
    if (!row) return notFound('الخطة');
    if (no) return forbidden();
    const days = await daysOf(db, row.id);
    const live = days.filter((d) => d.status !== 'withdrawn');
    const span = spanOf(live.map((d) => d.date), '2000-01-01');
    const ctx = await context(env, db, span.from, span.to);
    // رصيد صاحب الخطة في سنواتها، مع أيام هذه الخطة المخطَّطة، ليرى المعتمِد أثر قراره
    const years = [...new Set(live.map((d) => Number(d.date.slice(0, 4))))];
    const balance = await Promise.all(
      years.map(async (year) => ({
        year,
        items: await employeeBalance(db, row.employeeId, year, ctx.rules),
        planned: live.filter((d) => d.status === 'planned' && d.date.startsWith(`${year}-`)).length,
      })),
    );
    // كم زميلاً من فريق المدير نفسه غائب في كل يوم (متوقع أو معتمد): يساعد المعتمِد على الموازنة
    let teamOff = {};
    if (row.can.decide && row.managerId != null && live.length) {
      const t = await db
        .prepare(
          `SELECT date, COUNT(DISTINCT employee_id) AS n FROM (
             SELECT d.date, d.employee_id FROM leave_plan_days d JOIN employees e ON e.id = d.employee_id JOIN leave_plans pl ON pl.id = d.plan_id
              WHERE e.manager_id = ?1 AND d.employee_id != ?2 AND d.date IN (SELECT value FROM json_each(?3))
                AND (d.status = 'approved' OR (d.status = 'planned' AND pl.status = 'submitted'))
             UNION ALL
             SELECT o.date, o.employee_id FROM day_overrides o JOIN employees e ON e.id = o.employee_id
              WHERE e.manager_id = ?1 AND o.employee_id != ?2 AND o.leave_type IS NOT NULL AND o.request_id IS NOT NULL AND o.date IN (SELECT value FROM json_each(?3))
           ) GROUP BY date`,
        )
        .bind(row.managerId, row.employeeId, JSON.stringify(live.map((d) => d.date)))
        .all();
      teamOff = Object.fromEntries(t.results.map((x) => [x.date, x.n]));
    }
    // أيام تغيّر وضعها منذ التخطيط (عطلة أضيفت) ليراها المعتمِد
    const offDays = Object.fromEntries(live.filter((d) => ctx.settings && dayTypeOf(d.date, ctx.settings, ctx.holidays) !== DAY_WORK).map((d) => [d.date, true]));
    return json({
      ok: true,
      plan: row,
      days,
      balance,
      teamOff,
      offDays,
      leaveTypes: ctx.settings ? Object.keys(ctx.settings.leaveTypes) : [],
      suggestedLeaveType: ctx.settings ? suggestLeaveType(row.purpose, ctx.settings.leaveTypes) : null,
    });
  });

  // ------------------------------------------------------------ الإنشاء والتعديل (صاحب الخطة)
  async function prepare(env, db, user, body, exceptPlanId = 0) {
    if (user.employeeId == null) return { error: bad('حسابك غير مرتبط بسجل موظف، فلا يمكن تخطيط إجازات') };
    const emp = await db.prepare('SELECT id, status FROM employees WHERE id = ?').bind(user.employeeId).first();
    if (!emp || emp.status !== 'active') return { error: bad('سجل الموظف متوقف عن العمل') };
    const sp = spanOf(body.dates, '2000-01-01');
    const ctx = await context(env, db, sp.from, sp.to);
    const v = validatePlan(body, ctx);
    if (!v.ok) return { error: bad(v.error, v.status || 400) };
    const clash = await clashOf(db, user.employeeId, v.value.dates, exceptPlanId);
    if (clash) return { error: bad(clashText(clash), 409) };
    return { v: v.value, ctx };
  }

  add('POST', '/api/plans', async ({ request, env, db, user, url, defer }) => {
    const { body, error } = await readJson(request);
    if (error) return error;
    const p = await prepare(env, db, user, body);
    if (p.error) return p.error;
    const submit = body.submit === true;
    let res;
    try {
      res = await db.batch([
        db
          .prepare(`INSERT INTO leave_plans (employee_id, purpose, note, status, created_by, submitted_at) VALUES (?1, ?2, ?3, ?4, ?5, ${submit ? "datetime('now')" : 'NULL'})`)
          .bind(user.employeeId, p.v.purpose, p.v.note || null, submit ? 'submitted' : 'draft', user.email),
        db.prepare(INSERT_DAYS_NEW).bind(user.employeeId, JSON.stringify(p.v.dates)),
        auditStmt(db, user, submit ? 'plan.submit' : 'plan.create', 'plan', null, { days: p.v.dates.length, purpose: p.v.purpose }),
      ]);
    } catch (e) {
      if (/UNIQUE/i.test(String(e?.message || e))) return bad('أحد الأيام صار في خطة أخرى، أعد تحميل التقويم', 409);
      throw e;
    }
    const id = res[0].meta.last_row_id;
    if (submit) await notifyPlan({ env, db, url, defer }, 'plan_submitted', id, { actor: user.email });
    return json({ ok: true, id, status: submit ? 'submitted' : 'draft' }, 201);
  });

  add('PUT', '/api/plans/:id', async ({ request, env, db, user, params }) => {
    const { body, error } = await readJson(request);
    if (error) return error;
    const id = Number(params.id);
    const { row, forbidden: no, owner } = await loadPlan(db, user, id);
    if (!row) return notFound('الخطة');
    if (no || !owner) return forbidden();
    if (!row.can.edit) return bad('لا يمكن تعديل خطة أُرسلت، اسحبها أولاً لتعود مسودة', 409);
    const p = await prepare(env, db, user, body, id);
    if (p.error) return p.error;
    try {
      await db.batch([
        db.prepare("UPDATE leave_plans SET purpose = ?, note = ? WHERE id = ? AND status = 'draft'").bind(p.v.purpose, p.v.note || null, id),
        db.prepare('DELETE FROM leave_plan_days WHERE plan_id = ?').bind(id),
        db.prepare(INSERT_DAYS).bind(id, user.employeeId, JSON.stringify(p.v.dates)),
        auditStmt(db, user, 'plan.update', 'plan', id, { days: p.v.dates.length }),
      ]);
    } catch (e) {
      if (/UNIQUE/i.test(String(e?.message || e))) return bad('أحد الأيام صار في خطة أخرى، أعد تحميل التقويم', 409);
      throw e;
    }
    return json({ ok: true });
  });

  add('POST', '/api/plans/:id/submit', async ({ env, db, user, params, url, defer }) => {
    const id = Number(params.id);
    const { row, forbidden: no, owner } = await loadPlan(db, user, id);
    if (!row) return notFound('الخطة');
    if (no || !owner) return forbidden();
    if (!row.can.submit) return bad('الخطة ليست مسودة', 409);
    // تُراجَع الأيام عند الإرسال: قد يكون موعد بعضها فات أو أضيفت عليه عطلة أو إجازة منذ الحفظ
    const dates = (await daysOf(db, id)).filter((d) => d.status === 'planned').map((d) => d.date);
    const sp = spanOf(dates, '2000-01-01');
    const ctx = await context(env, db, sp.from, sp.to);
    const v = validatePlan({ purpose: row.purpose, note: row.note, dates }, ctx);
    if (!v.ok) return bad(v.error, v.status || 400);
    const clash = await clashOf(db, row.employeeId, dates, id);
    if (clash) return bad(clashText(clash), 409);
    const [r] = await db.batch([
      db.prepare("UPDATE leave_plans SET status = 'submitted', submitted_at = datetime('now') WHERE id = ? AND status = 'draft'").bind(id),
      auditStmt(db, user, 'plan.submit', 'plan', id, { days: dates.length }),
    ]);
    if (!r.meta.changes) return bad('تغيّرت حالة الخطة، حدّث الصفحة', 409);
    await notifyPlan({ env, db, url, defer }, 'plan_submitted', id, { actor: user.email });
    return json({ ok: true });
  });

  add('POST', '/api/plans/:id/withdraw', async ({ db, user, params }) => {
    const id = Number(params.id);
    const { row, forbidden: no, owner } = await loadPlan(db, user, id);
    if (!row) return notFound('الخطة');
    if (no || !owner) return forbidden();
    if (!row.can.withdraw) return bad('الخطة ليست بانتظار قرار', 409);
    const [r] = await db.batch([
      db.prepare("UPDATE leave_plans SET status = 'draft', submitted_at = NULL WHERE id = ? AND status = 'submitted'").bind(id),
      auditStmt(db, user, 'plan.withdraw', 'plan', id, null),
    ]);
    if (!r.meta.changes) return bad('تغيّرت حالة الخطة، حدّث الصفحة', 409);
    return json({ ok: true });
  });

  add('POST', '/api/plans/:id/cancel', async ({ request, db, user, params }) => {
    const { body, error } = await readJson(request);
    if (error) return error;
    const id = Number(params.id);
    const { row, forbidden: no, owner, mayManage } = await loadPlan(db, user, id);
    if (!row) return notFound('الخطة');
    if (no || !(owner || mayManage)) return forbidden();
    if (!row.can.cancel) return bad('لا يمكن إلغاء هذه الخطة', 409);
    const note = clip(body.note, 300);
    const [r] = await db.batch([
      db.prepare("UPDATE leave_plans SET status = 'cancelled', decided_by = ?, decided_at = datetime('now'), decision_note = ? WHERE id = ? AND status IN ('draft', 'submitted')").bind(user.email, note, id),
      db.prepare("UPDATE leave_plan_days SET status = 'withdrawn' WHERE plan_id = ? AND status = 'planned'").bind(id),
      auditStmt(db, user, 'plan.cancel', 'plan', id, { employeeId: row.employeeId, note }),
    ]);
    if (!r.meta.changes) return bad('تغيّرت حالة الخطة، حدّث الصفحة', 409);
    return json({ ok: true });
  });

  // ------------------------------------------------------------ قرار المسؤول (يوماً يوماً)
  add('POST', '/api/plans/:id/decide', async ({ request, env, db, user, params, url, defer }) => {
    const { body, error } = await readJson(request);
    if (error) return error;
    const id = Number(params.id);
    const { row, forbidden: no, mayDecide } = await loadPlan(db, user, id);
    if (!row) return notFound('الخطة');
    if (no || !mayDecide) return forbidden();
    if (!row.can.decide) return bad('الخطة ليست بانتظار قرار', 409);

    const days = (await daysOf(db, id)).filter((d) => d.status === 'planned').map((d) => d.date);
    if (!days.length) return bad('لا أيام في الخطة بانتظار القرار', 409);
    const all = body.all === 'approved' || body.all === 'rejected' ? body.all : null;
    const picks = body.decisions && typeof body.decisions === 'object' ? body.decisions : {};
    for (const k of Object.keys(picks)) if (!days.includes(k)) return bad(`يوم ${k} ليس في هذه الخطة`);
    const decision = {};
    for (const d of days) {
      const v = all ?? picks[d];
      if (v !== 'approved' && v !== 'rejected') return bad(`حدّد قرارك ليوم ${d}: اعتماد أو رفض`);
      decision[d] = v;
    }
    const approved = days.filter((d) => decision[d] === 'approved');
    const rejected = days.filter((d) => decision[d] === 'rejected');
    const note = clip(body.note, 300);
    if (rejected.length && (!note || note.length < 2)) return bad('اكتب سبب الرفض ليعرفه الموظف');

    const stmts = [];
    let ctx = null;
    let runs = [];
    if (approved.length) {
      ctx = await context(env, db, approved[0], approved[approved.length - 1]);
      if (!ctx.settings) return bad('لم تُدخل إعدادات الدوام بعد، لا يمكن احتساب الإجازات', 409);
      const leaveType = clip(body.leaveType, 80) || suggestLeaveType(row.purpose, ctx.settings.leaveTypes);
      if (!leaveType || !(leaveType in ctx.settings.leaveTypes)) return bad('اختر نوع الإجازة كما في إعدادات الدوام');
      const off = approved.find((d) => dayTypeOf(d, ctx.settings, ctx.holidays) !== DAY_WORK);
      if (off) return bad(`يوم ${off} لم يعد يوم عمل (أُضيفت عليه عطلة)، ارفضه أو عدّل الخطة`, 409);
      const clash = await clashOf(db, row.employeeId, approved, id, true);
      if (clash) return bad(`${clash.why === 'request' ? `يوم ${clash.date} ضمن إجازة معتمدة أخرى` : `يوم ${clash.date} عليه إجازة أو نوع يوم مسجّل مسبقاً`}، ارفضه أو عالج التعارض أولاً`, 409);
      runs = planRuns(approved, ctx.settings, ctx.holidays);
      const reason = row.note || 'إجازة متوقعة معتمدة';
      const guard = "EXISTS (SELECT 1 FROM leave_plans WHERE id = ?10 AND status = 'submitted')";
      stmts.push(
        db
          .prepare(
            `INSERT INTO requests (employee_id, kind, purpose, purpose_other, reason, from_date, to_date, days, leave_type, status, request_date, created_by, decided_by, decided_at, decision_note)
             SELECT ?1, 'leave', ?2, ?3, ?4, json_extract(value, '$.f'), json_extract(value, '$.t'), json_extract(value, '$.d'), ?5, 'approved', ?6, ?7, ?8, datetime('now'), ?9
             FROM json_each(?11) WHERE ${guard}`,
          )
          .bind(row.employeeId, row.purpose, row.purpose === 'other' ? row.note : null, reason, leaveType, ctx.today, row.createdBy, user.email, `من الإجازات المتوقعة #${id}${note ? ` — ${note}` : ''}`, id, JSON.stringify(runs.map((r) => ({ f: r.from, t: r.to, d: r.dates.length })))),
        // أيام الإجازة في المحرك مرتبطة بطلبها (يزيلها إلغاء الطلب وحدها)
        db
          .prepare(
            `INSERT INTO day_overrides (employee_id, date, leave_type, reason, updated_by, request_id)
             SELECT ?1, d.value, ?2, ?3, ?4, r.id FROM json_each(?5) d
             JOIN requests r ON r.employee_id = ?1 AND r.kind = 'leave' AND r.status = 'approved' AND r.from_date <= d.value AND r.to_date >= d.value
             WHERE true
             ON CONFLICT(employee_id, date) DO UPDATE SET leave_type = excluded.leave_type, request_id = excluded.request_id,
               updated_by = excluded.updated_by, updated_at = datetime('now')`,
          )
          .bind(row.employeeId, leaveType, `خطة إجازات متوقعة #${id}`, user.email, JSON.stringify(approved)),
        db
          .prepare(
            `UPDATE leave_plan_days SET status = 'approved',
               request_id = (SELECT r.id FROM requests r WHERE r.employee_id = leave_plan_days.employee_id AND r.kind = 'leave' AND r.status = 'approved'
                              AND r.from_date <= leave_plan_days.date AND r.to_date >= leave_plan_days.date)
             WHERE plan_id = ?1 AND status = 'planned' AND date IN (SELECT value FROM json_each(?2))
               AND EXISTS (SELECT 1 FROM leave_plans WHERE id = ?1 AND status = 'submitted')`,
          )
          .bind(id, JSON.stringify(approved)),
      );
    }
    if (rejected.length) {
      stmts.push(
        db
          .prepare(
            `UPDATE leave_plan_days SET status = 'rejected' WHERE plan_id = ?1 AND status = 'planned' AND date IN (SELECT value FROM json_each(?2))
               AND EXISTS (SELECT 1 FROM leave_plans WHERE id = ?1 AND status = 'submitted')`,
          )
          .bind(id, JSON.stringify(rejected)),
      );
    }
    const finalIdx = stmts.length;
    stmts.push(
      db
        .prepare("UPDATE leave_plans SET status = ?, decided_by = ?, decided_at = datetime('now'), decision_note = ? WHERE id = ? AND status = 'submitted'")
        .bind(approved.length ? 'approved' : 'rejected', user.email, note, id),
      auditStmt(db, user, 'plan.decide', 'plan', id, { employeeId: row.employeeId, approved: approved.length, rejected: rejected.length, requests: runs.length, note }),
    );
    const res = await db.batch(stmts);
    if (!res[finalIdx].meta.changes) return bad('تغيّرت حالة الخطة، حدّث الصفحة', 409);

    // أيام مضت أو اليوم: يُعاد حسابها لتظهر إجازة في التايم شيت (المستقبلية تُحسب حين يحل يومها)
    if (approved.length && ctx.settings) {
      const pairs = approved.filter((d) => d <= ctx.today).map((d) => ({ e: row.employeeId, d }));
      if (pairs.length) await recomputePairs(db, pairs, ctx.settings);
    }
    await notifyPlan({ env, db, url, defer }, 'plan_decided', id, { actor: user.email });
    return json({ ok: true, approved: approved.length, rejected: rejected.length, requests: runs.length });
  });
}
