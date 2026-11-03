import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleLines, scheduleSummary, fmtMin, fmtHours, contractNote, endingSoon, exitsText, dayNotes, liveInfo, dayInfo, dmy, LIVE, DAY } from '../public/js/providers-lib.js';

test('وصف الجدول يجمع الأيام ذات الوقت نفسه ويبدأ بالسبت', () => {
  const s = [
    { weekday: 3, start: '09:00', end: '13:00' },
    { weekday: 1, start: '09:00', end: '13:00' },
    { weekday: 6, start: '14:00', end: '16:00' },
  ];
  assert.deepEqual(scheduleLines(s), ['السبت: 2:00 م – 4:00 م', 'الإثنين والأربعاء: 9:00 ص – 1:00 م']);
  assert.deepEqual(scheduleLines([]), []);
  assert.equal(scheduleSummary(s), '3 حصص أسبوعياً · 10 س');
  assert.equal(scheduleSummary([s[0]]), 'حصة واحدة أسبوعياً · 4 س');
  assert.equal(scheduleSummary(s.slice(0, 2)), 'حصتان أسبوعياً · 8 س');
});

test('تنسيق المدد والساعات', () => {
  assert.equal(fmtMin(0), '—');
  assert.equal(fmtMin(45), '45 د');
  assert.equal(fmtMin(120), '2 س');
  assert.equal(fmtMin(210), '3 س 30 د');
  assert.equal(fmtHours(7.5), '7.5');
  assert.equal(fmtHours(0), '—');
  assert.equal(dmy('2026-11-02'), '02/11/2026');
});

test('ملاحظة العقد والاقتراب من الانتهاء', () => {
  assert.equal(contractNote({ state: 'active', daysLeft: 0 }), 'ينتهي اليوم');
  assert.equal(contractNote({ state: 'active', daysLeft: 1 }), 'ينتهي بعد يوم');
  assert.equal(contractNote({ state: 'active', daysLeft: 2 }), 'ينتهي بعد يومين');
  assert.equal(contractNote({ state: 'active', daysLeft: 9 }), 'ينتهي بعد 9 أيام');
  assert.equal(contractNote({ state: 'upcoming', daysTo: 3 }), 'يبدأ بعد 3 أيام');
  assert.equal(contractNote({ state: 'ended', daysAgo: 1 }), 'انتهى منذ يوم');
  assert.equal(endingSoon({ state: 'active', daysLeft: 7 }), true);
  assert.equal(endingSoon({ state: 'active', daysLeft: 8 }), false);
  assert.equal(endingSoon({ state: 'ended', daysAgo: 1 }), false);
});

test('نصوص الحركات والملاحظات', () => {
  assert.equal(exitsText([{ out: '11:00', back: '11:30' }, { out: '12:00', back: null }]), '11:00 ص ← 11:30 ص، 12:00 م ← لم يعد');
  const notes = dayNotes({ lateMin: 30, earlyMin: 15, flags: ['no_depart'], outsideContract: true, moves: [{ manual: true }] });
  assert.deepEqual(notes, ['تأخر 30 د', 'انصرف قبل النهاية بـ 15 د', 'لم يُسجَّل الانصراف', 'خارج مدة العقد', 'تعديل يدوي']);
  assert.deepEqual(dayNotes({ lateMin: 0, earlyMin: 0, flags: [], moves: [] }), []);
});

test('كل حالات المحرك لها تسمية وشارة معروفة', () => {
  for (const s of ['noshow', 'waiting', 'present_late', 'out', 'present', 'left', 'break', 'extra', 'upcoming', 'done', 'absent', 'off']) assert.ok(LIVE[s].label && LIVE[s].chip, s);
  for (const s of ['ok', 'late', 'early', 'late_early', 'absent', 'partial', 'unclosed', 'extra', 'live', 'future', 'none']) assert.ok(DAY[s].label && DAY[s].chip, s);
  assert.equal(liveInfo('???').label, LIVE.off.label);
  assert.equal(dayInfo('???').label, DAY.none.label);
});
