import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchExits } from '../src/engine/exit-link.js';
import { apiEnv, login, call } from './helpers/api.js';
import { setWork, addEmployee, gatePost, mv } from './helpers/seed.js';

const R = (id, from, to) => ({ id, from, to });
const OPT = { ended: true, end: '15:00' };

test('خرج ضمن السماحية وعاد ضمن أقصى مدة: تُكتب الأوقات الفعلية', () => {
  const r = matchExits([R(1, '11:00', '12:00')], ['11:08'], ['11:50'], OPT);
  assert.deepEqual(r, { links: [{ id: 1, state: 'done', out: '11:08', ret: '11:50', minutes: 42 }], unmatched: [] });
});

test('خروج بعد أكثر من 10 دقائق من وقت الطلب لا يُربط ويُرفع كخروج بلا طلب', () => {
  const r = matchExits([R(1, '11:00', '12:00')], ['11:11'], ['11:50'], OPT);
  assert.deepEqual(r.links, []);
  assert.deepEqual(r.unmatched, ['11:11']);
  assert.equal(matchExits([R(1, '11:00', '15:00')], ['11:10'], [], OPT).links[0].state, 'exit_only', '10 دقائق بالضبط تُقبل');
});

test('المدة الفعلية أطول من المعتمدة: over وتُترك للمعتمِد', () => {
  const r = matchExits([R(1, '11:00', '12:00')], ['11:15'], ['12:30'], { ...OPT });
  assert.deepEqual(r.links, []);
  const r2 = matchExits([R(1, '11:00', '12:00')], ['11:05'], ['12:30'], OPT);
  assert.equal(r2.links[0].state, 'over');
  assert.equal(r2.links[0].minutes, 85);
});

test('خرج ولم يعد: exit_only بعد انتهاء اليوم (حتى نهاية الدوام)، وopen قبله', () => {
  const a = matchExits([R(1, '11:00', '15:00')], ['11:00'], [], OPT).links[0];
  assert.deepEqual(a, { id: 1, state: 'exit_only', out: '11:00', ret: null, minutes: 240 });
  assert.equal(matchExits([R(1, '11:00', '12:00')], ['11:00'], [], OPT).links[0].state, 'over', 'غاب أكثر مما اعتُمد');
  const o = matchExits([R(1, '11:00', '14:00')], ['11:00'], [], { ended: false, end: '15:00' }).links[0];
  assert.equal(o.state, 'open');
});

test('مغادرتان في يوم واحد تُطابقان طلبيهما، والعودة تتبع خروجها', () => {
  const r = matchExits([R(1, '10:00', '10:30'), R(2, '13:00', '13:45')], ['13:02', '10:01'], ['10:20', '13:30'], OPT);
  assert.deepEqual(r.links.map((l) => [l.id, l.state, l.out, l.ret, l.minutes]), [[1, 'done', '10:01', '10:20', 19], [2, 'done', '13:02', '13:30', 28]]);
});

test('تكامل: مسح الخروج والعودة يكتبان الأوقات الفعلية في الطلب ويبقى المطلوب في original', async () => {
  const { db, env } = await apiEnv();
  env.TIMEZONE = 'UTC';
  env.__NOW = '2026-11-10T12:00:00Z';
  await setWork(db, { start: '08:30', end: '15:00', toleranceMinutes: 10, weekdays: ['عمل', 'عمل', 'عمل', 'عمل', 'عمل', 'عطلة أسبوعية', 'عطلة أسبوعية'], leaveTypes: { 'إجازة سنوية': true } });
  await addEmployee(db, { id: 1, code: 'NW-001' });
  await db.prepare("INSERT INTO requests (id, employee_id, kind, purpose, reason, from_date, to_date, from_time, to_time, minutes, status, request_date, created_by) VALUES (7, 1, 'exit', 'other', 'x', '2026-11-02', '2026-11-02', '11:00', '12:00', 60, 'approved', '2026-11-02', 'x')").run();
  await gatePost(env, [mv('NW-001', 'حضور', '2026-11-02', '08:30'), mv('NW-001', 'خروج', '2026-11-02', '11:07')]);
  await gatePost(env, [mv('NW-001', 'عودة', '2026-11-02', '11:50')]);
  const r = await db.prepare('SELECT from_time, to_time, minutes, act_state, act_out, act_ret, original FROM requests WHERE id = 7').first();
  assert.equal(r.act_state, 'done');
  assert.deepEqual([r.from_time, r.to_time, r.minutes], ['11:07', '11:50', 43]);
  assert.deepEqual(JSON.parse(r.original), { fromDate: '2026-11-02', toDate: '2026-11-02', fromTime: '11:00', toTime: '12:00', minutes: 60 });
});

test('مغادرة أطول من المعتمدة: تظهر في المراجعة ولا يُعدَّل الطلب حتى يقبل المعتمِد الفعلي', async () => {
  const { db, env } = await apiEnv();
  env.TIMEZONE = 'UTC';
  env.__NOW = '2026-11-10T12:00:00Z';
  await setWork(db, { start: '08:30', end: '15:00', toleranceMinutes: 10, weekdays: ['عمل', 'عمل', 'عمل', 'عمل', 'عمل', 'عطلة أسبوعية', 'عطلة أسبوعية'], leaveTypes: { 'إجازة سنوية': true } });
  await addEmployee(db, { id: 1, code: 'NW-001' });
  await db.prepare("INSERT INTO requests (id, employee_id, kind, purpose, reason, from_date, to_date, from_time, to_time, minutes, status, request_date, created_by) VALUES (7, 1, 'exit', 'other', 'x', '2026-11-02', '2026-11-02', '11:00', '12:00', 60, 'approved', '2026-11-02', 'x')").run();
  await gatePost(env, [mv('NW-001', 'حضور', '2026-11-02', '08:30'), mv('NW-001', 'خروج', '2026-11-02', '11:05'), mv('NW-001', 'عودة', '2026-11-02', '12:30'), mv('NW-001', 'انصراف', '2026-11-02', '15:00'),
    mv('NW-001', 'خروج', '2026-11-03', '10:00')]);
  let r = await db.prepare('SELECT from_time, to_time, minutes, act_state FROM requests WHERE id = 7').first();
  assert.deepEqual(r, { from_time: '11:00', to_time: '12:00', minutes: 60, act_state: 'over' });
  const hr = await login(db, 'hr@nawaculture.org', 'hr', null);
  const ig = await call(env, 'GET', '/api/insights/integrity', { cookie: hr.cookie });
  const chk = ig.body.checks.find((c) => c.key === 'exitlink');
  assert.equal(chk.items.length, 2, JSON.stringify(chk.items));
  assert.match(chk.items.map((i) => i.detail).join('|'), /إذن #7 اعتُمد 11:00–12:00، والفعلي خرج 11:05 وعاد 12:30/);
  assert.match(chk.items.map((i) => i.detail).join('|'), /خروج 10:00 بلا إذن/);
  const acc = await call(env, 'POST', '/api/requests/7/accept-actual', { cookie: hr.cookie, body: {} });
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  r = await db.prepare('SELECT from_time, to_time, minutes, act_state FROM requests WHERE id = 7').first();
  assert.deepEqual(r, { from_time: '11:05', to_time: '12:30', minutes: 85, act_state: 'manual' });
  assert.equal((await call(env, 'POST', '/api/requests/7/accept-actual', { cookie: hr.cookie, body: {} })).status, 409, 'لا فرق معلّق بعد القبول');
});
