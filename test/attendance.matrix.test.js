import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeDay, dayTypeOf } from '../src/engine/attendance.js';

// مصفوفة اصطناعية بإعدادات ملف الإدارة الحالي (سماحية 10، الجمعة والسبت)،
// قيمها المتوقعة ناتج صيغ ملف إكسل نفسه (أُعيد حسابها في LibreOffice عبر tools/recalc_golden.py).
const fx = JSON.parse(readFileSync(new URL('./fixtures/current-model-matrix.json', import.meta.url), 'utf-8'));
const holidays = new Set(fx.holidays);

function run(day) {
  return computeDay(
    {
      date: day.date,
      dayType: dayTypeOf(day.date, fx.settings, holidays),
      movements: day.movements,
      manual: { in: '', out: '', ret: '', dep: '' },
      leaveType: day.leaveType,
    },
    fx.settings,
  );
}

test(`مصفوفة النموذج الحالي: ${fx.days.length} يوماً × كل الأعمدة تطابق صيغ إكسل`, () => {
  const mismatches = [];
  for (const day of fx.days) {
    const got = run(day);
    for (const [field, want] of Object.entries(day.expected)) {
      const ok = typeof want === 'number' ? Math.abs(got[field] - want) < 1e-9 : got[field] === want;
      if (!ok) mismatches.push(`${day.date} ${field}: إكسل=${JSON.stringify(want)} المحرك=${JSON.stringify(got[field])}`);
    }
  }
  assert.deepEqual(mismatches, [], `عدم تطابق في ${mismatches.length} خلية:\n${mismatches.slice(0, 25).join('\n')}`);
});

test('المصفوفة تغطي الحالات الحدّية: سماحية، عمل في عطلة، إجازة مع حضور، خروج بلا عودة، إضافي', () => {
  const st = new Set(fx.days.map((d) => d.expected.status));
  for (const s of ['حاضر', 'متأخر', 'غياب', 'عطلة رسمية', 'عطلة أسبوعية', 'إجازة سنوية', 'إجازة بدون راتب']) {
    assert.ok(st.has(s), `حالة غير ممثلة: ${s}`);
  }
  const some = (f) => fx.days.some(f);
  assert.ok(some((d) => d.expected.lateMinutes > 0 && d.expected.status === 'حاضر'), 'تأخير ضمن السماحية غير ممثَّل');
  assert.ok(some((d) => d.expected.lateMinutes > fx.settings.toleranceMinutes), 'تأخير خارج السماحية غير ممثَّل');
  assert.ok(some((d) => d.expected.overtimeHours > 0), 'الإضافي غير ممثَّل');
  assert.ok(some((d) => d.expected.exitHours > 0), 'مغادرة وعودة غير ممثَّلة');
  assert.ok(some((d) => d.leaveType && d.movements.length > 0), 'إجازة مع حضور غير ممثَّلة');
  assert.ok(some((d) => d.expected.dayType !== 'عمل' && d.movements.length > 0), 'عمل في عطلة غير ممثَّل');
  assert.ok(some((d) => d.movements.some((m) => m.type === 'خروج') && !d.movements.some((m) => m.type === 'عودة')), 'خروج بلا عودة غير ممثَّل');
});

test('السماحية: التأخير حتى 10 دقائق يُسامَح فلا عجز، وبعدها يظهر العجز كما في إكسل', () => {
  const day = (inTime) => ({
    date: '2026-01-04',
    movements: [{ type: 'حضور', time: inTime }, { type: 'انصراف', time: '15:00' }],
    leaveType: '',
  });
  const within = run(day('08:40'));
  assert.equal(within.lateMinutes, 10);
  assert.equal(within.status, 'حاضر');
  assert.ok(Math.abs(within.approvedHours - (6.33 + 10 / 60)) < 1e-6, `المعتمدة=${within.approvedHours}`);
  assert.equal(within.deficitHours, 0);
  const beyond = run(day('08:41'));
  assert.equal(beyond.lateMinutes, 11);
  assert.equal(beyond.status, 'متأخر');
  assert.equal(beyond.approvedHours, 6.32);
  assert.equal(beyond.deficitHours, 0.18);
});
