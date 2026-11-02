/**
 * حالة البريد للمسؤول: هل الإعداد مكتمل، وما الناقص، وآخر الأعطال، وزر «رسالة تجريبية» تُرسَل إلى بريد المسؤول نفسه فقط.
 * لا يكشف أي سر: يُعرض اسم المتغير الناقص وعنوان الإرسال فقط.
 */
import { json } from './util.js';
import { can } from './authz.js';
import { mailerFor, MAIL_VARS } from './mail.js';

/** رسالة فشل تقنية → سبب مفهوم وخطوة الإصلاح (مطابق لـ docs/EMAIL-SETUP.md). */
export function explainMailError(msg) {
  const m = String(msg || '');
  if (/graph token (400|401)/.test(m)) return 'معرّف التطبيق (MAIL_CLIENT_ID) أو السرّ (MAIL_CLIENT_SECRET) خاطئ أو منتهي الصلاحية.';
  if (/graph token/.test(m)) return 'تعذّر الحصول على رمز Microsoft: تحقق من MAIL_CLIENT_ID وMAIL_CLIENT_SECRET ومعرّف المستأجر.';
  if (/graph send 403/.test(m)) return 'لم تُمنح موافقة المسؤول على صلاحية Mail.Send، أو سياسة حصر التطبيق لا تشمل الصندوق (قد يستغرق التطبيق حتى 30 دقيقة).';
  if (/graph send 404/.test(m)) return 'عنوان الإرسال (MAIL_FROM) غير موجود في Exchange.';
  if (/graph send 401/.test(m)) return 'رفض Microsoft الرمز: أعد المحاولة، وإن تكرر فتحقق من السرّ.';
  if (/graph send 429/.test(m)) return 'Microsoft تحدّ من الإرسال مؤقتاً؛ أعد المحاولة بعد دقائق.';
  if (/resend (401|403)/.test(m)) return 'مفتاح Resend خاطئ أو نطاق الإرسال غير موثَّق عندهم.';
  if (/resend/.test(m)) return 'رفضت خدمة Resend الرسالة؛ راجع المفتاح والنطاق.';
  return 'تعذّر الإرسال لسبب غير معروف؛ راجع سجل التدقيق (mail.failed).';
}

export function registerMailStatus(add, kit) {
  const { forbidden, auditStmt } = kit;

  add('GET', '/api/settings/mail', async ({ env, db, user }) => {
    if (!can(user, 'settings.write')) return forbidden();
    const mailer = mailerFor(env);
    const present = MAIL_VARS.filter((k) => String(env[k] || '').trim());
    const partial = present.length > 0 && present.length < MAIL_VARS.length && !mailer;
    const failures = (await db.prepare("SELECT at, entity, entity_id AS entityId, detail FROM audit_log WHERE action = 'mail.failed' ORDER BY id DESC LIMIT 5").all()).results.map((r) => {
      let error = '';
      try { error = JSON.parse(r.detail || '{}').error || ''; } catch { /* نص عادي */ }
      return { at: r.at, what: r.entity, id: r.entityId, error, hint: explainMailError(error) };
    });
    return json({
      ok: true,
      configured: !!mailer,
      provider: mailer ? mailer.kind || 'custom' : null,
      from: mailer ? String(env.MAIL_FROM || '').trim() : null,
      missing: mailer ? [] : (partial ? MAIL_VARS.filter((k) => !present.includes(k)) : MAIL_VARS),
      partial,
      authSecret: !!String(env.AUTH_SECRET || '').trim(),
      failures,
    });
  });

  add('POST', '/api/settings/mail/test', async ({ env, db, user }) => {
    if (!can(user, 'settings.write')) return forbidden();
    const mailer = mailerFor(env);
    if (!mailer) return json({ ok: false, error: 'البريد غير مُعدّ بعد: أضف المتغيرات الناقصة في Cloudflare أولاً.' }, 400);
    if (!user.email) return json({ ok: false, error: 'حسابك بلا بريد.' }, 400);
    // لا أكثر من رسالة تجريبية كل 30 ثانية (حماية من الضغط المتكرر)
    const recent = await db.prepare("SELECT 1 FROM audit_log WHERE action IN ('mail.test', 'mail.test.failed') AND actor = ? AND at > datetime('now', '-30 seconds') LIMIT 1").bind(user.email).first();
    if (recent) return json({ ok: false, error: 'انتظر نصف دقيقة قبل تجربة أخرى.' }, 429);
    const subject = 'رسالة تجريبية — نظام الحضور والطلبات';
    const text = 'وصلتك هذه الرسالة لأن إرسال البريد في نظام الحضور والطلبات (جمعية نوى) يعمل. لا إجراء مطلوب.';
    const html = '<div dir="rtl" lang="ar" style="font-family:Segoe UI,Tahoma,Arial,sans-serif;max-width:420px;margin:auto;padding:22px;border:1px solid #e6dccf;border-radius:14px;color:#2a1410"><p style="margin:0 0 8px;font-weight:700">إرسال البريد يعمل ✓</p><p style="margin:0;color:#5a4a45">هذه رسالة تجريبية من نظام الحضور والطلبات — جمعية نوى للثقافة والفنون. لا إجراء مطلوب.</p></div>';
    try {
      await mailer.send({ to: user.email, subject, text, html });
    } catch (e) {
      const error = String(e?.message || e).slice(0, 200);
      await auditStmt(db, user, 'mail.test.failed', 'mail', null, { error }).run().catch(() => {});
      return json({ ok: false, error: explainMailError(error), detail: error }, 502);
    }
    await auditStmt(db, user, 'mail.test', 'mail', null, { to: user.email }).run().catch(() => {});
    return json({ ok: true, to: user.email });
  });
}
