import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowStatus, aggregate, overall, shownPurposes, balanceWorkbook } from '../public/js/balances-lib.js';
import { allocationCheck } from '../public/js/allocations-lib.js';
import { buildXlsx } from '../public/js/xlsx-write.js';
import { validateAllocations } from '../src/worker/projects.js';

const b = (total, used = 0, pending = 0) => ({ total, used, pending, remaining: total === null ? null : total - used, source: total === null ? null : 'personal' });
const emp = (id, name, center, department, annual, sick = b(null), req = {}) => ({
  id, code: `NW-00${id}`, name, center, centerId: center ? 1 : null, department,
  balances: { annual, sick, emergency: b(null), other: b(null) },
  requests: { approved: 0, pending: 0, rejected: 0, cancelled: 0, ...req },
});
const list = [
  emp(1, 'أ', 'المبنى', 'الإدارة', b(21, 5), b(10, 1), { approved: 2, pending: 1 }),
  emp(2, 'ب', 'المبنى', 'الإدارة', b(21, 21)),
  emp(3, 'ج', 'الزيتونة', 'التعليم', b(15, 18)),
  emp(4, 'د', 'الزيتونة', 'التعليم', b(null, 3)),
];

test('حالة الموظف: ضمن الرصيد، مستنفد، متجاوز، بلا رصيد', () => {
  const P = ['annual', 'sick'];
  assert.equal(rowStatus(list[0], P).key, 'ok');
  assert.equal(rowStatus(list[1], P).key, 'out');
  assert.equal(rowStatus(list[2], P).key, 'over');
  assert.equal(rowStatus(list[3], P).key, 'none');
});

test('التجميع: المستهلك والمتبقي على من له رصيد فقط، ومن بلا رصيد يُعدّ منفصلاً', () => {
  const P = ['annual', 'sick'];
  const groups = aggregate(list, (e) => e.department, P);
  const edu = groups.find((g) => g.key === 'التعليم');
  assert.deepEqual([edu.count, edu.balances.annual.total, edu.balances.annual.used, edu.balances.annual.remaining], [2, 15, 18, -3]);
  assert.deepEqual([edu.balances.annual.withBalance, edu.balances.annual.withoutBalance, edu.balances.annual.usedWithout], [1, 1, 3]);
  assert.deepEqual(edu.statuses, { over: 1, out: 0, ok: 0, none: 1 });
  const adm = groups.find((g) => g.key === 'الإدارة');
  assert.deepEqual([adm.balances.annual.total, adm.balances.annual.used, adm.balances.annual.remaining], [42, 26, 16], 'الرصيد − المستهلك = المتبقي');
  assert.deepEqual(adm.requests, { approved: 2, pending: 1, rejected: 0, cancelled: 0 });
  const all = overall(list, P);
  assert.equal(all.count, 4);
  assert.equal(all.balances.annual.total, 57);
});

test('الأنواع المعروضة: الاعتيادية والمرضية دائماً، وغيرها عند وجود رصيد أو استهلاك أو بالطلب', () => {
  assert.deepEqual(shownPurposes(list), ['annual', 'sick']);
  const withEmergency = [...list, { ...emp(5, 'هـ', null, null, b(null)), balances: { ...emp(5).balances, emergency: b(null, 2) } }];
  assert.deepEqual(shownPurposes(withEmergency), ['annual', 'sick', 'emergency']);
  assert.deepEqual(shownPurposes(list, true), ['annual', 'sick', 'emergency', 'other']);
});

test('مصنّف التقرير: ثلاث أوراق من اليمين لليسار بعناوين ومجاميع، ويُكتب ملفاً صالحاً', () => {
  const wb = balanceWorkbook({ year: 2026, generated: '2026-11-02', employees: list, purposes: ['annual', 'sick'], scopeNote: 'المبنى' });
  assert.deepEqual(wb.sheets.map((s) => s.name), ['الموظفون', 'حسب القسم', 'حسب المركز']);
  assert.ok(wb.sheets.every((s) => s.rtl));
  const s1 = wb.sheets[0];
  assert.equal(s1.cells.A1.v, 'أرصدة الإجازات لسنة 2026');
  assert.match(s1.cells.A2.v, /صدر بتاريخ 2026-11-02 — المبنى/);
  // أعمدة: 4 ثابتة + 2 نوع × 4 + 3 طلبات + حالة
  assert.equal(s1.cells.E4.v, 'اعتيادية (سنوية)');
  assert.equal(s1.cells.E5.v, 'الرصيد');
  assert.equal(s1.cells.H5.v, 'المتبقي');
  // صف الموظف الأول: الاسم ثم 21 / 5 / 0 / 16
  assert.deepEqual([s1.cells.B6.v, s1.cells.E6.v, s1.cells.F6.v, s1.cells.G6.v, s1.cells.H6.v], ['أ', 21, 5, 0, 16]);
  assert.equal(s1.cells.E10.v, 57, 'صف المجموع بعد 4 موظفين: 21+21+15');
  assert.equal(s1.cells.A10.v, 'المجموع');
  // موظف بلا رصيد (الصف 9): خلية الرصيد والمتبقي فارغتان
  assert.deepEqual([s1.cells.E10.s, s1.cells.E9.v, s1.cells.H9.v], ['sumNum', null, null]);
  const dept = wb.sheets[1];
  assert.deepEqual([dept.cells.A6.v, dept.cells.A7.v, dept.cells.B6.v], ['الإدارة', 'التعليم', 2]);
  const bytes = buildXlsx(wb);
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), 'PK');
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /rightToLeft="1"/);
  assert.match(text, /اعتيادية \(سنوية\)/);
});

test('فحص التوزيع في المتصفح: نصفان، أربعة مشاريع، تغيير في منتصف السنة، ومجموع خاطئ', () => {
  const r = (funder, percent, from = '2026-01-01', to = '2026-12-31') => ({ funder, percent, from, to });
  assert.equal(allocationCheck([r('A', 50), r('B', 50)]).valid, true);
  assert.equal(allocationCheck([r('A', 40), r('B', 30), r('C', 20), r('D', 10)]).valid, true);
  assert.equal(allocationCheck([r('A', 33.33), r('B', 33.33), r('C', 33.34)]).valid, true);
  assert.equal(allocationCheck([r('A', 33.33), r('B', 33.33), r('C', 33.33)]).valid, true, 'فرق 0.01% مقبول كما في الخادم');
  const bad = allocationCheck([r('A', 50), r('B', 40)]);
  assert.equal(bad.valid, false);
  assert.match(bad.segments[0].reason, /90%/);
  // انتقال: A 100% حتى 30 يونيو ثم A 50 + B 50
  const mid = allocationCheck([r('A', 100, '2026-01-01', '2026-06-30'), r('A', 50, '2026-07-01', '2026-12-31'), r('B', 50, '2026-07-01', '2026-12-31')]);
  assert.equal(mid.valid, true);
  assert.deepEqual(mid.segments.map((s) => [s.from, s.to, s.total]), [['2026-01-01', '2026-06-30', 100], ['2026-07-01', '2026-12-31', 100]]);
  assert.equal(allocationCheck([r('', 100)]).valid, false);
  assert.equal(allocationCheck([]).valid, false);
  assert.equal(allocationCheck(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((f) => r(f, 100 / 7))).valid, false, 'أكثر من 6 متزامنة');
});

test('الفحص في المتصفح يطابق الخادم على الحالات نفسها', () => {
  const cases = [
    [[['A', 50], ['B', 50]], true],
    [[['A', 33.33], ['B', 33.33], ['C', 33.33]], true],
    [[['A', 50], ['B', 40]], false],
    [[['A', 25], ['B', 25], ['C', 25], ['D', 24]], false],
    [[['A', 40], ['B', 30], ['C', 20], ['D', 10]], true],
  ];
  for (const [pairs, expected] of cases) {
    const client = allocationCheck(pairs.map(([funder, percent]) => ({ funder, percent, from: '2026-01-01', to: '2026-12-31' }))).valid;
    const server = !!validateAllocations(pairs.map(([funder, percent]) => ({ funder, share: Math.round(percent * 100) / 10000, from: '2026-01-01', to: '2026-12-31' }))).rows;
    assert.deepEqual([client, server], [expected, expected], JSON.stringify(pairs));
  }
});
