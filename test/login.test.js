import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE } from '../src/worker/auth.js';
import { DEVICE_COOKIE, pinProblem, randomCode } from '../src/worker/login.js';
import { codeMessage } from '../src/worker/mail.js';
import { sha256hex } from '../src/worker/util.js';
import { resetKeyCache } from '../src/worker/auth.js';
import { makeIssuer, stubJwks, TENANT } from './helpers/oidc.js';
import { apiEnv, call, addUser, login } from './helpers/api.js';

let stub;
afterEach(() => { stub?.restore(); resetKeyCache(); });

/** Set-Cookie المتعددة → { name: value } */
const cookiesOf = (r) => Object.fromEntries(r.res.headers.getSetCookie().map((c) => c.split(';')[0]).map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]));
const jar = (o) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');
const rawSetCookie = (r, name) => r.res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));

function fakeMailer() {
  const sent = [];
  return { sent, async send(m) { sent.push(m); }, last: () => sent.at(-1), code: () => sent.at(-1)?.text.match(/\b(\d{6})\b/)?.[1] };
}

async function setup({ mail = true } = {}) {
  const { db, env } = await apiEnv();
  const mailer = fakeMailer();
  if (mail) env.__MAILER = mailer;
  return { db, env, mailer };
}

/** موظف بجلسة قوية (microsoft) ثم PIN مضبوط. */
async function userWithPin(env, db, email = 'amna@nawaculture.org', pin = '482916', role = 'employee') {
  const u = await login(db, email, role);
  const r = await call(env, 'POST', '/api/account/pin', { cookie: u.cookie, body: { pin } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { ...u, email, pin };
}

const pinLogin = (env, email, pin, extra = {}) => call(env, 'POST', '/api/auth/pin', { body: { email, pin, ...extra } });

// ---------------------------------------------------------------- الإعدادات
test('/api/auth/config: رمز البريد يظهر فقط حين يُضبط البريد', async () => {
  const a = await setup({ mail: false });
  const off = await call(a.env, 'GET', '/api/auth/config');
  assert.deepEqual({ sso: off.body.sso, pin: off.body.pin, code: off.body.code }, { sso: true, pin: true, code: false });
  const b = await setup();
  assert.equal((await call(b.env, 'GET', '/api/auth/config')).body.code, true);
  // بلا بريد: طلب الرمز يُرفض بصراحة
  assert.equal((await call(a.env, 'POST', '/api/auth/code/request', { body: { email: 'x@nawaculture.org' } })).status, 503);
});

// ---------------------------------------------------------------- سياسة PIN
test('PIN: ستة أرقام فقط، وتُرفض الأنماط السهلة', () => {
  for (const bad of ['', '12345', '1234567', 'abcdef', '12 345', '111111', '000000', '123456', '654321', '121212', '123123', '987654', null, 482916]) assert.ok(pinProblem(bad), `يجب رفض ${bad}`);
  for (const good of ['482916', '907315', '360841']) assert.equal(pinProblem(good), null, good);
});

test('رمز البريد: 6 أرقام، موزّع على كامل المدى', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const c = randomCode();
    assert.match(c, /^\d{6}$/);
    seen.add(c[0]);
  }
  assert.ok(seen.size >= 9, 'الخانة الأولى تغطي معظم الأرقام');
});

// ---------------------------------------------------------------- تعيين PIN
test('تعيين PIN: جلسة قوية تكفي، وجلسة جهاز لا تكفي، وتغييره بجلسة ضعيفة يتطلب الحالي', async () => {
  const { db, env } = await setup();
  const strong = await login(db, 'amna@nawaculture.org', 'employee');

  assert.equal((await call(env, 'POST', '/api/account/pin', { cookie: strong.cookie, body: { pin: '111111' } })).status, 400);
  const set = await call(env, 'POST', '/api/account/pin', { cookie: strong.cookie, body: { pin: '482916' } });
  assert.equal(set.status, 200);

  // القاعدة لا تحمل PIN كما هو
  const row = await db.prepare('SELECT * FROM user_pins').first();
  assert.ok(!JSON.stringify(row).includes('482916'));
  assert.match(row.pin_hash, /^[0-9a-f]{64}$/);

  // جلسة «جهاز» (ضعيفة): لا تغيّر PIN بلا الحالي، وتغيّره به
  await db.prepare("UPDATE sessions SET via = 'device'").run();
  const weakNoCur = await call(env, 'POST', '/api/account/pin', { cookie: strong.cookie, body: { pin: '907315' } });
  assert.equal(weakNoCur.status, 403);
  assert.equal(weakNoCur.body.code, 'need_current');
  const weakBadCur = await call(env, 'POST', '/api/account/pin', { cookie: strong.cookie, body: { pin: '907315', currentPin: '000999' } });
  assert.equal(weakBadCur.status, 401);
  const weakOk = await call(env, 'POST', '/api/account/pin', { cookie: strong.cookie, body: { pin: '907315', currentPin: '482916' } });
  assert.equal(weakOk.status, 200);
  assert.equal((await pinLogin(env, 'amna@nawaculture.org', '907315')).status, 200);
  assert.equal((await pinLogin(env, 'amna@nawaculture.org', '482916')).status, 401, 'القديم لم يعد صالحاً');
});

test('جلسة جهاز لا تستطيع زرع أول PIN (حماية من جهاز مسروق)', async () => {
  const { db, env } = await setup();
  const u = await login(db, 'amna@nawaculture.org', 'employee');
  await db.prepare("UPDATE sessions SET via = 'device'").run();
  const r = await call(env, 'POST', '/api/account/pin', { cookie: u.cookie, body: { pin: '482916' } });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'need_login');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM user_pins').first()).n, 0);
});

// ---------------------------------------------------------------- الدخول بـ PIN
test('الدخول بالبريد + PIN: جلسة بكوكي آمن، وردود الخطأ لا تكشف وجود الحساب', async () => {
  const { db, env } = await setup();
  await userWithPin(env, db);
  await addUser(db, 'nopin@nawaculture.org', 'employee');

  const ok = await pinLogin(env, 'AMNA@nawaculture.org ', '482916');
  assert.equal(ok.status, 200);
  const c = rawSetCookie(ok, COOKIE);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(c.includes(flag), flag);
  assert.equal(ok.res.headers.getSetCookie().length, 1, 'بلا «تذكّر» لا يُصدَر كوكي جهاز');
  const me = await call(env, 'GET', '/api/me', { cookie: jar(cookiesOf(ok)) });
  assert.equal(me.body.user.email, 'amna@nawaculture.org');
  assert.equal(me.body.user.via, 'pin');
  assert.equal(me.body.user.pin, true);

  const wrong = await pinLogin(env, 'amna@nawaculture.org', '000999');
  const unknown = await pinLogin(env, 'ghost@nawaculture.org', '482916');
  const noPin = await pinLogin(env, 'nopin@nawaculture.org', '482916');
  const junk = await pinLogin(env, 'amna@nawaculture.org', 'abcdef');
  for (const r of [wrong, unknown, noPin, junk]) {
    assert.equal(r.status, 401);
    assert.equal(r.body.error, 'البريد أو الـ PIN غير صحيح');
  }
  assert.equal((await call(env, 'POST', '/api/auth/pin', { body: { email: 42, pin: 1 } })).status, 401);
});

test('قفل PIN: 5 محاولات خاطئة تقفل، الصحيح لا يفتح أثناء القفل، ويتصاعد القفل ثم يُصفَّر بنجاح', async () => {
  const { db, env } = await setup();
  env.__NOW = new Date().toISOString();
  const t0 = Date.now();
  await userWithPin(env, db);
  const bad = () => pinLogin(env, 'amna@nawaculture.org', '000999');

  for (let i = 0; i < 4; i++) assert.equal((await bad()).status, 401);
  const fifth = await bad();
  assert.equal(fifth.status, 429);
  assert.equal(fifth.body.code, 'locked');
  assert.equal(fifth.body.retryAfter, 15 * 60);

  // الصحيح أثناء القفل مرفوض ولا يُحتسب
  const during = await pinLogin(env, 'amna@nawaculture.org', '482916');
  assert.equal(during.status, 429);
  assert.ok(during.body.retryAfter <= 15 * 60 && during.body.retryAfter > 0);
  assert.match(during.body.error, /15 دقيقة|دقيقة/);
  assert.equal((await db.prepare('SELECT failures FROM user_pins').first()).failures, 5, 'لا زيادة أثناء القفل');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'auth.pin.locked'").first()).n, 1);

  // بعد انتهاء القفل: أربع محاولات خاطئة تُقبل كمحاولات، والخامسة تقفل 30 دقيقة (تصاعد)
  env.__NOW = new Date(t0 + 16 * 60_000).toISOString();
  for (let i = 0; i < 4; i++) assert.equal((await bad()).status, 401, `محاولة ${i + 1}`);
  const second = await bad();
  assert.equal(second.status, 429);
  assert.equal(second.body.retryAfter, 30 * 60);

  // بعد القفل الثاني: النجاح يفتح ويُصفّر العدّاد والتصاعد
  env.__NOW = new Date(t0 + 60 * 60_000).toISOString();
  assert.equal((await pinLogin(env, 'amna@nawaculture.org', '482916')).status, 200);
  const row = await db.prepare('SELECT failures, strikes, locked_until FROM user_pins').first();
  assert.deepEqual({ ...row }, { failures: 0, strikes: 0, locked_until: null });
});

test('طلبات تخمين متوازية لا تتجاوز 5 محاولات قبل القفل', async () => {
  const { db, env } = await setup();
  await userWithPin(env, db);
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => pinLogin(env, 'amna@nawaculture.org', String(100000 + i * 7919).slice(0, 6))));
  const statuses = results.map((r) => r.status);
  assert.ok(statuses.filter((s) => s === 401).length <= 4, '401 لا تتجاوز 4 ثم يقفل');
  assert.ok(statuses.includes(429));
  assert.ok(statuses.every((c) => c === 401 || c === 429), `لا أخطاء خادم: ${statuses}`);
  assert.equal((await db.prepare('SELECT failures FROM user_pins').first()).failures, 5);
});

// ---------------------------------------------------------------- رمز البريد
test('رمز البريد: الإرسال، التحقق مرة واحدة، والقاعدة لا تحمل الرمز', async () => {
  const { db, env, mailer } = await setup();
  await addUser(db, 'amna@nawaculture.org', 'employee');

  const req = await call(env, 'POST', '/api/auth/code/request', { body: { email: 'Amna@nawaculture.org' } });
  assert.equal(req.status, 200);
  assert.equal(mailer.sent.length, 1);
  const m = mailer.last();
  assert.equal(m.to, 'amna@nawaculture.org');
  const code = mailer.code();
  assert.match(code, /^\d{6}$/);
  assert.ok(m.subject.includes(code), 'العنوان يحمل الرمز كي يظهر في الإشعار');
  assert.ok(m.html.includes(code) && m.html.includes('dir="rtl"'));
  const stored = JSON.stringify(await db.prepare('SELECT * FROM email_codes').first());
  assert.ok(!stored.includes(code));

  const bad = await call(env, 'POST', '/api/auth/code/verify', { body: { email: 'amna@nawaculture.org', code: code === '000000' ? '000001' : '000000' } });
  assert.equal(bad.status, 401);
  const ok = await call(env, 'POST', '/api/auth/code/verify', { body: { email: 'amna@nawaculture.org', code: ` ${code.slice(0, 3)} ${code.slice(3)} ` } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const me = await call(env, 'GET', '/api/me', { cookie: jar(cookiesOf(ok)) });
  assert.equal(me.body.user.via, 'code');

  const replay = await call(env, 'POST', '/api/auth/code/verify', { body: { email: 'amna@nawaculture.org', code } });
  assert.equal(replay.status, 401, 'الرمز لمرة واحدة');

  // رمز البريد جلسة «قوية»: يكفي لتفعيل PIN
  const pin = await call(env, 'POST', '/api/account/pin', { cookie: jar(cookiesOf(ok)), body: { pin: '482916' } });
  assert.equal(pin.status, 200);
});

test('رمز البريد: غير مسجّل أو موقوف يردّ بنفس الجملة بلا إرسال', async () => {
  const { db, env, mailer } = await setup();
  await addUser(db, 'off@nawaculture.org', 'employee', null, 0);
  const real = await addUser(db, 'real@nawaculture.org', 'employee');
  assert.ok(real);
  const a = await call(env, 'POST', '/api/auth/code/request', { body: { email: 'ghost@nawaculture.org' } });
  const b = await call(env, 'POST', '/api/auth/code/request', { body: { email: 'off@nawaculture.org' } });
  const c = await call(env, 'POST', '/api/auth/code/request', { body: { email: 'real@nawaculture.org' } });
  assert.deepEqual(a.body, c.body);
  assert.deepEqual(b.body, c.body);
  assert.equal(mailer.sent.length, 1, 'الإرسال للمسجّل الفعّال فقط');
  assert.equal((await call(env, 'POST', '/api/auth/code/request', { body: { email: 'not-an-email' } })).status, 400);
});

test('رمز البريد: ينتهي بعد 10 دقائق، و5 محاولات خاطئة تبطله، والجديد يُبطل القديم', async () => {
  const { db, env, mailer } = await setup();
  const t0 = Date.now();
  env.__NOW = new Date(t0).toISOString();
  await addUser(db, 'amna@nawaculture.org', 'employee');
  const send = () => call(env, 'POST', '/api/auth/code/request', { body: { email: 'amna@nawaculture.org' } });
  const verify = (code) => call(env, 'POST', '/api/auth/code/verify', { body: { email: 'amna@nawaculture.org', code } });

  await send();
  const first = mailer.code();
  env.__NOW = new Date(t0 + 11 * 60_000).toISOString();
  assert.equal((await verify(first)).status, 401, 'منتهي');

  // رمز جديد، ثم 5 محاولات خاطئة تُبطله حتى لو جاء الصحيح بعدها
  await send();
  const second = mailer.code();
  assert.notEqual(second, undefined);
  const wrong = second === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) assert.equal((await verify(wrong)).status, 401);
  assert.equal((await verify(second)).status, 401, 'استُنفدت المحاولات');

  // طلب رمز ثالث بعد دقيقة: القديم لا يعمل والجديد يعمل
  env.__NOW = new Date(t0 + 13 * 60_000).toISOString();
  await send();
  const third = mailer.code();
  env.__NOW = new Date(t0 + 15 * 60_000).toISOString();
  await send();
  const fourth = mailer.code();
  if (third !== fourth) assert.equal((await verify(third)).status, 401, 'الرمز الأحدث يُبطل ما قبله');
  assert.equal((await verify(fourth)).status, 200);
});

test('رمز البريد: مهلة دقيقة بين الطلبات، و5 في الساعة، وسقف عام للمؤسسة', async () => {
  const { db, env, mailer } = await setup();
  const t0 = Date.now();
  env.__NOW = new Date(t0).toISOString();
  await addUser(db, 'amna@nawaculture.org', 'employee');
  const send = () => call(env, 'POST', '/api/auth/code/request', { body: { email: 'amna@nawaculture.org' } });

  await send();
  env.__NOW = new Date(t0 + 30_000).toISOString();
  const quick = await send();
  assert.equal(quick.status, 200);
  assert.equal(mailer.sent.length, 1, 'خلال الدقيقة: لا إرسال');

  for (let i = 1; i <= 6; i++) {
    env.__NOW = new Date(t0 + i * 61_000).toISOString();
    await send();
  }
  assert.equal(mailer.sent.length, 5, 'خمسة رموز كحد أقصى في الساعة');

  // السقف العام: 60 رمزاً في الساعة للجميع
  const { db: db2, env: env2, mailer: m2 } = await setup();
  env2.__NOW = new Date(t0).toISOString();
  await addUser(db2, 'late@nawaculture.org', 'employee');
  const stamp = new Date(t0 - 60_000).toISOString().replace('T', ' ').slice(0, 19);
  await db2.prepare("WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 59) INSERT INTO email_codes (email, salt, code_hash, expires_at, created_at) SELECT 'u' || i || '@x.org', 's', 'h', '2999-01-01 00:00:00', ? FROM n").bind(stamp).run();
  const busy = await call(env2, 'POST', '/api/auth/code/request', { body: { email: 'late@nawaculture.org' } });
  assert.equal(busy.status, 429);
  assert.equal(m2.sent.length, 0);
});

test('فشل مزوّد البريد لا يكسر الرد ويُسجَّل للمسؤول', async () => {
  const { db, env } = await setup();
  env.__MAILER = { async send() { throw new Error('graph send 403'); } };
  await addUser(db, 'amna@nawaculture.org', 'employee');
  const r = await call(env, 'POST', '/api/auth/code/request', { body: { email: 'amna@nawaculture.org' } });
  assert.equal(r.status, 200);
  const log = await db.prepare("SELECT detail FROM audit_log WHERE action = 'mail.failed'").first();
  assert.match(log.detail, /graph send 403/);
});

test('قالب الرسالة عربي يحمل الرمز والمدة', () => {
  const m = codeMessage('482916', 10);
  assert.ok(m.text.includes('482916') && m.text.includes('10'));
  assert.match(m.html, /dir="rtl"/);
});

// ---------------------------------------------------------------- الأجهزة المتذكَّرة
test('«تذكّر الجهاز»: كوكي جهاز آمن، يُسجَّل بصمته فقط، والاستئناف يعيد جلسة جديدة', async () => {
  const { db, env, mailer } = await setup();
  await addUser(db, 'amna@nawaculture.org', 'employee');
  await call(env, 'POST', '/api/auth/code/request', { body: { email: 'amna@nawaculture.org' } });
  const first = await call(env, 'POST', '/api/auth/code/verify', { headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36' }, body: { email: 'amna@nawaculture.org', code: mailer.code(), remember: true } });
  assert.equal(first.status, 200);
  const dev = rawSetCookie(first, DEVICE_COOKIE);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', `Max-Age=${30 * 86400}`]) assert.ok(dev.includes(flag), flag);
  assert.ok(!/Domain=/i.test(dev));
  const token = cookiesOf(first)[DEVICE_COOKIE];
  assert.match(token, /^[0-9a-f]{64}$/);
  const row = await db.prepare('SELECT * FROM trusted_devices').first();
  assert.equal(row.token_hash, await sha256hex(token));
  assert.ok(!JSON.stringify(row).includes(token));
  assert.equal(row.label, 'Android · Chrome');

  // المتصفح بلا جلسة وبكوكي الجهاز فقط
  const info = await call(env, 'GET', '/api/auth/device', { cookie: `${DEVICE_COOKIE}=${token}` });
  assert.deepEqual({ known: info.body.known, auto: info.body.auto, pinRequired: info.body.pinRequired, name: info.body.name }, { known: true, auto: true, pinRequired: false, name: 'amna' });
  const resumed = await call(env, 'POST', '/api/auth/resume', { cookie: `${DEVICE_COOKIE}=${token}`, body: {} });
  assert.equal(resumed.status, 200);
  const jarR = jar(cookiesOf(resumed));
  const me = await call(env, 'GET', '/api/me', { cookie: jarR });
  assert.equal(me.body.user.via, 'device');
  assert.ok(rawSetCookie(resumed, DEVICE_COOKIE), 'الأجل ينزلق مع الاستعمال');

  // بلا كوكي أو بكوكي مزوّر: لا شيء
  assert.equal((await call(env, 'GET', '/api/auth/device')).body.known, false);
  assert.equal((await call(env, 'GET', '/api/auth/device', { cookie: `${DEVICE_COOKIE}=${'a'.repeat(64)}` })).body.known, false);
  const forged = await call(env, 'POST', '/api/auth/resume', { cookie: `${DEVICE_COOKIE}=${'a'.repeat(64)}`, body: {} });
  assert.equal(forged.status, 401);
  assert.match(rawSetCookie(forged, DEVICE_COOKIE) || '', /^__Host-nawa-d=; .*Max-Age=0/, 'نمسح الكوكي غير الصالح');
});

test('الخروج الصريح يوقف الدخول التلقائي لكنه يبقي «متابعة»، و«نسيان الجهاز» يحذفه', async () => {
  const { db, env } = await setup();
  const u = await userWithPin(env, db);
  const li = await pinLogin(env, u.email, u.pin, { remember: true });
  const all = cookiesOf(li);
  const token = all[DEVICE_COOKIE];

  // خروج عادي
  const out = await call(env, 'POST', '/api/auth/logout', { cookie: jar(all), body: {} });
  assert.equal(out.status, 200);
  assert.equal((await call(env, 'GET', '/api/me', { cookie: jar(all) })).status, 401);
  const info = await call(env, 'GET', '/api/auth/device', { cookie: `${DEVICE_COOKIE}=${token}` });
  assert.equal(info.body.known, true);
  assert.equal(info.body.auto, false);

  // «متابعة» الصريحة (مع PIN لأن الجهاز فُتح بـ PIN) تعيده تلقائياً
  const go = await call(env, 'POST', '/api/auth/resume', { cookie: `${DEVICE_COOKIE}=${token}`, body: { pin: u.pin } });
  assert.equal(go.status, 200);
  assert.equal((await call(env, 'GET', '/api/auth/device', { cookie: `${DEVICE_COOKIE}=${token}` })).body.known, true);

  // خروج مع نسيان الجهاز
  const forget = await call(env, 'POST', '/api/auth/logout', { cookie: `${COOKIE}=${cookiesOf(go)[COOKIE]}; ${DEVICE_COOKIE}=${token}`, body: { forget: true } });
  assert.equal(forget.status, 200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM trusted_devices').first()).n, 0);
  assert.equal((await call(env, 'POST', '/api/auth/resume', { cookie: `${DEVICE_COOKIE}=${token}`, body: { pin: u.pin } })).status, 401);
});

test('جهاز محمي بـ PIN: لا يدخل بلا PIN، ويخضع لنفس القفل', async () => {
  const { db, env } = await setup();
  const u = await userWithPin(env, db);
  const token = cookiesOf(await pinLogin(env, u.email, u.pin, { remember: true }))[DEVICE_COOKIE];
  const dev = { cookie: `${DEVICE_COOKIE}=${token}` };

  const info = await call(env, 'GET', '/api/auth/device', dev);
  assert.deepEqual({ auto: info.body.auto, pinRequired: info.body.pinRequired }, { auto: false, pinRequired: true });
  assert.equal((await call(env, 'POST', '/api/auth/resume', { ...dev, body: {} })).status, 401);
  for (let i = 0; i < 4; i++) assert.equal((await call(env, 'POST', '/api/auth/resume', { ...dev, body: { pin: '000999' } })).status, 401);
  assert.equal((await call(env, 'POST', '/api/auth/resume', { ...dev, body: { pin: '000999' } })).status, 429);
  assert.equal((await call(env, 'POST', '/api/auth/resume', { ...dev, body: { pin: u.pin } })).status, 429, 'القفل مشترك مع الدخول بالبريد');
  assert.equal((await pinLogin(env, u.email, u.pin)).status, 429);
});

test('الجهاز يسقط عند الإيقاف أو إعادة الضبط أو انتهاء 30 يوماً أو إزالة PIN', async () => {
  const { db, env } = await setup();
  const admin = await login(db, 'admin@nawaculture.org', 'admin');
  const u = await userWithPin(env, db);
  const remember = async () => cookiesOf(await pinLogin(env, u.email, u.pin, { remember: true }))[DEVICE_COOKIE];
  const resume = (t, pin = u.pin) => call(env, 'POST', '/api/auth/resume', { cookie: `${DEVICE_COOKIE}=${t}`, body: { pin } });

  // انتهاء المدة
  let t = await remember();
  assert.equal((await resume(t)).status, 200);
  env.__NOW = new Date(Date.now() + 31 * 86400_000).toISOString();
  assert.equal((await resume(t)).status, 401);
  delete env.__NOW;

  // إعادة ضبط من المسؤول: PIN والجهاز والجلسات
  t = await remember();
  const reset = await call(env, 'POST', `/api/users/${u.id}/reset-login`, { cookie: admin.cookie, body: {} });
  assert.equal(reset.status, 200);
  assert.equal((await resume(t)).status, 401);
  assert.equal((await pinLogin(env, u.email, u.pin)).status, 401);
  assert.equal((await call(env, 'GET', '/api/me', { cookie: u.cookie })).status, 401);
  const plain = await login(db, 'plain@nawaculture.org', 'employee');
  assert.equal((await call(env, 'POST', `/api/users/${u.id}/reset-login`, { cookie: plain.cookie, body: {} })).status, 403, 'غير المسؤول لا يستطيع');

  // إيقاف الحساب
  const v = await userWithPin(env, db, 'v@nawaculture.org', '907315');
  const tv = cookiesOf(await pinLogin(env, v.email, v.pin, { remember: true }))[DEVICE_COOKIE];
  await call(env, 'PATCH', `/api/users/${v.id}`, { cookie: admin.cookie, body: { active: false } });
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM trusted_devices WHERE user_id = ?').bind(v.id).first()).n, 0);
  assert.equal((await call(env, 'POST', '/api/auth/resume', { cookie: `${DEVICE_COOKIE}=${tv}`, body: { pin: v.pin } })).status, 401);
  assert.equal((await pinLogin(env, v.email, v.pin)).status, 401);

  // إزالة PIN تحذف الأجهزة المرتبطة به
  const w = await userWithPin(env, db, 'w@nawaculture.org', '360841');
  const tw = cookiesOf(await pinLogin(env, w.email, w.pin, { remember: true }))[DEVICE_COOKIE];
  const rm = await call(env, 'POST', '/api/account/pin/remove', { cookie: w.cookie, body: {} });
  assert.equal(rm.status, 200);
  assert.equal((await call(env, 'GET', '/api/auth/device', { cookie: `${DEVICE_COOKIE}=${tw}` })).body.known, false);
});

test('الدخول بـ Microsoft مع «تذكّر الجهاز» يُصدر كوكي الجهاز', async () => {
  const iss = await makeIssuer();
  stub = stubJwks(() => iss.keys);
  const { db, env } = await setup();
  await addUser(db, 'ahmad@nawaculture.org', 'hr');
  const start = await call(env, 'POST', '/api/auth/start', { body: {} });
  const idToken = await iss.sign({ nonce: start.body.nonce });
  const r = await call(env, 'POST', '/api/auth/session', { body: { idToken, remember: true } });
  assert.equal(r.status, 200);
  assert.ok(rawSetCookie(r, DEVICE_COOKIE));
  assert.equal(TENANT.length, 36);
  // بلا remember: لا كوكي جهاز
  const start2 = await call(env, 'POST', '/api/auth/start', { body: {} });
  const r2 = await call(env, 'POST', '/api/auth/session', { body: { idToken: await iss.sign({ nonce: start2.body.nonce }) } });
  assert.equal(rawSetCookie(r2, DEVICE_COOKIE), undefined);
});

test('الجهاز المتذكَّر الجديد يستبدل القديم، وحدّه 10 أجهزة للمستخدم', async () => {
  const { db, env } = await setup();
  const u = await userWithPin(env, db);
  const first = cookiesOf(await pinLogin(env, u.email, u.pin, { remember: true }))[DEVICE_COOKIE];
  // نفس المتصفح يسجّل ثانية: يُستبدل صفه
  const again = cookiesOf(await pinLogin(env, u.email, u.pin, { remember: true })) ;
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM trusted_devices').first()).n, 2, 'بلا كوكي قديم يُحسب جهازاً جديداً');
  const replaced = await call(env, 'POST', '/api/auth/pin', { cookie: `${DEVICE_COOKIE}=${again[DEVICE_COOKIE]}`, body: { email: u.email, pin: u.pin, remember: true } });
  assert.notEqual(cookiesOf(replaced)[DEVICE_COOKIE], again[DEVICE_COOKIE]);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM trusted_devices').first()).n, 2);
  for (let i = 0; i < 14; i++) await pinLogin(env, u.email, u.pin, { remember: true });
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM trusted_devices WHERE user_id = ?').bind(u.id).first()).n, 10);
  assert.ok(first);
});

// ---------------------------------------------------------------- صفحة حسابي
test('حسابي: يعرض PIN والأجهزة (والحالي منها)، ويلغي جهازاً، ويخرج من الأجهزة الأخرى', async () => {
  const { db, env } = await setup();
  const u = await userWithPin(env, db);
  const a = cookiesOf(await pinLogin(env, u.email, u.pin, { remember: true }));
  const b = cookiesOf(await pinLogin(env, u.email, u.pin, { remember: true }));

  const acc = await call(env, 'GET', '/api/account', { cookie: jar(a) });
  assert.equal(acc.status, 200);
  assert.equal(acc.body.account.pin.set, true);
  assert.equal(acc.body.account.devices.length, 2);
  assert.equal(acc.body.account.devices.filter((d) => d.current).length, 1);
  assert.ok(!JSON.stringify(acc.body).includes(a[DEVICE_COOKIE]), 'لا رموز ولا بصمات في الرد');
  assert.ok(!JSON.stringify(acc.body).includes(await sha256hex(a[DEVICE_COOKIE])));
  assert.equal(acc.body.account.codeAvailable, true);

  // خروج من الأجهزة الأخرى: جلسة b وجهازه يسقطان، وجهاز a وجلسته يبقيان
  const out = await call(env, 'POST', '/api/account/sign-out-others', { cookie: jar(a), body: {} });
  assert.equal(out.status, 200);
  assert.equal((await call(env, 'GET', '/api/me', { cookie: jar(b) })).status, 401);
  assert.equal((await call(env, 'GET', '/api/me', { cookie: jar(a) })).status, 200);
  assert.equal((await call(env, 'GET', '/api/auth/device', { cookie: `${DEVICE_COOKIE}=${b[DEVICE_COOKIE]}` })).body.known, false);

  // إلغاء الجهاز الحالي يمسح كوكيه
  const cur = (await call(env, 'GET', '/api/account', { cookie: jar(a) })).body.account.devices.find((d) => d.current);
  const rev = await call(env, 'POST', `/api/account/devices/${cur.id}/revoke`, { cookie: jar(a), body: {} });
  assert.equal(rev.status, 200);
  assert.match(rawSetCookie(rev, DEVICE_COOKIE), /Max-Age=0/);
  // جهاز غيري: لا أستطيع إلغاءه
  const other = await login(db, 'other@nawaculture.org', 'employee');
  const od = await call(env, 'POST', '/api/account/devices', { cookie: other.cookie, body: {} });
  assert.equal(od.status, 404);
});

test('حسابي: تذكّر هذا الجهاز بعد الدخول، وطلب PIN عند فتحه، ونسيانه', async () => {
  const { db, env } = await setup();
  const u = await login(db, 'amna@nawaculture.org', 'employee');
  const on = await call(env, 'POST', '/api/account/device', { cookie: u.cookie, body: { remember: true } });
  assert.equal(on.status, 200);
  const token = cookiesOf(on)[DEVICE_COOKIE];
  assert.ok(token);
  const cookie = `${u.cookie}; ${DEVICE_COOKIE}=${token}`;

  // طلب PIN قبل تفعيله مرفوض
  assert.equal((await call(env, 'POST', '/api/account/device', { cookie, body: { remember: true, pinRequired: true } })).status, 400);
  await call(env, 'POST', '/api/account/pin', { cookie, body: { pin: '482916' } });
  const prot = await call(env, 'POST', '/api/account/device', { cookie, body: { remember: true, pinRequired: true } });
  assert.equal(prot.status, 200);
  assert.equal(rawSetCookie(prot, DEVICE_COOKIE), undefined, 'الجهاز نفسه يُحدَّث بلا كوكي جديد');
  assert.equal((await call(env, 'GET', '/api/auth/device', { cookie: `${DEVICE_COOKIE}=${token}` })).body.pinRequired, true);

  const off = await call(env, 'POST', '/api/account/device', { cookie, body: { remember: false } });
  assert.equal(off.status, 200);
  assert.match(rawSetCookie(off, DEVICE_COOKIE), /Max-Age=0/);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM trusted_devices').first()).n, 0);
});

test('مسارات الدخول الجديدة تحمي من CSRF وتتطلب جلسة حيث يلزم', async () => {
  const { env } = await setup();
  for (const [m, p] of [['POST', '/api/auth/pin'], ['POST', '/api/auth/resume'], ['POST', '/api/auth/code/request'], ['POST', '/api/auth/code/verify']]) {
    const r = await call(env, m, p, { origin: 'https://evil.example', body: {} });
    assert.equal(r.status, 403, p);
  }
  for (const [m, p] of [['GET', '/api/account'], ['POST', '/api/account/pin'], ['POST', '/api/account/pin/remove'], ['POST', '/api/account/device'], ['POST', '/api/account/sign-out-others']]) {
    const r = await call(env, m, p, { body: m === 'POST' ? {} : undefined });
    assert.equal(r.status, 401, p);
  }
});
