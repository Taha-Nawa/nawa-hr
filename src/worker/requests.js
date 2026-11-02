/**
 * الطلبات: إجازة، إذن مغادرة، إذن تأخير.
 *
 *  - الموظف يقدّم طلبه بنفسه (تُطبَّق قواعد التوقيت: السنوية قبل موعدها، والمرضية/الطارئة في يوم الحالة أو بعده).
 *  - الموارد البشرية/المدير العام/المسؤول (لأي موظف) والمدير المباشر (لمرؤوسيه) يدخلون الطلب نيابة عن الموظف
 *    أو «يمنحون» الإجازة مباشرة؛ هنا لا تُطبَّق قيود التوقيت لأنه قرار إداري.
 *  - المعتمِد يرى الاحتساب (أيام العمل أو المدة، المستهلك هذا العام، سقف المغادرات الشهري، التعارضات)
 *    ويستطيع تعديل التواريخ/الأوقات قبل الاعتماد، ثم يطبع النموذج للتوقيع.
 *  - اعتماد الإجازة يكتب أيامها في day_overrides (مرتبطة بالطلب) فيعاد حساب أيامها وتظهر في التايم شيت؛
 *    وإلغاء الاعتماد يزيلها بالارتباط نفسه فقط.
 *  - لا أحد يعتمد طلب نفسه.
 */
import { loadWorkSettings } from './settings.js';
import { recomputePairs } from './recompute.js';
import { tzOf } from './close.js';
import { json, isDate, clip, localDate, localTime, nowOf, addDays, daysBetween } from './util.js';
import { canReadEmployee, canManageRequests, canDecideRequest, canRevokeRequest, employeeScope } from './authz.js';
import { validateRequest, mergeRules, workingDates, suggestLeaveType, monthOf, monthBounds, KINDS, PURPOSES } from '../engine/requests.js';

const LIST_LIMIT = 300;

const COLS = `r.id, r.employee_id AS employeeId, r.kind, r.purpose, r.purpose_other AS purposeOther, r.reason,
  r.from_date AS fromDate, r.to_date AS toDate, r.from_time AS fromTime, r.to_time AS toTime, r.days, r.minutes,
  r.leave_type AS leaveType, r.status, r.request_date AS requestDate, r.created_by AS createdBy, r.created_at AS createdAt,
  r.decided_by AS decidedBy, r.decided_at AS decidedAt, r.decision_note AS decisionNote, r.original`;

const NAME_OF_EMAIL = (col) => `(SELECT ee.name FROM users uu JOIN employees ee ON ee.id = uu.employee_id WHERE uu.email = ${col})`;

const DETAIL_SQL = `SELECT ${COLS}, e.name AS employeeName, e.code AS employeeCode, e.job_title AS jobTitle, e.department,
  e.manager_id AS managerId, c.name AS center, m.name AS managerName,
  ${NAME_OF_EMAIL('r.decided_by')} AS decidedByName, ${NAME_OF_EMAIL('r.created_by')} AS createdByName
  FROM requests r JOIN employees e ON e.id = r.employee_id LEFT JOIN centers c ON c.id = e.center_id LEFT JOIN employees m ON m.id = e.manager_id`;

const shape = (r) => {
  if (!r) return r;
  const { original, ...rest } = r;
  let orig = null;
  try {
    orig = original ? JSON.parse(original) : null;
  } catch {
    orig = null;
  }
  return { ...rest, original: orig };
};

export function registerRequestRoutes(add, kit) {
  const { bad, forbidden, notFound, readJson, auditStmt } = kit;

  // ------------------------------------------------------------ سياق مشترك
  async function context(env, db, from, to) {
    const tz = tzOf(env);
    const now = nowOf(env);
    const [settings, rulesRow, hol] = await Promise.all([
      loadWorkSettings(db),
      db.prepare("SELECT value FROM settings WHERE key = 'requests'").first(),
      from && to ? db.prepare('SELECT date FROM holidays WHERE date BETWEEN ? AND ?').bind(from, to).all() : { results: [] },
    ]);
    let stored = null;
    try {
      stored = rulesRow ? JSON.parse(rulesRow.value) : null;
    } catch {
      stored = null;
    }
    return {
      today: localDate(tz, now),
      nowTime: localTime(tz, now),
      settings,
      rules: mergeRules(stored),
      holidays: new Set(hol.results.map((r) => r.date)),
    };
  }

  /** الأيام التي بين تاريخين لحساب العطل: نجلب العطل مرة واحدة بعد معرفة المدى */
  const holidaysFor = async (db, from, to) =>
    new Set((await db.prepare('SELECT date FROM holidays WHERE date BETWEEN ? AND ?').bind(from, to).all()).results.map((r) => r.date));

  async function overlaps(db, v, employeeId, exceptId = 0, statuses = ['pending', 'approved']) {
    const st = JSON.stringify(statuses);
    if (v.kind === 'leave') {
      return (
        await db
          .prepare(
            `SELECT id, status, from_date AS fromDate, to_date AS toDate FROM requests
             WHERE employee_id = ? AND kind = 'leave' AND id != ? AND status IN (SELECT value FROM json_each(?))
               AND from_date <= ? AND to_date >= ?`,
          )
          .bind(employeeId, exceptId, st, v.toDate, v.fromDate)
          .all()
      ).results;
    }
    return (
      await db
        .prepare(
          `SELECT id, status, from_date AS fromDate, from_time AS fromTime, to_time AS toTime FROM requests
           WHERE employee_id = ? AND kind = ? AND id != ? AND status IN (SELECT value FROM json_each(?))
             AND from_date = ? AND from_time < ? AND to_time > ?`,
        )
        .bind(employeeId, v.kind, exceptId, st, v.fromDate, v.toTime, v.fromTime)
        .all()
    ).results;
  }

  /** الاحتساب الذي يراه المعتمِد (وصاحب الطلب أثناء التعبئة). */
  async function calcOf(db, v, employeeId, exceptId, ctx) {
    const out = { kind: v.kind, days: v.days, minutes: v.minutes, warnings: [] };
    const clash = await overlaps(db, v, employeeId, exceptId);
    out.overlaps = clash;
    if (clash.length) out.warnings.push(v.kind === 'leave' ? 'يتقاطع مع طلب إجازة آخر لنفس الموظف' : 'يتقاطع مع إذن آخر في الوقت نفسه');
    if (v.kind === 'leave') {
      const year = v.fromDate.slice(0, 4);
      const rows = (
        await db
          .prepare(
            `SELECT purpose, status, SUM(days) AS days FROM requests
             WHERE employee_id = ? AND kind = 'leave' AND id != ? AND status IN ('approved', 'pending') AND from_date BETWEEN ? AND ?
             GROUP BY purpose, status`,
          )
          .bind(employeeId, exceptId, `${year}-01-01`, `${year}-12-31`)
          .all()
      ).results;
      const sum = (status) => Object.fromEntries(Object.keys(PURPOSES).map((p) => [p, rows.filter((r) => r.purpose === p && r.status === status).reduce((s, r) => s + r.days, 0)]));
      out.year = Number(year);
      out.usedApproved = sum('approved');
      out.usedPending = sum('pending');
      const ent = ctx.rules.entitlement?.[v.purpose];
      if (ent !== undefined) {
        out.entitlement = ent;
        out.remaining = ent - out.usedApproved[v.purpose] - v.days;
        if (out.remaining < 0) out.warnings.push(`يتجاوز الرصيد السنوي المحدد (${ent} يوماً)`);
      }
    } else if (v.kind === 'exit' && ctx.rules.monthlyCap?.enabled) {
      // مُعطَّل افتراضياً: لا يُحسب إجمالي الشهر ولا يُقارَن بسقف (انظر DEFAULT_RULES.monthlyCap)
      const { from, to } = monthBounds(monthOf(v.fromDate));
      const used = await db
        .prepare(
          `SELECT status, SUM(minutes) AS minutes FROM requests
           WHERE employee_id = ? AND kind = 'exit' AND id != ? AND status IN ('approved', 'pending') AND from_date BETWEEN ? AND ? GROUP BY status`,
        )
        .bind(employeeId, exceptId, from, to)
        .all();
      const m = (s) => used.results.find((r) => r.status === s)?.minutes || 0;
      out.month = monthOf(v.fromDate);
      out.monthApprovedMinutes = m('approved');
      out.monthPendingMinutes = m('pending');
      const cap = ctx.settings?.monthlyExitCapHours;
      if (Number.isFinite(cap)) {
        out.capMinutes = Math.round(cap * 60);
        if (out.monthApprovedMinutes + out.monthPendingMinutes + v.minutes > out.capMinutes) {
          out.warnings.push(`مع هذا الإذن يتجاوز الموظف سقف المغادرات الشهري (${cap} ساعات)`);
        }
      }
    }
    return out;
  }

  /** قراءة طلب كامل مع صلاحياته (يُرجع null إن لم يوجد). */
  async function loadDetail(db, user, id) {
    const row = shape(await db.prepare(`${DETAIL_SQL} WHERE r.id = ?`).bind(id).first());
    if (!row) return { row: null };
    const target = { id: row.employeeId, manager_id: row.managerId };
    if (!canReadEmployee(user, target)) return { row, forbidden: true };
    const owner = (user.employeeId != null && user.employeeId === row.employeeId) || row.createdBy === user.email;
    row.can = {
      decide: row.status === 'pending' && canDecideRequest(user, target),
      cancel: (row.status === 'pending' && (owner || canManageRequests(user, target))) || (row.status === 'approved' && canRevokeRequest(user, target)),
    };
    return { row, target };
  }

  // ------------------------------------------------------------ تحويل الإجازة المعتمدة إلى أيام في المحرك
  const OVERRIDE_UPSERT = `
    INSERT INTO day_overrides (employee_id, date, leave_type, reason, updated_by, request_id)
    SELECT ?1, value, ?2, ?3, ?4, ?5 FROM json_each(?6) WHERE true
    ON CONFLICT(employee_id, date) DO UPDATE SET leave_type = excluded.leave_type, request_id = excluded.request_id,
      updated_by = excluded.updated_by, updated_at = datetime('now')`;

  const revokeStatements = (db, requestId) => [
    db.prepare(
      `DELETE FROM day_overrides WHERE request_id = ? AND in_time IS NULL AND out_time IS NULL AND ret_time IS NULL AND dep_time IS NULL`,
    ).bind(requestId),
    db.prepare('UPDATE day_overrides SET leave_type = NULL, request_id = NULL WHERE request_id = ?').bind(requestId),
  ];

  async function recomputeDates(db, employeeId, dates, today, settings) {
    const pairs = dates.filter((d) => d <= today).map((d) => ({ e: employeeId, d }));
    if (pairs.length && settings) await recomputePairs(db, pairs, settings);
  }

  // ------------------------------------------------------------ الاعتماد (مشترك بين «اعتمد» و«امنح مباشرة»)
  async function approveRow({ env, db, user, row, adjust = {} }) {
    const ctx0 = await context(env, db);
    const settings = ctx0.settings;
    const isLeave = row.kind === 'leave';
    const fromDate = isLeave && isDate(adjust.fromDate) ? adjust.fromDate : row.from_date;
    const toDate = isLeave ? (isDate(adjust.toDate) ? adjust.toDate : row.to_date) : fromDate;
    const holidays = await holidaysFor(db, fromDate, toDate);
    const merged = {
      kind: row.kind, purpose: row.purpose, purposeOther: row.purpose_other, reason: row.reason,
      fromDate, toDate, fromTime: adjust.fromTime ?? row.from_time, toTime: adjust.toTime ?? row.to_time,
    };
    const v = validateRequest(merged, { ...ctx0, holidays, enforceTiming: false });
    if (!v.ok) return { error: bad(v.error, v.status || 400) };
    const val = v.value;

    let leaveType = null;
    let dates = [];
    if (isLeave) {
      leaveType = clip(adjust.leaveType, 80) || suggestLeaveType(row.purpose, settings.leaveTypes);
      if (!leaveType || !(leaveType in settings.leaveTypes)) return { error: bad('اختر نوع الإجازة كما في إعدادات الدوام') };
      dates = workingDates(val.fromDate, val.toDate, settings, holidays);
      const clash = await overlaps(db, val, row.employee_id, row.id, ['approved']);
      if (clash.length) return { error: bad(`يتقاطع مع إجازة معتمدة أخرى (#${clash[0].id}: ${clash[0].fromDate} → ${clash[0].toDate})`, 409) };
      const taken = await db
        .prepare(
          `SELECT date FROM day_overrides WHERE employee_id = ? AND date IN (SELECT value FROM json_each(?))
             AND leave_type IS NOT NULL AND (request_id IS NULL OR request_id != ?) LIMIT 1`,
        )
        .bind(row.employee_id, JSON.stringify(dates), row.id)
        .first();
      if (taken) return { error: bad(`يوم ${taken.date} عليه نوع إجازة مسجّل مسبقاً (تصحيح يدوي)، عالجه أولاً`, 409) };
    } else {
      const clash = await overlaps(db, val, row.employee_id, row.id, ['approved']);
      if (clash.length) return { error: bad('يتقاطع مع إذن معتمد آخر في الوقت نفسه', 409) };
    }

    const changed = ['fromDate', 'toDate', 'fromTime', 'toTime'].filter((k) => val[k] !== { fromDate: row.from_date, toDate: row.to_date, fromTime: row.from_time, toTime: row.to_time }[k]);
    const original = changed.length ? JSON.stringify({ fromDate: row.from_date, toDate: row.to_date, fromTime: row.from_time, toTime: row.to_time, days: row.days, minutes: row.minutes }) : row.original;
    const note = clip(adjust.note, 300);
    const stmts = [
      db
        .prepare(
          `UPDATE requests SET status = 'approved', from_date = ?, to_date = ?, from_time = ?, to_time = ?, days = ?, minutes = ?, leave_type = ?,
             decided_by = ?, decided_at = datetime('now'), decision_note = ?, original = ? WHERE id = ? AND status = 'pending'`,
        )
        .bind(val.fromDate, val.toDate, val.fromTime, val.toTime, val.days, val.minutes, leaveType, user.email, note, original, row.id),
    ];
    if (isLeave) stmts.push(db.prepare(OVERRIDE_UPSERT).bind(row.employee_id, leaveType, `طلب #${row.id}`, user.email, row.id, JSON.stringify(dates)));
    stmts.push(auditStmt(db, user, 'request.approve', 'request', row.id, { employeeId: row.employee_id, kind: row.kind, from: val.fromDate, to: val.toDate, days: val.days, minutes: val.minutes, adjusted: changed }));
    const res = await db.batch(stmts);
    if (!res[0].meta.changes) return { error: bad('الطلب لم يعد معلّقاً', 409) };
    if (isLeave) await recomputeDates(db, row.employee_id, dates, ctx0.today, settings);
    return { ok: true };
  }

  // ------------------------------------------------------------ المسارات
  add('GET', '/api/requests/meta', async ({ env, db, user }) => {
    const ctx = await context(env, db);
    const inboxRoles = ['manager', 'hr', 'director', 'admin'];
    let pending = 0;
    if (inboxRoles.includes(user.role)) {
      const own = user.employeeId ?? -1;
      pending =
        user.role === 'manager'
          ? await db.prepare("SELECT COUNT(*) AS n FROM requests r JOIN employees e ON e.id = r.employee_id WHERE r.status = 'pending' AND e.manager_id = ? AND r.employee_id != ?").bind(own, own).first('n')
          : await db.prepare("SELECT COUNT(*) AS n FROM requests WHERE status = 'pending' AND employee_id != ?").bind(own).first('n');
    }
    return json({
      ok: true,
      today: ctx.today,
      rules: { annual: ctx.rules.annual, emergency: ctx.rules.emergency, sick: ctx.rules.sick, other: ctx.rules.other, maxSpanDays: ctx.rules.maxSpanDays },
      leaveTypes: ctx.settings ? Object.keys(ctx.settings.leaveTypes) : [],
      work: ctx.settings ? { start: ctx.settings.start, end: ctx.settings.end } : null,
      canBehalf: inboxRoles.includes(user.role),
      canDecide: inboxRoles.includes(user.role),
      linked: user.employeeId != null,
      pending,
    });
  });

  add('GET', '/api/requests', async ({ db, user, url }) => {
    const scope = url.searchParams.get('scope') || 'mine';
    const where = [];
    const params = [];
    const own = user.employeeId;
    if (scope === 'mine') {
      if (own == null) return json({ ok: true, requests: [] });
      where.push('r.employee_id = ?');
      params.push(own);
    } else if (scope === 'inbox') {
      if (user.role === 'manager') {
        if (own == null) return json({ ok: true, requests: [] });
        where.push("r.status = 'pending' AND e.manager_id = ? AND r.employee_id != ?");
        params.push(own, own);
      } else if (['hr', 'director', 'admin'].includes(user.role)) {
        where.push("r.status = 'pending' AND r.employee_id != ?");
        params.push(own ?? -1);
      } else {
        return json({ ok: true, requests: [] });
      }
    } else {
      const sc = employeeScope(user, 'e');
      where.push(sc.sql);
      params.push(...sc.params);
    }
    const status = url.searchParams.get('status');
    if (status && ['pending', 'approved', 'rejected', 'cancelled'].includes(status)) {
      where.push('r.status = ?');
      params.push(status);
    }
    const kind = url.searchParams.get('kind');
    if (kind && KINDS[kind]) {
      where.push('r.kind = ?');
      params.push(kind);
    }
    const emp = Number(url.searchParams.get('employeeId'));
    if (Number.isInteger(emp) && emp > 0) {
      where.push('r.employee_id = ?');
      params.push(emp);
    }
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (isDate(from) && isDate(to)) {
      where.push('r.to_date >= ? AND r.from_date <= ?');
      params.push(from, to);
    }
    const order = scope === 'inbox' ? 'r.created_at, r.id' : 'r.id DESC';
    const r = await db
      .prepare(
        `SELECT ${COLS}, e.name AS employeeName, e.code AS employeeCode, c.name AS center
         FROM requests r JOIN employees e ON e.id = r.employee_id LEFT JOIN centers c ON c.id = e.center_id
         WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${LIST_LIMIT}`,
      )
      .bind(...params)
      .all();
    return json({ ok: true, requests: r.results.map(shape) });
  });

  // معاينة بلا حفظ: نفس التحقق والاحتساب الذي يجري عند التقديم (مصدر الحقيقة الوحيد)
  async function prepare(env, db, user, body) {
    const targetId = Number.isInteger(body.employeeId) ? body.employeeId : user.employeeId;
    if (targetId == null) return { error: bad('حسابك غير مرتبط بموظف، اختر الموظف المعني') };
    const target = await db.prepare('SELECT id, name, manager_id, status FROM employees WHERE id = ?').bind(targetId).first();
    if (!target) return { error: notFound('الموظف') };
    const self = target.id === user.employeeId;
    if (!self && !canManageRequests(user, target)) return { error: forbidden() };
    if (target.status !== 'active') return { error: bad('الموظف متوقف عن العمل') };
    const from = isDate(body.fromDate) ? body.fromDate : null;
    const to = body.kind === 'leave' && isDate(body.toDate) ? body.toDate : from;
    const ctx = await context(env, db, from, to && from && to >= from && daysBetween(from, to) <= 400 ? to : from);
    const v = validateRequest(body, { ...ctx, enforceTiming: self });
    if (!v.ok) return { error: bad(v.error, v.status || 400) };
    return { target, self, ctx, v: v.value };
  }

  add('POST', '/api/requests/preview', async ({ request, env, db, user }) => {
    const { body, error } = await readJson(request);
    if (error) return error;
    const p = await prepare(env, db, user, body);
    if (p.error) return p.error;
    const except = Number.isInteger(body.exceptId) ? body.exceptId : 0; // يستثني الطلب المعروض نفسه من الاحتساب
    return json({ ok: true, calc: await calcOf(db, p.v, p.target.id, except, p.ctx) });
  });

  add('POST', '/api/requests', async ({ request, env, db, user }) => {
    const { body, error } = await readJson(request);
    if (error) return error;
    const p = await prepare(env, db, user, body);
    if (p.error) return p.error;
    const { v, target, ctx } = p;
    const clash = await overlaps(db, v, target.id, 0);
    if (clash.length) return bad(v.kind === 'leave' ? `لديه طلب إجازة آخر يتقاطع مع هذه الفترة (#${clash[0].id})` : `لديه إذن آخر في الوقت نفسه (#${clash[0].id})`, 409);
    const [ins] = await db.batch([
      db
        .prepare(
          `INSERT INTO requests (employee_id, kind, purpose, purpose_other, reason, from_date, to_date, from_time, to_time, days, minutes, request_date, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(target.id, v.kind, v.purpose, v.purposeOther, v.reason, v.fromDate, v.toDate, v.fromTime, v.toTime, v.days, v.minutes, ctx.today, user.email),
      auditStmt(db, user, 'request.create', 'request', null, { employeeId: target.id, kind: v.kind, purpose: v.purpose, from: v.fromDate, to: v.toDate, onBehalf: !p.self }),
    ]);
    const id = ins.meta.last_row_id;
    if (body.approve === true) {
      if (!canDecideRequest(user, { id: target.id, manager_id: target.manager_id })) {
        return json({ ok: false, error: 'تم إدخال الطلب لكنك لا تملك صلاحية اعتماده', requestId: id }, 403);
      }
      const row = await db.prepare('SELECT * FROM requests WHERE id = ?').bind(id).first();
      const r = await approveRow({ env, db, user, row, adjust: { leaveType: body.leaveType, note: body.note } });
      if (r.error) {
        const msg = (await r.error.json()).error;
        return json({ ok: false, error: `أُدخل الطلب (#${id}) لكن تعذّر اعتماده: ${msg}`, requestId: id }, r.error.status);
      }
    }
    return json({ ok: true, id }, 201);
  });

  add('GET', '/api/requests/:id', async ({ env, db, user, params }) => {
    const { row, forbidden: no } = await loadDetail(db, user, Number(params.id));
    if (!row) return notFound('الطلب');
    if (no) return forbidden();
    const ctx = await context(env, db, row.fromDate, row.toDate);
    const v = validateRequest(
      { kind: row.kind, purpose: row.purpose, purposeOther: row.purposeOther, reason: row.reason || 'x', fromDate: row.fromDate, toDate: row.toDate, fromTime: row.fromTime, toTime: row.toTime },
      { ...ctx, enforceTiming: false },
    );
    // يُحسب من القيم الحالية؛ إن لم تعد صالحة (إعدادات تغيّرت) نعرض المخزّن بلا احتساب
    const calc = v.ok ? await calcOf(db, v.value, row.employeeId, row.id, ctx) : { kind: row.kind, days: row.days, minutes: row.minutes, warnings: [v.error], overlaps: [] };
    // من يستطيع اعتماده فعلاً؟ المدير المباشر المسجّل يلزمه حساب فعّال بدور يملك الاعتماد، وإلا يبقى للموارد البشرية/المدير العام
    let managerCanDecide = false;
    if (row.status === 'pending' && row.managerId != null) {
      managerCanDecide = !!(await db
        .prepare("SELECT 1 AS ok FROM users WHERE employee_id = ? AND active = 1 AND role IN ('manager', 'hr', 'director', 'admin') LIMIT 1")
        .bind(row.managerId)
        .first());
    }
    return json({
      ok: true, request: row, calc, managerCanDecide,
      leaveTypes: ctx.settings ? Object.keys(ctx.settings.leaveTypes) : [],
      suggestedLeaveType: ctx.settings ? suggestLeaveType(row.purpose, ctx.settings.leaveTypes) : null,
    });
  });

  add('POST', '/api/requests/:id/approve', async ({ request, env, db, user, params }) => {
    const { body, error } = await readJson(request);
    if (error) return error;
    const id = Number(params.id);
    const row = await db.prepare('SELECT r.*, e.manager_id AS managerId FROM requests r JOIN employees e ON e.id = r.employee_id WHERE r.id = ?').bind(id).first();
    if (!row) return notFound('الطلب');
    if (!canDecideRequest(user, { id: row.employee_id, manager_id: row.managerId })) return forbidden();
    if (row.status !== 'pending') return bad('الطلب لم يعد معلّقاً', 409);
    const r = await approveRow({ env, db, user, row, adjust: body });
    if (r.error) return r.error;
    return json({ ok: true });
  });

  add('POST', '/api/requests/:id/reject', async ({ request, db, user, params }) => {
    const { body, error } = await readJson(request);
    if (error) return error;
    const id = Number(params.id);
    const row = await db.prepare('SELECT r.*, e.manager_id AS managerId FROM requests r JOIN employees e ON e.id = r.employee_id WHERE r.id = ?').bind(id).first();
    if (!row) return notFound('الطلب');
    if (!canDecideRequest(user, { id: row.employee_id, manager_id: row.managerId })) return forbidden();
    const note = clip(body.note, 300);
    if (!note || note.length < 2) return bad('اكتب سبب الرفض');
    const [r] = await db.batch([
      db.prepare("UPDATE requests SET status = 'rejected', decided_by = ?, decided_at = datetime('now'), decision_note = ? WHERE id = ? AND status = 'pending'").bind(user.email, note, id),
      auditStmt(db, user, 'request.reject', 'request', id, { employeeId: row.employee_id, note }),
    ]);
    return r.meta.changes ? json({ ok: true }) : bad('الطلب لم يعد معلّقاً', 409);
  });

  add('POST', '/api/requests/:id/cancel', async ({ request, env, db, user, params }) => {
    const { body, error } = await readJson(request);
    if (error) return error;
    const id = Number(params.id);
    const row = await db.prepare('SELECT r.*, e.manager_id AS managerId FROM requests r JOIN employees e ON e.id = r.employee_id WHERE r.id = ?').bind(id).first();
    if (!row) return notFound('الطلب');
    const target = { id: row.employee_id, manager_id: row.managerId };
    const owner = (user.employeeId != null && user.employeeId === row.employee_id) || row.created_by === user.email;
    const note = clip(body.note, 300);
    if (row.status === 'pending') {
      if (!owner && !canManageRequests(user, target)) return forbidden();
    } else if (row.status === 'approved') {
      if (!canRevokeRequest(user, target)) return forbidden();
    } else {
      return bad('لا يمكن إلغاء هذا الطلب', 409);
    }
    const wasApproved = row.status === 'approved';
    const stmts = [
      db.prepare("UPDATE requests SET status = 'cancelled', decided_by = ?, decided_at = datetime('now'), decision_note = ? WHERE id = ? AND status = ?").bind(user.email, note, id, row.status),
    ];
    if (wasApproved && row.kind === 'leave') stmts.push(...revokeStatements(db, id));
    stmts.push(auditStmt(db, user, wasApproved ? 'request.revoke' : 'request.cancel', 'request', id, { employeeId: row.employee_id, note }));
    const res = await db.batch(stmts);
    if (!res[0].meta.changes) return bad('تغيّرت حالة الطلب، حدّث الصفحة', 409);
    if (wasApproved && row.kind === 'leave') {
      const ctx = await context(env, db, row.from_date, row.to_date);
      if (ctx.settings) await recomputeDates(db, row.employee_id, workingDates(row.from_date, row.to_date, ctx.settings, ctx.holidays), ctx.today, ctx.settings);
    }
    return json({ ok: true });
  });
}
