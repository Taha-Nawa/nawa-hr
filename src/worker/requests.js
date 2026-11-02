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
import { can, canReadEmployee, canManageRequests, canDecideRequest, canRevokeRequest, employeeScope } from './authz.js';
import { employeeBalance } from './balances.js';
import { notifyRequest } from './notify.js';
import { validateRequest, mergeRules, workingDates, suggestLeaveType, monthOf, monthBounds, needsMedical, KINDS, PURPOSES } from '../engine/requests.js';

const LIST_LIMIT = 300;

const COLS = `r.id, r.employee_id AS employeeId, r.kind, r.purpose, r.purpose_other AS purposeOther, r.reason,
  r.from_date AS fromDate, r.to_date AS toDate, r.from_time AS fromTime, r.to_time AS toTime, r.days, r.minutes,
  r.leave_type AS leaveType, r.status, r.request_date AS requestDate, r.created_by AS createdBy, r.created_at AS createdAt,
  r.decided_by AS decidedBy, r.decided_at AS decidedAt, r.decision_note AS decisionNote, r.original,
  r.medical_proof AS medicalProof, r.medical_by AS medicalBy, r.medical_at AS medicalAt`;

const NAME_OF_EMAIL = (col) => `(SELECT ee.name FROM users uu JOIN employees ee ON ee.id = uu.employee_id WHERE uu.email = ${col})`;

const DETAIL_SQL = `SELECT ${COLS}, e.name AS employeeName, e.code AS employeeCode, e.job_title AS jobTitle, e.department,
  e.manager_id AS managerId, c.name AS center, m.name AS managerName,
  ${NAME_OF_EMAIL('r.decided_by')} AS decidedByName, ${NAME_OF_EMAIL('r.created_by')} AS createdByName
  FROM requests r JOIN employees e ON e.id = r.employee_id LEFT JOIN centers c ON c.id = e.center_id LEFT JOIN employees m ON m.id = e.manager_id`;

const shape = (r) => {
  if (!r) return r;
  const { original, ...rest } = r;
  if ('medicalProof' in rest) rest.medicalProof = !!rest.medicalProof;
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

  const loadRules = async (db) => {
    const row = await db.prepare("SELECT value FROM settings WHERE key = 'requests'").first();
    try {
      return mergeRules(row ? JSON.parse(row.value) : null);
    } catch {
      return mergeRules(null);
    }
  };

  /** من يؤكّد الورقة الطبية: الموارد البشرية والمدير العام والمسؤول دائماً، وغيرهم بتفويض في صفحة المستخدمين. */
  async function isMedicalApprover(db, user) {
    if (['hr', 'director', 'admin'].includes(user.role)) return true;
    return (await db.prepare('SELECT medical FROM users WHERE id = ?').bind(user.id).first('medical')) === 1;
  }

  /** قرار الاعتماد/الرفض: الإجازة المرضية التي تحتاج ورقة طبية لا يقرّرها إلا مؤكِّد الأوراق (لا المدير المباشر وحده). */
  function decideAllowed(user, medicalOk, target, row, rules) {
    if (user.employeeId != null && user.employeeId === target.id) return false;
    return needsMedical(row, rules) ? medicalOk : canDecideRequest(user, target);
  }

  /** شرط «بانتظار قراري»؛ null = لا صندوق لهذا المستخدم. */
  function inboxWhere(user, medicalOk, freeDays) {
    const own = user.employeeId ?? -1;
    const med = "r.kind = 'leave' AND r.purpose = 'sick' AND r.days > ?";
    if (['hr', 'director', 'admin'].includes(user.role)) return { sql: "r.status = 'pending' AND r.employee_id != ?", params: [own] };
    const parts = [];
    const params = [];
    if (user.role === 'manager' && user.employeeId != null) {
      parts.push(`(e.manager_id = ? AND NOT (${med}))`);
      params.push(user.employeeId, freeDays);
    }
    if (medicalOk) {
      parts.push(`(${med})`);
      params.push(freeDays);
    }
    return parts.length ? { sql: `r.status = 'pending' AND r.employee_id != ? AND (${parts.join(' OR ')})`, params: [own, ...params] } : null;
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
      // الرصيد الخاص بالموظف في هذه السنة أولاً، وإلا الافتراضي من القواعد
      const personal = await db.prepare('SELECT days FROM leave_balances WHERE employee_id = ? AND year = ? AND purpose = ?').bind(employeeId, Number(year), v.purpose).first('days');
      const ent = personal ?? ctx.rules.entitlement?.[v.purpose];
      if (ent !== undefined) {
        out.entitlement = ent;
        out.entitlementSource = personal !== null ? 'personal' : 'default';
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
    const rules = await loadRules(db);
    const medicalOk = await isMedicalApprover(db, user);
    row.needsMedical = needsMedical(row, rules);
    if (!canReadEmployee(user, target) && !(row.needsMedical && medicalOk)) return { row, forbidden: true };
    const owner = (user.employeeId != null && user.employeeId === row.employeeId) || row.createdBy === user.email;
    row.can = {
      decide: row.status === 'pending' && decideAllowed(user, medicalOk, target, row, rules),
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
      medicalProof: true, // وجود الورقة يتحقق منه المعتمِد صراحةً أدناه، لا بمجرد إقرار مقدّم الطلب
    };
    const v = validateRequest(merged, { ...ctx0, holidays, enforceTiming: false });
    if (!v.ok) return { error: bad(v.error, v.status || 400) };
    const val = v.value;
    if (val.medicalRequired && adjust.medicalConfirmed !== true) return { error: bad('أكّد استلامك الورقة الطبية التي تثبت الإجازة المرضية قبل الاعتماد') };

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
             decided_by = ?, decided_at = datetime('now'), decision_note = ?, original = ?,
             medical_proof = ?, medical_by = ?, medical_at = ${val.medicalRequired ? "datetime('now')" : 'NULL'} WHERE id = ? AND status = 'pending'`,
        )
        .bind(val.fromDate, val.toDate, val.fromTime, val.toTime, val.days, val.minutes, leaveType, user.email, note, original, val.medicalRequired ? 1 : 0, val.medicalRequired ? user.email : null, row.id),
    ];
    if (isLeave) stmts.push(db.prepare(OVERRIDE_UPSERT).bind(row.employee_id, leaveType, `طلب #${row.id}`, user.email, row.id, JSON.stringify(dates)));
    stmts.push(auditStmt(db, user, 'request.approve', 'request', row.id, { employeeId: row.employee_id, kind: row.kind, from: val.fromDate, to: val.toDate, days: val.days, minutes: val.minutes, adjusted: changed, medicalConfirmedBy: val.medicalRequired ? user.email : null }));
    const res = await db.batch(stmts);
    if (!res[0].meta.changes) return { error: bad('الطلب لم يعد معلّقاً', 409) };
    // الإجازة تكتب أيامها؛ والإذن لا يكتب شيئاً لكنه يعفي يومه من العجز والتأخير فيُعاد حسابه (إن كان اليوم قد بدأ)
    await recomputeDates(db, row.employee_id, isLeave ? dates : [val.fromDate], ctx0.today, settings);
    return { ok: true };
  }

  // ------------------------------------------------------------ المسارات
  add('GET', '/api/requests/meta', async ({ env, db, user }) => {
    const ctx = await context(env, db);
    const inboxRoles = ['manager', 'hr', 'director', 'admin'];
    const medicalOk = await isMedicalApprover(db, user);
    const ib = inboxWhere(user, medicalOk, ctx.rules.medical.freeDays);
    const pending = ib ? await db.prepare(`SELECT COUNT(*) AS n FROM requests r JOIN employees e ON e.id = r.employee_id WHERE ${ib.sql}`).bind(...ib.params).first('n') : 0;
    // رصيد الموظف في هذه السنة (خاص أو افتراضي)، فارغ إن لم يُحدَّد له رصيد
    const items = user.employeeId != null ? await employeeBalance(db, user.employeeId, Number(ctx.today.slice(0, 4)), ctx.rules) : [];
    const balance = items.length ? { year: Number(ctx.today.slice(0, 4)), items } : null;
    return json({
      ok: true,
      today: ctx.today,
      balance,
      rules: { annual: ctx.rules.annual, emergency: ctx.rules.emergency, sick: ctx.rules.sick, other: ctx.rules.other, maxSpanDays: ctx.rules.maxSpanDays, medical: ctx.rules.medical },
      leaveTypes: ctx.settings ? Object.keys(ctx.settings.leaveTypes) : [],
      work: ctx.settings ? { start: ctx.settings.start, end: ctx.settings.end } : null,
      canBehalf: inboxRoles.includes(user.role),
      canDecide: inboxRoles.includes(user.role) || medicalOk,
      linked: user.employeeId != null,
      pending,
    });
  });

  add('GET', '/api/requests', async ({ db, user, url }) => {
    const scope = url.searchParams.get('scope') || 'mine';
    const where = [];
    const params = [];
    const own = user.employeeId;
    const wide = scope === 'inbox' || scope === 'all';
    const rules = wide ? await loadRules(db) : null;
    const medicalOk = wide ? await isMedicalApprover(db, user) : false;
    if (scope === 'mine') {
      if (own == null) return json({ ok: true, requests: [] });
      where.push('r.employee_id = ?');
      params.push(own);
    } else if (scope === 'inbox') {
      const ib = inboxWhere(user, medicalOk, rules.medical.freeDays);
      if (!ib) return json({ ok: true, requests: [] });
      where.push(ib.sql);
      params.push(...ib.params);
    } else {
      const sc = employeeScope(user, 'e');
      // مؤكِّد الأوراق الطبية يرى أيضاً الإجازات المرضية التي تحتاج ورقة (ليتابع ما قرّره)
      where.push(medicalOk ? `(${sc.sql} OR (r.kind = 'leave' AND r.purpose = 'sick' AND r.days > ?))` : sc.sql);
      params.push(...sc.params, ...(medicalOk ? [rules.medical.freeDays] : []));
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

  add('POST', '/api/requests', async ({ request, env, db, user, url, defer }) => {
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
          `INSERT INTO requests (employee_id, kind, purpose, purpose_other, reason, from_date, to_date, from_time, to_time, days, minutes, request_date, created_by, medical_proof)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(target.id, v.kind, v.purpose, v.purposeOther, v.reason, v.fromDate, v.toDate, v.fromTime, v.toTime, v.days, v.minutes, ctx.today, user.email, v.medicalProof ? 1 : 0),
      auditStmt(db, user, 'request.create', 'request', null, { employeeId: target.id, kind: v.kind, purpose: v.purpose, from: v.fromDate, to: v.toDate, onBehalf: !p.self }),
    ]);
    const id = ins.meta.last_row_id;
    const send = (event, opts) => notifyRequest({ env, db, url, defer }, event, id, { actor: user.email, ...opts });
    if (body.approve === true) {
      const row = await db.prepare('SELECT * FROM requests WHERE id = ?').bind(id).first();
      const medicalOk = await isMedicalApprover(db, user);
      if (!decideAllowed(user, medicalOk, { id: target.id, manager_id: target.manager_id }, row, ctx.rules)) {
        await send('submitted');
        return json({ ok: false, error: 'تم إدخال الطلب لكنك لا تملك صلاحية اعتماده', requestId: id }, 403);
      }
      // من يدخل الإجازة المرضية ويمنحها مباشرة وهي بين يديه الورقة الطبية يؤكّدها بإقراره (medicalProof)
      const r = await approveRow({ env, db, user, row, adjust: { leaveType: body.leaveType, note: body.note, medicalConfirmed: v.medicalProof } });
      if (r.error) {
        const msg = (await r.error.json()).error;
        await send('submitted'); // بقي معلّقاً فيلزمه معتمِد
        return json({ ok: false, error: `أُدخل الطلب (#${id}) لكن تعذّر اعتماده: ${msg}`, requestId: id }, r.error.status);
      }
      if (!p.self) await send('approved'); // منح مباشر نيابة عن الموظف: يعلم بالقرار
    } else {
      await send('submitted');
    }
    return json({ ok: true, id }, 201);
  });

  add('GET', '/api/requests/:id', async ({ env, db, user, params }) => {
    const { row, forbidden: no } = await loadDetail(db, user, Number(params.id));
    if (!row) return notFound('الطلب');
    if (no) return forbidden();
    const ctx = await context(env, db, row.fromDate, row.toDate);
    const v = validateRequest(
      { kind: row.kind, purpose: row.purpose, purposeOther: row.purposeOther, reason: row.reason || 'x', fromDate: row.fromDate, toDate: row.toDate, fromTime: row.fromTime, toTime: row.toTime, medicalProof: true },
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
    // الأيام التي أُفرج عنها تلقائياً (دخول فعلي) أو بتأكيد الحضور اليدوي
    const released = (await db.prepare('SELECT date, source, released_by AS by, released_at AS at FROM leave_released WHERE request_id = ? ORDER BY date').bind(row.id).all()).results;
    return json({
      ok: true, request: row, calc, managerCanDecide, released,
      leaveTypes: ctx.settings ? Object.keys(ctx.settings.leaveTypes) : [],
      suggestedLeaveType: ctx.settings ? suggestLeaveType(row.purpose, ctx.settings.leaveTypes) : null,
    });
  });

  add('POST', '/api/requests/:id/approve', async ({ request, env, db, user, params, url, defer }) => {
    const { body, error } = await readJson(request);
    if (error) return error;
    const id = Number(params.id);
    const row = await db.prepare('SELECT r.*, e.manager_id AS managerId FROM requests r JOIN employees e ON e.id = r.employee_id WHERE r.id = ?').bind(id).first();
    if (!row) return notFound('الطلب');
    if (!decideAllowed(user, await isMedicalApprover(db, user), { id: row.employee_id, manager_id: row.managerId }, row, await loadRules(db))) return forbidden();
    if (row.status !== 'pending') return bad('الطلب لم يعد معلّقاً', 409);
    const r = await approveRow({ env, db, user, row, adjust: body });
    if (r.error) return r.error;
    await notifyRequest({ env, db, url, defer }, 'approved', id, { actor: user.email });
    return json({ ok: true });
  });

  add('POST', '/api/requests/:id/reject', async ({ request, env, db, user, params, url, defer }) => {
    const { body, error } = await readJson(request);
    if (error) return error;
    const id = Number(params.id);
    const row = await db.prepare('SELECT r.*, e.manager_id AS managerId FROM requests r JOIN employees e ON e.id = r.employee_id WHERE r.id = ?').bind(id).first();
    if (!row) return notFound('الطلب');
    if (!decideAllowed(user, await isMedicalApprover(db, user), { id: row.employee_id, manager_id: row.managerId }, row, await loadRules(db))) return forbidden();
    const note = clip(body.note, 300);
    if (!note || note.length < 2) return bad('اكتب سبب الرفض');
    const [r] = await db.batch([
      db.prepare("UPDATE requests SET status = 'rejected', decided_by = ?, decided_at = datetime('now'), decision_note = ? WHERE id = ? AND status = 'pending'").bind(user.email, note, id),
      auditStmt(db, user, 'request.reject', 'request', id, { employeeId: row.employee_id, note }),
    ]);
    if (!r.meta.changes) return bad('الطلب لم يعد معلّقاً', 409);
    await notifyRequest({ env, db, url, defer }, 'rejected', id, { actor: user.email, note });
    return json({ ok: true });
  });

  add('POST', '/api/requests/:id/cancel', async ({ request, env, db, user, params, url, defer }) => {
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
    if (wasApproved && row.kind === 'leave') {
      stmts.push(...revokeStatements(db, id));
      // أيام الخطة التي نتج عنها هذا الطلب تتحرر فيستطيع الموظف تخطيطها من جديد
      stmts.push(db.prepare("UPDATE leave_plan_days SET status = 'withdrawn' WHERE request_id = ? AND status = 'approved'").bind(id));
    }
    stmts.push(auditStmt(db, user, wasApproved ? 'request.revoke' : 'request.cancel', 'request', id, { employeeId: row.employee_id, note }));
    const res = await db.batch(stmts);
    if (!res[0].meta.changes) return bad('تغيّرت حالة الطلب، حدّث الصفحة', 409);
    if (wasApproved) {
      const ctx = await context(env, db, row.from_date, row.to_date);
      if (ctx.settings) await recomputeDates(db, row.employee_id, row.kind === 'leave' ? workingDates(row.from_date, row.to_date, ctx.settings, ctx.holidays) : [row.from_date], ctx.today, ctx.settings);
    }
    // الموظف يعلم بإلغاء اعتماد طلبه، أو بإلغاء طلبه المعلّق من غيره؛ لا إشعار لمن ألغى طلبه بنفسه
    if (wasApproved || !owner) await notifyRequest({ env, db, url, defer }, 'cancelled', id, { actor: user.email, note });
    return json({ ok: true });
  });

  // ------------------------------------------------------------ قواعد الطلبات (الأرصدة والمهل والإعفاءات والإشعارات)
  add('GET', '/api/settings/requests', async ({ db, user }) => {
    if (!can(user, 'settings.read')) return forbidden();
    return json({ ok: true, rules: await loadRules(db), canEdit: can(user, 'settings.write') });
  });

  add('PUT', '/api/settings/requests', async ({ request, env, db, user }) => {
    if (!can(user, 'settings.write')) return forbidden();
    const { body, error } = await readJson(request);
    if (error) return error;
    if (!body || typeof body.rules !== 'object' || body.rules === null) return bad('القواعد غير صالحة');
    // mergeRules يهمل كل قيمة خارج حدودها ويُرجع الشكل الكامل الصالح، فلا يُخزَّن إلا ما هو سليم
    const clean = mergeRules(body.rules);
    const before = await loadRules(db);
    await db.batch([
      db.prepare("INSERT INTO settings (key, value) VALUES ('requests', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(JSON.stringify(clean)),
      auditStmt(db, user, 'settings.requests', 'settings', 'requests', clean),
    ]);
    // تغيير إعفاء الأذونات من العجز يغيّر نتائج الأيام التي فيها أذونات معتمدة: نعيد حسابها هنا (أحدث 300 يوم-موظف)
    let recomputed = 0;
    let partial = false;
    if (before.permits.exempt !== clean.permits.exempt) {
      const settings = await loadWorkSettings(db);
      if (settings) {
        const LIMIT = 300;
        const pairs = (
          await db
            .prepare("SELECT DISTINCT employee_id AS e, from_date AS d FROM requests WHERE kind IN ('exit', 'late') AND status = 'approved' AND from_date <= ? ORDER BY from_date DESC LIMIT ?")
            .bind(localDate(tzOf(env), nowOf(env)), LIMIT)
            .all()
        ).results;
        recomputed = await recomputePairs(db, pairs, settings);
        partial = pairs.length === LIMIT;
      }
    }
    return json({ ok: true, rules: clean, recomputed, partial });
  });
}
