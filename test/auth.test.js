import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { verifyIdToken, resetKeyCache, COOKIE } from '../src/worker/auth.js';
import { makeIssuer, stubJwks, unsigned, enc, TENANT, CLIENT } from './helpers/oidc.js';
import { apiEnv, call, addUser, ORIGIN } from './helpers/api.js';
import { sha256hex } from '../src/worker/util.js';

const cfg = { tenant: TENANT, clientId: CLIENT };
let stub;
beforeEach(() => resetKeyCache());
afterEach(() => stub?.restore());

const reject = async (token, reason, opts) => {
  await assert.rejects(() => verifyIdToken(token, cfg, opts), (e) => e.message === reason, `كان متوقعاً الرفض بسبب ${reason}`);
};

test('id_token صالح يُقبل', async () => {
  const iss = await makeIssuer();
  stub = stubJwks(() => iss.keys);
  const c = await verifyIdToken(await iss.sign({ nonce: 'abc' }), cfg);
  assert.equal(c.nonce, 'abc');
  assert.equal(c.preferred_username, 'ahmad@nawaculture.org');
});

test('كل مطالبة خاطئة تُرفض: الجهة المصدِرة، المستأجر، الجمهور، الانتهاء، nbf، nonce', async () => {
  const iss = await makeIssuer();
  stub = stubJwks(() => iss.keys);
  const now = Math.floor(Date.now() / 1000);
  await reject(await iss.sign({ iss: 'https://login.microsoftonline.com/other/v2.0' }), 'bad_issuer');
  await reject(await iss.sign({ tid: '99999999-2222-3333-4444-555555555555' }), 'bad_tenant');
  await reject(await iss.sign({ aud: 'someone-elses-app' }), 'bad_audience');
  await reject(await iss.sign({ exp: now - 600 }), 'expired');
  await reject(await iss.sign({ nbf: now + 600 }), 'not_yet_valid');
  await reject(await iss.sign({ nonce: undefined }), 'no_nonce');
});

test('هجمات التوقيع: alg=none، خلط HS256، حمولة معدّلة، مفتاح مجهول، نص عشوائي', async () => {
  const iss = await makeIssuer();
  stub = stubJwks(() => iss.keys);
  const claims = { iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, aud: CLIENT, tid: TENANT, exp: Math.floor(Date.now() / 1000) + 3600, nonce: 'n', preferred_username: 'admin@nawaculture.org' };
  await reject(unsigned(claims), 'bad_alg');
  await reject(await iss.sign({}, { header: { alg: 'HS256' } }), 'bad_alg');
  await reject(await iss.sign({}, { tamper: true }), 'bad_signature');
  await reject(await iss.sign({}, { header: { kid: 'not-a-known-key' } }), 'unknown_key');
  for (const junk of ['', 'a.b', 'a.b.c', 'x'.repeat(9000), null, undefined, 42]) await reject(junk, junk && junk.length > 8192 ? 'bad_token' : 'bad_token');
});

test('مفتاح موقّع من مُصدِر آخر (مفتاح مهاجم بنفس kid) يُرفض', async () => {
  const real = await makeIssuer('shared-kid');
  const attacker = await makeIssuer('shared-kid');
  stub = stubJwks(() => real.keys);
  await reject(await attacker.sign({}), 'bad_signature');
});

test('مفاتيح Microsoft تُخزَّن مؤقتاً، ولا يُغرَق Microsoft بطلبات kid مزوّر، وتدوير المفاتيح يُلتقط', async () => {
  const k1 = await makeIssuer('k1');
  const k2 = await makeIssuer('k2');
  let current = k1.keys;
  stub = stubJwks(() => current);
  const t0 = Date.now();

  await verifyIdToken(await k1.sign({}), cfg, { now: t0 });
  await verifyIdToken(await k1.sign({}), cfg, { now: t0 + 1000 });
  assert.equal(stub.calls, 1, 'الثاني من الذاكرة المؤقتة');

  await reject(await k2.sign({}), 'unknown_key', { now: t0 + 2000 });
  await reject(await k2.sign({}), 'unknown_key', { now: t0 + 3000 });
  assert.equal(stub.calls, 1, 'kid مجهول خلال 5 دقائق لا يعيد الجلب');

  current = [...k1.keys, ...k2.keys]; // Microsoft دوّرت المفتاح
  await verifyIdToken(await k2.sign({}), cfg, { now: t0 + 6 * 60_000 });
  assert.equal(stub.calls, 2);
});

// ------------------------------------------------------------- المسار الكامل عبر الـ Worker
async function loginFlow(env, iss, claims = {}) {
  const start = await call(env, 'POST', '/api/auth/start', { body: {} });
  assert.equal(start.status, 200);
  assert.equal(start.body.tenant, TENANT);
  assert.equal(start.body.clientId, CLIENT);
  const idToken = await iss.sign({ nonce: start.body.nonce, ...claims });
  return { nonce: start.body.nonce, idToken, res: await call(env, 'POST', '/api/auth/session', { body: { idToken } }) };
}

test('الدخول كاملاً: nonce → id_token → جلسة بكوكي HttpOnly/Secure → /api/me → خروج', async () => {
  const iss = await makeIssuer();
  stub = stubJwks(() => iss.keys);
  const { db, env } = await apiEnv();
  await addUser(db, 'ahmad@nawaculture.org', 'hr');

  const { res, idToken } = await loginFlow(env, iss);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.user, { email: 'ahmad@nawaculture.org', role: 'hr' });

  const setCookie = res.res.headers.get('set-cookie');
  assert.match(setCookie, new RegExp(`^${COOKIE}=[0-9a-f]{64};`));
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(setCookie.includes(flag), flag);
  assert.ok(!/Domain=/i.test(setCookie), '__Host- يمنع Domain');

  const token = setCookie.match(/=([0-9a-f]{64})/)[1];
  const me = await call(env, 'GET', '/api/me', { cookie: `${COOKIE}=${token}` });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, 'ahmad@nawaculture.org');

  // القاعدة تحفظ البصمة لا الرمز
  const stored = JSON.stringify((await db.prepare('SELECT * FROM sessions').all()).results);
  assert.ok(!stored.includes(token));
  assert.ok(stored.includes(await sha256hex(token)));

  // استعمال الـ id_token نفسه مرة ثانية (إعادة إرسال) يفشل لأن الـ nonce استُهلك
  const replay = await call(env, 'POST', '/api/auth/session', { body: { idToken } });
  assert.equal(replay.status, 401);

  const out = await call(env, 'POST', '/api/auth/logout', { cookie: `${COOKIE}=${token}` });
  assert.equal(out.status, 200);
  assert.equal((await call(env, 'GET', '/api/me', { cookie: `${COOKIE}=${token}` })).status, 401);
});

test('nonce لم يُصدره الخادم، أو انتهت مدته، لا يُقبل', async () => {
  const iss = await makeIssuer();
  stub = stubJwks(() => iss.keys);
  const { db, env } = await apiEnv();
  await addUser(db, 'ahmad@nawaculture.org', 'hr');

  const forged = await call(env, 'POST', '/api/auth/session', { body: { idToken: await iss.sign({ nonce: 'made-up-by-attacker' }) } });
  assert.equal(forged.status, 401);

  const start = await call(env, 'POST', '/api/auth/start', { body: {} });
  await db.prepare("UPDATE auth_nonces SET expires_at = '2000-01-01 00:00:00'").run();
  const late = await call(env, 'POST', '/api/auth/session', { body: { idToken: await iss.sign({ nonce: start.body.nonce }) } });
  assert.equal(late.status, 401);
});

test('حساب Microsoft صحيح لكن غير مسجّل في النظام أو معطّل: لا جلسة', async () => {
  const iss = await makeIssuer();
  stub = stubJwks(() => iss.keys);
  const { db, env } = await apiEnv();
  await addUser(db, 'off@nawaculture.org', 'employee', null, 0);

  const stranger = await loginFlow(env, iss, { preferred_username: 'stranger@nawaculture.org' });
  assert.equal(stranger.res.status, 403);
  assert.equal(stranger.res.body.code, 'not_registered');
  assert.equal(stranger.res.res.headers.get('set-cookie'), null);

  const off = await loginFlow(env, iss, { preferred_username: 'off@nawaculture.org' });
  assert.equal(off.res.status, 403);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM sessions').first('n'), 0);
});

test('البريد يُطابَق دون حساسية لحالة الأحرف', async () => {
  const iss = await makeIssuer();
  stub = stubJwks(() => iss.keys);
  const { db, env } = await apiEnv();
  await addUser(db, 'ahmad@nawaculture.org', 'employee');
  const r = await loginFlow(env, iss, { preferred_username: 'Ahmad@NawaCulture.org' });
  assert.equal(r.res.status, 200);
});

test('الجلسة المنتهية أو المحذوفة أو لمستخدم أُوقف لا تعمل', async () => {
  const { db, env } = await apiEnv();
  const { login } = await import('./helpers/api.js');
  const a = await login(db, 'a@nawaculture.org', 'hr');
  assert.equal((await call(env, 'GET', '/api/me', { cookie: a.cookie })).status, 200);

  await db.prepare("UPDATE sessions SET expires_at = '2000-01-01 00:00:00'").run();
  assert.equal((await call(env, 'GET', '/api/me', { cookie: a.cookie })).status, 401, 'منتهية');

  const b = await login(db, 'b@nawaculture.org', 'hr');
  await db.prepare('UPDATE users SET active = 0 WHERE id = ?').bind(b.id).run();
  assert.equal((await call(env, 'GET', '/api/me', { cookie: b.cookie })).status, 401, 'مستخدم موقوف');

  for (const bad of [`${COOKIE}=`, `${COOKIE}=short`, `${COOKIE}=${'0'.repeat(64)}`, 'other=1']) {
    assert.equal((await call(env, 'GET', '/api/me', { cookie: bad })).status, 401, bad);
  }
  assert.equal((await call(env, 'GET', '/api/me')).status, 401, 'بلا كوكي');
});

test('الدخول الموحّد غير مُعدّ: 503 بدل فشل غامض', async () => {
  const { env } = await apiEnv({ sso: false });
  assert.equal((await call(env, 'POST', '/api/auth/start', { body: {} })).status, 503);
  assert.equal((await call(env, 'POST', '/api/auth/session', { body: { idToken: 'x.y.z' } })).status, 503);
});

test('حماية CSRF: التعديل بلا Origin أو من أصل آخر يُرفض حتى مع جلسة صالحة', async () => {
  const { db, env } = await apiEnv();
  const { login } = await import('./helpers/api.js');
  const a = await login(db, 'a@nawaculture.org', 'admin');
  const body = { code: 'NW-100', name: 'اختبار' };
  assert.equal((await call(env, 'POST', '/api/employees', { body, cookie: a.cookie, origin: null })).status, 403);
  assert.equal((await call(env, 'POST', '/api/employees', { body, cookie: a.cookie, origin: 'https://evil.example' })).status, 403);
  assert.equal((await call(env, 'POST', '/api/employees', { body, cookie: a.cookie, origin: ORIGIN })).status, 201);
});

test('خطأ داخلي لا يسرّب تفاصيل', async () => {
  const { env } = await apiEnv();
  const broken = { ...env, DB: { prepare() { throw new Error('secret table names leak'); } } };
  const worker = (await import('../src/worker/index.js')).default;
  const res = await worker.fetch(new Request(`${ORIGIN}/api/health`), broken);
  assert.equal(res.status, 500);
  assert.ok(!(await res.text()).includes('secret'));
});
