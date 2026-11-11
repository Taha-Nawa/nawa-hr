// مزوّدو الخدمة: جدول الدوام، حساب اليوم، الحالة الحيّة، وإجمالي الشهر. نقي بلا قاعدة بيانات ولا ساعة نظام.
//
// القواعد (ثوابت في PROVIDER_RULES، وتشبه منطق الموظفين):
//  - الحصة = فترة في جدول المزوّد (يوم أسبوع + من/إلى). لا حصص خارج مدة العقد ولا في العطل الرسمية.
//  - الساعات المحتسبة = تقاطع زمن وجوده في المركز مع الحصص فقط (الوصول المبكر والبقاء بعد النهاية لا يُحتسبان).
//    التأخر أو الانصراف المبكر ضمن السماحية لا يُخصم؛ ما جاوزها يُخصم بمقداره.
//  - يوم فيه حضور بلا انصراف (في يوم مضى) لا تُحتسب ساعاته حتى يصحّحه الموظف المسؤول، ويظهر تنبيه «انصراف غير مسجّل».
//  - الغياب = حصة انتهت ولم يكن فيها المزوّد في المركز لحظة واحدة.
//  - «لم يحضر» الحيّ: بعد بداية الحصة بـ noShowMin دقيقة دون أي وجود (يطلق التنبيه).
import { toMin, round2 } from './attendance.js';
import { isTime } from '../worker/util.js';

export const PROVIDER_RULES = { lateGraceMin: 10, earlyGraceMin: 10, noShowMin: 15, maxContractDays: 731, maxSessions: 28 };
export const MOVE_TYPES = ['حضور', 'خروج', 'عودة', 'انصراف'];

const sum = (arr) => arr.reduce((a, b) => a + b, 0);

/** يتحقق من جدول الدوام ويعيد { ok, value:[{weekday,start,end}] } مرتباً، أو { error }. */
export function validateSchedule(rows) {
  if (!Array.isArray(rows)) return { error: 'جدول الدوام غير صالح' };
  if (rows.length === 0) return { error: 'أضف حصة واحدة على الأقل إلى جدول الدوام' };
  if (rows.length > PROVIDER_RULES.maxSessions) return { error: `الحد الأقصى ${PROVIDER_RULES.maxSessions} حصة في الجدول` };
  const out = [];
  for (const r of rows) {
    const weekday = Number(r?.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { error: 'يوم الحصة غير صالح' };
    if (!isTime(r?.start) || !isTime(r?.end)) return { error: 'وقت الحصة غير صالح' };
    if (toMin(r.end) <= toMin(r.start)) return { error: 'نهاية الحصة يجب أن تكون بعد بدايتها' };
    out.push({ weekday, start: r.start, end: r.end });
  }
  out.sort((a, b) => a.weekday - b.weekday || toMin(a.start) - toMin(b.start));
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1];
    const b = out[i];
    if (a.weekday === b.weekday && toMin(b.start) < toMin(a.end)) return { error: 'حصتان متداخلتان في اليوم نفسه' };
  }
  return { ok: true, value: out };
}

/** حالة العقد بالنسبة لتاريخ: upcoming | active | ended، مع الأيام المتبقية. */
export function contractState(p, today) {
  const diff = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
  if (today < p.contractStart) return { state: 'upcoming', daysTo: diff(p.contractStart, today) };
  if (today > p.contractEnd) return { state: 'ended', daysAgo: diff(today, p.contractEnd) };
  return { state: 'active', daysLeft: diff(p.contractEnd, today) };
}

/**
 * حصص اليوم (بالدقائق) من الجدول. emergency: null، أو { dismissMin } حيث null = إغلاق اليوم كاملاً.
 * خارج العقد: لا حصص. في عطلة رسمية: لا حصص الجدول الدائم، وتبقى الحصص الاستثنائية.
 */
export function sessionsOn(date, p, schedule, { holiday = false, emergency = null, extras = [] } = {}) {
  if (date < p.contractStart || date > p.contractEnd) return [];
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  // الحصص الاستثنائية (مخططة أو معتمدة) تُضاف إلى جدول اليوم، ولو في عطلة لأن الموارد البشرية قصدتها
  let list = [
    ...(holiday ? [] : schedule.filter((s) => s.weekday === dow).map((s) => ({ start: toMin(s.start), end: toMin(s.end) }))),
    ...extras.map((x) => ({ start: toMin(x.start), end: toMin(x.end), extra: x.source })),
  ].sort((a, b) => a.start - b.start);
  if (emergency) {
    if (emergency.dismissMin === null || emergency.dismissMin === undefined) return [];
    const cut = emergency.dismissMin;
    list = list.filter((s) => s.start < cut).map((s) => ({ start: s.start, end: Math.min(s.end, cut) }));
  }
  return list;
}

/**
 * يحوّل حركات اليوم إلى فترات وجود. متسامح مع الترتيب الناقص:
 *  حضور يفتح فترة، خروج يغلقها، عودة تفتح، انصراف يغلق ويُنهي اليوم.
 * يُرجع { arrive, depart, intervals:[{from,to}] مغلقة, openFrom (داخل الآن) , exits:[{out,back}], flags[] }.
 */
export function presenceOf(moves) {
  const list = moves.map((m, i) => ({ t: toMin(m.time), type: m.type, i })).sort((a, b) => a.t - b.t || a.i - b.i);
  let arrive = null;
  let depart = null;
  let openFrom = null;
  const intervals = [];
  const exits = [];
  const close = (t) => {
    if (openFrom !== null) {
      if (t > openFrom) intervals.push({ from: openFrom, to: t });
      openFrom = null;
    }
  };
  for (const m of list) {
    if (m.type === 'حضور') {
      if (arrive === null) arrive = m.t;
      if (openFrom === null) { openFrom = m.t; depart = null; }
    } else if (m.type === 'عودة') {
      if (openFrom === null) {
        openFrom = m.t;
        depart = null;
        const last = exits[exits.length - 1];
        if (last && last.back === null) last.back = m.t;
        if (arrive === null) arrive = m.t;
      }
    } else if (m.type === 'خروج') {
      if (openFrom !== null) {
        close(m.t);
        exits.push({ out: m.t, back: null });
      }
    } else if (m.type === 'انصراف') {
      close(m.t);
      depart = m.t;
    }
  }
  const flags = [];
  if (arrive !== null && depart === null) flags.push('no_depart');
  if (arrive === null && depart !== null) flags.push('no_checkin');
  if (depart === null && exits.length && exits[exits.length - 1].back === null) flags.push('exit_no_return');
  return { arrive, depart, intervals, openFrom, exits, flags };
}

const overlap = (iv, s) => {
  const a = Math.max(iv.from, s.start);
  const b = Math.min(iv.to, s.end);
  return b > a ? [a, b] : null;
};

/**
 * تقرير يوم واحد. nowMin = null ليوم مضى (الفترة المفتوحة لا تُحتسب)، أو دقائق الآن ليوم اليوم (تُحتسب حتى الآن).
 */
export function dayReport({ sessions, presence, nowMin = null, rules = PROVIDER_RULES }) {
  const live = nowMin !== null && nowMin !== undefined;
  const iv = [...presence.intervals];
  if (presence.openFrom !== null && live) iv.push({ from: presence.openFrom, to: Math.max(nowMin, presence.openFrom) });
  const unclosed = !live && presence.openFrom !== null;
  const outNow = presence.arrive !== null && presence.depart === null && presence.openFrom === null;

  const out = sessions.map((s) => {
    const parts = iv.map((x) => overlap(x, s)).filter(Boolean);
    const len = s.end - s.start;
    const base = { start: s.start, end: s.end, minutes: len };
    if (!parts.length) {
      let status;
      if (unclosed) status = 'unclosed';
      else if (!live) status = 'absent';
      else if (nowMin >= s.end) status = 'absent';
      else if (nowMin < s.start) status = 'upcoming';
      else status = nowMin >= s.start + rules.noShowMin ? 'noshow' : 'waiting';
      return { ...base, status, lateMin: 0, earlyMin: 0, outMin: 0, countedMin: 0, actualMin: 0 };
    }
    const first = parts[0][0];
    const last = parts[parts.length - 1][1];
    const counted = sum(parts.map(([a, b]) => b - a));
    const lateMin = first > s.start ? first - s.start : 0;
    // حصة جارية الآن ولم يسجّل انصرافه بعد: لا «انصراف مبكر» ما دام قد يعود أو يبقى حتى النهاية
    const ongoing = live && nowMin < s.end && presence.depart === null;
    const earlyMin = !ongoing && last < s.end ? s.end - last : 0;
    const outMin = Math.max(0, last - first - counted);
    const lateFlag = lateMin > rules.lateGraceMin;
    const earlyFlag = earlyMin > rules.earlyGraceMin;
    // السماحية: ما كان ضمنها لا يُخصم
    const forgiven = (lateFlag ? 0 : lateMin) + (earlyFlag ? 0 : earlyMin);
    const countedMin = Math.min(len, counted + forgiven);
    let status;
    if (ongoing) status = presence.openFrom === null ? 'out' : lateFlag ? 'present_late' : 'present';
    else if (lateFlag && earlyFlag) status = 'late_early';
    else if (lateFlag) status = 'late';
    else if (earlyFlag) status = 'early';
    else status = 'ok';
    return { ...base, status, lateMin, earlyMin, outMin, countedMin, actualMin: counted };
  });

  const scheduledMin = sum(out.map((x) => x.minutes));
  const countedMin = sum(out.map((x) => x.countedMin));
  const actualMin = sum(iv.map((x) => x.to - x.from));
  const lateMin = sum(out.filter((x) => x.lateMin > rules.lateGraceMin).map((x) => x.lateMin));
  const earlyMin = sum(out.filter((x) => x.earlyMin > rules.earlyGraceMin).map((x) => x.earlyMin));
  const attended = out.filter((x) => x.actualMin > 0).length;
  const absentSessions = out.filter((x) => x.status === 'absent').length;
  const unclosedDay = unclosed || (!live && presence.flags.includes('no_depart'));

  let status;
  if (!sessions.length) status = presence.arrive !== null ? 'extra' : 'none';
  else if (live && out.some((x) => ['upcoming', 'waiting', 'noshow', 'present', 'present_late', 'out'].includes(x.status))) status = 'live';
  else if (unclosedDay) status = 'unclosed';
  else if (absentSessions === out.length) status = 'absent';
  else if (absentSessions > 0) status = 'partial';
  else if (out.some((x) => x.status === 'late_early')) status = 'late_early';
  else if (out.some((x) => x.status === 'late')) status = out.some((x) => x.status === 'early') ? 'late_early' : 'late';
  else if (out.some((x) => x.status === 'early')) status = 'early';
  else status = 'ok';

  return {
    sessions: out, scheduledMin, countedMin, actualMin, lateMin, earlyMin, attended, absentSessions,
    arrive: presence.arrive, depart: presence.depart, exits: presence.exits, flags: presence.flags, outNow, status,
  };
}

/**
 * الحالة الحيّة للوحة «من في المركز الآن». state:
 *  off (لا حصة اليوم) | upcoming | waiting | noshow | present | present_late | out (خرج مؤقتاً) | left (انصرف قبل نهاية الحصة)
 *  | break (بين حصتين) | done | absent | extra (موجود خارج الجدول)
 */
export function liveState({ sessions, presence, nowMin, rules = PROVIDER_RULES }) {
  const rep = dayReport({ sessions, presence, nowMin, rules });
  const inside = presence.openFrom !== null;
  if (!sessions.length) return { state: inside ? 'extra' : 'off', session: null, report: rep };
  const ongoing = rep.sessions.find((s) => nowMin >= s.start && nowMin < s.end) || null;
  const next = rep.sessions.find((s) => nowMin < s.start) || null;
  let state;
  if (inside) state = ongoing?.status === 'present_late' ? 'present_late' : 'present';
  else if (rep.outNow) state = 'out';
  else if (ongoing && (ongoing.status === 'noshow' || ongoing.status === 'waiting')) state = ongoing.status;
  else if (ongoing) state = 'left'; // سجّل انصرافه قبل نهاية الحصة
  else if (next) state = presence.arrive !== null ? 'break' : 'upcoming';
  else state = rep.attended > 0 || presence.arrive !== null ? 'done' : 'absent';
  return { state, session: ongoing || next || rep.sessions[rep.sessions.length - 1], report: rep };
}

/** إجمالي شهر من تقارير الأيام (dayReport) — الدقائق تُحوَّل إلى ساعات بمنزلتين. */
export function monthTotals(reports) {
  const days = reports.filter((r) => r.sessions.length);
  const t = {
    sessionDays: days.length,
    attendedDays: days.filter((r) => r.attended > 0).length,
    absentDays: days.filter((r) => r.status === 'absent').length,
    lateDays: days.filter((r) => r.lateMin > 0).length,
    earlyDays: days.filter((r) => r.earlyMin > 0).length,
    unclosedDays: days.filter((r) => r.status === 'unclosed').length,
    scheduledMin: sum(days.map((r) => r.scheduledMin)),
    countedMin: sum(days.map((r) => r.countedMin)),
    actualMin: sum(reports.map((r) => r.actualMin)),
    lateMin: sum(days.map((r) => r.lateMin)),
    earlyMin: sum(days.map((r) => r.earlyMin)),
  };
  return {
    ...t,
    scheduledHours: round2(t.scheduledMin / 60),
    countedHours: round2(t.countedMin / 60),
    actualHours: round2(t.actualMin / 60),
    shortfallHours: round2(Math.max(0, t.scheduledMin - t.countedMin) / 60),
  };
}

/** رمز المزوّد العلني التالي: SP-001، SP-002، ... (من آخر رمز موجود) */
export function nextProviderCode(codes) {
  const max = codes.reduce((m, c) => {
    const n = /^SP-(\d+)$/.exec(c || '');
    return n ? Math.max(m, Number(n[1])) : m;
  }, 0);
  return `SP-${String(max + 1).padStart(3, '0')}`;
}
