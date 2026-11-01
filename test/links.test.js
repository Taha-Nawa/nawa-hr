import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';
import { validateLinks, visibleTo, DEFAULT_LINKS, MAX_LINKS } from '../src/worker/links.js';

async function world() {
  const { db, env } = await apiEnv();
  await seedOrg(db);
  const u = {
    employee: await login(db, 'emp@nawaculture.org', 'employee', 2),
    manager: await login(db, 'mgr@nawaculture.org', 'manager', 1),
    hr: await login(db, 'hr@nawaculture.org', 'hr', 4),
    director: await login(db, 'dir@nawaculture.org', 'director', null),
    admin: await login(db, 'adm@nawaculture.org', 'admin', null),
  };
  return { db, env, u };
}

const SAMPLE = [
  { id: 'a', group: 'عام', title: 'للجميع', url: 'https://example.org/all', audience: 'all' },
  { id: 'b', group: 'إدارة', title: 'للموارد البشرية', url: 'https://example.org/staff', audience: 'staff' },
  { id: 'c', group: 'تقنية', title: 'للمسؤول', url: 'https://example.org/admin', audience: 'admin' },
];

const titles = (r) => r.body.links.map((l) => l.id).sort();

test('visibleTo: كل جمهور يرى ما يخصه فقط', () => {
  const rows = (role) => SAMPLE.filter((l) => visibleTo(role, l)).map((l) => l.id);
  assert.deepEqual(rows('employee'), ['a']);
  assert.deepEqual(rows('manager'), ['a']);
  assert.deepEqual(rows('hr'), ['a', 'b']);
  assert.deepEqual(rows('director'), ['a', 'b']);
  assert.deepEqual(rows('admin'), ['a', 'b', 'c']);
});

test('بلا قائمة محفوظة: تظهر الروابط الافتراضية بحسب الدور', async () => {
  const { env, u } = await world();
  const admin = await call(env, 'GET', '/api/links', { cookie: u.admin.cookie });
  assert.equal(admin.status, 200);
  assert.equal(admin.body.canManage, true);
  assert.equal(admin.body.links.length, DEFAULT_LINKS.length);
  const hr = await call(env, 'GET', '/api/links', { cookie: u.hr.cookie });
  assert.equal(hr.body.canManage, false);
  assert.ok(hr.body.links.length > 0 && hr.body.links.every((l) => l.audience !== 'admin'));
  const emp = await call(env, 'GET', '/api/links', { cookie: u.employee.cookie });
  assert.deepEqual(emp.body.links, [], 'الافتراضيات كلها للإدارة فقط');
});

test('الحفظ ثم القراءة: الخادم يفلتر بحسب الدور ولا يرسل ما لا يحق رؤيته', async () => {
  const { env, u } = await world();
  const put = await call(env, 'PUT', '/api/links', { cookie: u.admin.cookie, body: { links: SAMPLE } });
  assert.equal(put.status, 200);
  const read = async (who) => titles(await call(env, 'GET', '/api/links', { cookie: u[who].cookie }));
  assert.deepEqual(await read('employee'), ['a']);
  assert.deepEqual(await read('manager'), ['a']);
  assert.deepEqual(await read('hr'), ['a', 'b']);
  assert.deepEqual(await read('director'), ['a', 'b']);
  assert.deepEqual(await read('admin'), ['a', 'b', 'c']);
  const raw = JSON.stringify((await call(env, 'GET', '/api/links', { cookie: u.employee.cookie })).body);
  assert.ok(!raw.includes('example.org/admin') && !raw.includes('example.org/staff'));
});

test('الحفظ يستبدل القائمة كلها ويكتب سجلاً في التدقيق', async () => {
  const { db, env, u } = await world();
  await call(env, 'PUT', '/api/links', { cookie: u.admin.cookie, body: { links: SAMPLE } });
  await call(env, 'PUT', '/api/links', { cookie: u.admin.cookie, body: { links: [SAMPLE[0]] } });
  assert.deepEqual(titles(await call(env, 'GET', '/api/links', { cookie: u.admin.cookie })), ['a']);
  const rows = await db.prepare("SELECT action FROM audit_log WHERE action = 'links.update'").all();
  assert.equal(rows.results.length, 2);
});

test('قائمة فارغة مقبولة (يمسح المسؤول كل شيء) ولا تعود الافتراضيات', async () => {
  const { env, u } = await world();
  assert.equal((await call(env, 'PUT', '/api/links', { cookie: u.admin.cookie, body: { links: [] } })).status, 200);
  assert.deepEqual((await call(env, 'GET', '/api/links', { cookie: u.admin.cookie })).body.links, []);
});

test('التحقق: عناوين غير https أو خطرة أو بلا عنوان تُرفض', () => {
  const bad = (l) => validateLinks([{ title: 'ت', url: 'https://example.org', ...l }]).error;
  assert.ok(bad({ url: 'http://example.org' }), 'http');
  assert.ok(bad({ url: 'javascript:alert(1)' }), 'javascript');
  assert.ok(bad({ url: 'data:text/html,<b>x</b>' }), 'data');
  assert.ok(bad({ url: 'https://localhost' }), 'بلا نقطة في المضيف');
  assert.ok(bad({ url: 'https://exa mple.org' }), 'فراغ');
  assert.ok(bad({ url: '' }), 'فارغ');
  assert.ok(bad({ url: 42 }), 'ليس نصاً');
  assert.ok(bad({ title: '  ' }), 'عنوان فارغ');
  assert.ok(bad({ audience: 'everyone' }), 'جمهور غير معروف');
  assert.ok(validateLinks('x').error, 'ليست مصفوفة');
  assert.ok(validateLinks(new Array(MAX_LINKS + 1).fill({ title: 'ت', url: 'https://example.org' })).error, 'أكثر من الحد');
});

test('التحقق: الافتراضات (جمهور staff، مجموعة «أخرى») والمعرّفات المفقودة أو المكررة', () => {
  const { links, error } = validateLinks([
    { title: 'أ', url: 'https://example.org/a' },
    { id: 'dup', title: 'ب', url: 'https://example.org/b' },
    { id: 'dup', title: 'ج', url: 'https://example.org/c', group: 'مجموعة', note: 'ملاحظة' },
  ]);
  assert.equal(error, undefined);
  assert.equal(links[0].audience, 'staff');
  assert.equal(links[0].group, 'أخرى');
  assert.match(links[0].id, /^[0-9a-f]+$/);
  assert.equal(new Set(links.map((l) => l.id)).size, 3);
  assert.equal(links[2].note, 'ملاحظة');
});

test('PUT برسالة غير صالحة يُرجع 400 ولا يغيّر المحفوظ', async () => {
  const { env, u } = await world();
  await call(env, 'PUT', '/api/links', { cookie: u.admin.cookie, body: { links: SAMPLE } });
  const r = await call(env, 'PUT', '/api/links', { cookie: u.admin.cookie, body: { links: [{ title: 'س', url: 'http://x.org' }] } });
  assert.equal(r.status, 400);
  assert.deepEqual(titles(await call(env, 'GET', '/api/links', { cookie: u.admin.cookie })), ['a', 'b', 'c']);
});

test('غير المسؤول لا يحفظ (403) ولا يتغير المحفوظ', async () => {
  const { env, u } = await world();
  for (const who of ['employee', 'manager', 'hr', 'director']) {
    const r = await call(env, 'PUT', '/api/links', { cookie: u[who].cookie, body: { links: SAMPLE } });
    assert.equal(r.status, 403, who);
  }
  assert.equal((await call(env, 'GET', '/api/links', { cookie: u.admin.cookie })).body.links.length, DEFAULT_LINKS.length);
});

test('عدد الاستعلامات ثابت وصغير', async () => {
  const { env, u } = await world();
  await call(env, 'GET', '/api/links', { cookie: u.admin.cookie });
  const read = env.DB.queries;
  await call(env, 'PUT', '/api/links', { cookie: u.admin.cookie, body: { links: SAMPLE } });
  const write = env.DB.queries;
  assert.ok(read <= 5, `استعلامات القراءة: ${read}`);
  assert.ok(write <= 8, `استعلامات الحفظ: ${write}`);
});
