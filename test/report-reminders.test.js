import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call, seedOrg, addUser } from './helpers/api.js';
import { addEmployee } from './helpers/seed.js';
import worker from '../src/worker/index.js';
import { reportReminders } from '../src/worker/report-reminders.js';
import { reportWindows } from '../src/engine/monthly-report.js';

test('نوافذ التذكير حسب اليوم', () => {
  const w = (d) => reportWindows(d);
  assert.deepEqual(w('2026-11-15'), { banner: [], mail: [] });
  assert.deepEqual(w('2026-11-23').banner, []);
  assert.deepEqual(w('2026-11-24').banner, [{ month: '2026-11', phase: 'soon' }]);
  assert.deepEqual(w('2026-11-24').mail, []);
  assert.deepEqual(w('2026-11-27').mail, [{ month: '2026-11', stage: 'eom' }]);
  assert.deepEqual(w('2026-11-30').mail, [{ month: '2026-11', stage: 'eom' }]);
  assert.deepEqual(w('2026-12-01').banner, [{ month: '2026-11', phase: 'overdue' }]);
  assert.deepEqual(w('2026-12-02').mail, []);
  assert.deepEqual(w('2026-12-03').mail, [{ month: '2026-11', stage: 'late' }]);
  assert.deepEqual(w('2026-12-08').mail, [{ month: '2026-11', stage: 'late' }, { month: '2026-11', stage: 'mgr' }]);
  assert.deepEqual(w('2026-12-14').banner, [{ month: '2026-11', phase: 'overdue' }]);
  assert.deepEqual(w('2026-12-15'), { banner: [], mail: [] });
  assert.deepEqual(w('2026-02-25').mail, [{ month: '2026-02', stage: 'eom' }]); // فبراير: 28 يوماً
  assert.deepEqual(w('2026-01-05').mail, [{ month: '2025-12', stage: 'late' }]);  // عبور السنة
});

function mailbox(env) {
  const sent = [];
  env.__MAILER = { send: async (m) => { sent.push(m); } };
  return sent;
}

async function world(now = '2026-11-27T06:00:00Z') {
  const { db, env } = await apiEnv();
  env.__NOW = now;
  await seedOrg(db);
  const u = {
    mgr: await login(db, 'm@nawaculture.org', 'manager', 1),
    e2: await login(db, 'e2@nawaculture.org', 'employee', 2),
    e3: await login(db, 'e3@nawaculture.org', 'employee', 3),
    hr: await login(db, 'hr@nawaculture.org', 'hr', null),
    adm: await login(db, 'a@nawaculture.org', 'admin', null),
  };
  return { db, env, u };
}
const submit = (env, who, id, month) => call(env, 'PUT', `/api/monthly-reports/${id}/${month}`, { cookie: who.cookie, body: { status: 'submitted', tasks: [{ title: 'مهمة', status: 'تم الإنجاز' }], meetings: [], next: [], attachments: [] } });
const to = (sent) => sent.map((m) => m.to).sort();

test('آخر الشهر: تذكير لمن لم يقدّم فقط، ولا يتكرر', async () => {
  const { env, u } = await world();
  const sent = mailbox(env);
  assert.equal((await submit(env, u.e3, 3, '2026-11')).status, 200);
  const r = await reportReminders(env);
  assert.deepEqual(r, { sent: 2, stages: { eom: 2 } });
  assert.deepEqual(to(sent), ['e2@nawaculture.org', 'm@nawaculture.org']);
  const m = sent.find((x) => x.to === 'e2@nawaculture.org');
  assert.match(m.subject, /نوفمبر 2026/);
  assert.match(m.text, /#\/monthly-report\/2\/2026-11/);
  assert.match(m.text, /ماذا أنجزت اليوم/);
  assert.equal((await reportReminders(env)).sent, 0, 'لا تكرار');
  assert.equal(sent.length, 2);
});

test('المسودة لا تكفي، والتقديم بعد التذكير يوقف ما بعده', async () => {
  const { env, u } = await world('2026-12-04T06:00:00Z');
  const sent = mailbox(env);
  await call(env, 'PUT', '/api/monthly-reports/2/2026-11', { cookie: u.e2.cookie, body: { status: 'draft', tasks: [{ title: 'مهمة', status: 'تم' }], meetings: [], next: [], attachments: [] } });
  const r = await reportReminders(env);
  assert.deepEqual(r, { sent: 3, stages: { late: 3 } });
  assert.deepEqual(to(sent), ['e2@nawaculture.org', 'e3@nawaculture.org', 'm@nawaculture.org']);
  assert.match(sent[0].subject, /لم يُقدَّم بعد/);
});

test('نشرة المدير والموارد البشرية: بمن لم يقدّم', async () => {
  const { env, u } = await world('2026-12-09T06:00:00Z');
  const sent = mailbox(env);
  await submit(env, u.e3, 3, '2026-11');
  const r = await reportReminders(env);
  assert.equal(r.stages.mgr, 2);
  const digests = sent.filter((m) => /لم يقدّموا بعد/.test(m.subject));
  assert.deepEqual(to(digests), ['hr@nawaculture.org', 'm@nawaculture.org']);
  const mgr = digests.find((m) => m.to === 'm@nawaculture.org');
  assert.match(mgr.text, /قدّم 1 من 2 من فريقك/);
  assert.match(mgr.text, /موظف أ/);
  assert.ok(!mgr.text.includes('موظف ب'), 'من قدّم لا يُذكر');
  assert.ok(!mgr.text.includes('موظف ج'), 'ليس من فريقه');
  const hr = digests.find((m) => m.to === 'hr@nawaculture.org');
  assert.match(hr.text, /قدّم 1 من 4 من الموظفين/);
  for (const n of ['موظف أ', 'موظف ج', 'المديرة']) assert.ok(hr.text.includes(n), n);
  assert.equal((await reportReminders(env)).sent, 0);
});

test('بلا بريد، أو خارج النافذة، أو الإشعارات موقوفة: لا شيء ويبقى ممكناً لاحقاً', async () => {
  const { db, env } = await world();
  assert.equal((await reportReminders(env)).reason, 'no_mail');
  const sent = mailbox(env);
  env.__NOW = '2026-11-15T06:00:00Z';
  assert.equal((await reportReminders(env)).reason, 'window');
  env.__NOW = '2026-11-27T06:00:00Z';
  await db.prepare("INSERT INTO settings (key, value) VALUES ('requests', ?)").bind(JSON.stringify({ notify: { enabled: false } })).run();
  assert.equal((await reportReminders(env)).reason, 'disabled');
  assert.equal(sent.length, 0);
  await db.prepare("DELETE FROM settings WHERE key = 'requests'").run();
  assert.equal((await reportReminders(env)).sent, 3);
});

test('فشل الإرسال لا يُسجَّل كمُرسَل فيُعاد في اليوم التالي، ويُبلَّغ عنه', async () => {
  const { db, env } = await world();
  env.__MAILER = { send: async () => { throw new Error('graph 403'); } };
  const r = await reportReminders(env);
  assert.equal(r.sent, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM report_reminders').first('n')), 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'mail.failed'").first('n')), 1);
  const sent = mailbox(env);
  assert.equal((await reportReminders(env)).sent, 3);
  assert.equal(sent.length, 3);
});

test('سقف الدفعة 25 والباقي يكمل في اليوم التالي، ومن عُيّن بعد الشهر لا يُذكَّر', async () => {
  const { db, env } = await world();
  const sent = mailbox(env);
  const seq = 'WITH RECURSIVE n(i) AS (SELECT 10 UNION ALL SELECT i + 1 FROM n WHERE i < 39)';
  await db.prepare(`${seq} INSERT INTO employees (id, code, name, center_id) SELECT i, 'NW-' || (100 + i), 'موظف ' || i, 1 FROM n`).run();
  await db.prepare(`${seq} INSERT INTO users (email, role, employee_id, active) SELECT 'x' || i || '@nawaculture.org', 'employee', i, 1 FROM n`).run();
  await addEmployee(db, { id: 90, code: 'NW-190', card: null });
  await db.prepare("UPDATE employees SET start_date = '2026-12-01' WHERE id = 90").run();
  await addUser(db, 'new@nawaculture.org', 'employee', 90);
  const run = () => { db.resetCount?.(); return reportReminders(env); };
  assert.equal((await run()).sent, 25);
  assert.equal((await run()).sent, 8, 'الباقي في اليوم التالي');
  assert.equal((await run()).sent, 0);
  const all = to(sent);
  assert.equal(new Set(all).size, all.length, 'لا بريد مكرر');
  assert.equal(all.length, 33, 'المدير وأ وب و30 مضافون');
  assert.ok(!all.includes('new@nawaculture.org'), 'عُيّن بعد الشهر');
});

test('المهمة المجدولة: تشغيل 05:00 UTC من مهمة البوابات يرسل التذكير، وغيره يراقب البوابات', async () => {
  const { env } = await world();
  const sent = mailbox(env);
  const jobs = [];
  const ctx = { waitUntil: (p) => jobs.push(p) };
  await worker.scheduled({ cron: '*/30 4-13 * * *', scheduledTime: Date.parse('2026-11-27T05:00:00Z') }, env, ctx);
  await Promise.all(jobs);
  assert.equal(sent.length, 3);
  jobs.length = 0;
  await worker.scheduled({ cron: '*/30 4-13 * * *', scheduledTime: Date.parse('2026-11-27T05:30:00Z') }, env, ctx);
  await Promise.all(jobs);
  assert.equal(sent.length, 3, 'بعد نصف ساعة لا تذكير');
});

test('تنبيه لوحة اليوم: شهر قارب الانتهاء ثم المتأخر، ويختفي بالتقديم', async () => {
  const { env, u } = await world('2026-11-27T06:00:00Z');
  const due = async (who) => (await call(env, 'GET', '/api/monthly-reports/due', { cookie: who.cookie })).body.items;
  assert.deepEqual(await due(u.e2), [{ month: '2026-11', phase: 'soon', status: 'none' }]);
  await call(env, 'PUT', '/api/monthly-reports/2/2026-11', { cookie: u.e2.cookie, body: { status: 'draft', tasks: [{ title: 'م', status: 'تم' }], meetings: [], next: [], attachments: [] } });
  assert.deepEqual(await due(u.e2), [{ month: '2026-11', phase: 'soon', status: 'draft' }]);
  await submit(env, u.e2, 2, '2026-11');
  assert.deepEqual(await due(u.e2), []);
  assert.deepEqual(await due(u.adm), [], 'حساب بلا بطاقة موظف');
  env.__NOW = '2026-12-05T06:00:00Z';
  assert.deepEqual(await due(u.e3), [{ month: '2026-11', phase: 'overdue', status: 'none' }]);
  assert.deepEqual(await due(u.e2), []);
  env.__NOW = '2026-12-16T06:00:00Z';
  assert.deepEqual(await due(u.e3), []);
});
