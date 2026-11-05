/**
 * تنبيه «لم يحضر» لمزوّدي الخدمة (قرار 3 نوفمبر 2026). يعمل من المهمة المجدولة كل نصف ساعة (GATE_CRON صباحاً + EVENING_CRON مساءً):
 * كل مزوّد فعّال بعقد ساري بدأت حصته منذ أكثر من PROVIDER_RULES.noShowMin دقيقة ولم يُسجَّل له أي وجود فيها، يصل بريد
 * للموارد البشرية والمسؤول وللمشرف المسؤول عنه، مرة واحدة لكل مزوّد وحصة ويوم (جدول provider_alerts).
 *  - لا تنبيه في العطل الرسمية ولا في إغلاق الطارئ (الحصص تُحسب منها أصلاً)، ويُقصّ الإخلاء الجزئي حصة اليوم.
 *  - إن كانت بوابة مركزه صامتة (لا نبض ولا حركة منذ 20 دقيقة) لا نجزم بغيابه فلا نرسل: مسحه قد يكون عالقاً على الجهاز.
 *  - التنبيه الحيّ نفسه ظاهر دائماً في لوحة «مزوّدو الخدمة» ولوحة اليوم بصرف النظر عن البريد.
 *  - يحترم مفتاح الإشعارات rules.notify.enabled ولا يفعل شيئاً إن لم يُضبط بريد. سقف 10 رسائل للتشغيل الواحد (حدود الخطة المجانية).
 */
import { nowOf } from './util.js';
import { mailerFor, logMailFailure } from './mail.js';
import { mergeRules } from '../engine/requests.js';
import { boardFor, loadProviders } from './providers.js';
import { fmt12 } from './util.js';

export const EVENING_CRON = '*/30 14-17 * * *';
const DEFAULT_ORIGIN = 'https://nawa-hr.nawa-attendance.workers.dev';
const MAX_MAILS = 10;
const SILENT_MIN = 20;
const ADMIN = { role: 'admin', email: 'system' };
const FOOT = '— نظام نوى للشؤون الإدارية، جمعية نوى للثقافة والفنون';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sqlMs = (s) => (s ? Date.parse(`${String(s).replace(' ', 'T')}Z`) : null);

export function alertMessage(items, origin) {
  const lines = items.map((i) => `${i.name}${i.center ? ` (${i.center})` : ''} — حصة ${fmt12(i.session.start)} إلى ${fmt12(i.session.end)}، لم يسجّل حضوره منذ ${i.sinceMin} دقيقة`);
  const subject = items.length === 1 ? `لم يحضر بعد: ${items[0].name}` : `لم يحضر ${items.length} من مزوّدي الخدمة`;
  const link = `${origin}/#/providers`;
  const text = `${subject}\n\n${lines.map((l) => `• ${l}`).join('\n')}\n\nإن كان قد حضر ولم يُسجَّل فيمكن إضافة حضوره يدوياً من ملفه.\nلوحة المزوّدين: ${link}\n${FOOT}`;
  const html = `<div dir="rtl" lang="ar" style="font-family:Segoe UI,Tahoma,Arial,sans-serif;max-width:480px;margin:auto;padding:22px;border:1px solid #e6dccf;border-radius:14px;color:#2a1410">
<p style="margin:0 0 12px;font-weight:700;font-size:16px">${esc(subject)}</p>
<ul style="margin:0 0 14px;padding-inline-start:20px">${lines.map((l) => `<li style="margin:4px 0">${esc(l)}</li>`).join('')}</ul>
<p style="margin:0 0 14px;color:#5a4a45">إن كان قد حضر ولم يُسجَّل فيمكن إضافة حضوره يدوياً من ملفه.</p>
<p style="margin:0 0 16px"><a href="${esc(link)}" style="display:inline-block;background:#a21008;color:#fff;text-decoration:none;padding:9px 18px;border-radius:9px;font-weight:700">لوحة المزوّدين</a></p>
<p style="margin:0;color:#72655f;font-size:12px">نظام نوى للشؤون الإدارية — جمعية نوى للثقافة والفنون</p></div>`;
  return { subject, text, html };
}

/** يُرجع { noshow, fresh, sent, reason? } — يستدعيه cron، ويُختبر مباشرة. */
export async function alertProviders(env, { origin = DEFAULT_ORIGIN, now = nowOf(env) } = {}) {
  const db = env.DB;
  const mailer = mailerFor(env);
  if (!mailer) return { noshow: 0, fresh: 0, sent: 0, reason: 'no_mail' };
  const stored = await db.prepare("SELECT value FROM settings WHERE key = 'requests'").first();
  let enabled = true;
  try { enabled = mergeRules(stored ? JSON.parse(stored.value) : null).notify.enabled; } catch { /* افتراضي */ }
  if (!enabled) return { noshow: 0, fresh: 0, sent: 0, reason: 'disabled' };

  const providers = await loadProviders(db, ADMIN, { activeOnly: true });
  if (!providers.length) return { noshow: 0, fresh: 0, sent: 0 };
  const board = await boardFor(env, providers, { now });
  const late = board.items.filter((i) => i.state === 'noshow' && i.session);
  if (!late.length) return { noshow: 0, fresh: 0, sent: 0 };

  const [done, devs] = await Promise.all([
    db.prepare('SELECT provider_id AS id, session_start AS start FROM provider_alerts WHERE date = ?').bind(board.date).all(),
    db.prepare('SELECT center_id AS centerId, last_ping AS ping, last_seen AS seen FROM devices WHERE active = 1').all(),
  ]);
  const sentKeys = new Set(done.results.map((r) => `${r.id}|${r.start}`));
  // بوابة المركز صامتة => لا نجزم بالغياب. مركز بلا بوابة أو بلا مركز => ننبّه.
  const fresh = late.filter((i) => {
    if (sentKeys.has(`${i.id}|${i.session.start}`)) return false;
    const mine = devs.results.filter((d) => d.centerId === i.centerId);
    if (i.centerId == null || !mine.length) return true;
    return mine.some((d) => {
      const last = Math.max(sqlMs(d.ping) || 0, sqlMs(d.seen) || 0);
      return last && now.getTime() - last <= SILENT_MIN * 60000;
    });
  });
  if (!fresh.length) return { noshow: late.length, fresh: 0, sent: 0 };

  const staff = (await db.prepare("SELECT email FROM users WHERE active = 1 AND role IN ('hr', 'admin')").all()).results.map((r) => r.email);
  const supIds = [...new Set(fresh.map((i) => i.supervisorId).filter((x) => x != null))];
  const sups = supIds.length
    ? (await db.prepare('SELECT id, email FROM employees WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(supIds)).all()).results
    : [];
  const supEmail = new Map(sups.filter((s) => EMAIL_RE.test(s.email || '')).map((s) => [s.id, s.email]));

  // لكل مستلم رسالة واحدة بما يخصه: الموارد البشرية والمسؤول بكل شيء، والمشرف بمزوّديه
  const plan = new Map();
  const push = (addr, item) => {
    const k = addr.toLowerCase();
    (plan.get(k) || plan.set(k, { addr, items: [] }).get(k)).items.push(item);
  };
  for (const a of staff) for (const i of fresh) push(a, i);
  for (const i of fresh) if (supEmail.has(i.supervisorId)) push(supEmail.get(i.supervisorId), i);

  let ok = 0;
  let failed = null;
  for (const { addr, items } of [...plan.values()].slice(0, MAX_MAILS)) {
    const uniq = [...new Map(items.map((i) => [i.id + i.session.start, i])).values()];
    try { await mailer.send({ to: addr, ...alertMessage(uniq, origin) }); ok += 1; } catch (e) { failed ||= e; }
  }
  if (failed) await logMailFailure(db, 'provider.alert', fresh.map((i) => i.id).join(','), failed);
  if (ok) {
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO provider_alerts (provider_id, date, session_start, kind) SELECT json_extract(value,'$.id'), ?1, json_extract(value,'$.start'), 'noshow' FROM json_each(?2)")
        .bind(board.date, JSON.stringify(fresh.map((i) => ({ id: i.id, start: i.session.start })))),
      db.prepare("INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES ('system', 'provider.alert', 'provider', ?, ?)")
        .bind(fresh.map((i) => i.code).join(',').slice(0, 200), JSON.stringify({ date: board.date, noshow: fresh.map((i) => [i.code, i.session.start]), to: ok })),
    ]);
  }
  return { noshow: late.length, fresh: fresh.length, sent: ok };
}
