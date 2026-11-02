// منطق كشوف الحضور المطبوعة (الأسبوعي والمتطوعين): أسبوع السبت→الخميس، الترقيم، الخلايا، وحساب ساعات المتطوع.
import test from 'node:test';
import assert from 'node:assert/strict';
import { weekStart, weekDates, paginate, groupByCenter, cellFor, compact12, monthDays, shiftMonthStr, printableDays, hoursOf, totalsOf } from '../public/js/sheet-lib.js';
import { volunteerHours, monthTotals } from '../src/engine/volunteers.js';

test('weekStart: أقرب سبت في أو قبل التاريخ', () => {
  assert.equal(weekStart('2026-10-31'), '2026-10-31'); // سبت
  assert.equal(weekStart('2026-11-01'), '2026-10-31'); // أحد
  assert.equal(weekStart('2026-11-02'), '2026-10-31'); // اثنين
  assert.equal(weekStart('2026-11-05'), '2026-10-31'); // خميس
  assert.equal(weekStart('2026-11-06'), '2026-10-31'); // جمعة
  assert.equal(weekStart('2026-11-07'), '2026-11-07'); // سبت
});

test('weekDates: ستة أيام من السبت إلى الخميس', () => {
  const d = weekDates('2026-10-31');
  assert.deepEqual(d, ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
  assert.deepEqual(d.map((x) => new Date(`${x}T00:00:00Z`).getUTCDay()), [6, 0, 1, 2, 3, 4]);
});

test('paginate: 16 صفاً في الصفحة وتُكمَّل الأخيرة بصفوف فارغة', () => {
  const pages = paginate(Array.from({ length: 18 }, (_, i) => ({ i })));
  assert.equal(pages.length, 2);
  assert.ok(pages.every((p) => p.length === 16));
  assert.equal(pages[0].filter(Boolean).length, 16);
  assert.equal(pages[1].filter(Boolean).length, 2);
  assert.equal(paginate([]).length, 0);
  assert.equal(paginate([{ a: 1 }])[0].length, 16);
});

test('groupByCenter: مجموعات حسب المركز وبلا مركز في الآخر', () => {
  const g = groupByCenter([{ n: 1, center: 'مركز ب' }, { n: 2, center: null }, { n: 3, center: 'مركز أ' }, { n: 4, center: 'مركز ب' }]);
  assert.deepEqual(g.map((x) => [x.center, x.list.map((e) => e.n)]), [['مركز أ', [3]], ['مركز ب', [1, 4]], ['', [2]]]);
});

test('cellFor: فارغ، عطلة، إجازة، غياب، أوقات', () => {
  const today = '2026-11-02';
  const work = { dayType: 'عمل', status: 'حاضر', checkIn: '08:05', exitFirst: '12:00', returnLast: '12:30', departure: '15:00' };
  assert.deepEqual(cellFor(work, '2026-11-01', today, true), { kind: 'times', in: '08:05', out: '12:00', ret: '12:30', dep: '15:00' });
  assert.deepEqual(cellFor(work, '2026-11-01', today, false), { kind: 'blank' }, 'نموذج فارغ');
  assert.deepEqual(cellFor(undefined, '2026-11-01', today, true), { kind: 'blank' });
  assert.deepEqual(cellFor(work, '2026-11-03', today, true), { kind: 'blank' }, 'يوم مستقبلي');
  assert.deepEqual(cellFor({ dayType: 'عطلة رسمية', status: 'عطلة رسمية' }, '2026-11-01', today), { kind: 'label', text: 'عطلة رسمية' });
  assert.deepEqual(cellFor({ dayType: 'عمل', status: 'إجازة سنوية' }, '2026-11-01', today), { kind: 'label', text: 'إجازة سنوية' });
  assert.deepEqual(cellFor({ dayType: 'عمل', status: 'غياب' }, '2026-11-01', today), { kind: 'label', text: 'غياب' });
  assert.deepEqual(cellFor({ dayType: 'عمل', status: 'غياب' }, today, today), { kind: 'blank' }, 'اليوم لم ينتهِ: لا يُكتب غياب');
  assert.equal(cellFor({ dayType: 'عمل', status: 'متأخر', checkIn: '09:10' }, '2026-11-01', today).kind, 'times');
});

test('compact12', () => {
  assert.equal(compact12('14:05'), '2:05م');
  assert.equal(compact12('00:30'), '12:30ص');
  assert.equal(compact12(null), '');
});

test('monthDays / shiftMonthStr / printableDays', () => {
  assert.equal(monthDays('2026-02').length, 28);
  assert.equal(monthDays('2028-02').length, 29);
  assert.equal(shiftMonthStr('2026-12', 1), '2027-01');
  assert.equal(shiftMonthStr('2026-01', -1), '2025-12');
  assert.equal(printableDays('2026-11', []).length, 26); // 30 يوماً − 4 جمع
  const withFri = printableDays('2026-11', [{ date: '2026-11-06' }]);
  assert.equal(withFri.length, 27);
  assert.ok(withFri.some((d) => d.date === '2026-11-06'));
});

test('hoursOf يطابق حساب الخادم لكل التركيبات', () => {
  const times = [null, '08:00', '09:30', '12:00', '12:45', '14:00', '15:30'];
  let n = 0;
  for (const arrive of times) for (const depart of times) for (const exit of times) for (const ret of times) {
    const d = { arrive, depart, exit, ret };
    assert.equal(hoursOf(d), volunteerHours(d), JSON.stringify(d));
    n++;
  }
  assert.ok(n > 2000);
  const days = [{ arrive: '09:00', depart: '14:00' }, { arrive: '10:00', depart: '13:30', exit: '11:00', ret: '11:30' }, { arrive: null, depart: null }];
  assert.deepEqual(totalsOf(days), monthTotals(days));
  assert.deepEqual(totalsOf(days), { days: 2, hours: 8 });
});
