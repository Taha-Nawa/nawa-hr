import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';
import { validateEntry, LIMITS } from '../src/engine/work-log.js';

const TODAY = '2026-11-02';

test('تحقق السطر: القيم الافتراضية والحقول حسب النوع', () => {
  const done = validateEntry({ kind: 'done', date: TODAY, title: '  صيانة جهاز  ', details: ' تأخر القطع ' }, TODAY);
  assert.deepEqual(done.value, { date: TODAY, kind: 'done', title: 'صيانة جهاز', status: 'تم الإنجاز', details: 'تأخر القطع', place: null, importance: null, endDate: null });
  const meet = validateEntry({ kind: 'meeting', date: '2026-11-01', title: 'اجتماع', place: ' online ', details: 'ملخص', status: 'يُهمل', importance: 'يُهمل' }, TODAY);
  assert.deepEqual(meet.value, { date: '2026-11-01', kind: 'meeting', title: 'اجتماع', status: null, details: 'ملخص', place: 'online', importance: null, endDate: null });
  const training = validateEntry({ kind: 'training', date: TODAY, title: 'تدريب خارجي' }, TODAY);
  assert.equal(training.ok, true);
  assert.equal(training.value.place, null);
  const todo = validateEntry({ kind: 'todo', date: '2026-11-10', title: 'مهمة', endDate: '2026-11-30' }, TODAY);
  assert.deepEqual(todo.value, { date: '2026-11-10', kind: 'todo', title: 'مهمة', status: null, details: null, place: null, importance: 'مهم', endDate: '2026-11-30' });
});

test('تحقق السطر: الأخطاء', () => {
  const err = (i) => validateEntry(i, TODAY).error;
  assert.match(err({ kind: 'x', date: TODAY, title: 'أ' }), /نوع السطر/);
  assert.match(err({ kind: 'done', date: TODAY, title: '  ' }), /اكتب نص السطر/);
  assert.match(err({ kind: 'done', date: 'غد', title: 'أ' }), /التاريخ غير صالح/);
  assert.match(err({ kind: 'done', date: '2026-11-03', title: 'أ' }), /لم يأتِ بعد/);
  assert.match(err({ kind: 'meeting', date: '2026-11-03', title: 'أ' }), /لم يأتِ بعد/);
  assert.equal(validateEntry({ kind: 'todo', date: '2026-11-03', title: 'أ' }, TODAY).ok, true); // المهمة القادمة يجوز أن تكون لاحقة
  assert.match(err({ kind: 'todo', date: '2026-11-10', title: 'أ', endDate: '2026-11-01' }), /قبل تاريخ البدء/);
  assert.match(err({ kind: 'todo', date: '2026-11-10', title: 'أ', endDate: 'x' }), /تاريخ الانتهاء غير صالح/);
  assert.equal(validateEntry({ kind: 'done', date: TODAY, title: 'ا'.repeat(1000) }, TODAY).value.title.length, LIMITS.title);
});

async function world() {
  const { db, env } = await apiEnv();
  env.__NOW = '2026-11-02T07:00:00Z';
  await seedOrg(db);
  return {
    db, env,
    e2: await login(db, 'e2@nawaculture.org', 'employee', 2),
    e3: await login(db, 'e3@nawaculture.org', 'employee', 3),
    mgr: await login(db, 'm@nawaculture.org', 'manager', 1),
    hr: await login(db, 'hr@nawaculture.org', 'hr', null),
    adm: await login(db, 'a@nawaculture.org', 'admin', null),
  };
}
const j = (env, who, method, path, body) => call(env, method, path, { cookie: who.cookie, body });

test('إضافة وقراءة السجل الشهري بترتيب التاريخ، وللمالك فقط', async () => {
  const { env, e2, e3, mgr, adm } = await world();
  const add = (who, b) => j(env, who, 'POST', '/api/work-log', b);
  const a = await add(e2, { kind: 'done', date: '2026-11-02', title: 'إنجاز اليوم' });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.entry.status, 'تم الإنجاز');
  await add(e2, { kind: 'meeting', date: '2026-11-01', title: 'اجتماع الأحد', place: 'قاعة' });
  await add(e2, { kind: 'todo', date: '2026-11-15', title: 'قادمة', endDate: '2026-11-30' });
  await add(e2, { kind: 'done', date: '2026-10-31', title: 'من الشهر الماضي' });
  await add(e3, { kind: 'done', date: '2026-11-02', title: 'سطر الزميل' });
  const list = await j(env, e2, 'GET', '/api/work-log?month=2026-11');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.entries.map((x) => x.title), ['اجتماع الأحد', 'إنجاز اليوم', 'قادمة']);
  assert.equal(list.body.entries[2].endDate, '2026-11-30');
  assert.equal((await j(env, e2, 'GET', '/api/work-log?month=2026-10')).body.entries.length, 1);
  assert.deepEqual((await j(env, e3, 'GET', '/api/work-log?month=2026-11')).body.entries.map((x) => x.title), ['سطر الزميل']);
  // المدير والمسؤول بلا ربط بموظف لا يملكان سجلاً ولا يريان سجلات الآخرين
  assert.equal((await j(env, adm, 'GET', '/api/work-log?month=2026-11')).status, 403);
  assert.deepEqual((await j(env, mgr, 'GET', '/api/work-log?month=2026-11')).body.entries, []);
  assert.equal((await j(env, e2, 'GET', '/api/work-log?month=2026-1')).status, 400);
  assert.equal((await add(e2, { kind: 'done', date: '2026-11-05', title: 'مستقبل' })).status, 400);
  assert.equal((await add(adm, { kind: 'done', date: TODAY_, title: 'x' })).status, 403);
});
const TODAY_ = '2026-11-02';

test('التعديل والحذف: لصاحب السطر فقط', async () => {
  const { env, e2, e3, mgr, hr } = await world();
  const id = (await j(env, e2, 'POST', '/api/work-log', { kind: 'done', date: TODAY_, title: 'أصل', details: 'ملاحظة' })).body.entry.id;
  const patch = await j(env, e2, 'PATCH', `/api/work-log/${id}`, { title: 'معدَّل', status: 'قيد التنفيذ' });
  assert.equal(patch.status, 200, JSON.stringify(patch.body));
  assert.equal(patch.body.entry.title, 'معدَّل');
  assert.equal(patch.body.entry.status, 'قيد التنفيذ');
  assert.equal(patch.body.entry.details, 'ملاحظة');
  // تغيير النوع: تُهمل الحقول غير المناسبة
  const asMeeting = await j(env, e2, 'PATCH', `/api/work-log/${id}`, { kind: 'meeting', place: 'online' });
  assert.equal(asMeeting.body.entry.status, null);
  assert.equal(asMeeting.body.entry.place, 'online');
  assert.equal((await j(env, e2, 'PATCH', `/api/work-log/${id}`, { title: '' })).status, 400);
  for (const who of [e3, mgr, hr]) {
    assert.equal((await j(env, who, 'PATCH', `/api/work-log/${id}`, { title: 'اختراق' })).status, who === e3 || who === mgr ? 403 : 403);
    assert.equal((await j(env, who, 'DELETE', `/api/work-log/${id}`)).status, 403);
  }
  assert.equal((await j(env, e2, 'DELETE', `/api/work-log/${id}`)).status, 200);
  assert.equal((await j(env, e2, 'DELETE', `/api/work-log/${id}`)).status, 404);
  assert.equal((await j(env, e2, 'PATCH', '/api/work-log/999', { title: 'x' })).status, 404);
  assert.deepEqual((await j(env, e2, 'GET', '/api/work-log?month=2026-11')).body.entries, []);
});

test('تعديل مهمة قادمة يُبقي تاريخ انتهائها', async () => {
  const { env, e2 } = await world();
  const id = (await j(env, e2, 'POST', '/api/work-log', { kind: 'todo', date: '2026-11-10', title: 'مهمة', endDate: '2026-11-30' })).body.entry.id;
  const p = await j(env, e2, 'PATCH', `/api/work-log/${id}`, { importance: 'مهم جداً' });
  assert.equal(p.body.entry.endDate, '2026-11-30');
  assert.equal(p.body.entry.importance, 'مهم جداً');
});

test('السجل والمسودات لا يدخلان النسخة الاحتياطية، والمقدَّم يدخل', async () => {
  const { env, e2, e3, adm } = await world();
  await j(env, e2, 'POST', '/api/work-log', { kind: 'done', date: TODAY_, title: 'سطر خاص لا يُنسخ' });
  const body = (extra) => ({ tasks: [{ title: 'مهمة التقرير', status: 'تم الإنجاز' }], meetings: [], next: [], attachments: [], ...extra });
  assert.equal((await j(env, e2, 'PUT', '/api/monthly-reports/2/2026-10', body({ status: 'draft' }))).status, 200);
  assert.equal((await j(env, e3, 'PUT', '/api/monthly-reports/3/2026-10', body({ status: 'submitted' }))).status, 200);
  const man = await j(env, adm, 'GET', '/api/backup/manifest');
  assert.equal(man.body.tables.some((t) => t.name === 'work_log'), false);
  assert.equal(man.body.tables.find((t) => t.name === 'monthly_reports').rows, 1);
  const page = await j(env, adm, 'GET', '/api/backup/table?name=monthly_reports');
  assert.equal(page.body.rows.length, 1);
  assert.equal((await j(env, adm, 'GET', '/api/backup/table?name=work_log')).status, 400);
  assert.ok(!JSON.stringify(page.body).includes('سطر خاص'));
});

test('نقل سطر إلى شهر ممتلئ يُرفض (سقف الشهر الجديد)', async () => {
  const { db, env, e2 } = await world();
  await db.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 600) INSERT INTO work_log (employee_id, date, kind, title) SELECT 2, '2026-10-15', 'done', 'x' || i FROM n").run();
  const id = (await j(env, e2, 'POST', '/api/work-log', { kind: 'done', date: TODAY_, title: 'سطر نوفمبر' })).body.entry.id;
  const r = await j(env, e2, 'PATCH', `/api/work-log/${id}`, { date: '2026-10-20' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /الحد الأقصى/);
  assert.equal((await j(env, e2, 'POST', '/api/work-log', { kind: 'done', date: '2026-10-21', title: 'زائد' })).status, 400);
  assert.equal((await j(env, e2, 'PATCH', `/api/work-log/${id}`, { title: 'يتعدل في مكانه' })).status, 200);
});

test('اقتراحات من الإدخالات السابقة: السجل أولاً ثم التقارير، بلا تكرار، ولصاحبها فقط', async () => {
  const { db, env, e2, e3, adm } = await world();
  const add = (b) => j(env, e2, 'POST', '/api/work-log', b);
  await add({ kind: 'done', date: '2026-10-20', title: 'إعداد  كشف الحضور', status: 'قيد التنفيذ' });
  await add({ kind: 'done', date: '2026-10-28', title: 'إعداد كشف الحضور', status: 'تم الإنجاز' });
  await add({ kind: 'done', date: '2026-10-28', title: 'إعداد كشف الحضور', status: 'قيد التنفيذ' });
  await add({ kind: 'meeting', date: '2026-10-29', title: 'اجتماع الإدارة', place: 'القاعة', details: 'ملخص لا يُقترح' });
  await add({ kind: 'todo', date: '2026-11-10', title: 'خطة الربع', importance: 'مهم جداً' });
  await db.prepare("INSERT INTO work_log (employee_id, date, kind, title) VALUES (2, '2026-01-05', 'done', 'أقدم من 120 يوماً')").run();
  await db.prepare("INSERT INTO monthly_reports (employee_id, month, status, body) VALUES (2, '2026-09', 'submitted', ?)")
    .bind(JSON.stringify({ tasks: [{ title: 'إعداد كشف الحضور', status: 'تم' }, { title: 'مهمة من تقرير أيلول', status: 'تم الإنجاز' }], meetings: [{ title: 'ورشة التخطيط', place: 'رام الله' }], next: [{ title: 'مهمة قادمة قديمة', importance: 'عادي' }] })).run();
  const r = await j(env, e2, 'GET', '/api/work-log/suggest');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = r.body.suggestions;
  const find = (kind, title) => s.find((x) => x.kind === kind && x.title === title);
  const att = find('done', 'إعداد كشف الحضور');
  assert.equal(att.source, 'log');
  assert.equal(att.count, 2, 'سطرا اليوم نفسه يُجمعان، وشكل العنوان بمسافتين يُدمج معهما');
  assert.equal(att.last, '2026-10-28');
  assert.equal(find('meeting', 'اجتماع الإدارة').place, 'القاعة');
  assert.equal(find('todo', 'خطة الربع').importance, 'مهم جداً');
  assert.equal(find('done', 'مهمة من تقرير أيلول').source, 'report');
  assert.equal(find('meeting', 'ورشة التخطيط').place, 'رام الله');
  assert.equal(find('todo', 'مهمة قادمة قديمة').source, 'report');
  assert.equal(s.filter((x) => x.kind === 'done' && x.title === 'إعداد كشف الحضور').length, 1, 'لا تكرار بين السجل والتقرير');
  assert.ok(!s.some((x) => x.title.includes('أقدم من 120')));
  assert.ok(!JSON.stringify(s).includes('ملخص لا يُقترح'));
  assert.deepEqual((await j(env, e3, 'GET', '/api/work-log/suggest')).body.suggestions, []);
  assert.equal((await j(env, adm, 'GET', '/api/work-log/suggest')).status, 403);
});

// ---------------------------------------------------------------- المشاركة مع المسؤولين (الشجرة الإدارية)
test('المشاركة: يراها من فوق الموظف في خطه فقط، والخاصة لا تظهر، والموارد البشرية والمسؤول لا يرونها بصفتهم', async () => {
  const { db, env, e2, e3, mgr, hr, adm } = await world();
  await db.prepare('UPDATE employees SET manager_id = 2 WHERE id = 4').run(); // 1 ← 2 ← 4، و3 تحت 1 في خط آخر
  const e4 = await login(db, 'e4@nawaculture.org', 'employee', 4);
  const add = (b) => j(env, e4, 'POST', '/api/work-log', { kind: 'done', date: '2026-11-02', ...b });
  const shared = (await add({ title: 'مشاركة افتراضياً' })).body.entry;
  assert.equal(shared.shared, true);
  const priv = (await add({ title: 'خاص', shared: false })).body.entry;
  assert.equal(priv.shared, false);
  const team = (who) => j(env, who, 'GET', '/api/work-log/team?month=2026-11');
  for (const who of [e2, mgr]) {
    const t = await team(who);
    assert.deepEqual(t.body.entries.map((x) => x.title), ['مشاركة افتراضياً'], 'المباشر وغير المباشر');
    assert.equal(t.body.members.some((m) => m.id === 4), true);
  }
  for (const who of [e3, hr, adm]) assert.deepEqual((await team(who)).body.entries, [], 'خط آخر أو بلا صفة إدارية');
  assert.equal((await team(e4)).body.members.length, 0, 'لا مرؤوسين');
  // الملاحظات: لمن فوقه فقط وللمشاركة فقط
  assert.equal((await j(env, e3, 'POST', `/api/work-log/${shared.id}/notes`, { note: 'x' })).status, 403);
  assert.equal((await j(env, mgr, 'POST', `/api/work-log/${priv.id}/notes`, { note: 'x' })).status, 404);
  assert.equal((await j(env, mgr, 'POST', `/api/work-log/${shared.id}/notes`, { note: '  ' })).status, 400);
  const n = await j(env, mgr, 'POST', `/api/work-log/${shared.id}/notes`, { note: 'وضّح النتيجة' });
  assert.equal(n.status, 201);
  let mine = (await j(env, e4, 'GET', '/api/work-log?month=2026-11')).body.entries.find((x) => x.id === shared.id);
  assert.equal(mine.notes[0].status, 'open');
  assert.equal(mine.notes[0].author, 'المديرة');
  // تعديل شكلي للمشاركة وحدها لا يعني معالجة الملاحظة
  await j(env, e4, 'PATCH', `/api/work-log/${shared.id}`, { shared: true });
  mine = (await j(env, e4, 'GET', '/api/work-log?month=2026-11')).body.entries.find((x) => x.id === shared.id);
  assert.equal(mine.notes[0].status, 'open');
  // تعديل المحتوى ← «تم التعديل»
  await j(env, e4, 'PATCH', `/api/work-log/${shared.id}`, { title: 'مشاركة افتراضياً — موضّحة' });
  mine = (await j(env, e4, 'GET', '/api/work-log?month=2026-11')).body.entries.find((x) => x.id === shared.id);
  assert.equal(mine.notes[0].status, 'addressed');
  const seen = (await team(mgr)).body;
  assert.equal(seen.entries[0].notes[0].status, 'addressed');
  assert.equal(seen.members.find((m) => m.id === 4).toReview, 1);
  // الاعتماد: كاتب الملاحظة وحده
  assert.equal((await j(env, e2, 'POST', `/api/work-log-notes/${n.body.id}/close`)).status, 403);
  assert.equal((await j(env, mgr, 'POST', `/api/work-log-notes/${n.body.id}/close`)).status, 200);
  assert.equal((await team(mgr)).body.entries[0].notes[0].status, 'closed');
  // الردّ دون تعديل
  const n2 = await j(env, mgr, 'POST', `/api/work-log/${shared.id}/notes`, { note: 'ملاحظة ثانية' });
  assert.equal((await j(env, e3, 'POST', `/api/work-log/${shared.id}/addressed`, { reply: 'x' })).status, 403);
  assert.equal((await j(env, e4, 'POST', `/api/work-log/${shared.id}/addressed`, { reply: 'تم التوضيح شفهياً' })).status, 200);
  assert.equal((await team(mgr)).body.entries[0].notes.find((x) => x.id === n2.body.id).reply, 'تم التوضيح شفهياً');
  // إلغاء المشاركة يخفيه عن المسؤول، وحذفه يحذف ملاحظاته
  await j(env, e4, 'PATCH', `/api/work-log/${shared.id}`, { shared: false });
  assert.deepEqual((await team(mgr)).body.entries, []);
  assert.equal((await j(env, e4, 'DELETE', `/api/work-log/${shared.id}`)).status, 200);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM work_log_notes').first('n'), 0);
});
