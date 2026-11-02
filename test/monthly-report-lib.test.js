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
