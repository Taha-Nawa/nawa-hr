import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';
import { sanitizeReport, LIMITS } from '../src/worker/monthly.js';
import { canWriteReport } from '../src/worker/authz.js';

async function world() {
  const { db, env } = await apiEnv();
  await seedOrg(db); // 1 مديرة · 2،3 مرؤوسان · 4 مستقل
  const u = {
    emp: await login(db, 'emp@nawaculture.org', 'employee', 2),
    other: await login(db, 'other@nawaculture.org', 'employee', 3),
    mgr: await login(db, 'mgr@nawaculture.org', 'manager', 1),
    hr: await login(db, 'hr@nawaculture.org', 'hr', 4),
    dir: await login(db, 'dir@nawaculture.org', 'director', null),
    nolink: await login(db, 'nolink@nawaculture.org', 'employee', null),
  };
  return { db, env, u };
}
const Q = '/api/reports/monthly?month=2026-10';
const sample = () => ({
  tasks: [{ t: 'إعداد التقرير الشهري', s: 'تم الإنجاز', c: '' }, { t: '   ', s: 'x' }, { t: 'صيانة الأجهزة', s: 'قيد التنفيذ', c: 'نقص قطع' }],
  meetings: [{ t: 'اجتماع الأنظمة', s: 'عرض', p: 'online', d: '2026-10-11' }],
  attachments: ['خطة 2026.pdf', ''],
  plan: [{ t: 'خطة نوفمبر', i: 'مهم', sd: '2026-11-01', ed: '2026-11-30' }],
  notes: '',
  submitDate: '2026-10-31',
});

test('sanitizeReport: يحذف الصفوف الفارغة ويقصّ النصوص ويرفض التواريخ الفاسدة وتجاوز الحدود', () => {
  const r = sanitizeReport(sample());
  assert.equal(r.data.tasks.length, 2);
  assert.deepEqual(r.data.attachments, [{ t: 'خطة 2026.pdf' }]);
  assert.equal(r.submitDate, '2026-10-31');
  assert.match(sanitizeReport({ meetings: [{ t: 'a', d: '2026-13-40' }] }).error, /تاريخ غير صالح/);
  assert.match(sanitizeReport({ plan: [{ t: 'a', sd: 'غد' }] }).error, /تاريخ غير صالح/);
  assert.match(sanitizeReport({ submitDate: '31/10/2026' }).error, /تاريخ التقديم/);
  assert.match(sanitizeReport({ tasks: Array.from({ length: LIMITS.tasks + 1 }, () => ({ t: 'x' })) }).error, /أكبر من المسموح/);
  assert.equal(sanitizeReport({ tasks: [{ t: 'ا'.repeat(2000) }] }).data.tasks[0].t.length, 600);
  assert.deepEqual(sanitizeReport({}).data, { tasks: [], meetings: [], attachments: [], plan: [], notes: '' });
});

test('الموظف: لا تقرير ← حفظ ← قراءة، وخطة الشهر السابق تصل للاستيراد', async () => {
  const { env, u } = await world();
  let r = await call(env, 'GET', Q, { cookie: u.emp.cookie });
  assert.equal(r.status, 200);
  assert.equal(r.body.report, null);
  assert.equal(r.body.canEdit, true);
  assert.equal(r.body.employee.id, 2);
  assert.deepEqual(r.body.prevPlan, []);

  const put = await call(env, 'PUT', Q, { cookie: u.emp.cookie, body: { ...sample(), base: '' } });
  assert.equal(put.status, 200);
  assert.ok(put.body.updatedAt);

  r = await call(env, 'GET', Q, { cookie: u.emp.cookie });
  assert.equal(r.body.report.tasks.length, 2);
  assert.equal(r.body.report.tasks[1].c, 'نقص قطع');
  assert.equal(r.body.report.updatedAt, put.body.updatedAt);

  // خطة أكتوبر تظهر كـ prevPlan لنوفمبر
  const nov = await call(env, 'GET', '/api/reports/monthly?month=2026-11', { cookie: u.emp.cookie });
  assert.equal(nov.body.report, null);
  assert.equal(nov.body.prevPlan[0].t, 'خطة نوفمبر');
  // ومن يناير يُعبر الحد السنوي بلا خطأ
  const jan = await call(env, 'GET', '/api/reports/monthly?month=2027-01', { cookie: u.emp.cookie });
  assert.equal(jan.status, 200);
});

test('تزامن تفاؤلي: الكتابة على نسخة قديمة تُرفض 409 ولا تمحو العمل الأحدث', async () => {
  const { env, u } = await world();
  const a = await call(env, 'PUT', Q, { cookie: u.emp.cookie, body: { ...sample(), base: '' } });
  // جهاز ثانٍ يحمل base فارغاً (قبل الحفظ الأول) أو قديماً
  const stale = await call(env, 'PUT', Q, { cookie: u.emp.cookie, body: { ...sample(), tasks: [{ t: 'قديم' }], base: '' } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'conflict');
  const ok = await call(env, 'PUT', Q, { cookie: u.emp.cookie, body: { ...sample(), tasks: [{ t: 'جديد' }], base: a.body.updatedAt } });
  assert.equal(ok.status, 200);
  assert.notEqual(ok.body.updatedAt, a.body.updatedAt);
  const r = await call(env, 'GET', Q, { cookie: u.emp.cookie });
  assert.deepEqual(r.body.report.tasks.map((t) => t.t), ['جديد']);
});

test('الصلاحيات: الموظف لا يرى غيره، المدير يقرأ مرؤوسيه فقط، الكتابة لصاحب التقرير والموارد البشرية', async () => {
  const { db, env, u } = await world();
  await call(env, 'PUT', Q, { cookie: u.emp.cookie, body: { ...sample(), base: '' } });
  const asEmp2 = '&employee=2';

  assert.equal((await call(env, 'GET', Q + asEmp2, { cookie: u.other.cookie })).status, 403); // زميل
  assert.equal((await call(env, 'GET', Q + asEmp2, { cookie: u.mgr.cookie })).status, 200); // مديره
  const mgrRead = await call(env, 'GET', Q + asEmp2, { cookie: u.mgr.cookie });
  assert.equal(mgrRead.body.canEdit, false);
  assert.equal((await call(env, 'PUT', Q + asEmp2, { cookie: u.mgr.cookie, body: { ...sample(), base: mgrRead.body.report.updatedAt } })).status, 403);
  assert.equal((await call(env, 'GET', Q + '&employee=4', { cookie: u.mgr.cookie })).status, 403); // ليس مرؤوساً له
  assert.equal((await call(env, 'GET', Q + asEmp2, { cookie: u.dir.cookie })).status, 200);
  assert.equal((await call(env, 'PUT', Q + asEmp2, { cookie: u.dir.cookie, body: { ...sample(), base: mgrRead.body.report.updatedAt } })).status, 403);

  // الموارد البشرية تكتب نيابة عن موظف ويُسجَّل ذلك في التدقيق؛ وحفظ الموظف لتقريره لا يُسجَّل
  const hr = await call(env, 'PUT', Q + asEmp2, { cookie: u.hr.cookie, body: { ...sample(), base: mgrRead.body.report.updatedAt } });
  assert.equal(hr.status, 200);
  const audit = await db.prepare("SELECT actor, entity_id FROM audit_log WHERE action = 'report.monthly.edit'").all();
  assert.deepEqual(audit.results, [{ actor: 'hr@nawaculture.org', entity_id: '2' }]);
});

test('الدخول والمدخلات: بلا جلسة 401، بلا ربط بموظف 400، شهر فاسد 400، أصل غريب 403، نوع محتوى خاطئ 415', async () => {
  const { env, u } = await world();
  assert.equal((await call(env, 'GET', Q)).status, 401);
  assert.equal((await call(env, 'GET', Q, { cookie: u.nolink.cookie })).status, 400);
  assert.equal((await call(env, 'GET', '/api/reports/monthly?month=2026-13', { cookie: u.emp.cookie })).status, 400);
  assert.equal((await call(env, 'GET', '/api/reports/monthly', { cookie: u.emp.cookie })).status, 400);
  assert.equal((await call(env, 'PUT', Q, { cookie: u.emp.cookie, body: sample(), origin: 'https://evil.example' })).status, 403);
  assert.equal((await call(env, 'PUT', Q, { cookie: u.emp.cookie, raw: 'x', headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await call(env, 'PUT', Q, { cookie: u.emp.cookie, body: { tasks: [{ t: 'a' }], plan: [{ t: 'b', sd: 'غد' }], base: '' } })).status, 400);
  assert.equal((await call(env, 'GET', Q + '&employee=999', { cookie: u.hr.cookie })).status, 404);
});

test('قائمة الأشهر المحفوظة بأعداد الصفوف، وتُحصر بنطاق الصلاحية', async () => {
  const { env, u } = await world();
  await call(env, 'PUT', '/api/reports/monthly?month=2026-09', { cookie: u.emp.cookie, body: { tasks: [{ t: 'أ' }], base: '' } });
  await call(env, 'PUT', Q, { cookie: u.emp.cookie, body: { ...sample(), base: '' } });
  const r = await call(env, 'GET', '/api/reports/monthly/list', { cookie: u.emp.cookie });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.months.map((m) => [m.month, m.tasks, m.meetings, m.plan]), [['2026-10', 2, 1, 1], ['2026-09', 1, 0, 0]]);
  assert.equal((await call(env, 'GET', '/api/reports/monthly/list?employee=2', { cookie: u.other.cookie })).status, 403);
});

test('canWriteReport: صاحب التقرير + الموارد البشرية + المسؤول فقط', () => {
  const t = { id: 2 };
  assert.equal(canWriteReport({ role: 'employee', employeeId: 2 }, t), true);
  assert.equal(canWriteReport({ role: 'employee', employeeId: 3 }, t), false);
  assert.equal(canWriteReport({ role: 'manager', employeeId: 1 }, t), false);
  assert.equal(canWriteReport({ role: 'director', employeeId: null }, t), false);
  assert.equal(canWriteReport({ role: 'hr', employeeId: 4 }, t), true);
  assert.equal(canWriteReport({ role: 'admin', employeeId: null }, t), true);
  assert.equal(canWriteReport(null, t), false);
});
