import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initials, serviceSpan, activeAllocations, projectSummary, dmy, photoUrl } from '../public/js/employee-lib.js';

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

test('ملخّص المشاريع من التوزيع الساري: ثلاثة مشاريع لا «مشروعان» القديمة', () => {
  const a = [
    { funder: 'مشروع أ', share: 0.5, from: '2026-01-01', to: '2030-12-31' },
    { funder: 'مشروع ب', share: 0.4, from: '2026-01-01', to: '2030-12-31' },
    { funder: 'مشروع ج', share: 0.1, from: '2026-01-01', to: '2030-12-31' },
    { funder: 'منتهٍ', share: 1, from: '2024-01-01', to: '2024-12-31' },
  ];
  assert.deepEqual(projectSummary(a, '2026-11-03'), { count: 3, names: ['مشروع أ', 'مشروع ب', 'مشروع ج'], short: '3 مشاريع', full: 'ضمن 3 مشاريع: مشروع أ + مشروع ب + مشروع ج' });
  const two = projectSummary(a.slice(0, 2), '2026-11-03');
  assert.equal(two.short, 'مشروعان');
  assert.equal(two.full, 'ضمن مشروعين: مشروع أ + مشروع ب');
  assert.deepEqual(projectSummary([{ funder: 'وحيد', share: 1, from: '2026-01-01', to: '2026-12-31' }], '2026-05-05'), { count: 1, names: ['وحيد'], short: 'وحيد', full: 'وحيد' });
  // مشروع مكرّر في فترتين متقاطعتين لا يُعدّ مرتين، وبلا توزيع ساري يبقى النص القديم (count = 0)
  assert.equal(projectSummary([{ funder: 'س', share: 0.5, from: '2026-01-01', to: '2026-12-31' }, { funder: 'س', share: 0.5, from: '2026-01-01', to: '2026-12-31' }], '2026-06-06').count, 1);
  assert.equal(projectSummary([], '2026-11-03').count, 0);
  assert.equal(projectSummary(null, '2026-11-03').full, '');
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

test('رابط الصورة: OneDrive الشخصي يُحوَّل عبر واجهة المشاركات، وSharePoint يأخذ download=1', () => {
  const short = 'https://1drv.ms/i/s!AbCdEfGh';
  const b64 = Buffer.from(short).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(photoUrl(short).url, `https://api.onedrive.com/v1.0/shares/u!${b64}/root/content`);
  assert.match(photoUrl('https://onedrive.live.com/?cid=ABC&id=ABC%21123&authkey=%21xyz').url, /^https:\/\/api\.onedrive\.com\/v1\.0\/shares\/u![A-Za-z0-9_-]+\/root\/content$/);
  assert.equal(photoUrl('https://nawa-my.sharepoint.com/:i:/g/personal/taha_nawaculture_org/EabcDEF?e=xyz').url, 'https://nawa-my.sharepoint.com/:i:/g/personal/taha_nawaculture_org/EabcDEF?e=xyz&download=1');
  assert.equal(photoUrl('https://nawa-my.sharepoint.com/x?download=0').url, 'https://nawa-my.sharepoint.com/x?download=1');
  assert.ok(photoUrl(`https://onedrive.live.com/?id=${'a'.repeat(400)}`).error, 'بعد التحويل يتجاوز 500');
});
