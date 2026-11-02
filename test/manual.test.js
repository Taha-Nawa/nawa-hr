import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';
import { setWork, addHolidays, addEmployee } from './helpers/seed.js';

// «اليوم»: السبت 2026-11-07 (الجمعة والسبت عطلة أسبوعية). أيام الدوام 11-01..11-05 سبقت.
const NOW = '2026-11-07T07:00:00Z';
const SETTINGS = {
  start: '08:30', end: '15:00', toleranceMinutes: 10,
  weekdays: ['عمل', 'عمل', 'عمل', 'عمل', 'عمل', 'عطلة أسبوعية', 'عطلة أسبوعية'],
  leaveTypes: { 'إجازة سنوية': true, 'إجازة مرضية': true, 'إجازة رسمية / طارئة': true, 'إجازة بدون راتب': false },
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
    director: await login(db, 'dir@nawaculture.org', 'director', null),
    admin: await login(db, 'adm@nawaculture.org', 'admin', null),
  };
  return { db, env, u, sent };
}
const post = (env, who, path, body) => call(env, 'POST', path, { cookie: who.cookie, body });
const manual = (env, who, body) => post(env, who, '/api/attendance/manual', { reason: 'نسي التسجيل', ...body });
const day = (db, e, d) => db.prepare('SELECT status, check_in AS ci, departure AS dep, approved_hours AS ap, source, alert FROM daily_results WHERE employee_id = ? AND date = ?').bind(e, d).first();
const ovr = (db, e, d) => db.prepare('SELECT in_time AS i, out_time AS o, ret_time AS r, dep_time AS p, leave_type AS t, request_id AS rid, reason FROM day_overrides WHERE employee_id = ? AND date = ?').bind(e, d).first();

test('تسجيل حضور وانصراف يدوياً لعدة موظفين ولمدى أيام: يُحسب دوام كاملاً بمصدر «يدوي» ويُسجَّل في التدقيق بسببه', async () => {
  const { db, env, u } = await world();
  const r = await manual(env, u.hr, { employeeIds: [2, 3], from: '2026-11-01', to: '2026-11-03', set: { in: '08:30', dep: '15:00' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.employees, r.body.days, r.body.pairs], [2, 3, 6]);
  for (const e of [2, 3]) for (const d of ['2026-11-01', '2026-11-02', '2026-11-03']) {
    assert.deepEqual(await day(db, e, d), { status: 'حاضر', ci: '08:30', dep: '15:00', ap: 6.5, source: 'يدوي', alert: '' });
  }
  const log = await db.prepare("SELECT actor, detail FROM audit_log WHERE action = 'manual.attendance'").first();
  assert.equal(log.actor, 'hr@nawaculture.org');
  assert.match(log.detail, /نسي التسجيل/);
});

test('تعديل جزئي: الحقل غير المذكور لا يُمسّ والفارغ يمسحه؛ و«المسح» يعيد اليوم إلى حركات البوابة', async () => {
  const { db, env, u } = await world();
  await manual(env, u.hr, { employeeIds: [2], from: '2026-11-02', to: '2026-11-02', set: { in: '09:00', dep: '14:00' } });
  await manual(env, u.hr, { employeeIds: [2], from: '2026-11-02', to: '2026-11-02', set: { dep: '15:00' } });
  assert.deepEqual(await ovr(db, 2, '2026-11-02'), { i: '09:00', o: null, r: null, p: '15:00', t: null, rid: null, reason: 'يدوي: نسي التسجيل' });
  assert.equal((await day(db, 2, '2026-11-02')).status, 'متأخر');
  await manual(env, u.hr, { employeeIds: [2], from: '2026-11-02', to: '2026-11-02', set: { in: '' } });
  assert.equal((await ovr(db, 2, '2026-11-02')).i, null);
  const c = await manual(env, u.hr, { employeeIds: [2], from: '2026-11-02', to: '2026-11-02', clear: true });
  assert.equal(c.status, 200);
  assert.equal(await ovr(db, 2, '2026-11-02'), null, 'صف فارغ يُحذف');
  assert.equal((await day(db, 2, '2026-11-02')).status, 'غياب', 'عاد إلى غياب بلا حركات');
});

test('تغيير الحالة بنوع إجازة يدوي (بلا طلب)، وإزالته، ولا يمسّه «المسح» إن كان تابعاً لطلب', async () => {
  const { db, env, u } = await world();
  const a = await manual(env, u.hr, { employeeIds: [3], from: '2026-11-03', to: '2026-11-04', leaveType: 'إجازة مرضية' });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.deepEqual((await day(db, 3, '2026-11-04')).status, 'إجازة مرضية');
  assert.equal((await ovr(db, 3, '2026-11-04')).rid, null);
  assert.equal((await manual(env, u.hr, { employeeIds: [3], from: '2026-11-03', to: '2026-11-04', leaveType: 'نوع غير موجود' })).status, 400);
  await manual(env, u.hr, { employeeIds: [3], from: '2026-11-03', to: '2026-11-04', leaveType: '' });
  assert.equal(await ovr(db, 3, '2026-11-03'), null);
  assert.equal((await day(db, 3, '2026-11-03')).status, 'غياب');

  // إجازة بطلب معتمد: المسح لا يلغيها
  const g = await post(env, u.hr, '/api/requests', { kind: 'leave', purpose: 'annual', reason: 'سفر', fromDate: '2026-11-05', toDate: '2026-11-05', employeeId: 3, approve: true });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  await manual(env, u.hr, { employeeIds: [3], from: '2026-11-05', to: '2026-11-05', clear: true });
  assert.equal((await day(db, 3, '2026-11-05')).status, 'إجازة سنوية');
});

test('أيام العطلة تُتخطّى افتراضياً وتُضمَّن بطلب صريح؛ والعطل الرسمية كذلك', async () => {
  const { db, env, u } = await world();
  await addHolidays(db, ['2026-11-02']);
  const r = await manual(env, u.hr, { employeeIds: [2], from: '2026-11-01', to: '2026-11-07', set: { in: '08:30', dep: '15:00' } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.days, r.body.skippedOffDays], [4, 3]); // 1،3،4،5 دوام؛ 2 عطلة رسمية؛ 6،7 عطلة أسبوعية
  assert.equal(await ovr(db, 2, '2026-11-06'), null);
  const only = await manual(env, u.hr, { employeeIds: [2], from: '2026-11-06', to: '2026-11-06', set: { in: '09:00', dep: '12:00' } });
  assert.equal(only.status, 400, 'كل الأيام عطلة');
  const inc = await manual(env, u.hr, { employeeIds: [2], from: '2026-11-06', to: '2026-11-06', set: { in: '09:00', dep: '12:00' }, includeOffDays: true });
  assert.equal(inc.status, 200);
  assert.equal((await day(db, 2, '2026-11-06')).ci, '09:00');
});

test('إجازة معتمدة على اليوم: يُرفض بقائمة التعارض، ومع التأكيد يُفرَج عن ذلك اليوم من الطلب ويُشعَر الموظف', async () => {
  const { db, env, u, sent } = await world();
  const g = await post(env, u.hr, '/api/requests', { kind: 'leave', purpose: 'annual', reason: 'سفر', fromDate: '2026-11-03', toDate: '2026-11-04', employeeId: 2, approve: true });
  const id = g.body.id;
  sent.length = 0;
  const body = { employeeIds: [2], from: '2026-11-03', to: '2026-11-03', set: { in: '08:30', dep: '15:00' } };
  const no = await manual(env, u.hr, body);
  assert.equal(no.status, 409);
  assert.equal(no.body.needsRelease, true);
  assert.deepEqual(no.body.conflicts.map((c) => [c.employeeId, c.date, c.requestId]), [[2, '2026-11-03', id]]);
  assert.equal((await day(db, 2, '2026-11-03')).status, 'إجازة سنوية', 'لم يتغير شيء');

  const yes = await manual(env, u.hr, { ...body, releaseLeave: true });
  assert.equal(yes.status, 200, JSON.stringify(yes.body));
  assert.equal(yes.body.releasedLeaveDays, 1);
  assert.equal((await day(db, 2, '2026-11-03')).status, 'حاضر');
  assert.equal((await day(db, 2, '2026-11-04')).status, 'إجازة سنوية');
  assert.equal((await db.prepare('SELECT days FROM requests WHERE id = ?').bind(id).first()).days, 1);
  assert.deepEqual((await db.prepare('SELECT date, source FROM leave_released WHERE request_id = ?').bind(id).all()).results.map((x) => [x.date, x.source]), [['2026-11-03', 'manual']]);
  assert.ok(sent.some((m) => m.to === 'emp2@nawaculture.org' && /أُلغيت إجازة/.test(m.subject)));
});

test('التحقق: السبب إلزامي، لا مستقبل، ترتيب الأوقات، حدود المدى والعدد، تعارض المسح مع القيم، موظف غير موجود', async () => {
  const { db, env, u } = await world();
  for (let i = 5; i <= 10; i++) await addEmployee(db, { id: i, code: `NW-00${i}` });
  const ok = { employeeIds: [2], from: '2026-11-02', to: '2026-11-02', set: { in: '08:30' } };
  const s = async (extra, who = u.hr) => (await post(env, who, '/api/attendance/manual', { ...ok, reason: 'سبب كافٍ', ...extra })).status;
  assert.equal(await s({ reason: '' }), 400);
  assert.equal(await s({ reason: 'ab' }), 400);
  assert.equal(await s({ to: '2026-11-08' }), 400, 'مستقبل');
  assert.equal(await s({ from: '2025-01-01', to: '2025-01-02' }), 400, 'أقدم من سنة');
  assert.equal(await s({ from: '2026-10-01', to: '2026-11-05' }), 400, 'أكثر من 31 يوماً');
  assert.equal(await s({ set: { in: '10:00', dep: '09:00' } }), 400);
  assert.equal(await s({ set: { in: '25:00' } }), 400);
  assert.equal(await s({ set: {} }), 400, 'لا تغيير');
  assert.equal(await s({ clear: true }), 400, 'مسح مع قيم');
  assert.equal(await s({ employeeIds: [] }), 400);
  assert.equal(await s({ employeeIds: [2, 999] }), 404);
  assert.equal(await s({ employeeIds: Array.from({ length: 101 }, (_, i) => i + 1) }), 400);
  assert.equal(await s({ employeeIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], from: '2026-10-05', to: '2026-11-03' }), 400, 'أكثر من 200 يوم-موظف');
  assert.equal(await s({}, u.hr), 200);
  assert.equal(await s({}, u.emp2), 403);
  assert.equal(await s({}, u.mgr), 403);
  assert.equal(await s({}, u.director), 403);
  assert.equal(await s({}, u.admin), 200);
});
