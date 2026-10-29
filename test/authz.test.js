import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';
import { can, canReadEmployee, employeeScope, ACTIONS, ROLES } from '../src/worker/authz.js';

/** مؤسسة صغيرة + مستخدم لكل دور (مربوط بموظف) */
async function world() {
  const { db, env } = await apiEnv();
  await seedOrg(db); // 1 = المديرة، 2 و3 مرؤوسان لها، 4 مستقل
  const u = {
    employee: await login(db, 'emp@nawaculture.org', 'employee', 2), // الموظف أ
    manager: await login(db, 'mgr@nawaculture.org', 'manager', 1), // المديرة
    hr: await login(db, 'hr@nawaculture.org', 'hr', 4),
    director: await login(db, 'dir@nawaculture.org', 'director', null),
    admin: await login(db, 'adm@nawaculture.org', 'admin', null),
    nolink: await login(db, 'nolink@nawaculture.org', 'employee', null), // دور موظف بلا ربط بموظف
  };
  return { db, env, u };
}

const ids = (res) => res.body.employees.map((e) => e.id).sort((a, b) => a - b);

test('قائمة الموظفين تُحصر بنطاق الدور (موظف: نفسه، مدير: نفسه ومرؤوسوه، البقية: الكل)', async () => {
  const { env, u } = await world();
  const list = async (who) => ids(await call(env, 'GET', '/api/employees', { cookie: u[who].cookie }));
  assert.deepEqual(await list('employee'), [2]);
  assert.deepEqual(await list('manager'), [1, 2, 3]);
  assert.deepEqual(await list('hr'), [1, 2, 3, 4]);
  assert.deepEqual(await list('director'), [1, 2, 3, 4]);
  assert.deepEqual(await list('admin'), [1, 2, 3, 4]);
  assert.deepEqual(await list('nolink'), [], 'حساب بلا موظف لا يرى أحداً');
  assert.equal((await call(env, 'GET', '/api/employees')).status, 401);
});

test('نتائج الأيام: كل دور يقرأ نطاقه فقط (403 خارجه)', async () => {
  const { env, u } = await world();
  const url = (id) => `/api/employees/${id}/days?from=2026-03-01&to=2026-03-31`;
  const status = async (who, id) => (await call(env, 'GET', url(id), { cookie: u[who].cookie })).status;

  assert.equal(await status('employee', 2), 200, 'نفسه');
  assert.equal(await status('employee', 3), 403, 'زميل');
  assert.equal(await status('employee', 1), 403, 'مديره');
  assert.equal(await status('manager', 2), 200, 'مرؤوس');
  assert.equal(await status('manager', 3), 200);
  assert.equal(await status('manager', 4), 403, 'ليس مرؤوساً');
  assert.equal(await status('manager', 1), 200, 'نفسه');
  assert.equal(await status('hr', 3), 200);
  assert.equal(await status('director', 4), 200);
  assert.equal(await status('admin', 1), 200);
  assert.equal(await status('nolink', 2), 403);
  assert.equal(await status('hr', 999), 404);
});

test('المدير لا يرى مرؤوسي غيره، والمرؤوس لا يرى مديره', async () => {
  const { db, env, u } = await world();
  await db.prepare('UPDATE employees SET manager_id = 4 WHERE id = 3').run(); // الموظف ب صار تحت ج
  const url = (id) => `/api/employees/${id}/days?from=2026-03-01&to=2026-03-02`;
  assert.equal((await call(env, 'GET', url(3), { cookie: u.manager.cookie })).status, 403);
  assert.equal((await call(env, 'GET', url(2), { cookie: u.manager.cookie })).status, 200);
});

// الجدول الشامل: الإجراء × الدور → الحالة المتوقعة. أي تغيير في الصلاحيات يكسر هذا الاختبار عمداً.
const WRITE = {
  createEmployee: (e, c) => call(e, 'POST', '/api/employees', { cookie: c, body: { code: `NW-${Math.floor(Math.random() * 1e6)}`, name: 'جديد' } }),
  patchEmployee: (e, c) => call(e, 'PATCH', '/api/employees/3', { cookie: c, body: { name: 'اسم معدّل' } }),
  createCenter: (e, c) => call(e, 'POST', '/api/centers', { cookie: c, body: { name: `مركز ${Math.random()}` } }),
  addBadge: (e, c) => call(e, 'POST', '/api/badges', { cookie: c, body: { card: `C-${Math.random()}`, employeeId: 4 } }),
  listBadges: (e, c) => call(e, 'GET', '/api/employees/3/badges', { cookie: c }),
  importBadges: (e, c) => call(e, 'POST', '/api/import/badges', { cookie: c, body: { rows: [{ card: `B-${Math.random()}`, code: 'NW-004' }] } }),
  revokeBadge: (e, c) => call(e, 'POST', '/api/badges/NW-004-A/revoke', { cookie: c }),
  readSettings: (e, c) => call(e, 'GET', '/api/settings', { cookie: c }),
  writeSettings: (e, c) => call(e, 'PUT', '/api/settings/work', { cookie: c, body: { start: '08:00', end: '15:00', toleranceMinutes: 10, weekdays: ['عمل', 'عمل', 'عمل', 'عمل', 'عمل', 'عطلة أسبوعية', 'عطلة أسبوعية'], leaveTypes: { 'إجازة سنوية': true } } }),
  listDevices: (e, c) => call(e, 'GET', '/api/devices', { cookie: c }),
  createDevice: (e, c) => call(e, 'POST', '/api/devices', { cookie: c, body: { id: `D-${Math.floor(Math.random() * 1e6)}` } }),
  listUsers: (e, c) => call(e, 'GET', '/api/users', { cookie: c }),
  createUser: (e, c) => call(e, 'POST', '/api/users', { cookie: c, body: { email: `x${Math.random()}@nawaculture.org`.replace('.', ''), role: 'employee' } }),
  readAudit: (e, c) => call(e, 'GET', '/api/audit', { cookie: c }),
  setHolidays: (e, c) => call(e, 'PUT', '/api/holidays', { cookie: c, body: { year: 2026, holidays: [{ date: '2026-05-01', name: 'عيد العمال' }] } }),
  importEmployees: (e, c) => call(e, 'POST', '/api/import/employees', { cookie: c, body: { rows: [{ code: `IMP-${Math.floor(Math.random() * 1e6)}`, name: 'مستورد' }] } }),
  importMovements: (e, c) => call(e, 'POST', '/api/import/movements', { cookie: c, body: { rows: [{ id: `X-${Math.random()}`, code: 'NW-004', type: 'حضور', date: '2026-03-02', time: '08:20' }] } }),
  recompute: (e, c) => call(e, 'POST', '/api/recompute', { cookie: c, body: { from: '2026-03-01', to: '2026-03-02' } }),
};

const MATRIX = {
  //                     employee manager hr  director admin
  createEmployee: [403, 403, 201, 403, 201],
  patchEmployee: [403, 403, 200, 403, 200],
  createCenter: [403, 403, 201, 403, 201],
  addBadge: [403, 403, 201, 403, 201],
  listBadges: [403, 403, 200, 403, 200],
  importBadges: [403, 403, 200, 403, 200],
  revokeBadge: [403, 403, 200, 403, 200],
  readSettings: [403, 403, 200, 200, 200],
  writeSettings: [403, 403, 403, 403, 200],
  listDevices: [403, 403, 403, 403, 200],
  createDevice: [403, 403, 403, 403, 201],
  listUsers: [403, 403, 403, 403, 200],
  createUser: [403, 403, 403, 403, 201],
  readAudit: [403, 403, 200, 200, 200],
  setHolidays: [403, 403, 200, 403, 200],
  importEmployees: [403, 403, 200, 403, 200],
  importMovements: [403, 403, 200, 403, 200],
  recompute: [403, 403, 200, 403, 200],
};

for (const [action, expected] of Object.entries(MATRIX)) {
  test(`مصفوفة الصلاحيات: ${action}`, async () => {
    const { env, u } = await world();
    const actual = [];
    for (const role of ROLES) actual.push((await WRITE[action](env, u[role].cookie)).status);
    assert.deepEqual(actual, expected, `${action} للأدوار ${ROLES.join('/')}`);
  });
}

test('المصفوفة تغطي كل إجراءات authz.ACTIONS الفعلية (لا إجراء بلا اختبار)', () => {
  const covered = new Set(['employee.create', 'employee.update', 'badge.manage', 'center.manage', 'settings.read', 'settings.write', 'device.manage', 'user.manage', 'audit.read', 'holiday.write', 'import.run', 'recompute.run']);
  const uncovered = Object.keys(ACTIONS).filter((a) => !covered.has(a));
  // day.correct (التصحيح اليدوي) مخصص لمرحلة 2 ولا مسار له بعد
  assert.deepEqual(uncovered.sort(), ['day.correct']);
});

test('دوال التفويض النقية', () => {
  assert.equal(can(null, 'user.manage'), false);
  assert.equal(can({ role: 'admin' }, 'غير معروف'), false);
  assert.equal(can({ role: 'hr' }, 'employee.create'), true);
  assert.equal(canReadEmployee({ role: 'employee', employeeId: 5 }, { id: 5 }), true);
  assert.equal(canReadEmployee({ role: 'manager', employeeId: null }, { id: 5, manager_id: null }), false, 'null لا يساوي null');
  assert.equal(canReadEmployee({ role: 'employee', employeeId: null }, { id: 5 }), false);
  assert.deepEqual(employeeScope({ role: 'employee', employeeId: null }), { sql: '0 = 1', params: [] });
});

test('لا مسار بلا مصادقة عدا الدخول وبوابة الأجهزة وفحص الصحة', async () => {
  const { env } = await apiEnv();
  const paths = [
    ['GET', '/api/me'], ['GET', '/api/employees'], ['POST', '/api/employees'], ['PATCH', '/api/employees/1'], ['GET', '/api/employees/1/days?from=2026-03-01&to=2026-03-02'],
    ['GET', '/api/centers'], ['POST', '/api/centers'], ['POST', '/api/badges'], ['POST', '/api/badges/x/revoke'], ['GET', '/api/settings'], ['PUT', '/api/settings/work'], ['GET', '/api/devices'], ['POST', '/api/devices'],
    ['POST', '/api/devices/DEV-01/rotate'], ['POST', '/api/devices/DEV-01/deactivate'], ['GET', '/api/users'], ['POST', '/api/users'], ['PATCH', '/api/users/1'], ['GET', '/api/audit'],
    ['GET', '/api/day?date=2026-03-02'], ['GET', '/api/holidays?year=2026'], ['PUT', '/api/holidays'], ['POST', '/api/recompute'], ['POST', '/api/import/employees'], ['POST', '/api/import/badges'], ['GET', '/api/employees/1/badges'], ['POST', '/api/import/movements'],
  ];
  for (const [m, p] of paths) {
    const r = await call(env, m, p, { body: m === 'GET' ? undefined : {} });
    assert.equal(r.status, 401, `${m} ${p}`);
  }
  assert.equal((await call(env, 'GET', '/api/health')).status, 200);
  assert.equal((await call(env, 'GET', '/api/غير-موجود')).status, 404);
});
