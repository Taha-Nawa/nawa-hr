import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDay, dayTypeOf, officialHours } from '../src/engine/attendance.js';

// إعدادات مطابقة لما هو موثّق لدى الجمعية: 8:30–15:00، سماحية 10 دقائق، عطلة الجمعة والسبت.
const S = {
  start: '08:30',
  end: '15:00',
  toleranceMinutes: 10,
  weekdays: ['عمل', 'عمل', 'عمل', 'عمل', 'عمل', 'عطلة أسبوعية', 'عطلة أسبوعية'],
  leaveTypes: { 'إجازة سنوية': true, 'إجازة بدون راتب': false },
};
const day = (over) => computeDay({ date: '2026-03-02', dayType: 'عمل', movements: [], ...over }, S);
const mv = (type, time) => ({ type, time });

test('الساعات الرسمية = 6.5 من 8:30 إلى 15:00', () => assert.equal(officialHours(S), 6.5));

test('عطلة الجمعة والسبت من الإعدادات، والأحد..الخميس عمل', () => {
  assert.equal(dayTypeOf('2026-03-05', S), 'عمل');           // الخميس
  assert.equal(dayTypeOf('2026-03-06', S), 'عطلة أسبوعية');  // الجمعة
  assert.equal(dayTypeOf('2026-03-07', S), 'عطلة أسبوعية');  // السبت
  assert.equal(dayTypeOf('2026-03-08', S), 'عمل');           // الأحد
  assert.equal(dayTypeOf('2026-03-08', S, new Set(['2026-03-08'])), 'عطلة رسمية');
});

test('السماحية: 10 دقائق حاضر، 11 دقيقة متأخر، والدقائق تُحسب كاملة من بداية الدوام', () => {
  const ok = day({ movements: [mv('حضور', '08:40'), mv('انصراف', '15:00')] });
  assert.equal(ok.status, 'حاضر');
  assert.equal(ok.lateMinutes, 10);
  const late = day({ movements: [mv('حضور', '08:41'), mv('انصراف', '15:00')] });
  assert.equal(late.status, 'متأخر');
  assert.equal(late.lateMinutes, 11); // لا تُخصم السماحية من الدقائق
  assert.equal(late.deficitHours, 0.18); // 6h19m = 6.32 من 6.5
});

test('يوم كامل بلا مغادرة: ساعات معتمدة 6.5 بلا عجز ولا إضافي', () => {
  const r = day({ movements: [mv('حضور', '08:30'), mv('انصراف', '15:00')] });
  assert.deepEqual([r.netHours, r.approvedHours, r.deficitHours, r.overtimeHours], [6.5, 6.5, 0, 0]);
});

test('مغادرة ثم عودة تُخصم من صافي الساعات', () => {
  const r = day({ movements: [mv('حضور', '08:30'), mv('خروج', '11:00'), mv('عودة', '12:00'), mv('انصراف', '15:00')] });
  assert.equal(r.exitHours, 1);
  assert.equal(r.netHours, 5.5);
  assert.equal(r.deficitHours, 1);
  assert.equal(r.alert, '');
});

test('عدة أزواج خروج/عودة تُجمع، والمعروض أول خروج وآخر عودة', () => {
  const r = day({ movements: [mv('حضور', '08:30'), mv('خروج', '10:00'), mv('عودة', '10:30'), mv('خروج', '12:00'), mv('عودة', '12:45'), mv('انصراف', '15:00')] });
  assert.equal(r.exitHours, 1.25);
  assert.equal(r.exitFirst, '10:00');
  assert.equal(r.returnLast, '12:45');
});

test('خروج بلا عودة: لا تُحتسب ساعات مغادرة ويظهر تنبيه', () => {
  const r = day({ movements: [mv('حضور', '08:30'), mv('خروج', '11:00'), mv('انصراف', '15:00')] });
  assert.equal(r.exitHours, 0);
  assert.equal(r.alert, 'خروج بلا عودة');
});

test('حضور بلا انصراف: تواجد صفر وعجز كامل وتنبيه', () => {
  const r = day({ movements: [mv('حضور', '08:30')] });
  assert.equal(r.presenceHours, 0);
  assert.equal(r.deficitHours, 6.5);
  assert.equal(r.alert, 'انصراف غير مسجّل');
});

test('انصراف بلا حضور: يُحتسب غياباً مع تنبيه حضور غير مسجّل', () => {
  const r = day({ movements: [mv('انصراف', '15:00')] });
  assert.equal(r.status, 'غياب');
  assert.equal(r.alert, 'حضور غير مسجّل');
});

test('التصحيح اليدوي له الأولوية على البطاقة ويغيّر المصدر', () => {
  const r = day({ movements: [mv('حضور', '09:30'), mv('انصراف', '15:00')], manual: { in: '08:30' } });
  assert.equal(r.checkIn, '08:30');
  assert.equal(r.source, 'يدوي');
  assert.equal(r.status, 'حاضر');
});

test('مغادرة يدوية كاملة (خروج+عودة) تتقدّم على حركات البطاقة', () => {
  const r = day({ movements: [mv('حضور', '08:30'), mv('انصراف', '15:00')], manual: { out: '10:00', ret: '10:30' } });
  assert.equal(r.exitHours, 0.5);
});

test('إجازة محتسبة: تُعتمد الساعات الرسمية بلا عجز ولا تأخير', () => {
  const r = day({ leaveType: 'إجازة سنوية' });
  assert.deepEqual([r.status, r.approvedHours, r.deficitHours, r.lateMinutes], ['إجازة سنوية', 6.5, 0, 0]);
});

test('إجازة بدون راتب (غير محتسبة): تبقى الساعات المعتمدة صفراً ويظهر العجز', () => {
  const r = day({ leaveType: 'إجازة بدون راتب' });
  assert.deepEqual([r.status, r.approvedHours, r.deficitHours], ['إجازة بدون راتب', 0, 6.5]);
});

test('يوم عطلة: لا مطلوب ولا عجز ولا تنبيهات حتى لو وُجدت حركات', () => {
  const r = computeDay({ date: '2026-03-06', dayType: 'عطلة أسبوعية', movements: [mv('حضور', '09:00'), mv('انصراف', '12:00')] }, S);
  assert.deepEqual([r.status, r.requiredHours, r.deficitHours, r.lateMinutes, r.alert], ['عطلة أسبوعية', 0, 0, 0, '']);
  assert.equal(r.overtimeHours, 3); // يُحسب الإضافي كما في إكسل
});

test('انصراف مبكر بالدقائق', () => {
  const r = day({ movements: [mv('حضور', '08:30'), mv('انصراف', '14:15')] });
  assert.equal(r.earlyLeaveMinutes, 45);
});
