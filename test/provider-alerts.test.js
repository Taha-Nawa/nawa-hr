import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker/index.js';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';
import { gatePost } from './helpers/seed.js';
import { alertProviders, alertMessage } from '../src/worker/provider-alerts.js';

const MON = '2026-11-02';
const at = (hhmm) => `${MON}T${hhmm}:00Z`;

async function world() {
  const { db, env } = await apiEnv();
  env.TIMEZONE = 'UTC';
  env.__NOW = at('09:20');
  await seedOrg(db);
  await db.prepare("UPDATE employees SET email = 'sup@nawaculture.org', center_id = 1 WHERE id = 2").run();
  const hr = await login(db, 'hr@nawaculture.org', 'hr', null);
  await login(db, 'adm@nawaculture.org', 'admin', null);
  const sent = [];
  env.__MAILER = { send: async (m) => { sent.push(m); } };
  const make = async (over = {}) => {
    const r = await call(env, 'POST', '/api/providers', { cookie: hr.cookie, body: { name: 'أ. سلمى', centerId: 1, supervisorId: 2, contractStart: '2026-10-01', contractEnd: '2026-12-31', schedule: [{ weekday: 1, start: '09:00', end: '13:00' }], ...over } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body;
  };
  const ping = (minAgo) => db.prepare("UPDATE devices SET last_ping = ? WHERE id = 'DEV-01'").bind(new Date(Date.parse(at('09:20')) - minAgo * 60000).toISOString().replace('T', ' ').slice(0, 19)).run();
  return { db, env, sent, make, ping };
}

test('لم يحضر: بريد واحد لكل مستلم بعد مضي المهلة، لا قبلها، ولا يتكرر', async () => {
  const { env, sent, make, ping } = await world();
  await make();
  await ping(2);
  env.__NOW = at('09:10');
  assert.deepEqual(await alertProviders(env), { noshow: 0, fresh: 0, sent: 0 }, 'ما زال ضمن المهلة');
  env.__NOW = at('09:20');
  const r = await alertProviders(env);
  assert.deepEqual([r.noshow, r.fresh, r.sent], [1, 1, 3]);
  assert.deepEqual(sent.map((m) => m.to).sort(), ['adm@nawaculture.org', 'hr@nawaculture.org', 'sup@nawaculture.org']);
  assert.match(sent[0].subject, /لم يحضر بعد: أ\. سلمى/);
  assert.match(sent[0].text, /9:00 ص إلى 1:00 م/);
  assert.match(sent[0].text, /منذ 20 دقيقة/);
  assert.match(sent[0].html, /#\/providers/);
  env.__NOW = at('09:50');
  assert.equal((await alertProviders(env)).fresh, 0, 'مرة واحدة لكل حصة');
  assert.equal(sent.length, 3);
});

test('من حضر لا ينبَّه عنه، ومن حضر متأخراً بعد التنبيه لا يُعاد التنبيه', async () => {
  const { env, sent, make, ping } = await world();
  const a = await make();
  await ping(1);
  await gatePost(env, [{ id: 'X1', card: a.card, code: a.code, name: 'x', center: 'x', type: 'حضور', date: MON, time: '09:05', iso: `${MON}T09:05:00`, device: 'DEV-01', offline: false, note: '' }]);
  const r = await alertProviders(env);
  assert.equal(r.noshow, 0);
  assert.equal(sent.length, 0);
});

test('بوابة المركز صامتة: لا نجزم بالغياب فلا نرسل', async () => {
  const { env, sent, make, ping } = await world();
  await make();
  await ping(45);
  let r = await alertProviders(env);
  assert.deepEqual([r.noshow, r.fresh, r.sent], [1, 0, 0]);
  await ping(5);
  r = await alertProviders(env);
  assert.equal(r.sent, 3);
  assert.equal(sent.length, 3);
});

test('مزوّد بلا مركز أو مركزه بلا بوابة يُنبَّه عنه دائماً', async () => {
  const { env, make } = await world();
  await make({ centerId: 2 }); // مركز 2 بلا أجهزة
  const r = await alertProviders(env);
  assert.equal(r.fresh, 1);
});

test('المفتاح العام للإشعارات يعطّل البريد، وبلا بريد مضبوط لا شيء', async () => {
  const { env, db, sent, make, ping } = await world();
  await make();
  await ping(1);
  await db.prepare("INSERT INTO settings (key, value) VALUES ('requests', ?)").bind(JSON.stringify({ notify: { enabled: false } })).run();
  assert.equal((await alertProviders(env)).reason, 'disabled');
  assert.equal(sent.length, 0);
  delete env.__MAILER;
  assert.equal((await alertProviders(env)).reason, 'no_mail');
});

test('عطلة رسمية أو إغلاق طارئ: لا تنبيه', async () => {
  const { env, db, make, ping } = await world();
  await make();
  await ping(1);
  await db.prepare("INSERT INTO holidays (date, name) VALUES (?, 'عطلة')").bind(MON).run();
  assert.deepEqual(await alertProviders(env), { noshow: 0, fresh: 0, sent: 0 });
});

test('المهمة المجدولة المسائية تنبّه عن حصص المساء، والصباحية تنبّه أيضاً', async () => {
  const { env, db, sent, make } = await world();
  await make({ schedule: [{ weekday: 1, start: '16:00', end: '19:00' }] });
  await db.prepare("UPDATE devices SET active = 0").run(); // لا بوابة => ننبّه
  env.__NOW = at('16:30');
  const ctx = { waiting: [], waitUntil(p) { this.waiting.push(p); } };
  await worker.scheduled({ cron: '*/30 14-17 * * *', scheduledTime: Date.parse(at('16:30')) }, env, ctx);
  await Promise.all(ctx.waiting);
  assert.equal(sent.length, 3);
  assert.ok(await db.prepare("SELECT 1 FROM audit_log WHERE action = 'provider.alert'").first());

  env.__NOW = at('06:30');
  sent.length = 0;
  await db.prepare('DELETE FROM provider_alerts').run();
  const ctx2 = { waiting: [], waitUntil(p) { this.waiting.push(p); } };
  await worker.scheduled({ cron: '*/30 4-13 * * *', scheduledTime: Date.parse(at('06:30')) }, env, ctx2);
  await Promise.all(ctx2.waiting);
  assert.equal(sent.length, 0, 'الحصة مساءً: لا شيء صباحاً');
});

test('صياغة الرسالة تدعم عدة مزوّدين', () => {
  const items = [
    { name: 'أ', center: 'م1', session: { start: '09:00', end: '12:00' }, sinceMin: 30 },
    { name: 'ب', center: '', session: { start: '10:00', end: '11:00' }, sinceMin: 15 },
  ];
  const m = alertMessage(items, 'https://x.test');
  assert.match(m.subject, /لم يحضر 2 من مزوّدي الخدمة/);
  assert.equal(m.text.split('•').length - 1, 2);
});
