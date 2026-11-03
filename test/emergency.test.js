import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';
import { setWork, addEmployee, addOverride, addHolidays } from './helpers/seed.js';

// «اليوم»: الإثنين 2026-11-02 الساعة 09:00 بتوقيت الخليل. الأحد 2026-11-01 يوم دوام مضى.
const NOW = '2026-11-02T07:00:00Z';
const DAY = '2026-11-01';
const SETTINGS = {
  start: '08:30', end: '15:00', toleranceMinutes: 10,
  weekdays: ['عمل', 'عمل', 'عمل', 'عمل', 'عمل', 'عطلة أسبوعية', 'عطلة أسبوعية'],
  leaveTypes: { 'إجازة سنوية': true, 'إجازة مرضية': true, 'إجازة رسمية / طارئة': true, 'إجازة بدون راتب': false },
};
const EMG = 'إجازة رسمية / طارئة';

async function world() {
  const { db, env } = await apiEnv();
  env.__NOW = NOW;
  await setWork(db, SETTINGS);
  await seedOrg(db); // 1..4 في المركز 1
  await addEmployee(db, { id: 5, code: 'NW-005', centerId: 2 });
  const u = {
    emp2: await login(db, 'emp2@nawaculture.org', 'employee', 2),
    mgr: await login(db, 'mgr@nawaculture.org', 'manager', 1),
    hr: await login(db, 'hr@nawaculture.org', 'hr', 4),
    director: await login(db, 'dir@nawaculture.org', 'director', null),
    admin: await login(db, 'adm@nawaculture.org', 'admin', null),
  };
  return { db, env, u };
}
const post = (env, who, path, body) => call(env, 'POST', path, { cookie: who.cookie, body });
const get = (env, who, path) => call(env, 'GET', path, { cookie: who.cookie });
const day = (db, id, date = DAY) =>
  db.prepare('SELECT status, departure, required_hours AS req, approved_hours AS ap, deficit_hours AS def, early_leave_minutes AS early, alert FROM daily_results WHERE employee_id = ? AND date = ?').bind(id, date).first();
const materialize = async (env, u, date = DAY) => assert.equal((await post(env, u.hr, '/api/recompute', { from: date, to: date })).status, 200);

test('إخلاء فوري لمركز: دوامه ينتهي عند الوقت المعلَن ولا يتأثر مركز آخر، والإلغاء يعيد الحساب الأصلي', async () => {
  const { db, env, u } = await world();
  await addOverride(db, 2, DAY, { manual: { in: '08:30' } }); // حضر وخرج مسرعاً بلا تسجيل انصراف
  await addOverride(db, 5, DAY, { manual: { in: '08:30' } }); // مركز آخر، الحالة نفسها
  await materialize(env, u);
  assert.equal((await day(db, 2)).def, 6.5, 'قبل الإعلان: انصراف غير مسجّل = عجز كامل');

  const r = await post(env, u.hr, '/api/emergencies', { date: DAY, centerId: 1, dismissTime: '11:00', note: 'حريق قريب' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.employees >= 4);
  assert.deepEqual(await day(db, 2), { status: 'حاضر', departure: '11:00', req: 2.5, ap: 2.5, def: 0, early: 0, alert: '' });
  assert.equal((await day(db, 5)).def, 6.5, 'مركز الزيتونة لم يُعلَن عليه');

  const c = await post(env, u.admin, `/api/emergencies/${r.body.id}/cancel`, {});
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.deepEqual([(await day(db, 2)).def, (await day(db, 2)).alert], [6.5, 'انصراف غير مسجّل'], 'عاد كما كان');
  assert.equal((await post(env, u.admin, `/api/emergencies/${r.body.id}/cancel`, {})).status, 409, 'لا يُلغى مرتين');
  const actions = (await db.prepare("SELECT action FROM audit_log WHERE action LIKE 'emergency.%' ORDER BY id").all()).results.map((x) => x.action);
  assert.deepEqual(actions, ['emergency.declare', 'emergency.cancel']);
});

test('احتساب اليوم كاملاً لكل المراكز بنوع يختاره المسؤول، ولا يمسّ إجازة معتمدة، والإلغاء يزيل أثره فقط', async () => {
  const { db, env, u } = await world();
  // موظف 3 عليه إجازة سنوية معتمدة في اليوم نفسه؛ موظف 2 عليه تصحيح يدوي بأوقات
  const g = await post(env, u.hr, '/api/requests', { kind: 'leave', purpose: 'annual', employeeId: 3, fromDate: DAY, toDate: DAY, approve: true });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  await addOverride(db, 2, DAY, { manual: { in: '08:30', dep: '10:00' } });
  await materialize(env, u);
  assert.equal((await day(db, 2)).def > 0, true);

  const r = await post(env, u.admin, '/api/emergencies', { date: DAY, centerId: null, leaveType: EMG, note: 'إغلاق بسبب الأحداث' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  for (const id of [1, 2, 4, 5]) assert.deepEqual([(await day(db, id)).status, (await day(db, id)).ap, (await day(db, id)).def], [EMG, 6.5, 0], `موظف ${id}`);
  assert.equal((await day(db, 3)).status, 'إجازة سنوية', 'الإجازة المعتمدة لم تُستبدل');
  const keep = await db.prepare('SELECT in_time, dep_time, leave_type FROM day_overrides WHERE employee_id = 2 AND date = ?').bind(DAY).first();
  assert.deepEqual(keep, { in_time: '08:30', dep_time: '10:00', leave_type: EMG }, 'أوقات التصحيح اليدوي محفوظة');

  assert.equal((await post(env, u.hr, `/api/emergencies/${r.body.id}/cancel`, {})).status, 200);
  assert.equal((await day(db, 5)).status, 'غياب', 'عاد غياباً');
  assert.equal((await day(db, 3)).status, 'إجازة سنوية', 'إجازته باقية');
  assert.equal((await day(db, 2)).status, 'حاضر', 'وأوقاته باقية');
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM day_overrides WHERE emergency_id IS NOT NULL').first('n'), 0);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM day_overrides WHERE employee_id = 5 AND date = ?').bind(DAY).first('n'), 0, 'السطر الذي أنشأه الإعلان حُذف');
});

test('الإخلاء مع الاحتساب الكامل: الإجازة هي التي تحكم اليوم، وتعدّد الإعلانات يأخذ أبكر إخلاء', async () => {
  const { db, env, u } = await world();
  await addOverride(db, 2, DAY, { manual: { in: '08:30' } });
  await addOverride(db, 5, DAY, { manual: { in: '08:30' } });
  await materialize(env, u);
  assert.equal((await post(env, u.hr, '/api/emergencies', { date: DAY, centerId: 1, dismissTime: '11:00', leaveType: EMG })).status, 201);
  assert.deepEqual([(await day(db, 2)).status, (await day(db, 2)).req, (await day(db, 2)).ap], [EMG, 6.5, 6.5]);

  // إعلان لكل المراكز عند 12:00 ثم إعلان للمركز 2 عند 10:00: الأبكر يحكم موظفي المركز 2
  assert.equal((await post(env, u.hr, '/api/emergencies', { date: DAY, dismissTime: '12:00' })).status, 201);
  assert.equal((await post(env, u.hr, '/api/emergencies', { date: DAY, centerId: 2, dismissTime: '10:00' })).status, 201);
  assert.equal((await day(db, 5)).req, 1.5, 'مركز 2: أبكر الإعلانين 10:00 → 8:30–10:00');
  assert.equal((await day(db, 5)).def, 0);
});

test('التحقق من الإعلان: التاريخ والعطلة والوقت والنوع والمركز والتكرار والصلاحية', async () => {
  const { db, env, u } = await world();
  await addHolidays(db, ['2026-10-28']);
  const ok = { date: DAY, centerId: 1, dismissTime: '11:00' };
  const status = async (over, who = u.hr) => (await post(env, who, '/api/emergencies', { ...ok, ...over })).status;
  assert.equal(await status({ date: '2099-01-05' }), 400, 'يوم لم يأتِ');
  assert.equal(await status({ date: 'x' }), 400);
  assert.equal(await status({ date: '2026-10-30' }), 400, 'جمعة: عطلة أسبوعية');
  assert.equal(await status({ date: '2026-10-28' }), 400, 'عطلة رسمية');
  assert.equal(await status({ date: '2024-01-01' }), 400, 'أقدم من سنة');
  assert.equal(await status({ dismissTime: '08:30' }), 400, 'عند بداية الدوام لا معنى');
  assert.equal(await status({ dismissTime: '15:00' }), 400, 'عند نهايته لا معنى');
  assert.equal(await status({ dismissTime: '25:00' }), 400);
  assert.equal(await status({ dismissTime: null, leaveType: null }), 400, 'لا إخلاء ولا احتساب');
  assert.equal(await status({ leaveType: 'إجازة غير موجودة' }), 400);
  assert.equal(await status({ centerId: 99 }), 404);
  for (const who of [u.emp2, u.mgr, u.director]) assert.equal(await status({}, who), 403);
  assert.equal(await status({}), 201);
  assert.equal(await status({}, u.admin), 409, 'إعلان نشط لنفس اليوم والمركز');
  assert.equal(await status({ centerId: null }), 201, 'نطاق مختلف مقبول');
});

test('القائمة: للموارد البشرية والمدير العام والمسؤول فقط', async () => {
  const { env, u } = await world();
  await post(env, u.hr, '/api/emergencies', { date: DAY, centerId: 1, dismissTime: '11:00', note: 'اختبار' });
  const r = await get(env, u.director, '/api/emergencies');
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.emergencies[0].date, r.body.emergencies[0].center, r.body.emergencies[0].status, r.body.canManage], [DAY, 'المبنى الرئيسي', 'active', false]);
  assert.equal((await get(env, u.hr, '/api/emergencies')).body.canManage, true);
  assert.equal((await get(env, u.emp2, '/api/emergencies')).status, 403);
  assert.equal((await get(env, u.mgr, '/api/emergencies')).status, 403);
});
