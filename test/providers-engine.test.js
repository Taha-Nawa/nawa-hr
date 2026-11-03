import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSchedule, contractState, sessionsOn, presenceOf, dayReport, liveState, monthTotals, nextProviderCode, PROVIDER_RULES } from '../src/engine/providers.js';
import { toMin } from '../src/engine/attendance.js';

const MON = '2026-11-02'; // الإثنين
const dow = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const P = { contractStart: '2026-10-01', contractEnd: '2026-12-31' };
const SCHED = [{ weekday: dow(MON), start: '09:00', end: '13:00' }];
const mv = (type, time) => ({ type, time });
const day = (moves, { sessions = sessionsOn(MON, P, SCHED), nowMin = null } = {}) => dayReport({ sessions, presence: presenceOf(moves), nowMin });
const m = toMin;

test('تحقق جدول الدوام: ترتيب، تداخل، حدود', () => {
  const ok = validateSchedule([{ weekday: 3, start: '10:00', end: '12:00' }, { weekday: 1, start: '09:00', end: '11:00' }, { weekday: 1, start: '11:00', end: '12:00' }]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value.map((x) => `${x.weekday}@${x.start}`), ['1@09:00', '1@11:00', '3@10:00']);
  assert.match(validateSchedule([]).error, /حصة واحدة/);
  assert.match(validateSchedule([{ weekday: 1, start: '09:00', end: '11:00' }, { weekday: 1, start: '10:30', end: '12:00' }]).error, /متداخلتان/);
  assert.match(validateSchedule([{ weekday: 1, start: '11:00', end: '09:00' }]).error, /بعد بدايتها/);
  assert.match(validateSchedule([{ weekday: 7, start: '09:00', end: '10:00' }]).error, /يوم الحصة/);
  assert.match(validateSchedule([{ weekday: 1, start: '9:00', end: '10:00' }]).error, /وقت الحصة/);
  assert.match(validateSchedule('x').error, /غير صالح/);
  assert.match(validateSchedule(Array.from({ length: 29 }, (_, i) => ({ weekday: i % 7, start: '08:00', end: '09:00' }))).error, /الحد الأقصى/);
});

test('حالة العقد: قادم، ساري، منتهٍ', () => {
  assert.deepEqual(contractState(P, '2026-09-28'), { state: 'upcoming', daysTo: 3 });
  assert.deepEqual(contractState(P, '2026-12-30'), { state: 'active', daysLeft: 1 });
  assert.deepEqual(contractState(P, '2026-12-31'), { state: 'active', daysLeft: 0 });
  assert.deepEqual(contractState(P, '2027-01-02'), { state: 'ended', daysAgo: 2 });
});

test('حصص اليوم: حسب يوم الأسبوع ومدة العقد والعطلة والطارئ', () => {
  assert.deepEqual(sessionsOn(MON, P, SCHED), [{ start: 540, end: 780 }]);
  assert.deepEqual(sessionsOn('2026-11-03', P, SCHED), []); // الثلاثاء
  assert.deepEqual(sessionsOn(MON, { ...P, contractStart: '2026-11-03' }, SCHED), []);
  assert.deepEqual(sessionsOn(MON, { ...P, contractEnd: '2026-11-01' }, SCHED), []);
  assert.deepEqual(sessionsOn(MON, P, SCHED, { holiday: true }), []);
  assert.deepEqual(sessionsOn(MON, P, SCHED, { emergency: { dismissMin: null } }), []);
  assert.deepEqual(sessionsOn(MON, P, SCHED, { emergency: { dismissMin: m('11:00') } }), [{ start: 540, end: 660 }]);
  assert.deepEqual(sessionsOn(MON, P, SCHED, { emergency: { dismissMin: m('08:30') } }), []);
});

test('فترات الوجود: خروج وعودة، أعلام النقص، الحركات غير مرتبة', () => {
  const p = presenceOf([mv('انصراف', '13:00'), mv('عودة', '11:30'), mv('حضور', '09:00'), mv('خروج', '11:00')]);
  assert.deepEqual(p.intervals, [{ from: 540, to: 660 }, { from: 690, to: 780 }]);
  assert.equal(p.arrive, 540);
  assert.equal(p.depart, 780);
  assert.deepEqual(p.exits, [{ out: 660, back: 690 }]);
  assert.deepEqual(p.flags, []);
  assert.deepEqual(presenceOf([mv('حضور', '09:00')]).flags, ['no_depart']);
  assert.deepEqual(presenceOf([mv('انصراف', '13:00')]).flags, ['no_checkin']);
  assert.deepEqual(presenceOf([mv('حضور', '09:00'), mv('خروج', '10:00')]).flags, ['no_depart', 'exit_no_return']);
  assert.deepEqual(presenceOf([mv('حضور', '09:00'), mv('حضور', '09:05'), mv('انصراف', '12:00')]).intervals, [{ from: 540, to: 720 }]);
});

test('يوم مضى: التزام كامل، تأخر، انصراف مبكر، خروج، غياب', () => {
  const ok = day([mv('حضور', '08:55'), mv('انصراف', '13:05')]);
  assert.equal(ok.status, 'ok');
  assert.equal(ok.countedMin, 240); // الوصول المبكر والبقاء بعد النهاية لا يُحتسبان
  assert.equal(ok.actualMin, 250);
  assert.equal(ok.lateMin, 0);

  const grace = day([mv('حضور', '09:08'), mv('انصراف', '12:55')]);
  assert.equal(grace.status, 'ok');
  assert.equal(grace.countedMin, 240); // ضمن السماحية لا يُخصم
  assert.equal(grace.lateMin, 0);

  const late = day([mv('حضور', '09:30'), mv('انصراف', '13:00')]);
  assert.equal(late.status, 'late');
  assert.equal(late.lateMin, 30);
  assert.equal(late.countedMin, 210);

  const early = day([mv('حضور', '09:00'), mv('انصراف', '12:20')]);
  assert.equal(early.status, 'early');
  assert.equal(early.earlyMin, 40);
  assert.equal(early.countedMin, 200);

  const both = day([mv('حضور', '09:30'), mv('انصراف', '12:00')]);
  assert.equal(both.status, 'late_early');
  assert.equal(both.countedMin, 150);

  const out = day([mv('حضور', '09:00'), mv('خروج', '11:00'), mv('عودة', '11:30'), mv('انصراف', '13:00')]);
  assert.equal(out.countedMin, 210);
  assert.equal(out.sessions[0].outMin, 30);
  assert.equal(out.status, 'ok');

  const absent = day([]);
  assert.equal(absent.status, 'absent');
  assert.equal(absent.absentSessions, 1);
  assert.equal(absent.countedMin, 0);
});

test('حضور بلا انصراف في يوم مضى لا يُحتسب ويُصنَّف «انصراف غير مسجّل»', () => {
  const r = day([mv('حضور', '09:00')]);
  assert.equal(r.status, 'unclosed');
  assert.equal(r.countedMin, 0);
  assert.ok(r.flags.includes('no_depart'));
  assert.equal(r.absentSessions, 0);
});

test('حصتان في يوم واحد: الفاصل بينهما لا يُحتسب', () => {
  const sessions = sessionsOn(MON, P, [{ weekday: dow(MON), start: '09:00', end: '11:00' }, { weekday: dow(MON), start: '12:00', end: '14:00' }]);
  const r = day([mv('حضور', '09:00'), mv('خروج', '11:00'), mv('عودة', '12:00'), mv('انصراف', '14:00')], { sessions });
  assert.equal(r.status, 'ok');
  assert.equal(r.scheduledMin, 240);
  assert.equal(r.countedMin, 240);
  assert.equal(r.actualMin, 240);
  const half = day([mv('حضور', '09:00'), mv('انصراف', '11:00')], { sessions });
  assert.equal(half.status, 'partial');
  assert.equal(half.absentSessions, 1);
  assert.equal(half.countedMin, 120);
});

test('الحالة الحيّة خلال اليوم', () => {
  const sessions = sessionsOn(MON, P, SCHED);
  const at = (moves, hhmm) => liveState({ sessions, presence: presenceOf(moves), nowMin: m(hhmm) });
  assert.equal(at([], '08:00').state, 'upcoming');
  assert.equal(at([], '09:10').state, 'waiting');
  assert.equal(at([], '09:15').state, 'noshow');
  assert.equal(at([], '12:00').state, 'noshow');
  assert.equal(at([], '13:30').state, 'absent');
  assert.equal(at([mv('حضور', '08:50')], '09:30').state, 'present');
  assert.equal(at([mv('حضور', '09:25')], '10:00').state, 'present_late');
  assert.equal(at([mv('حضور', '09:00'), mv('خروج', '10:30')], '10:45').state, 'out');
  assert.equal(at([mv('حضور', '09:00'), mv('انصراف', '11:30')], '12:00').state, 'left');
  assert.equal(at([mv('حضور', '09:00'), mv('انصراف', '13:00')], '14:00').state, 'done');
  assert.equal(liveState({ sessions: [], presence: presenceOf([]), nowMin: 600 }).state, 'off');
  assert.equal(liveState({ sessions: [], presence: presenceOf([mv('حضور', '09:00')]), nowMin: 600 }).state, 'extra');
  // يوم اليوم: الفترة المفتوحة تُحتسب حتى الآن
  assert.equal(at([mv('حضور', '09:00')], '10:00').report.countedMin, 60);
  assert.equal(at([mv('حضور', '09:00')], '10:00').report.sessions[0].status, 'present');
});

test('بين حصتين: «استراحة» لا غياب', () => {
  const sessions = sessionsOn(MON, P, [{ weekday: dow(MON), start: '09:00', end: '11:00' }, { weekday: dow(MON), start: '13:00', end: '15:00' }]);
  const r = liveState({ sessions, presence: presenceOf([mv('حضور', '09:00'), mv('انصراف', '11:00')]), nowMin: m('12:00') });
  assert.equal(r.state, 'break');
  const r2 = liveState({ sessions, presence: presenceOf([]), nowMin: m('12:00') });
  assert.equal(r2.state, 'upcoming');
});

test('إجمالي الشهر: ساعات محتسبة مقابل المجدولة', () => {
  const a = day([mv('حضور', '09:00'), mv('انصراف', '13:00')]);
  const b = day([mv('حضور', '09:30'), mv('انصراف', '13:00')]);
  const c = day([]);
  const d = dayReport({ sessions: [], presence: presenceOf([]) });
  const t = monthTotals([a, b, c, d]);
  assert.equal(t.sessionDays, 3);
  assert.equal(t.attendedDays, 2);
  assert.equal(t.absentDays, 1);
  assert.equal(t.lateDays, 1);
  assert.equal(t.lateMin, 30);
  assert.equal(t.scheduledHours, 12);
  assert.equal(t.countedHours, 7.5);
  assert.equal(t.shortfallHours, 4.5);
});

test('رمز المزوّد التالي', () => {
  assert.equal(nextProviderCode([]), 'SP-001');
  assert.equal(nextProviderCode(['SP-001', 'SP-009', 'NW-100']), 'SP-010');
  assert.ok(PROVIDER_RULES.noShowMin > 0);
});
