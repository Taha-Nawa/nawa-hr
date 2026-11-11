import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';

test('بطاقة الموظف: عرض، إعادة إصدار تُلغي القديمة، ولا تُصدر لغير الفعّال ولا لغير المخوَّل', async () => {
  const { db, env } = await apiEnv();
  await seedOrg(db);
  const hr = await login(db, 'hr@nawaculture.org', 'hr', 4);
  const emp = await login(db, 'emp3@nawaculture.org', 'employee', 3);
  await db.prepare("INSERT OR IGNORE INTO badges (card, employee_id) VALUES ('NW-003-A', 3)").run();
  assert.equal((await call(env, 'GET', '/api/employees/3/card', { cookie: emp.cookie })).status, 403);
  const g = await call(env, 'GET', '/api/employees/3/card', { cookie: hr.cookie });
  assert.equal(g.body.card, 'NW-003-A');
  const r = await call(env, 'POST', '/api/employees/3/card', { cookie: hr.cookie });
  assert.equal(r.status, 201);
  assert.match(r.body.card, /^.+-[0-9a-f]{12}$/);
  assert.equal((await db.prepare("SELECT status FROM badges WHERE card = 'NW-003-A'").first()).status, 'revoked');
  assert.equal((await call(env, 'GET', '/api/employees/3/card', { cookie: hr.cookie })).body.card, r.body.card);
  await db.prepare("UPDATE employees SET status = 'inactive' WHERE id = 3").run();
  assert.equal((await call(env, 'POST', '/api/employees/3/card', { cookie: hr.cookie })).status, 409);
});
