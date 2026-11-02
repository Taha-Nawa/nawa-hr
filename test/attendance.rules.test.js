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

// ---------------------------------------------------------------- أذونات المغادرة والتأخير المعتمدة
test('إذن التأخير المعتمد يعفي من التأخير ومن عجز الساعات بقدره', () => {
  const base = day({ movements: [mv('حضور', '09:50'), mv('انصراف', '15:00')] });
  assert.equal(base.status, 'متأخر');
  assert.equal(base.deficitHours, 1.33);
  const ex = day({ movements: [mv('حضور', '09:50'), mv('انصراف', '15:00')], permit: { late: 90 } });
  assert.equal(ex.lateMinutes, 0);
  assert.equal(ex.status, 'حاضر');
  assert.equal(ex.approvedHours, 6.5);
  assert.equal(ex.deficitHours, 0);
  // تجاوز الإذن: 20 دقيقة بعد نهايته تبقى تأخيراً، والعجز يقلّ بقدر الإذن فقط
  const over = day({ movements: [mv('حضور', '10:20'), mv('انصراف', '15:00')], permit: { late: 90 } });
  assert.equal(over.lateMinutes, 20);
  assert.equal(over.status, 'متأخر');
  assert.equal(over.deficitHours, 0.33);
});

test('إذن المغادرة المعتمد يعوّض ساعات الخروج، والزيادة على الإذن تبقى عجزاً', () => {
  const inside = day({ movements: [mv('حضور', '08:30'), mv('خروج', '10:00'), mv('عودة', '11:15'), mv('انصراف', '15:00')], permit: { exit: 90 } });
  assert.equal(inside.exitHours, 1.25);
  assert.equal(inside.deficitHours, 0);
  const beyond = day({ movements: [mv('حضور', '08:30'), mv('خروج', '10:00'), mv('عودة', '12:00'), mv('انصراف', '15:00')], permit: { exit: 90 } });
  assert.equal(beyond.exitHours, 2);
  assert.equal(beyond.deficitHours, 0.5);
  // المغادرة بلا عودة (انصراف مبكر) بإذن: ينقص اليوم فيُعوَّض بقدر الإذن
  const early = day({ movements: [mv('حضور', '08:30'), mv('انصراف', '13:30')], permit: { exit: 90 } });
  assert.equal(early.deficitHours, 0);
});

test('الإذن لا يعوّض الغياب ولا يغيّر يوم الإجازة ولا الإضافي، وبلا إذن النتائج كما كانت', () => {
  assert.equal(day({ permit: { exit: 120, late: 120 } }).status, 'غياب');
  assert.equal(day({ permit: { exit: 120 } }).deficitHours, 6.5);
  const leave = day({ leaveType: 'إجازة سنوية', permit: { exit: 120 } });
  assert.deepEqual([leave.approvedHours, leave.deficitHours], [6.5, 0]);
  const ot = day({ movements: [mv('حضور', '08:30'), mv('انصراف', '17:30')], permit: { exit: 60 } });
  assert.equal(ot.overtimeHours, 2.5);
  const same = day({ movements: [mv('حضور', '08:50'), mv('انصراف', '14:00')] });
  assert.deepEqual(day({ movements: [mv('حضور', '08:50'), mv('انصراف', '14:00')], permit: { exit: 0, late: 0 } }), same);
});

test('الإخلاء الفوري: ينتهي الدوام عند وقته فلا عجز ولا انصراف مبكر لمن بقي، ومن لم يسجّل انصرافه يُعدّ منصرفاً عنده', () => {
  // أُخلي المركز عند 11:00 (الدوام الفعلي 8:30–11:00 = 2.5 ساعة)
  const stayed = day({ movements: [mv('حضور', '08:30'), mv('انصراف', '11:00')], dismissAt: '11:00' });
  assert.deepEqual([stayed.requiredHours, stayed.approvedHours, stayed.deficitHours, stayed.earlyLeaveMinutes], [2.5, 2.5, 0, 0]);
  // بلا إخلاء نفسُ الحركات عجزٌ وانصراف مبكر (القاعدة الأصلية)
  const without = day({ movements: [mv('حضور', '08:30'), mv('انصراف', '11:00')] });
  assert.deepEqual([without.requiredHours, without.deficitHours, without.earlyLeaveMinutes], [6.5, 4, 240]);
  // خرج مسرعاً بلا تسجيل انصراف: يُحتسب منصرفاً عند وقت الإخلاء ولا يظهر تنبيه
  const rushed = day({ movements: [mv('حضور', '08:30')], dismissAt: '11:00' });
  assert.deepEqual([rushed.departure, rushed.presenceHours, rushed.deficitHours, rushed.alert], ['11:00', 2.5, 0, '']);
  // حضر متأخراً قبل الإخلاء: التأخير والعجز يُحسبان على الدوام الفعلي
  const lateIn = day({ movements: [mv('حضور', '09:30')], dismissAt: '11:00' });
  assert.deepEqual([lateIn.lateMinutes, lateIn.status, lateIn.approvedHours, lateIn.deficitHours], [60, 'متأخر', 1.5, 1]);
  // من لم يحضر قبل الإخلاء غائب كما هو، ومن حضر بعده لا يُعدّ حاضراً قبله
  assert.equal(day({ dismissAt: '11:00' }).status, 'غياب');
  assert.equal(day({ movements: [mv('حضور', '12:00')], dismissAt: '11:00' }).departure, null);
});

test('الإخلاء الفوري لا يغيّر يوم الإجازة ولا العطلة ولا وقتاً بعد نهاية الدوام، وبلا إخلاء النتائج كما كانت', () => {
  const leave = day({ leaveType: 'إجازة سنوية', dismissAt: '11:00' });
  assert.deepEqual([leave.requiredHours, leave.approvedHours, leave.deficitHours], [6.5, 6.5, 0]);
  const off = computeDay({ date: '2026-03-06', dayType: 'عطلة أسبوعية', movements: [], dismissAt: '11:00' }, S);
  assert.equal(off.requiredHours, 0);
  const late = day({ movements: [mv('حضور', '08:30'), mv('انصراف', '15:00')], dismissAt: '16:00' });
  assert.deepEqual([late.requiredHours, late.deficitHours], [6.5, 0]);
  const plain = day({ movements: [mv('حضور', '08:50'), mv('انصراف', '14:00')] });
  assert.deepEqual(day({ movements: [mv('حضور', '08:50'), mv('انصراف', '14:00')], dismissAt: null }), plain);
  assert.deepEqual(day({ movements: [mv('حضور', '08:50'), mv('انصراف', '14:00')], dismissAt: '' }), plain);
});
