import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthWeeks, monthBounds, shiftMonth, monthLabel, compressDates, fmtRun, runsText, fmtLong, countByYear, balanceAfter, datesBetween, calendarWorkbook, DAY_STATE, fmtN } from '../public/js/plans-lib.js';
import { buildXlsx } from '../public/js/xlsx-write.js';

const isOff = (d) => [5, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

test('شبكة الشهر: الأحد أولاً، والخانات خارج الشهر فارغة، وكل أسبوع 7 خانات', () => {
  const w = monthWeeks('2026-11'); // 1 نوفمبر 2026 أحد
  assert.equal(w.length, 5);
  assert.ok(w.every((x) => x.length === 7));
  assert.equal(w[0][0], '2026-11-01');
  assert.equal(w[4][1], '2026-11-30');
  assert.deepEqual(w[4].slice(2), [null, null, null, null, null]);
  const dec = monthWeeks('2026-12'); // 1 ديسمبر 2026 ثلاثاء
  assert.deepEqual(dec[0].slice(0, 3), [null, null, '2026-12-01']);
  assert.equal(monthWeeks('2027-02').flat().filter(Boolean).length, 28);
  assert.deepEqual(monthBounds('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
});

test('التنقل بين الأشهر عبر حدود السنة والتسمية العربية', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-11', 14), '2028-01');
  assert.equal(monthLabel('2026-11'), 'نوفمبر 2026');
  assert.equal(datesBetween('2026-11-29', '2026-12-02').length, 4);
});

test('تجميع الأيام في فترات: العطلة الأسبوعية لا تقطع الفترة ويوم العمل الناقص يقطعها', () => {
  const runs = compressDates(['2026-11-15', '2026-11-12', '2026-11-12', '2026-11-16', '2026-11-18'], isOff);
  assert.deepEqual(runs, [{ from: '2026-11-12', to: '2026-11-16', n: 3 }, { from: '2026-11-18', to: '2026-11-18', n: 1 }]);
  assert.equal(runsText(['2026-11-12', '2026-11-15', '2026-11-16', '2026-11-18'], isOff), '12 → 16 نوفمبر (3 أيام)، 18 نوفمبر');
  assert.equal(runsText(['2026-11-12', '2026-11-15'], () => false), '12 نوفمبر، 15 نوفمبر', 'بلا معرفة العطل لا يتّصلان');
  assert.equal(fmtRun({ from: '2026-10-29', to: '2026-11-03', n: 4 }), '29 أكتوبر → 3 نوفمبر (4 أيام)');
  assert.equal(fmtRun({ from: '2026-11-01', to: '2026-11-12', n: 11 }), '1 → 12 نوفمبر (11 يوماً)');
  assert.equal(runsText([]), '—');
  assert.equal(fmtLong('2026-11-08'), 'الأحد 8 نوفمبر 2026');
  assert.deepEqual(countByYear(['2026-12-30', '2026-12-31', '2027-01-03']), { 2026: 2, 2027: 1 });
});

test('صيغة عدد الأيام العربية', () => {
  assert.deepEqual([1, 2, 3, 10, 11, 21, 0.5].map(fmtN), ['يوم واحد', 'يومان', '3 أيام', '10 أيام', '11 يوماً', '21 يوماً', '0.5 يوماً']);
});

test('الرصيد بعد الخطة: يطرح المعلّق والمخطَّط ويُنبّه عند التجاوز، وnull بلا رصيد محدد', () => {
  const bal = [{ year: 2026, items: [{ purpose: 'annual', total: 21, used: 5, pending: 2, remaining: 16 }] }];
  assert.deepEqual(balanceAfter(bal, 2026, 'annual', 3), { total: 21, remaining: 16, pending: 2, extra: 3, after: 11 });
  assert.equal(balanceAfter(bal, 2026, 'annual', 20).after, -6);
  assert.equal(balanceAfter(bal, 2026, 'other', 1), null);
  assert.equal(balanceAfter(bal, 2027, 'annual', 1), null);
  assert.equal(balanceAfter(undefined, 2026, 'annual', 1), null);
});

test('ملف إكسل: شريط الأشهر، أسماء الأيام، ألوان الحالات، العطل رمادية، والمجاميع', () => {
  const off = { '2026-10-30': 'عطلة أسبوعية', '2026-10-31': 'عطلة أسبوعية', '2026-11-06': 'عطلة أسبوعية' };
  const employees = [
    { id: 2, code: 'NW-002', name: 'موظف أ', department: 'البرامج', days: { '2026-10-29': { s: 'approved', p: 1, r: 5 }, '2026-11-02': { s: 'planned', p: 2, r: null }, '2026-11-03': { s: 'planned', p: 2, r: null }, '2026-11-04': { s: 'rejected', p: 2, r: null } } },
    { id: 3, code: 'NW-003', name: 'موظف ب', department: '', days: { '2026-11-05': { s: 'draft', p: 3, r: null } } },
  ];
  const wb = calendarWorkbook({ from: '2026-10-29', to: '2026-11-06', generated: '2026-11-02', employees, off, scopeNote: 'الكل' });
  const sh = wb.sheets[0];
  assert.equal(sh.rtl, true);
  assert.match(sh.cells.A1.v, /الإجازات المتوقعة والمعتمدة — أكتوبر 2026 إلى نوفمبر 2026/);
  // الأعمدة: A..D بيانات، E.. الأيام (9 أيام: E..M)، N أيام معتمدة، O أيام متوقعة
  assert.equal(sh.cells.E4.v, 'أكتوبر 2026');
  assert.equal(sh.cells.H4.v, 'نوفمبر 2026');
  assert.ok(sh.merges.includes('E4:G4') && sh.merges.includes('H4:M4'), sh.merges.join(' '));
  assert.deepEqual([sh.cells.E5.v, sh.cells.E6.v], ['خميس', 29]);
  assert.equal(sh.cells.F5.s, 'calOff', 'الجمعة عطلة');
  const row1 = 7;
  assert.deepEqual([sh.cells[`E${row1}`].v, sh.cells[`E${row1}`].s], ['معتمد', 'calApproved']);
  assert.deepEqual([sh.cells[`F${row1}`].v, sh.cells[`F${row1}`].s], [null, 'calOff']);
  assert.deepEqual([sh.cells[`I${row1}`].v, sh.cells[`I${row1}`].s], ['إجازة', 'calPlanned']);
  assert.deepEqual([sh.cells[`K${row1}`].v, sh.cells[`K${row1}`].s], ['مرفوض', 'calRejected']);
  assert.deepEqual([sh.cells[`L${row1 + 1}`].v, sh.cells[`L${row1 + 1}`].s], ['مسودة', 'calCell']);
  assert.deepEqual([sh.cells[`N${row1}`].v, sh.cells[`O${row1}`].v], [1, 2], 'معتمدة 1 ومتوقعة 2');
  assert.equal(sh.cells[`B${row1 + 1}`].v, 'موظف ب');
  assert.equal(sh.cells[`A${row1 + 3}`].v, 'مفتاح الألوان');
  const bytes = buildXlsx(wb);
  assert.ok(bytes.length > 2000);
  assert.deepEqual([...bytes.slice(0, 2)], [0x50, 0x4b], 'ملف zip');
  assert.ok(Object.keys(DAY_STATE).every((k) => DAY_STATE[k].cls && DAY_STATE[k].label));
});

test('إكسل لثلاثة أشهر كاملة بعشرات الموظفين يُبنى بلا أخطاء', () => {
  const employees = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, code: `NW-${i}`, name: `موظف ${i}`, department: 'ق', days: { '2026-11-10': { s: 'approved', p: null, r: 1 } } }));
  const wb = calendarWorkbook({ from: '2026-10-01', to: '2026-12-31', generated: '2026-11-02', employees, off: {} });
  assert.ok(buildXlsx(wb).length > 20000);
});
