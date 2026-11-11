/**
 * الهيكلية الإدارية والإجراءات الوظيفية.
 *
 *  GET  /api/org                       → الموظفون + المراكز + تحليل الهيكل (org.read)
 *  POST /api/employees/:id/lifecycle   → نقل (transfer) / إنهاء خدمة (separate) / إعادة تفعيل (reinstate) (employee.lifecycle)
 *       dryRun: true يعيد أثر الإجراء قبل تنفيذه (من تحته، طلبات معلّقة، حسابات، بطاقات) ولا يغيّر شيئاً.
 *
 * إنهاء الخدمة عملية واحدة ذرّية تُغلق كل ما يوصل الموظف بالنظام:
 *   - الحالة «غير فعّال» وتاريخ نهاية الخدمة،
 *   - كل حساب له (بالربط أو بالبريد) يُوقَف وتُحذف جلساته وأجهزته الموثوقة ← لا دخول ولا بريد (كل إرسال يشترط حساباً فعّالاً، ولا يُرسل لبريد منتهي الخدمة)،
 *   - بطاقاته تُلغى فلا تُقبل على البوابة،
 *   - مرؤوسوه الفعّالون يُسنَدون إلى بديل (افتراضياً مديره) فلا يتيتم أحد ولا تتعطل مسارات الاعتماد،
 *   - طلباته وخطط إجازاته المعلّقة تُلغى بلا إرسال بريد،
 *   - سطر في السجل الوظيفي وفي سجل التدقيق.
 * الحركات والأيام المحتسبة السابقة تبقى كما هي (الأثر لا يُمحى).
 */
import { can } from './authz.js';
import { analyzeOrg } from '../engine/org.js';
import { json, isDate, clip, localDate, nowOf } from './util.js';
import { tzOf } from './close.js';

const KINDS = { resign: 'استقالة', terminate: 'إنهاء خدمة', contract_end: 'انتهاء عقد', separate_other: 'سبب آخر' };
const SEP_KEYS = Object.keys(KINDS);

/** عبارات SQL تُغلق الوصول (حساب + جلسات + أجهزة + بطاقات): تُستعمل في إنهاء الخدمة وعند تعطيل موظف مباشرة. */
export function closeAccessStatements(db, empId) {
  const mine = `(SELECT id FROM users WHERE employee_id = ?1 OR (email IS NOT NULL AND email = (SELECT email FROM employees WHERE id = ?1)))`;
  return [
    db.prepare(`DELETE FROM sessions WHERE user_id IN ${mine}`).bind(empId),
    db.prepare(`DELETE FROM trusted_devices WHERE user_id IN ${mine}`).bind(empId),
    db.prepare(`UPDATE users SET active = 0 WHERE id IN ${mine}`).bind(empId),
    db.prepare("UPDATE badges SET status = 'revoked' WHERE employee_id = ? AND status = 'active'").bind(empId),
  ];
}

export function registerOrgRoutes(add, kit) {
  const { bad, forbidden, notFound, readJson, auditStmt } = kit;

  add('GET', '/api/org', async ({ db, user, env }) => {
    if (!can(user, 'org.read')) return forbidden();
    const today = localDate(tzOf(env), nowOf(env));
    const [emps, users, centers, badges, pend, leave] = await db.batch([
      db.prepare(
        `SELECT e.id, e.code, e.name, e.job_title AS jobTitle, e.center_id AS centerId, c.name AS center, e.manager_id AS managerId, e.status,
                e.photo_url AS photo, e.contract_type AS contractType, e.start_date AS startDate, e.end_date AS endDate, e.email
         FROM employees e LEFT JOIN centers c ON c.id = e.center_id ORDER BY e.code`,
      ),
      db.prepare('SELECT employee_id AS employeeId, email, role, active FROM users'),
      db.prepare('SELECT id, name, active FROM centers ORDER BY id'),
      db.prepare("SELECT employee_id AS employeeId, status FROM badges WHERE status = 'active'"),
      db.prepare("SELECT employee_id AS id, COUNT(*) AS n FROM requests WHERE status = 'pending' GROUP BY employee_id"),
      db.prepare("SELECT DISTINCT employee_id AS id FROM requests WHERE status = 'approved' AND kind = 'leave' AND from_date <= ?1 AND to_date >= ?1").bind(today),
    ]);
    const pendOf = new Map(pend.results.map((r) => [r.id, r.n]));
    const onLeave = new Set(leave.results.map((r) => r.id));
    let dismissed = [];
    try { // الهجرة 0030 قد لا تكون طُبّقت بعد: يبقى الهيكل يعمل دون «تجاهل»
      dismissed = (await db.prepare('SELECT employee_id AS employeeId, check_id AS checkId FROM org_dismissed').all()).results;
    } catch (err) {
      if (!/no such table: org_dismissed/.test(String(err?.message || err))) throw err;
    }
    const org = analyzeOrg({ employees: emps.results, users: users.results, centers: centers.results, badges: badges.results, dismissed });
    const roleOf = new Map();
    for (const u of users.results) if (u.employeeId != null && u.active && !roleOf.has(u.employeeId)) roleOf.set(u.employeeId, u.role);
    return json({
      ok: true,
      employees: emps.results.map(({ email, ...e }) => ({ ...e, hasEmail: !!email, role: roleOf.get(e.id) || null, pendingRequests: pendOf.get(e.id) || 0, onLeave: onLeave.has(e.id) })),
      centers: centers.results,
      org,
    });
  });

  // «مقصود، تجاهل» ملاحظة موظف في الهيكلية، و«إعادة» لإرجاعها (الموارد البشرية والمسؤول)
  const dismissInput = async (ctx) => {
    if (!can(ctx.user, 'employee.lifecycle')) return { res: forbidden() };
    const { body, error } = await readJson(ctx.request);
    if (error) return { res: error };
    const id = body.employeeId;
    if (!Number.isInteger(id) || id <= 0 || typeof body.check !== 'string' || !/^[a-z_]{2,40}$/.test(body.check)) return { res: bad('البيانات غير صالحة') };
    if (!(await ctx.db.prepare('SELECT 1 AS x FROM employees WHERE id = ?').bind(id).first())) return { res: notFound('الموظف') };
    return { id, check: body.check };
  };
  add('POST', '/api/org/dismiss', async (ctx) => {
    const r = await dismissInput(ctx);
    if (r.res) return r.res;
    await ctx.db.batch([
      ctx.db.prepare('INSERT OR IGNORE INTO org_dismissed (employee_id, check_id, by_email) VALUES (?, ?, ?)').bind(r.id, r.check, ctx.user.email),
      auditStmt(ctx.db, ctx.user, 'org.dismiss', 'employee', r.id, { check: r.check }),
    ]);
    return json({ ok: true });
  });
  add('POST', '/api/org/restore', async (ctx) => {
    const r = await dismissInput(ctx);
    if (r.res) return r.res;
    await ctx.db.batch([
      ctx.db.prepare('DELETE FROM org_dismissed WHERE employee_id = ? AND check_id = ?').bind(r.id, r.check),
      auditStmt(ctx.db, ctx.user, 'org.restore', 'employee', r.id, { check: r.check }),
    ]);
    return json({ ok: true });
  });

  add('POST', '/api/employees/:id/lifecycle', async ({ db, user, request, params, env }) => {
    if (!can(user, 'employee.lifecycle')) return forbidden();
    const id = Number(params.id);
    const { body, error } = await readJson(request);
    if (error) return error;
    const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').bind(id).first();
    if (!emp) return notFound('الموظف');
    const today = localDate(tzOf(env), nowOf(env));
    const dry = body.dryRun === true;
    const reason = clip(body.reason, 300);
    if (!dry && (!reason || reason.length < 3)) return bad('اكتب السبب (يُحفظ في السجل الوظيفي وسجل التدقيق)');

    const act = body.action;
    if (!['transfer', 'separate', 'reinstate'].includes(act)) return bad('الإجراء غير معروف');

    // ---------------------------------------------------------------- الأثر الحالي (يخدم المعاينة والتنفيذ)
    const reports = (await db.prepare("SELECT id, name FROM employees WHERE manager_id = ? AND status = 'active' ORDER BY code").bind(id).all()).results;
    const [pendReq, pendPlans, badges, accounts, futureLeave] = await db.batch([
      db.prepare("SELECT COUNT(*) AS n FROM requests WHERE employee_id = ?1 AND status = 'pending'").bind(id),
      db.prepare("SELECT COUNT(*) AS n FROM leave_plans WHERE employee_id = ?1 AND status IN ('draft', 'submitted')").bind(id),
      db.prepare("SELECT COUNT(*) AS n FROM badges WHERE employee_id = ?1 AND status = 'active'").bind(id),
      db.prepare('SELECT id, email, role, active FROM users WHERE employee_id = ?1 OR (email IS NOT NULL AND email = ?2)').bind(id, emp.email),
      db.prepare("SELECT COUNT(*) AS n FROM requests WHERE employee_id = ?1 AND status = 'approved' AND kind = 'leave' AND to_date > ?2").bind(id, today),
    ]);
    const acc = accounts.results;
    const impact = {
      employee: { id, name: emp.name, status: emp.status, centerId: emp.center_id, managerId: emp.manager_id },
      reports,
      pendingRequests: pendReq.results[0].n,
      pendingPlans: pendPlans.results[0].n,
      activeBadges: badges.results[0].n,
      accounts: acc.map((a) => ({ id: a.id, email: a.email, role: a.role, active: !!a.active })),
      futureApprovedLeave: futureLeave.results[0].n,
      suggestedManagerId: emp.manager_id,
    };

    // ---------------------------------------------------------------- التحقق من الوجهة (مركز / مدير)
    const centerOk = async (cid) => {
      if (cid === null || cid === undefined) return true;
      return !!(await db.prepare('SELECT 1 AS x FROM centers WHERE id = ? AND active = 1').bind(cid).first());
    };
    const managerOk = async (mid) => {
      if (mid === null || mid === undefined) return null;
      if (!Number.isInteger(mid) || mid === id) return 'مدير غير صالح';
      const m = await db.prepare("SELECT status FROM employees WHERE id = ?").bind(mid).first();
      if (!m) return 'المدير غير موجود';
      if (m.status !== 'active') return 'المدير المختار غير فعّال';
      // المدير الجديد لا يجوز أن يكون تحت الموظف (حلقة)
      const loop = await db
        .prepare(`WITH RECURSIVE up(id) AS (SELECT ?1 UNION SELECT e.manager_id FROM employees e JOIN up ON e.id = up.id WHERE e.manager_id IS NOT NULL) SELECT 1 AS x FROM up WHERE id = ?2`)
        .bind(mid, id)
        .first();
      return loop ? 'المدير المختار يتبع هذا الموظف: يُنشئ حلقة في الهيكل' : null;
    };

    // ================================================================ نقل
    if (act === 'transfer') {
      if (emp.status !== 'active') return bad('الموظف غير فعّال؛ أعد تفعيله أولاً', 409);
      const toCenter = body.centerId === undefined ? emp.center_id : body.centerId;
      const toManager = body.managerId === undefined ? emp.manager_id : body.managerId;
      if (toCenter === emp.center_id && toManager === emp.manager_id) return bad('لا تغيير: اختر مركزاً أو مديراً جديداً');
      if (!(await centerOk(toCenter))) return bad('المركز غير موجود أو غير فعّال');
      const merr = toManager !== emp.manager_id ? await managerOk(toManager) : null;
      if (merr) return bad(merr);
      const when = body.effectiveDate ?? today;
      if (!isDate(when) || when > today) return bad('تاريخ النقل لا يكون في المستقبل: نفّذ الإجراء في يوم النقل');
      if (dry) return json({ ok: true, dryRun: true, action: act, impact, to: { centerId: toCenter, managerId: toManager } });
      await db.batch([
        db.prepare('UPDATE employees SET center_id = ?, manager_id = ? WHERE id = ?').bind(toCenter, toManager, id),
        db.prepare(`INSERT INTO employee_history (employee_id, kind, effective_date, from_center_id, to_center_id, from_manager_id, to_manager_id, reason, detail, created_by)
                    VALUES (?, 'transfer', ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, when, emp.center_id, toCenter, emp.manager_id, toManager, reason, JSON.stringify({ keptReports: reports.length }), user.email),
        auditStmt(db, user, 'employee.transfer', 'employee', id, { from: { center: emp.center_id, manager: emp.manager_id }, to: { center: toCenter, manager: toManager }, when, reason }),
      ]);
      return json({ ok: true, action: act, keptReports: reports.length });
    }

    // ================================================================ إنهاء خدمة
    if (act === 'separate') {
      if (emp.status !== 'active') return bad('الموظف غير فعّال أصلاً', 409);
      const kind = SEP_KEYS.includes(body.kind) ? body.kind : null;
      if (!kind) return bad('اختر نوع الإنهاء: استقالة أو إنهاء خدمة أو انتهاء عقد أو غيره');
      const endDate = body.endDate ?? today;
      if (!isDate(endDate) || endDate > today) return bad('تاريخ نهاية الخدمة لا يكون في المستقبل: نفّذ الإجراء في يوم نهاية الخدمة');
      if (emp.start_date && endDate < emp.start_date) return bad('تاريخ نهاية الخدمة قبل تاريخ المباشرة');
      // لا تُترك المنظومة بلا مسؤول فعّال
      const myAdmins = acc.filter((a) => a.role === 'admin' && a.active).length;
      if (myAdmins > 0 && (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").first('n')) - myAdmins < 1) {
        return bad('هذا الموظف صاحب آخر حساب مسؤول فعّال. عيّن مسؤولاً آخر أولاً.', 409);
      }

      // مرؤوسوه: بديل صريح، وإلا مديره، وإلا بلا مدير
      let newManager = body.reassignTo === undefined ? emp.manager_id : body.reassignTo;
      if (reports.length && newManager !== null) {
        const merr = await managerOk(newManager);
        if (merr) return bad(merr);
      }
      if (dry) return json({ ok: true, dryRun: true, action: act, impact: { ...impact, suggestedManagerId: newManager }, kindLabel: KINDS[kind] });

      const stmts = [
        db.prepare("UPDATE employees SET status = 'inactive', end_date = ? WHERE id = ?").bind(endDate, id),
        ...(reports.length ? [db.prepare("UPDATE employees SET manager_id = ? WHERE manager_id = ? AND status = 'active'").bind(newManager, id)] : []),
        ...closeAccessStatements(db, id),
        db.prepare("UPDATE requests SET status = 'cancelled', decided_by = ?, decided_at = datetime('now'), decision_note = ? WHERE employee_id = ? AND status = 'pending'")
          .bind(user.email, `إنهاء خدمة الموظف (${KINDS[kind]})`, id),
        db.prepare("UPDATE leave_plans SET status = 'cancelled', decided_by = ?, decided_at = datetime('now'), decision_note = ? WHERE employee_id = ? AND status IN ('draft', 'submitted')")
          .bind(user.email, `إنهاء خدمة الموظف (${KINDS[kind]})`, id),
        db.prepare(`INSERT INTO employee_history (employee_id, kind, effective_date, from_center_id, to_center_id, from_manager_id, to_manager_id, reason, detail, created_by)
                    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`).bind(id, kind, endDate, emp.center_id, emp.manager_id, reports.length ? newManager : null, reason,
          JSON.stringify({ reassigned: reports.map((r) => r.id), reassignedTo: reports.length ? newManager : null, accounts: acc.filter((a) => a.active).length, badges: impact.activeBadges, requests: impact.pendingRequests, plans: impact.pendingPlans }), user.email),
        auditStmt(db, user, 'employee.separate', 'employee', id, { kind, endDate, reason, reassigned: reports.length, reassignedTo: newManager, accountsClosed: acc.filter((a) => a.active).length, badgesRevoked: impact.activeBadges, requestsCancelled: impact.pendingRequests, plansCancelled: impact.pendingPlans }),
      ];
      await db.batch(stmts);
      return json({
        ok: true,
        action: act,
        kind: KINDS[kind],
        reassigned: reports.length,
        accountsClosed: acc.filter((a) => a.active).length,
        badgesRevoked: impact.activeBadges,
        requestsCancelled: impact.pendingRequests,
        plansCancelled: impact.pendingPlans,
        futureApprovedLeave: impact.futureApprovedLeave,
      });
    }

    // ================================================================ إعادة تفعيل
    if (emp.status === 'active') return bad('الموظف فعّال أصلاً', 409);
    const toCenter = body.centerId === undefined ? emp.center_id : body.centerId;
    const toManager = body.managerId === undefined ? emp.manager_id : body.managerId;
    if (!(await centerOk(toCenter))) return bad('المركز غير موجود أو غير فعّال');
    const merr = toManager !== null ? await managerOk(toManager) : null;
    if (merr) return bad(merr);
    const startDate = body.startDate ?? today;
    if (!isDate(startDate) || startDate > today) return bad('تاريخ العودة لا يكون في المستقبل');
    if (dry) return json({ ok: true, dryRun: true, action: act, impact, to: { centerId: toCenter, managerId: toManager } });
    await db.batch([
      db.prepare("UPDATE employees SET status = 'active', end_date = NULL, center_id = ?, manager_id = ?, start_date = COALESCE(start_date, ?) WHERE id = ?").bind(toCenter, toManager, startDate, id),
      ...(body.reactivateAccount === true ? [db.prepare('UPDATE users SET active = 1 WHERE employee_id = ?').bind(id)] : []),
      ...(body.restoreBadges === true ? [db.prepare("UPDATE badges SET status = 'active' WHERE employee_id = ?").bind(id)] : []),
      db.prepare(`INSERT INTO employee_history (employee_id, kind, effective_date, from_center_id, to_center_id, from_manager_id, to_manager_id, reason, detail, created_by)
                  VALUES (?, 'reinstate', ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, startDate, emp.center_id, toCenter, emp.manager_id, toManager, reason, JSON.stringify({ account: body.reactivateAccount === true, badges: body.restoreBadges === true }), user.email),
      auditStmt(db, user, 'employee.reinstate', 'employee', id, { startDate, reason, reactivateAccount: body.reactivateAccount === true, restoreBadges: body.restoreBadges === true }),
    ]);
    return json({ ok: true, action: act, accountReactivated: body.reactivateAccount === true, badgesRestored: body.restoreBadges === true });
  });

  add('GET', '/api/employees/:id/history', async ({ db, user, params }) => {
    if (!can(user, 'org.read')) return forbidden();
    const r = await db
      .prepare(
        `SELECT h.id, h.kind, h.effective_date AS date, h.reason, h.created_by AS by, h.created_at AS at,
                fc.name AS fromCenter, tc.name AS toCenter, fm.name AS fromManager, tm.name AS toManager
         FROM employee_history h
         LEFT JOIN centers fc ON fc.id = h.from_center_id LEFT JOIN centers tc ON tc.id = h.to_center_id
         LEFT JOIN employees fm ON fm.id = h.from_manager_id LEFT JOIN employees tm ON tm.id = h.to_manager_id
         WHERE h.employee_id = ? ORDER BY h.effective_date DESC, h.id DESC`,
      )
      .bind(Number(params.id))
      .all();
    return json({ ok: true, history: r.results });
  });
}
