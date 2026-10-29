import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call, seedOrg, addUser } from './helpers/api.js';
import { gatePost, gateGet, mv } from './helpers/seed.js';
import { COOKIE } from '../src/worker/auth.js';

const settings = { start: '08:30', end: '15:00', toleranceMinutes: 10, weekdays: ['عمل', 'عمل', 'عمل', 'عمل', 'عمل', 'عطلة أسبوعية', 'عطلة أسبوعية'], leaveTypes: { 'إجازة سنوية': true, 'إجازة بدون راتب': false } };

test('إنشاء موظف مع بطاقة، ومنع تكرار الكود والبريد والبطاقة، ومراجع غير موجودة', async () => {
  const { db, env } = await apiEnv();
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  const ok = await call(env, 'POST', '/api/employees', { cookie: hr.cookie, body: { code: 'NW-010', name: 'ليلى', email: 'Layla@nawaculture.org', card: 'NW-010-A', centerId: 2 } });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.employee.center, 'مركز الزيتونة');
  assert.equal(await db.prepare("SELECT status FROM badges WHERE card = 'NW-010-A'").first('status'), 'active');

  const dupCode = await call(env, 'POST', '/api/employees', { cookie: hr.cookie, body: { code: 'NW-010', name: 'أخرى' } });
  const dupMail = await call(env, 'POST', '/api/employees', { cookie: hr.cookie, body: { code: 'NW-011', name: 'أخرى', email: 'layla@nawaculture.org' } });
  const dupCard = await call(env, 'POST', '/api/employees', { cookie: hr.cookie, body: { code: 'NW-012', name: 'أخرى', card: 'NW-010-A' } });
  assert.deepEqual([dupCode.status, dupMail.status, dupCard.status], [409, 409, 409]);
  assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM employees WHERE code IN ('NW-011','NW-012')").first('n'), 0, 'الدفعة كلها تُلغى عند الفشل (لا موظف بلا بطاقته)');

  const badRef = await call(env, 'POST', '/api/employees', { cookie: hr.cookie, body: { code: 'NW-013', name: 'س', centerId: 99 } });
  assert.equal(badRef.status, 400);

  for (const body of [{ name: 'بلا كود' }, { code: 'x', name: 'كود قصير' }, { code: 'NW-014', name: 'ا' }, { code: 'NW-015', name: 'بريد', email: 'not-an-email' }, { code: 'has space', name: 'كود فيه فراغ' }]) {
    assert.equal((await call(env, 'POST', '/api/employees', { cookie: hr.cookie, body })).status, 400, JSON.stringify(body));
  }
});

test('تعديل الموظف: حقول مسموحة فقط، وإيقافه يُخرجه من قائمة البوابة', async () => {
  const { db, env } = await apiEnv();
  await seedOrg(db);
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  const adm = await login(db, 'adm@nawaculture.org', 'admin');
  const dev = await call(env, 'POST', '/api/devices', { cookie: adm.cookie, body: { id: 'dev-9' } });

  const patch = (id, body) => call(env, 'PATCH', `/api/employees/${id}`, { cookie: hr.cookie, body });
  assert.equal((await patch(3, { name: 'اسم جديد', centerId: 2 })).status, 200);
  assert.equal((await patch(3, { code: 'HACK' })).status, 400, 'الكود غير قابل للتعديل');
  assert.equal((await patch(3, { id: 77 })).status, 400);
  assert.equal((await patch(3, { status: 'deleted' })).status, 400);
  assert.equal((await patch(3, { photo: 'javascript:alert(1)' })).status, 400, 'روابط الصور https فقط');
  assert.equal((await patch(3, { startDate: '2026-02-31' })).status, 400);
  assert.equal((await patch(3, {})).status, 400);
  assert.equal((await patch(999, { name: 'لا أحد' })).status, 404);
  assert.equal((await patch(3, { centerId: 99 })).status, 400, 'مركز غير موجود');

  const before = await gateGet(env, `action=badges&token=${dev.body.token}`);
  assert.equal(before.body.count, 4);
  assert.equal((await patch(3, { status: 'inactive' })).status, 200);
  const after = await gateGet(env, `action=badges&token=${dev.body.token}`);
  assert.equal(after.body.count, 3, 'الموظف الموقوف لا يصل إلى البوابات');
});

test('سلسلة المديرين: لا ذات ولا حلقة', async () => {
  const { db, env } = await apiEnv();
  await seedOrg(db); // 2 و3 تحت 1
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  const patch = (id, body) => call(env, 'PATCH', `/api/employees/${id}`, { cookie: hr.cookie, body });
  assert.equal((await patch(1, { managerId: 1 })).status, 400, 'مدير نفسه');
  assert.equal((await patch(1, { managerId: 2 })).status, 400, 'المديرة تحت مرؤوسها');
  await db.prepare('UPDATE employees SET manager_id = 2 WHERE id = 4').run(); // 4 تحت 2 تحت 1
  assert.equal((await patch(1, { managerId: 4 })).status, 400, 'حلقة غير مباشرة');
  assert.equal((await patch(3, { managerId: 4 })).status, 200, 'تعيين سليم');
  assert.equal((await patch(3, { managerId: null })).status, 200);
});

test('دورة حياة جهاز البوابة: رمز يظهر مرة واحدة، يعمل على البوابة، يُدوَّر فيبطل القديم، ويُعطَّل', async () => {
  const { db, env } = await apiEnv();
  await seedOrg(db);
  const adm = await login(db, 'adm@nawaculture.org', 'admin');

  const made = await call(env, 'POST', '/api/devices', { cookie: adm.cookie, body: { id: 'dev-02', name: 'بوابة الزيتونة', centerId: 2 } });
  assert.equal(made.status, 201);
  assert.equal(made.body.device.id, 'DEV-02', 'المعرّف بأحرف كبيرة');
  const t1 = made.body.token;
  assert.match(t1, /^[0-9a-f]{48}$/);

  const list = await call(env, 'GET', '/api/devices', { cookie: adm.cookie });
  assert.ok(!JSON.stringify(list.body).includes(t1), 'الرمز لا يُعاد في أي قائمة');
  assert.ok(!JSON.stringify(list.body).includes('token_hash'));

  assert.equal((await gateGet(env, `action=ping&token=${t1}`)).body.device, 'DEV-02');
  assert.equal((await gatePost(env, [mv('NW-002', 'حضور', '2026-03-02', '08:20')], t1)).body.saved, 1);
  assert.equal(await db.prepare('SELECT device_id FROM movements').first('device_id'), 'DEV-02', 'الجهاز المسجَّل هو المصادَق لا ما يدّعيه الطلب');

  const rot = await call(env, 'POST', '/api/devices/DEV-02/rotate', { cookie: adm.cookie });
  assert.equal(rot.status, 200);
  assert.equal((await gateGet(env, `action=ping&token=${t1}`)).status, 401, 'الرمز القديم بطل');
  assert.equal((await gateGet(env, `action=ping&token=${rot.body.token}`)).status, 200);

  assert.equal((await call(env, 'POST', '/api/devices/DEV-02/deactivate', { cookie: adm.cookie })).status, 200);
  assert.equal((await gateGet(env, `action=ping&token=${rot.body.token}`)).status, 401);
  assert.equal((await call(env, 'POST', '/api/devices/NOPE/rotate', { cookie: adm.cookie })).status, 404);

  assert.equal((await call(env, 'POST', '/api/devices', { cookie: adm.cookie, body: { id: 'DEV-08' } })).status, 201);
  assert.equal((await call(env, 'POST', '/api/devices', { cookie: adm.cookie, body: { id: 'DEV-08' } })).status, 409);
  assert.equal((await call(env, 'POST', '/api/devices', { cookie: adm.cookie, body: { id: 'DEV-01' } })).status, 409, 'DEV-01 موجود أصلاً في بيئة الاختبار');
  assert.equal((await call(env, 'POST', '/api/devices', { cookie: adm.cookie, body: { id: 'bad id!' } })).status, 400);
});

test('الإعدادات: التحقق من الشكل، التدقيق، وتنبيه إعادة الحساب', async () => {
  const { db, env } = await apiEnv();
  const adm = await login(db, 'adm@nawaculture.org', 'admin');
  const put = (b) => call(env, 'PUT', '/api/settings/work', { cookie: adm.cookie, body: b });

  assert.equal((await put({ ...settings, end: '08:00' })).status, 400, 'النهاية قبل البداية');
  assert.equal((await put({ ...settings, weekdays: ['عمل'] })).status, 400);
  assert.equal((await put({ ...settings, weekdays: ['عمل', 'عمل', 'عمل', 'عمل', 'عمل', 'سبت', 'عمل'] })).status, 400);
  assert.equal((await put({ ...settings, toleranceMinutes: 'ten' })).status, 400);
  assert.equal((await put({ ...settings, leaveTypes: { x: 'yes' } })).status, 400);

  const ok = await put({ ...settings, extraJunk: 'يُهمل', monthlyExitCapHours: 6 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.needsRecompute, true);
  const got = await call(env, 'GET', '/api/settings', { cookie: adm.cookie });
  assert.equal(got.body.work.toleranceMinutes, 10);
  assert.equal(got.body.work.monthlyExitCapHours, 6);
  assert.ok(!('extraJunk' in got.body.work), 'الحقول الدخيلة لا تُخزَّن');
});

test('الإعدادات الجديدة تؤثر على الحركات التالية (تسامح 10 بدل 15)', async () => {
  const { db, env } = await apiEnv();
  await seedOrg(db);
  const adm = await login(db, 'adm@nawaculture.org', 'admin');
  const dev = (await call(env, 'POST', '/api/devices', { cookie: adm.cookie, body: { id: 'DEV-05' } })).body.token;

  await gatePost(env, [mv('NW-002', 'حضور', '2026-03-02', '08:43', { id: 'a' })], dev); // 13 دقيقة: ضمن سماحية 15 (إعدادات golden)
  assert.equal(await db.prepare("SELECT status FROM daily_results WHERE date = '2026-03-02'").first('status'), 'حاضر');

  await call(env, 'PUT', '/api/settings/work', { cookie: adm.cookie, body: settings }); // سماحية 10
  await gatePost(env, [mv('NW-003', 'حضور', '2026-03-02', '08:43', { id: 'b' })], dev);
  assert.equal(await db.prepare("SELECT status FROM daily_results WHERE employee_id = 3").first('status'), 'متأخر');
});

test('المستخدمون: لا يُترك النظام بلا مسؤول، وإيقاف الحساب أو تغيير دوره يُنهي جلساته فوراً', async () => {
  const { db, env } = await apiEnv();
  const adm = await login(db, 'adm@nawaculture.org', 'admin');
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  const patch = (id, b, who = adm) => call(env, 'PATCH', `/api/users/${id}`, { cookie: who.cookie, body: b });

  assert.equal((await patch(adm.id, { role: 'hr' })).status, 409, 'لا يخفّض آخر مسؤول');
  assert.equal((await patch(adm.id, { active: false })).status, 409, 'لا يوقف آخر مسؤول');

  assert.equal((await call(env, 'GET', '/api/me', { cookie: hr.cookie })).status, 200);
  assert.equal((await patch(hr.id, { role: 'manager' })).status, 200);
  assert.equal((await call(env, 'GET', '/api/me', { cookie: hr.cookie })).status, 401, 'تغيير الدور يُنهي الجلسة');

  const second = await login(db, 'adm2@nawaculture.org', 'admin');
  assert.equal((await patch(second.id, { active: false })).status, 200, 'يجوز إيقاف مسؤول إن بقي غيره');
  assert.equal((await call(env, 'GET', '/api/me', { cookie: second.cookie })).status, 401);
  assert.equal((await patch(adm.id, { role: 'superuser' })).status, 400);
  assert.equal((await patch(999, { role: 'hr' })).status, 404);

  assert.equal((await call(env, 'POST', '/api/users', { cookie: adm.cookie, body: { email: 'new@nawaculture.org', role: 'root' } })).status, 400);
  assert.equal((await call(env, 'POST', '/api/users', { cookie: adm.cookie, body: { email: 'ADM@nawaculture.org', role: 'hr' } })).status, 409, 'البريد مسجّل (دون حساسية للحالة)');
});

test('تعديل المستخدم لا يمسح ربطه بالموظف إن لم يُذكر', async () => {
  const { db, env } = await apiEnv();
  await seedOrg(db);
  const adm = await login(db, 'adm@nawaculture.org', 'admin');
  const id = await addUser(db, 'mgr@nawaculture.org', 'manager', 1);
  await call(env, 'PATCH', `/api/users/${id}`, { cookie: adm.cookie, body: { role: 'hr' } });
  assert.equal(await db.prepare('SELECT employee_id FROM users WHERE id = ?').bind(id).first('employee_id'), 1);
});

test('سجل التدقيق يسجّل من فعل ماذا، دون كشف الرموز', async () => {
  const { db, env } = await apiEnv();
  const adm = await login(db, 'adm@nawaculture.org', 'admin');
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  await call(env, 'POST', '/api/employees', { cookie: hr.cookie, body: { code: 'NW-050', name: 'سجل', card: 'C-50' } });
  const dev = await call(env, 'POST', '/api/devices', { cookie: adm.cookie, body: { id: 'DEV-07' } });
  await call(env, 'PUT', '/api/settings/work', { cookie: adm.cookie, body: settings });

  const log = await call(env, 'GET', '/api/audit', { cookie: hr.cookie });
  const actions = log.body.entries.map((e) => `${e.actor}|${e.action}|${e.entityId}`);
  assert.ok(actions.includes('hr@nawaculture.org|employee.create|NW-050'));
  assert.ok(actions.includes('adm@nawaculture.org|device.create|DEV-07'));
  assert.ok(actions.includes('adm@nawaculture.org|settings.work|work'));
  assert.ok(!JSON.stringify(log.body).includes(dev.body.token), 'رمز الجهاز لا يدخل السجل');
  assert.ok(log.body.entries[0].id > log.body.entries.at(-1).id, 'الأحدث أولاً');
});

test('نتائج الأيام: حدود المدى، وصيغة الحقول، والنتيجة تعكس حركات البوابة', async () => {
  const { db, env } = await apiEnv();
  await seedOrg(db);
  const adm = await login(db, 'adm@nawaculture.org', 'admin');
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  const dev = (await call(env, 'POST', '/api/devices', { cookie: adm.cookie, body: { id: 'DEV-03' } })).body.token;
  await gatePost(env, [mv('NW-002', 'حضور', '2026-03-02', '08:20'), mv('NW-002', 'انصراف', '2026-03-02', '15:00')], dev);

  const days = (q) => call(env, 'GET', `/api/employees/2/days?${q}`, { cookie: hr.cookie });
  const ok = await days('from=2026-03-01&to=2026-03-31');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.days.length, 1);
  assert.deepEqual(
    { d: ok.body.days[0].date, s: ok.body.days[0].status, n: ok.body.days[0].netHours, a: ok.body.days[0].alert },
    { d: '2026-03-02', s: 'حاضر', n: 6.67, a: '' },
  );
  for (const q of ['', 'from=2026-03-01', 'from=2026-03-31&to=2026-03-01', 'from=2026-02-31&to=2026-03-05', 'from=2025-01-01&to=2026-03-01']) {
    assert.equal((await days(q)).status, 400, q);
  }
  assert.equal((await days('from=2026-01-01&to=2026-12-31')).status, 200, '365 يوماً مسموحة');
});

test('كوكي مسروقة من مستخدم آخر لا تمنح أكثر من دور صاحبها، وCORS غير مفعّل على واجهة الإدارة', async () => {
  const { db, env } = await apiEnv();
  const emp = await login(db, 'emp@nawaculture.org', 'employee');
  const r = await call(env, 'GET', '/api/devices', { cookie: emp.cookie });
  assert.equal(r.status, 403);
  assert.equal(r.res.headers.get('access-control-allow-origin'), null);
  assert.equal(emp.cookie.startsWith(COOKIE), true);
});

test('المراكز: قائمة لكل مستخدم، وإنشاء بلا تكرار', async () => {
  const { db, env } = await apiEnv();
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  const emp = await login(db, 'emp@nawaculture.org', 'employee');
  const list = await call(env, 'GET', '/api/centers', { cookie: emp.cookie });
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.body.centers));
  const made = await call(env, 'POST', '/api/centers', { cookie: hr.cookie, body: { name: 'مركز الأمل' } });
  assert.equal(made.status, 201);
  assert.equal(made.body.center.name, 'مركز الأمل');
  assert.equal((await call(env, 'POST', '/api/centers', { cookie: hr.cookie, body: { name: 'مركز الأمل' } })).status, 409);
  assert.equal((await call(env, 'POST', '/api/centers', { cookie: hr.cookie, body: { name: 'ا' } })).status, 400);
  assert.equal((await call(env, 'POST', '/api/centers', { cookie: emp.cookie, body: { name: 'مركز آخر' } })).status, 403);
});
