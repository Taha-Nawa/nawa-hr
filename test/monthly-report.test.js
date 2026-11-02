import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';
import { validateReport, monthBounds, prevMonth, parseBody, emptyBody, LIMITS } from '../src/engine/monthly-report.js';

const M = '2026-10';

test('حدود الشهر والشهر السابق', () => {
  assert.deepEqual(monthBounds('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(monthBounds('2024-02'), { from: '2024-02-01', to: '2024-02-29' });
  assert.equal(prevMonth('2026-01'), '2025-12');
  assert.equal(prevMonth('2026-11'), '2026-10');
});

test('التحقق: تُحذف الأسطر الفارغة ويُقصّ النص وتُوحَّد نهايات الأسطر', () => {
  const r = validateReport({
    tasks: [{ title: '  إعداد التقرير ', status: 'تم الإنجاز' }, { title: '', status: '', challenges: '' }, { title: 'سطر\r\nثانٍ' }],
    meetings: [{}], next: [{ title: ' x ', importance: 'مهم', start: '2026-11-01', end: '2026-11-30' }], attachments: ['  ملف  ', '', '  '],
  }, M);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.value.tasks, [{ title: 'إعداد التقرير', status: 'تم الإنجاز', challenges: '' }, { title: 'سطر\nثانٍ', status: '', challenges: '' }]);
  assert.deepEqual(r.value.meetings, []);
  assert.deepEqual(r.value.next, [{ title: 'x', importance: 'مهم', start: '2026-11-01', end: '2026-11-30' }]);
  assert.deepEqual(r.value.attachments, ['ملف']);
  assert.equal(validateReport({}, M).ok, true);
  assert.equal(validateReport(null, M).ok, true);
});

test('التحقق: رسائل الأخطاء تحدد القسم والسطر', () => {
  const err = (input) => validateReport(input, M).error;
  assert.match(err({ tasks: [{ title: 'أ' }, { status: 'تم' }] }), /المهام الرئيسية، السطر 2: اكتب نص المهمة/);
  assert.match(err({ meetings: [{ summary: 'ملخص' }] }), /الاجتماعات والنشاطات، السطر 1: اكتب عنوان/);
  assert.match(err({ meetings: [{ title: 'ا', date: '2026-10-32' }] }), /التاريخ غير صالح/);
  assert.match(err({ meetings: [{ title: 'ا', date: '2026-11-01' }] }), /خارج مدة التقرير/);
  assert.equal(validateReport({ meetings: [{ title: 'ا', date: '2026-10-31' }] }, M).ok, true);
  assert.match(err({ next: [{ title: 'ا', start: '2026-11-10', end: '2026-11-01' }] }), /تاريخ الانتهاء قبل تاريخ البدء/);
  assert.match(err({ next: [{ title: 'ا', start: 'غد' }] }), /المهام اللاحقة، السطر 1: التاريخ غير صالح/);
  assert.match(err({ tasks: Array.from({ length: LIMITS.tasks + 1 }, (_, i) => ({ title: `م${i}` })) }), /الحد الأقصى/);
  assert.match(err({ attachments: Array.from({ length: LIMITS.attachments + 1 }, (_, i) => `ملف${i}`) }), /المرفقات: الحد الأقصى/);
});

test('قراءة body تالف تعطي تقريراً فارغاً', () => {
  assert.deepEqual(parseBody('not json'), emptyBody());
  assert.deepEqual(parseBody(''), emptyBody());
  assert.deepEqual(parseBody('{"tasks":[{"title":"أ"}]}').tasks, [{ title: 'أ' }]);
});

async function world() {
  const { db, env } = await apiEnv();
  env.__NOW = '2026-11-02T07:00:00Z';
  await seedOrg(db);
  const w = {
    db, env,
    mgr: await login(db, 'm@nawaculture.org', 'manager', 1),
    e2: await login(db, 'e2@nawaculture.org', 'employee', 2),
    e3: await login(db, 'e3@nawaculture.org', 'employee', 3),
    e4: await login(db, 'e4@nawaculture.org', 'employee', 4),
    hr: await login(db, 'hr@nawaculture.org', 'hr', null),
    dir: await login(db, 'd@nawaculture.org', 'director', null),
    adm: await login(db, 'a@nawaculture.org', 'admin', null),
  };
  await db.prepare("UPDATE employees SET job_title = 'أخصائي', department = 'الإدارة والتدريب' WHERE id = 2").run();
  return w;
}
const j = (env, who, method, path, body) => call(env, method, path, { cookie: who.cookie, body });
const draft = { tasks: [{ title: 'إعداد التقرير', status: 'تم الإنجاز' }], meetings: [{ title: 'اجتماع', date: '2026-10-15', place: 'online' }], next: [{ title: 'مهمة قادمة', importance: 'مهم', start: '2026-11-01', end: '2026-11-30' }] };

test('الموظف يحفظ مسودته ويقرؤها بترويسة من بطاقته، ولا يراها غيره', async () => {
  const { env, e2, e3, mgr, hr, adm, dir } = await world();
  const put = await j(env, e2, 'PUT', `/api/monthly-reports/2/${M}`, draft);
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.status, 'draft');
  const g = await j(env, e2, 'GET', `/api/monthly-reports/2/${M}`);
  assert.equal(g.status, 200);
  assert.equal(g.body.own, true);
  assert.equal(g.body.canEdit, true);
  assert.equal(g.body.employee.jobTitle, 'أخصائي');
  assert.equal(g.body.employee.department, 'الإدارة والتدريب');
  assert.equal(g.body.report.tasks[0].title, 'إعداد التقرير');
  // المسودة خاصة: لا المدير ولا الموارد ولا المسؤول ولا زميل
  for (const who of [mgr, hr, adm, dir]) assert.equal((await j(env, who, 'GET', `/api/monthly-reports/2/${M}`)).status, 404);
  assert.equal((await j(env, e3, 'GET', `/api/monthly-reports/2/${M}`)).status, 403);
  // ولا يكتب أحد في تقرير غيره
  for (const who of [e3, mgr, hr, adm]) assert.equal((await j(env, who, 'PUT', `/api/monthly-reports/2/${M}`, draft)).status, 403);
});

test('التقديم: يشترط مهمة واحدة، ويضع تاريخ اليوم، ثم يراه المدير والموارد والمدير العام والمسؤول فقط', async () => {
  const { env, e2, e3, e4, mgr, hr, dir, adm } = await world();
  assert.equal((await j(env, e2, 'PUT', `/api/monthly-reports/2/${M}`, { ...draft, tasks: [], status: 'submitted' })).status, 400);
  const sub = await j(env, e2, 'PUT', `/api/monthly-reports/2/${M}`, { ...draft, status: 'submitted' });
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  assert.equal(sub.body.submitDate, '2026-11-02');
  for (const who of [mgr, hr, dir, adm]) {
    const g = await j(env, who, 'GET', `/api/monthly-reports/2/${M}`);
    assert.equal(g.status, 200);
    assert.equal(g.body.own, false);
    assert.equal(g.body.canEdit, false);
    assert.equal(g.body.report.status, 'submitted');
    assert.deepEqual(g.body.prevNext, []);
  }
  assert.equal((await j(env, e3, 'GET', `/api/monthly-reports/2/${M}`)).status, 403); // زميل
  assert.equal((await j(env, e4, 'GET', `/api/monthly-reports/2/${M}`)).status, 403);
  // يعيده لمسودة فيختفي عن المدير
  assert.equal((await j(env, e2, 'PUT', `/api/monthly-reports/2/${M}`, { ...draft, status: 'draft' })).status, 200);
  assert.equal((await j(env, mgr, 'GET', `/api/monthly-reports/2/${M}`)).status, 404);
});

test('ملاحظات المدير: المدير المباشر والموارد والمدير العام والمسؤول، لا صاحب التقرير ولا الزملاء، وللمُقدَّم فقط', async () => {
  const { env, e2, e3, mgr, hr, dir, adm } = await world();
  const notes = (who, notes_) => j(env, who, 'PATCH', `/api/monthly-reports/2/${M}/notes`, { notes: notes_ });
  assert.equal((await notes(mgr, 'قبل التقديم')).status, 400); // لا تقرير بعد
  await j(env, e2, 'PUT', `/api/monthly-reports/2/${M}`, { ...draft, status: 'submitted' });
  assert.equal((await notes(e2, 'يكتب لنفسه')).status, 403);
  assert.equal((await notes(e3, 'زميل')).status, 403);
  assert.equal((await notes(mgr, '  أحسنت  ')).status, 200);
  let g = await j(env, e2, 'GET', `/api/monthly-reports/2/${M}`);
  assert.equal(g.body.report.managerNotes, 'أحسنت');
  assert.equal(g.body.report.notesBy, 'm@nawaculture.org');
  for (const who of [hr, dir, adm]) assert.equal((await notes(who, 'ملاحظة')).status, 200);
  assert.equal((await notes(mgr, '')).status, 200); // مسح
  g = await j(env, mgr, 'GET', `/api/monthly-reports/2/${M}`);
  assert.equal(g.body.report.managerNotes, '');
  assert.equal(g.body.canReview, true);
  assert.equal((await j(env, e2, 'GET', `/api/monthly-reports/2/${M}`)).body.canReview, false);
});

test('إعادة الحفظ تُبقي ملاحظات المدير وتاريخ التقديم، وتاريخ التقديم يُتحقَّق منه', async () => {
  const { env, e2, mgr } = await world();
  await j(env, e2, 'PUT', `/api/monthly-reports/2/${M}`, { ...draft, status: 'submitted', submitDate: '2026-10-31' });
  await j(env, mgr, 'PATCH', `/api/monthly-reports/2/${M}/notes`, { notes: 'تمام' });
  const again = await j(env, e2, 'PUT', `/api/monthly-reports/2/${M}`, { ...draft, tasks: [...draft.tasks, { title: 'مهمة ثانية' }] });
  assert.equal(again.body.submitDate, '2026-10-31');
  assert.equal(again.body.status, 'submitted');
  const g = await j(env, e2, 'GET', `/api/monthly-reports/2/${M}`);
  assert.equal(g.body.report.managerNotes, 'تمام');
  assert.equal(g.body.report.tasks.length, 2);
  assert.equal((await j(env, e2, 'PUT', `/api/monthly-reports/2/${M}`, { ...draft, submitDate: 'x' })).status, 400);
  assert.equal((await j(env, e2, 'PUT', `/api/monthly-reports/2/${M}`, { ...draft, submitDate: '2026-09-30' })).status, 400);
});

test('لا تقرير لشهر لم يبدأ، ولا شهر أو معرّف غير صالح', async () => {
  const { env, e2 } = await world();
  assert.equal((await j(env, e2, 'PUT', '/api/monthly-reports/2/2026-12', draft)).status, 400);
  assert.equal((await j(env, e2, 'PUT', '/api/monthly-reports/2/2026-11', { ...draft, meetings: [] })).status, 200); // الشهر الحالي مسموح
  assert.equal((await j(env, e2, 'GET', '/api/monthly-reports/2/2026-13')).status, 400);
  assert.equal((await j(env, e2, 'GET', '/api/monthly-reports/x/2026-10')).status, 400);
  assert.equal((await j(env, e2, 'GET', '/api/monthly-reports/99/2026-10')).status, 404);
  assert.equal((await j(env, e2, 'PUT', `/api/monthly-reports/2/${M}`, { tasks: [{ status: 'تم' }] })).status, 400);
});

test('مهام الشهر السابق تصل إلى المحرّر (للمالك فقط)', async () => {
  const { env, e2, mgr } = await world();
  await j(env, e2, 'PUT', `/api/monthly-reports/2/${M}`, { ...draft, status: 'submitted' });
  const g = await j(env, e2, 'GET', '/api/monthly-reports/2/2026-11');
  assert.equal(g.status, 200);
  assert.equal(g.body.report.exists, false);
  assert.equal(g.body.prevNext.length, 1);
  assert.equal(g.body.prevNext[0].title, 'مهمة قادمة');
  assert.equal((await j(env, e2, 'PUT', '/api/monthly-reports/2/2026-11', { ...draft, meetings: [], status: 'submitted' })).status, 200);
  assert.deepEqual((await j(env, mgr, 'GET', '/api/monthly-reports/2/2026-11')).body.prevNext, []);
});

test('قائمة الشهر: كل دور يرى نطاقه، والمسودات مخفية عن غير أصحابها', async () => {
  const { env, e2, e3, e4, mgr, hr, dir } = await world();
  await j(env, e2, 'PUT', `/api/monthly-reports/2/${M}`, { ...draft, status: 'submitted' });
  await j(env, e3, 'PUT', `/api/monthly-reports/3/${M}`, draft); // مسودة
  const list = async (who) => (await j(env, who, 'GET', `/api/monthly-reports?month=${M}`)).body;
  const m = await list(mgr);
  assert.deepEqual(m.reports.map((r) => r.id).sort(), [1, 2, 3]); // نفسه ومرؤوساه
  const byId = Object.fromEntries(m.reports.map((r) => [r.id, r]));
  assert.equal(byId[2].status, 'submitted');
  assert.deepEqual(byId[2].counts, { tasks: 1, meetings: 1, next: 1 });
  assert.equal(byId[3].status, null); // مسودة الموظف ب لا تظهر للمدير
  assert.equal(byId[3].counts, null);
  assert.equal(byId[1].status, null);
  const own = await list(e3);
  assert.deepEqual(own.reports.map((r) => [r.id, r.status]), [[3, 'draft']]);
  assert.equal(own.mine, 3);
  assert.deepEqual((await list(e4)).reports.map((r) => r.id), [4]);
  assert.equal((await list(hr)).reports.length, 4);
  assert.equal((await list(dir)).reports.length, 4);
  assert.equal((await j(env, mgr, 'GET', '/api/monthly-reports?month=2026-1')).status, 400);
});

test('التقرير يدخل النسخة الاحتياطية', async () => {
  const { env, e2, adm } = await world();
  await j(env, e2, 'PUT', `/api/monthly-reports/2/${M}`, { ...draft, status: 'submitted' });
  const man = await j(env, adm, 'GET', '/api/backup/manifest');
  assert.equal(man.body.tables.find((t) => t.name === 'monthly_reports').rows, 1);
});
