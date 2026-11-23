import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call } from './helpers/api.js';
import { canContracts } from '../src/worker/authz.js';

test('canContracts: الموارد البشرية ومسؤول النظام دائماً، وغيرهم بالصلاحية الفردية فقط', () => {
  assert.equal(canContracts({ role: 'hr' }), true);
  assert.equal(canContracts({ role: 'admin' }), true);
  for (const role of ['employee', 'manager', 'director']) {
    assert.equal(canContracts({ role }), false);
    assert.equal(canContracts({ role, contracts: 0 }), false);
    assert.equal(canContracts({ role, contracts: 1 }), true);
  }
  assert.equal(canContracts(null), false);
});

test('منح «يدير العقود» وسحبها عبر واجهة المستخدمين، ويحملها المستخدم الحالي', async () => {
  const { db, env } = await apiEnv();
  const admin = await login(db, 'adm@nawaculture.org', 'admin');
  const c = await call(env, 'POST', '/api/users', { cookie: admin.cookie, body: { email: 'clerk@nawaculture.org', role: 'employee', contracts: true } });
  assert.equal(c.status, 201);
  let list = (await call(env, 'GET', '/api/users', { cookie: admin.cookie })).body.users;
  const clerk = list.find((u) => u.email === 'clerk@nawaculture.org');
  assert.equal(clerk.contracts, 1);
  assert.equal((await call(env, 'PATCH', `/api/users/${clerk.id}`, { cookie: admin.cookie, body: { contracts: false } })).status, 200);
  list = (await call(env, 'GET', '/api/users', { cookie: admin.cookie })).body.users;
  assert.equal(list.find((u) => u.id === clerk.id).contracts, 0);
  // تعديل آخر لا يمسّ الصلاحية
  await call(env, 'PATCH', `/api/users/${clerk.id}`, { cookie: admin.cookie, body: { contracts: true } });
  await call(env, 'PATCH', `/api/users/${clerk.id}`, { cookie: admin.cookie, body: { active: true } });
  assert.equal((await call(env, 'GET', '/api/users', { cookie: admin.cookie })).body.users.find((u) => u.id === clerk.id).contracts, 1);
});

test('غير المسؤول لا يمنح الصلاحية', async () => {
  const { db, env } = await apiEnv();
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  const r = await call(env, 'POST', '/api/users', { cookie: hr.cookie, body: { email: 'x@nawaculture.org', role: 'employee', contracts: true } });
  assert.equal(r.status, 403);
});
