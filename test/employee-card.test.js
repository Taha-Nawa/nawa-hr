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

test('بطاقات دفعة واحدة: للموارد البشرية والمسؤول، الفعّالون ذوو البطاقة، ومن بلا بطاقة في missing', async () => {
  const { db, env } = await apiEnv();
  await seedOrg(db);
  await db.prepare("UPDATE employees SET status = 'inactive' WHERE id = 4").run();
  await db.prepare("DELETE FROM badges WHERE employee_id = 3").run();
  const hr = await login(db, 'hr@nawaculture.org', 'hr', null);
  const emp = await login(db, 'e@nawaculture.org', 'employee', 2);
  assert.equal((await call(env, 'GET', '/api/employees/cards', { cookie: emp.cookie })).status, 403);
  const all = await call(env, 'GET', '/api/employees/cards', { cookie: hr.cookie });
  assert.deepEqual(all.body.cards.map((c) => c.id), [1, 2]);
  assert.deepEqual(all.body.missing.map((m) => m.id), [3]);
  assert.ok(all.body.cards.every((c) => c.card));
  const some = await call(env, 'GET', '/api/employees/cards?ids=2,3', { cookie: hr.cookie });
  assert.deepEqual(some.body.cards.map((c) => c.id), [2]);
  assert.equal((await call(env, 'GET', '/api/employees/cards?ids=x', { cookie: hr.cookie })).status, 400);
});
