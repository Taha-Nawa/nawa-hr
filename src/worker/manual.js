/**
 * الحضور اليدوي: صلاحية الموارد البشرية والمسؤول (day.correct) لتسجيل الحركات وتعديلها وتغيير حالة اليوم
 * لموظف أو عدة موظفين ولمدى من الأيام، لتصحيح ما يقع من أخطاء التسجيل أو ما يفوّته الموظف.
 *
 *  - set: أوقات الحضور/الخروج/العودة/الانصراف تُكتب في day_overrides (لها الأولوية على حركات البوابة). الحقل غير المذكور لا يُمسّ،
 *         والقيمة الفارغة تمسحه.
 *  - leaveType: نوع إجازة/مهمة من إعدادات الدوام لليوم بلا طلب ولا خصم من الرصيد (للإجازة المخصومة تُستعمل «منح إجازة» من الطلبات)؛
 *               السلسلة الفارغة تزيل النوع اليدوي وحده.
 *  - clear: يمسح التصحيحات اليدوية (الأوقات والنوع اليدوي) فيعود اليوم إلى حركات البوابة. لا يمسّ إجازة طلب معتمد ولا إعلان طارئ.
 *  - إجازة معتمدة على اليوم + تسجيل أوقات أو نوع جديد: يُرفض بقائمة التعارضات حتى يؤكّد المستخدم (releaseLeave) فيُفرَج عن
 *    ذلك اليوم من الطلب بالإجراء نفسه الذي يلغي الإجازة عند الدخول الفعلي (يعود لرصيده).
 *  - أيام العطلة تُتخطّى ما لم يُطلب تضمينها (includeOffDays). التواريخ حتى اليوم فقط (والمستقبل يخص الإجازات والطلبات).
 *  - سبب مكتوب إلزامي، وكل عملية في سجل التدقيق (مع القيم السابقة لأول 12 يوماً).
 */
import { loadWorkSettings } from './settings.js';
import { recomputePairs } from './recompute.js';
import { releaseLeaveDays } from './release.js';
import { notifyRelease } from './notify.js';
import { tzOf } from './close.js';
import { json, isDate, isTime, clip, localDate, nowOf, addDays, daysBetween } from './util.js';
import { can } from './authz.js';
import { dayTypeOf, DAY_WORK, toMin } from '../engine/attendance.js';

const MAX_EMPLOYEES = 100;
const MAX_DAYS = 31;
const MAX_PAIRS = 200;
const MAX_RETYPE = 300;
const RETYPES = new Set(['حضور', 'خروج', 'عودة', 'انصراف']);
const MAX_BACK_DAYS = 366;
const TIME_KEYS = { in: 'in_time', out: 'out_time', ret: 'ret_time', dep: 'dep_time' };
const PAIRS_IN = `(employee_id, date) IN (SELECT json_extract(value,'$.e'), json_extract(value,'$.d') FROM json_each(?1))`;

export function registerManualRoutes(add, kit) {
  const { bad, forbidden, readJson, auditStmt } = kit;

  add('POST', '/api/attendance/manual', async ({ env, db, user, request, url, defer }) => {
    if (!can(user, 'day.correct')) return forbidden();
    const { body, error } = await readJson(request);
    if (error) return error;

    // ---- التحقق من المدخلات
    const ids = [...new Set(Array.isArray(body.employeeIds) ? body.employeeIds : [])];
    if (!ids.length || ids.length > MAX_EMPLOYEES || !ids.every((n) => Number.isInteger(n) && n > 0)) return bad(`اختر من 1 إلى ${MAX_EMPLOYEES} موظفاً`);
    const today = localDate(tzOf(env), nowOf(env));
    const { from, to } = body;
    if (!isDate(from) || !isDate(to) || from > to) return bad('المدى الزمني غير صالح');
    if (to > today) return bad('الحضور اليدوي لأيام اليوم وما قبله فقط. للأيام القادمة استعمل «منح إجازة» أو خطة الإجازات.');
    if (from < addDays(today, -MAX_BACK_DAYS)) return bad('التاريخ أقدم من المسموح (سنة)');
    if (daysBetween(from, to) + 1 > MAX_DAYS) return bad(`المدى الأقصى ${MAX_DAYS} يوماً في العملية الواحدة`);
    const reason = clip(body.reason, 300);
    if (!reason || reason.length < 3) return bad('اكتب سبب التعديل (يُحفظ في سجل التدقيق)');

    const set = {};
    for (const [k] of Object.entries(TIME_KEYS)) {
      const v = body.set?.[k];
      if (v === undefined) continue;
      if (v === '' || v === null) set[k] = null;
      else if (isTime(v)) set[k] = v;
      else return bad('وقت غير صالح');
    }
    if (set.in && set.dep && toMin(set.dep) <= toMin(set.in)) return bad('وقت الانصراف يجب أن يكون بعد وقت الحضور');
    if (set.out && set.ret && toMin(set.ret) <= toMin(set.out)) return bad('وقت العودة يجب أن يكون بعد وقت الخروج');
    const touchesTimes = Object.keys(set).length > 0;

    const settings = await loadWorkSettings(db);
    if (!settings) return bad('إعدادات الدوام غير مكتملة', 409);
    let leaveType; // undefined = لا يُمسّ، '' = إزالة النوع اليدوي، نص = تعيين
    if (body.leaveType !== undefined && body.leaveType !== null) {
      leaveType = String(body.leaveType);
      if (leaveType !== '' && !(leaveType in settings.leaveTypes)) return bad('اختر نوع الإجازة كما في إعدادات الدوام');
    }
    const clear = body.clear === true;
    if (clear && (touchesTimes || leaveType !== undefined)) return bad('اختر إما مسح التصحيحات أو تسجيل قيم جديدة، لا الاثنين معاً');
    if (!clear && !touchesTimes && leaveType === undefined) return bad('لا تغيير مطلوب: حدّد الأوقات أو النوع أو المسح');

    // ---- الأيام والموظفون
    const [emps, hol] = await Promise.all([
      db.prepare('SELECT id, name FROM employees WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all(),
      db.prepare('SELECT date FROM holidays WHERE date BETWEEN ? AND ?').bind(from, to).all(),
    ]);
    if (emps.results.length !== ids.length) return bad('أحد الموظفين غير موجود', 404);
    const names = new Map(emps.results.map((e) => [e.id, e.name]));
    const holidays = new Set(hol.results.map((r) => r.date));
    const days = [];
    for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
    let skippedOff = 0;
    const kept = body.includeOffDays === true ? days : days.filter((d) => dayTypeOf(d, settings, holidays) === DAY_WORK);
    skippedOff = (days.length - kept.length) * ids.length;
    // نوع الإجازة لا معنى له في يوم عطلة حتى مع تضمينها
    const leaveDays = leaveType ? kept.filter((d) => dayTypeOf(d, settings, holidays) === DAY_WORK) : kept;
    if (leaveType) skippedOff += (kept.length - leaveDays.length) * ids.length;
    const useDays = leaveType ? leaveDays : kept;
    if (!useDays.length) return bad('كل الأيام المختارة عطلة. فعّل «تضمين أيام العطلة» إن أردت التسجيل فيها.');
    const pairs = ids.flatMap((e) => useDays.map((d) => ({ e, d })));
    if (pairs.length > MAX_PAIRS) return bad(`العملية الواحدة حتى ${MAX_PAIRS} يوم-موظف (الآن ${pairs.length}). قلّص الأيام أو الموظفين.`);
    const key = JSON.stringify(pairs);

    // ---- الحالة الحالية (للتعارض مع إجازة معتمدة وللقيم السابقة في التدقيق)
    const before = (
      await db
        .prepare(
          `SELECT employee_id AS e, date AS d, in_time AS i, out_time AS o, ret_time AS r, dep_time AS p, leave_type AS t, request_id AS rid
           FROM day_overrides WHERE ${PAIRS_IN}`,
        )
        .bind(key)
        .all()
    ).results;
    const leaveDaysFound = before.filter((b) => b.rid != null && b.t != null).map((b) => ({ e: b.e, d: b.d, rid: b.rid }));
    const replacing = touchesTimes || (leaveType !== undefined && leaveType !== '');
    let releasedDays = 0;
    let released = [];
    if (replacing && leaveDaysFound.length) {
      if (body.releaseLeave !== true) {
        return json({
          ok: false,
          needsRelease: true,
          error: `على ${leaveDaysFound.length} يوماً من الأيام المختارة إجازة معتمدة. تسجيل الحضور فيها يلغي ذلك اليوم من الإجازة ويعيده إلى رصيد الموظف. أكّد للمتابعة أو غيّر الأيام.`,
          conflicts: leaveDaysFound.slice(0, 20).map((f) => ({ employeeId: f.e, name: names.get(f.e), date: f.d, requestId: f.rid })),
        }, 409);
      }
      released = await releaseLeaveDays(db, leaveDaysFound, { source: 'manual', by: user.email, note: `أُلغي يوم من الإجازة: تسجيل حضور يدوي (${reason})` });
      releasedDays = leaveDaysFound.length;
    }

    // ---- الكتابة
    const stmts = [];
    if (touchesTimes || (leaveType !== undefined && leaveType !== '')) {
      const cols = [];
      const vals = [];
      for (const [k, col] of Object.entries(TIME_KEYS)) {
        if (k in set) {
          cols.push(col);
          vals.push(set[k]);
        }
      }
      if (leaveType) {
        cols.push('leave_type');
        vals.push(leaveType);
      }
      const n = (i) => `?${i + 2}`; // ?1 = الأزواج
      const updates = cols.map((c) => `${c} = excluded.${c}`);
      if (leaveType) updates.push('request_id = NULL', 'emergency_id = NULL'); // نوع يدوي: لا يتبع طلباً ولا طارئاً
      const rIdx = cols.length + 2;
      stmts.push(
        db
          .prepare(
            `INSERT INTO day_overrides (employee_id, date, ${cols.join(', ')}, reason, updated_by)
             SELECT json_extract(value,'$.e'), json_extract(value,'$.d'), ${cols.map((_, i) => n(i)).join(', ')}, ?${rIdx}, ?${rIdx + 1} FROM json_each(?1) WHERE true
             ON CONFLICT(employee_id, date) DO UPDATE SET ${updates.join(', ')}, reason = excluded.reason, updated_by = excluded.updated_by, updated_at = datetime('now')`,
          )
          .bind(key, ...vals, `يدوي: ${reason}`, user.email),
      );
    }
    if (leaveType === '') {
      stmts.push(
        db
          .prepare(`UPDATE day_overrides SET leave_type = NULL, updated_by = ?2, updated_at = datetime('now') WHERE ${PAIRS_IN} AND request_id IS NULL AND emergency_id IS NULL AND leave_type IS NOT NULL`)
          .bind(key, user.email),
      );
    }
    if (clear) {
      stmts.push(
        db
          .prepare(
            `UPDATE day_overrides SET in_time = NULL, out_time = NULL, ret_time = NULL, dep_time = NULL,
               leave_type = CASE WHEN request_id IS NULL AND emergency_id IS NULL THEN NULL ELSE leave_type END,
               reason = ?3, updated_by = ?2, updated_at = datetime('now') WHERE ${PAIRS_IN}`,
          )
          .bind(key, user.email, `مسح يدوي: ${reason}`),
      );
    }
    // صف بلا أوقات ولا نوع لا فائدة منه
    stmts.push(
      db
        .prepare(
          `DELETE FROM day_overrides WHERE ${PAIRS_IN} AND in_time IS NULL AND out_time IS NULL AND ret_time IS NULL AND dep_time IS NULL AND leave_type IS NULL`,
        )
        .bind(key),
    );
    const prev = pairs.length <= 12 ? before.map((b) => ({ e: b.e, d: b.d, in: b.i, out: b.o, ret: b.r, dep: b.p, t: b.t })) : undefined;
    stmts.push(
      auditStmt(db, user, 'manual.attendance', 'attendance', null, {
        employees: ids.length, from, to, days: useDays.length, set: touchesTimes ? set : undefined, leaveType, clear: clear || undefined, reason, releasedLeaveDays: releasedDays || undefined, prev,
      }),
    );
    await db.batch(stmts);
    await recomputePairs(db, pairs, settings);

    // الموظف يعلم إن أُلغي يوم من إجازته المعتمدة
    if (released.length) {
      await notifyRelease({ env, db, url, defer }, released);
    }
    return json({ ok: true, employees: ids.length, days: useDays.length, pairs: pairs.length, skippedOffDays: skippedOff, releasedLeaveDays: releasedDays });
  });

  /**
   * تصحيح نوع الحركات بالجملة: يعالج خطأ الحارس حين يترك البوابة على «انصراف» فيسجّل الموظفون انصرافاً بدل الحضور.
   *  - بلا ids: معاينة فقط (لا تُكتب أي تغييرات) بقائمة الحركات المطابقة وما سُجّل معها لكل موظف في اليوم نفسه.
   *  - مع ids: تُغيَّر هذه الحركات تحديداً (بشرط أن تبقى مطابقة: اليوم ونوعها الحالي) ويُعاد حساب أيامها ويُدوَّن السبب في التدقيق وفي ملاحظة الحركة.
   *  - لموظفي الجمعية فقط؛ حركات المزوّدين والمتطوعين لها مساراتها.
   */
  add('POST', '/api/movements/retype', async ({ env, db, user, request }) => {
    if (!can(user, 'day.correct')) return forbidden();
    const { body, error } = await readJson(request);
    if (error) return error;
    const today = localDate(tzOf(env), nowOf(env));
    const { date, from, to } = body;
    if (!isDate(date) || date > today) return bad('اختر يوماً صالحاً (اليوم أو ما قبله)');
    if (date < addDays(today, -MAX_DAYS)) return bad(`التصحيح بالجملة لآخر ${MAX_DAYS} يوماً فقط`);
    if (!RETYPES.has(from) || !RETYPES.has(to) || from === to) return bad('اختر نوعين مختلفين: الحالي والصحيح');
    const device = body.device ? clip(body.device, 80) : '';
    const center = body.center ? clip(body.center, 80) : '';
    const fromTime = body.fromTime || '00:00';
    const toTime = body.toTime || '23:59';
    if (!isTime(fromTime) || !isTime(toTime) || fromTime > toTime) return bad('نطاق الوقت غير صالح');

    const found = (
      await db
        .prepare(
          `SELECT m.id, m.employee_id AS e, e.name, m.time, m.center, m.device_id AS device, m.note
           FROM movements m JOIN employees e ON e.id = m.employee_id
           WHERE m.date = ?1 AND m.type = ?2 AND m.time BETWEEN ?3 AND ?4
             AND (?5 = '' OR m.device_id = ?5) AND (?6 = '' OR m.center = ?6)
           ORDER BY m.time LIMIT ${MAX_RETYPE + 1}`,
        )
        .bind(date, from, fromTime, toTime, device, center)
        .all()
    ).results;
    if (found.length > MAX_RETYPE) return bad(`النتائج أكثر من ${MAX_RETYPE} حركة. ضيّق نطاق الوقت أو الجهاز.`);

    const ids = body.ids;
    if (ids === undefined) {
      // المعاينة: لكل موظف ما سُجّل له في اليوم من حركات أخرى كي يرى التعارض قبل التطبيق
      const emps = JSON.stringify([...new Set(found.map((f) => f.e))]);
      const others = (
        await db
          .prepare(`SELECT employee_id AS e, type, time FROM movements WHERE date = ?1 AND employee_id IN (SELECT value FROM json_each(?2)) ORDER BY time`)
          .bind(date, emps)
          .all()
      ).results;
      const byEmp = new Map();
      for (const o of others) (byEmp.get(o.e) || byEmp.set(o.e, []).get(o.e)).push({ type: o.type, time: o.time });
      return json({
        ok: true,
        preview: true,
        count: found.length,
        items: found.map((f) => ({ id: f.id, employeeId: f.e, name: f.name, time: f.time, center: f.center, device: f.device, day: byEmp.get(f.e) || [] })),
      });
    }

    if (!Array.isArray(ids) || !ids.length || !ids.every((x) => typeof x === 'string')) return bad('اختر الحركات المراد تصحيحها');
    const reason = clip(body.reason, 300);
    if (!reason || reason.length < 3) return bad('اكتب سبب التصحيح (يُحفظ في سجل التدقيق)');
    const allowed = new Map(found.map((f) => [f.id, f]));
    const chosen = [...new Set(ids)].filter((id) => allowed.has(id));
    if (!chosen.length) return bad('لا توجد حركات مطابقة: ربما تغيّرت. أعد المعاينة.', 409);

    const settings = await loadWorkSettings(db);
    if (!settings) return bad('إعدادات الدوام غير مكتملة', 409);
    const rows = chosen.map((id) => allowed.get(id));
    const mark = `صُحّح من «${from}» إلى «${to}»`;
    await db.batch([
      db
        .prepare(`UPDATE movements SET type = ?2, note = CASE WHEN note IS NULL OR note = '' THEN ?3 ELSE note || ' | ' || ?3 END WHERE id IN (SELECT value FROM json_each(?1)) AND date = ?4 AND type = ?5`)
        .bind(JSON.stringify(chosen), to, mark, date, from),
      auditStmt(db, user, 'movements.retype', 'movements', null, {
        date, from, to, count: chosen.length, reason, device: device || undefined, center: center || undefined,
        prev: rows.slice(0, 30).map((r) => ({ id: r.id, e: r.e, t: r.time })),
      }),
    ]);
    const pairs = [...new Set(rows.map((r) => r.e))].map((e) => ({ e, d: date }));
    await recomputePairs(db, pairs, settings);
    return json({ ok: true, changed: chosen.length, employees: pairs.length });
  });
}
