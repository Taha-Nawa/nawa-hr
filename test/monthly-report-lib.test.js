import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthLabel, dmy, monthBounds, defaultMonth, isDone, tasksFromPrevious, nextFromTasks, sortMeetings, appendUnique } from '../public/js/monthly-report-lib.js';

test('تسمية الشهر وحدوده والتاريخ بصيغة يوم/شهر/سنة', () => {
  assert.equal(monthLabel('2026-01'), 'يناير 2026');
  assert.equal(monthLabel('2026-10'), 'أكتوبر 2026');
  assert.deepEqual(monthBounds('2024-02'), { from: '2024-02-01', to: '2024-02-29' });
  assert.equal(dmy('2026-10-31'), '31/10/2026');
  assert.equal(dmy(''), '');
});

test('الشهر الافتراضي: المنصرم في أول سبعة أيام، وإلا الجاري', () => {
  assert.equal(defaultMonth('2026-11-02'), '2026-10');
  assert.equal(defaultMonth('2026-11-07'), '2026-10');
  assert.equal(defaultMonth('2026-11-08'), '2026-11');
  assert.equal(defaultMonth('2026-01-03'), '2025-12');
});

test('ما يُعدّ منجزاً', () => {
  for (const s of ['تم الانجاز', 'تم الإنجاز ', 'منجز', 'مكتمل']) assert.equal(isDone(s), true, s);
  for (const s of ['', 'قيد التنفيذ', 'مؤجّل', 'لم يبدأ', undefined]) assert.equal(isDone(s), false, String(s));
});

test('استيراد مهام الشهر السابق وترحيل غير المنجز', () => {
  assert.deepEqual(tasksFromPrevious([{ title: 'أ', importance: 'مهم', start: '2026-11-01', end: '2026-11-30' }]), [{ title: 'أ', status: '', challenges: '' }]);
  assert.deepEqual(tasksFromPrevious(undefined), []);
  const next = nextFromTasks([{ title: 'منجزة', status: 'تم الإنجاز' }, { title: 'جارية', status: 'قيد التنفيذ' }, { title: 'بلا حالة', status: '' }, { title: '  ', status: '' }], '2026-12');
  assert.deepEqual(next, [
    { title: 'جارية', importance: 'مهم', start: '2027-01-01', end: '2027-01-31' },
    { title: 'بلا حالة', importance: 'مهم', start: '2027-01-01', end: '2027-01-31' },
  ]);
});

test('ترتيب الاجتماعات بالتاريخ بثبات، وعدم تكرار المستورد', () => {
  const l = [{ title: 'ج' }, { title: 'ب', date: '2026-10-20' }, { title: 'أ', date: '2026-10-05' }, { title: 'ب٢', date: '2026-10-20' }, { title: 'د' }];
  assert.deepEqual(sortMeetings(l).map((m) => m.title), ['أ', 'ب', 'ب٢', 'ج', 'د']);
  assert.deepEqual(appendUnique([{ title: 'مهمة  أولى' }], [{ title: 'مهمة أولى' }, { title: 'ثانية' }, { title: 'ثانية' }]).map((t) => t.title), ['مهمة  أولى', 'ثانية']);
});

import { reportChecks, checkCounts } from '../public/js/monthly-report-lib.js';

const emp = { jobTitle: 'أخصائي', department: 'الإدارة' };
const ids = (c) => c.map((x) => x.id);

test('فحص الاكتمال: تقرير فارغ يطلب مهمة وخطة قادمة', () => {
  const c = reportChecks({ tasks: [{ title: '', status: '', challenges: '' }], meetings: [], next: [] }, { month: '2026-10', employee: emp });
  assert.deepEqual(ids(c), ['tasks-none', 'meet-none', 'next-none']);
  assert.deepEqual(checkCounts(c), { must: 1, should: 1, tip: 1 });
});

test('فحص الاكتمال: تقرير كامل بلا ملاحظات سوى تلميح الاجتماعات', () => {
  const c = reportChecks({
    tasks: [{ title: 'مهمة', status: 'تم الإنجاز', challenges: '' }],
    meetings: [{ title: 'اجتماع', summary: '', place: 'القاعة', date: '2026-10-05' }],
    next: [{ title: 'قادمة', importance: 'مهم', start: '2026-11-01', end: '2026-11-30' }],
  }, { month: '2026-10', employee: emp });
  assert.deepEqual(c, []);
});

test('فحص الاكتمال: النواقص حسب مستواها', () => {
  const c = reportChecks({
    tasks: [{ title: 'أ', status: '', challenges: '' }, { title: 'ب', status: 'قيد التنفيذ', challenges: '' }, { title: '', status: 'تم', challenges: '' }],
    meetings: [{ title: 'اجتماع', summary: '', place: '', date: '2026-09-30' }, { title: 'آخر', summary: '', place: 'x', date: '' }],
    next: [{ title: 'ن', importance: '', start: '2026-11-10', end: '2026-11-01' }, { title: 'م', importance: 'مهم', start: '', end: '' }],
  }, { month: '2026-10', employee: { jobTitle: '', department: 'x' } });
  const by = Object.fromEntries(c.map((x) => [x.id, x.level]));
  assert.deepEqual(by, {
    'tasks-untitled': 'must', 'tasks-status': 'should', 'tasks-why': 'should', 'meet-range': 'must', 'meet-date': 'should', 'meet-place': 'tip',
    'next-range': 'must', 'next-dates': 'should', 'next-importance': 'tip', carry: 'should', header: 'should',
  });
  assert.match(c.find((x) => x.id === 'tasks-status').text, /^1 مهمة/);
});

test('فحص الاكتمال: ما في السجل اليومي ولم يُستورد', () => {
  const c = reportChecks({
    tasks: [{ title: 'مهمة  أ', status: 'تم الإنجاز', challenges: '' }],
    meetings: [{ title: 'اجتماع', summary: '', place: 'x', date: '2026-10-05' }],
    next: [{ title: 'ن', importance: 'مهم', start: '2026-11-01', end: '2026-11-02' }],
  }, {
    month: '2026-10', employee: emp,
    logTasks: [{ title: 'مهمة أ' }, { title: 'مهمة ب' }],
    logMeets: [{ title: 'اجتماع', date: '2026-10-05' }, { title: 'اجتماع', date: '2026-10-12' }],
  });
  assert.deepEqual(ids(c), ['log-tasks', 'log-meets']);
  assert.match(c[0].text, /1 إنجاز/);
});
