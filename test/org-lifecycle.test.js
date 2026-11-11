import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call, seedOrg, addUser } from './helpers/api.js';
import { setWork } from './helpers/seed.js';
import { dropDeparted } from '../src/worker/notify.js';

const NOW = '2026-11-11T07:00:00Z';
const SETTINGS = { start: '08:30', end: '15:00', toleranceMinutes: 10, weekdays: ['عمل', 'عمل', 'عمل', 'عمل', 'عمل', 'عطلة أسبوعية', 'عطلة أسبوعية'], leaveTypes: { 'إجازة سنوية': true } };

// الهيكل: 1 مديرة ← (2، 3)؛ 2 مدير ← (4، 5). لكل منهم حساب وبطاقة. 6 موظف مستقل.
async function world() {
  const { db, env } = await apiEnv();
  env.__NOW = NOW;
  env.__MAILER = { kind: 'test', send: async () => {} };
  await setWork(db, SETTINGS);
  await seedOrg(db);
  await db.prepare("INSERT INTO employees (id, code, name, center_id, manager_id, email) VALUES (5, 'NW-005', 'موظف هـ', 1, 2, 'emp5@nawaculture.org')").run();
  await db.prepare('UPDATE employees SET manager_id = 2 WHERE id = 4').run();
  await db.prepare("UPDATE employees SET email = 'emp2@nawaculture.org' WHERE id = 2").run();
  await db.prepare("INSERT INTO badges (card, employee_id) VALUES ('NW-005-A', 5)").run();
  const u = {
    hr: await login(db, 'hr@nawaculture.org', 'hr', 4),
    admin: await login(db, 'adm@nawaculture.org', 'admin', null),
    director: await login(db, 'dir@nawaculture.org', 'director', null),
    mgr2: await login(db, 'emp2@nawaculture.org', 'manager', 2),
    emp3: await login(db, 'emp3@nawaculture.org', 'employee', 3),
  };
  return { db, env, u };
}
const life = (env, who, id, body) => call(env, 'POST', `/api/employees/${id}/lifecycle`, { cookie: who.cookie, body: { reason: 'سبب الإجراء', ...body } });
const emp = (db, id) => db.prepare('SELECT status, end_date AS endDate, center_id AS c, manager_id AS m FROM employees WHERE id = ?').bind(id).first();

test('الهيكلية: تحتاج org.read، وتعيد الشجرة وتحليلها', async () => {
  const { db, env, u } = await world();
  assert.equal((await call(env, 'GET', '/api/org', { cookie: u.emp3.cookie })).status, 403);
  assert.equal((await call(env, 'GET', '/api/org', { cookie: u.mgr2.cookie })).status, 403);
  const r = await call(env, 'GET', '/api/org', { cookie: u.director.cookie });
  assert.equal(r.status, 200);
  assert.equal(r.body.employees.length, 5);
  assert.equal(r.body.org.stats.active, 5);
  assert.ok(r.body.org.checks.some((c) => c.id === 'manager_no_approver'), 'مدير 1 بلا حساب اعتماد');
  assert.ok(!('email' in r.body.employees[0]), 'لا بريد في الاستجابة');
  assert.deepEqual(r.body.employees.map((e) => [e.pendingRequests, e.onLeave]).filter(([n, l]) => n || l), []);
  await db.prepare("INSERT INTO requests (employee_id, kind, purpose, from_date, to_date, days, status, request_date, created_by) VALUES (3, 'leave', 'annual', '2026-11-11', '2026-11-12', 2, 'approved', '2026-11-01', 'x'), (3, 'leave', 'annual', '2026-11-20', '2026-11-20', 1, 'pending', '2026-11-11', 'x')").run();
  const r2 = (await call(env, 'GET', '/api/org', { cookie: u.director.cookie })).body.employees.find((e) => e.id === 3);
  assert.deepEqual([r2.pendingRequests, r2.onLeave], [1, true]);
});

test('المعاينة لا تغيّر شيئاً وتعرض الأثر كاملاً', async () => {
  const { db, env, u } = await world();
  await db.prepare("INSERT INTO requests (employee_id, kind, purpose, from_date, to_date, days, status, request_date, created_by) VALUES (2, 'leave', 'annual', '2026-11-20', '2026-11-20', 1, 'pending', '2026-11-11', 'x')").run();
  const r = await life(env, u.hr, 2, { action: 'separate', kind: 'resign', dryRun: true, reason: undefined });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.dryRun, true);
  assert.deepEqual(r.body.impact.reports.map((x) => x.id), [4, 5]);
  assert.deepEqual([r.body.impact.pendingRequests, r.body.impact.activeBadges, r.body.impact.accounts.length], [1, 1, 1]);
  assert.equal((await emp(db, 2)).status, 'active');
});

test('استقالة: يُغلق الدخول والبطاقة، ويُعاد إسناد المرؤوسين إلى مدير المستقيل، وتُلغى المعلّقات، ويُسجَّل الأثر', async () => {
  const { db, env, u } = await world();
  await db.prepare("INSERT INTO requests (employee_id, kind, purpose, from_date, to_date, days, status, request_date, created_by) VALUES (2, 'leave', 'annual', '2026-11-20', '2026-11-20', 1, 'pending', '2026-11-11', 'x')").run();
  await db.prepare("INSERT INTO leave_plans (employee_id, status, created_by) VALUES (2, 'submitted', 'x')").run();
  assert.equal((await call(env, 'GET', '/api/me', { cookie: u.mgr2.cookie })).status, 200);

  const r = await life(env, u.hr, 2, { action: 'separate', kind: 'resign', endDate: '2026-11-10' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.reassigned, r.body.accountsClosed, r.body.badgesRevoked, r.body.requestsCancelled, r.body.plansCancelled], [2, 1, 1, 1, 1]);

  assert.deepEqual(await emp(db, 2), { status: 'inactive', endDate: '2026-11-10', c: 1, m: 1 });
  assert.equal((await emp(db, 4)).m, 1);
  assert.equal((await emp(db, 5)).m, 1);
  assert.equal((await db.prepare('SELECT active FROM users WHERE employee_id = 2').first()).active, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = (SELECT id FROM users WHERE employee_id = 2)").first()).n, 0);
  assert.equal((await db.prepare("SELECT status FROM badges WHERE employee_id = 2").first()).status, 'revoked');
  assert.equal((await db.prepare("SELECT status FROM requests WHERE employee_id = 2").first()).status, 'cancelled');
  assert.equal((await db.prepare("SELECT status FROM leave_plans WHERE employee_id = 2").first()).status, 'cancelled');
  assert.equal((await call(env, 'GET', '/api/me', { cookie: u.mgr2.cookie })).status, 401, 'الجلسة القديمة لا تعمل');
  const h = await db.prepare("SELECT kind, effective_date AS d, from_manager_id AS fm, to_manager_id AS tm, created_by AS by FROM employee_history WHERE employee_id = 2").first();
  assert.deepEqual(h, { kind: 'resign', d: '2026-11-10', fm: 1, tm: 1, by: 'hr@nawaculture.org' });
  assert.ok(await db.prepare("SELECT 1 AS x FROM audit_log WHERE action = 'employee.separate'").first());
  // لا يعود للقائمة بعد الإنهاء: لا يظهر في لوحة اليوم، ولا تنتج الهيكلية ملاحظة «منتهي الخدمة بوصول»
  const org = (await call(env, 'GET', '/api/org', { cookie: u.director.cookie })).body.org;
  assert.ok(!org.checks.some((c) => c.id === 'departed_access'));
  assert.ok(!org.checks.some((c) => c.id === 'manager_inactive'));
});

test('البريد: لا يصل منتهي الخدمة حتى لو رجع الإشعار إلى بريد سجل الموظف', async () => {
  const { db, env, u } = await world();
  await life(env, u.hr, 2, { action: 'separate', kind: 'terminate' });
  const left = await dropDeparted(db, ['emp2@nawaculture.org', 'EMP2@nawaculture.org', 'hr@nawaculture.org']);
  assert.deepEqual(left, ['hr@nawaculture.org']);
  // حساب مربوط بموظف منتهي ببريد مختلف عن بريد سجله
  await addUser(db, 'alias2@nawaculture.org', 'employee', 2, 1);
  assert.deepEqual(await dropDeparted(db, ['alias2@nawaculture.org']), []);
});

test('إسناد المرؤوسين: إلى بديل صريح، ويُرفض بديل من تحته أو غير فعّال، وبلا بديل يصيرون بلا مدير', async () => {
  const { db, env, u } = await world();
  assert.equal((await life(env, u.hr, 2, { action: 'separate', kind: 'resign', reassignTo: 4 })).status, 400, 'مرؤوسه نفسه: حلقة');
  assert.equal((await life(env, u.hr, 2, { action: 'separate', kind: 'resign', reassignTo: 99 })).status, 400);
  const ok = await life(env, u.hr, 2, { action: 'separate', kind: 'resign', reassignTo: 3 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual([(await emp(db, 4)).m, (await emp(db, 5)).m], [3, 3]);
  // بلا بديل صراحةً
  const w2 = await world();
  const r2 = await life(w2.env, w2.u.hr, 2, { action: 'separate', kind: 'contract_end', reassignTo: null });
  assert.equal(r2.status, 200);
  assert.deepEqual([(await emp(w2.db, 4)).m, (await emp(w2.db, 5)).m], [null, null]);
});

test('شروط الإنهاء: السبب والنوع والتاريخ والصلاحية وآخر مسؤول', async () => {
  const { db, env, u } = await world();
  assert.equal((await life(env, u.emp3, 2, { action: 'separate', kind: 'resign' })).status, 403);
  assert.equal((await life(env, u.mgr2, 3, { action: 'separate', kind: 'resign' })).status, 403);
  assert.equal((await life(env, u.hr, 2, { action: 'separate', kind: 'resign', reason: '' })).status, 400);
  assert.equal((await life(env, u.hr, 2, { action: 'separate', kind: 'غلط' })).status, 400);
  assert.equal((await life(env, u.hr, 2, { action: 'separate', kind: 'resign', endDate: '2026-12-01' })).status, 400, 'مستقبل');
  assert.equal((await life(env, u.hr, 99, { action: 'separate', kind: 'resign' })).status, 404);
  // موظف هو صاحب الحساب المسؤول الوحيد
  await db.prepare("INSERT INTO employees (id, code, name, center_id) VALUES (6, 'NW-006', 'المسؤول', 1)").run();
  await db.prepare("UPDATE users SET employee_id = 6 WHERE email = 'adm@nawaculture.org'").run();
  assert.equal((await life(env, u.hr, 6, { action: 'separate', kind: 'resign' })).status, 409);
  assert.equal((await emp(db, 6)).status, 'active');
});

test('نقل بين المراكز: يُسجَّل في السجل ويبقى مرؤوسوه، ويُرفض مدير يُنشئ حلقة أو مركز غير فعّال', async () => {
  const { db, env, u } = await world();
  const r = await life(env, u.hr, 2, { action: 'transfer', centerId: 2, effectiveDate: '2026-11-10' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.keptReports, 2);
  assert.deepEqual([(await emp(db, 2)).c, (await emp(db, 4)).m], [2, 2]);
  const h = (await call(env, 'GET', '/api/employees/2/history', { cookie: u.hr.cookie })).body.history;
  assert.deepEqual([h[0].kind, h[0].fromCenter, h[0].toCenter, h[0].date], ['transfer', 'المبنى الرئيسي', 'مركز الزيتونة', '2026-11-10']);
  assert.equal((await life(env, u.hr, 2, { action: 'transfer', managerId: 4 })).status, 400, 'مرؤوسه مديراً له');
  await db.prepare('UPDATE centers SET active = 0 WHERE id = 1').run();
  assert.equal((await life(env, u.hr, 3, { action: 'transfer', centerId: 1 })).status, 400);
  assert.equal((await life(env, u.hr, 3, { action: 'transfer' })).status, 400, 'بلا تغيير');
  assert.equal((await life(env, u.hr, 3, { action: 'transfer', centerId: 2, effectiveDate: '2026-12-31' })).status, 400, 'تاريخ مستقبلي');
});

test('إعادة التفعيل: تعيد الحالة ولا تفعّل الحساب والبطاقة إلا بطلب صريح', async () => {
  const { db, env, u } = await world();
  await life(env, u.hr, 5, { action: 'separate', kind: 'resign' });
  assert.equal((await life(env, u.hr, 3, { action: 'reinstate' })).status, 409, 'فعّال أصلاً');
  const r = await life(env, u.hr, 5, { action: 'reinstate', centerId: 2, managerId: 3 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(await emp(db, 5), { status: 'active', endDate: null, c: 2, m: 3 });
  assert.equal((await db.prepare("SELECT status FROM badges WHERE employee_id = 5").first()).status, 'revoked', 'البطاقة لا تعود تلقائياً');
  await life(env, u.hr, 5, { action: 'separate', kind: 'resign' });
  await addUser(db, 'emp5@nawaculture.org', 'employee', 5, 0);
  await life(env, u.hr, 5, { action: 'reinstate', reactivateAccount: true, restoreBadges: true });
  assert.equal((await db.prepare("SELECT active FROM users WHERE employee_id = 5").first()).active, 1);
  assert.equal((await db.prepare("SELECT status FROM badges WHERE employee_id = 5").first()).status, 'active');
});

test('تعطيل الموظف مباشرة من نموذج التعديل يغلق الحساب والبطاقة أيضاً (غير فعّال ⇒ لا وصول)', async () => {
  const { db, env, u } = await world();
  const r = await call(env, 'PATCH', '/api/employees/3', { cookie: u.hr.cookie, body: { status: 'inactive' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await db.prepare('SELECT active FROM users WHERE employee_id = 3').first()).active, 0);
  assert.equal((await db.prepare("SELECT status FROM badges WHERE employee_id = 3").first()).status, 'revoked');
  assert.equal((await call(env, 'GET', '/api/me', { cookie: u.emp3.cookie })).status, 401);
});

test('الهيكلية: «مقصود، تجاهل» تخرج الملاحظة من الفحص والدرجة، وتُعاد بـ restore، وللموارد البشرية والمسؤول فقط', async () => {
  const { db, env, u } = await world();
  const org = async () => (await call(env, 'GET', '/api/org', { cookie: u.hr.cookie })).body.org;
  const first = await org();
  const check = first.checks.find((c) => c.id === 'manager_no_approver');
  assert.ok(check);
  const target = check.items[0].id;
  const body = { employeeId: target, check: 'manager_no_approver' };
  assert.equal((await call(env, 'POST', '/api/org/dismiss', { cookie: u.director.cookie, body })).status, 403);
  assert.equal((await call(env, 'POST', '/api/org/dismiss', { cookie: u.mgr2.cookie, body })).status, 403);
  assert.equal((await call(env, 'POST', '/api/org/dismiss', { cookie: u.hr.cookie, body: { employeeId: target, check: 'BAD!' } })).status, 400);
  assert.equal((await call(env, 'POST', '/api/org/dismiss', { cookie: u.hr.cookie, body: { employeeId: 999, check: 'no_account' } })).status, 404);
  assert.equal((await call(env, 'POST', '/api/org/dismiss', { cookie: u.hr.cookie, body })).status, 200);
  assert.equal((await call(env, 'POST', '/api/org/dismiss', { cookie: u.hr.cookie, body })).status, 200); // تكرارها آمن
  const after = await org();
  assert.ok(!(after.checks.find((c) => c.id === 'manager_no_approver')?.items || []).some((i) => i.id === target));
  assert.deepEqual(after.ignored.filter((i) => i.check === 'manager_no_approver').map((i) => i.id), [target]);
  assert.equal((await call(env, 'GET', '/api/org', { cookie: u.director.cookie })).body.org.ignored.length, after.ignored.length); // المدير العام يرى ما تُجوهل
  assert.equal((await call(env, 'POST', '/api/org/restore', { cookie: u.admin.cookie, body })).status, 200);
  const back = await org();
  assert.deepEqual(back.ignored, []);
  assert.ok(back.checks.find((c) => c.id === 'manager_no_approver').items.some((i) => i.id === target));
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('org.dismiss','org.restore')").first()).n, 3);
  // قاعدة لم تُطبَّق عليها الهجرة بعد: الهيكل يبقى يعمل
  await db.prepare('DROP TABLE org_dismissed').run();
  assert.equal((await call(env, 'GET', '/api/org', { cookie: u.hr.cookie })).status, 200);
});
