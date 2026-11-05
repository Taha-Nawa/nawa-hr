/**
 * تذكيرات التقرير الشهري بالبريد (قرار 2 نوفمبر 2026). تعمل مرة يومياً من المهمة المجدولة (index.js) في اليوم الذي تنطبق فيه
 * إحدى المراحل (reportWindows في engine/monthly-report.js):
 *   eom  : للموظف في آخر 4 أيام من الشهر: «قدّم تقريرك قبل نهاية الشهر».
 *   late : للموظف من اليوم 3 إلى 14 من الشهر التالي إن لم يقدّم تقرير الشهر المنصرم.
 *   mgr  : نشرة للمدير المباشر (بمن لم يقدّم من فريقه) وللموارد البشرية والمدير العام (بمن لم يقدّم من الجميع).
 * كل مرحلة تُرسَل مرة واحدة لكل شخص وشهر (جدول report_reminders)، وإن ضاقت الدفعة (حدود الخطة المجانية: 50 استعلاماً/طلباً
 * خارجياً للتشغيل الواحد) يكمل الإرسال في اليوم التالي. تحترم مفتاح الإشعارات rules.notify.enabled نفسه. لا تعطّل شيئاً إن لم يُضبط بريد.
 * الإرسال يعدّ «تم» لمن قدّم تقريره فقط (status = submitted)؛ المسودة لا تكفي.
 */
import { localDate, nowOf } from './util.js';
import { tzOf } from './close.js';
import { mailerFor, logMailFailure } from './mail.js';
import { mergeRules } from '../engine/requests.js';
import { reportWindows, monthBounds, monthLabelAr } from '../engine/monthly-report.js';

const DEFAULT_ORIGIN = 'https://nawa-hr.nawa-attendance.workers.dev';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_MAILS = 25;
const MAX_FAILS = 3;
const MAX_NAMES = 30;
const FOOT = '— نظام نوى للشؤون الإدارية، جمعية نوى للثقافة والفنون';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function frame({ subject, paras, names = null, link, linkLabel }) {
  const text = `${subject}\n\n${paras.join('\n\n')}${names ? `\n\n${names.map((n) => `• ${n}`).join('\n')}` : ''}\n\n${linkLabel}: ${link}\n${FOOT}`;
  const html = `<div dir="rtl" lang="ar" style="font-family:Segoe UI,Tahoma,Arial,sans-serif;max-width:480px;margin:auto;padding:22px;border:1px solid #e6dccf;border-radius:14px;color:#2a1410">
<p style="margin:0 0 12px;font-weight:700;font-size:16px">${esc(subject)}</p>
${paras.map((p) => `<p style="margin:0 0 12px;color:#5a4a45">${esc(p)}</p>`).join('\n')}
${names ? `<ul style="margin:0 0 14px;padding-inline-start:20px">${names.map((n) => `<li style="margin:2px 0">${esc(n)}</li>`).join('')}</ul>` : ''}
<p style="margin:0 0 16px"><a href="${esc(link)}" style="display:inline-block;background:#a21008;color:#fff;text-decoration:none;padding:9px 18px;border-radius:9px;font-weight:700">${esc(linkLabel)}</a></p>
<p style="margin:0;color:#72655f;font-size:12px">نظام نوى للشؤون الإدارية — جمعية نوى للثقافة والفنون</p></div>`;
  return { subject, text, html };
}

export function employeeMessage(stage, month, origin, employeeId, name) {
  const label = monthLabelAr(month);
  const link = `${origin}/#/monthly-report/${employeeId}/${month}`;
  const subject = stage === 'eom' ? `تذكير: قدّم تقرير شهر ${label} قبل نهاية الشهر` : `تقرير شهر ${label} لم يُقدَّم بعد`;
  const first = stage === 'eom'
    ? `أهلاً ${name}، يقترب نهاية شهر ${label} ولم تقدّم تقريرك الشهري بعد.`
    : `أهلاً ${name}، لم يصلنا تقريرك الشهري لشهر ${label} بعد.`;
  return frame({
    subject, link, linkLabel: 'فتح تقريري الشهري',
    paras: [first, 'كل ما سجلته في «ماذا أنجزت اليوم» يُستورد إلى التقرير بنقرة، وتراجعه ثم تقدّمه في دقائق.'],
  });
}

export function digestMessage(month, origin, { pending, total, scope }) {
  const label = monthLabelAr(month);
  const done = total - pending.length;
  const names = pending.slice(0, MAX_NAMES).map((p) => p.name);
  if (pending.length > MAX_NAMES) names.push(`و${pending.length - MAX_NAMES} آخرين`);
  return frame({
    subject: `تقارير شهر ${label}: ${pending.length} لم يقدّموا بعد`,
    paras: [`قدّم ${done} من ${total} ${scope === 'team' ? 'من فريقك' : 'من الموظفين'} تقرير شهر ${label}. لم يقدّم بعد:`],
    names, link: `${origin}/#/monthly-report`, linkLabel: 'فتح قائمة التقارير',
  });
}

const notifyEnabled = async (db) => {
  const stored = await db.prepare("SELECT value FROM settings WHERE key = 'requests'").first();
  try { return mergeRules(stored ? JSON.parse(stored.value) : null).notify.enabled; } catch { return mergeRules(null).notify.enabled; }
};

async function employeeBatch(db, { month, stage }, limit) {
  const { from, to } = monthBounds(month);
  return (await db.prepare(
    `SELECT u.id AS userId, u.email, e.id AS employeeId, e.name
       FROM users u
       JOIN employees e ON e.id = u.employee_id
       LEFT JOIN monthly_reports r ON r.employee_id = e.id AND r.month = ?1 AND r.status = 'submitted'
       LEFT JOIN report_reminders q ON q.user_id = u.id AND q.month = ?1 AND q.stage = ?2
      WHERE u.active = 1 AND u.email LIKE '%@%.%' AND e.status = 'active' AND r.employee_id IS NULL AND q.user_id IS NULL
        AND (e.start_date IS NULL OR e.start_date <= ?3) AND (e.end_date IS NULL OR e.end_date >= ?4)
      ORDER BY u.id LIMIT ?5`,
  ).bind(month, stage, to, from, limit).all()).results;
}

/** المستلمون الذين لم تصلهم نشرة هذا الشهر: [{ userId, email, scope: 'all'|'team', pending, total }] */
async function digestTargets(db, month) {
  const { from, to } = monthBounds(month);
  const staff = (await db.prepare(
    `SELECT e.id, e.name, e.manager_id AS managerId, (r.employee_id IS NOT NULL) AS done
       FROM employees e LEFT JOIN monthly_reports r ON r.employee_id = e.id AND r.month = ?1 AND r.status = 'submitted'
      WHERE e.status = 'active' AND (e.start_date IS NULL OR e.start_date <= ?2) AND (e.end_date IS NULL OR e.end_date >= ?3)
      ORDER BY e.name LIMIT 500`,
  ).bind(month, to, from).all()).results;
  const pendingAll = staff.filter((s) => !s.done);
  if (!pendingAll.length) return [];
  const sentTo = new Set((await db.prepare("SELECT user_id AS id FROM report_reminders WHERE month = ? AND stage = 'mgr'").bind(month).all()).results.map((r) => r.id));
  const out = [];
  const hr = (await db.prepare("SELECT id, email FROM users WHERE active = 1 AND role IN ('hr', 'director')").all()).results;
  for (const u of hr) if (!sentTo.has(u.id)) out.push({ userId: u.id, email: u.email, scope: 'all', pending: pendingAll, total: staff.length });
  const managerIds = [...new Set(pendingAll.map((s) => s.managerId).filter((m) => m != null))].slice(0, 90);
  if (managerIds.length) {
    const ph = managerIds.map(() => '?').join(', ');
    const mgrs = (await db.prepare(`SELECT id, email, employee_id AS employeeId FROM users WHERE active = 1 AND employee_id IN (${ph})`).bind(...managerIds).all()).results;
    const taken = new Set(hr.map((u) => u.id));
    for (const u of mgrs) {
      if (sentTo.has(u.id) || taken.has(u.id)) continue;
      const team = staff.filter((s) => s.managerId === u.employeeId);
      const pending = team.filter((s) => !s.done);
      if (pending.length) out.push({ userId: u.id, email: u.email, scope: 'team', pending, total: team.length });
    }
  }
  return out;
}

/** يُنفَّذ مرة يومياً. يُرجع ملخصاً للاختبار والمراقبة: { sent, stages: { eom|late|mgr: n }, reason? } */
export async function reportReminders(env, { origin = DEFAULT_ORIGIN, now = nowOf(env) } = {}) {
  const db = env.DB;
  const win = reportWindows(localDate(tzOf(env), now)).mail;
  if (!win.length) return { sent: 0, reason: 'window', stages: {} };
  const mailer = mailerFor(env);
  if (!mailer) return { sent: 0, reason: 'no_mail', stages: {} };
  if (!(await notifyEnabled(db))) return { sent: 0, reason: 'disabled', stages: {} };

  const sent = [];
  const stages = {};
  let fails = 0;
  let firstError = null;
  const deliver = async (userId, email, month, stage, message) => {
    if (sent.length >= MAX_MAILS || fails >= MAX_FAILS || !EMAIL_RE.test(email || '')) return;
    try {
      await mailer.send({ to: email, ...message });
      sent.push({ userId, month, stage });
      stages[stage] = (stages[stage] || 0) + 1;
      fails = 0;
    } catch (e) {
      fails += 1;
      firstError ||= e;
    }
  };

  for (const w of win.filter((x) => x.stage !== 'mgr')) {
    for (const r of await employeeBatch(db, w, Math.max(1, MAX_MAILS - sent.length))) {
      await deliver(r.userId, r.email, w.month, w.stage, employeeMessage(w.stage, w.month, origin, r.employeeId, r.name));
    }
  }
  for (const w of win.filter((x) => x.stage === 'mgr')) {
    if (sent.length >= MAX_MAILS) break;
    for (const t of await digestTargets(db, w.month)) {
      await deliver(t.userId, t.email, w.month, 'mgr', digestMessage(w.month, origin, t));
    }
  }

  if (firstError) await logMailFailure(db, 'report.reminder', null, firstError);
  if (sent.length) {
    const ins = db.prepare('INSERT OR IGNORE INTO report_reminders (user_id, month, stage) VALUES (?, ?, ?)');
    const audit = db.prepare("INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES ('system', 'monthlyReport.remind', 'monthly_reports', NULL, ?)");
    await db.batch([...sent.map((s) => ins.bind(s.userId, s.month, s.stage)), audit.bind(JSON.stringify({ sent: sent.length, stages }))]);
  }
  return { sent: sent.length, stages };
}
