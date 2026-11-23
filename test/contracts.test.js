import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call } from './helpers/api.js';
import { tafqeet, compute, audit, DAILY, LUMP, NONE_TERM } from '../src/engine/contracts.js';

// بيانات وهمية بالكامل: لا أسماء ولا هويات ولا حسابات حقيقية
const fake = (o = {}) => ({ name: 'مزوّد تجريبي', idno: '123456789', gender: 'أنثى', title: 'السيدة', ctype: 'خدمة مباشرة', csubject: 'x', project: 'p', donor: 'd',
  dSign: '2026-01-01', dFrom: '2026-01-02', dTo: '2026-03-01', siteType: 't', siteName: 's', area: 'a', pricing: DAILY, rate: 25, sessPerDay: 2, daysBase: 20,
  bank: 'بنك', iban: 'PS00TEST', status: 'قيد التنفيذ', termType: NONE_TERM, ...o });

test('التفقيط', () => {
  assert.equal(tafqeet(0), 'صفر دولار أمريكي فقط لا غير');
  assert.equal(tafqeet(1100), 'ألف ومائة دولار أمريكي فقط لا غير');
  assert.equal(tafqeet(1234.5), 'ألف ومائتان وأربعة وثلاثون دولار أمريكي وخمسون سنتاً فقط لا غير');
  assert.equal(tafqeet(2000000), 'مليونان دولار أمريكي فقط لا غير');
});

test('الحساب: بالجلسة ومقطوع، وحدّا ±25% والانحراف والمستحق عند الإنهاء', () => {
  const c = compute(fake({ daysAct: 22 }));
  assert.deepEqual([c.dayRate, c.base, c.min, c.max, c.sessB, c.appr, c.delta], [50, 1000, 15, 25, 40, 1100, 0.1]);
  const l = compute(fake({ pricing: LUMP, rate: 900 }));
  assert.deepEqual([l.dayRate, l.base, l.appr, l.sessB], [null, 900, 900, null]);
  const t = compute(fake({ termType: 'فسخ كلي فوري دون إشعار مسبق', daysTerm: 5 }));
  assert.equal(t.due, 250);
  assert.equal(t.article, 'المادة 13-2');
});

test('التدقيق: يكشف تجاوز 25% والهوية الناقصة، والسليم بلا ملاحظات', () => {
  assert.deepEqual(audit(fake({ daysAct: 20 })), []);
  const w = audit(fake({ daysAct: 30, idno: '123' }));
  assert.ok(w.some((x) => x.includes('9 خانات')));
  assert.ok(w.some((x) => x.includes('25')));
});

test('المسارات: الإضافة والقراءة والتعديل لمن يملك الصلاحية فقط', async () => {
  const { db, env } = await apiEnv();
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  const clerk = await login(db, 'clerk@nawaculture.org', 'employee');
  const plain = await login(db, 'plain@nawaculture.org', 'employee');
  const director = await login(db, 'dir@nawaculture.org', 'director');
  await db.prepare('UPDATE users SET contracts = 1 WHERE id = ?').bind(clerk.id).run();

  for (const who of [plain, director]) {
    assert.equal((await call(env, 'GET', '/api/contracts', { cookie: who.cookie })).status, 403);
    assert.equal((await call(env, 'POST', '/api/contracts', { cookie: who.cookie, body: fake() })).status, 403);
  }
  assert.equal((await call(env, 'GET', '/api/contracts')).status, 401);

  const c = await call(env, 'POST', '/api/contracts', { cookie: clerk.cookie, body: fake({ daysAct: 22 }) });
  assert.equal(c.status, 201);
  const id = c.body.contract.id;
  assert.equal(c.body.contract.seq, 1);
  assert.equal(c.body.contract.calc.appr, 1100);
  assert.equal((await call(env, 'POST', '/api/contracts', { cookie: hr.cookie, body: fake({ name: 'آخر' }) })).body.contract.seq, 2);

  const p = await call(env, 'PATCH', `/api/contracts/${id}`, { cookie: hr.cookie, body: { status: 'منجز ومكتمل', daysAct: 18 } });
  assert.equal(p.status, 200);
  assert.equal(p.body.contract.status, 'منجز ومكتمل');
  assert.equal(p.body.contract.calc.appr, 900);
  assert.equal(p.body.contract.name, 'مزوّد تجريبي'); // الجزئي لا يمسّ بقية الحقول

  const list = await call(env, 'GET', '/api/contracts?q=آخر', { cookie: clerk.cookie });
  assert.equal(list.body.contracts.length, 1);
  assert.equal((await call(env, 'GET', `/api/contracts/${id}`, { cookie: clerk.cookie })).body.contract.id, id);
  assert.equal((await call(env, 'GET', '/api/contracts/999', { cookie: clerk.cookie })).status, 404);
});

test('التحقق: اسم مطلوب، حالة وتاريخ ورقم صالحة، وسجل التدقيق بلا قيم حسّاسة', async () => {
  const { db, env } = await apiEnv();
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  const post = (body) => call(env, 'POST', '/api/contracts', { cookie: hr.cookie, body });
  assert.equal((await post({ name: '' })).status, 400);
  assert.equal((await post(fake({ status: 'غريبة' }))).status, 400);
  assert.equal((await post(fake({ dFrom: '2026-13-40' }))).status, 400);
  assert.equal((await post(fake({ rate: -5 }))).status, 400);
  assert.equal((await post(fake({ idno: 'abc' }))).status, 400);
  const ok = await post(fake({ iban: 'PS99SECRETIBAN' }));
  assert.equal(ok.status, 201);
  await call(env, 'PATCH', `/api/contracts/${ok.body.contract.id}`, { cookie: hr.cookie, body: { iban: 'PS11OTHERIBAN' } });
  const logs = (await db.prepare("SELECT detail FROM audit_log WHERE entity = 'contract'").all()).results.map((r) => r.detail).join('|');
  assert.ok(!logs.includes('SECRETIBAN') && !logs.includes('OTHERIBAN') && !logs.includes('123456789'));
  assert.ok(logs.includes('iban'));
});

test('الاستيراد: معاينة ثم حفظ، ومرتان لا تكرّران، وللمسؤول فقط', async () => {
  const { db, env } = await apiEnv();
  const admin = await login(db, 'adm@nawaculture.org', 'admin');
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  const recs = [
    { id: 'old1', seq: 7, ...fake({ name: 'أ', exp: 3 }), dFrom: '2026-01-02' },
    { id: 'old2', seq: 8, ...fake({ name: 'ب' }) },
    fake({ name: 'ج' }), // بلا id: تُستعمل بصمة الحقول
    { name: '' }, // غير صالح
  ];
  const imp = (who, body) => call(env, 'POST', '/api/contracts/import', { cookie: who.cookie, body });
  assert.equal((await imp(hr, { records: recs })).status, 403); // الموارد البشرية لا تستورد
  const dry = await imp(admin, { records: recs });
  assert.deepEqual([dry.body.committed, dry.body.added, dry.body.existing, dry.body.invalid.length], [false, 3, 0, 1]);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM contracts').first('n')), 0); // المعاينة لا تحفظ
  const real = await imp(admin, { records: recs, commit: true });
  assert.equal(real.body.added, 3);
  const again = await imp(admin, { records: recs, commit: true });
  assert.deepEqual([again.body.added, again.body.existing], [0, 3]);
  const rows = (await db.prepare('SELECT seq, name, exp FROM contracts ORDER BY seq').all()).results;
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => [r.seq, r.name]), [[7, 'أ'], [8, 'ب'], [9, 'ج']]); // دون رقم: يلي الأكبر
  assert.equal(rows[0].exp, '3'); // الخبرة رقماً في القديم، نصاً هنا
  assert.equal((await imp(admin, { records: Array(21).fill(recs[0]) })).status, 400);
});

test('الربط بمزوّدي الخدمة: إنشاء، تحديث من أحدث عقد، إلغاء التفعيل، وربط الاسم المطابق دون لمس الجدول', async () => {
  const { db, env } = await apiEnv();
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  const post = (body) => call(env, 'POST', '/api/contracts', { cookie: hr.cookie, body });
  // مزوّد قائم مسبقاً (قبل الدمج) بجدول أسبوعي ومركز
  await db.prepare("INSERT INTO providers (id, code, name, center_id, contract_start, contract_end) VALUES (1, 'SP-001', 'اسم  اختبار', 1, '2025-01-01', '2025-06-01')").run();
  await db.prepare("INSERT INTO provider_schedule (provider_id, weekday, start_time, end_time) VALUES (1, 0, '09:00', '11:00')").run();

  const a = await post(fake({ name: 'اسم أول ثانٍ ثالث اختبار', idno: '111111111', dFrom: '2026-01-02', dTo: '2026-03-01', phone: '059' }));
  assert.equal(a.body.provider.providerId, 1); // رُبط بالقائم لا أُنشئ جديد
  assert.equal(a.body.provider.linked, true);
  let p = await db.prepare('SELECT * FROM providers WHERE id = 1').first();
  assert.deepEqual([p.contract_start, p.contract_end, p.active, p.center_id, p.phone], ['2026-01-02', '2026-03-01', 1, 1, '059']);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM provider_schedule WHERE provider_id = 1').first('n'), 1); // الجدول سليم

  // عقد أحدث للهوية نفسها: التواريخ منه، ولا مزوّد جديد
  const b = await post(fake({ name: 'اسم اختبار', idno: '111111111', dFrom: '2026-04-01', dTo: '2026-06-30' }));
  assert.equal(b.body.provider.created, false);
  p = await db.prepare('SELECT * FROM providers WHERE id = 1').first();
  assert.deepEqual([p.contract_start, p.contract_end], ['2026-04-01', '2026-06-30']);

  // هوية جديدة: مزوّد جديد SP-002 والعقد المنتهي = غير فعّال
  const c = await post(fake({ name: 'مزوّد آخر', idno: '222222222', status: 'منتهٍ / مفسوخ' }));
  assert.equal(c.body.provider.created, true);
  const q = await db.prepare("SELECT code, active FROM providers WHERE name = 'مزوّد آخر'").first();
  assert.deepEqual([q.code, q.active], ['SP-002', 0]);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM contracts WHERE provider_id IS NOT NULL').first('n'), 3);

  // الإكمال: تعديل الحالة إلى منجز يوقف المزوّد؛ وبلا فترة تنفيذ لا يُنشأ مزوّد
  await call(env, 'PATCH', `/api/contracts/${b.body.contract.id}`, { cookie: hr.cookie, body: { status: 'منجز ومكتمل' } });
  assert.equal(await db.prepare('SELECT active FROM providers WHERE id = 1').first('active'), 0);
  const nodates = await post({ name: 'بلا تواريخ', idno: '333333333' });
  assert.equal(nodates.body.provider.skipped, 'بلا فترة تنفيذ صالحة');

  // مسار المزامنة الشامل على دفعات
  const s = await call(env, 'POST', '/api/contracts/sync', { cookie: hr.cookie, body: { offset: 0 } });
  assert.equal(s.status, 200);
  assert.deepEqual([s.body.total, s.body.done, s.body.created], [3, true, 0]);
});

test('تنبيه التدقيق: عقد منتهٍ وللمزوّد بريد نوى', () => {
  assert.ok(audit(fake({ status: 'منجز ومكتمل', daysAct: 20, workEmail: 'x@nawaculture.org' })).some((w) => w.includes('بريد نوى')));
  assert.ok(!audit(fake({ workEmail: 'x@nawaculture.org' })).some((w) => w.includes('أوقف')));
});

test('حذف مزوّد تجريبي: لمسؤول النظام فقط، بتأكيد إن كانت له حركات، ولا يُحذف إن ارتبط بعقد', async () => {
  const { db, env } = await apiEnv();
  const admin = await login(db, 'adm@nawaculture.org', 'admin');
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  await db.prepare("INSERT INTO providers (id, code, name, contract_start, contract_end) VALUES (1, 'SP-001', 'تجريبي', '2026-01-01', '2026-02-01'), (2, 'SP-002', 'مرتبط', '2026-01-01', '2026-02-01')").run();
  await db.prepare("INSERT INTO provider_schedule (provider_id, weekday, start_time, end_time) VALUES (1, 0, '09:00', '11:00')").run();
  await db.prepare("INSERT INTO provider_movements (id, provider_id, type, date, time) VALUES ('m1', 1, 'حضور', '2026-01-04', '09:00')").run();
  await db.prepare("INSERT INTO contracts (name, idno, provider_id) VALUES ('ع', '1', 2)").run();
  const del = (who, id, q = '') => call(env, 'DELETE', `/api/providers/${id}${q}`, { cookie: who.cookie });
  assert.equal((await del(hr, 1)).status, 403);
  const need = await del(admin, 1);
  assert.deepEqual([need.status, need.body.needsConfirm, need.body.movements], [409, true, 1]);
  assert.equal((await del(admin, 2, '?force=1')).status, 409); // مرتبط بعقد
  assert.equal((await del(admin, 1, '?force=1')).status, 200);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM providers WHERE id = 1').first('n'), 0);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM provider_movements').first('n'), 0);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM provider_schedule').first('n'), 0);
  assert.equal((await del(admin, 1)).status, 404);
});

test('فحص المكرّرات: يُبقي الأكمل برقم الأقدم، ويحذف البقية نهائياً، ولا يمسّ المختلف، ويحدّث القوائم', async () => {
  const { db, env } = await apiEnv();
  const admin = await login(db, 'adm@nawaculture.org', 'admin');
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  const imp = (recs) => call(env, 'POST', '/api/contracts/import', { cookie: admin.cookie, body: { records: recs, commit: true } });
  // عقد واحد بثلاث نسخ (ناقصة، ناقصة، كاملة) بأرقام 1 و1000 و9000، وعقد مختلف الفترة بالهوية نفسها، وعقد وحيد
  const partial = { idno: '111111111', dFrom: '2026-01-02', dTo: '2026-03-01', name: 'أ', project: 'p', csubject: 'x' };
  await imp([
    { id: 'a1', seq: 1, ...partial },
    { id: 'a2', seq: 1000, ...partial },
    { id: 'a3', seq: 9000, ...fake({ name: 'أ', idno: '111111111', dFrom: '2026-01-02', dTo: '2026-03-01', daysAct: 20 }), project: 'p', csubject: 'x' },
    { id: 'b1', seq: 2, ...partial, dFrom: '2026-04-01', dTo: '2026-05-01' },
    { id: 'c1', seq: 3, name: 'بلا هوية' },
  ]);
  const dedupe = (who, commit) => call(env, 'POST', '/api/contracts/dedupe', { cookie: who.cookie, body: { commit } });
  assert.equal((await dedupe(hr, false)).status, 403);
  const prev = await dedupe(admin, false);
  assert.deepEqual([prev.body.total, prev.body.groups, prev.body.duplicates, prev.body.committed], [5, 1, 2, false]);
  assert.equal((await call(env, 'GET', '/api/contracts', { cookie: admin.cookie })).body.contracts.length, 5); // المعاينة لا تغيّر
  const done = await dedupe(admin, true);
  assert.equal(done.body.committed, true);
  const list = (await call(env, 'GET', '/api/contracts', { cookie: admin.cookie })).body.contracts;
  assert.equal(list.length, 3);
  const a = list.find((c) => c.legacyId === 'id:a3');
  assert.deepEqual([a.seq, a.daysAct], [1, 20]); // الأكمل برقم الأقدم
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM contracts').first('n'), 3); // حُذف نهائياً
  assert.equal((await dedupe(admin, true)).body.duplicates, 0); // مرة ثانية: لا شيء
  // العقد الجديد يأخذ رقماً بعد أكبر رقم موجود
  const n = await call(env, 'POST', '/api/contracts', { cookie: admin.cookie, body: fake({ name: 'جديد', idno: '444444444' }) });
  assert.equal(n.body.contract.seq, 4);
});

// ─── طباعة العقد وWord ───
import { contractBody } from '../public/js/contract-doc.js';
import { buildDocx, bodyXml } from '../public/js/contract-word.js';
test('نص العقد يُملأ من السجل ويُولَّد منه Word سليم', async () => {
  const { DAILY, NONE_TERM } = await import('../public/js/contracts-lib.js');
  const r = { id: 1, seq: 7, name: 'مزوّد اختبار', idno: '100000001', gender: 'ذكر', title: 'السيد', ctype: 'خدمة مباشرة', csubject: 'عقد اتفاق على تقديم خدمات تربوية', dSign: '2026-07-01', dFrom: '2026-07-01', dTo: '2026-12-10', pricing: DAILY, rate: 40, sessPerDay: 2, daysBase: 80, bank: 'بنك', iban: 'PS00', termType: NONE_TERM };
  const html = contractBody(r);
  assert.match(html, /مزوّد اختبار/);
  assert.match(html, /المادة \(14\)/);
  assert.match(html, /6,400\.00/);
  const xml = bodyXml(html);
  assert.match(xml, /مزوّد اختبار/);
  assert.doesNotMatch(xml, /&amp;lt;|<span/);
  const bytes = buildDocx(r);
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), 'PK');
});

test('إعادة الترقيم: يصلح القفزات ويُبقي المتسلسل، للمسؤول فقط، والمعاينة لا تغيّر', async () => {
  const { db, env } = await apiEnv();
  const admin = await login(db, 'adm@nawaculture.org', 'admin');
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  await call(env, 'POST', '/api/contracts/import', { cookie: admin.cookie, body: { commit: true, records: [
    { id: 'r1', seq: 1, name: 'أ', idno: '1' }, { id: 'r2', seq: 2, name: 'ب', idno: '2' }, { id: 'r3', seq: 9505, name: 'ج', idno: '3' }, { id: 'r4', seq: 9903, name: 'د', idno: '4' },
  ] } });
  const rn = (who, commit) => call(env, 'POST', '/api/contracts/renumber', { cookie: who.cookie, body: { commit } });
  assert.equal((await rn(hr, false)).status, 403);
  const prev = await rn(admin, false);
  assert.deepEqual([prev.body.total, prev.body.changed, prev.body.committed], [4, 2, false]);
  assert.deepEqual((await db.prepare('SELECT seq FROM contracts ORDER BY seq').all()).results.map((x) => x.seq), [1, 2, 9505, 9903]);
  assert.equal((await rn(admin, true)).body.committed, true);
  assert.deepEqual((await db.prepare('SELECT seq FROM contracts ORDER BY seq').all()).results.map((x) => x.seq), [1, 2, 3, 4]);
  assert.equal((await rn(admin, false)).body.changed, 0);
});
