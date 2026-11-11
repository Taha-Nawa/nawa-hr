import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDay } from '../src/engine/attendance.js';
import { buildTimesheet } from '../src/engine/timesheet.js';
import { returnDateOf, leaveEndOf, hourEndOf, hourPosOn, leaveDates, validateMaternity } from '../src/engine/maternity.js';
import { maternityReminders } from '../src/worker/maternity.js';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';
import { setWork, golden, gatePost, mv } from './helpers/seed.js';

const S = { start: '08:30', end: '15:00', toleranceMinutes: 10, weekdays: ['عمل', 'عمل', 'عمل', 'عمل', 'عمل', 'عطلة أسبوعية', 'عطلة أسبوعية'], leaveTypes: {} };
const rec = { deliveryDate: '2026-01-10', leaveDays: 70, hourPos: 'start' };

test('حساب التواريخ: 70 يوماً تقويمياً من الولادة، والعودة بعدها، وسنة الساعة من العودة', () => {
  assert.equal(leaveEndOf(rec), '2026-03-20');
  assert.equal(returnDateOf(rec), '2026-03-21');
  assert.equal(leaveDates(rec).length, 70);
  assert.equal(hourEndOf(rec), '2027-03-20');
  assert.equal(hourPosOn('2026-03-20', [rec]), null, 'أثناء الإجازة لا ساعة');
  assert.equal(hourPosOn('2026-03-21', [rec]), 'start');
  assert.equal(hourPosOn('2027-03-20', [rec]), 'start');
  assert.equal(hourPosOn('2027-03-21', [rec]), null);
  assert.equal(hourPosOn('2026-03-21', [{ ...rec, hourPos: null }]), null);
});

test('التحقق: الأيام 1..365 وموضع الساعة بداية/نهاية', () => {
  assert.equal(validateMaternity({ deliveryDate: '2026-01-10' }).value.leaveDays, 70);
  assert.ok(validateMaternity({ deliveryDate: 'x' }).error);
  assert.ok(validateMaternity({ deliveryDate: '2026-01-10', leaveDays: 0 }).error);
  assert.ok(validateMaternity({ deliveryDate: '2026-01-10', hourPos: 'middle' }).error);
  assert.equal(validateMaternity({ deliveryDate: '2026-01-10', hourPos: 'end' }).value.hourPos, 'end');
});

test('محرك الحضور: ساعة الأمومة في البداية تؤخّر بدء الدوام ساعة (لا تأخر)، وفي النهاية تقدّم الانصراف', () => {
  const base = { date: '2026-03-02', dayType: 'عمل' };
  const s = computeDay({ ...base, matHour: 'start', movements: [{ type: 'حضور', time: '09:30' }, { type: 'انصراف', time: '15:00' }] }, S);
  assert.equal(s.lateMinutes, 0);
  assert.equal(s.status, 'حاضر');
  const late = computeDay({ ...base, matHour: 'start', movements: [{ type: 'حضور', time: '09:45' }, { type: 'انصراف', time: '15:00' }] }, S);
  assert.equal(late.lateMinutes, 15);
  const e = computeDay({ ...base, matHour: 'end', movements: [{ type: 'حضور', time: '08:30' }, { type: 'انصراف', time: '14:00' }] }, S);
  assert.equal(e.earlyLeaveMinutes, 0);
  const normal = computeDay({ ...base, movements: [{ type: 'حضور', time: '08:30' }, { type: 'انصراف', time: '14:00' }] }, S);
  assert.equal(normal.earlyLeaveMinutes, 60);
});

test('التايم شيت: أيام الإجازة والساعة في صف Others', () => {
  const days = {
    '2026-10-04': { dayType: 'عمل', approvedHours: 0, leaveType: 'إجازة وضع' },
    '2026-10-05': { dayType: 'عمل', approvedHours: 5.5, leaveType: '', matHours: 1 },
  };
  const t = buildTimesheet({ year: 2026, month: 10, days, allocations: [{ funder: 'F', share: 1, from: '2026-01-01', to: '2030-12-31' }], dayHours: 6.5 });
  assert.equal(t.others.values[3], 7.5, 'يوم إجازة الوضع كاملاً');
  assert.equal(t.others.values[4], 1, 'ساعة الأمومة');
  assert.equal(t.annual.values[3], null);
  assert.equal(t.annual.values[4], null, 'الساعة لا تُحتسب نقصاً في السنوية');
});

async function world(now = '2026-03-14T07:00:00Z') {
  const { db, env } = await apiEnv();
  env.TIMEZONE = 'UTC';
  env.__NOW = now;
  await seedOrg(db);
  await setWork(db, golden.settings);
  const u = {
    hr: await login(db, 'hr@nawaculture.org', 'hr', null),
    admin: await login(db, 'adm@nawaculture.org', 'admin', null),
    dir: await login(db, 'd@nawaculture.org', 'director', null),
    emp: await login(db, 'e@nawaculture.org', 'employee', 2),
  };
  return { db, env, u };
}
const j = (env, who, method, path, body) => call(env, method, path, { cookie: who.cookie, body });

test('واجهة الأمومة: للموظفات فقط وللموارد البشرية والمسؤول فقط', async () => {
  const { env, u } = await world();
  const add = (who) => j(env, who, 'POST', '/api/employees/2/maternity', { deliveryDate: '2026-03-02' });
  assert.equal((await add(u.hr)).status, 400, 'لم يُحدَّد الجنس');
  for (const who of [u.dir, u.emp]) {
    assert.equal((await add(who)).status, 403);
    assert.equal((await j(env, who, 'PUT', '/api/employees/2/gender', { gender: 'F' })).status, 403);
  }
  assert.equal((await j(env, u.hr, 'PUT', '/api/employees/2/gender', { gender: 'M' })).status, 200);
  assert.equal((await add(u.hr)).status, 400, 'ذكر');
  assert.equal((await j(env, u.admin, 'PUT', '/api/employees/2/gender', { gender: 'F' })).status, 200);
  assert.equal((await add(u.admin)).status, 201);
});

test('إنشاء السجل يكتب 70 يوماً إجازة ويعيد الحساب، والتعديل والحذف يعيدان الأيام', async () => {
  const { db, env, u } = await world();
  await j(env, u.hr, 'PUT', '/api/employees/2/gender', { gender: 'F' });
  const c = await j(env, u.hr, 'POST', '/api/employees/2/maternity', { deliveryDate: '2026-03-02', leaveDays: 70, note: 'x' });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const n = () => db.prepare("SELECT COUNT(*) AS n FROM day_overrides WHERE employee_id = 2 AND leave_type = 'إجازة وضع'").first('n');
  assert.equal(await n(), 70);
  const g = await j(env, u.hr, 'GET', '/api/employees/2/maternity');
  assert.equal(g.body.records[0].returnDate, '2026-05-11');
  assert.equal(g.body.records[0].leaveEnd, '2026-05-10');
  assert.equal((await j(env, u.hr, 'POST', '/api/employees/2/maternity', { deliveryDate: '2026-04-01' })).status, 400, 'تداخل');
  // اليوم 2026-03-05 (خميس) عمل: حُسب بنوع الإجازة
  assert.equal(await db.prepare("SELECT status FROM daily_results WHERE employee_id = 2 AND date = '2026-03-04'").first('status'), 'إجازة وضع');

  const id = c.body.id;
  assert.equal((await j(env, u.hr, 'PATCH', `/api/maternity/${id}`, { leaveDays: 60 })).status, 200);
  assert.equal(await n(), 60);
  assert.equal((await j(env, u.hr, 'PATCH', `/api/maternity/${id}`, { hourPos: 'end' })).status, 200);
  assert.equal(await db.prepare('SELECT hour_pos FROM maternity WHERE id = ?').bind(id).first('hour_pos'), 'end');
  assert.equal((await j(env, u.emp, 'DELETE', `/api/maternity/${id}`)).status, 403);
  assert.equal((await j(env, u.hr, 'DELETE', `/api/maternity/${id}`)).status, 200);
  assert.equal(await n(), 0);
});

test('التذكير: قبل العودة بأسبوع وفي يوم العودة لمرة واحدة لكل مستلم، ويتوقف بعد تحديد الساعة', async () => {
  const { db, env, u } = await world('2026-05-04T09:00:00Z'); // العودة 2026-05-11: قبلها بـ7 أيام
  await j(env, u.hr, 'PUT', '/api/employees/2/gender', { gender: 'F' });
  const c = await j(env, u.hr, 'POST', '/api/employees/2/maternity', { deliveryDate: '2026-03-02' });
  const sent = [];
  env.__MAILER = { send: async (m) => { sent.push(m); } };
  const hrUsers = (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role IN ('hr','admin') AND active = 1").first('n'));
  const a = await maternityReminders(env);
  assert.equal(a.sent, hrUsers);
  assert.match(sent[0].subject, /ساعة الأمومة/);
  assert.equal((await maternityReminders(env)).sent, 0, 'لا تكرار');
  env.__NOW = '2026-05-11T09:00:00Z';
  assert.equal((await maternityReminders(env)).sent, hrUsers, 'مرحلة يوم العودة');
  await j(env, u.hr, 'PATCH', `/api/maternity/${c.body.id}`, { hourPos: 'start' });
  env.__NOW = '2026-05-12T09:00:00Z';
  assert.equal((await maternityReminders(env)).sent, 0);
});

test('التذكير: بعيد عن العودة لا يُرسل شيئاً', async () => {
  const { env, u } = await world('2026-03-14T09:00:00Z');
  await j(env, u.hr, 'PUT', '/api/employees/2/gender', { gender: 'F' });
  await j(env, u.hr, 'POST', '/api/employees/2/maternity', { deliveryDate: '2026-03-02' });
  env.__MAILER = { send: async () => { throw new Error('must not send'); } };
  assert.equal((await maternityReminders(env)).sent, 0);
});
