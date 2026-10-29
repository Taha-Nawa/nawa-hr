import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeDay, dayTypeOf } from '../src/engine/attendance.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/march-2026-golden.json', import.meta.url), 'utf-8'));
const holidays = new Set(fx.holidays);

const byDate = new Map();
for (const m of fx.movements) {
  if (m.code !== fx.employeeCode) continue;
  if (!byDate.has(m.date)) byDate.set(m.date, []);
  byDate.get(m.date).push({ type: m.type, time: m.time });
}

test(`مطابقة إكسل: كل أيام ${fx.days.length} يوماً من «${fx.source}» (كل الأعمدة)`, () => {
  const mismatches = [];
  for (const day of fx.days) {
    const got = computeDay(
      {
        date: day.date,
        dayType: dayTypeOf(day.date, fx.settings, holidays),
        movements: byDate.get(day.date) || [],
        manual: day.manual,
        leaveType: day.leaveType,
      },
      fx.settings,
    );
    for (const [field, want] of Object.entries(day.expected)) {
      if (got[field] !== want) mismatches.push(`${day.date} ${field}: إكسل=${JSON.stringify(want)} المحرك=${JSON.stringify(got[field])}`);
    }
  }
  assert.deepEqual(mismatches, [], `عدم تطابق في ${mismatches.length} خلية:\n${mismatches.slice(0, 20).join('\n')}`);
});

test('النموذج يغطي حالات متنوعة (حتى لا يكون التطابق على أيام فارغة فقط)', () => {
  const seen = new Set(fx.days.map((d) => d.expected.status));
  for (const s of ['حاضر', 'متأخر', 'غياب', 'عطلة رسمية', 'عطلة أسبوعية', 'إجازة سنوية']) {
    assert.ok(seen.has(s), `الحالة غير ممثّلة في بيانات الاختبار: ${s}`);
  }
  assert.ok(fx.days.some((d) => d.expected.exitHours > 0), 'لا يوجد يوم فيه مغادرة وعودة في بيانات الاختبار');
});
