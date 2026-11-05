/**
 * طرق الدخول الإضافية (إلى جانب Microsoft):
 *
 *  1) «تذكّر هذا الجهاز»: كوكي `__Host-nawa-d` (30 يوماً، ينزلق مع الاستعمال) يُدخل المستخدم بلا أي خطوة،
 *     أو يطلب PIN فقط (فتح سريع). تسجيل الخروج الصريح يُبقي الجهاز لكن يعرض «متابعة كـ…» بدل الدخول التلقائي.
 *  2) رمز تحقق من 6 أرقام يُرسَل إلى البريد المؤسسي (10 دقائق، مرة واحدة، 5 محاولات).
 *  3) البريد + PIN من 6 أرقام (قفل تصاعدي بعد 5 محاولات خاطئة).
 *
 * قواعد الأمان:
 *  - لا نخزّن PIN ولا رمزاً ولا رمز جهاز كما هو: HMAC-SHA256 بملح لكل صف ومفتاح سري (AUTH_SECRET، وإلا مفتاح عشوائي في auth_meta).
 *  - عدّ المحاولات «تشاؤمي» وذرّي (يُزاد العدّاد في نفس الاستعلام الذي يمنح حق المحاولة) فلا يُخمَّن بطلبات متوازية.
 *  - ردود لا تكشف هل البريد مسجّل (طلب الرمز يردّ بنفس الجملة دائماً).
 *  - تعيين PIN جديد أو تغييره بلا PIN حالي يتطلب جلسة «قوية» (Microsoft أو رمز بريد)، فلا يكفي جهاز مسروق لزرع PIN.
 *  - رمز الجهاز وPIN يُحذفان فوراً عند إيقاف الحساب أو إعادة ضبط الدخول.
 */
import { json, randomToken, sha256hex, nowOf, clip } from './util.js';
import { createSession, cookieHeader, readCookie, ssoConfig, userForEmail, COOKIE } from './auth.js';
import { mailerFor, mailConfigured, codeMessage } from './mail.js';

export const DEVICE_COOKIE = '__Host-nawa-d';
export const DEVICE_DAYS = 30;
const MAX_DEVICES = 10;
const PIN_MAX_FAILS = 5;
const LOCK_BASE_MIN = 15;
const LOCK_MAX_MIN = 24 * 60;
export const CODE_MINUTES = 10;
const CODE_MAX_ATTEMPTS = 5;
const CODE_COOLDOWN_S = 60;
const CODE_PER_HOUR = 5;
const MAIL_PER_HOUR = 60;
const STRONG = new Set(['microsoft', 'code']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const stamp = (d) => d.toISOString().replace('T', ' ').slice(0, 19);
const iso = (s) => (s ? `${s.replace(' ', 'T')}Z` : null);
const te = new TextEncoder();

// ---------------------------------------------------------------- تشفير
const peppers = new WeakMap();
async function pepperOf(env) {
  const fromEnv = (env.AUTH_SECRET || '').trim();
  if (fromEnv.length >= 16) return fromEnv;
  const cached = peppers.get(env.DB);
  if (cached) return cached;
  let row = await env.DB.prepare("SELECT value FROM auth_meta WHERE key = 'pepper'").first();
  if (!row) {
    await env.DB.prepare("INSERT OR IGNORE INTO auth_meta (key, value) VALUES ('pepper', ?)").bind(randomToken(32)).run();
    row = await env.DB.prepare("SELECT value FROM auth_meta WHERE key = 'pepper'").first();
  }
  peppers.set(env.DB, row.value);
  return row.value;
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, te.encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** 6 أرقام موزّعة بانتظام (رفض العيّنات المنحازة). */
export function randomCode() {
  const limit = 4_294_000_000; // أكبر مضاعف للمليون ضمن 2^32
  const a = new Uint32Array(1);
  do crypto.getRandomValues(a); while (a[0] >= limit);
  return String(a[0] % 1_000_000).padStart(6, '0');
}

/** يُرجع سبب الرفض أو null. */
export function pinProblem(pin) {
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) return 'يجب أن يتكوّن الـ PIN من 6 أرقام';
  const easy = 'اختر رقماً أصعب على التخمين';
  if (/^(\d)\1{5}$/.test(pin)) return `${easy} (لا تكرّر رقماً واحداً)`;
  const d = [...pin].map(Number);
  const step = d[1] - d[0];
  if ((step === 1 || step === -1) && d.every((x, i) => i === 0 || x - d[i - 1] === step)) return `${easy} (لا تستعمل أرقاماً متتالية)`;
  if (/^(\d\d)\1\1$/.test(pin) || /^(\d\d\d)\1$/.test(pin)) return `${easy} (لا تكرّر نمطاً قصيراً)`;
  return null;
}

const normEmail = (v) => {
  const e = clip(v, 254)?.toLowerCase();
  return e && EMAIL_RE.test(e) ? e : null;
};

function deviceLabel(ua = '') {
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Macintosh|Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'جهاز';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${os} · ${br}` : os;
}

export const deviceCookie = (token, maxAge) => `${DEVICE_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const clearDeviceCookie = () => deviceCookie('', 0);

const tokenOk = (t) => typeof t === 'string' && t.length >= 32 && t.length <= 200;

// ---------------------------------------------------------------- PIN مع قفل
/**
 * يتحقق من PIN بعدٍّ ذرّي: لا يُسمح بأكثر من 5 محاولات بين كل قفلين مهما كثرت الطلبات المتوازية.
 * القفل 15 دقيقة، ويتضاعف مع كل قفل متتالٍ (حتى 24 ساعة) ويُصفَّر بنجاح واحد.
 * @returns {{ok:true}|{ok:false, reason:'none'|'wrong'|'locked', retryAfter?:number, justLocked?:boolean}}
 */
async function tryPin(env, userId, pin, now) {
  const db = env.DB;
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
    await hmacHex(await pepperOf(env), 'dummy'); // زمن متقارب
    return { ok: false, reason: 'wrong' };
  }
  const pre = await db.prepare('SELECT strikes FROM user_pins WHERE user_id = ?').bind(userId).first();
  if (!pre) {
    await hmacHex(await pepperOf(env), 'dummy');
    return { ok: false, reason: 'none' };
  }
  const mins = Math.min(LOCK_BASE_MIN * 2 ** Math.min(pre.strikes, 10), LOCK_MAX_MIN);
  const lockUntil = stamp(new Date(now.getTime() + mins * 60_000));
  const next = 'CASE WHEN failures >= ?1 THEN 1 ELSE failures + 1 END';
  const r = await db
    .prepare(
      `UPDATE user_pins SET
         failures = ${next},
         locked_until = CASE WHEN ${next} >= ?1 THEN ?2 ELSE NULL END,
         strikes = CASE WHEN ${next} >= ?1 THEN strikes + 1 ELSE strikes END
       WHERE user_id = ?3 AND (failures < ?1 OR locked_until IS NULL OR locked_until <= ?4)
       RETURNING salt, pin_hash, failures`,
    )
    .bind(PIN_MAX_FAILS, lockUntil, userId, stamp(now))
    .all();
  if (!r.results.length) {
    const row = await db.prepare('SELECT locked_until FROM user_pins WHERE user_id = ?').bind(userId).first();
    if (!row) return { ok: false, reason: 'none' };
    const retryAfter = Math.max(1, Math.ceil((Date.parse(`${row.locked_until.replace(' ', 'T')}Z`) - now.getTime()) / 1000));
    return { ok: false, reason: 'locked', retryAfter };
  }
  const { salt, pin_hash: hash, failures } = r.results[0];
  if (safeEqual(hash, await hmacHex(await pepperOf(env), `pin:${userId}:${salt}:${pin}`))) {
    await db.prepare('UPDATE user_pins SET failures = 0, strikes = 0, locked_until = NULL WHERE user_id = ?').bind(userId).run();
    return { ok: true };
  }
  if (failures >= PIN_MAX_FAILS) return { ok: false, reason: 'locked', retryAfter: mins * 60, justLocked: true };
  return { ok: false, reason: 'wrong' };
}

// ---------------------------------------------------------------- الأجهزة
async function lookupDevice(ctx) {
  const token = readCookie(ctx.request, DEVICE_COOKIE);
  if (!tokenOk(token)) return null;
  const row = await ctx.db
    .prepare(
      `SELECT d.id, d.user_id AS userId, d.auto, d.pin_required AS pinRequired, u.email, u.role, e.name AS employeeName, e.photo_url AS photo, (p.user_id IS NOT NULL) AS hasPin
       FROM trusted_devices d JOIN users u ON u.id = d.user_id AND u.active = 1
       LEFT JOIN employees e ON e.id = u.employee_id LEFT JOIN user_pins p ON p.user_id = u.id
       WHERE d.token_hash = ? AND d.expires_at >= ?`,
    )
    .bind(await sha256hex(token), stamp(nowOf(ctx.env)))
    .first();
  return row ? { ...row, token } : null;
}

/** يسجّل جهازاً جديداً (ويستبدل الكوكي القديم إن وُجد). يُرجع ترويسة Set-Cookie. */
async function issueDevice(ctx, userId, { pinRequired = false } = {}) {
  const { db, env, request } = ctx;
  const now = nowOf(env);
  const old = readCookie(request, DEVICE_COOKIE);
  const token = randomToken(32);
  const stmts = [];
  if (tokenOk(old)) stmts.push(db.prepare('DELETE FROM trusted_devices WHERE token_hash = ?').bind(await sha256hex(old)));
  stmts.push(
    db.prepare('DELETE FROM trusted_devices WHERE user_id = ?1 AND id NOT IN (SELECT id FROM trusted_devices WHERE user_id = ?1 ORDER BY last_used_at DESC, id DESC LIMIT ?2)').bind(userId, MAX_DEVICES - 1),
    db.prepare('DELETE FROM trusted_devices WHERE expires_at < ?').bind(stamp(now)),
    db
      .prepare('INSERT INTO trusted_devices (user_id, token_hash, label, auto, pin_required, created_at, last_used_at, expires_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?)')
      .bind(userId, await sha256hex(token), deviceLabel(request.headers.get('user-agent') || ''), pinRequired ? 1 : 0, stamp(now), stamp(now), stamp(new Date(now.getTime() + DEVICE_DAYS * 86400_000))),
  );
  await db.batch(stmts);
  return deviceCookie(token, DEVICE_DAYS * 86400);
}

/** عبارات SQL لإنهاء كل أشكال دخول مستخدم (إعادة ضبط من المسؤول). */
export function resetLoginStatements(db, userId) {
  return [
    db.prepare('DELETE FROM user_pins WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM trusted_devices WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
  ];
}

// ---------------------------------------------------------------- المسارات
export function registerLoginRoutes(add, kit) {
  const { bad, readJson, auditStmt } = kit;

  const lockedMsg = (retryAfter) => `توقفت المحاولات مؤقتاً بعد إدخال خاطئ متكرر. حاول بعد ${Math.ceil(retryAfter / 60)} دقيقة، أو ادخل برمز البريد أو بحساب Microsoft.`;
  const pinFail = async (ctx, r, who, generic = 'البريد أو الـ PIN غير صحيح') => {
    if (r.reason === 'locked') {
      if (r.justLocked) await auditStmt(ctx.db, who, 'auth.pin.locked', 'user', who.id, null).run().catch(() => {});
      return json({ ok: false, error: lockedMsg(r.retryAfter), code: 'locked', retryAfter: r.retryAfter }, 429);
    }
    return json({ ok: false, error: generic, code: 'bad_credentials' }, 401);
  };

  /** ينشئ الجلسة (وكوكي الجهاز إن طُلب التذكّر) ويكتب سجل التدقيق. */
  async function establish(ctx, user, via, { remember = false, pinRequired = false } = {}) {
    const s = await createSession(ctx.db, user.id, via);
    await auditStmt(ctx.db, user, 'login', 'user', user.id, via === 'microsoft' ? null : { via }).run();
    const res = json({ ok: true, user: { email: user.email, role: user.role } });
    res.headers.append('set-cookie', cookieHeader(s.token, s.maxAge));
    if (remember) res.headers.append('set-cookie', await issueDevice(ctx, user.id, { pinRequired }));
    return res;
  }

  // ---- ما المتاح في هذا النشر (يقرؤه المتصفح قبل رسم شاشة الدخول)
  add('GET', '/api/auth/config', async ({ env }) => json({ ok: true, sso: !!ssoConfig(env), pin: true, code: mailConfigured(env), rememberDays: DEVICE_DAYS }), { auth: false });

  // ---- الجهاز المتذكَّر (إن وُجد) لعرض «مرحباً بعودتك»
  add('GET', '/api/auth/device', async (ctx) => {
    const d = await lookupDevice(ctx);
    if (!d) return json({ ok: true, known: false });
    const pinRequired = !!d.pinRequired && !!d.hasPin;
    return json({ ok: true, known: true, name: d.employeeName || d.email.split('@')[0], email: d.email, photo: d.photo || null, pinRequired, auto: !!d.auto && !pinRequired });
  }, { auth: false });

  add('POST', '/api/auth/resume', async (ctx) => {
    const { request, db, env } = ctx;
    const { body, error } = await readJson(request);
    if (error) return error;
    const d = await lookupDevice(ctx);
    if (!d) {
      const res = json({ ok: false, error: 'انتهت صلاحية هذا الجهاز، سجّل الدخول من جديد', code: 'no_device' }, 401);
      if (readCookie(request, DEVICE_COOKIE)) res.headers.append('set-cookie', clearDeviceCookie());
      return res;
    }
    const pinNeeded = !!d.pinRequired && !!d.hasPin;
    if (pinNeeded) {
      const r = await tryPin(env, d.userId, body.pin, nowOf(env));
      if (!r.ok) return pinFail(ctx, r, { id: d.userId, email: d.email }, 'الـ PIN غير صحيح');
    }
    const now = nowOf(env);
    await db.prepare('UPDATE trusted_devices SET auto = 1, last_used_at = ?, expires_at = ? WHERE id = ?').bind(stamp(now), stamp(new Date(now.getTime() + DEVICE_DAYS * 86400_000)), d.id).run();
    const s = await createSession(db, d.userId, pinNeeded ? 'pin' : 'device');
    await auditStmt(db, { email: d.email }, 'login', 'user', d.userId, { via: pinNeeded ? 'pin' : 'device' }).run();
    const res = json({ ok: true, user: { email: d.email, role: d.role } });
    res.headers.append('set-cookie', cookieHeader(s.token, s.maxAge));
    res.headers.append('set-cookie', deviceCookie(d.token, DEVICE_DAYS * 86400)); // ينزلق الأجل مع كل استعمال
    return res;
  }, { auth: false });

  // ---- البريد + PIN
  add('POST', '/api/auth/pin', async (ctx) => {
    const { request, db, env } = ctx;
    const { body, error } = await readJson(request);
    if (error) return error;
    const email = normEmail(body.email);
    const user = email && (await userForEmail(db, email));
    if (!user) {
      await tryPin(env, 0, body.pin, nowOf(env)); // نفس العمل تقريباً: لا يُكشف وجود الحساب بالزمن
      return json({ ok: false, error: 'البريد أو الـ PIN غير صحيح', code: 'bad_credentials' }, 401);
    }
    const r = await tryPin(env, user.id, body.pin, nowOf(env));
    if (!r.ok) return pinFail(ctx, r, user);
    return establish(ctx, user, 'pin', { remember: body.remember === true, pinRequired: true });
  }, { auth: false });

  // ---- رمز التحقق بالبريد
  add('POST', '/api/auth/code/request', async (ctx) => {
    const { request, db, env } = ctx;
    const mailer = mailerFor(env);
    if (!mailer) return bad('إرسال الرمز بالبريد غير مفعّل بعد، استعمل طريقة دخول أخرى', 503);
    const { body, error } = await readJson(request);
    if (error) return error;
    const email = normEmail(body.email);
    if (!email) return bad('اكتب بريدك المؤسسي بشكل صحيح');
    const generic = () => json({ ok: true, cooldown: CODE_COOLDOWN_S, minutes: CODE_MINUTES });
    const user = await userForEmail(db, email);
    if (!user) return generic();

    const now = nowOf(env);
    const hourAgo = stamp(new Date(now.getTime() - 3600_000));
    const st = await db
      .prepare('SELECT (SELECT COUNT(*) FROM email_codes WHERE email = ?1 AND created_at >= ?2) AS mine, (SELECT MAX(created_at) FROM email_codes WHERE email = ?1) AS last, (SELECT COUNT(*) FROM email_codes WHERE created_at >= ?2) AS total')
      .bind(email, hourAgo)
      .first();
    if (st.total >= MAIL_PER_HOUR) return bad('الخدمة مشغولة الآن، حاول بعد قليل', 429);
    const sinceLast = st.last ? now.getTime() - Date.parse(`${st.last.replace(' ', 'T')}Z`) : Infinity;
    if (st.mine >= CODE_PER_HOUR || sinceLast < CODE_COOLDOWN_S * 1000) return generic(); // لا إرسال ولا كشف

    const code = randomCode();
    const salt = randomToken(12);
    const hash = await hmacHex(await pepperOf(env), `code:${email}:${salt}:${code}`);
    await db.batch([
      db.prepare('UPDATE email_codes SET used = 1 WHERE email = ? AND used = 0').bind(email),
      db.prepare('INSERT INTO email_codes (email, salt, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind(email, salt, hash, stamp(new Date(now.getTime() + CODE_MINUTES * 60_000)), stamp(now)),
      db.prepare('DELETE FROM email_codes WHERE created_at < ?').bind(stamp(new Date(now.getTime() - 86400_000))),
    ]);
    const msg = codeMessage(code, CODE_MINUTES);
    const sending = mailer.send({ to: email, ...msg }).catch(async (e) => {
      console.error('mail failed:', e?.message || e);
      await auditStmt(db, null, 'mail.failed', 'user', email, { error: String(e?.message || e).slice(0, 200) }).run().catch(() => {});
    });
    // في الإنتاج يُرسَل بعد الرد (نفس زمن الرد للبريد المسجّل وغير المسجّل)؛ في الاختبارات ننتظره.
    if (ctx.defer) await ctx.defer(sending);
    return generic();
  }, { auth: false });

  add('POST', '/api/auth/code/verify', async (ctx) => {
    const { request, db, env } = ctx;
    const { body, error } = await readJson(request);
    if (error) return error;
    const email = normEmail(body.email);
    const code = typeof body.code === 'string' ? body.code.replace(/\s/g, '') : '';
    const fail = () => json({ ok: false, error: 'الرمز غير صحيح أو منتهي. اطلب رمزاً جديداً وحاول مرة أخرى.', code: 'bad_code' }, 401);
    if (!email || !/^\d{6}$/.test(code)) return fail();
    const now = nowOf(env);
    const row = await db.prepare('SELECT id FROM email_codes WHERE email = ? AND used = 0 AND expires_at >= ? ORDER BY id DESC LIMIT 1').bind(email, stamp(now)).first();
    if (!row) return fail();
    const r = await db.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ? AND used = 0 AND attempts < ? RETURNING salt, code_hash').bind(row.id, CODE_MAX_ATTEMPTS).all();
    if (!r.results.length) return fail();
    const { salt, code_hash: hash } = r.results[0];
    if (!safeEqual(hash, await hmacHex(await pepperOf(env), `code:${email}:${salt}:${code}`))) return fail();
    const claimed = await db.prepare('UPDATE email_codes SET used = 1 WHERE id = ? AND used = 0 RETURNING id').bind(row.id).all();
    if (!claimed.results.length) return fail();
    const user = await userForEmail(db, email);
    if (!user) return fail();
    return establish(ctx, user, 'code', { remember: body.remember === true });
  }, { auth: false });

  // ---- حسابي والأمان (بجلسة)
  add('GET', '/api/account', async (ctx) => {
    const { db, env, user, request } = ctx;
    const cur = readCookie(request, DEVICE_COOKIE);
    const curHash = tokenOk(cur) ? await sha256hex(cur) : null;
    const [pin, devs] = await Promise.all([
      db.prepare('SELECT updated_at AS updatedAt FROM user_pins WHERE user_id = ?').bind(user.id).first(),
      db
        .prepare('SELECT id, label, auto, pin_required AS pinRequired, created_at AS createdAt, last_used_at AS lastUsedAt, expires_at AS expiresAt, token_hash AS th FROM trusted_devices WHERE user_id = ? AND expires_at >= ? ORDER BY last_used_at DESC, id DESC')
        .bind(user.id, stamp(nowOf(env)))
        .all(),
    ]);
    return json({
      ok: true,
      account: {
        email: user.email, name: user.employeeName, role: user.role, via: user.via, strongSession: STRONG.has(user.via),
        pin: { set: !!pin, updatedAt: iso(pin?.updatedAt) },
        devices: devs.results.map((d) => ({ id: d.id, label: d.label, auto: !!d.auto, pinRequired: !!d.pinRequired, current: d.th === curHash, createdAt: iso(d.createdAt), lastUsedAt: iso(d.lastUsedAt), expiresAt: iso(d.expiresAt) })),
        codeAvailable: mailConfigured(env), rememberDays: DEVICE_DAYS,
      },
    });
  });

  /** هل يحق لهذه الجلسة تغيير/إزالة PIN؟ جلسة قوية، أو معرفة PIN الحالي. يُرجع Response عند الرفض. */
  async function mayChangePin(ctx, body, hasPin) {
    const { user, env } = ctx;
    if (STRONG.has(user.via)) return null;
    if (!hasPin) return json({ ok: false, code: 'need_login', error: 'لأمانك، تفعيل PIN يتطلب تسجيل دخول حديثاً: اخرج ثم ادخل بحساب Microsoft أو برمز البريد، ثم فعّله.' }, 403);
    if (typeof body.currentPin !== 'string' || !body.currentPin) return json({ ok: false, code: 'need_current', error: 'أدخل الـ PIN الحالي أولاً' }, 403);
    const r = await tryPin(env, user.id, body.currentPin, nowOf(env));
    return r.ok ? null : pinFail(ctx, r, user, 'الـ PIN الحالي غير صحيح');
  }

  add('POST', '/api/account/pin', async (ctx) => {
    const { request, db, env, user } = ctx;
    const { body, error } = await readJson(request);
    if (error) return error;
    const problem = pinProblem(body.pin);
    if (problem) return bad(problem);
    const had = await db.prepare('SELECT 1 AS x FROM user_pins WHERE user_id = ?').bind(user.id).first();
    const denied = await mayChangePin(ctx, body, !!had);
    if (denied) return denied;
    const salt = randomToken(12);
    const hash = await hmacHex(await pepperOf(env), `pin:${user.id}:${salt}:${body.pin}`);
    await db.batch([
      db
        .prepare(
          `INSERT INTO user_pins (user_id, salt, pin_hash, failures, strikes, locked_until, updated_at) VALUES (?, ?, ?, 0, 0, NULL, ?)
           ON CONFLICT(user_id) DO UPDATE SET salt = excluded.salt, pin_hash = excluded.pin_hash, failures = 0, strikes = 0, locked_until = NULL, updated_at = excluded.updated_at`,
        )
        .bind(user.id, salt, hash, stamp(nowOf(env))),
      auditStmt(db, user, had ? 'account.pin.change' : 'account.pin.set', 'user', user.id, null),
    ]);
    return json({ ok: true });
  });

  add('POST', '/api/account/pin/remove', async (ctx) => {
    const { request, db, user } = ctx;
    const { body, error } = await readJson(request);
    if (error) return error;
    const had = await db.prepare('SELECT 1 AS x FROM user_pins WHERE user_id = ?').bind(user.id).first();
    if (!had) return json({ ok: true });
    const denied = await mayChangePin(ctx, body, true);
    if (denied) return denied;
    const cur = readCookie(request, DEVICE_COOKIE);
    const curHash = tokenOk(cur) ? await sha256hex(cur) : null;
    const lost = curHash && (await db.prepare('SELECT 1 AS x FROM trusted_devices WHERE token_hash = ? AND user_id = ? AND pin_required = 1').bind(curHash, user.id).first());
    await db.batch([
      db.prepare('DELETE FROM user_pins WHERE user_id = ?').bind(user.id),
      db.prepare('DELETE FROM trusted_devices WHERE user_id = ? AND pin_required = 1').bind(user.id), // لا جهاز يبقى مرتبطاً بـ PIN محذوف
      auditStmt(db, user, 'account.pin.remove', 'user', user.id, null),
    ]);
    const res = json({ ok: true });
    if (lost) res.headers.append('set-cookie', clearDeviceCookie());
    return res;
  });

  add('POST', '/api/account/device', async (ctx) => {
    const { request, db, user } = ctx;
    const { body, error } = await readJson(request);
    if (error) return error;
    const cur = readCookie(request, DEVICE_COOKIE);
    const curHash = tokenOk(cur) ? await sha256hex(cur) : null;
    const mine = curHash && (await db.prepare('SELECT id FROM trusted_devices WHERE token_hash = ? AND user_id = ?').bind(curHash, user.id).first());
    if (body.remember === false) {
      if (mine) await db.batch([db.prepare('DELETE FROM trusted_devices WHERE id = ?').bind(mine.id), auditStmt(db, user, 'account.device.forget', 'user', user.id, null)]);
      const res = json({ ok: true });
      if (cur) res.headers.append('set-cookie', clearDeviceCookie());
      return res;
    }
    const pinRequired = body.pinRequired === true;
    if (pinRequired && !(await db.prepare('SELECT 1 AS x FROM user_pins WHERE user_id = ?').bind(user.id).first())) return bad('فعّل الـ PIN أولاً ثم اطلبه عند فتح التطبيق');
    const res = json({ ok: true });
    if (mine) {
      await db.prepare('UPDATE trusted_devices SET pin_required = ?, auto = 1 WHERE id = ?').bind(pinRequired ? 1 : 0, mine.id).run();
    } else {
      res.headers.append('set-cookie', await issueDevice(ctx, user.id, { pinRequired }));
      await auditStmt(db, user, 'account.device.remember', 'user', user.id, null).run();
    }
    return res;
  });

  add('POST', '/api/account/devices/:id/revoke', async (ctx) => {
    const { request, db, user, params } = ctx;
    const id = Number(params.id);
    const cur = readCookie(request, DEVICE_COOKIE);
    const curHash = tokenOk(cur) ? await sha256hex(cur) : null;
    const row = await db.prepare('SELECT token_hash AS th FROM trusted_devices WHERE id = ? AND user_id = ?').bind(id, user.id).first();
    if (!row) return json({ ok: true });
    await db.batch([db.prepare('DELETE FROM trusted_devices WHERE id = ? AND user_id = ?').bind(id, user.id), auditStmt(db, user, 'account.device.revoke', 'user', user.id, { id })]);
    const res = json({ ok: true });
    if (row.th === curHash) res.headers.append('set-cookie', clearDeviceCookie());
    return res;
  });

  /** «اخرج من كل الأجهزة»: كل الجلسات الأخرى وكل الأجهزة المتذكَّرة ما عدا الحالية. */
  add('POST', '/api/account/sign-out-others', async (ctx) => {
    const { request, db, user } = ctx;
    const cur = readCookie(request, DEVICE_COOKIE);
    const curHash = tokenOk(cur) ? await sha256hex(cur) : '';
    const session = await sha256hex(readCookie(request, COOKIE) || '');
    await db.batch([
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').bind(user.id, session),
      db.prepare('DELETE FROM trusted_devices WHERE user_id = ? AND token_hash <> ?').bind(user.id, curHash),
      auditStmt(db, user, 'account.sign-out-others', 'user', user.id, null),
    ]);
    return json({ ok: true });
  });

  return { establish };
}

export { clearDeviceCookie, lookupDevice };
