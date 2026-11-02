import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshEnv, setWork, gateGet, DEVICE_TOKEN, addEmployee, addHolidays } from './helpers/seed.js';
import { gateStatus, alertGates } from '../src/worker/gates.js';

const SETTINGS = { start: '08:30', end: '15:00', toleranceMinutes: 10, weekdays: ['عمل', 'عمل', 'عمل', 'عمل', 'عمل', 'عطلة أسبوعية', 'عطلة أسبوعية'], leaveTypes: { 'إجازة سنوية': true } };
const MON_1030 = new Date('2026-11-02T08:30:00Z'); // الإثنين 10:30 بتوقيت الخليل (UTC+2)
const ago = (min, from = MON_1030) => new Date(from.getTime() - min * 60000).toISOString().replace('T', ' ').slice(0, 19);

async function world() {
  const { db, env } = await freshEnv({ withSettings: false });
  await setWork(db, SETTINGS);
  env.TIMEZONE = 'Asia/Hebron';
  return { db, env };
}
const setDev = (db, patch) => db.prepare('UPDATE devices SET last_seen = ?, last_ping = ? WHERE id = ?').bind(patch.lastSeen ?? null, patch.lastPing ?? null, 'DEV-01').run();
const state = async (env, now = MON_1030) => (await gateStatus(env, now)).devices[0].state;

test('نبض حديث = متصلة؛ نبض أقدم من 20 دقيقة أثناء الدوام = منقطعة', async () => {
  const { db, env } = await world();
  await setDev(db, { lastPing: ago(5) });
  assert.equal(await state(env), 'ok');
  await setDev(db, { lastPing: ago(40) });
  const st = await gateStatus(env, MON_1030);
  assert.equal(st.devices[0].state, 'silent');
  assert.equal(st.devices[0].minutesSincePing, 40);
  assert.equal(st.problems.length, 1);
});

test('بلا نبض قط: لا تُتّهم قبل ساعتين من الدوام ولا إن سُجّلت منها حركة، وتُوصف «هادئة» إن لم تسجّل شيئاً', async () => {
  const { db, env } = await world();
  await setDev(db, { lastSeen: '2026-11-01 10:00:00' }); // اتصلت أمس فقط
  assert.equal(await state(env), 'quiet'); // 10:30 ≥ 08:30 + ساعتان، ولا حركة اليوم
  assert.equal(await state(env, new Date('2026-11-02T07:00:00Z')), 'ok'); // 09:00: مبكر
  await addEmployee(db, { id: 1, code: 'NW-001' });
  await db.prepare("INSERT INTO movements (id, employee_id, code, type, date, time, device_id) VALUES ('m1', 1, 'NW-001', 'حضور', '2026-11-02', '08:20', 'DEV-01')").run();
  assert.equal(await state(env), 'ok');
});

test('لم تتصل قط: «never» ولا تُعدّ مشكلة', async () => {
  const { env } = await world();
  const st = await gateStatus(env, MON_1030);
  assert.equal(st.devices[0].state, 'never');
  assert.equal(st.problems.length, 0);
});

test('خارج الدوام وفي العطلة الأسبوعية والعطل الرسمية وعند إعلان طارئ: لا تنبيه', async () => {
  const { db, env } = await world();
  await setDev(db, { lastPing: ago(300) });
  assert.equal(await state(env, new Date('2026-11-02T05:00:00Z')), 'off'); // 07:00 قبل الدوام
  assert.equal(await state(env, new Date('2026-11-02T14:00:00Z')), 'off'); // 16:00 بعد الدوام
  assert.equal(await state(env, new Date('2026-11-06T08:30:00Z')), 'off'); // الجمعة
  await addHolidays(db, ['2026-11-02']);
  assert.equal(await state(env), 'off');
  await db.prepare("DELETE FROM holidays").run();
  assert.equal(await state(env), 'silent');
  await db.prepare("INSERT INTO emergencies (date, center_id, dismiss_time, note, created_by) VALUES ('2026-11-02', NULL, '10:00', 'x', 'a@b.org')").run();
  assert.equal(await state(env), 'emergency');
});

test('ping من البوابة يُسجّل النبض (ولا يُحدّث last_seen)', async () => {
  const { db } = await world();
  const env = { DB: db };
  const r = await gateGet(env, `action=ping&token=${DEVICE_TOKEN}`);
  assert.equal(r.status, 200);
  const row = await db.prepare("SELECT last_ping p, last_seen s FROM devices WHERE id = 'DEV-01'").first();
  assert.ok(row.p);
  assert.equal(row.s, null);
  const bad = await gateGet(env, 'action=ping&token=wrong-token-wrong-token');
  assert.equal(bad.status, 401);
});

test('التنبيه بالبريد: مرة واحدة يومياً لكل بوابة، للمسؤولين فقط، ويُسجَّل', async () => {
  const { db, env } = await world();
  const sent = [];
  env.__MAILER = { kind: 'test', send: async (m) => { sent.push(m); } };
  await db.prepare("INSERT INTO users (email, role) VALUES ('adm@nawaculture.org', 'admin'), ('hr@nawaculture.org', 'hr'), ('off@nawaculture.org', 'admin')").run();
  await db.prepare("UPDATE users SET active = 0 WHERE email = 'off@nawaculture.org'").run();
  await setDev(db, { lastPing: ago(45) });
  const r1 = await alertGates(env, { now: MON_1030 });
  assert.equal(r1.problems, 1);
  assert.equal(r1.notified, 1);
  assert.deepEqual(sent.map((m) => m.to), ['adm@nawaculture.org']);
  assert.match(sent[0].subject, /بوابة بوابة 1 غير متصلة/);
  assert.match(sent[0].text, /45 دقيقة/);
  const r2 = await alertGates(env, { now: new Date(MON_1030.getTime() + 30 * 60000) });
  assert.equal(r2.notified, 0);
  assert.equal(sent.length, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'gate.alert'").first()).n, 1);
  // يوم جديد: يتكرر
  const next = new Date('2026-11-03T08:30:00Z');
  await setDev(db, { lastPing: ago(45, next) });
  assert.equal((await alertGates(env, { now: next })).notified, 1);
});

test('بلا بريد مُعدّ أو بلا مشكلة: لا إرسال ولا أخطاء', async () => {
  const { db, env } = await world();
  await setDev(db, { lastPing: ago(45) });
  const r = await alertGates(env, { now: MON_1030 });
  assert.equal(r.notified, 0);
  assert.equal(r.reason, 'no_mail');
  env.__MAILER = { send: async () => assert.fail('لا يجوز الإرسال') };
  await setDev(db, { lastPing: ago(2) });
  assert.deepEqual(await alertGates(env, { now: MON_1030 }), { problems: 0, notified: 0 });
});
