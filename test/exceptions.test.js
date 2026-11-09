import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';
import { setWork, addOverride, addHolidays } from './helpers/seed.js';
import { buildTimesheet } from '../src/engine/timesheet.js';

const NOW = '2026-11-02T07:00:00Z';
const FRI = '2026-10-30';
const SETTINGS = {
  start: '08:30', end: '15:00', toleranceMinutes: 10,
  weekdays: ['عمل', 'عمل', 'عمل', 'عمل', 'عمل', 'عطلة أسبوعية', 'عطلة أسبوعية'],
  leaveTypes: { 'إجازة سنوية': true },
};

async function world() {
  const { db, env } = await apiEnv();
  env.__NOW = NOW;
  await setWork(db, SETTINGS);
  await seedOrg(db);
  const u = {
    emp: await login(db, 'emp2@nawaculture.org', 'employee', 2),
    hr: await login(db, 'hr@nawaculture.org', 'hr', 4),
  };
  return { db, env, u };
}
const post = (env, who, path, body) => call(env, 'POST', path, { cookie: who.cookie, body });
const row = (db, id, date) => db.prepare('SELECT day_type AS dt, status, required_hours AS req, approved_hours AS ap, deficit_hours AS def, overtime_hours AS ot, late_minutes AS late FROM daily_results WHERE employee_id = ? AND date = ?').bind(id, date).first();

test('دوام استثنائي يوم الجمعة: يُحتسب عمل بلا عجز، والإلغاء يعيده إضافياً فقط', async () => {
  const { db, env, u } = await world();
  await addOverride(db, 2, FRI, { manual: { in: '09:00', dep: '13:00' } }); // 4 ساعات
  assert.equal((await post(env, u.hr, '/api/recompute', { from: FRI, to: FRI })).status, 200);
  assert.deepEqual(await row(db, 2, FRI), { dt: 'عطلة أسبوعية', status: 'عطلة أسبوعية', req: 0, ap: 0, def: 0, ot: 4, late: 0 });

  assert.equal((await post(env, u.emp, '/api/work-exceptions', { employeeId: 2, date: FRI })).status, 403);
  assert.equal((await post(env, u.hr, '/api/work-exceptions', { employeeId: 2, date: '2026-10-29' })).status, 400, 'يوم دوام عادي');
  assert.equal((await post(env, u.hr, '/api/work-exceptions', { employeeId: 2, date: '2026-11-03' })).status, 400, 'يوم لم يأتِ');

  const r = await post(env, u.hr, '/api/work-exceptions', { employeeId: 2, date: FRI, comp: 'leave', note: 'تسليم مشروع' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(await row(db, 2, FRI), { dt: 'عطلة أسبوعية', status: 'حاضر', req: 4, ap: 4, def: 0, ot: 0, late: 0 });

  const l = await call(env, 'GET', '/api/work-exceptions?month=2026-10', { cookie: u.hr.cookie });
  assert.equal(l.body.exceptions.length, 1);
  assert.equal(l.body.exceptions[0].comp, 'leave');

  assert.equal((await post(env, u.hr, '/api/work-exceptions/cancel', { employeeId: 2, date: FRI })).status, 200);
  assert.equal((await row(db, 2, FRI)).ap, 0);
  const acts = (await db.prepare("SELECT action FROM audit_log WHERE action LIKE 'exception.%' ORDER BY id").all()).results.map((x) => x.action);
  assert.deepEqual(acts, ['exception.set', 'exception.cancel']);
});

test('عطلة رسمية: غير محتسب يبقى إضافياً، والمحتسب لا يتجاوز الساعات الرسمية', async () => {
  const { db, env, u } = await world();
  const HOL = '2026-10-28';
  await addHolidays(db, [HOL]);
  await addOverride(db, 2, HOL, { manual: { in: '08:30', dep: '16:30' } }); // 8 ساعات
  const r1 = await post(env, u.hr, '/api/work-exceptions', { employeeId: 2, date: HOL, counted: false });
  assert.equal(r1.status, 201);
  assert.equal((await row(db, 2, HOL)).ap, 0);
  await post(env, u.hr, '/api/work-exceptions', { employeeId: 2, date: HOL, counted: true });
  const d = await row(db, 2, HOL);
  assert.equal(d.dt, 'عطلة رسمية');
  assert.equal(d.ap, 6.5);
  assert.equal(d.ot, 1.5);
});

test('التايم شيت: اليوم الاستثنائي يدخل صفوف المشاريع ويزول تظليله', () => {
  const days = { '2026-10-30': { dayType: 'عطلة أسبوعية', approvedHours: 4, leaveType: '', exceptional: true }, '2026-10-31': { dayType: 'عطلة أسبوعية', approvedHours: 0, leaveType: '' } };
  const alloc = [{ funder: 'A', share: 1, from: '2026-01-01', to: '2026-12-31' }];
  const ts = buildTimesheet({ year: 2026, month: 10, days, allocations: alloc, dayHours: 6.5 });
  assert.equal(ts.funders[0].values[29], 4);
  assert.equal(ts.annual.values[29], null, 'لا إجازة سنوية تعويضية');
  assert.equal(ts.off[29], false);
  assert.equal(ts.off[30], true, 'السبت المجاور يبقى مظللاً');
});

test('المراجعة والتسوية: ساعات الممولين وسلامة البيانات، والموظف العادي ممنوع', async () => {
  const { db, env, u } = await world();
  await db.prepare("INSERT INTO employee_projects (employee_id, funder, share, from_date, to_date) VALUES (2, 'GIZ', 0.6, '2026-10-01', '2026-10-31'), (2, 'EU', 0.4, '2026-10-01', '2026-10-31')").run();
  await addOverride(db, 2, '2026-10-26', { manual: { in: '08:30', dep: '15:00' } });
  assert.equal((await post(env, u.hr, '/api/recompute', { from: '2026-10-26', to: '2026-10-26' })).status, 200);
  const f = await call(env, 'GET', '/api/insights/funders?month=2026-10', { cookie: u.hr.cookie });
  assert.equal(f.status, 200, JSON.stringify(f.body));
  assert.deepEqual(f.body.funders.map((x) => [x.funder, x.hours]), [['GIZ', 3.9], ['EU', 2.6]]);
  const i = await call(env, 'GET', '/api/insights/integrity', { cookie: u.hr.cookie });
  assert.equal(i.status, 200);
  const alloc = i.body.checks.find((c) => c.key === 'allocation');
  assert.ok(alloc.items.some((x) => x.name.includes('NW-001')), 'موظف بلا توزيع اليوم يُذكر');
  assert.equal((await call(env, 'GET', '/api/insights/integrity', { cookie: u.emp.cookie })).status, 403);
});

test('الاتجاهات والأنماط: مقارنة مع الشهر السابق، وتنبيه التأخر/الغياب المتكرر، والمدير يرى فريقه فقط', async () => {
  const { db, env, u } = await world();
  // موظف 2: غياب يومان وتأخر 3 مرات قبل «اليوم» (2026-11-02)
  const days = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-25'];
  for (const d of days.slice(0, 3)) await addOverride(db, 2, d, { manual: { in: '09:30', dep: '15:00' } }); // متأخر
  assert.equal((await post(env, u.hr, '/api/recompute', { from: '2026-10-25', to: '2026-10-29' })).status, 200);
  const p = await call(env, 'GET', '/api/insights/patterns', { cookie: u.hr.cookie });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const e2 = p.body.employees.find((x) => x.id === 2);
  assert.ok(e2 && e2.lateFlag, 'ثلاث مرات تأخر');
  const t = await call(env, 'GET', '/api/insights/trends?month=2026-10', { cookie: u.hr.cookie });
  assert.equal(t.status, 200);
  assert.ok(t.body.rows.length >= 1 && t.body.prev === '2026-09');
  assert.equal((await call(env, 'GET', '/api/insights/trends?month=2026-10', { cookie: u.emp.cookie })).status, 403);
});

test('مصفوفة الصلاحيات تُقرأ لمن يقرأ التدقيق فقط', async () => {
  const { env, u } = await world();
  const r = await call(env, 'GET', '/api/permissions', { cookie: u.hr.cookie });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.actions['exception.manage'], ['hr', 'admin']);
  assert.equal((await call(env, 'GET', '/api/permissions', { cookie: u.emp.cookie })).status, 403);
});

test('ترويسات التقرير: مجموعات مسمّاة، قراءة للجميع، كتابة للموارد البشرية بتحقق كامل', async () => {
  const { env, u } = await world();
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const put = (who, body) => call(env, 'PUT', '/api/report-header', { cookie: who.cookie, body });
  const logo = (o = {}) => ({ name: 'x', data: PNG, pos: 'right', width: 30, ...o });
  const set = (o = {}) => ({ id: 'a', name: 'رسمية', logos: [logo()], ...o });
  assert.equal((await put(u.emp, { sets: [] })).status, 403);
  assert.equal((await put(u.hr, { sets: [set({ logos: [logo({ data: 'http://evil/x.png' })] })] })).status, 400);
  assert.equal((await put(u.hr, { sets: [set({ logos: [logo({ pos: 'top' })] })] })).status, 400);
  assert.equal((await put(u.hr, { sets: [set({ logos: [logo({ width: 500 })] })] })).status, 400);
  assert.equal((await put(u.hr, { sets: [set({ name: '' })] })).status, 400);
  assert.equal((await put(u.hr, { sets: [set(), set()] })).status, 400, 'معرّف مكرر');
  assert.equal((await put(u.hr, { sets: [set(), set({ id: 'b', name: 'ممولين', logos: [logo({ pos: 'center' }), logo({ pos: 'left' })] })], default: 'b' })).status, 200);
  const g = await call(env, 'GET', '/api/report-header', { cookie: u.emp.cookie });
  assert.deepEqual(g.body.header.sets.map((x) => x.name), ['رسمية', 'ممولين']);
  assert.equal(g.body.header.default, 'b');
  assert.equal(g.body.canEdit, false);
});

test('الموقع: يُحفظ مع الحركة، ويُعلَّم الخروج عن نطاق المركز وتباعد الحركات، ولا تُعلَّم الحركات المتقاربة', async () => {
  const { db, env, u } = await world();
  await db.prepare('UPDATE centers SET lat = 31.4167, lng = 34.3500, radius_m = 150 WHERE id = 1').run();
  const { DEVICE_TOKEN, gatePost, mv } = await import('./helpers/seed.js');
  const mk = (code, type, time, lat, lng) => ({ ...mv(code, type, '2026-11-02', time), lat, lng, acc: 12 });
  // NW-002 (مركز 1): حضور قرب المركز ثم انصراف بعيد 1كم؛ NW-003: حركتان متقاربتان؛ NW-004: حضور بعيد عن المركز
  const r = await gatePost(env, [
    mk('NW-002', 'حضور', '08:30', 31.4168, 34.3501), mk('NW-002', 'انصراف', '15:00', 31.4260, 34.3500),
    mk('NW-003', 'حضور', '08:30', 31.4168, 34.3501), mk('NW-003', 'انصراف', '15:00', 31.4169, 34.3502),
    mk('NW-004', 'حضور', '08:30', 31.4400, 34.3500),
  ], DEVICE_TOKEN);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = await db.prepare("SELECT lat, acc FROM movements WHERE code = 'NW-002' AND type = 'حضور'").first();
  assert.equal(row.acc, 12);
  const res = await call(env, 'GET', '/api/insights/locations?days=14', { cookie: u.hr.cookie });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const by = Object.fromEntries(res.body.days.map((d) => [d.code, d.flags]));
  assert.equal(by['NW-002'].spread, true);
  assert.equal(by['NW-004'].outside, true);
  assert.equal(by['NW-003'], undefined, 'متقاربة ضمن النطاق');
  assert.equal((await call(env, 'GET', '/api/insights/locations', { cookie: u.emp.cookie })).status, 403);
  // ضبط موقع المركز: إحداثيات مرفوضة وصالحة
  assert.equal((await call(env, 'PATCH', '/api/centers/1', { cookie: u.hr.cookie, body: { lat: 200, lng: 0 } })).status, 400);
  assert.equal((await call(env, 'PATCH', '/api/centers/1', { cookie: u.hr.cookie, body: { lat: 31.4, lng: 34.3, radiusM: 150 } })).status, 200);
});

test('المتطوعون بالمسح: البطاقة تُملأ من المسح تلقائياً، والتصحيح اليدوي يُحمى من الطمس', async () => {
  const { db, env, u } = await world();
  const { DEVICE_TOKEN, gatePost, mv } = await import('./helpers/seed.js');
  const c = await post(env, u.hr, '/api/volunteers', { name: 'متطوع تجريبي', centerId: 1 });
  assert.equal(c.status, 201);
  const vid = c.body.id;
  const card = (await call(env, 'GET', `/api/volunteers/${vid}/card`, { cookie: u.hr.cookie })).body.card;
  assert.match(card, /^PW-/);
  assert.equal((await call(env, 'GET', `/api/volunteers/${vid}/card`, { cookie: u.emp.cookie })).status, 403);
  const mvx = (type, time) => ({ ...mv('VL-001', type, '2026-11-02', time), card, lat: 31.4, lng: 34.3, acc: 10 });
  let r = await gatePost(env, [mvx('حضور', '09:00'), mvx('انصراف', '13:00')], DEVICE_TOKEN);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.saved, 2);
  const day = () => db.prepare("SELECT arrive, depart, updated_by AS by FROM volunteer_days WHERE volunteer_id = ? AND date = '2026-11-02'").bind(vid).first();
  assert.deepEqual(await day(), { arrive: '09:00', depart: '13:00', by: 'gate' });
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM daily_results').first('n')), 0, 'لا يدخل حساب الموظفين');
  // تصحيح يدوي من الموارد البشرية ثم مسح لاحق: لا يُطمَس
  await call(env, 'PUT', `/api/volunteers/${vid}/month`, { cookie: u.hr.cookie, body: { month: '2026-11', days: [{ date: '2026-11-02', arrive: '08:30', depart: '14:00' }] } });
  r = await gatePost(env, [{ ...mvx('انصراف', '15:00'), id: 'MV-late' }], DEVICE_TOKEN);
  assert.deepEqual((await day()), { arrive: '08:30', depart: '14:00', by: 'hr@nawaculture.org' });
});

test('المراكز: إضافة نقطة جديدة وإيقافها وتفعيلها وضبط موقعها', async () => {
  const { env, u } = await world();
  const c = await post(env, u.hr, '/api/centers', { name: 'نقطة تعليمية النصيرات' });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const id = c.body.center.id;
  const patch = (body) => call(env, 'PATCH', `/api/centers/${id}`, { cookie: u.hr.cookie, body });
  assert.equal((await patch({ active: false })).status, 200);
  assert.equal((await call(env, 'GET', '/api/centers', { cookie: u.hr.cookie })).body.centers.find((x) => x.id === id).active, 0);
  assert.equal((await patch({ active: true, lat: 31.45, lng: 34.38, radiusM: 150 })).status, 200);
  assert.equal((await call(env, 'PATCH', `/api/centers/${id}`, { cookie: u.emp.cookie, body: { active: false } })).status, 403);
});

test('سلامة البيانات: مركز يمسح موظفوه على بوابة مركز آخر لا يُعدّ بلا بوابة', async () => {
  const { db, env, u } = await world();
  const gate = async () => (await call(env, 'GET', '/api/insights/integrity', { cookie: u.hr.cookie })).body.checks.find((c) => c.key === 'gate').items;
  const before = await gate();
  assert.ok(before.length > 0, 'مراكز بلا جهاز تُنبَّه أصلاً');
  const target = before[0];
  const day = new Date().toISOString().slice(0, 10); // المعالج يقرأ تاريخ اليوم الحقيقي لا __NOW
  const emp = await db.prepare("SELECT id, code, name FROM employees WHERE center_id = ? AND status = 'active' LIMIT 1").bind(target.id).first();
  assert.ok(emp, 'للمركز موظف فعّال');
  await db.prepare("INSERT INTO movements (id, employee_id, card, code, name, center, type, date, time, iso, device_id) VALUES ('g1', ?, 'C1', ?, ?, 'مركز آخر', 'حضور', ?, '09:00', ?, 'DEV-01')").bind(emp.id, emp.code, emp.name, day, `${day}T09:00:00+02:00`).run();
  assert.ok(!(await gate()).some((x) => x.id === target.id), 'يختفي الإنذار بعد حركة لموظفيه');
});
