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

test('تعديل مهمة قادمة يُبقي تاريخ انتهائها، والسجل يدخل النسخة الاحتياطية', async () => {
  const { env, e2, adm } = await world();
  const id = (await j(env, e2, 'POST', '/api/work-log', { kind: 'todo', date: '2026-11-10', title: 'مهمة', endDate: '2026-11-30' })).body.entry.id;
  const p = await j(env, e2, 'PATCH', `/api/work-log/${id}`, { importance: 'مهم جداً' });
  assert.equal(p.body.entry.endDate, '2026-11-30');
  assert.equal(p.body.entry.importance, 'مهم جداً');
  const man = await j(env, adm, 'GET', '/api/backup/manifest');
  assert.equal(man.body.tables.find((t) => t.name === 'work_log').rows, 1);
});
