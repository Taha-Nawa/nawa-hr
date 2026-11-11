import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';
import { setWork } from './helpers/seed.js';
import { managedIds, canDecideRequest, employeeScope } from '../src/worker/authz.js';

const SETTINGS = {
  start: '08:30', end: '15:00', toleranceMinutes: 10, monthlyExitCapHours: 6,
  weekdays: ['عمل', 'عمل', 'عمل', 'عمل', 'عمل', 'عطلة أسبوعية', 'عطلة أسبوعية'],
  leaveTypes: { 'إجازة سنوية': true, 'إجازة مرضية': true, 'إجازة رسمية / طارئة': true, 'إجازة بدون راتب': false },
};
async function world(now = '2026-11-02T07:00:00Z') {
  const { db, env } = await apiEnv();
  env.__NOW = now;
  await setWork(db, SETTINGS);
  await seedOrg(db); // 1 مديرة (لها 2 و3)، 4 مستقل
  const u = {
    emp2: await login(db, 'emp2@nawaculture.org', 'employee', 2),
    mgr: await login(db, 'mgr@nawaculture.org', 'manager', 1),
    dep: await login(db, 'dep@nawaculture.org', 'employee', 4), // النائب المقترح
    hr: await login(db, 'hr@nawaculture.org', 'hr', null),
    dir: await login(db, 'dir@nawaculture.org', 'director', null),
  };
  return { db, env, u };
}
const j = (env, who, method, path, body) => call(env, method, path, { cookie: who.cookie, body });
const leave = { kind: 'leave', purpose: 'annual', reason: 'سفر', fromDate: '2026-11-08', toDate: '2026-11-10' };

test('النقي: managedIds ونطاق الموظفين للنائب', () => {
  assert.deepEqual(managedIds({ role: 'employee', employeeId: 4, actingFor: [1] }), [1]);
  assert.deepEqual(managedIds({ role: 'manager', employeeId: 1, actingFor: [7] }), [1, 7]);
  assert.deepEqual(managedIds({ role: 'employee', employeeId: 4 }), []);
  assert.equal(canDecideRequest({ role: 'employee', employeeId: 4, actingFor: [1] }, { id: 2, manager_id: 1 }), true);
  assert.equal(canDecideRequest({ role: 'employee', employeeId: 4, actingFor: [1] }, { id: 2, manager_id: 9 }), false);
  assert.equal(canDecideRequest({ role: 'employee', employeeId: 2, actingFor: [2] }, { id: 2, manager_id: 1 }), false, 'لا أحد يقرّر طلبه');
  assert.deepEqual(employeeScope({ role: 'employee', employeeId: 4, actingFor: [1] }), { sql: '(e.id = ? OR e.manager_id = ?)', params: [4, 1] });
});

test('تعيين النائب: للموارد البشرية فقط، ويُرفض بلا حساب أو بتداخل أو بتواريخ خاطئة', async () => {
  const { env, u } = await world();
  const body = { deputyId: 4, fromDate: '2026-11-01', toDate: '2026-11-15' };
  for (const who of [u.mgr, u.dep, u.dir]) assert.equal((await j(env, who, 'POST', '/api/employees/1/deputies', body)).status, 403);
  assert.equal((await j(env, u.hr, 'POST', '/api/employees/1/deputies', { ...body, deputyId: 1 })).status, 400, 'نفسه');
  assert.equal((await j(env, u.hr, 'POST', '/api/employees/1/deputies', { ...body, deputyId: 3 })).status, 400, 'بلا حساب');
  assert.equal((await j(env, u.hr, 'POST', '/api/employees/1/deputies', { ...body, toDate: '2026-10-01' })).status, 400);
  assert.equal((await j(env, u.hr, 'POST', '/api/employees/1/deputies', body)).status, 201);
  assert.equal((await j(env, u.hr, 'POST', '/api/employees/1/deputies', { ...body, fromDate: '2026-11-10', toDate: '2026-11-20' })).status, 400, 'تداخل');
  const g = await j(env, u.hr, 'GET', '/api/employees/1/deputies');
  assert.equal(g.body.deputies.length, 1);
});

test('النائب يعتمد طلب فريق المدير خلال المدة فقط، ولا يعتمد طلب غير فريقه', async () => {
  const { env, u } = await world();
  const r = await j(env, u.emp2, 'POST', '/api/requests', leave);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await j(env, u.dep, 'POST', `/api/requests/${r.body.id}/approve`, {})).status, 403, 'قبل التعيين');
  const a = await j(env, u.hr, 'POST', '/api/employees/1/deputies', { deputyId: 4, fromDate: '2026-11-01', toDate: '2026-11-15' });
  const me = await j(env, u.dep, 'GET', '/api/me');
  assert.deepEqual(me.body.user.actingFor.map((x) => x.id), [1]);
  const inbox = await j(env, u.dep, 'GET', '/api/requests?box=inbox');
  assert.equal(inbox.status, 200);
  assert.equal((await j(env, u.dep, 'POST', `/api/requests/${r.body.id}/approve`, {})).status, 200, JSON.stringify(inbox.body).slice(0, 200));
  // بعد انتهاء المدة لا صلاحية
  const r2 = await j(env, u.emp2, 'POST', '/api/requests', { ...leave, fromDate: '2026-11-22', toDate: '2026-11-23' });
  env.__NOW = '2026-11-16T07:00:00Z';
  assert.equal((await j(env, u.dep, 'POST', `/api/requests/${r2.body.id}/approve`, {})).status, 403, 'انتهت مدة النيابة');
  assert.equal((await j(env, u.hr, 'DELETE', `/api/deputies/${a.body.id}`)).status, 200);
});

// ---------------------------------------------------------------- لوحة اليوم الذكية
test('لوحة اليوم: الاتجاه محصور بنطاق المستخدم، والتنبيهات الإدارية للموارد البشرية والمدير العام فقط', async () => {
  const { db, env, u } = await world();
  const ins = (e, d, st, o = {}) => db.prepare('INSERT INTO daily_results (employee_id, date, day_type, status, approved_hours, required_hours, late_minutes) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(e, d, 'عمل', st, o.a ?? 6.5, 6.5, o.l ?? 0).run();
  await ins(2, '2026-11-01', 'حاضر'); await ins(2, '2026-11-02', 'متأخر', { l: 20 }); await ins(3, '2026-11-02', 'غياب', { a: 0 }); await ins(4, '2026-11-02', 'إجازة سنوية', { a: 0 });
  const hrT = await j(env, u.hr, 'GET', '/api/dashboard/trend?days=7');
  assert.equal(hrT.status, 200);
  const d2 = hrT.body.days.find((d) => d.date === '2026-11-02');
  assert.deepEqual([d2.late, d2.absent, d2.leave, d2.lateMinutes], [1, 1, 1, 20]);
  const mgrT = await j(env, u.mgr, 'GET', '/api/dashboard/trend?days=7'); // 1 يدير 2 و3
  assert.equal(mgrT.body.days.find((d) => d.date === '2026-11-02').leave, 0, 'الموظف 4 خارج فريقه');
  const empT = await j(env, u.emp2, 'GET', '/api/dashboard/trend?days=7');
  assert.equal(empT.body.days.find((d) => d.date === '2026-11-02').absent, 0, 'نفسه فقط');
  assert.equal((await j(env, u.hr, 'GET', '/api/dashboard/trend?days=99')).status, 400);
  assert.equal((await j(env, u.mgr, 'GET', '/api/dashboard/alerts')).status, 403);
  assert.equal((await j(env, u.emp2, 'GET', '/api/dashboard/alerts')).status, 403);
  await j(env, u.hr, 'PUT', '/api/employees/2/gender', { gender: 'F' });
  await j(env, u.hr, 'POST', '/api/employees/2/maternity', { deliveryDate: '2026-08-30', leaveDays: 70 }); // العودة 2026-11-08
  await db.prepare("UPDATE employees SET end_date = '2026-11-20' WHERE id = 3").run();
  const al = await j(env, u.dir, 'GET', '/api/dashboard/alerts');
  assert.equal(al.status, 200);
  assert.equal(al.body.maternity[0].state, 'returning');
  assert.deepEqual(al.body.staffEnding.map((x) => x.id), [3]);
});
