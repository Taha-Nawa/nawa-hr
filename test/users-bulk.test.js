import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';

async function world() {
  const { db, env } = await apiEnv();
  env.__NOW = '2026-11-02T07:00:00Z';
  await seedOrg(db); // 1 مديرة (مدير 2 و3)، 4 مستقل
  await db.prepare("UPDATE employees SET email = CASE id WHEN 1 THEN 'm@nawaculture.org' WHEN 2 THEN 'a@nawaculture.org' WHEN 3 THEN 'b@nawaculture.org' ELSE NULL END").run();
  return { db, env, admin: await login(db, 'adm@nawaculture.org', 'admin', null), hr: await login(db, 'hr@nawaculture.org', 'hr', null) };
}
const cand = (env, who) => call(env, 'GET', '/api/users/candidates', { cookie: who.cookie });
const bulk = (env, who, items) => call(env, 'POST', '/api/users/bulk', { cookie: who.cookie, body: { items } });

test('المرشَّحون: الفعّالون بلا حساب، مدير المرؤوسين يُرشَّح «مدير مباشر»، ومن بلا بريد يُحجب بسببه', async () => {
  const { env, admin } = await world();
  const r = await cand(env, admin);
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.body.candidates.map((c) => [c.code, c]));
  assert.ok(by['NW-001'] && by['NW-002'] && by['NW-003'] && by['NW-004']);
  assert.equal(by['NW-001'].suggestedRole, 'manager');
  assert.equal(by['NW-001'].reports, 2);
  assert.equal(by['NW-002'].suggestedRole, 'employee');
  assert.equal(by['NW-002'].blocked, null);
  assert.equal(by['NW-004'].blocked, 'no_email');
});

test('الإنشاء الجماعي: ينشئ بالدور المختار ويتخطى بلا بريد، ويسجّل التدقيق', async () => {
  const { db, env, admin } = await world();
  const r = await bulk(env, admin, [{ employeeId: 1, role: 'manager' }, { employeeId: 2, role: 'employee' }, { employeeId: 3, role: 'employee' }, { employeeId: 4, role: 'employee' }]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.created, 3);
  assert.deepEqual(r.body.skipped.map((s) => [s.employeeId, s.reason]), [[4, 'لا بريد صالح في بطاقته']]);
  const u = (await db.prepare("SELECT email, role, employee_id e FROM users WHERE email IN ('m@nawaculture.org','a@nawaculture.org','b@nawaculture.org') ORDER BY e").all()).results;
  assert.deepEqual(u.map((x) => [x.email, x.role, x.e]), [['m@nawaculture.org', 'manager', 1], ['a@nawaculture.org', 'employee', 2], ['b@nawaculture.org', 'employee', 3]]);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'user.bulk-create'").first()).n, 1);
});

test('إعادة التشغيل آمنة: من له حساب يُتخطّى ولا تكرار', async () => {
  const { db, env, admin } = await world();
  await bulk(env, admin, [{ employeeId: 2, role: 'employee' }]);
  const again = await bulk(env, admin, [{ employeeId: 2, role: 'employee' }, { employeeId: 3, role: 'employee' }]);
  assert.equal(again.body.created, 1);
  assert.deepEqual(again.body.skipped.map((s) => [s.employeeId, s.reason]), [[2, 'له حساب']]);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM users WHERE employee_id IN (2,3)").first()).n, 2);
  const c = await cand(env, admin);
  assert.ok(!c.body.candidates.some((x) => x.id === 2));
});

test('بريد مستعمل في حساب آخر يُتخطّى، ولا يُرفع أحد فوق «مدير مباشر» بالدفعة', async () => {
  const { db, env, admin } = await world();
  await db.prepare("INSERT INTO users (email, role) VALUES ('a@nawaculture.org', 'employee')").run(); // بريد الموظف 2 محجوز لحساب غير مرتبط
  const r = await bulk(env, admin, [{ employeeId: 2, role: 'employee' }]);
  assert.equal(r.body.created, 0);
  assert.equal(r.body.skipped[0].reason, 'بريده مستعمل في حساب آخر');
  for (const role of ['hr', 'director', 'admin', 'x']) {
    const bad = await bulk(env, admin, [{ employeeId: 3, role }]);
    assert.equal(bad.status, 400, role);
  }
});

test('تحقق المدخلات والصلاحية', async () => {
  const { env, admin, hr } = await world();
  assert.equal((await bulk(env, admin, [])).status, 400);
  assert.equal((await bulk(env, admin, [{ employeeId: 'x', role: 'employee' }])).status, 400);
  assert.equal((await bulk(env, admin, Array.from({ length: 201 }, (_, i) => ({ employeeId: i + 1, role: 'employee' })))).status, 400);
  assert.equal((await bulk(env, hr, [{ employeeId: 2, role: 'employee' }])).status, 403);
  assert.equal((await cand(env, hr)).status, 403);
  const ghost = await bulk(env, admin, [{ employeeId: 999, role: 'employee' }]);
  assert.equal(ghost.body.created, 0);
  assert.equal(ghost.body.skipped[0].reason, 'الموظف غير موجود');
});
