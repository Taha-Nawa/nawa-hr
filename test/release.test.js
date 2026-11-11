import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';
import { setWork, gatePost, mv, addEmployee } from './helpers/seed.js';

// «اليوم»: الجمعة 2026-11-06؛ أيام العمل الأحد..الخميس. إجازة الأحد→الثلاثاء 11-01..11-03 سبقت.
const NOW = '2026-11-06T07:00:00Z';
const SETTINGS = {
  start: '08:30', end: '15:00', toleranceMinutes: 10,
  weekdays: ['عمل', 'عمل', 'عمل', 'عمل', 'عمل', 'عطلة أسبوعية', 'عطلة أسبوعية'],
  leaveTypes: { 'إجازة سنوية': true, 'إجازة مرضية': true, 'إجازة رسمية / طارئة': true },
};

async function world() {
  const { db, env } = await apiEnv();
  env.__NOW = NOW;
  const sent = [];
  env.__MAILER = { kind: 'test', send: async (m) => { sent.push(m); } };
  await setWork(db, SETTINGS);
  await seedOrg(db);
  const u = {
    emp2: await login(db, 'emp2@nawaculture.org', 'employee', 2),
    mgr: await login(db, 'mgr@nawaculture.org', 'manager', 1),
    hr: await login(db, 'hr@nawaculture.org', 'hr', 4),
    admin: await login(db, 'adm@nawaculture.org', 'admin', null),
  };
  return { db, env, u, sent };
}
const post = (env, who, path, body) => call(env, 'POST', path, { cookie: who.cookie, body });
const get = (env, who, path) => call(env, 'GET', path, { cookie: who.cookie });
const grant = async (env, who, employeeId, fromDate, toDate, extra = {}) => {
  const r = await post(env, who, '/api/requests', { kind: 'leave', purpose: 'annual', reason: 'سفر', fromDate, toDate, employeeId, approve: true, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id;
};
const reqRow = (db, id) => db.prepare('SELECT status, days, decided_by AS by, decision_note AS note FROM requests WHERE id = ?').bind(id).first();
const dayRow = (db, e, d) => db.prepare('SELECT status, check_in AS ci, alert FROM daily_results WHERE employee_id = ? AND date = ?').bind(e, d).first();
const overrides = async (db, id) => (await db.prepare('SELECT date, leave_type AS t FROM day_overrides WHERE request_id = ? ORDER BY date').bind(id).all()).results.map((r) => r.date);

test('دخول فعلي في منتصف إجازة معتمدة يُفرج عن ذلك اليوم وحده ويعيده إلى الرصيد ويُحتسب حضوراً', async () => {
  const { db, env, u, sent } = await world();
  await post(env, u.hr, '/api/balances', null).catch(() => {});
  await call(env, 'PUT', '/api/balances', { cookie: u.hr.cookie, body: { year: 2026, employeeIds: [2], items: { annual: 10 } } });
  const id = await grant(env, u.hr, 2, '2026-11-01', '2026-11-03');
  assert.deepEqual(await overrides(db, id), ['2026-11-01', '2026-11-02', '2026-11-03']);
  sent.length = 0;

  const g = await gatePost(env, [mv('NW-002', 'حضور', '2026-11-02', '08:30')]);
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.equal(g.body.releasedLeaveDays, 1);

  assert.deepEqual(await overrides(db, id), ['2026-11-01', '2026-11-03']);
  assert.deepEqual(await reqRow(db, id), { status: 'approved', days: 2, by: 'hr@nawaculture.org', note: null });
  assert.deepEqual(await dayRow(db, 2, '2026-11-02'), { status: 'حاضر', ci: '08:30', alert: 'انصراف غير مسجّل' }, 'يوم حضور لا إجازة');
  assert.equal((await dayRow(db, 2, '2026-11-01')).status, 'إجازة سنوية', 'بقية الأيام إجازة كما هي');

  const b = (await get(env, u.hr, '/api/balances?year=2026')).body.employees.find((e) => e.id === 2).balances.annual;
  assert.deepEqual([b.total, b.used, b.remaining], [10, 2, 8], 'عاد يوم إلى الرصيد');

  const d = (await get(env, u.hr, `/api/requests/${id}`)).body;
  assert.deepEqual(d.released.map((x) => [x.date, x.source]), [['2026-11-02', 'checkin']]);
  const log = await db.prepare("SELECT actor, detail FROM audit_log WHERE action = 'request.release-day'").first();
  assert.equal(log.actor, 'system');
  assert.match(log.detail, /2026-11-02/);

  // إشعار: الموظف ومديرته ومن اعتمد (ولا يتكرر عنوان)
  assert.deepEqual(sent.map((m) => m.to).sort(), ['emp2@nawaculture.org', 'hr@nawaculture.org', 'mgr@nawaculture.org']);
  assert.match(sent[0].subject, /أُلغيت إجازة/);
  assert.match(sent[0].text, /2026-11-02/);
});

test('إجازة يوم واحد: الدخول الفعلي يُلغي الطلب كله بسبب مكتوب، وإعادة إرسال الحركة نفسها لا تكرّر شيئاً', async () => {
  const { db, env, u } = await world();
  const id = await grant(env, u.hr, 2, '2026-11-03', '2026-11-03');
  const move = mv('NW-002', 'حضور', '2026-11-03', '08:35');
  assert.equal((await gatePost(env, [move])).body.releasedLeaveDays, 1);
  const r = await reqRow(db, id);
  assert.equal(r.status, 'cancelled');
  assert.match(r.note, /دخولاً فعلياً/);
  assert.deepEqual(await overrides(db, id), []);
  assert.equal((await dayRow(db, 2, '2026-11-03')).status, 'حاضر');
  const again = await gatePost(env, [move]);
  assert.equal(again.body.releasedLeaveDays, undefined);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM leave_released').first()).n, 1);
  // إلغاء الاعتماد بعدها لا يجد ما يزيله ولا يفشل
  assert.equal((await post(env, u.hr, `/api/requests/${id}/cancel`, {})).status, 409);
});

test('الأنواع الأخرى من الحركات (انصراف، خروج) لا تُلغي الإجازة؛ وإيقاف القاعدة من الإعدادات يُبقيها', async () => {
  const { db, env, u } = await world();
  const id = await grant(env, u.hr, 2, '2026-11-02', '2026-11-03');
  await gatePost(env, [mv('NW-002', 'انصراف', '2026-11-02', '15:00'), mv('NW-002', 'خروج', '2026-11-02', '11:00')]);
  assert.equal((await reqRow(db, id)).days, 2, 'غير الحضور لا يلغي');

  const off = await call(env, 'PUT', '/api/settings/requests', { cookie: u.admin.cookie, body: { rules: { leave: { cancelOnCheckIn: false } } } });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal(off.body.rules.leave.cancelOnCheckIn, false);
  const g = await gatePost(env, [mv('NW-002', 'حضور', '2026-11-03', '08:30')]);
  assert.equal(g.body.releasedLeaveDays, undefined);
  assert.deepEqual(await overrides(db, id), ['2026-11-02', '2026-11-03']);
  assert.equal((await dayRow(db, 2, '2026-11-03')).status, 'إجازة سنوية');
});

test('تصحيح يدوي بأوقات على يوم الإجازة يبقى (يُنزع منه نوع الإجازة فقط)، والطلبات المعلّقة والمرفوضة لا تتأثر', async () => {
  const { db, env, u } = await world();
  const id = await grant(env, u.hr, 2, '2026-11-01', '2026-11-01');
  await db.prepare("UPDATE day_overrides SET dep_time = '12:00' WHERE request_id = ?").bind(id).run();
  const pend = (await post(env, u.emp2, '/api/requests', { kind: 'leave', purpose: 'annual', reason: 'x', fromDate: '2026-11-15', toDate: '2026-11-15' })).body.id;
  await gatePost(env, [mv('NW-002', 'حضور', '2026-11-01', '08:30'), mv('NW-002', 'حضور', '2026-11-15', '08:30')]);
  const o = await db.prepare("SELECT leave_type AS t, request_id AS r, dep_time AS dep FROM day_overrides WHERE employee_id = 2 AND date = '2026-11-01'").first();
  assert.deepEqual(o, { t: null, r: null, dep: '12:00' });
  assert.equal((await reqRow(db, id)).status, 'cancelled');
  assert.equal((await reqRow(db, pend)).status, 'pending');
  const day = await dayRow(db, 2, '2026-11-01');
  assert.equal(day.status, 'حاضر');
});

test('دفعة بوابة فيها عدة موظفين لهم إجازات: عدد الاستعلامات ثابت (ضمن حدّ 50) وكل إجازة تُفرَج لصاحبها', async () => {
  const { db, env, u } = await world();
  for (let i = 10; i < 22; i++) await addEmployee(db, { id: i, code: `NW-0${i}` });
  const ids = [];
  for (let i = 10; i < 22; i++) ids.push(await grant(env, u.hr, i, '2026-11-02', '2026-11-03'));
  const g = await gatePost(env, Array.from({ length: 12 }, (_, k) => mv(`NW-0${10 + k}`, 'حضور', '2026-11-02', '08:30')));
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.equal(g.body.releasedLeaveDays, 12);
  assert.ok(g.queries <= 45, `استعلامات ${g.queries}`);
  db.resetCount?.();
  for (const id of ids) assert.equal((await reqRow(db, id)).days, 1);
});
