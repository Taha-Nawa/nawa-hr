/**
 * إرسال البريد (رموز الدخول). لا اعتماد على أي مكتبة، ولا أسرار في المستودع (عام):
 * الأسرار تُضبط كـ Cloudflare secrets فقط.
 *
 * المزوّد الأساسي: Microsoft Graph (تطبيق مؤسسي بصلاحية Mail.Send، مجاني ضمن اشتراك Microsoft 365 للجمعية):
 *   MAIL_CLIENT_ID      معرّف تطبيق «Nawa HR Mail»
 *   MAIL_CLIENT_SECRET  سرّ التطبيق
 *   MAIL_FROM           صندوق الإرسال (مثل no-reply@nawaculture.org)
 *   ENTRA_TENANT_ID     موجود أصلاً في wrangler.jsonc
 * بديل: Resend (خطة مجانية): RESEND_API_KEY + MAIL_FROM (النطاق موثّق عندهم).
 * دون أيٍّ منهما تبقى طريقة «رمز بالبريد» مخفية، وبقية طرق الدخول تعمل.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** متغيرات Graph المطلوبة (لعرض الناقص منها للمسؤول؛ أسماء فقط، لا قيم). */
export const MAIL_VARS = ['MAIL_CLIENT_ID', 'MAIL_CLIENT_SECRET', 'MAIL_FROM'];
const graphToken = { value: null, exp: 0, key: '' };

function graphConfig(env) {
  const tenant = (env.MAIL_TENANT_ID || env.ENTRA_TENANT_ID || '').trim();
  const clientId = (env.MAIL_CLIENT_ID || '').trim();
  const secret = (env.MAIL_CLIENT_SECRET || '').trim();
  const from = (env.MAIL_FROM || '').trim();
  return tenant && clientId && secret && EMAIL_RE.test(from) ? { tenant, clientId, secret, from } : null;
}

async function getGraphToken(cfg, now) {
  const key = `${cfg.tenant}:${cfg.clientId}:${cfg.secret.length}`;
  if (graphToken.value && graphToken.key === key && graphToken.exp - 60_000 > now) return graphToken.value;
  const r = await fetch(`https://login.microsoftonline.com/${cfg.tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`graph token ${r.status} ${j.error || ''}`.trim());
  graphToken.value = j.access_token;
  graphToken.exp = now + (Number(j.expires_in) || 3000) * 1000;
  graphToken.key = key;
  return graphToken.value;
}

async function sendGraph(cfg, { to, subject, html }) {
  const token = await getGraphToken(cfg, Date.now());
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.from)}/sendMail`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message: { subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: false }),
  });
  if (r.status === 401) graphToken.value = null; // الرمز المخزَّن لم يعد صالحاً
  if (!r.ok) throw new Error(`graph send ${r.status}`);
}

async function sendResend(env, { to, subject, html, text }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html, text }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}`);
}

/** { send({to, subject, html, text}) } أو null إن لم يُضبط بريد. `env.__MAILER` للاختبارات فقط. */
export function mailerFor(env) {
  if (env.__MAILER) return env.__MAILER;
  const g = graphConfig(env);
  if (g) return { kind: 'graph', send: (m) => sendGraph(g, m) };
  if (env.RESEND_API_KEY && EMAIL_RE.test((env.MAIL_FROM || '').trim())) return { kind: 'resend', send: (m) => sendResend(env, m) };
  return null;
}

export const mailConfigured = (env) => !!mailerFor(env);

/** يسجّل فشل إرسال إشعار في سجل التدقيق ليراه المسؤول (مرة واحدة لكل إشعار، بلا عناوين المستلمين). */
export async function logMailFailure(db, what, id, err) {
  try {
    await db.prepare("INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES ('system', 'mail.failed', ?, ?, ?)")
      .bind(String(what).slice(0, 40), id === null || id === undefined ? null : String(id), JSON.stringify({ error: String(err?.message || err).slice(0, 200) }))
      .run();
  } catch { /* السجل لا يعطّل شيئاً */ }
}

/** رسالة الرمز: عنوانها يحمل الرمز كي يظهر في إشعار الهاتف دون فتح الرسالة. */
export function codeMessage(code, minutes) {
  const subject = `رمز الدخول ${code} — الحضور والطلبات`;
  const text = `رمز الدخول إلى نظام الحضور والطلبات (جمعية نوى): ${code}\nصالح لمدة ${minutes} دقائق ويُستعمل مرة واحدة.\nإن لم تطلبه فتجاهل هذه الرسالة ولا تُشارك الرمز مع أحد.`;
  const html = `<div dir="rtl" lang="ar" style="font-family:Segoe UI,Tahoma,Arial,sans-serif;max-width:420px;margin:auto;padding:24px;border:1px solid #e6dccf;border-radius:14px;color:#2a1410">
<p style="margin:0 0 6px;font-weight:700">الحضور والطلبات — جمعية نوى للثقافة والفنون</p>
<p style="margin:0 0 14px;color:#5a4a45">رمز الدخول الخاص بك:</p>
<p style="margin:0 0 14px;font-size:34px;letter-spacing:8px;font-weight:800;color:#a21008;direction:ltr;text-align:center">${code}</p>
<p style="margin:0 0 6px;color:#5a4a45">صالح لمدة ${minutes} دقائق ويُستعمل مرة واحدة.</p>
<p style="margin:0;color:#7d6f68;font-size:13px">إن لم تطلب هذا الرمز فتجاهل الرسالة، ولا تُشارك الرمز مع أحد.</p></div>`;
  return { subject, text, html };
}
