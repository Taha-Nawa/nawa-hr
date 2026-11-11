/**
 * إشعارات البريد للطلبات (قرار 2 نوفمبر 2026):
 *   submitted : عند تقديم طلب → المعتمِد (المدير المباشر، وإن لم يكن له حساب فالموارد البشرية؛ والإجازة المرضية التي تلزمها ورقة طبية → مؤكِّدو الأوراق)
 *   approved / rejected / cancelled : عند القرار أو إلغاء الاعتماد → الموظف صاحب الطلب (إلا إن كان هو من فعل ذلك)
 *
 * تعمل فقط إن كان إرسال البريد مضبوطاً (docs/EMAIL-SETUP.md) وكان rules.notify.enabled غير مُوقَف.
 * الإرسال لا يعطّل الطلب ولا يُفشله أبداً: يجري بعد الرد (ctx.defer) وأي خطأ يُسجَّل ويُتجاوز.
 */
import { mailerFor, logMailFailure } from './mail.js';
import { fmt12 } from './util.js';
import { mergeRules, needsMedical, KINDS, PURPOSES, kindLabel } from '../engine/requests.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 10;
const MAX_RELEASE_MAILS = 4;

const TITLE = {
  submitted: (r) => `${kindLabel(r)} جديد من ${r.employeeName} بانتظار قرارك`,
  approved: (r) => `اعتُمد ${kindLabel(r)} الخاص بك`,
  rejected: (r) => `رُفض ${kindLabel(r)} الخاص بك`,
  cancelled: (r) => `أُلغي ${kindLabel(r)} الخاص بك`,
  released: (r) => `أُلغيت إجازة ${r.employeeName} المعتمدة لتسجيله الدخول فعلياً`,
};

function lines(r) {
  const out = [['الموظف', r.employeeName], ['النوع', r.mission ? kindLabel(r) : `${KINDS[r.kind]} — ${PURPOSES[r.purpose]}${r.purpose_other ? ` (${r.purpose_other})` : ''}`]];
  if (r.kind === 'leave') {
    out.push(['الفترة', r.from_date === r.to_date ? r.from_date : `من ${r.from_date} إلى ${r.to_date}`], ['أيام العمل', String(r.days)]);
  } else {
    out.push(['اليوم', r.from_date], ['الوقت', `${fmt12(r.from_time)} – ${fmt12(r.to_time)}`]);
  }
  if (r.reason) out.push(['السبب', r.reason]);
  return out;
}

export function message(event, r, origin, note, extra = null) {
  const subject = TITLE[event](r);
  const rows = lines(r);
  if (event === 'released' && extra) {
    rows.push(['الأيام التي أُلغيت', extra.dates.join('، ')], ['حالة الطلب', extra.cancelled ? 'أُلغي كاملاً' : `بقيت ${extra.days} من أيامه معتمدة`], ['السبب', 'سجّل الموظف دخولاً فعلياً على البوابة في هذه الأيام فاحتُسب حضوراً مرهوناً بانصرافه']);
  }
  if (note && event !== 'submitted' && event !== 'released') rows.push([event === 'rejected' ? 'سبب الرفض' : 'ملاحظة', note]);
  const link = `${origin}/#/requests?open=${r.id}`;
  const text = `${subject}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nافتح الطلب: ${link}\n— نظام نوى للشؤون الإدارية، جمعية نوى للثقافة والفنون`;
  const html = `<div dir="rtl" lang="ar" style="font-family:Segoe UI,Tahoma,Arial,sans-serif;max-width:480px;margin:auto;padding:22px;border:1px solid #e6dccf;border-radius:14px;color:#2a1410">
<p style="margin:0 0 12px;font-weight:700;font-size:16px">${esc(subject)}</p>
<table style="border-collapse:collapse;width:100%;margin:0 0 16px">${rows.map(([k, v]) => `<tr><td style="padding:5px 0;color:#72655f;width:34%;vertical-align:top">${esc(k)}</td><td style="padding:5px 0">${esc(v)}</td></tr>`).join('')}</table>
<p style="margin:0 0 16px"><a href="${esc(link)}" style="display:inline-block;background:#a21008;color:#fff;text-decoration:none;padding:9px 18px;border-radius:9px;font-weight:700">فتح الطلب</a></p>
<p style="margin:0;color:#72655f;font-size:12px">نظام نوى للشؤون الإدارية — جمعية نوى للثقافة والفنون</p></div>`;
  return { subject, text, html };
}

const emailsOf = async (db, sql, ...p) => (await db.prepare(sql).bind(...p).all()).results.map((x) => x.email);

/** المعتمِد العادي: المدير المباشر إن كان له حساب بدور يعتمد، وإلا الموارد البشرية، وإلا المدير العام/المسؤول. */
async function approverEmails(db, managerId) {
  let list = managerId != null ? await emailsOf(db, "SELECT email FROM users WHERE active = 1 AND employee_id = ? AND role IN ('manager', 'hr', 'director', 'admin')", managerId) : [];
  // نائب المدير الحالي (إن وُجد) يصله الإشعار أيضاً
  if (managerId != null) {
    try {
      list = [...list, ...(await emailsOf(db, "SELECT u.email FROM manager_deputies d JOIN users u ON u.employee_id = d.deputy_id AND u.active = 1 WHERE d.manager_id = ? AND date('now', '+3 hours') BETWEEN d.from_date AND d.to_date", managerId))];
    } catch { /* الترحيل 0027 لم يُطبَّق */ }
  }
  if (!list.length) list = await emailsOf(db, "SELECT email FROM users WHERE active = 1 AND role = 'hr'");
  if (!list.length) list = await emailsOf(db, "SELECT email FROM users WHERE active = 1 AND role IN ('director', 'admin')");
  return list;
}

/** حسابات الموظف نفسه، وإلا بريده المسجَّل في سجل الموظف. */
async function ownerEmails(db, employeeId, fallback) {
  const list = await emailsOf(db, 'SELECT email FROM users WHERE active = 1 AND employee_id = ?', employeeId);
  return list.length || !fallback ? list : [fallback];
}

function dedupe(list, actorEmail) {
  const seen = new Set();
  return list
    .filter((e) => EMAIL_RE.test(e || '') && e.toLowerCase() !== (actorEmail || '').toLowerCase())
    .filter((e) => (seen.has(e.toLowerCase()) ? false : (seen.add(e.toLowerCase()), true)))
    .slice(0, MAX_RECIPIENTS);
}

/**
 * لا بريد لمنتهي الخدمة مطلقاً: يُحذف من القائمة كل عنوان يخص موظفاً غير فعّال (ببريده المسجَّل أو بحساب مربوط به).
 * هذا يسدّ الرجوع إلى بريد سجل الموظف حين لا حساب فعّالاً له.
 */
export async function dropDeparted(db, list) {
  if (!list.length) return list;
  const gone = new Set(
    (
      await db
        .prepare(
          `SELECT lower(email) AS e FROM employees WHERE status = 'inactive' AND email IS NOT NULL AND lower(email) IN (SELECT lower(value) FROM json_each(?1))
           UNION
           SELECT lower(u.email) FROM users u JOIN employees x ON x.id = u.employee_id AND x.status = 'inactive' WHERE lower(u.email) IN (SELECT lower(value) FROM json_each(?1))`,
        )
        .bind(JSON.stringify(list))
        .all()
    ).results.map((r) => r.e),
  );
  return list.filter((a) => !gone.has(String(a).toLowerCase()));
}

/** عناوين من يستقبل الإشعار (بلا المُشغِّل نفسه، بلا تكرار، بحدّ أقصى). */
async function recipientsOf(db, event, r, rules, actorEmail) {
  const emails = (sql, ...p) => emailsOf(db, sql, ...p);
  let list;
  if (event === 'submitted') {
    if (needsMedical(r, rules)) {
      list = await emails("SELECT email FROM users WHERE active = 1 AND (role IN ('hr', 'director', 'admin') OR medical = 1)");
    } else {
      list = await approverEmails(db, r.manager_id);
    }
    // لا يُشعَر صاحب الطلب بطلبه هو، ولا أحد يعتمد طلب نفسه
    const own = await emails('SELECT email FROM users WHERE employee_id = ?', r.employee_id);
    list = list.filter((e) => !own.includes(e));
  } else if (event === 'released') {
    // الموظف نفسه، ومديره المباشر، ومن اعتمد إجازته
    list = [
      ...(await emails('SELECT email FROM users WHERE active = 1 AND employee_id = ?', r.employee_id)),
      ...(r.manager_id != null ? await emails("SELECT email FROM users WHERE active = 1 AND employee_id = ? AND role IN ('manager', 'hr', 'director', 'admin')", r.manager_id) : []),
      ...(r.decided_by && r.decided_by !== 'system' ? [r.decided_by] : []),
    ];
    if (!list.length && r.employeeEmail) list = [r.employeeEmail];
  } else {
    list = await emails('SELECT email FROM users WHERE active = 1 AND employee_id = ?', r.employee_id);
    if (!list.length && r.employeeEmail) list = [r.employeeEmail];
  }
  return dropDeparted(db, dedupe(list, actorEmail));
}

/**
 * يجدول إرسال إشعار طلب. ctx = { env, db, url, defer }. يُرجع وعداً (للانتظار في الاختبارات) أو undefined إن لم يُضبط بريد.
 * actor: بريد من أحدث الحدث (لا يُشعَر هو).
 */
export function notifyRequest(ctx, event, requestId, { actor = null, note = null, extra = null } = {}) {
  const mailer = mailerFor(ctx.env);
  if (!mailer) return undefined;
  const origin = new URL(ctx.url).origin;
  const job = (async () => {
    try {
      const stored = await ctx.db.prepare("SELECT value FROM settings WHERE key = 'requests'").first();
      let rules;
      try {
        rules = mergeRules(stored ? JSON.parse(stored.value) : null);
      } catch {
        rules = mergeRules(null);
      }
      if (!rules.notify.enabled) return;
      const r = await ctx.db
        .prepare(
          `SELECT r.*, e.name AS employeeName, e.manager_id, e.email AS employeeEmail
           FROM requests r JOIN employees e ON e.id = r.employee_id WHERE r.id = ?`,
        )
        .bind(requestId)
        .first();
      if (!r) return;
      const to = await recipientsOf(ctx.db, event, r, rules, actor);
      if (!to.length) return;
      const m = message(event, r, origin, note ?? r.decision_note, extra);
      let failed = null;
      for (const addr of to) {
        try {
          await mailer.send({ to: addr, ...m });
        } catch (e) {
          failed ||= e;
          console.warn('notify: send failed', event, e?.message);
        }
      }
      if (failed) await logMailFailure(ctx.db, `request.${event}`, requestId, failed);
    } catch (e) {
      console.warn('notify: failed', event, e?.message);
    }
  })();
  return ctx.defer ? ctx.defer(job) : job;
}

/** إشعار الأيام التي أُفرج عنها من إجازات معتمدة بسبب الدخول الفعلي: list من releaseLeaveDays. */
export function notifyRelease(ctx, list) {
  // سقف 4 إشعارات للدفعة الواحدة: كل إشعار يستهلك استعلامات من حدّ الطلب الواحد (50)؛ والباقي مسجَّل في التدقيق
  const jobs = list.slice(0, MAX_RELEASE_MAILS).map((x) => notifyRequest(ctx, 'released', x.requestId, { extra: x }));
  return Promise.all(jobs); // بلا waitUntil (الاختبارات) كل وعد مُنتظَر؛ ومعه تكون القيم undefined فتنتهي فوراً
}

// ------------------------------------------------------------ الإجازات المتوقعة (الخطط)
const PLAN_TITLE = {
  plan_submitted: (p) => `خطة إجازات متوقعة من ${p.employeeName} بانتظار قرارك`,
  plan_decided: (p) => (p.status === 'approved' ? 'قرار مسؤولك على إجازاتك المتوقعة' : 'رُفضت إجازاتك المتوقعة'),
};

/** نص قصير لفترات الخطة: «2026-12-01 → 2026-12-03 (3 أيام)، 2026-12-08». */
const spanText = (days) => {
  const out = [];
  for (const d of days) {
    const last = out[out.length - 1];
    const next = last && new Date(Date.parse(`${last.to}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    if (last && d === next) { last.to = d; last.n += 1; } else out.push({ from: d, to: d, n: 1 });
  }
  return out.map((x) => (x.n === 1 ? x.from : `${x.from} → ${x.to} (${x.n} أيام)`)).join('، ');
};

export function planMessage(event, p, days, origin) {
  const subject = PLAN_TITLE[event](p);
  const by = (st) => days.filter((d) => d.status === st).map((d) => d.date);
  const rows = [['الموظف', p.employeeName], ['النوع', `إجازة ${p.purpose === 'annual' ? 'اعتيادية' : 'أخرى'}${p.note ? ` — ${p.note}` : ''}`]];
  if (event === 'plan_submitted') {
    rows.push(['عدد الأيام', String(days.length)], ['الأيام', spanText(days.map((d) => d.date))]);
  } else {
    if (by('approved').length) rows.push(['الأيام المعتمدة', spanText(by('approved'))]);
    if (by('rejected').length) rows.push(['الأيام المرفوضة', spanText(by('rejected'))]);
    if (p.decision_note) rows.push(['ملاحظة المسؤول', p.decision_note]);
  }
  const link = `${origin}/#/plans?open=${p.id}`;
  const text = `${subject}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nافتح الخطة: ${link}\n— نظام نوى للشؤون الإدارية، جمعية نوى للثقافة والفنون`;
  const html = `<div dir="rtl" lang="ar" style="font-family:Segoe UI,Tahoma,Arial,sans-serif;max-width:480px;margin:auto;padding:22px;border:1px solid #e6dccf;border-radius:14px;color:#2a1410">
<p style="margin:0 0 12px;font-weight:700;font-size:16px">${esc(subject)}</p>
<table style="border-collapse:collapse;width:100%;margin:0 0 16px">${rows.map(([k, v]) => `<tr><td style="padding:5px 0;color:#72655f;width:34%;vertical-align:top">${esc(k)}</td><td style="padding:5px 0">${esc(v)}</td></tr>`).join('')}</table>
<p style="margin:0 0 16px"><a href="${esc(link)}" style="display:inline-block;background:#a21008;color:#fff;text-decoration:none;padding:9px 18px;border-radius:9px;font-weight:700">فتح الخطة</a></p>
<p style="margin:0;color:#72655f;font-size:12px">نظام نوى للشؤون الإدارية — جمعية نوى للثقافة والفنون</p></div>`;
  return { subject, text, html };
}

/** plan_submitted → المعتمِد؛ plan_decided → الموظف. نفس ضوابط notifyRequest: لا يعطّل شيئاً، ويحترم rules.notify.enabled. */
export function notifyPlan(ctx, event, planId, { actor = null } = {}) {
  const mailer = mailerFor(ctx.env);
  if (!mailer) return undefined;
  const origin = new URL(ctx.url).origin;
  const job = (async () => {
    try {
      const stored = await ctx.db.prepare("SELECT value FROM settings WHERE key = 'requests'").first();
      let rules;
      try {
        rules = mergeRules(stored ? JSON.parse(stored.value) : null);
      } catch {
        rules = mergeRules(null);
      }
      if (!rules.notify.enabled) return;
      const p = await ctx.db
        .prepare(
          `SELECT p.*, e.name AS employeeName, e.manager_id, e.email AS employeeEmail
           FROM leave_plans p JOIN employees e ON e.id = p.employee_id WHERE p.id = ?`,
        )
        .bind(planId)
        .first();
      if (!p) return;
      const days = (await ctx.db.prepare('SELECT date, status FROM leave_plan_days WHERE plan_id = ? ORDER BY date').bind(planId).all()).results;
      let list;
      if (event === 'plan_submitted') {
        const own = await emailsOf(ctx.db, 'SELECT email FROM users WHERE employee_id = ?', p.employee_id);
        list = (await approverEmails(ctx.db, p.manager_id)).filter((e) => !own.includes(e));
      } else {
        list = await ownerEmails(ctx.db, p.employee_id, p.employeeEmail);
      }
      const to = await dropDeparted(ctx.db, dedupe(list, actor));
      if (!to.length) return;
      const m = planMessage(event, p, days, origin);
      let failed = null;
      for (const addr of to) {
        try {
          await mailer.send({ to: addr, ...m });
        } catch (e) {
          failed ||= e;
          console.warn('notify: plan send failed', event, e?.message);
        }
      }
      if (failed) await logMailFailure(ctx.db, `plan.${event}`, planId, failed);
    } catch (e) {
      console.warn('notify: plan failed', event, e?.message);
    }
  })();
  return ctx.defer ? ctx.defer(job) : job;
}
