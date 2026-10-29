import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker/index.js';
import { closeDay, recomputeSlice, eligible, SLICE } from '../src/worker/close.js';
import { localDate, addDays } from '../src/worker/util.js';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';
import { golden, mv, setWork } from './helpers/seed.js';

const body = (rows) => ({ rows });

test('استيراد الموظفين: ينشئ المراكز، يحدّث الموجود، يرفض السيئ بسببه، ويضيف البطاقات', async () => {
  const { db, env } = await apiEnv();
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  const r1 = await call(env, 'POST', '/api/import/employees', {
    cookie: hr.cookie,
    body: body([
      { code: 'NW-101', name: 'منى', center: 'مكتبة الخضر', jobTitle: 'أمينة مكتبة', department: 'المكتبة', contractType: 'عقد جزئي', project: 'الإدارة العامة', managerLabel: 'مدير المكتبة', startDate: '2022-09-01', card: 'NW-101-A' },
      { code: 'NW-102', name: 'سامي', center: 'حدائق نوى - البيارة' },
      { code: 'NW-102', name: 'مكرر في الملف' },
      { code: '', name: 'بلا كود' },
      { code: 'NW-103', name: 'ا' },
      { code: 'NW-104', name: 'بريد سيئ', email: 'oops' },
    ]),
  });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.imported, 2);
  assert.deepEqual(r1.body.rejected.map((x) => x.reason), ['كود مكرر في الملف', 'كود غير صالح', 'اسم مفقود', 'بريد غير صالح']);

  const emp = await db.prepare("SELECT e.*, c.name AS center FROM employees e JOIN centers c ON c.id = e.center_id WHERE code = 'NW-101'").first();
  assert.equal(emp.center, 'مكتبة الخضر');
  assert.equal(emp.job_title, 'أمينة مكتبة');
  assert.equal(emp.project, 'الإدارة العامة');
  assert.equal(emp.start_date, '2022-09-01');
  assert.equal(await db.prepare("SELECT status FROM badges WHERE card = 'NW-101-A'").first('status'), 'active');

  // إعادة الاستيراد تحدّث ولا تكرّر ولا تعيد تفعيل موظف موقوف
  await db.prepare("UPDATE employees SET status = 'inactive' WHERE code = 'NW-101'").run();
  const r2 = await call(env, 'POST', '/api/import/employees', { cookie: hr.cookie, body: body([{ code: 'NW-101', name: 'منى (محدّث)', center: 'مكتبة الخضر', jobTitle: 'رئيسة المكتبة', card: 'NW-101-A' }]) });
  assert.equal(r2.body.imported, 1);
  const again = await db.prepare("SELECT name, job_title, status, start_date FROM employees WHERE code = 'NW-101'").first();
  assert.deepEqual(again, { name: 'منى (محدّث)', job_title: 'رئيسة المكتبة', status: 'inactive', start_date: '2022-09-01' });
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM employees').first('n'), 2);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM badges').first('n'), 1);
  assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM centers WHERE name = 'مكتبة الخضر'").first('n'), 1, 'المركز لا يتكرر');

  // حدود الدفعة
  assert.equal((await call(env, 'POST', '/api/import/employees', { cookie: hr.cookie, body: body([]) })).status, 400);
  assert.equal((await call(env, 'POST', '/api/import/employees', { cookie: hr.cookie, body: body(new Array(101).fill({ code: 'A-1', name: 'xx' })) })).status, 400);
});

test('استيراد الحركات: يمرّ عبر نفس مسار البوابة (منع تكرار، حساب الأيام) ويُسجَّل جهازه IMPORT', async () => {
  const { db, env } = await apiEnv();
  await seedOrg(db);
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  const rows = [mv('NW-002', 'حضور', '2026-03-02', '08:20'), mv('NW-002', 'انصراف', '2026-03-02', '15:00'), mv('NW-999', 'حضور', '2026-03-02', '09:00', { card: 'ZZZ' })];
  const r = await call(env, 'POST', '/api/import/movements', { cookie: hr.cookie, body: body(rows) });
  assert.equal(r.status, 200);
  assert.equal(r.body.saved, 3);
  assert.equal(r.body.unmatched, 1);
  assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM movements WHERE device_id = 'IMPORT'").first('n'), 3);
  assert.equal(await db.prepare("SELECT net_hours FROM daily_results WHERE employee_id = 2").first('net_hours'), 6.67);

  const dup = await call(env, 'POST', '/api/import/movements', { cookie: hr.cookie, body: body(rows) });
  assert.equal(dup.body.saved, 0);
  assert.equal(dup.body.skipped, 3);
});

test('العطل: حفظ سنة كاملة بالاستبدال، التحقق، وتأثيرها على حساب اليوم', async () => {
  const { db, env } = await apiEnv();
  await seedOrg(db);
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  const put = (b) => call(env, 'PUT', '/api/holidays', { cookie: hr.cookie, body: b });

  assert.equal((await put({ year: 2026, holidays: [{ date: '2026-03-20', name: 'عيد الفطر' }, { date: '2026-03-21', name: 'عيد الفطر 2' }] })).body.count, 2);
  assert.equal((await put({ year: 2026, holidays: [{ date: '2026-03-20', name: 'عيد الفطر' }] })).body.count, 1, 'الاستبدال لا الإضافة');
  assert.equal((await call(env, 'GET', '/api/holidays?year=2026', { cookie: hr.cookie })).body.holidays.length, 1);
  assert.equal((await put({ year: 2026, holidays: [{ date: '2025-12-31' }] })).status, 400, 'خارج السنة');
  assert.equal((await put({ year: 2026, holidays: [{ date: '2026-02-30' }] })).status, 400);
  assert.equal((await put({ year: 2026, holidays: [{ date: '2026-03-20' }, { date: '2026-03-20' }] })).status, 400, 'مكرر');
  assert.equal((await put({ year: 1999, holidays: [] })).status, 400);
  assert.equal((await call(env, 'GET', '/api/holidays?year=2026', { cookie: hr.cookie })).body.holidays.length, 1, 'الفشل لا يمسح شيئاً');

  await setWork(db, golden.settings);
  const { gatePost } = await import('./helpers/seed.js');
  const dev = (await call(env, 'POST', '/api/devices', { cookie: (await login(db, 'a@nawaculture.org', 'admin')).cookie, body: { id: 'DEV-04' } })).body.token;
  await gatePost(env, [mv('NW-002', 'حضور', '2026-03-20', '09:00', { id: 'h1' }), mv('NW-002', 'انصراف', '2026-03-20', '12:00', { id: 'h2' })], dev);
  const row = await db.prepare("SELECT day_type, status, overtime_hours FROM daily_results WHERE date = '2026-03-20'").first();
  assert.deepEqual(row, { day_type: 'عطلة رسمية', status: 'عطلة رسمية', overtime_hours: 3 }, 'حضور في عطلة = إضافي كما في إكسل');
});

test('لوحة اليوم: كل دور يرى نطاقه فقط، والموظف بلا نتيجة يظهر فارغاً', async () => {
  const { db, env } = await apiEnv();
  await seedOrg(db);
  const hr = await login(db, 'hr@nawaculture.org', 'hr', 4);
  const mgr = await login(db, 'mgr@nawaculture.org', 'manager', 1);
  const emp = await login(db, 'emp@nawaculture.org', 'employee', 2);
  const adm = await login(db, 'adm@nawaculture.org', 'admin');
  const dev = (await call(env, 'POST', '/api/devices', { cookie: adm.cookie, body: { id: 'DEV-05' } })).body.token;
  const { gatePost } = await import('./helpers/seed.js');
  await gatePost(env, [mv('NW-002', 'حضور', '2026-03-02', '08:40')], dev);

  const day = (who) => call(env, 'GET', '/api/day?date=2026-03-02', { cookie: who.cookie });
  const all = await day(hr);
  assert.equal(all.body.rows.length, 4);
  const a = all.body.rows.find((r) => r.code === 'NW-002');
  assert.equal(a.status, 'حاضر');
  assert.equal(a.checkIn, '08:40');
  assert.equal(a.alert, 'انصراف غير مسجّل');
  assert.equal(all.body.rows.find((r) => r.code === 'NW-003').status, null, 'لا نتيجة بعد');

  assert.deepEqual((await day(mgr)).body.rows.map((r) => r.code), ['NW-001', 'NW-002', 'NW-003']);
  assert.deepEqual((await day(emp)).body.rows.map((r) => r.code), ['NW-002']);
  assert.equal((await call(env, 'GET', '/api/day?date=bad', { cookie: hr.cookie })).status, 400);
});

test('الإقفال الليلي: يكتب الغياب والعطلة الأسبوعية لكل فعّال، ويحترم التعيين وانتهاء الخدمة، ويكرَّر بأمان', async () => {
  const { db, env } = await apiEnv();
  await seedOrg(db);
  await db.prepare("UPDATE employees SET start_date = '2026-03-10' WHERE id = 3").run(); // عُيّنت بعد اليوم المطلوب
  await db.prepare("UPDATE employees SET end_date = '2026-02-28' WHERE id = 4").run(); // انتهت خدمته قبله
  await db.prepare("UPDATE employees SET status = 'inactive' WHERE id = 1").run();
  // إعدادات golden: الجمعة والسبت والخميس عطلة. 2026-03-02 الاثنين = عمل، 2026-03-05 الخميس = عطلة
  const r = await closeDay(env, '2026-03-02');
  assert.deepEqual(r, { date: '2026-03-02', employees: 1 });
  assert.deepEqual(
    (await db.prepare('SELECT employee_id, status, deficit_hours FROM daily_results').all()).results,
    [{ employee_id: 2, status: 'غياب', deficit_hours: 6.5 }],
  );
  await closeDay(env, '2026-03-02'); // مرتين
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM daily_results').first('n'), 1);

  await closeDay(env, '2026-03-05');
  assert.equal(await db.prepare("SELECT status FROM daily_results WHERE employee_id = 2 AND date = '2026-03-05'").first('status'), 'عطلة أسبوعية');

  assert.ok(await db.prepare("SELECT 1 AS x FROM audit_log WHERE action = 'close-day'").first());
  assert.equal(eligible({ start_date: null, end_date: null }, '2026-01-01'), true);
  assert.equal(eligible({ start_date: '2026-03-10', end_date: null }, '2026-03-09'), false);
});

test('الإقفال الليلي لا يخمّن: بلا إعدادات لا يكتب شيئاً', async () => {
  const { db, env } = await apiEnv();
  await seedOrg(db);
  await db.prepare("DELETE FROM settings").run();
  assert.deepEqual(await closeDay(env, '2026-03-02'), { date: '2026-03-02', skipped: 'settings_missing' });
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM daily_results').first('n'), 0);
});

test('مهمة cron المجدولة تعمل على «أمس» بتوقيت فلسطين', async () => {
  const { db, env } = await apiEnv();
  await seedOrg(db);
  const pending = [];
  await worker.scheduled({}, env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  const yesterday = addDays(localDate('Asia/Hebron'), -1);
  const dates = (await db.prepare('SELECT DISTINCT date FROM daily_results').all()).results.map((r) => r.date);
  assert.deepEqual(dates, [yesterday]);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM daily_results').first('n'), 4);
});

test('الإقفال لـ 250 موظفاً ضمن حدود D1 (≤ 50 استعلاماً) وبزمن معقول', async () => {
  const { db, env } = await apiEnv();
  for (let i = 1; i <= 250; i++) {
    db.raw.exec(`INSERT INTO employees (id, code, name, center_id) VALUES (${i}, 'NW-${String(i).padStart(3, '0')}', 'موظف ${i}', 1)`);
  }
  db.resetCount();
  const t = performance.now();
  const r = await closeDay(env, '2026-03-02');
  const ms = performance.now() - t;
  assert.equal(r.employees, 250);
  assert.ok(db.queries <= 25, `استعلامات الإقفال: ${db.queries}`);
  assert.ok(ms < 500, `${ms.toFixed(0)}ms`);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM daily_results').first('n'), 250);
});

test('إعادة الحساب بشرائح: تمرّ على كل (موظف × يوم) مرة واحدة، لا تتجاوز اليوم، وتحترم التعيين', async () => {
  const { db, env } = await apiEnv();
  await seedOrg(db);
  await db.prepare("UPDATE employees SET start_date = '2026-03-04' WHERE id = 3").run();
  const from = '2026-03-01';
  const to = '2026-03-31';
  let offset = 0;
  let calls = 0;
  let total = 0;
  for (;;) {
    const r = await recomputeSlice(env, { from, to, offset });
    calls++;
    total = r.total;
    assert.ok(r.processed <= SLICE);
    if (r.nextOffset === null) break;
    offset = r.nextOffset;
  }
  assert.equal(total, 4 * 31);
  assert.equal(calls, Math.ceil((4 * 31) / SLICE));
  // الموظف 3 لا نتائج له قبل 4 آذار
  assert.equal(await db.prepare('SELECT MIN(date) AS d FROM daily_results WHERE employee_id = 3').first('d'), '2026-03-04');
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM daily_results WHERE employee_id = 2').first('n'), 31);

  // مدى يمتد للمستقبل يُقصّ عند اليوم
  const future = await recomputeSlice(env, { from: addDays(localDate('Asia/Hebron'), -1), to: '2099-01-01', offset: 0 });
  assert.equal(future.total, 4 * 2);
});

test('POST /api/recompute: يتحقق من المدخلات ويكتب التدقيق مرة واحدة (في الشريحة الأولى)', async () => {
  const { db, env } = await apiEnv();
  await seedOrg(db);
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  const post = (b) => call(env, 'POST', '/api/recompute', { cookie: hr.cookie, body: b });
  assert.equal((await post({ from: '2026-03-05', to: '2026-03-01' })).status, 400);
  assert.equal((await post({ from: '2024-01-01', to: '2026-03-01' })).status, 400, 'أكثر من 366 يوماً');
  assert.equal((await post({ from: '2026-03-01', to: '2026-03-02', offset: -5 })).status, 400);

  const first = await post({ from: '2026-03-01', to: '2026-03-02' });
  assert.equal(first.status, 200);
  assert.equal(first.body.nextOffset, null);
  assert.equal(first.body.written, 8);
  assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'recompute'").first('n'), 1);

  await db.prepare('DELETE FROM settings').run();
  assert.equal((await post({ from: '2026-03-01', to: '2026-03-02' })).status, 409, 'لا إعدادات');
});
