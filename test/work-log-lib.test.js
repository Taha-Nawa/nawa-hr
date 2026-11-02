import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tasksFromLog, meetingsFromLog, nextFromLog, countKinds, groupByDay, doneFromTodo } from '../public/js/work-log-lib.js';
import { appendUnique, meetingKey } from '../public/js/monthly-report-lib.js';

const E = (o) => ({ id: 1, date: '2026-11-02', kind: 'done', title: 'x', status: null, details: null, place: null, importance: null, endDate: null, ...o });

test('أسطر الإنجاز: دمج المتكرر بعنوان واحد، حالة الأخير، تفاصيل فريدة تصير تحديات', () => {
  const tasks = tasksFromLog([
    E({ date: '2026-11-01', title: 'إعداد  تقرير  المشروع', status: 'قيد التنفيذ', details: 'نقص بيانات' }),
    E({ date: '2026-11-02', title: 'إعداد تقرير المشروع', status: 'تم الإنجاز', details: 'نقص بيانات' }),
    E({ date: '2026-11-03', title: 'إعداد تقرير المشروع', status: 'تم الإنجاز', details: 'تأخر المراجعة' }),
    E({ title: 'صيانة', status: 'تم الإنجاز' }),
    E({ kind: 'meeting', title: 'اجتماع' }),
  ]);
  assert.deepEqual(tasks, [
    { title: 'إعداد تقرير المشروع', status: 'تم الإنجاز', challenges: 'نقص بيانات، تأخر المراجعة' },
    { title: 'صيانة', status: 'تم الإنجاز', challenges: '' },
  ]);
});

test('الاجتماعات والتدريبات إلى القسم الثاني، والمهام القادمة إلى الثالث', () => {
  const entries = [
    E({ kind: 'meeting', date: '2026-11-01', title: 'اجتماع الإدارة', details: 'قرارات', place: 'القاعة' }),
    E({ kind: 'training', date: '2026-11-05', title: 'دورة مالية' }),
    E({ kind: 'todo', date: '2026-12-01', title: 'مهمة', importance: 'مهم جداً', endDate: '2026-12-15' }),
    E({ kind: 'todo', date: '2026-12-03', title: 'مهمة ثانية', importance: null }),
    E({ title: 'أنجزت' }),
  ];
  assert.deepEqual(meetingsFromLog(entries), [
    { title: 'اجتماع الإدارة', summary: 'قرارات', place: 'القاعة', date: '2026-11-01' },
    { title: 'دورة مالية', summary: '', place: '', date: '2026-11-05' },
  ]);
  assert.deepEqual(nextFromLog(entries), [
    { title: 'مهمة', importance: 'مهم جداً', start: '2026-12-01', end: '2026-12-15' },
    { title: 'مهمة ثانية', importance: '', start: '2026-12-03', end: '' },
  ]);
  assert.deepEqual(countKinds(entries), { done: 1, meeting: 1, training: 1, todo: 2 });
});

test('التجميع حسب اليوم الأحدث أولاً، والتحويل من مهمة قادمة إلى إنجاز', () => {
  const days = groupByDay([E({ id: 1, date: '2026-11-01' }), E({ id: 2, date: '2026-11-03' }), E({ id: 3, date: '2026-11-03' })]);
  assert.deepEqual(days.map((d) => [d.date, d.items.map((x) => x.id)]), [['2026-11-03', [2, 3]], ['2026-11-01', [1]]]);
  assert.deepEqual(doneFromTodo(E({ kind: 'todo', title: 'ط', details: 'م' }), '2026-11-02'), { kind: 'done', date: '2026-11-02', status: 'تم الإنجاز', title: 'ط', details: 'م' });
});

test('الاستيراد بلا تكرار: مهام بالعنوان، واجتماعات بالعنوان والتاريخ', () => {
  const have = [{ title: 'مهمة  أ', status: 'x', challenges: '' }];
  assert.equal(appendUnique(have, [{ title: 'مهمة أ' }, { title: 'مهمة ب' }, { title: 'مهمة ب' }]).length, 2);
  const meets = [{ title: 'اجتماع', date: '2026-11-01' }];
  const merged = appendUnique(meets, [{ title: 'اجتماع', date: '2026-11-01' }, { title: 'اجتماع', date: '2026-11-08' }], meetingKey);
  assert.deepEqual(merged.map((m) => m.date), ['2026-11-01', '2026-11-08']);
});

import { suggestFor, applySuggestion, repeatToday } from '../public/js/work-log-lib.js';

const S = (o) => ({ kind: 'done', title: 'x', status: '', place: '', importance: '', ...o });

test('ترشيح الاقتراحات: النوع، ثم البداية قبل الاحتواء، بلا المطابق تماماً وبحد', () => {
  const list = [
    S({ title: 'إعداد كشف الحضور' }), S({ title: 'مراجعة كشف الرواتب' }), S({ title: 'كشف العهدة' }),
    S({ kind: 'meeting', title: 'كشف اجتماع' }), S({ title: 'تحضير ورشة' }),
  ];
  assert.deepEqual(suggestFor(list, 'done', '').map((s) => s.title), ['إعداد كشف الحضور', 'مراجعة كشف الرواتب', 'كشف العهدة', 'تحضير ورشة']);
  assert.deepEqual(suggestFor(list, 'done', 'كشف').map((s) => s.title), ['كشف العهدة', 'إعداد كشف الحضور', 'مراجعة كشف الرواتب']);
  assert.deepEqual(suggestFor(list, 'done', '  كشف   العهدة ').map((s) => s.title), [], 'المطابق تماماً لا يُقترح');
  assert.equal(suggestFor(list, 'done', '', 2).length, 2);
  assert.deepEqual(suggestFor(list, 'meeting', 'كشف').map((s) => s.title), ['كشف اجتماع']);
  assert.deepEqual(suggestFor(null, 'done', 'a'), []);
});

test('تطبيق الاقتراح ينسخ العنوان وما يناسب النوع فقط، ونسخ السطر إلى اليوم', () => {
  const base = { kind: 'done', date: '2026-11-02', title: 'ك', status: '', details: 'ملاحظتي', place: '', importance: '', endDate: '' };
  assert.deepEqual(applySuggestion(base, S({ title: 'مهمة', status: 'تم الإنجاز' })), { ...base, title: 'مهمة' });
  assert.equal(applySuggestion(base, S({ title: 'مهمة', status: 'قيد التنفيذ' })).status, 'قيد التنفيذ');
  assert.equal(applySuggestion({ ...base, kind: 'meeting' }, S({ kind: 'meeting', title: 'اجتماع', place: 'القاعة', status: 'x' })).place, 'القاعة');
  assert.equal(applySuggestion({ ...base, kind: 'meeting' }, S({ kind: 'meeting', title: 'اجتماع', place: 'القاعة' })).status, '');
  assert.equal(applySuggestion({ ...base, kind: 'todo' }, S({ kind: 'todo', title: 'ق', importance: 'مهم جداً' })).importance, 'مهم جداً');
  assert.deepEqual(repeatToday({ kind: 'done', date: '2026-10-01', title: 'ت', status: 'تم الإنجاز', details: 'د', place: null }, '2026-11-02'),
    { kind: 'done', date: '2026-11-02', title: 'ت', status: 'تم الإنجاز', details: 'د', place: '' });
});
