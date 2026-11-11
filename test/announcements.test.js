import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';

async function world() {
  const { db, env } = await apiEnv();
  env.__NOW = '2026-11-11T08:00:00Z';
  await seedOrg(db);
  const u = {
    emp2: await login(db, 'emp2@nawaculture.org', 'employee', 2),
    emp4: await login(db, 'emp4@nawaculture.org', 'employee', 4),
    hr: await login(db, 'hr@nawaculture.org', 'hr', null),
    dir: await login(db, 'dir@nawaculture.org', 'director', null),
  };
  return { db, env, u };
}
const j = (env, who, method, path, body) => call(env, method, path, { cookie: who.cookie, body });

test('رسائل البوب: للموارد البشرية فقط، وتظهر للمستهدفين مرة واحدة وتنتهي بانتهاء المدة', async () => {
  const { env, u } = await world();
  assert.equal((await j(env, u.emp2, 'POST', '/api/announcements', { body: 'x', hours: 24, audience: 'all' })).status, 403);
  assert.equal((await j(env, u.dir, 'GET', '/api/announcements')).status, 403);
  assert.equal((await j(env, u.hr, 'POST', '/api/announcements', { body: '', hours: 24, audience: 'all' })).status, 400);
  assert.equal((await j(env, u.hr, 'POST', '/api/announcements', { body: 'رسالة', hours: 0, audience: 'all' })).status, 400);
  assert.equal((await j(env, u.hr, 'POST', '/api/announcements', { body: 'رسالة', hours: 24, audience: 'employees', ids: [] })).status, 400);

  const all = await j(env, u.hr, 'POST', '/api/announcements', { title: 'اجتماع', body: 'اجتماع عام غداً الساعة 10', hours: 24, audience: 'all' });
  assert.equal(all.status, 200);
  const only2 = await j(env, u.hr, 'POST', '/api/announcements', { body: 'خاصة بموظف', hours: 48, audience: 'employees', ids: [2] });

  const a2 = (await j(env, u.emp2, 'GET', '/api/announcements/active')).body.items;
  assert.equal(a2.length, 2);
  const a4 = (await j(env, u.emp4, 'GET', '/api/announcements/active')).body.items;
  assert.deepEqual(a4.map((x) => x.body), ['اجتماع عام غداً الساعة 10'], 'الموظف 4 لا يرى الخاصة بغيره');
  assert.equal((await j(env, u.hr, 'GET', '/api/announcements/active')).status, 200);

  await j(env, u.emp2, 'POST', `/api/announcements/${all.body.id}/seen`);
  assert.equal((await j(env, u.emp2, 'GET', '/api/announcements/active')).body.items.length, 1, 'لا تتكرر بعد المشاهدة');
  assert.equal((await j(env, u.emp4, 'GET', '/api/announcements/active')).body.items.length, 1, 'مشاهدة غيره لا تؤثر');

  const list = (await j(env, u.hr, 'GET', '/api/announcements')).body.items;
  const row = list.find((x) => x.id === all.body.id);
  assert.deepEqual([row.status, row.seen], ['live', 1]);
  assert.equal(list.find((x) => x.id === only2.body.id).target, 1);

  await j(env, u.hr, 'DELETE', `/api/announcements/${only2.body.id}`);
  assert.equal((await j(env, u.emp2, 'GET', '/api/announcements/active')).body.items.length, 0, 'المسحوبة تختفي');
  assert.equal((await j(env, u.hr, 'GET', '/api/announcements')).body.items.find((x) => x.id === only2.body.id).status, 'revoked');

  env.__NOW = '2026-11-12T09:00:00Z'; // بعد 25 ساعة
  assert.equal((await j(env, u.emp4, 'GET', '/api/announcements/active')).body.items.length, 0, 'انتهت المدة');
  assert.equal((await j(env, u.hr, 'GET', '/api/announcements')).body.items.find((x) => x.id === all.body.id).status, 'ended');
});
