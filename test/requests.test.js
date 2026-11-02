import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';
import { setWork, addHolidays, addOverride } from './helpers/seed.js';
import { validateRequest, mergeRules, workingDates, suggestLeaveType, DEFAULT_RULES } from '../src/engine/requests.js';
import { canManageRequests, canDecideRequest, canRevokeRequest } from '../src/worker/authz.js';

// «اليوم» في الاختبارات: الإثنين 2026-11-02 الساعة 09:00 بتوقيت الخليل (UTC+2 في نوفمبر)
const NOW = '2026-11-02T07:00:00Z';
const TODAY = '2026-11-02';

const SETTINGS = {
  start: '08:30', end: '15:00', toleranceMinutes: 10, monthlyExitCapHours: 6,
  weekdays: ['عمل', 'عمل', 'عمل', 'عمل', 'عمل', 'عطلة أسبوعية', 'عطلة أسبوعية'], // الأحد..الخميس عمل
  leaveTypes: { 'إجازة سنوية': true, 'إجازة مرضية': true, 'إجازة رسمية / طارئة': true, 'إجازة بدون راتب': false },
};

async function world() {
  const { db, env } = await apiEnv();
  env.__NOW = NOW;
  await setWork(db, SETTINGS);
  await seedOrg(db); // 1 = المديرة، 2 و3 مرؤوسان لها، 4 مستقل
  const u = {
    emp2: await login(db, 'emp2@nawaculture.org', 'employee', 2),
    emp3: await login(db, 'emp3@nawaculture.org', 'employee', 3),
    mgr: await login(db, 'mgr@nawaculture.org', 'manager', 1),
    hr: await login(db, 'hr@nawaculture.org', 'hr', 4),
    director: await login(db, 'dir@nawaculture.org', 'director', null),
    admin: await login(db, 'adm@nawaculture.org', 'admin', null),
    nolink: await login(db, 'nolink@nawaculture.org', 'employee', null),
  };
  return { db, env, u };
}

const leave = (o = {}) => ({ kind: 'leave', purpose: 'annual', reason: 'سفر', fromDate: '2026-11-08', toDate: '2026-11-10', ...o });
const permit = (kind, o = {}) => ({ kind, purpose: 'annual', reason: 'مراجعة', fromDate: '2026-11-03', fromTime: '10:00', toTime: '11:30', ...o });
const post = (env, who, path, body) => call(env, 'POST', path, { cookie: who.cookie, body });
const get = (env, who, path) => call(env, 'GET', path, { cookie: who.cookie });

// ---------------------------------------------------------------- القواعد النقيّة
const ctx = (over = {}) => ({ today: TODAY, nowTime: '09:00', rules: DEFAULT_RULES, settings: SETTINGS, holidays: new Set(), enforceTiming: true, ...over });

test('الإجازة السنوية تُقدَّم قبل موعدها بيوم على الأقل', () => {
  assert.equal(validateRequest(leave({ fromDate: TODAY, toDate: TODAY }), ctx()).ok, false, 'اليوم نفسه مرفوض');
  assert.match(validateRequest(leave({ fromDate: TODAY, toDate: TODAY }), ctx()).error, /قبل موعدها/);
  assert.equal(validateRequest(leave({ fromDate: '2026-11-03', toDate: '2026-11-03' }), ctx()).ok, true, 'الغد مقبول');
  assert.equal(validateRequest(leave({ fromDate: '2026-11-01', toDate: '2026-11-01' }), ctx()).ok, false, 'بأثر رجعي مرفوض');
  // مهلة مختلفة من لائحة لاحقة
  const rules = mergeRules({ annual: { minNoticeDays: 3 } });
  assert.equal(validateRequest(leave({ fromDate: '2026-11-04', toDate: '2026-11-04' }), ctx({ rules })).ok, false);
  assert.equal(validateRequest(leave({ fromDate: '2026-11-05', toDate: '2026-11-05' }), ctx({ rules })).ok, true);
});

test('المرضية والطارئة تُقدَّم في يوم الحالة أو بعده ضمن المهلة', () => {
  const sick = (from, to = from) => validateRequest(leave({ purpose: 'sick', reason: '', fromDate: from, toDate: to, medicalProof: true }), ctx());
  assert.equal(sick(TODAY).ok, true, 'اليوم نفسه');
  assert.equal(sick('2026-10-29', TODAY).ok, true, 'بدأت قبل أيام وتنتهي اليوم');
  assert.equal(sick('2026-10-19').ok, true, '14 يوماً');
  assert.equal(sick('2026-10-18').ok, false, '15 يوماً تتجاوز المهلة');
  assert.equal(sick('2026-11-04').ok, true, 'ممتدة لأيام قادمة');
  const emergency = (from) => validateRequest(leave({ purpose: 'emergency', reason: 'ظرف عائلي', fromDate: from, toDate: from }), ctx());
  assert.equal(emergency('2026-10-26').ok, true, '7 أيام');
  assert.equal(emergency('2026-10-25').ok, false, '8 أيام');
});

test('الأذونات: الاعتيادي قبل وقته، وغيره بعد الحالة ضمن المهلة', () => {
  const p = (o) => validateRequest(permit('exit', o), ctx());
  assert.equal(p({ fromDate: TODAY, fromTime: '10:00', toTime: '11:00' }).ok, true, 'بعد الآن بساعة');
  assert.equal(p({ fromDate: TODAY, fromTime: '08:00', toTime: '09:30' }).ok, false, 'بدأ وقته');
  assert.equal(p({ fromDate: TODAY, fromTime: '09:00', toTime: '10:00' }).ok, false, 'الآن بالضبط ليس «قبل»');
  assert.equal(p({ fromDate: '2026-11-01' }).ok, false, 'أمس اعتيادي');
  assert.equal(p({ purpose: 'sick', fromDate: '2026-11-01' }).ok, true, 'أمس مرضي');
  assert.equal(p({ purpose: 'sick', fromDate: TODAY, fromTime: '08:00', toTime: '09:30' }).ok, true, 'اليوم مرضي بعد وقوعه');
});

test('الإدخال نيابة عن موظف (بلا تقيّد بالتوقيت) يقبل التاريخ الرجعي', () => {
  assert.equal(validateRequest(leave({ fromDate: '2026-10-01', toDate: '2026-10-02' }), ctx({ enforceTiming: false })).ok, true);
});

test('عدد أيام الإجازة يستثني العطلة الأسبوعية والعطل الرسمية', () => {
  // الأحد 8 → الخميس 12 نوفمبر: خمسة أيام عمل
  assert.equal(validateRequest(leave({ fromDate: '2026-11-08', toDate: '2026-11-12' }), ctx()).value.days, 5);
  // تشمل الجمعة والسبت: لا تُحتسب
  assert.equal(validateRequest(leave({ fromDate: '2026-11-12', toDate: '2026-11-15' }), ctx()).value.days, 2);
  // عطلة رسمية وسط الأسبوع
  const holidays = new Set(['2026-11-10']);
  assert.equal(validateRequest(leave({ fromDate: '2026-11-08', toDate: '2026-11-12' }), ctx({ holidays })).value.days, 4);
  assert.deepEqual(workingDates('2026-11-12', '2026-11-16', SETTINGS), ['2026-11-12', '2026-11-15', '2026-11-16']);
  // فترة كلها عطلة
  const r = validateRequest(leave({ fromDate: '2026-11-13', toDate: '2026-11-14' }), ctx());
  assert.equal(r.ok, false);
  assert.match(r.error, /كلها عطلة/);
});

test('تحقق الحقول: الغرض، «أخرى»، الأوقات، المدة القصوى', () => {
  assert.equal(validateRequest(leave({ kind: 'x' }), ctx()).ok, false);
  assert.equal(validateRequest(leave({ purpose: 'zzz' }), ctx()).ok, false);
  assert.match(validateRequest(leave({ purpose: 'other', purposeOther: '' }), ctx()).error, /أخرى/);
  assert.equal(validateRequest(leave({ purpose: 'other', purposeOther: 'زواج' }), ctx()).value.purposeOther, 'زواج');
  assert.match(validateRequest(permit('exit', { reason: '' }), ctx()).error, /الغرض/);
  assert.equal(validateRequest(leave({ reason: '' }), ctx()).ok, true, 'السنوية لا تحتاج غرضاً');
  assert.equal(validateRequest(permit('exit', { fromTime: '11:00', toTime: '10:00' }), ctx()).ok, false);
  assert.equal(validateRequest(permit('late', { fromTime: '8:30', toTime: '10:00' }), ctx()).ok, false, 'صيغة وقت خاطئة');
  assert.equal(validateRequest(leave({ toDate: '2026-11-01' }), ctx()).ok, false, 'نهاية قبل بداية');
  assert.equal(validateRequest(leave({ fromDate: '2026-12-01', toDate: '2027-04-01' }), ctx()).ok, false, 'أطول من 100 يوم');
  assert.equal(validateRequest(leave({ fromDate: '2028-12-01', toDate: '2028-12-02' }), ctx()).ok, false, 'بعيد جداً');
  assert.equal(validateRequest(leave(), ctx({ settings: null })).status, 409, 'بلا إعدادات دوام لا تُحتسب الإجازة');
  const e = validateRequest(permit('late', { fromTime: '08:30', toTime: '09:45' }), ctx()).value;
  assert.equal(e.minutes, 75);
  assert.equal(e.toDate, e.fromDate, 'الإذن يوم واحد');
});

test('اقتراح نوع الإجازة في إعدادات المحرك بحسب الغرض', () => {
  assert.equal(suggestLeaveType('annual', SETTINGS.leaveTypes), 'إجازة سنوية');
  assert.equal(suggestLeaveType('sick', SETTINGS.leaveTypes), 'إجازة مرضية');
  assert.equal(suggestLeaveType('emergency', SETTINGS.leaveTypes), 'إجازة رسمية / طارئة');
  assert.equal(suggestLeaveType('other', SETTINGS.leaveTypes), null);
});

test('دمج قواعد محفوظة: القيم غير الصالحة تُهمل', () => {
  const r = mergeRules({ sick: { maxBackdateDays: 30 }, annual: { minNoticeDays: -3 }, maxSpanDays: 'x', entitlement: { annual: 21, sick: 'x' } });
  assert.equal(r.sick.maxBackdateDays, 30);
  assert.equal(r.annual.minNoticeDays, 1);
  assert.equal(r.maxSpanDays, 100);
  assert.deepEqual(r.entitlement, { annual: 21 });
  assert.deepEqual(mergeRules(null), DEFAULT_RULES);
  assert.equal(DEFAULT_RULES.monthlyCap.enabled, false, 'السقف الشهري معطَّل افتراضياً');
  assert.equal(mergeRules({ monthlyCap: { enabled: 'yes' } }).monthlyCap.enabled, false, 'لا يُفعَّل إلا بـ true صريحة');
  assert.equal(mergeRules({ monthlyCap: { enabled: true } }).monthlyCap.enabled, true);
});

// ---------------------------------------------------------------- الصلاحيات
test('صلاحيات الطلبات: من يُدخل ويعتمد ويُلغي', () => {
  const hr = { role: 'hr', employeeId: 4 };
  const mgr = { role: 'manager', employeeId: 1 };
  const emp = { role: 'employee', employeeId: 2 };
  const report = { id: 2, manager_id: 1 };
  const stranger = { id: 4, manager_id: null };
  assert.equal(canManageRequests(hr, report), true);
  assert.equal(canManageRequests(mgr, report), true);
  assert.equal(canManageRequests(mgr, stranger), false, 'ليس مرؤوسه');
  assert.equal(canManageRequests(emp, report), false);
  assert.equal(canDecideRequest(hr, { id: 4, manager_id: null }), false, 'لا أحد يعتمد طلب نفسه');
  assert.equal(canDecideRequest(mgr, { id: 1, manager_id: null }), false);
  assert.equal(canDecideRequest(hr, report), true);
  assert.equal(canRevokeRequest(mgr, report), false, 'المدير المباشر لا يلغي المعتمَد');
  assert.equal(canRevokeRequest(hr, report), true);
  assert.equal(canRevokeRequest(hr, { id: 4, manager_id: null }), false);
});

// ---------------------------------------------------------------- الواجهة البرمجية
test('الموظف يقدّم إجازته والمدير يراها في صندوقه ثم يعتمدها فتدخل حساب الأيام', async () => {
  const { db, env, u } = await world();
  const r = await post(env, u.emp2, '/api/requests', leave({ fromDate: '2026-11-08', toDate: '2026-11-10' }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.id;

  // الموظف يرى طلبه، زميله لا يراه
  assert.equal((await get(env, u.emp2, '/api/requests?scope=mine')).body.requests.length, 1);
  assert.equal((await get(env, u.emp3, '/api/requests?scope=mine')).body.requests.length, 0);
  assert.equal((await get(env, u.emp3, `/api/requests/${id}`)).status, 403);

  // صندوق المدير (مباشر) والموارد البشرية، لا الموظف
  assert.equal((await get(env, u.mgr, '/api/requests?scope=inbox')).body.requests.length, 1);
  assert.equal((await get(env, u.hr, '/api/requests?scope=inbox')).body.requests.length, 1);
  assert.equal((await get(env, u.emp3, '/api/requests?scope=inbox')).body.requests.length, 0);
  assert.equal((await get(env, u.mgr, '/api/requests/meta')).body.pending, 1);

  // التفاصيل: احتساب أيام العمل ونوع الإجازة المقترح
  const d = await get(env, u.mgr, `/api/requests/${id}`);
  assert.equal(d.body.request.status, 'pending');
  assert.equal(d.body.request.can.decide, true);
  assert.equal(d.body.calc.days, 3);
  assert.equal(d.body.suggestedLeaveType, 'إجازة سنوية');
  assert.equal(d.body.request.employeeName, 'موظف أ');
  assert.equal(d.body.request.managerName, 'المديرة');

  // الموظف لا يعتمد
  assert.equal((await post(env, u.emp2, `/api/requests/${id}/approve`, {})).status, 403);
  // المدير يعتمد
  const ok = await post(env, u.mgr, `/api/requests/${id}/approve`, {});
  assert.equal(ok.status, 200, JSON.stringify(ok.body));

  const rows = (await db.prepare('SELECT date, leave_type, request_id FROM day_overrides WHERE employee_id = 2 ORDER BY date').all()).results;
  assert.deepEqual(rows.map((x) => x.date), ['2026-11-08', '2026-11-09', '2026-11-10']);
  assert.ok(rows.every((x) => x.leave_type === 'إجازة سنوية' && x.request_id === id));
  const after = (await get(env, u.emp2, `/api/requests/${id}`)).body.request;
  assert.equal(after.status, 'approved');
  assert.equal(after.decidedBy, 'mgr@nawaculture.org');
  assert.equal(after.decidedByName, 'المديرة');
  assert.equal((await get(env, u.mgr, '/api/requests?scope=inbox')).body.requests.length, 0);
  assert.equal((await post(env, u.mgr, `/api/requests/${id}/approve`, {})).status, 409, 'لا يُعتمد مرتين');
});

test('إجازة سابقة معتمدة تُعيد حساب أيامها في daily_results، وإلغاؤها يعيدها', async () => {
  const { db, env, u } = await world();
  // مرضية: من الخميس 29/10 إلى اليوم الإثنين 2/11 (أيام العمل: الخميس والأحد والإثنين)
  const r = await post(env, u.emp2, '/api/requests', { kind: 'leave', purpose: 'sick', fromDate: '2026-10-29', toDate: TODAY, medicalProof: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  // أكثر من يوم: تؤكّد الورقةَ الموارد البشرية لا المدير المباشر
  assert.equal((await post(env, u.hr, `/api/requests/${r.body.id}/approve`, { medicalConfirmed: true })).status, 200);
  const status = async () => (await db.prepare("SELECT date, status, approved_hours AS h FROM daily_results WHERE employee_id = 2 ORDER BY date").all()).results;
  const s1 = await status();
  assert.deepEqual(s1.map((x) => [x.date, x.status]), [['2026-10-29', 'إجازة مرضية'], ['2026-11-01', 'إجازة مرضية'], ['2026-11-02', 'إجازة مرضية']]);
  assert.ok(s1.every((x) => x.h === 6.5), 'الإجازة المحتسبة = ساعات الدوام الكاملة');

  // الموظف لا يلغي المعتمد، والمدير المباشر لا يلغيه، الموارد البشرية تلغيه
  assert.equal((await post(env, u.emp2, `/api/requests/${r.body.id}/cancel`, {})).status, 403);
  assert.equal((await post(env, u.mgr, `/api/requests/${r.body.id}/cancel`, {})).status, 403);
  assert.equal((await post(env, u.hr, `/api/requests/${r.body.id}/cancel`, { note: 'خطأ في التاريخ' })).status, 200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM day_overrides').first('n')), 0, 'أُزيلت الأيام المرتبطة');
  assert.deepEqual((await status()).map((x) => x.status), ['غياب', 'غياب', 'غياب']);
});

test('إلغاء الإجازة لا يمسّ تصحيحاً يدوياً على يوم منها', async () => {
  const { db, env, u } = await world();
  await addOverride(db, 2, '2026-11-09', { manual: { in: '08:30', dep: '15:00' } }); // تصحيح أوقات يدوي بلا نوع إجازة
  const r = await post(env, u.hr, '/api/requests', leave({ employeeId: 2, fromDate: '2026-11-08', toDate: '2026-11-10', approve: true }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const mid = await db.prepare("SELECT in_time, dep_time, leave_type FROM day_overrides WHERE employee_id = 2 AND date = '2026-11-09'").first();
  assert.deepEqual([mid.in_time, mid.dep_time, mid.leave_type], ['08:30', '15:00', 'إجازة سنوية']);
  await post(env, u.hr, `/api/requests/${r.body.id}/cancel`, {});
  const left = (await db.prepare('SELECT date, in_time, dep_time, leave_type FROM day_overrides ORDER BY date').all()).results;
  assert.deepEqual(left, [{ date: '2026-11-09', in_time: '08:30', dep_time: '15:00', leave_type: null }], 'بقي تصحيح الأوقات وحده');
});

test('لا أحد يعتمد طلب نفسه، والمدير يُعتمد طلبه من الموارد البشرية', async () => {
  const { env, u } = await world();
  const mine = await post(env, u.mgr, '/api/requests', leave());
  assert.equal(mine.status, 201);
  assert.equal((await post(env, u.mgr, `/api/requests/${mine.body.id}/approve`, {})).status, 403, 'المديرة لا تعتمد طلبها');
  assert.equal((await get(env, u.mgr, '/api/requests?scope=inbox')).body.requests.length, 0, 'طلبها ليس في صندوقها');
  assert.equal((await get(env, u.director, '/api/requests?scope=inbox')).body.requests.length, 1);
  assert.equal((await post(env, u.director, `/api/requests/${mine.body.id}/approve`, {})).status, 200);

  const hrOwn = await post(env, u.hr, '/api/requests', leave({ fromDate: '2026-12-06', toDate: '2026-12-06' }));
  assert.equal((await post(env, u.hr, `/api/requests/${hrOwn.body.id}/approve`, {})).status, 403, 'الموارد البشرية لا تعتمد طلبها');
  assert.equal((await post(env, u.admin, `/api/requests/${hrOwn.body.id}/approve`, {})).status, 200);
});

test('الإدخال نيابة عن موظف: المدير لمرؤوسيه، والموارد البشرية للجميع، والموظف لا', async () => {
  const { env, u } = await world();
  const body = (employeeId) => leave({ employeeId, fromDate: '2026-10-20', toDate: '2026-10-21' }); // بأثر رجعي
  assert.equal((await post(env, u.emp2, '/api/requests', body(3))).status, 403, 'موظف عن زميله');
  assert.equal((await post(env, u.mgr, '/api/requests', body(4))).status, 403, 'المديرة عن غير مرؤوسها');
  const a = await post(env, u.mgr, '/api/requests', body(2));
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal((await post(env, u.hr, '/api/requests', body(3))).status, 201);
  assert.equal((await post(env, u.admin, '/api/requests', body(2))).status, 409, 'يتقاطع مع طلب قائم');
  assert.equal((await post(env, u.nolink, '/api/requests', leave())).status, 400, 'حساب بلا موظف');
  // الطلب نفسه من الموظف بأثر رجعي مرفوض
  assert.equal((await post(env, u.emp2, '/api/requests', leave({ fromDate: '2026-10-20', toDate: '2026-10-21' }))).status, 400);
  assert.equal((await post(env, u.mgr, '/api/requests', body(999))).status, 404);
});

test('«امنح مباشرة»: يُنشأ الطلب ويُعتمد في خطوة واحدة، ومن لا يملك الاعتماد لا يستطيع', async () => {
  const { db, env, u } = await world();
  const r = await post(env, u.hr, '/api/requests', leave({ employeeId: 3, fromDate: '2026-11-15', toDate: '2026-11-16', approve: true }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const st = await get(env, u.emp3, `/api/requests/${r.body.id}`);
  assert.equal(st.body.request.status, 'approved');
  assert.equal(st.body.request.createdBy, 'hr@nawaculture.org');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM day_overrides WHERE employee_id = 3').first('n')), 2);
  // الموظف يطلب لنفسه مع approve:true فلا يعتمد نفسه
  const self = await post(env, u.emp2, '/api/requests', leave({ approve: true }));
  assert.equal(self.status, 403);
  assert.equal((await get(env, u.emp2, `/api/requests/${self.body.requestId}`)).body.request.status, 'pending', 'بقي الطلب معلّقاً');
});

test('تعارض الإجازات: مع طلب معلّق أو معتمد، ومع يوم عليه نوع إجازة يدوي', async () => {
  const { db, env, u } = await world();
  const first = await post(env, u.emp2, '/api/requests', leave({ fromDate: '2026-11-08', toDate: '2026-11-10' }));
  assert.equal(first.status, 201);
  assert.equal((await post(env, u.emp2, '/api/requests', leave({ fromDate: '2026-11-10', toDate: '2026-11-11' }))).status, 409);
  assert.equal((await post(env, u.emp2, '/api/requests', leave({ fromDate: '2026-11-11', toDate: '2026-11-11' }))).status, 201, 'يوم بعده');
  // إلغاء الأول يحرّر الفترة
  assert.equal((await post(env, u.emp2, `/api/requests/${first.body.id}/cancel`, {})).status, 200);
  assert.equal((await post(env, u.emp2, '/api/requests', leave({ fromDate: '2026-11-09', toDate: '2026-11-09' }))).status, 201);
  // تصحيح يدوي بنوع إجازة على يوم: الاعتماد يرفض بدل أن يكتب فوقه
  await addOverride(db, 3, '2026-11-18', { leaveType: 'إجازة مرضية' });
  const r = await post(env, u.emp3, '/api/requests', leave({ fromDate: '2026-11-17', toDate: '2026-11-19' }));
  const ap = await post(env, u.mgr, `/api/requests/${r.body.id}/approve`, {});
  assert.equal(ap.status, 409);
  assert.match(ap.body.error, /2026-11-18/);
});

test('المعتمِد يعدّل التواريخ قبل الاعتماد فيُحفظ ما طلبه الموظف', async () => {
  const { db, env, u } = await world();
  const r = await post(env, u.emp2, '/api/requests', leave({ fromDate: '2026-11-08', toDate: '2026-11-12' }));
  assert.equal(r.status, 201);
  const ap = await post(env, u.mgr, `/api/requests/${r.body.id}/approve`, { fromDate: '2026-11-09', toDate: '2026-11-11', note: 'منحناه ثلاثة أيام فقط' });
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  const d = (await get(env, u.emp2, `/api/requests/${r.body.id}`)).body.request;
  assert.deepEqual([d.fromDate, d.toDate, d.days], ['2026-11-09', '2026-11-11', 3]);
  assert.deepEqual([d.original.fromDate, d.original.toDate, d.original.days], ['2026-11-08', '2026-11-12', 5]);
  assert.equal(d.decisionNote, 'منحناه ثلاثة أيام فقط');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM day_overrides WHERE employee_id = 2').first('n')), 3);
});

test('نوع الإجازة عند الاعتماد: «أخرى» تحتاج اختياراً، والنوع الخاطئ يُرفض، وغير المحتسبة مقبولة', async () => {
  const { db, env, u } = await world();
  const r = await post(env, u.emp2, '/api/requests', leave({ purpose: 'other', purposeOther: 'زواج', fromDate: '2026-11-15', toDate: '2026-11-15' }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await post(env, u.mgr, `/api/requests/${r.body.id}/approve`, {})).status, 400, 'لا اقتراح تلقائياً لـ«أخرى»');
  assert.equal((await post(env, u.mgr, `/api/requests/${r.body.id}/approve`, { leaveType: 'نوع غير موجود' })).status, 400);
  assert.equal((await post(env, u.mgr, `/api/requests/${r.body.id}/approve`, { leaveType: 'إجازة بدون راتب' })).status, 200);
  assert.equal((await db.prepare("SELECT leave_type FROM day_overrides WHERE date = '2026-11-15'").first('leave_type')), 'إجازة بدون راتب');
});

test('الرفض يحتاج سبباً، والملغى والمرفوض لا يعودان', async () => {
  const { env, u } = await world();
  const r = await post(env, u.emp2, '/api/requests', leave());
  assert.equal((await post(env, u.mgr, `/api/requests/${r.body.id}/reject`, {})).status, 400);
  assert.equal((await post(env, u.emp2, `/api/requests/${r.body.id}/reject`, { note: 'لا' })).status, 403);
  assert.equal((await post(env, u.mgr, `/api/requests/${r.body.id}/reject`, { note: 'ضغط العمل في هذه الفترة' })).status, 200);
  const d = (await get(env, u.emp2, `/api/requests/${r.body.id}`)).body.request;
  assert.equal(d.status, 'rejected');
  assert.equal(d.decisionNote, 'ضغط العمل في هذه الفترة');
  assert.equal((await post(env, u.mgr, `/api/requests/${r.body.id}/approve`, {})).status, 409);
  assert.equal((await post(env, u.emp2, `/api/requests/${r.body.id}/cancel`, {})).status, 409);
  // الموظف يلغي طلبه المعلّق، وزميله لا
  const p = await post(env, u.emp2, '/api/requests', leave({ fromDate: '2026-12-06', toDate: '2026-12-06' }));
  assert.equal((await post(env, u.emp3, `/api/requests/${p.body.id}/cancel`, {})).status, 403);
  assert.equal((await post(env, u.emp2, `/api/requests/${p.body.id}/cancel`, {})).status, 200);
});

test('الأذونات: مغادرة وتأخير وتعارض الوقت، ولا إجمالي شهري ولا سقف افتراضياً', async () => {
  const { env, u } = await world();
  const a = await post(env, u.emp2, '/api/requests', permit('exit', { fromTime: '10:00', toTime: '12:00' }));
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal((await post(env, u.emp2, '/api/requests', permit('exit', { fromTime: '11:00', toTime: '12:30' }))).status, 409, 'يتقاطع');
  assert.equal((await post(env, u.emp2, '/api/requests', permit('exit', { fromTime: '12:00', toTime: '13:00' }))).status, 201, 'متتالٍ');
  // إذن تأخير في اليوم نفسه لا يتعارض مع المغادرة
  assert.equal((await post(env, u.emp2, '/api/requests', permit('late', { fromTime: '08:30', toTime: '10:00' }))).status, 201);

  // السقف الشهري معطَّل رغم أن settings.monthlyExitCapHours = 6: لا إجمالي ولا تحذير مهما بلغت الساعات
  const pv = await post(env, u.emp2, '/api/requests/preview', permit('exit', { fromDate: '2026-11-04', fromTime: '09:00', toTime: '13:00' }));
  assert.equal(pv.status, 200);
  assert.equal(pv.body.calc.minutes, 240, 'مدة هذا الإذن وحده');
  for (const k of ['month', 'monthApprovedMinutes', 'monthPendingMinutes', 'capMinutes']) assert.equal(k in pv.body.calc, false, `${k} غير موجود`);
  assert.deepEqual(pv.body.calc.warnings, []);
  assert.equal((await post(env, u.emp2, '/api/requests', permit('exit', { fromDate: '2026-11-04', fromTime: '09:00', toTime: '13:00' }))).status, 201);

  // اعتماد إذن لا يكتب شيئاً في day_overrides
  const id = a.body.id;
  assert.equal((await post(env, u.mgr, `/api/requests/${id}/approve`, { fromTime: '10:00', toTime: '11:30' })).status, 200);
  const d = (await get(env, u.mgr, `/api/requests/${id}`)).body.request;
  assert.deepEqual([d.fromTime, d.toTime, d.minutes], ['10:00', '11:30', 90]);
  assert.deepEqual([d.original.toTime, d.original.minutes], ['12:00', 120]);
});

test('تفاصيل الطلب تُبيّن إن كان المدير المباشر قادراً على اعتماده أم يبقى للموارد البشرية', async () => {
  const { db, env, u } = await world();
  const a = await post(env, u.emp2, '/api/requests', leave());
  const d1 = (await get(env, u.emp2, `/api/requests/${a.body.id}`)).body;
  assert.equal(d1.request.managerName != null, true, 'اسم المدير المباشر يصل للواجهة');
  assert.equal(d1.managerCanDecide, true, 'مديرته لها حساب بدور مدير');

  // المدير بلا حساب فعّال: لا يستطيع الاعتماد فتظهر الحالة للجميع
  await db.prepare("UPDATE users SET active = 0 WHERE email = 'mgr@nawaculture.org'").run();
  assert.equal((await get(env, u.emp2, `/api/requests/${a.body.id}`)).body.managerCanDecide, false);

  // موظف بلا مدير مباشر (رقم 4): لا مدير ولا اعتماد إلا من الموارد البشرية/المدير العام
  const b = await post(env, u.hr, '/api/requests', leave());
  const d2 = (await get(env, u.hr, `/api/requests/${b.body.id}`)).body;
  assert.equal(d2.request.managerId, null);
  assert.equal(d2.managerCanDecide, false);
  assert.equal((await post(env, u.director, `/api/requests/${b.body.id}/approve`, { leaveType: 'إجازة سنوية' })).status, 200, 'المدير العام يعتمد');
});

test('الإجازة المرضية: يوم واحد بلا ورقة، وأكثر منه يلزمه إقرار بورقة طبية', () => {
  const sick = (from, to, extra = {}) => validateRequest(leave({ purpose: 'sick', reason: '', fromDate: from, toDate: to, ...extra }), ctx());
  assert.equal(sick(TODAY, TODAY).ok, true, 'يوم واحد بلا ورقة');
  assert.equal(sick('2026-10-29', TODAY).ok, false, 'ثلاثة أيام عمل بلا ورقة');
  assert.match(sick('2026-10-29', TODAY).error, /ورقة طبية/);
  const ok = sick('2026-10-29', TODAY, { medicalProof: true });
  assert.equal(ok.ok, true);
  assert.deepEqual([ok.value.days, ok.value.medicalRequired, ok.value.medicalProof], [3, true, true]);
  // الجمعة والسبت عطلة: الخميس→السبت = يوم عمل واحد فلا تُطلب ورقة
  assert.equal(sick('2026-10-29', '2026-10-31').ok, true);
  // النوع الاعتيادي لا يتأثر
  assert.equal(validateRequest(leave({ fromDate: '2026-11-08', toDate: '2026-11-12' }), ctx()).ok, true);
  // عدد الأيام المسموحة بلا ورقة قابل للضبط
  const two = mergeRules({ medical: { freeDays: 2 } });
  const asked = leave({ purpose: 'sick', reason: '', fromDate: '2026-11-01', toDate: TODAY });
  assert.equal(validateRequest(asked, ctx()).ok, false, 'يومان بلا ورقة والمسموح يوم');
  assert.equal(validateRequest(asked, ctx({ rules: two })).ok, true, 'المسموح يومان');
});

test('الإجازة المرضية لأكثر من يوم: لا يعتمدها المدير المباشر، وتؤكّدها الموارد البشرية أو المفوَّض', async () => {
  const { db, env, u } = await world();
  const noProof = await post(env, u.emp2, '/api/requests', { kind: 'leave', purpose: 'sick', fromDate: '2026-11-01', toDate: TODAY });
  assert.equal(noProof.status, 400);
  assert.match(noProof.body.error, /ورقة طبية/);
  const prev = await post(env, u.emp2, '/api/requests/preview', { kind: 'leave', purpose: 'sick', fromDate: '2026-11-01', toDate: TODAY, medicalProof: true });
  assert.equal(prev.status, 200);

  const r = await post(env, u.emp2, '/api/requests', { kind: 'leave', purpose: 'sick', fromDate: '2026-11-01', toDate: TODAY, medicalProof: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.id;
  const one = await post(env, u.emp3, '/api/requests', { kind: 'leave', purpose: 'sick', fromDate: TODAY, toDate: TODAY });
  assert.equal(one.status, 201, 'يوم واحد بلا ورقة يُقبل');

  // المدير المباشر لا يرى الطلب في صندوقه ولا يقرّره، لكنه يقرّر اليوم الواحد
  const inbox = (await get(env, u.mgr, '/api/requests?scope=inbox')).body.requests.map((x) => x.id);
  assert.deepEqual(inbox, [one.body.id]);
  assert.equal((await post(env, u.mgr, `/api/requests/${id}/approve`, { medicalConfirmed: true })).status, 403);
  assert.equal((await post(env, u.mgr, `/api/requests/${id}/reject`, { note: 'لا' })).status, 403);
  assert.equal((await get(env, u.mgr, `/api/requests/${id}`)).body.request.can.decide, false);
  assert.equal((await get(env, u.mgr, `/api/requests/${one.body.id}`)).body.request.can.decide, true);

  // الموارد البشرية: لا اعتماد بلا تأكيد استلام الورقة
  assert.equal((await get(env, u.hr, `/api/requests/${id}`)).body.request.needsMedical, true);
  const no = await post(env, u.hr, `/api/requests/${id}/approve`, {});
  assert.equal(no.status, 400);
  assert.match(no.body.error, /الورقة الطبية/);
  assert.equal((await post(env, u.hr, `/api/requests/${id}/approve`, { medicalConfirmed: true })).status, 200);
  const d = (await get(env, u.hr, `/api/requests/${id}`)).body.request;
  assert.deepEqual([d.status, d.medicalProof, d.medicalBy], ['approved', true, 'hr@nawaculture.org']);

  // تفويض فردي: موظفة بدور «موظف» تصير تؤكّد الأوراق الطبية فتراها وتقرّرها
  const clerk = await login(db, 'clerk@nawaculture.org', 'employee', 3);
  const r2 = await post(env, u.emp2, '/api/requests', { kind: 'leave', purpose: 'sick', fromDate: '2026-11-08', toDate: '2026-11-10', medicalProof: true });
  assert.equal((await get(env, clerk, '/api/requests/meta')).body.canDecide, false);
  assert.equal((await get(env, clerk, `/api/requests/${r2.body.id}`)).status, 403);
  await db.prepare("UPDATE users SET medical = 1 WHERE email = 'clerk@nawaculture.org'").run();
  const meta = (await get(env, clerk, '/api/requests/meta')).body;
  assert.deepEqual([meta.canDecide, meta.pending, meta.canBehalf], [true, 1, false]);
  assert.deepEqual((await get(env, clerk, '/api/requests?scope=inbox')).body.requests.map((x) => x.id), [r2.body.id]);
  assert.equal((await get(env, clerk, `/api/requests/${r2.body.id}`)).body.request.can.decide, true);
  assert.equal((await post(env, clerk, `/api/requests/${r2.body.id}/approve`, { medicalConfirmed: true })).status, 200);

  // تقليص المدة إلى يوم واحد عند الاعتماد لا يستلزم تأكيد ورقة
  const r3 = await post(env, u.emp2, '/api/requests', { kind: 'leave', purpose: 'sick', fromDate: '2026-11-15', toDate: '2026-11-16', medicalProof: true });
  assert.equal((await post(env, u.hr, `/api/requests/${r3.body.id}/approve`, { toDate: '2026-11-15' })).status, 200);
  assert.equal((await get(env, u.hr, `/api/requests/${r3.body.id}`)).body.request.medicalBy, null);
});

test('منح الإجازة المرضية مباشرة: الموارد البشرية بإقرارها بالورقة، والمدير المباشر لا يملك ذلك', async () => {
  const { env, u } = await world();
  const body = { kind: 'leave', purpose: 'sick', employeeId: 2, fromDate: '2026-11-01', toDate: TODAY, approve: true };
  assert.equal((await post(env, u.hr, '/api/requests', body)).status, 400, 'بلا إقرار بورقة');
  const ok = await post(env, u.hr, '/api/requests', { ...body, medicalProof: true });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal((await get(env, u.hr, `/api/requests/${ok.body.id}`)).body.request.status, 'approved');
  const bad = await post(env, u.mgr, '/api/requests', { ...body, fromDate: '2026-11-15', toDate: '2026-11-16', medicalProof: true });
  assert.equal(bad.status, 403, 'يُدخل لكنه لا يعتمد');
  assert.equal((await get(env, u.mgr, `/api/requests/${bad.body.requestId}`)).body.request.status, 'pending');
});

test('اعتماد إذن تأخير/مغادرة يعفي يومه من العجز والتأخير، وإلغاؤه يعيدهما، وإيقاف الإعفاء يلغي الأثر', async () => {
  const { db, env, u } = await world();
  await addOverride(db, 2, '2026-11-01', { manual: { in: '09:50', dep: '15:00' } }); // الأحد: حضور 09:50
  const row = async (d) => db.prepare('SELECT late_minutes AS late, deficit_hours AS def, approved_hours AS ap, status FROM daily_results WHERE employee_id = 2 AND date = ?').bind(d).first();
  assert.equal(await row('2026-11-01'), null, 'لم يُحسب بعد');

  const a = await post(env, u.hr, '/api/requests', permit('late', { employeeId: 2, fromDate: '2026-11-01', fromTime: '08:30', toTime: '10:00', approve: true }));
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.deepEqual(await row('2026-11-01'), { late: 0, def: 0, ap: 6.5, status: 'حاضر' }, 'أُعفي من التأخير والعجز');

  assert.equal((await post(env, u.hr, `/api/requests/${a.body.id}/cancel`, { note: 'تراجع' })).status, 200);
  assert.deepEqual(await row('2026-11-01'), { late: 80, def: 1.33, ap: 5.17, status: 'متأخر' }, 'عاد الاحتساب الأصلي');

  // الإعفاء يُوقَف من القواعد فلا يتأثر اليوم
  await db.prepare("INSERT INTO settings (key, value) VALUES ('requests', ?)").bind(JSON.stringify({ permits: { exempt: false } })).run();
  const b = await post(env, u.hr, '/api/requests', permit('late', { employeeId: 2, fromDate: '2026-11-01', fromTime: '08:30', toTime: '10:00', approve: true }));
  assert.equal(b.status, 201);
  assert.deepEqual(await row('2026-11-01'), { late: 80, def: 1.33, ap: 5.17, status: 'متأخر' });

  // إذن بتاريخ مستقبلي لا يحسب شيئاً الآن (يتكفّل به الإقفال الليلي)
  const f = await post(env, u.hr, '/api/requests', permit('exit', { employeeId: 2, fromDate: '2026-11-10', approve: true }));
  assert.equal(f.status, 201);
  assert.equal(await row('2026-11-10'), null);
});

test('السقف الشهري للمغادرات يعمل عند تفعيله صراحةً (جاهز للمستقبل) وهو تنبيه لا منع', async () => {
  const { db, env, u } = await world();
  await db.prepare("INSERT INTO settings (key, value) VALUES ('requests', ?)").bind(JSON.stringify({ monthlyCap: { enabled: true } })).run();
  assert.equal((await post(env, u.emp2, '/api/requests', permit('exit', { fromTime: '10:00', toTime: '13:00' }))).status, 201); // 3 ساعات
  const ok = await post(env, u.emp2, '/api/requests/preview', permit('exit', { fromDate: '2026-11-04', fromTime: '09:00', toTime: '11:00' }));
  assert.equal(ok.body.calc.monthPendingMinutes, 180);
  assert.equal(ok.body.calc.capMinutes, 360);
  assert.deepEqual(ok.body.calc.warnings, [], '5 ساعات من 6');
  const over = await post(env, u.emp2, '/api/requests/preview', permit('exit', { fromDate: '2026-11-04', fromTime: '09:00', toTime: '13:00' }));
  assert.match(over.body.calc.warnings[0], /سقف المغادرات/);
  assert.equal((await post(env, u.emp2, '/api/requests', permit('exit', { fromDate: '2026-11-04', fromTime: '09:00', toTime: '13:00' }))).status, 201, 'لا يُمنع الحفظ');
});

test('الإجازة تعرض المستهلك هذا العام والرصيد إن حُدّد في القواعد', async () => {
  const { db, env, u } = await world();
  await db.prepare("INSERT INTO settings (key, value) VALUES ('requests', ?)").bind(JSON.stringify({ entitlement: { annual: 5 } })).run();
  const a = await post(env, u.hr, '/api/requests', leave({ employeeId: 2, fromDate: '2026-11-08', toDate: '2026-11-10', approve: true })); // 3 أيام
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const pv = await post(env, u.emp2, '/api/requests/preview', leave({ fromDate: '2026-11-22', toDate: '2026-11-25' })); // 4 أيام
  assert.equal(pv.body.calc.usedApproved.annual, 3);
  assert.equal(pv.body.calc.entitlement, 5);
  assert.equal(pv.body.calc.remaining, -2);
  assert.match(pv.body.calc.warnings[0], /الرصيد/);
});

test('عطلة رسمية داخل الإجازة لا تُحتسب ولا تُكتب في الأيام', async () => {
  const { db, env, u } = await world();
  await addHolidays(db, ['2026-11-10']);
  const r = await post(env, u.emp2, '/api/requests', leave({ fromDate: '2026-11-08', toDate: '2026-11-11' }));
  assert.equal((await get(env, u.mgr, `/api/requests/${r.body.id}`)).body.calc.days, 3);
  await post(env, u.mgr, `/api/requests/${r.body.id}/approve`, {});
  assert.deepEqual((await db.prepare('SELECT date FROM day_overrides ORDER BY date').all()).results.map((x) => x.date), ['2026-11-08', '2026-11-09', '2026-11-11']);
});

test('القائمة: «الكل» حسب النطاق، والتصفية بالحالة والنوع والموظف', async () => {
  const { env, u } = await world();
  await post(env, u.emp2, '/api/requests', leave());
  await post(env, u.emp3, '/api/requests', permit('exit'));
  await post(env, u.hr, '/api/requests', leave({ employeeId: 4, fromDate: '2026-12-06', toDate: '2026-12-06' }));
  const n = async (who, q) => (await get(env, who, `/api/requests?scope=all${q || ''}`)).body.requests.length;
  assert.equal(await n(u.emp2), 1);
  assert.equal(await n(u.mgr), 2, 'مرؤوسوها');
  assert.equal(await n(u.hr), 3);
  assert.equal(await n(u.hr, '&kind=exit'), 1);
  assert.equal(await n(u.hr, '&employeeId=4'), 1);
  assert.equal(await n(u.hr, '&status=approved'), 0);
  assert.equal(await n(u.hr, '&from=2026-12-01&to=2026-12-31'), 1);
  assert.equal((await call(env, 'GET', '/api/requests')).status, 401);
});

test('عدد الاستعلامات ثابت وصغير (حدّ D1: 50 لكل طلب) حتى مع إجازة طويلة', async () => {
  const { db, env, u } = await world();
  const r = await post(env, u.hr, '/api/requests', leave({ employeeId: 2, fromDate: '2026-08-01', toDate: '2026-10-25', approve: true }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(env.DB.maxQueries <= 50, `استعلامات: ${env.DB.maxQueries}`);
  assert.ok((await db.prepare('SELECT COUNT(*) AS n FROM day_overrides').first('n')) > 40);
});

// ---------------------------------------------------------------- قواعد الطلبات من الإعدادات

test('قراءة قواعد الطلبات للموارد البشرية والمدير العام والمسؤول، والكتابة للمسؤول وحده', async () => {
  const { env, u } = await world();
  for (const who of [u.emp2, u.mgr]) assert.equal((await get(env, who, '/api/settings/requests')).status, 403);
  const r = await get(env, u.hr, '/api/settings/requests');
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.rules.permits.exempt, r.body.rules.notify.enabled, r.body.rules.monthlyCap.enabled, r.body.canEdit], [true, true, false, false]);
  const put = (who, rules) => call(env, 'PUT', '/api/settings/requests', { cookie: who.cookie, body: { rules } });
  for (const who of [u.emp2, u.mgr, u.hr, u.director]) assert.equal((await put(who, {})).status, 403);
  assert.equal((await call(env, 'PUT', '/api/settings/requests', { cookie: u.admin.cookie, body: {} })).status, 400);
  const ok = await put(u.admin, { annual: { minNoticeDays: 3 }, sick: { maxBackdateDays: 30 }, medical: { freeDays: 2 }, entitlement: { annual: 21, sick: 'x', other: 400 }, notify: { enabled: false }, maxSpanDays: 'x' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.rules.entitlement, { annual: 21 }, 'القيم الخاطئة تُهمل');
  assert.deepEqual([ok.body.rules.annual.minNoticeDays, ok.body.rules.sick.maxBackdateDays, ok.body.rules.medical.freeDays, ok.body.rules.notify.enabled, ok.body.rules.maxSpanDays], [3, 30, 2, false, 100]);
  assert.deepEqual((await get(env, u.director, '/api/settings/requests')).body.rules.entitlement, { annual: 21 });
  assert.equal((await get(env, u.emp2, '/api/requests/meta')).body.rules.annual.minNoticeDays, 3, 'تسري القواعد المحفوظة فوراً');
});

test('سقف المغادرات المحفوظ لا يُفعَّل بحفظ بقية القواعد، ويبقى إن أُرسل كما هو', async () => {
  const { db, env, u } = await world();
  await db.prepare("INSERT INTO settings (key, value) VALUES ('requests', ?)").bind(JSON.stringify({ monthlyCap: { enabled: true } })).run();
  const cur = (await get(env, u.admin, '/api/settings/requests')).body.rules;
  assert.equal(cur.monthlyCap.enabled, true);
  const r = await call(env, 'PUT', '/api/settings/requests', { cookie: u.admin.cookie, body: { rules: { ...cur, annual: { minNoticeDays: 2 } } } });
  assert.equal(r.body.rules.monthlyCap.enabled, true, 'أُرسل كما هو فبقي');
  const r2 = await call(env, 'PUT', '/api/settings/requests', { cookie: u.admin.cookie, body: { rules: { annual: { minNoticeDays: 2 } } } });
  assert.equal(r2.body.rules.monthlyCap.enabled, false, 'غير المُرسَل يعود للافتراضي (معطَّل)');
  assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'settings.requests'").first('n'), 2);
});

test('إيقاف إعفاء الأذونات من الإعدادات يعيد حساب الأيام المتأثرة فوراً', async () => {
  const { db, env, u } = await world();
  await addOverride(db, 2, '2026-11-01', { manual: { in: '09:50', dep: '15:00' } });
  const a = await post(env, u.hr, '/api/requests', permit('late', { employeeId: 2, fromDate: '2026-11-01', fromTime: '08:30', toTime: '10:00', approve: true }));
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const row = () => db.prepare('SELECT late_minutes AS late, deficit_hours AS def FROM daily_results WHERE employee_id = 2 AND date = ?').bind('2026-11-01').first();
  assert.deepEqual(await row(), { late: 0, def: 0 });
  const cur = (await get(env, u.admin, '/api/settings/requests')).body.rules;
  const off = await call(env, 'PUT', '/api/settings/requests', { cookie: u.admin.cookie, body: { rules: { ...cur, permits: { exempt: false } } } });
  assert.equal(off.body.recomputed, 1);
  assert.deepEqual(await row(), { late: 80, def: 1.33 }, 'عاد الاحتساب الكامل');
  const on = await call(env, 'PUT', '/api/settings/requests', { cookie: u.admin.cookie, body: { rules: { ...cur, permits: { exempt: true } } } });
  assert.equal(on.body.recomputed, 1);
  assert.deepEqual(await row(), { late: 0, def: 0 });
  const same = await call(env, 'PUT', '/api/settings/requests', { cookie: u.admin.cookie, body: { rules: { ...cur, permits: { exempt: true } } } });
  assert.equal(same.body.recomputed, 0, 'لا تغيير فلا إعادة حساب');
});
