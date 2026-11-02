import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';
import { setWork } from './helpers/seed.js';
import { explainMailError } from '../src/worker/mail-status.js';

const NOW = '2026-11-02T07:00:00Z';
const SETTINGS = { start: '08:30', end: '15:00', toleranceMinutes: 10, weekdays: ['عمل', 'عمل', 'عمل', 'عمل', 'عمل', 'عطلة أسبوعية', 'عطلة أسبوعية'], leaveTypes: { 'إجازة سنوية': true, 'إجازة مرضية': true } };

async function world(mailer) {
  const { db, env } = await apiEnv();
  env.__NOW = NOW;
  if (mailer) env.__MAILER = mailer;
  await setWork(db, SETTINGS);
  await seedOrg(db);
  return { db, env, admin: await login(db, 'adm@nawaculture.org', 'admin', null), emp: await login(db, 'emp2@nawaculture.org', 'employee', 2), mgr: await login(db, 'mgr@nawaculture.org', 'manager', 1) };
}
const get = (env, who) => call(env, 'GET', '/api/settings/mail', { cookie: who.cookie });
const test_ = (env, who) => call(env, 'POST', '/api/settings/mail/test', { cookie: who.cookie, body: {} });

test('بلا إعداد: غير مُفعَّل ويُسمّى كل متغير ناقص، وبلا كشف أي قيمة', async () => {
  const { env, admin } = await world(null);
  const r = await get(env, admin);
  assert.equal(r.status, 200);
  assert.equal(r.body.configured, false);
  assert.deepEqual(r.body.missing, ['MAIL_CLIENT_ID', 'MAIL_CLIENT_SECRET', 'MAIL_FROM']);
  assert.equal(r.body.partial, false);
  assert.equal(r.body.from, null);
  assert.equal((await test_(env, admin)).status, 400);
});

test('إعداد ناقص: يُسمّي ما بقي فقط ولا يعرض السرّ', async () => {
  const { env, admin } = await world(null);
  env.MAIL_CLIENT_ID = 'abc-id';
  env.MAIL_CLIENT_SECRET = 'TOP-SECRET-VALUE';
  const r = await get(env, admin);
  assert.equal(r.body.configured, false);
  assert.equal(r.body.partial, true);
  assert.deepEqual(r.body.missing, ['MAIL_FROM']);
  assert.ok(!JSON.stringify(r.body).includes('TOP-SECRET-VALUE'));
});

test('إعداد Graph كامل: مُفعَّل ويُعرض عنوان الإرسال فقط', async () => {
  const { env, admin } = await world(null);
  env.MAIL_CLIENT_ID = 'abc-id'; env.MAIL_CLIENT_SECRET = 'TOP-SECRET-VALUE'; env.MAIL_FROM = 'no-reply@nawaculture.org'; env.ENTRA_TENANT_ID = 'tenant-1';
  const r = await get(env, admin);
  assert.equal(r.body.configured, true);
  assert.equal(r.body.provider, 'graph');
  assert.equal(r.body.from, 'no-reply@nawaculture.org');
  assert.ok(!JSON.stringify(r.body).includes('TOP-SECRET-VALUE'));
});

test('الرسالة التجريبية تذهب إلى بريد المسؤول وحده، وتُسجَّل، ومحدودة بمرة كل 30 ثانية', async () => {
  const sent = [];
  const { env, admin, db } = await world({ kind: 'test', send: async (m) => { sent.push(m); } });
  const r = await test_(env, admin);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.to, 'adm@nawaculture.org');
  assert.deepEqual(sent.map((m) => m.to), ['adm@nawaculture.org']);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'mail.test'").first()).n, 1);
  assert.equal((await test_(env, admin)).status, 429);
  assert.equal(sent.length, 1);
});

test('فشل الإرسال التجريبي يعيد السبب بالعربية ويُسجَّل', async () => {
  const { env, admin, db } = await world({ kind: 'graph', send: async () => { throw new Error('graph send 403'); } });
  const r = await test_(env, admin);
  assert.equal(r.status, 502);
  assert.match(r.body.error, /Mail\.Send/);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'mail.test.failed'").first()).n, 1);
});

test('فشل إشعار طلب يُسجَّل mail.failed ويظهر في الحالة بسببه المفهوم، والطلب لا يتعطل', async () => {
  const { env, admin, emp } = await world({ kind: 'graph', send: async () => { throw new Error('graph token 401'); } });
  const r = await call(env, 'POST', '/api/requests', { cookie: emp.cookie, body: { kind: 'leave', purpose: 'annual', reason: 'سفر', fromDate: '2026-11-08', toDate: '2026-11-08' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const s = await get(env, admin);
  assert.equal(s.body.failures.length, 1);
  assert.equal(s.body.failures[0].what, 'request.submitted');
  assert.match(s.body.failures[0].hint, /MAIL_CLIENT_SECRET/);
});

test('explainMailError: أسباب Graph وResend', () => {
  assert.match(explainMailError('graph token 400 invalid_client'), /MAIL_CLIENT_ID/);
  assert.match(explainMailError('graph send 404'), /MAIL_FROM/);
  assert.match(explainMailError('resend 403'), /Resend/);
  assert.match(explainMailError('???'), /غير معروف/);
});
