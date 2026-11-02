import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';
import { setWork, addHolidays, gatePost, mv } from './helpers/seed.js';
import { validatePlan, planRuns, describeRuns, earliestPlanDate } from '../src/engine/plans.js';
import { mergeRules } from '../src/engine/requests.js';

// «اليوم»: الجمعة 2026-11-06 (09:00 بتوقيت الخليل). أيام العمل الأحد..الخميس: 11-08 أحد، 11-12 خميس، 11-13/14 عطلة، 11-15 أحد.
const NOW = '2026-11-06T07:00:00Z';
const SETTINGS = {
  start: '08:30', end: '15:00', toleranceMinutes: 10,
  weekdays: ['عمل', 'عمل', 'عمل', 'عمل', 'عمل', 'عطلة أسبوعية', 'عطلة أسبوعية'],
  leaveTypes: { 'إجازة سنوية': true, 'إجازة مرضية': true, 'إجازة رسمية / طارئة': true },
};
const RULES = mergeRules(null);
const HOL = new Set();

async function world() {
  const { db, env } = await apiEnv();
  env.__NOW = NOW;
  const sent = [];
  env.__MAILER = { kind: 'test', send: async (m) => { sent.push(m); } };
  await setWork(db, SETTINGS);
  await seedOrg(db);
  const u = {
    emp2: await login(db, 'emp2@nawaculture.org', 'employee', 2),
    emp3: await login(db, 'emp3@nawaculture.org', 'employee', 3),
    mgr: await login(db, 'mgr@nawaculture.org', 'manager', 1),
    hr: await login(db, 'hr@nawaculture.org', 'hr', 4),
    admin: await login(db, 'adm@nawaculture.org', 'admin', null),
    dir: await login(db, 'dir@nawaculture.org', 'director', null),
  };
  return { db, env, u, sent };
}
const post = (env, who, path, body = {}) => call(env, 'POST', path, { cookie: who.cookie, body });
const put = (env, who, path, body) => call(env, 'PUT', path, { cookie: who.cookie, body });
const get = (env, who, path) => call(env, 'GET', path, { cookie: who.cookie });
const mkPlan = async (env, who, dates, extra = {}) => {
  const r = await post(env, who, '/api/plans', { purpose: 'annual', note: 'سفر عائلي', dates, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id;
};
const setBalance = (env, hr, employeeId, days) => call(env, 'PUT', '/api/balances', { cookie: hr.cookie, body: { year: 2026, employeeIds: [employeeId], items: { annual: days } } });
const workDays = (from, n) => {
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); out.length < n; d = new Date(d.getTime() + 86400000)) {
    if (![5, 6].includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
  }
  return out;
};
const planDays = async (db, id) => (await db.prepare('SELECT date, status, request_id AS rid FROM leave_plan_days WHERE plan_id = ? ORDER BY date').bind(id).all()).results;
const planRow = (db, id) => db.prepare('SELECT status, decided_by AS by, decision_note AS note, submitted_at AS sub FROM leave_plans WHERE id = ?').bind(id).first();
const reqs = async (db, employeeId) => (await db.prepare("SELECT id, from_date AS f, to_date AS t, days, status, purpose, leave_type AS lt, decision_note AS note FROM requests WHERE employee_id = ? ORDER BY from_date").bind(employeeId).all()).results;

// ---------------------------------------------------------------- المحرك (دوال نقية)
test('planRuns: الأيام تتصل عبر العطلة الأسبوعية لا عبر يوم عمل ناقص', () => {
  const runs = planRuns(['2026-11-12', '2026-11-15', '2026-11-16', '2026-11-18'], SETTINGS, HOL);
  assert.deepEqual(runs.map((r) => [r.from, r.to, r.dates.length]), [['2026-11-12', '2026-11-16', 3], ['2026-11-18', '2026-11-18', 1]]);
  assert.equal(describeRuns(runs), '2026-11-12 → 2026-11-16 (3 أيام)، 2026-11-18');
  // عطلة رسمية في الوسط لا تقطع الفترة
  const withHol = planRuns(['2026-11-09', '2026-11-11'], SETTINGS, new Set(['2026-11-10']));
  assert.equal(withHol.length, 1);
  assert.equal(withHol[0].dates.length, 2);
  assert.deepEqual(planRuns([], SETTINGS), []);
});

test('validatePlan: مهلة الاعتيادية، الأيام غير العاملة، الغرض «أخرى»، الحدود', () => {
  const ctx = { today: '2026-11-08', rules: RULES, settings: SETTINGS, holidays: HOL };
  assert.equal(earliestPlanDate('annual', '2026-11-08', RULES), '2026-11-09');
  assert.equal(earliestPlanDate('other', '2026-11-08', RULES), '2026-11-08');
  const ok = validatePlan({ purpose: 'annual', dates: ['2026-11-09', '2026-11-09', '2026-11-10'] }, ctx);
  assert.deepEqual(ok.value.dates, ['2026-11-09', '2026-11-10'], 'التكرار يُزال والترتيب تصاعدي');
  assert.match(validatePlan({ purpose: 'annual', dates: ['2026-11-08'] }, ctx).error, /فات موعد تخطيطه/);
  assert.equal(validatePlan({ purpose: 'other', note: 'ظرف خاص', dates: ['2026-11-08'] }, ctx).ok, true, 'غير الاعتيادية من اليوم');
  assert.match(validatePlan({ purpose: 'other', dates: ['2026-11-09'] }, ctx).error, /اكتب سبب/);
  assert.match(validatePlan({ purpose: 'annual', dates: ['2026-11-13'] }, ctx).error, /ليس يوم عمل/);
  assert.match(validatePlan({ purpose: 'annual', dates: ['2026-11-10'] }, { ...ctx, holidays: new Set(['2026-11-10']) }).error, /ليس يوم عمل/);
  assert.match(validatePlan({ purpose: 'annual', dates: ['2028-01-02'] }, ctx).error, /أبعد من المسموح/);
  assert.match(validatePlan({ purpose: 'annual', dates: [] }, ctx).error, /يوماً واحداً/);
  assert.match(validatePlan({ purpose: 'sick', dates: ['2026-11-09'] }, ctx).error, /اعتيادي أو أخرى/);
  assert.match(validatePlan({ purpose: 'annual', dates: ['2026-11-09'] }, { ...ctx, settings: null }).error, /إعدادات الدوام/);
  assert.match(validatePlan({ purpose: 'annual', dates: workDays('2026-11-09', 63) }, ctx).error, /62/);
  assert.equal(validatePlan({ purpose: 'annual', dates: workDays('2026-11-09', 62) }, ctx).ok, true);
  assert.match(validatePlan({ purpose: 'annual', dates: ['2026-02-30'] }, ctx).error, /تاريخ غير صالح/);
});

// ---------------------------------------------------------------- دورة الحياة الكاملة
test('مسودة ثم إرسال ثم قرار يوماً يوماً: المعتمد يصير طلبات إجازة فعلية، والمرفوض يبقى مرفوضاً بسببه', async () => {
  const { db, env, u, sent } = await world();
  assert.equal((await setBalance(env, u.hr, 2, 10)).status, 200);
  const id = await mkPlan(env, u.emp2, ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-12', '2026-11-15']);
  assert.equal((await planRow(db, id)).status, 'draft');
  assert.equal(sent.length, 0, 'المسودة لا تُشعِر أحداً');

  // المسودة لصاحبها وحده: لا يراها مديره ولا تظهر في تقويم الفريق
  assert.equal((await get(env, u.mgr, `/api/plans/${id}`)).status, 403);
  assert.equal((await get(env, u.emp3, `/api/plans/${id}`)).status, 403);
  const team0 = (await get(env, u.mgr, '/api/plans/calendar?from=2026-11-01&to=2026-11-30&scope=team')).body;
  assert.deepEqual(team0.employees.find((e) => e.id === 2).days, {});
  const mine0 = (await get(env, u.emp2, '/api/plans/calendar?from=2026-11-01&to=2026-11-30&scope=mine')).body;
  assert.equal(mine0.employees.length, 1);
  assert.equal(mine0.employees[0].days['2026-11-08'].s, 'draft');
  assert.deepEqual(mine0.balance[0].items.find((b) => b.purpose === 'annual').remaining, 10);

  // الإرسال: يصل المدير إشعار، وتظهر في صندوقه
  assert.equal((await post(env, u.mgr, `/api/plans/${id}/decide`, { all: 'approved' })).status, 403, 'لا قرار على مسودة');
  const sub = await post(env, u.emp2, `/api/plans/${id}/submit`);
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  assert.deepEqual(sent.map((m) => m.to), ['mgr@nawaculture.org']);
  assert.match(sent[0].subject, /خطة إجازات متوقعة من موظف أ/);
  assert.match(sent[0].text, /2026-11-08 → 2026-11-10 \(3 أيام\)/);
  assert.match(sent[0].text, new RegExp(`#/plans\\?open=${id}`));
  assert.equal((await get(env, u.mgr, '/api/plans/meta')).body.pending, 1);
  const inbox = (await get(env, u.mgr, '/api/plans?scope=inbox')).body.plans;
  assert.deepEqual(inbox.map((p) => [p.id, p.employeeName, p.dayCount, p.plannedCount, p.firstDate, p.lastDate]), [[id, 'موظف أ', 5, 5, '2026-11-08', '2026-11-15']]);
  assert.equal((await get(env, u.emp3, '/api/plans?scope=inbox')).body.plans.length, 0, 'الموظف العادي لا صندوق له');
  assert.equal((await get(env, u.emp2, `/api/plans/${id}`)).body.plan.can.decide, false, 'لا أحد يقرّر خطته');

  // المدير يرى الأيام ورصيد موظفه والمخطَّط ويعرف من غاب من فريقه
  await mkPlan(env, u.emp3, ['2026-11-09'], { submit: true });
  const det = (await get(env, u.mgr, `/api/plans/${id}`)).body;
  assert.equal(det.plan.can.decide, true);
  assert.deepEqual(det.balance[0].items.find((b) => b.purpose === 'annual'), { purpose: 'annual', total: 10, source: 'personal', used: 0, pending: 0, remaining: 10 });
  assert.equal(det.balance[0].planned, 5);
  assert.deepEqual(det.teamOff, { '2026-11-09': 1 });
  assert.equal(det.suggestedLeaveType, 'إجازة سنوية');

  // قرار ناقص أو بلا سبب رفض لا يمرّ
  assert.match((await post(env, u.mgr, `/api/plans/${id}/decide`, { decisions: { '2026-11-08': 'approved' } })).body.error, /حدّد قرارك ليوم 2026-11-09/);
  const all = { '2026-11-08': 'approved', '2026-11-09': 'approved', '2026-11-10': 'approved', '2026-11-12': 'rejected', '2026-11-15': 'approved' };
  assert.match((await post(env, u.mgr, `/api/plans/${id}/decide`, { decisions: all })).body.error, /سبب الرفض/);
  assert.match((await post(env, u.mgr, `/api/plans/${id}/decide`, { decisions: { ...all, '2026-12-01': 'approved' }, note: 'x' })).body.error, /ليس في هذه الخطة/);
  assert.equal((await planRow(db, id)).status, 'submitted');

  sent.length = 0;
  const d = await post(env, u.mgr, `/api/plans/${id}/decide`, { decisions: all, note: 'الخميس مزدحم' });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.deepEqual([d.body.approved, d.body.rejected, d.body.requests], [4, 1, 2]);
  assert.ok(env.DB.queries <= 30, `استعلامات القرار: ${env.DB.queries}`);

  // طلبان معتمدان: الأحد→الثلاثاء (3 أيام) والأحد التالي (يوم)، والخميس المرفوض فاصل بينهما
  const rq = await reqs(db, 2);
  assert.deepEqual(rq.map((r) => [r.f, r.t, r.days, r.status, r.purpose, r.lt]), [
    ['2026-11-08', '2026-11-10', 3, 'approved', 'annual', 'إجازة سنوية'],
    ['2026-11-15', '2026-11-15', 1, 'approved', 'annual', 'إجازة سنوية'],
  ]);
  assert.match(rq[0].note, new RegExp(`من الإجازات المتوقعة #${id}`));
  const ov = (await db.prepare('SELECT date, request_id AS rid, leave_type AS lt FROM day_overrides WHERE employee_id = 2 ORDER BY date').all()).results;
  assert.deepEqual(ov.map((o) => [o.date, o.rid, o.lt]), [
    ['2026-11-08', rq[0].id, 'إجازة سنوية'], ['2026-11-09', rq[0].id, 'إجازة سنوية'], ['2026-11-10', rq[0].id, 'إجازة سنوية'], ['2026-11-15', rq[1].id, 'إجازة سنوية'],
  ]);
  assert.deepEqual(await planDays(db, id), [
    { date: '2026-11-08', status: 'approved', rid: rq[0].id }, { date: '2026-11-09', status: 'approved', rid: rq[0].id }, { date: '2026-11-10', status: 'approved', rid: rq[0].id },
    { date: '2026-11-12', status: 'rejected', rid: null }, { date: '2026-11-15', status: 'approved', rid: rq[1].id },
  ]);
  assert.deepEqual(await planRow(db, id), { status: 'approved', by: 'mgr@nawaculture.org', note: 'الخميس مزدحم', sub: (await planRow(db, id)).sub });

  // يخصم من الرصيد كأي إجازة معتمدة، ويظهر في التقويم أخضر والمرفوض أحمر
  const bal = (await get(env, u.hr, '/api/balances?year=2026')).body.employees.find((e) => e.id === 2).balances.annual;
  assert.deepEqual([bal.total, bal.used, bal.remaining], [10, 4, 6]);
  const cal = (await get(env, u.emp2, '/api/plans/calendar?from=2026-11-01&to=2026-11-30&scope=mine')).body.employees[0].days;
  assert.deepEqual([cal['2026-11-08'].s, cal['2026-11-08'].r, cal['2026-11-12'].s, cal['2026-11-15'].s], ['approved', rq[0].id, 'rejected', 'approved']);

  // إشعار الموظف بالقرار
  assert.deepEqual(sent.map((m) => m.to), ['emp2@nawaculture.org']);
  assert.match(sent[0].subject, /قرار مسؤولك/);
  assert.match(sent[0].text, /الأيام المعتمدة: 2026-11-08 → 2026-11-10 \(3 أيام\)، 2026-11-15/);
  assert.match(sent[0].text, /الأيام المرفوضة: 2026-11-12/);
  assert.match(sent[0].text, /الخميس مزدحم/);

  // لا قرار ثانٍ
  assert.equal((await post(env, u.mgr, `/api/plans/${id}/decide`, { all: 'approved' })).status, 409);
  const log = await db.prepare("SELECT detail FROM audit_log WHERE action = 'plan.decide'").first();
  assert.match(log.detail, /"approved":4/);
});

test('الخميس ثم الأحد يتصلان في طلب واحد، والرفض الكامل لا ينتج طلبات ويحرّر الأيام لتخطيط جديد', async () => {
  const { db, env, u, sent } = await world();
  const a = await mkPlan(env, u.emp2, ['2026-11-12', '2026-11-15'], { submit: true });
  assert.equal((await post(env, u.hr, `/api/plans/${a}/decide`, { all: 'approved', note: 'موافق' })).body.requests, 1);
  assert.deepEqual((await reqs(db, 2)).map((r) => [r.f, r.t, r.days]), [['2026-11-12', '2026-11-15', 2]]);

  const b = await mkPlan(env, u.emp2, ['2026-11-22', '2026-11-23'], { submit: true });
  sent.length = 0;
  assert.match((await post(env, u.mgr, `/api/plans/${b}/decide`, { all: 'rejected' })).body.error, /سبب الرفض/);
  const r = await post(env, u.mgr, `/api/plans/${b}/decide`, { all: 'rejected', note: 'ضغط عمل في الأسبوع' });
  assert.deepEqual([r.status, r.body.approved, r.body.rejected, r.body.requests], [200, 0, 2, 0]);
  assert.equal((await planRow(db, b)).status, 'rejected');
  assert.equal((await reqs(db, 2)).length, 1);
  assert.match(sent[0].subject, /رُفضت إجازاتك المتوقعة/);
  assert.match(sent[0].text, /ضغط عمل في الأسبوع/);
  // الأيام المرفوضة تُخطَّط من جديد
  await mkPlan(env, u.emp2, ['2026-11-22']);
});

// ---------------------------------------------------------------- التحقق والتعارض
test('الحفظ يرفض العطلة والماضي والتكرار مع خطة أو إجازة أو طلب قائم', async () => {
  const { db, env, u } = await world();
  await addHolidays(db, ['2026-11-10']);
  const bad = async (body, re, status = 400) => {
    const r = await post(env, u.emp2, '/api/plans', { purpose: 'annual', note: 'x', ...body });
    assert.equal(r.status, status, JSON.stringify(r.body));
    assert.match(r.body.error, re);
  };
  await bad({ dates: ['2026-11-13'] }, /ليس يوم عمل/);
  await bad({ dates: ['2026-11-10'] }, /ليس يوم عمل/);
  await bad({ dates: ['2026-11-05'] }, /فات موعد|مضى/);
  await bad({ dates: [] }, /يوماً واحداً/);
  await bad({ dates: 'x' }, /يوماً واحداً/);
  await bad({ purpose: 'other', note: '', dates: ['2026-11-08'] }, /اكتب سبب/);
  await bad({ dates: workDays('2026-11-08', 130) }, /الحد الأقصى/);

  const a = await mkPlan(env, u.emp2, ['2026-11-08']);
  await bad({ dates: ['2026-11-08', '2026-11-09'] }, /خطة إجازات أخرى/, 409);
  assert.equal((await post(env, u.emp2, `/api/plans/${a}/cancel`, {})).status, 200);
  await mkPlan(env, u.emp2, ['2026-11-08', '2026-11-09']); // بعد الإلغاء تتحرر

  const g = await post(env, u.hr, '/api/requests', { kind: 'leave', purpose: 'annual', reason: 'سفر', fromDate: '2026-11-22', toDate: '2026-11-23', employeeId: 2, approve: true });
  assert.equal(g.status, 201);
  await bad({ dates: ['2026-11-23'] }, /ضمن طلب إجازة قائم/, 409);
  const pend = await post(env, u.emp2, '/api/requests', { kind: 'leave', purpose: 'annual', reason: 'سفر', fromDate: '2026-11-29', toDate: '2026-11-29' });
  assert.equal(pend.status, 201, JSON.stringify(pend.body));
  await bad({ dates: ['2026-11-29'] }, /ضمن طلب إجازة قائم/, 409);
  // موظف بلا سجل مرتبط
  const adm = await post(env, u.admin, '/api/plans', { purpose: 'annual', dates: ['2026-11-08'] });
  assert.equal(adm.status, 400);
  assert.match(adm.body.error, /غير مرتبط/);
});

test('الاعتماد يرفض تعارضاً حدث بعد الإرسال (إجازة معتمدة أو عطلة أُضيفت) ويقترح الرفض', async () => {
  const { db, env, u } = await world();
  const id = await mkPlan(env, u.emp2, ['2026-11-22', '2026-11-23'], { submit: true });
  // الموارد البشرية تمنح إجازة على أحد الأيام قبل أن يقرّر المدير
  await post(env, u.hr, '/api/requests', { kind: 'leave', purpose: 'annual', reason: 'سفر', fromDate: '2026-11-23', toDate: '2026-11-23', employeeId: 2, approve: true });
  const c1 = await post(env, u.mgr, `/api/plans/${id}/decide`, { all: 'approved' });
  assert.equal(c1.status, 409);
  assert.match(c1.body.error, /2026-11-23/);
  // وإعلان عطلة على يوم آخر
  await addHolidays(db, ['2026-11-22']);
  const c2 = await post(env, u.mgr, `/api/plans/${id}/decide`, { decisions: { '2026-11-22': 'approved', '2026-11-23': 'rejected' }, note: 'سبقته إجازة' });
  assert.equal(c2.status, 409);
  assert.match(c2.body.error, /لم يعد يوم عمل/);
  // برفض اليومين يُغلق الطلب بلا تعارض
  const c3 = await post(env, u.mgr, `/api/plans/${id}/decide`, { all: 'rejected', note: 'تعارض مع إجازة قائمة وعطلة' });
  assert.equal(c3.status, 200);
  assert.equal((await planRow(db, id)).status, 'rejected');
  assert.equal((await reqs(db, 2)).length, 1, 'لم يُنشأ طلب جديد');
});

// ---------------------------------------------------------------- الصلاحيات
test('من يقرّر ومن يرى: المدير المباشر وHR فقط، ولا أحد لخطته', async () => {
  const { env, u } = await world();
  const p2 = await mkPlan(env, u.emp2, ['2026-11-08'], { submit: true });
  const p1 = await mkPlan(env, u.mgr, ['2026-11-08'], { submit: true }); // خطة المديرة نفسها
  // زميل لا يرى ولا يقرّر
  assert.equal((await get(env, u.emp3, `/api/plans/${p2}`)).status, 403);
  assert.equal((await post(env, u.emp3, `/api/plans/${p2}/decide`, { all: 'approved' })).status, 403);
  // صاحب الخطة لا يقرّر
  assert.equal((await post(env, u.emp2, `/api/plans/${p2}/decide`, { all: 'approved' })).status, 403);
  // المديرة لا تقرّر خطتها؛ الموارد البشرية تقرّر، ولا تظهر لها في صندوقها
  assert.equal((await post(env, u.mgr, `/api/plans/${p1}/decide`, { all: 'approved' })).status, 403);
  assert.deepEqual((await get(env, u.mgr, '/api/plans?scope=inbox')).body.plans.map((p) => p.id), [p2]);
  assert.deepEqual((await get(env, u.hr, '/api/plans?scope=inbox')).body.plans.map((p) => p.id), [p2, p1]);
  assert.equal((await post(env, u.hr, `/api/plans/${p1}/decide`, { all: 'approved' })).status, 200);
  // المسؤول بلا سجل موظف يقرّر، ولا شيء يمنعه
  assert.equal((await post(env, u.admin, `/api/plans/${p2}/decide`, { all: 'approved' })).status, 200);
  // المدير العام يرى الصندوق ويقرّر كالموارد البشرية
  const p4 = await mkPlan(env, u.emp3, ['2026-11-10'], { submit: true });
  assert.ok((await get(env, u.dir, '/api/plans?scope=inbox')).body.plans.some((p) => p.id === p4));
  assert.equal((await post(env, u.dir, `/api/plans/${p4}/decide`, { all: 'approved' })).status, 200);
  // السجل: الموظف يرى خطته فقط، والمدير فريقه، وHR الكل
  assert.deepEqual((await get(env, u.emp3, '/api/plans?scope=all')).body.plans.map((p) => p.id), [p4]);
  assert.deepEqual((await get(env, u.emp2, '/api/plans?scope=all')).body.plans.map((p) => p.id), [p2]);
  assert.deepEqual((await get(env, u.mgr, '/api/plans?scope=all')).body.plans.map((p) => p.id).sort((a, b) => a - b), [p2, p1, p4].sort((a, b) => a - b), 'المديرة: خطتها وخطط فريقها');
  assert.equal((await get(env, u.hr, '/api/plans?scope=all&status=approved')).body.plans.length, 3);
  // لا تعديل ولا سحب ولا إرسال لخطة غيرك
  const p3 = await mkPlan(env, u.emp3, ['2026-11-09']);
  assert.equal((await put(env, u.emp2, `/api/plans/${p3}`, { dates: ['2026-11-10'] })).status, 403);
  assert.equal((await post(env, u.emp2, `/api/plans/${p3}/submit`)).status, 403);
  assert.equal((await post(env, u.hr, `/api/plans/${p3}/cancel`, {})).status, 403, 'مسودة غيرك لا تُمسّ');
  assert.equal((await get(env, u.emp2, '/api/plans/9999')).status, 404);
});

test('التقويم: الفريق حسب النطاق، العطل، الطلب المعلّق أصفر، والمدى محدود', async () => {
  const { db, env, u } = await world();
  await addHolidays(db, ['2026-11-10']);
  await mkPlan(env, u.emp2, ['2026-11-08'], { submit: true });
  await mkPlan(env, u.emp3, ['2026-11-09']); // مسودة
  await post(env, u.emp3, '/api/requests', { kind: 'leave', purpose: 'annual', reason: 'سفر', fromDate: '2026-11-11', toDate: '2026-11-15' });
  const q = '/api/plans/calendar?from=2026-11-01&to=2026-11-30&scope=team';
  const mgr = (await get(env, u.mgr, q)).body;
  assert.deepEqual(mgr.employees.map((e) => e.id).sort(), [1, 2, 3], 'المديرة وفريقها');
  const d3 = mgr.employees.find((e) => e.id === 3).days;
  assert.deepEqual(Object.keys(d3), ['2026-11-11', '2026-11-12', '2026-11-15'], 'طلب معلّق بأيام العمل فقط، ولا مسودة');
  assert.equal(d3['2026-11-12'].s, 'planned');
  assert.ok(d3['2026-11-12'].r > 0 && d3['2026-11-12'].p === null);
  assert.equal(mgr.off['2026-11-10'], 'عطلة رسمية');
  assert.equal(mgr.off['2026-11-13'], 'عطلة أسبوعية');
  assert.equal(mgr.off['2026-11-08'], undefined);
  assert.equal((await get(env, u.hr, q)).body.employees.length, 4);
  assert.deepEqual((await get(env, u.emp2, q)).body.employees.map((e) => e.id), [2], 'الموظف العادي نفسه فقط');
  assert.equal((await get(env, u.emp2, '/api/plans/calendar?from=2026-01-01&to=2027-06-30&scope=team')).status, 400);
  assert.equal((await get(env, u.emp2, '/api/plans/calendar?from=bad&to=2026-11-30')).status, 400);
  assert.deepEqual((await get(env, u.admin, '/api/plans/calendar?from=2026-11-01&to=2026-11-30&scope=mine')).body.employees, []);
});

// ---------------------------------------------------------------- التعديل والسحب والإلغاء
test('سحب الخطة المُرسَلة يعيدها مسودة تُعدَّل وتُرسَل من جديد، والإلغاء يحرّر الأيام', async () => {
  const { db, env, u, sent } = await world();
  const id = await mkPlan(env, u.emp2, ['2026-11-08', '2026-11-09']);
  assert.equal((await put(env, u.emp2, `/api/plans/${id}`, { purpose: 'annual', note: 'تغيير', dates: ['2026-11-09', '2026-11-10'] })).status, 200);
  assert.deepEqual((await planDays(db, id)).map((d) => d.date), ['2026-11-09', '2026-11-10']);
  assert.equal((await post(env, u.emp2, `/api/plans/${id}/withdraw`)).status, 409, 'المسودة لا تُسحب');
  assert.equal((await post(env, u.emp2, `/api/plans/${id}/submit`)).status, 200);
  assert.equal((await put(env, u.emp2, `/api/plans/${id}`, { dates: ['2026-11-11'] })).status, 409, 'المُرسَلة تُسحب قبل أن تُعدَّل');
  assert.equal((await post(env, u.emp2, `/api/plans/${id}/submit`)).status, 409);

  assert.equal((await post(env, u.emp2, `/api/plans/${id}/withdraw`)).status, 200);
  assert.deepEqual(await planRow(db, id), { status: 'draft', by: null, note: null, sub: null });
  assert.equal((await get(env, u.mgr, '/api/plans/meta')).body.pending, 0);
  assert.equal((await put(env, u.emp2, `/api/plans/${id}`, { purpose: 'other', note: 'ظرف عائلي', dates: ['2026-11-11'] })).status, 200);
  assert.equal((await post(env, u.emp2, `/api/plans/${id}/submit`)).status, 200);
  assert.equal(sent.length, 2, 'إشعار عند كل إرسال');

  // الموارد البشرية قد تلغي خطة مُرسَلة، والموظف يلغي خطته
  assert.equal((await post(env, u.hr, `/api/plans/${id}/cancel`, { note: 'خطأ إدخال' })).status, 200);
  assert.deepEqual((await planDays(db, id)).map((d) => d.status), ['withdrawn']);
  assert.equal((await planRow(db, id)).status, 'cancelled');
  assert.equal((await post(env, u.emp2, `/api/plans/${id}/cancel`, {})).status, 409);
  await mkPlan(env, u.emp2, ['2026-11-11']);
  const cal = (await get(env, u.emp2, '/api/plans/calendar?from=2026-11-01&to=2026-11-30&scope=mine')).body.employees[0].days;
  assert.deepEqual(Object.keys(cal), ['2026-11-11']);
});

test('إرسال مسودة فات موعد أيامها أو تعارضت مع إجازة جديدة يُرفض بسبب واضح', async () => {
  const { env, u } = await world();
  const id = await mkPlan(env, u.emp2, ['2026-11-22']);
  await post(env, u.hr, '/api/requests', { kind: 'leave', purpose: 'annual', reason: 'سفر', fromDate: '2026-11-22', toDate: '2026-11-22', employeeId: 2, approve: true });
  const r = await post(env, u.emp2, `/api/plans/${id}/submit`);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /ضمن طلب إجازة قائم/);
  env.__NOW = '2026-11-22T07:00:00Z'; // مرّ الموعد
  const r2 = await post(env, u.emp2, `/api/plans/${id}/submit`);
  assert.equal(r2.status, 400);
  assert.match(r2.body.error, /فات موعد|مضى/);
});

// ---------------------------------------------------------------- التكامل مع الإجازات القائمة
test('إلغاء طلب الإجازة الناتج يحرّر يوم الخطة، والدخول الفعلي يلغي يومه من الإجازة ومن الخطة', async () => {
  const { db, env, u } = await world();
  await setBalance(env, u.hr, 2, 10);
  const id = await mkPlan(env, u.emp2, ['2026-11-08', '2026-11-09', '2026-11-10'], { submit: true });
  assert.equal((await post(env, u.mgr, `/api/plans/${id}/decide`, { all: 'approved' })).status, 200);
  const [r1] = await reqs(db, 2);

  // الدخول الفعلي يوم 11-09: يُلغى ذلك اليوم من الطلب ويُسحب من الخطة
  env.__NOW = '2026-11-09T06:00:00Z';
  const g = await gatePost(env, [mv('NW-002', 'حضور', '2026-11-09', '08:35')]);
  assert.equal(g.body.releasedLeaveDays, 1, JSON.stringify(g.body));
  assert.deepEqual((await planDays(db, id)).map((d) => [d.date, d.status]), [['2026-11-08', 'approved'], ['2026-11-09', 'withdrawn'], ['2026-11-10', 'approved']]);
  assert.equal((await reqs(db, 2))[0].days, 2);

  // إلغاء الاعتماد من الموارد البشرية يحرّر ما بقي ويتيح تخطيطه من جديد
  assert.equal((await post(env, u.hr, `/api/requests/${r1.id}/cancel`, { note: 'تغيّر الموعد' })).status, 200);
  assert.deepEqual((await planDays(db, id)).map((d) => d.status), ['withdrawn', 'withdrawn', 'withdrawn']);
  const again = await post(env, u.emp2, '/api/plans', { purpose: 'annual', note: 'موعد جديد', dates: ['2026-11-10'] });
  assert.equal(again.status, 201, JSON.stringify(again.body));
  const cal = (await get(env, u.emp2, '/api/plans/calendar?from=2026-11-01&to=2026-11-30&scope=mine')).body.employees[0].days;
  assert.deepEqual(Object.keys(cal), ['2026-11-10']);
  assert.equal(cal['2026-11-10'].s, 'draft');
});

// ---------------------------------------------------------------- حدود الخطة المجانية
test('خطة بأقصى عدد أيام: الحفظ والإرسال والاعتماد ضمن 50 استعلاماً حتى مع عشرات الفترات المنفصلة', async () => {
  const { db, env, u } = await world();
  const days = workDays('2026-11-08', 62);
  const c = await post(env, u.emp2, '/api/plans', { purpose: 'annual', note: 'سنوية', dates: days, submit: true });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.ok(env.DB.queries <= 25, `استعلامات الحفظ والإرسال: ${env.DB.queries}`);
  const id = c.body.id;

  const detail = await get(env, u.mgr, `/api/plans/${id}`);
  assert.equal(detail.body.days.length, 62);
  assert.ok(env.DB.queries <= 25, `استعلامات التفاصيل: ${env.DB.queries}`);

  // نعتمد يوماً ونرفض يوماً: 31 فترة منفصلة تُدرج كلها بجملة واحدة
  const decisions = Object.fromEntries(days.map((d, i) => [d, i % 2 === 0 ? 'approved' : 'rejected']));
  const d = await post(env, u.mgr, `/api/plans/${id}/decide`, { decisions, note: 'أيام بديلة' });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.deepEqual([d.body.approved, d.body.rejected, d.body.requests], [31, 31, 31]);
  assert.ok(env.DB.queries <= 35, `استعلامات الاعتماد: ${env.DB.queries}`);
  assert.equal((await reqs(db, 2)).length, 31);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM day_overrides WHERE employee_id = 2 AND request_id IS NOT NULL').first('n')), 31);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM leave_plan_days WHERE plan_id = ? AND status = 'approved' AND request_id IS NOT NULL").bind(id).first('n')), 31);

  const mine = await get(env, u.emp2, '/api/plans/calendar?from=2026-11-01&to=2027-01-31&scope=mine');
  assert.equal(mine.status, 200);
  assert.ok(env.DB.queries <= 15, `استعلامات التقويم: ${env.DB.queries}`);
});

test('الإشعارات تتوقف مع إيقاف rules.notify ولا تعطّل الحفظ إن فشل البريد', async () => {
  const { env, u, sent } = await world();
  env.__MAILER = { kind: 'test', send: async () => { throw new Error('smtp down'); } };
  const id = await mkPlan(env, u.emp2, ['2026-11-08'], { submit: true });
  assert.equal(sent.length, 0);
  assert.equal((await post(env, u.mgr, `/api/plans/${id}/decide`, { all: 'approved' })).status, 200, 'فشل البريد لا يُفشل القرار');
  env.__MAILER = { kind: 'test', send: async (m) => { sent.push(m); } };
  await call(env, 'PUT', '/api/settings/requests', { cookie: u.admin.cookie, body: { rules: { notify: { enabled: false } } } });
  await mkPlan(env, u.emp3, ['2026-11-09'], { submit: true });
  assert.equal(sent.length, 0);
});
