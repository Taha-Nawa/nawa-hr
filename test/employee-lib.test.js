import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initials, serviceSpan, activeAllocations, dmy, photoUrl } from '../public/js/employee-lib.js';

test('حرفا الأفقية: الاسم الأول وآخر كلمة دون «ال» والألقاب', () => {
  assert.equal(initials('منى خالد العطار'), 'م.ع');
  assert.equal(initials('أ. سلمى الحاج'), 'س.ح');
  assert.equal(initials('طه عطية سالم أبو نمر'), 'ط.ن');
  assert.equal(initials('سلمى'), 'س');
  assert.equal(initials('  '), '؟');
  assert.equal(initials(null), '؟');
  assert.equal(initials('ال'), 'ا'); // كلمة هي «ال» وحدها لا تُفرَّغ
});

test('مدة الخدمة بصياغة عربية صحيحة للمفرد والمثنى والجمع', () => {
  const T = '2026-11-03';
  assert.equal(serviceSpan('2023-03-01', null, T), '3 سنوات و8 أشهر');
  assert.equal(serviceSpan('2025-11-03', null, T), 'سنة');
  assert.equal(serviceSpan('2024-09-03', null, T), 'سنتان وشهران');
  assert.equal(serviceSpan('2026-10-03', null, T), 'شهر');
  assert.equal(serviceSpan('2026-09-03', null, T), 'شهران');
  assert.equal(serviceSpan('2026-07-03', null, T), '4 أشهر');
  assert.equal(serviceSpan('2025-12-03', null, T), '11 شهراً');
  assert.equal(serviceSpan('2015-11-03', null, T), '11 سنة');
  assert.equal(serviceSpan('2026-10-20', null, T), 'أقل من شهر'); // لم يكتمل شهر (3 < 20)
  assert.equal(serviceSpan('2026-11-03', null, T), 'أقل من شهر');
  assert.equal(serviceSpan('2027-01-01', null, T), 'لم تبدأ الخدمة بعد');
  assert.equal(serviceSpan(null, null, T), '');
});

test('مدة الخدمة تتوقف عند انتهائها، ولا تتجاوز اليوم إن كان الانتهاء مستقبلياً', () => {
  const T = '2026-11-03';
  assert.equal(serviceSpan('2023-03-01', '2024-03-01', T), 'سنة');
  assert.equal(serviceSpan('2023-03-01', '2024-03-01', '2030-01-01'), 'سنة');
  assert.equal(serviceSpan('2023-03-01', '2027-03-01', T), '3 سنوات و8 أشهر');
  assert.equal(serviceSpan('2023-03-31', null, '2023-04-30'), 'أقل من شهر'); // 30 نيسان قبل 31 فلا شهر كامل
});

test('التوزيع الساري اليوم فقط، الأكبر أولاً، والنسبة مئوية', () => {
  const a = [
    { funder: 'الميزانية العامة', share: 0.4, from: '2026-01-01', to: '2026-12-31' },
    { funder: 'UNDP 2026', share: 0.6, from: '2026-01-01', to: '2026-12-31' },
    { funder: 'قديم', share: 1, from: '2025-01-01', to: '2025-12-31' },
    { funder: 'قادم', share: 0.5, from: '2027-01-01', to: '2027-12-31' },
    { funder: 'صفر', share: 0, from: '2026-01-01', to: '2026-12-31' },
  ];
  assert.deepEqual(activeAllocations(a, '2026-11-03'), [{ funder: 'UNDP 2026', percent: 60 }, { funder: 'الميزانية العامة', percent: 40 }]);
  assert.deepEqual(activeAllocations([{ funder: 'x', share: 0.3333, from: '2026-01-01', to: '2026-12-31' }], '2026-02-02'), [{ funder: 'x', percent: 33.33 }]);
  assert.deepEqual(activeAllocations(null, '2026-11-03'), []);
});

test('تنسيق التاريخ يوم/شهر/سنة', () => {
  assert.equal(dmy('2023-03-01'), '01/03/2023');
  assert.equal(dmy(null), '');
});

test('رابط الصورة: https فقط، ورابط Google Drive يُحوَّل إلى صورة مباشرة، والفارغ يعني بلا صورة', () => {
  assert.deepEqual(photoUrl(''), { url: null });
  assert.deepEqual(photoUrl('   '), { url: null });
  assert.deepEqual(photoUrl(null), { url: null });
  assert.equal(photoUrl(' https://example.org/a/me.jpg ').url, 'https://example.org/a/me.jpg');
  assert.ok(photoUrl('http://example.org/me.jpg').error, 'http مرفوض');
  assert.ok(photoUrl('javascript:alert(1)').error);
  assert.ok(photoUrl('data:image/png;base64,AAAA').error);
  assert.ok(photoUrl('ليس رابطاً').error);
  assert.ok(photoUrl('https://user:pw@example.org/me.jpg').error, 'بيانات دخول داخل الرابط مرفوضة');
  assert.ok(photoUrl(`https://example.org/${'a'.repeat(500)}`).error, 'أطول من 500');
  const want = 'https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMnOp&sz=w400';
  assert.equal(photoUrl('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing').url, want);
  assert.equal(photoUrl('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp').url, want);
  assert.equal(photoUrl('https://drive.google.com/uc?export=view&id=1AbCdEfGhIjKlMnOp').url, want);
  assert.ok(photoUrl('https://drive.google.com/drive/folders').error, 'رابط درايف بلا معرّف ملف');
});
