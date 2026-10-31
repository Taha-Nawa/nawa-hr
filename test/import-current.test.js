import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSettings, extractEmployees, extractAllocations, extractDayMovements, batchByEmployee, extractCurrent } from '../public/js/import-current.js';
import { validateAllocations } from '../src/worker/projects.js';
import { validateWorkSettings } from '../src/worker/settings.js';

// صفوف اصطناعية بنفس تخطيط ملف الإدارة (بلا أي بيانات حقيقية)
const t = (h, m) => (h * 60 + m) / 1440;

const settingsSheet = [
  ...Array(14).fill([]),
  [null, 'إعدادات الدوام'],
  [null, 'السنة المالية', 2026],
  [null, 'بداية الدوام الرسمي', t(8, 30)],
  [null, 'نهاية الدوام الرسمي', t(15, 0)],
  [null, 'ساعات الدوام اليومي المعتمدة', 6.5],
  [null, 'سماحية التأخير (دقيقة)', 10],
  [null, 'عدد أيام العمل الأسبوعية', 5],
  [null, 'الحد الأعلى للمغادرات الشهرية ', 6],
  [null, null, null, null, 'أيام الأسبوع'],
  [null, null, null, null, 'اليوم', 'الحالة'],
  ...['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'].map((d) => [null, null, null, null, d, 'عمل']),
  ...['الجمعة', 'السبت'].map((d) => [null, null, null, null, d, 'عطلة أسبوعية']),
  [],
  [null, null, null, null, 'أنواع الإجازات'],
  [null, null, null, null, 'نوع الإجازة', 'محتسبة ضمن الدوام'],
  [null, null, null, null, 'إجازة سنوية', 'نعم'],
  [null, null, null, null, 'إجازة بدون راتب', 'لا'],
  [],
];

test('قراءة الإعدادات من التخطيط الحالي ومطابقتها لمتحقق الخادم', () => {
  const s = extractSettings(settingsSheet);
  assert.deepEqual(s, {
    start: '08:30', end: '15:00', toleranceMinutes: 10, monthlyExitCapHours: 6,
    weekdays: ['عمل', 'عمل', 'عمل', 'عمل', 'عمل', 'عطلة أسبوعية', 'عطلة أسبوعية'],
    leaveTypes: { 'إجازة سنوية': true, 'إجازة بدون راتب': false },
  });
  assert.ok(validateWorkSettings(s));
  assert.equal(extractSettings([[null, 'x']]), null);
});

const empSheet = [
  ['قائمة الموظفين المعتمدة'],
  ['تُعبّأ من الموارد البشرية'],
  ['الرقم الوظيفي', 'اسم الموظف', 'المسمى الوظيفي', 'الدائرة ', 'المركز', 'المدير الإداري', 'نوع التعاقد', 'تاريخ التعيين', ' 1 / الممول', ' التحميل 1'],
  ['NW-006', 'Reem S.', 'Accountant', 'Finance', 'Main Center', 'Boss B. – Director', 'Full-time', '2026-01-01', 'Funder', 1],
  [null, null],
  ['TOTAL', 'x'],
];

test('قراءة الموظفين: الحقول الإنجليزية فقط، ويُتجاهل ما ليس كود موظف', () => {
  const e = extractEmployees(empSheet);
  assert.deepEqual(e, [{ code: 'NW-006', nameEn: 'Reem S.', jobTitleEn: 'Accountant', departmentEn: 'Finance', centerEn: 'Main Center', managerLabelEn: 'Boss B. – Director', startDate: '2026-01-01' }]);
});

const allocSheet = [
  [' الموظفين على المشاريع'],
  [],
  ['الرقم الوظيفي', 'الموظف', ' / الممول', ' %', ' من تاريخ', ' الى  تاريخ', null, ': سارٍ'],
  ['NW-006', 'Reem', 'A', 0.5, '2026-01-01', '2030-12-31'],
  ['NW-006', 'Reem', 'B', 0.5, '2026-01-01', '2030-12-31'],
  ['NW-008', 'Rania', null, 1, '2026-01-01', '2030-12-31'],
  ['NW-007', 'Sam', 'A', 1, '2026-01-01', '2030-12-31'],
  ['NW-006', null, null, null, null, null],
];

test('قراءة توزيع المشاريع، وتجميع الدفعات دون فصل صفوف موظف واحد', () => {
  const a = extractAllocations(allocSheet);
  assert.equal(a.length, 4);
  assert.equal(a[2].funder, null);
  assert.ok(validateAllocations(a.filter((x) => x.code === 'NW-006').map(({ funder, share, from, to }) => ({ funder, share, from, to }))).rows);
  const batches = batchByEmployee(a, 3);
  assert.deepEqual(batches.map((b) => b.map((x) => x.code)), [['NW-006', 'NW-006', 'NW-008'], ['NW-007']]);
  const tight = batchByEmployee(a, 2);
  assert.deepEqual(tight.map((b) => b.map((x) => x.code)), [['NW-006', 'NW-006'], ['NW-008', 'NW-007']], 'موظف بصفين لا يُقسَم');
});

const movSheet = [
  ['كود الموظف', 'اسم الموظف', 'التاريخ', 'الحضور', 'الخروج (مغادرة)', 'العودة', 'الانصراف', 'نوع الإجازة', null, ' الحركة (مرجعي)', ' البحث (موظف+تاريخ)'],
  ['NW-092', 'X', '2026-08-17', t(9, 45), t(13, 33), t(13, 34), t(15, 0), null, null, 'MV-20260817094509-NW-092', 'NW-092|2026-08-17'],
  ['NW-092', 'X', '2026-08-24', t(8, 49), null, null, null, null, null, 'MV-20260824084940-NW-092', 'NW-092|2026-08-24'],
  ['NW-146', 'Y', '2026-09-02', null, null, null, t(12, 57), 'إجازة سنوية', null, 'MV-20260902125700-NW-146', 'NW-146|2026-09-02'],
];

test('تحويل الصفوف اليومية إلى حركات: معرّف مرجعي للأولى، ومشتقة ثابتة لغيرها، وتاريخ من المفتاح', () => {
  const r = extractDayMovements(movSheet);
  assert.equal(r.moves.length, 4 + 1 + 1);
  const d1 = r.moves.filter((m) => m.date === '2026-08-17');
  assert.deepEqual(d1.map((m) => [m.type, m.time, m.id]), [
    ['حضور', '09:45', 'MV-20260817094509-NW-092'],
    ['خروج', '13:33', 'MV-20260817133300-NW-092-O'],
    ['عودة', '13:34', 'MV-20260817133400-NW-092-R'],
    ['انصراف', '15:00', 'MV-20260817150000-NW-092-D'],
  ]);
  assert.equal(new Set(r.moves.map((m) => m.id)).size, r.moves.length, 'المعرّفات فريدة');
  assert.deepEqual(r.leaveDays, [{ code: 'NW-146', date: '2026-09-02', leaveType: 'إجازة سنوية' }]);
  // خروج وعودة في الدقيقة نفسها لا يتصادمان
  const same = extractDayMovements([movSheet[0], ['NW-001', 'Z', '2026-01-05', t(8, 0), t(10, 0), t(10, 0), t(15, 0), null, null, null, 'NW-001|2026-01-05']]);
  assert.equal(new Set(same.moves.map((m) => m.id)).size, 4);
});

test('extractCurrent يجمع الأوراق ويُبلغ بالعثور من عدمه', () => {
  const r = extractCurrent({ 'الإعدادات': settingsSheet, 'قائمة الموظفين': empSheet, 'توزيع المشاريع': allocSheet, 'قاعدة بيانات الحركات': movSheet });
  assert.ok(r.found && r.settings && r.employees && r.allocations && r.movements);
  assert.equal(extractCurrent({}).found, false);
});
