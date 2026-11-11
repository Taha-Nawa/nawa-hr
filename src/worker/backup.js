/**
 * النسخة الاحتياطية خارج Cloudflare (قرار 2 نوفمبر 2026).
 *
 * D1 يحتفظ بسجل استرجاع (Time Travel) لثلاثين يوماً داخل Cloudflare نفسه، وهذا لا يغني عن نسخة في مكان آخر
 * تحت يد الجمعية. هنا تصدير كامل للبيانات يُسحب جدولاً جدولاً على دفعات صغيرة (حدود الخطة المجانية: 10ms CPU و50 استعلاماً
 * للطلب الواحد، فلا نبني الملف كله في طلب واحد) ويجمعه المتصفح أو السكربت (tools/backup.mjs) في ملف واحد.
 *
 *  - مسؤول النظام فقط (جلسة)، أو سكربت دوري برمز BACKUP_TOKEN (سرّ في Cloudflare، 24 حرفاً فأكثر؛ غيابه يعطّل المسار).
 *  - لا أسرار في النسخة: لا جلسات ولا رموز PIN ولا رموز بريد ولا أجهزة موثوقة ولا مفاتيح التشفير، ولا بصمة رمز الجهاز.
 *    (الجداول المستبعدة صراحةً في BACKUP_EXCLUDED، واختبار يمنع إضافة جدول جديد دون أن يُصنَّف في إحداهما.)
 *  - النسخة تحوي بيانات شخصية (أسماء، بريد، حضور): تُحفظ في مكان مقيَّد.
 */
import { json, sha256hex, nowOf } from './util.js';
import { can } from './authz.js';
import { currentUser } from './auth.js';
import { mailerFor, logMailFailure } from './mail.js';

// الترتيب: الجداول الأصلية قبل التي تشير إليها (لاسترجاع بمفاتيح أجنبية).
export const BACKUP_TABLES = [
  'centers', 'employees', 'badges', 'devices', 'users', 'settings', 'holidays', 'employee_projects',
  'day_overrides', 'requests', 'leave_balances', 'emergencies', 'leave_plans', 'leave_plan_days', 'leave_released',
  'volunteers', 'volunteer_days', 'volunteer_badges', 'volunteer_movements', 'providers', 'provider_schedule', 'provider_badges', 'provider_movements', 'monthly_reports', 'daily_results', 'movements', 'unclosed_dismissed', 'work_exceptions', 'employee_history', 'audit_log',
];
// work_log: ملاحظات عمل يومية خاصة بأصحابها (قرار 6.19) ومسودات التقارير خاصة بأصحابها أيضاً: لا تدخل ملفاً يحمله المسؤول.
// تبقى محمية بسجل الاسترجاع الزمني (Time Travel) داخل Cloudflare 30 يوماً؛ وما قدّمه الموظف من تقارير يُنسخ.
export const BACKUP_EXCLUDED = ['sessions', 'auth_nonces', 'trusted_devices', 'user_pins', 'email_codes', 'auth_meta', 'work_log', 'report_reminders', 'provider_alerts'];
// جداول تُنسخ جزئياً: شرط SQL ثابت (لا مدخلات مستخدم) يطبَّق على العدّ والصفحات معاً.
export const BACKUP_FILTERS = { monthly_reports: "status = 'submitted'" };
// أعمدة لا تُصدَّر (بصمات رموز). بعد الاسترجاع تُعاد إصدار رموز الأجهزة من صفحة «أجهزة البوابة».
export const HIDDEN_COLUMNS = { devices: ['token_hash'] };

const PAGE_DEFAULT = 1000;
const PAGE_MAX = 2000;
const STALE_DAYS = 7;
const REMIND_AFTER_DAYS = 14;
const REMIND_EVERY_DAYS = 7;
const MIN_TOKEN = 24;

const q = (name) => `"${name}"`;
const source = (name) => `${q(name)}${BACKUP_FILTERS[name] ? ` WHERE ${BACKUP_FILTERS[name]}` : ''}`;

/** من يطلب؟ سكربت برمز، أو مسؤول بجلسة. يُرجع { actor } أو { error: Response }. */
async function authorize({ request, env, db }) {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '');
  if (m) {
    const want = env.BACKUP_TOKEN;
    if (!want || want.length < MIN_TOKEN) return { error: json({ ok: false, error: 'تصدير السكربت غير مفعَّل (لم يُضبط BACKUP_TOKEN)' }, 401) };
    const [a, b] = await Promise.all([sha256hex(m[1]), sha256hex(want)]);
    return a === b ? { actor: { email: 'backup-token', token: true } } : { error: json({ ok: false, error: 'رمز غير صالح' }, 401) };
  }
  const user = await currentUser(db, request);
  if (!user) return { error: json({ ok: false, error: 'سجّل الدخول أولاً' }, 401) };
  if (!can(user, 'backup.export')) return { error: json({ ok: false, error: 'لا تملك صلاحية هذا الإجراء' }, 403) };
  return { actor: user };
}

async function loadState(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'backup'").first();
  try {
    const v = JSON.parse(row?.value || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

const saveState = (db, state) =>
  db.prepare("INSERT INTO settings (key, value) VALUES ('backup', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(JSON.stringify(state));

const daysSince = (iso, now) => (iso ? Math.floor((now.getTime() - Date.parse(iso)) / 86400000) : null);

function describe(state, now) {
  const last = state.last || null;
  const age = daysSince(last?.at, now);
  return { last, daysSince: age, due: last === null || age >= STALE_DAYS };
}

export function registerBackupRoutes(add, kit) {
  const { bad, auditStmt } = kit;

  add('GET', '/api/backup/status', async (ctx) => {
    const a = await authorize(ctx);
    if (a.error) return a.error;
    return json({ ok: true, ...describe(await loadState(ctx.db), nowOf(ctx.env)), tokenEnabled: (ctx.env.BACKUP_TOKEN || '').length >= MIN_TOKEN, staleDays: STALE_DAYS });
  }, { auth: false });

  // أسماء الجداول وعدد صفوفها (20 استعلاماً + حالة النسخة: داخل حد الـ50)
  add('GET', '/api/backup/manifest', async (ctx) => {
    const a = await authorize(ctx);
    if (a.error) return a.error;
    const counts = await Promise.all(BACKUP_TABLES.map((t) => ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${source(t)}`).first('n')));
    return json({
      ok: true, app: 'nawa-hr', generatedAt: nowOf(ctx.env).toISOString(), pageSize: PAGE_DEFAULT,
      tables: BACKUP_TABLES.map((name, i) => ({ name, rows: counts[i] })),
      hidden: HIDDEN_COLUMNS,
    });
  }, { auth: false });

  // صفحة من جدول: أعمدة + صفوف كمصفوفات مرتبة بالمفتاح الأساسي (ترقيم بالإزاحة؛ الجداول صغيرة نسبياً)
  add('GET', '/api/backup/table', async (ctx) => {
    const a = await authorize(ctx);
    if (a.error) return a.error;
    const name = ctx.url.searchParams.get('name');
    if (!BACKUP_TABLES.includes(name)) return bad('جدول غير معروف');
    const offset = Number(ctx.url.searchParams.get('offset') ?? 0);
    const limit = Number(ctx.url.searchParams.get('limit') ?? PAGE_DEFAULT);
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > PAGE_MAX) return bad('الإزاحة أو الحجم غير صالح');
    const info = (await ctx.db.prepare('SELECT name, pk FROM pragma_table_info(?) ORDER BY cid').bind(name).all()).results;
    const hidden = HIDDEN_COLUMNS[name] || [];
    const columns = info.map((c) => c.name).filter((c) => !hidden.includes(c));
    const pk = info.filter((c) => c.pk > 0).sort((x, y) => x.pk - y.pk).map((c) => q(c.name));
    const order = pk.length ? pk.join(', ') : 'rowid';
    const res = await ctx.db.prepare(`SELECT ${columns.map(q).join(', ')} FROM ${source(name)} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(limit + 1, offset).all();
    const more = res.results.length > limit;
    const rows = res.results.slice(0, limit).map((r) => columns.map((c) => r[c]));
    return json({ ok: true, name, columns, offset, rows, done: !more });
  }, { auth: false });

  // تسجيل أن نسخة كاملة اكتملت (المتصفح أو السكربت بعد سحب كل الجداول)
  add('POST', '/api/backup/done', async (ctx) => {
    const a = await authorize(ctx);
    if (a.error) return a.error;
    const { body, error } = await kit.readJson(ctx.request);
    if (error) return error;
    const rows = Number(body.rows);
    const tables = Number(body.tables);
    if (!Number.isInteger(rows) || rows < 0 || !Number.isInteger(tables) || tables < 1) return bad('بيانات النسخة غير صالحة');
    const now = nowOf(ctx.env);
    const state = await loadState(ctx.db);
    const last = { at: now.toISOString(), by: a.actor.email, via: a.actor.token ? 'script' : 'browser', rows, tables };
    await ctx.db.batch([saveState(ctx.db, { ...state, last }), auditStmt(ctx.db, a.actor, 'backup.export', 'backup', null, { rows, tables, via: last.via })]);
    return json({ ok: true, last });
  }, { auth: false });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function reminderMessage(info, origin) {
  const never = info.last === null;
  const subject = never ? 'تذكير: لم تُؤخذ نسخة احتياطية من بيانات الحضور بعد' : `تذكير: آخر نسخة احتياطية قبل ${info.daysSince} يوماً`;
  const body = never
    ? 'بيانات الحضور محفوظة في Cloudflare فقط، ولا توجد نسخة عندكم خارجها.'
    : `آخر نسخة احتياطية أُخذت قبل ${info.daysSince} يوماً (${String(info.last.at).slice(0, 10)}).`;
  const link = `${origin}/#/backup`;
  const text = `${subject}\n\n${body}\nافتح صفحة «النسخ الاحتياطي» ونزّل نسخة كاملة (دقيقة واحدة): ${link}\n— نظام نوى للشؤون الإدارية، جمعية نوى للثقافة والفنون`;
  const html = `<div dir="rtl" lang="ar" style="font-family:Segoe UI,Tahoma,Arial,sans-serif;max-width:480px;margin:auto;padding:22px;border:1px solid #e6dccf;border-radius:14px;color:#2a1410">
<p style="margin:0 0 12px;font-weight:700;font-size:16px">${esc(subject)}</p>
<p style="margin:0 0 14px;color:#5a4a45">${esc(body)}</p>
<p style="margin:0 0 16px"><a href="${esc(link)}" style="display:inline-block;background:#a21008;color:#fff;text-decoration:none;padding:9px 18px;border-radius:9px;font-weight:700">تنزيل نسخة كاملة</a></p>
<p style="margin:0;color:#72655f;font-size:12px">نظام نوى للشؤون الإدارية — جمعية نوى للثقافة والفنون</p></div>`;
  return { subject, text, html };
}

/** من cron الليلي: بريد لمسؤولي النظام إن مضى على آخر نسخة 14 يوماً (أو لا نسخة)، وبحد أقصى مرة كل 7 أيام. */
export async function backupReminder(env, { origin = 'https://nawa-hr.nawa-attendance.workers.dev', now = nowOf(env) } = {}) {
  const db = env.DB;
  const state = await loadState(db);
  const info = describe(state, now);
  if (!(info.last === null || info.daysSince >= REMIND_AFTER_DAYS)) return { sent: 0, reason: 'fresh' };
  if (state.remindedAt && daysSince(state.remindedAt, now) < REMIND_EVERY_DAYS) return { sent: 0, reason: 'recent' };
  const mailer = mailerFor(env);
  if (!mailer) return { sent: 0, reason: 'no_mail' };
  const to = (await db.prepare("SELECT email FROM users WHERE active = 1 AND role = 'admin'").all()).results.map((r) => r.email);
  if (!to.length) return { sent: 0, reason: 'no_recipients' };
  const m = reminderMessage(info, origin);
  let ok = 0;
  let failed = null;
  for (const addr of to.slice(0, 5)) {
    try { await mailer.send({ to: addr, ...m }); ok += 1; } catch (e) { failed ||= e; }
  }
  if (failed) await logMailFailure(db, 'backup.reminder', 'backup', failed);
  if (ok) await saveState(db, { ...state, remindedAt: now.toISOString() }).run();
  return { sent: ok };
}
