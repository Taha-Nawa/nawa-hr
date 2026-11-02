import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';
import { setWork, addEmployee } from './helpers/seed.js';

// «اليوم»: الإثنين 2026-11-02 الساعة 09:00 بتوقيت الخليل
const NOW = '2026-11-02T07:00:00Z';
const SETTINGS = {
  start: '08:30', end: '15:00', toleranceMinutes: 10,
  weekdays: ['عمل', 'عمل', 'عمل', 'عمل', 'عمل', 'عطلة أسبوعية', 'عطلة أسبوعية'],
  leaveTypes: { 'إجازة سنوية': true, 'إجازة مرضية': true, 'إجازة رسمية / طارئة': true },
};

async function world() {
  const { db, env } = await apiEnv();
  env.__NOW = NOW;
  await setWork(db, SETTINGS);
  await seedOrg(db); // 1 مديرة، 2 و3 مرؤوسان، 4 مستقل
  const u = {
    emp2: await login(db, 'emp2@nawaculture.org', 'employee', 2),
    mgr: await login(db, 'mgr@nawaculture.org', 'manager', 1),
    hr: await login(db, 'hr@nawaculture.org', 'hr', 4),
    director: await login(db, 'dir@nawaculture.org', 'director', null),
    admin: await login(db, 'adm@nawaculture.org', 'admin', null),
  };
  return { db, env, u };
}
const post = (env, who, path, body) => call(env, 'POST', path, { cookie: who.cookie, body });
const put = (env, who, path, body) => call(env, 'PUT', path, { cookie: who.cookie, body });
const get = (env, who, path) => call(env, 'GET', path, { cookie: who.cookie });
const row = async (env, who, id, year = 2026) => (await get(env, who, `/api/balances?year=${year}`)).body.employees.find((e) => e.id === id);
const leave = (o = {}) => ({ kind: 'leave', purpose: 'annual', reason: 'سفر', fromDate: '2026-11-08', toDate: '2026-11-10', ...o });

test('الموارد البشرية توزّع الرصيد على عدة موظفين دفعة واحدة، وغير المحدَّد لا رصيد له', async () => {
  const { env, u } = await world();
  const r = await put(env, u.hr, '/api/balances', { year: 2026, employeeIds: [2, 3], items: { annual: 21, sick: 10.5 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.employees, 2);
  const a = await row(env, u.hr, 2);
  assert.deepEqual(a.balances.annual, { total: 21, source: 'personal', used: 0, pending: 0, remaining: 21 });
  assert.equal(a.balances.sick.total, 10.5, 'نصف يوم مقبول');
  assert.equal((await row(env, u.hr, 3)).balances.annual.total, 21);
  assert.equal((await row(env, u.hr, 4)).balances.annual.total, null, 'من لم يُحدَّد له لا رصيد');
  assert.equal((await row(env, u.hr, 4)).balances.annual.remaining, null);
  assert.equal((await row(env, u.hr, 2, 2027)).balances.annual.total, null, 'الرصيد لكل سنة على حدة');
});

test('الرصيد الافتراضي من القواعد لمن بلا رصيد خاص، والخاص يتقدّم عليه', async () => {
  const { db, env, u } = await world();
  await db.prepare("INSERT INTO settings (key, value) VALUES ('requests', ?)").bind(JSON.stringify({ entitlement: { annual: 15, sick: 8 } })).run();
  await put(env, u.hr, '/api/balances', { year: 2026, employeeIds: [2], items: { annual: 30 } });
  const a = await row(env, u.hr, 2);
  assert.deepEqual([a.balances.annual.total, a.balances.annual.source], [30, 'personal']);
  assert.deepEqual([a.balances.sick.total, a.balances.sick.source], [8, 'default']);
  const b = await row(env, u.hr, 3);
  assert.deepEqual([b.balances.annual.total, b.balances.annual.source], [15, 'default']);
  // إزالة الرصيد الخاص (null) تعيده إلى الافتراضي
  await put(env, u.hr, '/api/balances', { year: 2026, employeeIds: [2], items: { annual: null } });
  assert.deepEqual([(await row(env, u.hr, 2)).balances.annual.total, (await row(env, u.hr, 2)).balances.annual.source], [15, 'default']);
});

test('اعتماد الإجازة يخصم من الرصيد، والمعلّق يظهر منفصلاً، وإلغاء الاعتماد يردّه', async () => {
  const { env, u } = await world();
  await put(env, u.hr, '/api/balances', { year: 2026, employeeIds: [2], items: { annual: 21 } });
  const r = await post(env, u.emp2, '/api/requests', leave());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  let a = await row(env, u.hr, 2);
  assert.deepEqual([a.balances.annual.used, a.balances.annual.pending, a.balances.annual.remaining], [0, 3, 21], 'المعلّق لا يخصم');
  assert.equal(a.requests.pending, 1);

  assert.equal((await post(env, u.mgr, `/api/requests/${r.body.id}/approve`, {})).status, 200);
  a = await row(env, u.hr, 2);
  assert.deepEqual([a.balances.annual.used, a.balances.annual.pending, a.balances.annual.remaining], [3, 0, 18]);
  assert.deepEqual([a.requests.approved, a.requests.pending], [1, 0]);

  assert.equal((await post(env, u.hr, `/api/requests/${r.body.id}/cancel`, { note: 'تراجع' })).status, 200);
  a = await row(env, u.hr, 2);
  assert.deepEqual([a.balances.annual.used, a.balances.annual.remaining], [0, 21], 'رُدّ الرصيد');
  assert.equal(a.requests.cancelled, 1);
});

test('حساب الطلب يستعمل رصيد الموظف الخاص ويحذّر عند تجاوزه، وصفحة الطلبات تعرض رصيده', async () => {
  const { env, u } = await world();
  await put(env, u.hr, '/api/balances', { year: 2026, employeeIds: [2], items: { annual: 2 } });
  const pv = await post(env, u.emp2, '/api/requests/preview', leave());
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  assert.equal(pv.body.calc.entitlement, 2);
  assert.equal(pv.body.calc.entitlementSource, 'personal');
  assert.equal(pv.body.calc.remaining, -1);
  assert.ok(pv.body.calc.warnings.some((w) => /يتجاوز الرصيد/.test(w)));
  const meta = await get(env, u.emp2, '/api/requests/meta');
  assert.deepEqual(meta.body.balance.items.map((i) => [i.purpose, i.total, i.remaining]), [['annual', 2, 2]]);
  assert.equal((await get(env, u.hr, '/api/requests/meta')).body.balance, null, 'من بلا رصيد لا يرى شريطاً');
});

test('النطاق: الموظف نفسه، والمدير فريقه، والبقية الكل', async () => {
  const { env, u } = await world();
  const ids = async (who) => (await get(env, who, '/api/balances?year=2026')).body.employees.map((e) => e.id).sort();
  assert.deepEqual(await ids(u.emp2), [2]);
  assert.deepEqual(await ids(u.mgr), [1, 2, 3]);
  assert.deepEqual(await ids(u.hr), [1, 2, 3, 4]);
  assert.deepEqual(await ids(u.director), [1, 2, 3, 4]);
  assert.equal((await get(env, u.hr, '/api/balances?year=2026')).body.canEdit, true);
  assert.equal((await get(env, u.director, '/api/balances?year=2026')).body.canEdit, false);
  assert.equal((await get(env, u.hr, '/api/balances?year=1999')).status, 400);
});

test('التوزيع محصور بالموارد البشرية والمسؤول، والمدخلات الخاطئة تُرفض', async () => {
  const { db, env, u } = await world();
  const ok = { year: 2026, employeeIds: [2], items: { annual: 21 } };
  for (const who of [u.emp2, u.mgr, u.director]) assert.equal((await put(env, who, '/api/balances', ok)).status, 403);
  assert.equal((await put(env, u.admin, '/api/balances', ok)).status, 200);
  const bad = (over) => put(env, u.hr, '/api/balances', { ...ok, ...over }).then((r) => r.status);
  assert.equal(await bad({ year: 2019 }), 400);
  assert.equal(await bad({ employeeIds: [] }), 400);
  assert.equal(await bad({ employeeIds: ['x'] }), 400);
  assert.equal(await bad({ items: {} }), 400);
  assert.equal(await bad({ items: { holiday: 5 } }), 400, 'نوع غير معروف');
  assert.equal(await bad({ items: { annual: 0.3 } }), 400, 'ليس مضاعف نصف يوم');
  assert.equal(await bad({ items: { annual: -1 } }), 400);
  assert.equal(await bad({ items: { annual: 367 } }), 400);
  assert.equal(await bad({ items: { annual: '21' } }), 400, 'نص لا رقم');
  assert.equal(await bad({ employeeIds: [999] }), 404);
  assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'balance.set'").first('n'), 1, 'القرار موثّق في التدقيق');
});

test('الموظف غير الفعّال لا يظهر ولا يُوزَّع له', async () => {
  const { db, env, u } = await world();
  await addEmployee(db, { id: 9, code: 'NW-009', status: 'inactive' });
  assert.equal((await put(env, u.hr, '/api/balances', { year: 2026, employeeIds: [9], items: { annual: 5 } })).status, 404);
  assert.equal((await get(env, u.hr, '/api/balances?year=2026')).body.employees.some((e) => e.id === 9), false);
});

test('نسخ توزيع سنة إلى التالية لا يطغى على ما حُدِّد فيها', async () => {
  const { env, u } = await world();
  await put(env, u.hr, '/api/balances', { year: 2026, employeeIds: [2, 3], items: { annual: 21, sick: 10 } });
  await put(env, u.hr, '/api/balances', { year: 2027, employeeIds: [3], items: { annual: 25 } });
  const r = await post(env, u.hr, '/api/balances/copy', { from: 2026, to: 2027 });
  assert.equal(r.status, 200);
  assert.equal(r.body.copied, 3, '4 أسطر مصدر - 1 موجود');
  assert.equal((await row(env, u.hr, 2, 2027)).balances.annual.total, 21);
  assert.equal((await row(env, u.hr, 3, 2027)).balances.annual.total, 25, 'لم يُستبدل');
  assert.equal((await row(env, u.hr, 3, 2027)).balances.sick.total, 10);
  assert.equal((await post(env, u.hr, '/api/balances/copy', { from: 2026, to: 2026 })).status, 400);
});

test('عدد استعلامات جدول الأرصدة ثابت وصغير مهما كثر الموظفون', async () => {
  const { db, env, u } = await world();
  for (let i = 10; i < 40; i++) {
    env.DB.resetCount();
    await addEmployee(db, { id: i, code: `NW-0${i}` });
  }
  await put(env, u.hr, '/api/balances', { year: 2026, employeeIds: Array.from({ length: 30 }, (_, i) => i + 10), items: { annual: 21, sick: 10 } });
  const r = await get(env, u.hr, '/api/balances?year=2026');
  assert.equal(r.body.employees.length, 34);
  assert.ok(env.DB.queries <= 12, `استعلامات: ${env.DB.queries}`);
});
