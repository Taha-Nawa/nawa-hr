import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call } from './helpers/api.js';
import { validateVolunteerDay, volunteerHours, monthTotals } from '../src/engine/volunteers.js';

test('تحقق يوم المتطوع: القواعد المنطقية للأوقات', () => {
  assert.equal(validateVolunteerDay({}).ok, true);
  assert.equal(validateVolunteerDay({ arrive: '09:00', depart: '14:00' }).ok, true);
  assert.match(validateVolunteerDay({ depart: '14:00' }).error, /الوصول/);
  assert.match(validateVolunteerDay({ arrive: '14:00', depart: '09:00' }).error, /بعد الوصول/);
  assert.match(validateVolunteerDay({ arrive: '09:00', ret: '10:00' }).error, /بلا مغادرة/);
  assert.match(validateVolunteerDay({ arrive: '09:00', exit: '08:00' }).error, /قبل الوصول/);
  assert.match(validateVolunteerDay({ arrive: '09:00', depart: '12:00', exit: '13:00' }).error, /بعد الانصراف/);
  assert.match(validateVolunteerDay({ arrive: '09:00', exit: '11:00', ret: '10:00' }).error, /بعد المغادرة/);
  assert.match(validateVolunteerDay({ arrive: '9:00' }).error, /غير صالح/);
  assert.equal(validateVolunteerDay({ arrive: '09:00', reason: '  مراجعة طبيب ' }).value.reason, 'مراجعة طبيب');
});

test('ساعات المتطوع: الانصراف − الوصول − مدة المغادرة', () => {
  assert.equal(volunteerHours({ arrive: '09:00', depart: '14:30' }), 5.5);
  assert.equal(volunteerHours({ arrive: '09:00', depart: '14:30', exit: '11:00', ret: '11:30' }), 5);
  assert.equal(volunteerHours({ arrive: '09:00' }), 0);
  assert.deepEqual(monthTotals([{ arrive: '09:00', depart: '12:00' }, { arrive: '10:00', depart: '11:30' }, {}]), { days: 2, hours: 4.5 });
});

async function world() {
  const { db, env } = await apiEnv();
  env.__NOW = '2026-11-02T07:00:00Z';
  return { db, env, hr: await login(db, 'hr@nawaculture.org', 'hr', null), admin: await login(db, 'adm@nawaculture.org', 'admin', null), emp: await login(db, 'e@nawaculture.org', 'employee', null), dir: await login(db, 'd@nawaculture.org', 'director', null) };
}
const j = (env, who, method, path, body) => call(env, method, path, { cookie: who.cookie, body });

test('إضافة متطوع وتعديله وإيقافه، والمدير العام يطّلع ولا يعدّل', async () => {
  const { env, hr, dir, emp } = await world();
  const c = await j(env, hr, 'POST', '/api/volunteers', { name: '  سارة أحمد ', centerId: 1, project: 'مشروع القراءة', coordinator: 'ليلى' });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const id = c.body.id;
  assert.equal((await j(env, hr, 'POST', '/api/volunteers', { name: '', centerId: 1 })).status, 400);
  assert.equal((await j(env, hr, 'POST', '/api/volunteers', { name: 'س', centerId: 99 })).status, 400);
  assert.equal((await j(env, hr, 'PATCH', `/api/volunteers/${id}`, { phone: '0599', active: false })).status, 200);
  const list = await j(env, dir, 'GET', '/api/volunteers');
  assert.equal(list.status, 200);
  assert.equal(list.body.canEdit, false);
  assert.equal(list.body.volunteers[0].name, 'سارة أحمد');
  assert.equal(list.body.volunteers[0].active, 0);
  assert.equal(list.body.volunteers[0].center, 'المبنى الرئيسي');
  assert.equal((await j(env, dir, 'PATCH', `/api/volunteers/${id}`, { name: 'x' })).status, 403);
  assert.equal((await j(env, emp, 'GET', '/api/volunteers')).status, 403);
});

test('الكشف الشهري: حفظ، تحديث، حذف الفارغ، ومجاميع الساعات', async () => {
  const { env, hr } = await world();
  const id = (await j(env, hr, 'POST', '/api/volunteers', { name: 'سارة', centerId: 1 })).body.id;
  const put = (days) => j(env, hr, 'PUT', `/api/volunteers/${id}/month`, { month: '2026-11', days });
  let r = await put([
    { date: '2026-11-01', arrive: '09:00', depart: '14:00' },
    { date: '2026-11-02', arrive: '10:00', depart: '15:00', exit: '12:00', ret: '12:30', reason: 'مراجعة' },
    { date: '2026-11-03', arrive: '', depart: '' },
  ]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.saved, r.body.removed], [2, 1]);
  const m = await j(env, hr, 'GET', `/api/volunteers/${id}/month?month=2026-11`);
  assert.deepEqual(m.body.totals, { days: 2, hours: 9.5 });
  assert.equal(m.body.days[1].hours, 4.5);
  assert.equal(m.body.days[1].reason, 'مراجعة');
  assert.equal(m.body.to, '2026-11-30');
  // تحديث يوم وحذف آخر
  r = await put([{ date: '2026-11-01', arrive: '09:00', depart: '13:00' }, { date: '2026-11-02' }]);
  assert.deepEqual([r.body.saved, r.body.removed], [1, 1]);
  const m2 = await j(env, hr, 'GET', `/api/volunteers/${id}/month?month=2026-11`);
  assert.deepEqual(m2.body.totals, { days: 1, hours: 4 });
  // ملخص القائمة
  const list = await j(env, hr, 'GET', '/api/volunteers?month=2026-11');
  assert.deepEqual(list.body.volunteers[0].month, { days: 1, hours: 4 });
  // رفض: خارج الشهر، مكرر، وقت خاطئ
  assert.equal((await put([{ date: '2026-12-01', arrive: '09:00' }])).status, 400);
  assert.equal((await put([{ date: '2026-11-05', arrive: '09:00' }, { date: '2026-11-05', arrive: '10:00' }])).status, 400);
  assert.equal((await put([{ date: '2026-11-05', arrive: '15:00', depart: '09:00' }])).status, 400);
  assert.equal((await j(env, hr, 'PUT', '/api/volunteers/999/month', { month: '2026-11', days: [] })).status, 404);
  assert.equal((await j(env, hr, 'GET', `/api/volunteers/${id}/month?month=2026-13`)).status, 400);
});

// ---------------------------------------------------------------- كشف الحضور الأسبوعي للطباعة
import { seedOrg } from './helpers/api.js';

async function sheetWorld() {
  const { db, env } = await apiEnv();
  env.__NOW = '2026-11-02T07:00:00Z';
  await seedOrg(db); // 1 مديرة (مدير 2 و3)، 4 مستقل
  const ins = db.prepare("INSERT INTO daily_results (employee_id, date, day_type, check_in, exit_first, return_last, departure, status) VALUES (?, ?, 'عمل', ?, ?, ?, ?, 'حاضر')");
  await ins.bind(2, '2026-11-01', '08:30', '10:00', '10:20', '15:00').run();
  await ins.bind(2, '2026-11-02', '08:45', null, null, '15:00').run();
  await ins.bind(3, '2026-11-01', '08:31', null, null, '15:01').run();
  return { db, env, hr: await login(db, 'hr@nawaculture.org', 'hr', null), mgr: await login(db, 'mgr@nawaculture.org', 'manager', 1), emp: await login(db, 'e2@nawaculture.org', 'employee', 2) };
}
const sheet = (env, who, q) => call(env, 'GET', `/api/attendance/sheet?${q}`, { cookie: who.cookie });

test('كشف الحضور: أوقات الأسبوع لكل موظف، وفق نطاق المستخدم', async () => {
  const { env, hr, mgr, emp } = await sheetWorld();
  const r = await sheet(env, hr, 'from=2026-10-31&to=2026-11-05');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.employees.length, 4);
  const a = r.body.employees.find((e) => e.code === 'NW-002');
  assert.equal(a.days['2026-11-01'].exitFirst, '10:00');
  assert.equal(a.days['2026-11-02'].departure, '15:00');
  assert.deepEqual(r.body.employees.find((e) => e.code === 'NW-004').days, {});
  // المدير: نفسه وفريقه فقط
  const m = await sheet(env, mgr, 'from=2026-11-01&to=2026-11-02');
  assert.deepEqual(m.body.employees.map((e) => e.code), ['NW-001', 'NW-002', 'NW-003']);
  // الموظف: نفسه فقط
  const e = await sheet(env, emp, 'from=2026-11-01&to=2026-11-02');
  assert.deepEqual(e.body.employees.map((x) => x.code), ['NW-002']);
});

test('كشف الحضور: تحقق الفترة والمركز', async () => {
  const { env, hr } = await sheetWorld();
  assert.equal((await sheet(env, hr, 'from=x&to=2026-11-02')).status, 400);
  assert.equal((await sheet(env, hr, 'from=2026-11-05&to=2026-11-01')).status, 400);
  assert.equal((await sheet(env, hr, 'from=2026-10-01&to=2026-11-15')).status, 400);
  assert.equal((await sheet(env, hr, 'from=2026-11-01&to=2026-11-02&center=abc')).status, 400);
  const none = await sheet(env, hr, 'from=2026-11-01&to=2026-11-02&center=2');
  assert.equal(none.body.employees.length, 0);
});
