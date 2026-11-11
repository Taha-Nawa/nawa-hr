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

test('شكل البوب: يُعتمد من الموارد البشرية فقط ويصل للموظفين، ويطابق قائمة الواجهة', async () => {
  const { POP_SHAPES } = await import('../src/worker/announcements.js');
  const { SHAPES } = await import('../public/js/daily-pop-lib.js');
  assert.deepEqual(SHAPES.map(([id]) => id), POP_SHAPES);
  const { env, u } = await world();
  assert.equal((await j(env, u.emp2, 'GET', '/api/announcements/active')).body.shape, 'lantern', 'افتراضي');
  assert.equal((await j(env, u.emp2, 'PUT', '/api/pop-style', { shape: 'orb' })).status, 403);
  assert.equal((await j(env, u.hr, 'PUT', '/api/pop-style', { shape: 'نجمة' })).status, 400);
  assert.equal((await j(env, u.hr, 'PUT', '/api/pop-style', { shape: 'orb' })).status, 200);
  assert.equal((await j(env, u.emp4, 'GET', '/api/announcements/active')).body.shape, 'orb');
  assert.equal((await j(env, u.dir, 'GET', '/api/pop-style')).body.shape, 'orb');
});

test('رسائل الفريق: مسؤول الفريق يرسل لفريقه فقط، ويحمل اسمه، ويدير رسائله وحدها', async () => {
  const w = await world();
  const m = await login(w.db, 'mgr@nawaculture.org', 'manager', 1); // 1 يدير 2 و3
  const e2 = w.u.emp2;
  const e3 = await login(w.db, 'emp3@nawaculture.org', 'employee', 3);
  const e4 = w.u.emp4; // خارج فريقها
  assert.deepEqual((await j(w.env, m, 'GET', '/api/announcements/scope')).body, { ok: true, all: false, team: 2 });
  assert.equal((await j(w.env, e4, 'GET', '/api/announcements')).status, 403, 'بلا فريق');
  assert.equal((await j(w.env, m, 'POST', '/api/announcements', { body: 'للجميع', hours: 24, audience: 'all' })).status, 403, 'مسؤول الفريق لا يرسل للكل');
  assert.equal((await j(w.env, m, 'POST', '/api/announcements', { body: 'خارج', hours: 24, audience: 'employees', ids: [4] })).status, 403, 'ولا لمن خارج فريقه');

  const t = await j(w.env, m, 'POST', '/api/announcements', { title: 'تذكير', body: 'سلّموا التقارير اليوم', hours: 24, audience: 'team' });
  assert.equal(t.status, 200);
  const r2 = (await j(w.env, e2, 'GET', '/api/announcements/active')).body.items;
  assert.equal(r2.length, 1);
  assert.ok(r2[0].from, 'تحمل اسم المرسِل');
  assert.equal((await j(w.env, e3, 'GET', '/api/announcements/active')).body.items.length, 1);
  assert.equal((await j(w.env, e4, 'GET', '/api/announcements/active')).body.items.length, 0, 'من خارج الفريق لا يراها');
  assert.equal((await j(w.env, m, 'GET', '/api/announcements/active')).body.items.length, 0, 'المرسِل لا تظهر له رسالته');

  const mine = (await j(w.env, m, 'GET', '/api/announcements')).body.items;
  assert.deepEqual([mine.length, mine[0].target], [1, 2]);
  await j(w.env, w.u.hr, 'POST', '/api/announcements', { body: 'عامة', hours: 24, audience: 'all' });
  assert.equal((await j(w.env, m, 'GET', '/api/announcements')).body.items.length, 1, 'لا يرى رسائل الإدارة');
  assert.equal((await j(w.env, e2, 'DELETE', `/api/announcements/${t.body.id}`)).status, 403);
  assert.equal((await j(w.env, m, 'DELETE', `/api/announcements/${t.body.id}`)).status, 200);
  assert.equal((await j(w.env, e2, 'GET', '/api/announcements/active')).body.items.filter((x) => x.from).length, 0);
});

test('رسائل البوب: وقت ظهور واختفاء محدد (تاريخ وساعة) ومجدولة للمستقبل', async () => {
  const { env, u } = await world();
  const post = (b) => j(env, u.hr, 'POST', '/api/announcements', { body: 'رسالة مجدولة', audience: 'all', ...b });
  const at = (m) => new Date(Date.parse('2026-11-11T08:00:00Z') + m * 60000).toISOString();
  assert.equal((await post({ startsAt: at(60), endsAt: at(30) })).status, 400, 'الاختفاء قبل الظهور');
  assert.equal((await post({ startsAt: at(60), endsAt: at(62) })).status, 400, 'أقل من 5 دقائق');
  assert.equal((await post({ startsAt: at(0), endsAt: at(60 * 24 * 31) })).status, 400, 'أكثر من شهر');
  assert.equal((await post({ startsAt: at(60 * 24 * 100), endsAt: at(60 * 24 * 101) })).status, 400, 'أبعد من 90 يوماً');
  assert.equal((await post({ startsAt: 'غد', endsAt: at(60) })).status, 400);
  const ok = await post({ startsAt: at(120), endsAt: at(180) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.startsAt, at(120));
  assert.equal((await j(env, u.emp2, 'GET', '/api/announcements/active')).body.items.length, 0, 'لم يحن وقتها');
  const past = await post({ startsAt: at(-500), endsAt: at(60) }); // بداية في الماضي تصير الآن
  assert.equal(past.body.startsAt, at(0));
  assert.equal((await j(env, u.emp2, 'GET', '/api/announcements/active')).body.items.length, 1);
  const list = (await j(env, u.hr, 'GET', '/api/announcements')).body.items;
  assert.ok(list.some((x) => x.status === 'scheduled'));
  env.__NOW = '2026-11-11T10:30:00Z'; // بعد ساعتين ونصف: المجدولة ظاهرة والأخرى انتهت
  const later = (await j(env, u.emp2, 'GET', '/api/announcements/active')).body.items;
  assert.equal(later.length, 1);
});
