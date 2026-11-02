/**
 * إشعارات البريد للطلبات (قرار 2 نوفمبر 2026):
 *   submitted : عند تقديم طلب → المعتمِد (المدير المباشر، وإن لم يكن له حساب فالموارد البشرية؛ والإجازة المرضية التي تلزمها ورقة طبية → مؤكِّدو الأوراق)
 *   approved / rejected / cancelled : عند القرار أو إلغاء الاعتماد → الموظف صاحب الطلب (إلا إن كان هو من فعل ذلك)
 *
 * تعمل فقط إن كان إرسال البريد مضبوطاً (docs/EMAIL-SETUP.md) وكان rules.notify.enabled غير مُوقَف.
 * الإرسال لا يعطّل الطلب ولا يُفشله أبداً: يجري بعد الرد (ctx.defer) وأي خطأ يُسجَّل ويُتجاوز.
 */
import { mailerFor } from './mail.js';
import { mergeRules, needsMedical, KINDS, PURPOSES } from '../engine/requests.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 10;
const MAX_RELEASE_MAILS = 4;

const TITLE = {
  submitted: (r) => `${KINDS[r.kind]} جديد من ${r.employeeName} بانتظار قرارك`,
  approved: (r) => `اعتُمد ${KINDS[r.kind]} الخاص بك`,
  rejected: (r) => `رُفض ${KINDS[r.kind]} الخاص بك`,
  cancelled: (r) => `أُلغي ${KINDS[r.kind]} الخاص بك`,
  released: (r) => `أُلغيت إجازة ${r.employeeName} المعتمدة لتسجيله الدخول فعلياً`,
};

function lines(r) {
  const out = [['الموظف', r.employeeName], ['النوع', `${KINDS[r.kind]} — ${PURPOSES[r.purpose]}${r.purpose_other ? ` (${r.purpose_other})` : ''}`]];
  if (r.kind === 'leave') {
    out.push(['الفترة', r.from_date === r.to_date ? r.from_date : `من ${r.from_date} إلى ${r.to_date}`], ['أيام العمل', String(r.days)]);
  } else {
    out.push(['اليوم', r.from_date], ['الوقت', `${r.from_time} – ${r.to_time}`]);
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
  const text = `${subject}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nافتح الطلب: ${link}\n— نظام الحضور والطلبات، جمعية نوى للثقافة والفنون`;
  const html = `<div dir="rtl" lang="ar" style="font-family:Segoe UI,Tahoma,Arial,sans-serif;max-width:480px;margin:auto;padding:22px;border:1px solid #e6dccf;border-radius:14px;color:#2a1410">
<p style="margin:0 0 12px;font-weight:700;font-size:16px">${esc(subject)}</p>
<table style="border-collapse:collapse;width:100%;margin:0 0 16px">${rows.map(([k, v]) => `<tr><td style="padding:5px 0;color:#7d6f68;width:34%;vertical-align:top">${esc(k)}</td><td style="padding:5px 0">${esc(v)}</td></tr>`).join('')}</table>
<p style="margin:0 0 16px"><a href="${esc(link)}" style="display:inline-block;background:#a21008;color:#fff;text-decoration:none;padding:9px 18px;border-radius:9px;font-weight:700">فتح الطلب</a></p>
<p style="margin:0;color:#7d6f68;font-size:12px">نظام الحضور والطلبات — جمعية نوى للثقافة والفنون</p></div>`;
  return { subject, text, html };
}

/** عناوين من يستقبل الإشعار (بلا المُشغِّل نفسه، بلا تكرار، بحدّ أقصى). */
async function recipientsOf(db, event, r, rules, actorEmail) {
  const emails = async (sql, ...p) => (await db.prepare(sql).bind(...p).all()).results.map((x) => x.email);
  let list;
  if (event === 'submitted') {
    if (needsMedical(r, rules)) {
      list = await emails("SELECT email FROM users WHERE active = 1 AND (role IN ('hr', 'director', 'admin') OR medical = 1)");
    } else {
      list = r.manager_id != null ? await emails("SELECT email FROM users WHERE active = 1 AND employee_id = ? AND role IN ('manager', 'hr', 'director', 'admin')", r.manager_id) : [];
      if (!list.length) list = await emails("SELECT email FROM users WHERE active = 1 AND role = 'hr'");
      if (!list.length) list = await emails("SELECT email FROM users WHERE active = 1 AND role IN ('director', 'admin')");
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
  const seen = new Set();
  return list
    .filter((e) => EMAIL_RE.test(e || '') && e.toLowerCase() !== (actorEmail || '').toLowerCase())
    .filter((e) => (seen.has(e.toLowerCase()) ? false : (seen.add(e.toLowerCase()), true)))
    .slice(0, MAX_RECIPIENTS);
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
      for (const addr of to) {
        try {
          await mailer.send({ to: addr, ...m });
        } catch (e) {
          console.warn('notify: send failed', event, e?.message);
        }
      }
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
