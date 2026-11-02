// «مهمة عمل»: طلب بأيام كاملة لموظف خارجي أو صاحب زيارة ميدانية. لا يُحسب غياباً ولا إجازة، ولا يخصم رصيداً،
// ولا يُلغيه الدخول على البوابة، ونوعه محتسب كدوام فتصل ساعاته إلى الممولين.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';
import { setWork, gatePost, mv } from './helpers/seed.js';
import { MIGRATIONS_DIR } from './helpers/d1.js';
import { validateRequest, mergeRules, suggestLeaveType, kindLabel } from '../src/engine/requests.js';

// «اليوم»: الجمعة 2026-11-06؛ أيام العمل الأحد..الخميس.
const NOW = '2026-11-06T07:00:00Z';
const SETTINGS = {
  start: '08:30', end: '15:00', toleranceMinutes: 10,
  weekdays: ['عمل', 'عمل', 'عمل', 'عمل', 'عمل', 'عطلة أسبوعية', 'عطلة أسبوعية'],
  leaveTypes: { 'إجازة سنوية': true, 'إجازة مرضية': true, 'مهمة عمل': true },
};

async function world(settings = SETTINGS) {
  const { db, env } = await apiEnv();
  env.__NOW = NOW;
  const sent = [];
  env.__MAILER = { kind: 'test', send: async (m) => { sent.push(m); } };
  await setWork(db, settings);
  await seedOrg(db);
  const u = {
    emp2: await login(db, 'emp2@nawaculture.org', 'employee', 2),
    mgr: await login(db, 'mgr@nawaculture.org', 'manager', 1),
    hr: await login(db, 'hr@nawaculture.org', 'hr', 4),
  };
  return { db, env, u, sent };
}
const post = (env, who, path, body) => call(env, 'POST', path, { cookie: who.cookie, body });
const get = (env, who, path) => call(env, 'GET', path, { cookie: who.cookie });
const mission = (extra = {}) => ({ kind: 'leave', mission: true, reason: 'زيارة ميدانية — مدرسة الشاطئ', fromDate: '2026-11-02', toDate: '2026-11-03', ...extra });
const dayRow = (db, e, d) => db.prepare('SELECT status, check_in AS ci, approved_hours AS ah, required_hours AS rh FROM daily_results WHERE employee_id = ? AND date = ?').bind(e, d).first();

// ------------------------------------------------------------------ المحرك
const CTX = { today: '2026-11-06', nowTime: '10:00', rules: mergeRules(null), settings: SETTINGS, holidays: new Set(), enforceTiming: true };

test('محرك: المهمة طلب إجازة بغرض «أخرى: مهمة عمل» وأيام عملها فقط', () => {
  const r = validateRequest(mission({ fromDate: '2026-11-08', toDate: '2026-11-12' }), CTX);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.value.mission, true);
  assert.equal(r.value.purpose, 'other');
  assert.equal(r.value.purposeOther, 'مهمة عمل');
  assert.equal(r.value.days, 5);
  assert.equal(kindLabel({ kind: 'leave', mission: true }), 'طلب مهمة عمل');
  assert.equal(kindLabel({ kind: 'leave' }), 'طلب إجازة');
});

test('محرك: المهمة تُقدَّم بلا مهلة مسبقة (اليوم ومستقبلاً) وتُرفض بعد المهلة الخلفية', () => {
  assert.equal(validateRequest(mission({ fromDate: '2026-11-06', toDate: '2026-11-06' }), { ...CTX, today: '2026-11-08' }).ok, false, 'يوم الجمعة عطلة');
  assert.equal(validateRequest(mission({ fromDate: '2026-11-08', toDate: '2026-11-08' }), { ...CTX, today: '2026-11-08' }).ok, true, 'اليوم نفسه');
  const old = validateRequest(mission({ fromDate: '2026-10-25', toDate: '2026-10-26' }), CTX);
  assert.equal(old.ok, false);
  assert.match(old.error, /مهلة تقديم المهمة/);
  assert.equal(validateRequest(mission({ fromDate: '2026-10-25', toDate: '2026-10-26' }), { ...CTX, enforceTiming: false }).ok, true, 'إدخال المسؤول بلا قيد توقيت');
});

test('محرك: الغرض إلزامي، والأذونات ليست مهمة، وأيام العطلة وحدها مرفوضة', () => {
  assert.match(validateRequest(mission({ reason: '' }), CTX).error, /مكان المهمة/);
  assert.match(validateRequest({ ...mission(), kind: 'exit', fromTime: '09:00', toTime: '10:00' }, CTX).error, /أيام كاملة/);
  assert.match(validateRequest(mission({ fromDate: '2026-11-06', toDate: '2026-11-07' }), CTX).error, /عطلة/);
  // مهما أُرسل من غرض يبقى «أخرى: مهمة عمل»
  assert.equal(validateRequest(mission({ purpose: 'sick', purposeOther: 'x' }), CTX).value.purposeOther, 'مهمة عمل');
});

test('محرك: النوع المقترح للمهمة يحتوي «مهمة»، وقاعدة المهلة قابلة للضبط', () => {
  assert.equal(suggestLeaveType('other', { 'إجازة سنوية': true, 'مهمة عمل': true }, true), 'مهمة عمل');
  assert.equal(suggestLeaveType('other', { 'إجازة سنوية': true, 'مهمة عمل': true }, false), null);
  assert.equal(mergeRules({ mission: { maxBackdateDays: 3 } }).mission.maxBackdateDays, 3);
  assert.equal(mergeRules({ mission: { maxBackdateDays: -5 } }).mission.maxBackdateDays, 7, 'قيمة غير صالحة تُهمل');
});

// ------------------------------------------------------------------ المسار الكامل
test('موظف يقدّم مهمة، والمدير يعتمدها: يومان يُحسبان عملاً بساعات كاملة لا غياباً', async () => {
  const { db, env, u, sent } = await world();
  const c = await post(env, u.emp2, '/api/requests', mission());
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const id = c.body.id;
  assert.match(sent.at(-1).subject, /طلب مهمة عمل جديد/);
  assert.match(sent.at(-1).text, /طلب مهمة عمل/);

  const d0 = (await get(env, u.emp2, `/api/requests/${id}`)).body;
  assert.equal(d0.request.mission, true);
  assert.equal(d0.request.purposeOther, 'مهمة عمل');
  assert.equal(d0.suggestedLeaveType, 'مهمة عمل');
  assert.equal(d0.calc.mission, true);

  const a = await post(env, u.mgr, `/api/requests/${id}/approve`, {});
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.match(sent.at(-1).subject, /اعتُمد طلب مهمة عمل/);

  for (const d of ['2026-11-02', '2026-11-03']) {
    const r = await dayRow(db, 2, d);
    assert.equal(r.status, 'مهمة عمل', d);
    assert.equal(r.ah, r.rh, 'ساعات كاملة محتسبة');
    assert.ok(r.rh > 0);
    assert.notEqual(r.status, 'غياب');
  }
  const row = await db.prepare('SELECT leave_type AS t, days, mission FROM requests WHERE id = ?').bind(id).first();
  assert.deepEqual({ ...row }, { t: 'مهمة عمل', days: 2, mission: 1 });
});

test('لا خصم من أي رصيد، ولا يظهر في المستهلك، والاحتساب بلا رصيد', async () => {
  const { env, u } = await world();
  await call(env, 'PUT', '/api/balances', { cookie: u.hr.cookie, body: { year: 2026, employeeIds: [2], items: { annual: 10, other: 5 } } });
  const id = (await post(env, u.emp2, '/api/requests', mission())).body.id;
  assert.equal((await post(env, u.mgr, `/api/requests/${id}/approve`, {})).status, 200);
  const b = (await get(env, u.hr, '/api/balances?year=2026')).body.employees.find((e) => e.id === 2).balances;
  assert.deepEqual([b.annual.used, b.other.used, b.other.pending], [0, 0, 0]);
  const meta = (await get(env, u.emp2, '/api/requests/meta')).body;
  assert.equal(meta.missionReady, true);
  const other = meta.balance.items.find((x) => x.purpose === 'other');
  assert.equal(other.used, 0);
  // إجازة «أخرى» حقيقية في الفترة نفسها تُحتسب كالمعتاد (المهمة لا تلوّثها)
  const leave = await post(env, u.hr, '/api/requests', { kind: 'leave', purpose: 'other', purposeOther: 'ظرف', reason: 'ظرف', fromDate: '2026-11-04', toDate: '2026-11-04', employeeId: 2, approve: true, leaveType: 'إجازة سنوية' });
  assert.equal(leave.status, 201, JSON.stringify(leave.body));
  const b2 = (await get(env, u.hr, '/api/balances?year=2026')).body.employees.find((e) => e.id === 2).balances;
  assert.equal(b2.other.used, 1);
});

test('الدخول على البوابة في يوم مهمة لا يُلغيها: يبقى يوم مهمة بساعات كاملة', async () => {
  const { db, env, u } = await world();
  const id = (await post(env, u.emp2, '/api/requests', mission())).body.id;
  await post(env, u.mgr, `/api/requests/${id}/approve`, {});
  const g = await gatePost(env, [mv('NW-002', 'حضور', '2026-11-02', '08:30')]);
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.ok(!g.body.releasedLeaveDays, 'لا إفراج عن أيام المهمة');
  const n = (await db.prepare('SELECT COUNT(*) AS n FROM day_overrides WHERE request_id = ? AND leave_type IS NOT NULL').bind(id).first()).n;
  assert.equal(n, 2);
  assert.equal((await db.prepare('SELECT status FROM requests WHERE id = ?').bind(id).first()).status, 'approved');
  assert.equal((await dayRow(db, 2, '2026-11-02')).status, 'مهمة عمل');
  assert.equal((await dayRow(db, 2, '2026-11-02')).ci, '08:30', 'حركة الدخول محفوظة');
});

test('المعتمِد لا يستطيع تسجيل المهمة بنوع غير محتسب، ولا بغياب نوعها من الإعدادات', async () => {
  const w1 = await world({ ...SETTINGS, leaveTypes: { 'إجازة سنوية': true, 'مهمة عمل': false } });
  const id1 = (await post(w1.env, w1.u.emp2, '/api/requests', mission())).body.id;
  const a1 = await post(w1.env, w1.u.mgr, `/api/requests/${id1}/approve`, {});
  assert.equal(a1.status, 400);
  assert.match(a1.body.error, /محتسباً كدوام/);
  assert.equal((await get(w1.env, w1.u.emp2, '/api/requests/meta')).body.missionReady, false);

  const w2 = await world({ ...SETTINGS, leaveTypes: { 'إجازة سنوية': true } });
  const id2 = (await post(w2.env, w2.u.emp2, '/api/requests', mission())).body.id;
  const a2 = await post(w2.env, w2.u.mgr, `/api/requests/${id2}/approve`, {});
  assert.equal(a2.status, 400);
  assert.match(a2.body.error, /مهمة عمل/);
  // الشرط الوحيد على النوع أن يكون محتسباً كدوام؛ اختيار المعتمِد الصريح لنوع محتسب آخر مقبول
  const a3 = await post(w2.env, w2.u.mgr, `/api/requests/${id2}/approve`, { leaveType: 'إجازة سنوية' });
  assert.equal(a3.status, 200, JSON.stringify(a3.body));
});

test('إلغاء المهمة المعتمدة يعيد الأيام غياباً كما كانت، ويُشعَر الموظف', async () => {
  const { db, env, u, sent } = await world();
  const id = (await post(env, u.emp2, '/api/requests', mission())).body.id;
  await post(env, u.mgr, `/api/requests/${id}/approve`, {});
  const c = await post(env, u.hr, `/api/requests/${id}/cancel`, { note: 'لم تتم' });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal((await dayRow(db, 2, '2026-11-02')).status, 'غياب');
  assert.match(sent.at(-1).subject, /أُلغي طلب مهمة عمل/);
});

test('الإدخال المباشر من الموارد البشرية (منح) يعمل ويختار النوع تلقائياً', async () => {
  const { db, env, u } = await world();
  const r = await post(env, u.hr, '/api/requests', mission({ employeeId: 2, approve: true, fromDate: '2026-10-26', toDate: '2026-10-28' }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await dayRow(db, 2, '2026-10-26')).status, 'مهمة عمل');
});

test('تقديم موظف لنفسه بعد المهلة مرفوض، ولا يمكن تقديم مهمة بإذن مغادرة', async () => {
  const { env, u } = await world();
  const late = await post(env, u.emp2, '/api/requests', mission({ fromDate: '2026-10-20', toDate: '2026-10-21' }));
  assert.equal(late.status, 400);
  assert.match(late.body.error, /مهلة تقديم المهمة/);
  const exit = await post(env, u.emp2, '/api/requests', { kind: 'exit', mission: true, purpose: 'other', purposeOther: 'x', reason: 'x', fromDate: '2026-11-02', fromTime: '09:00', toTime: '10:00' });
  assert.equal(exit.status, 400);
});

test('الترحيل 0013 يضيف نوع «مهمة عمل» المحتسب مرة واحدة فقط ولا يضيفه إن وُجد نوع مهمة', async () => {
  const sql = readFileSync(`${MIGRATIONS_DIR}/0013_mission.sql`, 'utf8');
  const update = sql.slice(sql.indexOf('UPDATE settings'));
  const run = async (leaveTypes) => {
    const { db } = await apiEnv();
    await setWork(db, { ...SETTINGS, leaveTypes });
    await db.prepare(update).run();
    await db.prepare(update).run(); // idempotent
    return JSON.parse((await db.prepare("SELECT value FROM settings WHERE key = 'work'").first()).value).leaveTypes;
  };
  assert.deepEqual(await run({ 'إجازة سنوية': true }), { 'إجازة سنوية': true, 'مهمة عمل': true });
  assert.deepEqual(await run({ 'إجازة سنوية': true, 'مهمة ميدانية': false }), { 'إجازة سنوية': true, 'مهمة ميدانية': false });
});
