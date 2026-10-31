import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call, seedOrg } from './helpers/api.js';
import { validateAllocations } from '../src/worker/projects.js';

const A = 'Funder A / Project A';
const B = 'Funder B / Project B';
const C = 'Funder C';
const D = 'Funder D';
const row = (funder, share, from = '2026-01-01', to = '2030-12-31') => ({ funder, share, from, to });

test('توزيع المشاريع: نسبة مفردة، نصفان، ثلاثة أثلاث', () => {
  assert.ok(validateAllocations([row(A, 1)]).rows);
  assert.ok(validateAllocations([row(A, 0.5), row(B, 0.5)]).rows);
  assert.ok(validateAllocations([row(A, 0.3334), row(B, 0.3333), row(C, 0.3333)]).rows);
});

test('توزيع المشاريع: يرفض المجموع الخاطئ، أكثر من 3 متزامنين، فترات معكوسة، ممولاً مفقوداً، نسباً خارج المدى', () => {
  assert.match(validateAllocations([row(A, 0.5), row(B, 0.4)]).error, /100%/);
  assert.match(validateAllocations([row(A, 0.25), row(B, 0.25), row(C, 0.25), row(D, 0.25)]).error, /3 ممولين/);
  assert.match(validateAllocations([row(A, 1, '2026-06-01', '2026-01-01')]).error, /النهاية قبل البداية/);
  assert.match(validateAllocations([row(null, 1)]).error, /الممول/);
  assert.match(validateAllocations([row(A, 0)]).error, /النسبة/);
  assert.match(validateAllocations([row(A, 1.2)]).error, /النسبة/);
  assert.match(validateAllocations([row(A, '1')]).error, /النسبة/);
  assert.match(validateAllocations([row(A, 1, '2026-02-30', '2026-12-31')]).error, /تاريخ/);
  assert.match(validateAllocations([]).error, /مطلوب/);
});

test('توزيع المشاريع: انتقال بين ممولين في منتصف السنة صحيح، وتداخل يكسر المجموع مرفوض، والفجوة مسموحة', () => {
  assert.ok(validateAllocations([row(A, 1, '2026-01-01', '2026-06-30'), row(B, 1, '2026-07-01', '2026-12-31')]).rows);
  const overlap = validateAllocations([row(A, 1, '2026-01-01', '2026-07-15'), row(B, 1, '2026-07-01', '2026-12-31')]);
  assert.match(overlap.error, /2026-07-01/);
  assert.ok(validateAllocations([row(A, 1, '2026-01-01', '2026-03-31'), row(B, 1, '2026-06-01', '2026-12-31')]).rows, 'فجوة بلا تحميل');
});

test('الحقول الإنجليزية: تُنشأ وتُعدَّل وتظهر في القائمة مع اسم المركز الإنجليزي', async () => {
  const { db, env } = await apiEnv();
  await seedOrg(db);
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  const made = await call(env, 'POST', '/api/employees', {
    cookie: hr.cookie,
    body: { code: 'NW-020', name: 'سلمى', nameEn: 'Salma A.', jobTitleEn: 'Accountant', departmentEn: 'Finance', managerLabelEn: 'Boss – Director', centerId: 1 },
  });
  assert.equal(made.status, 201);
  assert.equal(made.body.employee.nameEn, 'Salma A.');
  assert.equal(made.body.employee.jobTitleEn, 'Accountant');
  const patched = await call(env, 'PATCH', `/api/employees/${made.body.employee.id}`, { cookie: hr.cookie, body: { departmentEn: 'Admin & Finance' } });
  assert.equal(patched.body.employee.departmentEn, 'Admin & Finance');

  assert.equal((await call(env, 'PATCH', '/api/centers/1', { cookie: hr.cookie, body: { nameEn: 'Main Building' } })).status, 200);
  assert.equal((await call(env, 'PATCH', '/api/centers/1', { cookie: hr.cookie, body: { id: 5 } })).status, 400);
  assert.equal((await call(env, 'PATCH', '/api/centers/99', { cookie: hr.cookie, body: { nameEn: 'x' } })).status, 404);
  const list = await call(env, 'GET', '/api/employees', { cookie: hr.cookie });
  assert.equal(list.body.employees.find((e) => e.code === 'NW-020').centerEn, 'Main Building');
});

test('استيراد الموظفين: يطابق المركز بالاسم الإنجليزي بدل إنشاء مركز مكرر، ويملأ name_en للمركز العربي', async () => {
  const { db, env } = await apiEnv();
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  const post = (rows) => call(env, 'POST', '/api/import/employees', { cookie: hr.cookie, body: { rows } });

  // 1) الأول يربط عربي+إنجليزي: المركز 2 «مركز الزيتونة» يأخذ اسمه الإنجليزي
  let r = await post([{ code: 'NW-101', name: 'أحمد', nameEn: 'Ahmad', center: 'مركز الزيتونة', centerEn: 'Al-Zaytouna Center', jobTitleEn: 'Teacher' }]);
  assert.equal(r.body.imported, 1);
  assert.equal(await db.prepare("SELECT name_en FROM centers WHERE name = 'مركز الزيتونة'").first('name_en'), 'Al-Zaytouna Center');

  // 2) ملف إنجليزي فقط يصل لاحقاً: نفس المركز، لا مركز جديد
  const centersBefore = await db.prepare('SELECT COUNT(*) AS n FROM centers').first('n');
  r = await post([{ code: 'NW-102', name: 'Sara', centerEn: 'Al-Zaytouna Center' }, { code: 'NW-103', name: 'Omar', centerEn: 'New Place' }]);
  assert.equal(r.body.imported, 2);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM centers').first('n'), centersBefore + 1, 'مركز جديد واحد فقط (New Place)');
  const c102 = await db.prepare("SELECT c.name FROM employees e JOIN centers c ON c.id = e.center_id WHERE e.code = 'NW-102'").first('name');
  assert.equal(c102, 'مركز الزيتونة');

  // 3) إعادة الاستيراد دون حقول إنجليزية لا تمسح الموجود
  r = await post([{ code: 'NW-101', name: 'أحمد' }]);
  const e = await db.prepare("SELECT name_en, job_title_en, center_id FROM employees WHERE code = 'NW-101'").first();
  assert.equal(e.name_en, 'Ahmad');
  assert.equal(e.job_title_en, 'Teacher');
  assert.equal(e.center_id, 2, 'المركز لا يُمسح حين لا يُذكر');
});

test('ربط المديرين من نص «الاسم – المسمى»: بالاسم الإنجليزي أو العربي، دون حلقات، ويُبلغ عن غير المطابَق', async () => {
  const { db, env } = await apiEnv();
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  const rows = [
    { code: 'NW-001', name: 'ريم', nameEn: 'Reem Abu Jaber', managerLabelEn: 'Younis Abu Samra – Chairman of the Board' },
    { code: 'NW-019', name: 'نارمين', nameEn: 'Nareman Issa Al-Faleet', managerLabelEn: 'Reem Abu Jaber – Executive Director' },
    { code: 'NW-006', name: 'ريم ب', nameEn: 'Reem Al Buhaisi', managerLabelEn: 'Nareman Issa Al - Faleet – Administration and Finance Department Manager' },
    { code: 'NW-044', name: 'نور', nameEn: 'Nour', managerLabel: 'ريم – مديرة' },
  ];
  await call(env, 'POST', '/api/import/employees', { cookie: hr.cookie, body: { rows } });
  const link = await call(env, 'POST', '/api/import/managers', { cookie: hr.cookie, body: {} });
  assert.equal(link.status, 200);
  assert.equal(link.body.linked, 3, 'NW-019 ← NW-001، وNW-006 ← NW-019 (والاسم "Al - Faleet" يطابق "Al-Faleet")، وNW-044 ← NW-001 بالنص العربي');
  assert.deepEqual(link.body.unmatched.map((u) => u.code), ['NW-001'], 'رئيس مجلس الإدارة ليس موظفاً');
  const mgr = async (code) => db.prepare("SELECT m.code FROM employees e JOIN employees m ON m.id = e.manager_id WHERE e.code = ?").bind(code).first('code');
  assert.equal(await mgr('NW-006'), 'NW-019');
  assert.equal(await mgr('NW-019'), 'NW-001');

  // التصحيح اللاحق: لا يغيّر الموجود إلا بـ replace، وبه يتغير
  await call(env, 'PATCH', `/api/employees/${await db.prepare("SELECT id FROM employees WHERE code='NW-006'").first('id')}`, { cookie: hr.cookie, body: { managerId: 1 } });
  const keep = await call(env, 'POST', '/api/import/managers', { cookie: hr.cookie, body: {} });
  assert.equal(keep.body.linked, 0);
  const fix = await call(env, 'POST', '/api/import/managers', { cookie: hr.cookie, body: { replace: true } });
  assert.equal(fix.body.linked, 1);
  assert.equal(await mgr('NW-006'), 'NW-019');

  // الحلقة ممنوعة: ريم (001) لا تُربط بمن تحتها
  await call(env, 'POST', '/api/import/employees', { cookie: hr.cookie, body: { rows: [{ code: 'NW-001', name: 'ريم', managerLabelEn: 'Nareman Issa Al-Faleet – x' }] } });
  const loop = await call(env, 'POST', '/api/import/managers', { cookie: hr.cookie, body: { replace: true } });
  assert.ok(loop.body.unmatched.some((u) => u.code === 'NW-001' && /حلقة/.test(u.reason)));
  assert.equal(await mgr('NW-019'), 'NW-001');

  const emp = await call(env, 'POST', '/api/import/managers', { cookie: (await login(db, 'e@nawaculture.org', 'employee')).cookie, body: {} });
  assert.equal(emp.status, 403);
});

test('استيراد/تحديث توزيع المشاريع: يستبدل توزيع الموظف كاملاً، يرفض غير الصالح لكل موظف على حدة', async () => {
  const { db, env } = await apiEnv();
  await seedOrg(db);
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  const imp = (rows) => call(env, 'POST', '/api/import/projects', { cookie: hr.cookie, body: { rows } });
  const base = { from: '2026-01-01', to: '2030-12-31' };

  let r = await imp([
    { code: 'NW-002', funder: A, share: 0.5, ...base }, { code: 'NW-002', funder: B, share: 0.5, ...base },
    { code: 'NW-003', funder: A, share: 1, ...base },
    { code: 'NW-004', funder: null, share: 1, ...base },
    { code: 'NW-999', funder: A, share: 1, ...base },
    { code: 'NW-001', funder: A, share: 0.7, ...base },
  ]);
  assert.equal(r.status, 200);
  assert.equal(r.body.employees, 2);
  assert.equal(r.body.rows, 3);
  assert.deepEqual(r.body.rejected.map((x) => x.code).sort(), ['NW-001', 'NW-004', 'NW-999']);

  // إعادة الاستيراد تستبدل ولا تكرّر
  r = await imp([{ code: 'NW-002', funder: C, share: 1, ...base }]);
  assert.equal(r.body.rows, 1);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM employee_projects WHERE employee_id = 2').first('n'), 1);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM employee_projects WHERE employee_id = 3').first('n'), 1);

  // مستخدم عادي لا يستورد، ومدير يقرأ توزيع مرؤوسه فقط
  const emp = await login(db, 'e@nawaculture.org', 'employee', 2);
  assert.equal((await call(env, 'POST', '/api/import/projects', { cookie: emp.cookie, body: { rows: [] } })).status, 403);
  const mgr = await login(db, 'm@nawaculture.org', 'manager', 1);
  assert.equal((await call(env, 'GET', '/api/employees/2/projects', { cookie: mgr.cookie })).body.allocations[0].funder, C);
  assert.equal((await call(env, 'GET', '/api/employees/4/projects', { cookie: mgr.cookie })).status, 403);
  assert.equal((await call(env, 'GET', '/api/employees/3/projects', { cookie: emp.cookie })).status, 403);
  assert.equal((await call(env, 'GET', '/api/employees/2/projects', { cookie: emp.cookie })).status, 200);
});

test('PUT توزيع موظف: يتحقق ويستبدل ويُدوَّن في التدقيق', async () => {
  const { db, env } = await apiEnv();
  await seedOrg(db);
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  const put = (id, allocations) => call(env, 'PUT', `/api/employees/${id}/projects`, { cookie: hr.cookie, body: { allocations } });
  assert.equal((await put(2, [row(A, 0.6), row(B, 0.4)])).status, 200);
  assert.equal((await put(2, [row(A, 0.6), row(B, 0.3)])).status, 400);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM employee_projects WHERE employee_id = 2').first('n'), 2, 'الفشل لا يمس الموجود');
  assert.equal((await put(99, [row(A, 1)])).status, 404);
  const got = await call(env, 'GET', '/api/employees/2/projects', { cookie: hr.cookie });
  assert.deepEqual(got.body.allocations.map((a) => a.share), [0.6, 0.4]);
  assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'employee.projects'").first('n'), 1);
});

test('استيراد ملف إنجليزي فقط: يحدّث الحقول الإنجليزية ولا يمسح الاسم العربي، وينشئ الجديد بالاسم الإنجليزي', async () => {
  const { db, env } = await apiEnv();
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  const post = (rows) => call(env, 'POST', '/api/import/employees', { cookie: hr.cookie, body: { rows } });
  await post([{ code: 'NW-201', name: 'خالد', jobTitle: 'محاسب', center: 'مركز الزيتونة' }]);
  const r = await post([
    { nameEn: 'Khalid A.', code: 'NW-201', jobTitleEn: 'Accountant', centerEn: 'Al-Zaytouna Center' },
    { code: 'NW-202', nameEn: 'Hana B.', jobTitleEn: 'Teacher' },
  ]);
  assert.equal(r.body.imported, 2);
  const a = await db.prepare("SELECT name, name_en, job_title, job_title_en FROM employees WHERE code = 'NW-201'").first();
  assert.deepEqual({ ...a }, { name: 'خالد', name_en: 'Khalid A.', job_title: 'محاسب', job_title_en: 'Accountant' });
  const b = await db.prepare("SELECT name, name_en FROM employees WHERE code = 'NW-202'").first();
  assert.deepEqual({ ...b }, { name: 'Hana B.', name_en: 'Hana B.' });
  assert.equal((await post([{ code: 'NW-203' }])).body.rejected[0].reason, 'اسم مفقود');
});
