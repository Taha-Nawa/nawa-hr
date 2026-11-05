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
