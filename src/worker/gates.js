/**
 * مراقبة البوابات: هل كل بوابة فعّالة متصلة أثناء ساعات الدوام؟
 * - تطبيق البوابة يرسل «نبضاً» (ping) كل 5 دقائق وهو متصل (يُحدَّث devices.last_ping).
 * - «صامتة»: لها نبض سابق لكنه أقدم من 20 دقيقة أثناء الدوام. «هادئة»: لم يصلها نبض قط (نسخة قديمة من التطبيق)
 *   ولم تُسجَّل منها أي حركة اليوم بعد ساعتين من بداية الدوام. «لم تتصل»: لا نبض ولا حركة في تاريخها.
 * - خارج الدوام وفي العطل وعند إعلان طارئ فعّال: لا تنبيه.
 * - cron كل نصف ساعة يرسل بريداً للمسؤولين مرة واحدة يومياً لكل بوابة (إن كان البريد مُعدّاً).
 */
import { json, localDate, nowOf } from './util.js';
import { can } from './authz.js';
import { loadWorkSettings } from './settings.js';
import { tzOf } from './close.js';
import { dayTypeOf, DAY_WORK, toMin } from '../engine/attendance.js';
import { mailerFor, logMailFailure } from './mail.js';

export const GATE_CRON = '*/30 4-13 * * *';
const GRACE_MIN = 30; // بعد بداية الدوام بنصف ساعة يبدأ التقييم
const PING_STALE_MIN = 20;
const QUIET_AFTER_MIN = 120;

const sqlMs = (s) => (s ? Date.parse(`${String(s).replace(' ', 'T')}Z`) : null);
function localMinutes(tz, now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute);
}

export async function gateStatus(env, now = nowOf(env)) {
  const db = env.DB;
  const tz = tzOf(env);
  const settings = await loadWorkSettings(db);
  const date = localDate(tz, now);
  const [devs, counts, hol, emg] = await Promise.all([
    db.prepare('SELECT d.id, d.name, d.center_id AS centerId, c.name AS center, d.last_seen AS lastSeen, d.last_ping AS lastPing FROM devices d LEFT JOIN centers c ON c.id = d.center_id WHERE d.active = 1 ORDER BY d.id').all(),
    db.prepare('SELECT device_id AS id, COUNT(*) AS n FROM movements WHERE date = ? GROUP BY device_id').bind(date).all(),
    db.prepare('SELECT 1 FROM holidays WHERE date = ?').bind(date).first(),
    db.prepare("SELECT center_id AS centerId FROM emergencies WHERE date = ? AND status = 'active'").bind(date).all(),
  ]);
  const moves = new Map(counts.results.map((r) => [r.id, r.n]));
  const mins = localMinutes(tz, now);
  const isWork = !!settings && dayTypeOf(date, settings, new Set(hol ? [date] : [])) === DAY_WORK;
  const start = settings ? toMin(settings.start) : null;
  const end = settings ? toMin(settings.end) : null;
  const inWindow = isWork && mins >= start + GRACE_MIN && mins <= end;

  const devices = devs.results.map((d) => {
    const ping = sqlMs(d.lastPing);
    const sincePing = ping === null ? null : Math.round((now.getTime() - ping) / 60000);
    const movesToday = moves.get(d.id) || 0;
    let state;
    if (!d.lastSeen && !d.lastPing) state = 'never';
    else if (!inWindow) state = 'off';
    else if (emg.results.some((e) => e.centerId === null || e.centerId === d.centerId)) state = 'emergency';
    else if (ping !== null) state = sincePing > PING_STALE_MIN ? 'silent' : 'ok';
    else state = mins >= start + QUIET_AFTER_MIN && movesToday === 0 ? 'quiet' : 'ok';
    return { id: d.id, name: d.name, center: d.center, state, lastSeen: d.lastSeen, lastPing: d.lastPing, minutesSincePing: sincePing, movesToday };
  });
  return { date, inWindow, devices, problems: devices.filter((d) => d.state === 'silent' || d.state === 'quiet') };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function alertMessage(problems, origin) {
  const lines = problems.map((p) => (p.state === 'silent'
    ? `${p.name || p.id} (${p.center || 'بلا مركز'}): لم تتصل منذ ${p.minutesSincePing} دقيقة`
    : `${p.name || p.id} (${p.center || 'بلا مركز'}): لم تسجّل أي حركة اليوم ولا نبض منها`));
  const subject = problems.length === 1 ? `تنبيه: بوابة ${problems[0].name || problems[0].id} غير متصلة` : `تنبيه: ${problems.length} بوابات غير متصلة`;
  const link = `${origin}/#/devices`;
  const text = `${subject}\n\n${lines.join('\n')}\n\nالحركات تُحفظ على جهاز البوابة وتُرسل عند عودة الاتصال، لكن لا تُحتسب قبل ذلك.\nراجع الأجهزة: ${link}\n— نظام الحضور والطلبات، جمعية نوى للثقافة والفنون`;
  const html = `<div dir="rtl" lang="ar" style="font-family:Segoe UI,Tahoma,Arial,sans-serif;max-width:480px;margin:auto;padding:22px;border:1px solid #e6dccf;border-radius:14px;color:#2a1410">
<p style="margin:0 0 12px;font-weight:700;font-size:16px">${esc(subject)}</p>
<ul style="margin:0 0 14px;padding-inline-start:18px">${lines.map((l) => `<li style="margin:4px 0">${esc(l)}</li>`).join('')}</ul>
<p style="margin:0 0 14px;color:#5a4a45">الحركات تُحفظ على جهاز البوابة وتُرسل عند عودة الاتصال، لكن لا تُحتسب قبل ذلك.</p>
<p style="margin:0 0 14px"><a href="${esc(link)}" style="display:inline-block;background:#a21008;color:#fff;text-decoration:none;padding:9px 18px;border-radius:9px;font-weight:700">مراجعة الأجهزة</a></p>
<p style="margin:0;color:#7d6f68;font-size:12px">نظام الحضور والطلبات — جمعية نوى للثقافة والفنون</p></div>`;
  return { subject, text, html };
}

/** يُشغَّل من cron: يرسل تنبيهاً واحداً لكل بوابة مشكلتها جديدة اليوم. يُرجع { problems, notified }. */
export async function alertGates(env, { origin = 'https://nawa-hr.nawa-attendance.workers.dev', now = nowOf(env) } = {}) {
  const st = await gateStatus(env, now);
  if (!st.problems.length) return { problems: 0, notified: 0 };
  const mailer = mailerFor(env);
  if (!mailer) return { problems: st.problems.length, notified: 0, reason: 'no_mail' };
  const db = env.DB;
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'gate_alerts'").first();
  let sent = {};
  try { const v = JSON.parse(row?.value || '{}'); if (v.date === st.date) sent = v.sent || {}; } catch { /* بداية جديدة */ }
  const fresh = st.problems.filter((p) => !sent[p.id]);
  if (!fresh.length) return { problems: st.problems.length, notified: 0 };
  const to = (await db.prepare("SELECT email FROM users WHERE active = 1 AND role = 'admin'").all()).results.map((r) => r.email);
  if (!to.length) return { problems: st.problems.length, notified: 0, reason: 'no_recipients' };
  const m = alertMessage(fresh, origin);
  let failed = null;
  let ok = 0;
  for (const addr of to.slice(0, 5)) {
    try { await mailer.send({ to: addr, ...m }); ok += 1; } catch (e) { failed ||= e; }
  }
  if (failed) await logMailFailure(db, 'gate.alert', fresh.map((p) => p.id).join(','), failed);
  if (ok) {
    for (const p of fresh) sent[p.id] = now.toISOString();
    await db.batch([
      db.prepare("INSERT INTO settings (key, value) VALUES ('gate_alerts', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(JSON.stringify({ date: st.date, sent })),
      db.prepare("INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES ('system', 'gate.alert', 'device', ?, ?)").bind(fresh.map((p) => p.id).join(','), JSON.stringify({ states: fresh.map((p) => [p.id, p.state]), to: ok })),
    ]);
  }
  return { problems: st.problems.length, notified: ok };
}

export function registerGateRoutes(add, kit) {
  const { forbidden } = kit;
  add('GET', '/api/gates/status', async ({ env, user }) => {
    if (!can(user, 'gates.read')) return forbidden();
    const st = await gateStatus(env);
    return json({ ok: true, ...st });
  });
}
