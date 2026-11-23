import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiEnv, login, call } from './helpers/api.js';
import { renderBlocks } from '../public/js/contract-tpl.js';
import { DAILY, NONE_TERM } from '../src/engine/contracts.js';

// بيانات وهمية بالكامل
const fake = (o = {}) => ({ name: 'مزوّد تجريبي', idno: '123456789', gender: 'أنثى', title: 'السيدة', ctype: 'خدمة مباشرة', csubject: 'تقديم خدمات تربوية',
  dSign: '2026-01-01', dFrom: '2026-01-02', dTo: '2026-03-01', pricing: DAILY, rate: 25, sessPerDay: 2, daysBase: 20, status: 'قيد التنفيذ', termType: NONE_TERM, ...o });
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function setup() {
  const { db, env } = await apiEnv();
  const hr = await login(db, 'hr@nawaculture.org', 'hr');
  const plain = await login(db, 'plain@nawaculture.org', 'employee');
  return { db, env, hr, plain };
}

test('الصيغ: تُزرع الصيغة الأصلية، وتُحجب عمّن لا يدير العقود', async () => {
  const { env, hr, plain } = await setup();
  assert.equal((await call(env, 'GET', '/api/contracts/templates', { cookie: plain.cookie })).status, 403);
  const l = await call(env, 'GET', '/api/contracts/templates', { cookie: hr.cookie });
  assert.equal(l.status, 200);
  assert.equal(l.body.tpls.length, 1);
  assert.equal(l.body.revs[0].locked, 1);
  const rev = (await call(env, 'GET', `/api/contracts/templates/revs/${l.body.tpls[0].curRev}`, { cookie: hr.cookie })).body.rev;
  assert.equal(rev.blocks.length, 90);
  assert.equal(rev.fp.org, 'جمعية نوى للثقافة والفنون');
});

test('العقد الجديد يُثبَّت على الصيغة، وتعديل الصيغة لا يمسّه (نسخة جديدة)', async () => {
  const { env, hr } = await setup();
  const c = await call(env, 'POST', '/api/contracts', { cookie: hr.cookie, body: fake() });
  const r1 = c.body.contract.revId;
  assert.ok(r1 && c.body.contract.tplId);
  const tplId = c.body.contract.tplId;
  const rev = (await call(env, 'GET', `/api/contracts/templates/revs/${r1}`, { cookie: hr.cookie })).body.rev;
  rev.blocks[0].text = 'عنوان معدّل {{الإجمالي}} {{سعر_اليوم}}';
  const s = await call(env, 'PUT', `/api/contracts/templates/${tplId}/draft`, { cookie: hr.cookie, body: { data: rev, note: 'تعديل' } });
  assert.equal(s.status, 200);
  assert.notEqual(s.body.revId, r1);
  assert.equal(s.body.ver, 2);
  // العقد القائم باقٍ على نسخته القديمة
  const doc = await call(env, 'GET', `/api/contracts/${c.body.contract.id}/doc`, { cookie: hr.cookie });
  assert.equal(doc.body.rev.id, r1);
  assert.equal(doc.body.rev.blocks[0].text.includes('عنوان معدّل'), false);
  // العقد الجديد يأخذ النسخة الجديدة
  const c2 = await call(env, 'POST', '/api/contracts', { cookie: hr.cookie, body: fake({ name: 'ثانٍ' }) });
  assert.equal(c2.body.contract.revId, s.body.revId);
  // حفظ بلا تغيير لا ينشئ نسخة
  const again = await call(env, 'PUT', `/api/contracts/templates/${tplId}/draft`, { cookie: hr.cookie, body: { data: rev } });
  assert.equal(again.body.unchanged, true);
  // «تحديث إلى أحدث نسخة»
  const up = await call(env, 'PATCH', `/api/contracts/${c.body.contract.id}`, { cookie: hr.cookie, body: { repin: true } });
  assert.equal(up.body.contract.revId, s.body.revId);
});

test('النسخة غير المستعملة تُعدَّل في مكانها، والصيغة بلا مقابل مالي مرفوضة', async () => {
  const { env, hr } = await setup();
  const t = await call(env, 'POST', '/api/contracts/templates', { cookie: hr.cookie, body: { name: 'صيغة ثانية' } });
  assert.equal(t.status, 201);
  const rev = (await call(env, 'GET', `/api/contracts/templates/revs/${t.body.revId}`, { cookie: hr.cookie })).body.rev;
  const a = await call(env, 'PUT', `/api/contracts/templates/${t.body.id}/draft`, { cookie: hr.cookie, body: { data: { ...rev, blocks: [...rev.blocks, { id: 'z', type: 'p', text: 'فقرة' }] } } });
  assert.equal(a.body.revId, t.body.revId);
  assert.equal(a.body.ver, 1);
  const bare = { ...rev, blocks: [{ id: 'x', type: 'p', text: 'نص بلا أرقام' }] };
  const bad = await call(env, 'PUT', `/api/contracts/templates/${t.body.id}/draft`, { cookie: hr.cookie, body: { data: bare } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /المقابل المالي/);
});

test('حذف الصيغة: مرفوض إن استُعملت، وأرشفة آخر صيغة مرفوضة', async () => {
  const { env, hr } = await setup();
  const c = await call(env, 'POST', '/api/contracts', { cookie: hr.cookie, body: fake() });
  const used = c.body.contract.tplId;
  assert.equal((await call(env, 'DELETE', `/api/contracts/templates/${used}`, { cookie: hr.cookie })).status, 409);
  assert.equal((await call(env, 'PATCH', `/api/contracts/templates/${used}`, { cookie: hr.cookie, body: { archived: true } })).status, 400);
  const t = await call(env, 'POST', '/api/contracts/templates', { cookie: hr.cookie, body: { name: 'مؤقتة', fromRev: c.body.contract.revId } });
  assert.equal((await call(env, 'PATCH', `/api/contracts/templates/${t.body.id}`, { cookie: hr.cookie, body: { archived: true } })).status, 200);
  assert.equal((await call(env, 'DELETE', `/api/contracts/templates/${t.body.id}`, { cookie: hr.cookie })).status, 200);
});

test('الترويسات والشعارات: رفع صورة، مجموعة، ربط تلقائي، وإعادة تسمية لا تفصل العقود', async () => {
  const { env, hr, plain } = await setup();
  assert.equal((await call(env, 'POST', '/api/contracts/assets', { cookie: hr.cookie, body: { data: 'data:text/html;base64,AAAA' } })).status, 400);
  const up = await call(env, 'POST', '/api/contracts/assets', { cookie: hr.cookie, body: { data: PNG } });
  assert.equal(up.status, 201);
  const again = await call(env, 'POST', '/api/contracts/assets', { cookie: hr.cookie, body: { data: PNG } });
  assert.equal(again.body.id, up.body.id); // البصمة: لا تكرار
  const img = await call(env, 'GET', `/api/contracts/assets/${up.body.id}`, { cookie: hr.cookie });
  assert.equal(img.status, 200);
  assert.equal(img.res.headers.get('content-type'), 'image/png');
  assert.equal((await img.res.arrayBuffer()).byteLength, 70);
  assert.equal((await call(env, 'GET', `/api/contracts/assets/${up.body.id}`, { cookie: plain.cookie })).status, 403);

  const set = { id: 'hdr_abc1', name: 'ترويسة KFW', logos: [{ id: 'lg1', name: 'شعار الممول', asset: up.body.id, h: 20, align: 'left', ord: 5 }], logoCfg: { nawa: { hidden: 1 } }, foot: { ar1: 'عنوان' } };
  const put = await call(env, 'PUT', '/api/contracts/headers', { cookie: hr.cookie, body: { bind: 'donor', map: { KFW: 'hdr_abc1', غائب: 'hdr_nope' }, sets: [set] } });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.headers.map, { KFW: 'hdr_abc1' });

  const direct = await call(env, 'POST', '/api/contracts', { cookie: hr.cookie, body: fake({ hdr: 'ترويسة KFW' }) });
  const auto = await call(env, 'POST', '/api/contracts', { cookie: hr.cookie, body: fake({ name: 'آلي', donor: 'KFW' }) });
  const none = await call(env, 'POST', '/api/contracts', { cookie: hr.cookie, body: fake({ name: 'بلا' }) });
  const hd = async (c) => (await call(env, 'GET', `/api/contracts/${c.body.contract.id}/doc`, { cookie: hr.cookie })).body.header;
  assert.equal((await hd(direct)).name, 'ترويسة KFW');
  assert.equal((await hd(auto)).name, 'ترويسة KFW');
  assert.equal(await hd(none), null);

  const ren = await call(env, 'PUT', '/api/contracts/headers', { cookie: hr.cookie, body: { bind: 'donor', map: { KFW: 'hdr_abc1' }, sets: [{ ...set, name: 'اسم جديد' }] } });
  assert.equal(ren.status, 200);
  assert.equal((await call(env, 'GET', `/api/contracts/${direct.body.contract.id}`, { cookie: hr.cookie })).body.contract.hdr, 'اسم جديد');
  assert.equal((await call(env, 'PUT', '/api/contracts/headers', { cookie: hr.cookie, body: { sets: [set, { ...set, id: 'hdr_abc2' }] } })).status, 400); // اسم مكرّر
});

test('الحقول المخصّصة تُحفظ مع العقد وتظهر في الرموز', async () => {
  const { env, hr } = await setup();
  const t = (await call(env, 'GET', '/api/contracts/templates', { cookie: hr.cookie })).body.tpls[0];
  const rev = (await call(env, 'GET', `/api/contracts/templates/revs/${t.curRev}`, { cookie: hr.cookie })).body.rev;
  rev.fields = [{ k: 'رقم_القرار', label: 'رقم القرار', type: 'text' }];
  rev.blocks.push({ id: 'zz', type: 'p', text: 'بموجب القرار {{رقم_القرار}}' });
  const s = await call(env, 'PUT', `/api/contracts/templates/${t.id}/draft`, { cookie: hr.cookie, body: { data: rev } });
  assert.equal(s.status, 200);
  const c = await call(env, 'POST', '/api/contracts', { cookie: hr.cookie, body: fake({ x: { رقم_القرار: '77/2026' } }) });
  assert.deepEqual(c.body.contract.x, { رقم_القرار: '77/2026' });
  const doc = (await call(env, 'GET', `/api/contracts/${c.body.contract.id}/doc`, { cookie: hr.cookie })).body;
  assert.match(renderBlocks(doc.rev, doc.contract), /77\/2026/);
});

test('مستندات العقد: رفع بالبصمة، عرض، حذف، وتُحذف مع العقد', async () => {
  const { db, env, hr, plain } = await setup();
  const c = await call(env, 'POST', '/api/contracts', { cookie: hr.cookie, body: fake() });
  const id = c.body.contract.id;
  const pdf = new Uint8Array(2_000_000).fill(7);
  pdf.set([0x25, 0x50, 0x44, 0x46], 0);
  const up = (bytes, q = 'kind=' + encodeURIComponent('العقد الموقّع') + '&name=' + encodeURIComponent('موقّع.pdf'), cookie = hr.cookie) => call(env, 'POST', `/api/contracts/${id}/files?${q}`, { cookie, raw: bytes });
  assert.equal((await up(pdf, 'kind=x')).status, 400);
  assert.equal((await up(new Uint8Array([1, 2, 3, 4, 5]))).status, 400); // ليس ملفاً معروفاً
  assert.equal((await up(pdf, undefined, plain.cookie)).status, 403);
  const zipOther = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode('xl/workbook.xml')]);
  assert.equal((await up(zipOther)).status, 400); // ZIP لا يحوي word/ ليس مستند Word
  const okDocx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode('word/document.xml')]);
  const d = await up(okDocx); assert.equal(d.status, 201);
  await call(env, 'DELETE', `/api/contracts/files/${d.body.id}`, { cookie: hr.cookie });
  const ok = await up(pdf);
  assert.equal(ok.status, 201);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM contract_file_chunks WHERE file_id = ?').bind(ok.body.id).first('n'), 3); // 2MB في 3 قطع
  const list = await call(env, 'GET', `/api/contracts/${id}/files`, { cookie: hr.cookie });
  assert.equal(list.body.files[0].mime, 'application/pdf');
  assert.equal((await call(env, 'GET', `/api/contracts/${id}`, { cookie: hr.cookie })).body.contract.filesN, 1);
  const dl = await call(env, 'GET', `/api/contracts/files/${ok.body.id}`, { cookie: hr.cookie });
  const got = new Uint8Array(await dl.res.arrayBuffer());
  assert.equal(got.length, 2_000_000);
  assert.deepEqual([...got.slice(0, 4)], [0x25, 0x50, 0x44, 0x46]);
  assert.match(dl.res.headers.get('content-disposition'), /attachment/);
  assert.equal((await call(env, 'GET', `/api/contracts/files/${ok.body.id}`, { cookie: plain.cookie })).status, 403);
  const big = new Uint8Array(9 * 1024 * 1024); big.set([0x25, 0x50, 0x44, 0x46], 0);
  assert.equal((await up(big)).status, 413);
  // حذف العقد يحذف مستنداته
  assert.equal((await call(env, 'DELETE', `/api/contracts/${id}`, { cookie: hr.cookie })).status, 200);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM contract_files').first('n'), 0);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM contract_file_chunks').first('n'), 0);
});
