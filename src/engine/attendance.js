/**
 * محرك الحساب اليومي — نقل حرفي لمنطق ورقة «سجل الدوام اليومي» في ملف الإدارة.
 *
 * دالة نقية: لا قاعدة بيانات ولا شبكة ولا ساعة نظام. تعمل كما هي على Node وعلى Cloudflare Workers.
 * كل القواعد (بداية/نهاية الدوام، السماحية، أيام العطلة، أنواع الإجازات) تأتي من `settings`
 * ولا يوجد أي رقم مكتوب داخل الكود.
 *
 * ملاحظات على قواعد إكسل الأصلية نُقلت كما هي عمداً (انظر docs/DECISIONS.md):
 *  - التأخير بالدقائق يُحسب من بداية الدوام مباشرة؛ السماحية تؤثر على تسمية الحالة فقط («متأخر»).
 *  - «الخروج» المعروض هو أول خروج و«العودة» هي آخر عودة، لكن ساعات المغادرة تُجمع من كل الأزواج
 *    إذا تساوى عدد الخروج وعدد العودة، وإلا تُحتسب صفراً ويظهر تنبيه «خروج بلا عودة».
 *  - يوم فيه حضور بلا انصراف: ساعات التواجد = 0 (يظهر عجز كامل + تنبيه) حتى يُصحَّح يدوياً.
 */

export const DAY_WORK = 'عمل';
export const DAY_HOLIDAY = 'عطلة رسمية';
export const MOVE = { IN: 'حضور', OUT: 'خروج', RETURN: 'عودة', DEPART: 'انصراف' };
export const STATUS = { ABSENT: 'غياب', LATE: 'متأخر', PRESENT: 'حاضر' };
export const ALERT = {
  NO_DEPARTURE: 'انصراف غير مسجّل',
  NO_CHECKIN: 'حضور غير مسجّل',
  EXIT_NO_RETURN: 'خروج بلا عودة',
};

/** "HH:MM" -> دقائق منذ منتصف الليل (أو null) */
export function toMin(hhmm) {
  if (hhmm === null || hhmm === undefined || hhmm === '') return null;
  const [h, m] = String(hhmm).split(':');
  return Number(h) * 60 + Number(m);
}

/** دقائق -> "HH:MM" (أو null) */
export function toHHMM(min) {
  if (min === null || min === undefined) return null;
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** مثل ROUND(x, 2) في إكسل للقيم غير السالبة */
export function round2(x) {
  return Math.round(x * 100 + 1e-9) / 100;
}

/** الساعات الرسمية اليومية = (نهاية - بداية) */
export function officialHours(settings) {
  return round2((toMin(settings.end) - toMin(settings.start)) / 60);
}

/**
 * نوع اليوم: عطلة رسمية إن وُجد التاريخ في قائمة العطل، وإلا حسب يوم الأسبوع من الإعدادات.
 * settings.weekdays: مصفوفة من 7 عناصر (الأحد..السبت) قيمة كل منها «عمل» أو «عطلة أسبوعية».
 */
export function dayTypeOf(date, settings, holidays = new Set()) {
  if (holidays.has(date)) return DAY_HOLIDAY;
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = الأحد
  return settings.weekdays[dow];
}

const has = (v) => v !== null && v !== undefined && v !== '';
const sum = (a) => a.reduce((s, x) => s + x, 0);

/**
 * @param {object} input
 * @param {string} input.date                 YYYY-MM-DD
 * @param {string} input.dayType              ناتج dayTypeOf
 * @param {{type:string,time:string}[]} input.movements  حركات هذا الموظف في هذا اليوم فقط
 * @param {{in?:string,out?:string,ret?:string,dep?:string}} [input.manual]  تصحيحات يدوية (لها الأولوية)
 * @param {string} [input.leaveType]          نوع الإجازة المعتمدة لهذا اليوم أو ''
 * @param {object} settings
 */
export function computeDay(input, settings) {
  const manual = input.manual || {};
  const leaveType = input.leaveType || '';
  const dayType = input.dayType;

  const times = (type) => input.movements.filter((m) => m.type === type).map((m) => toMin(m.time));
  const ins = times(MOVE.IN);
  const outs = times(MOVE.OUT);
  const rets = times(MOVE.RETURN);
  const deps = times(MOVE.DEPART);

  const checkIn = has(manual.in) ? toMin(manual.in) : ins.length ? Math.min(...ins) : null;
  const exitFirst = has(manual.out) ? toMin(manual.out) : outs.length ? Math.min(...outs) : null;
  const returnLast = has(manual.ret) ? toMin(manual.ret) : rets.length ? Math.max(...rets) : null;
  const departure = has(manual.dep) ? toMin(manual.dep) : deps.length ? Math.max(...deps) : null;

  const anyManual = has(manual.in) || has(manual.out) || has(manual.ret) || has(manual.dep);
  const source = anyManual ? 'يدوي' : ins.length + deps.length > 0 ? 'بطاقة' : '—';

  const presenceHours =
    checkIn !== null && departure !== null ? round2(Math.max(0, departure - checkIn) / 60) : 0;

  let exitHours = 0;
  if (has(manual.out) && has(manual.ret)) {
    exitHours = round2(Math.max(0, toMin(manual.ret) - toMin(manual.out)) / 60);
  } else if (outs.length > 0 && outs.length === rets.length) {
    exitHours = round2(Math.max(0, sum(rets) - sum(outs)) / 60);
  }

  const netHours = round2(Math.max(0, presenceHours - exitHours));
  const isWork = dayType === DAY_WORK;
  const requiredHours = isWork ? officialHours(settings) : 0;

  let approvedHours = netHours;
  if (leaveType !== '' && settings.leaveTypes[leaveType] === true) {
    approvedHours = Math.max(netHours, requiredHours);
  }

  const start = toMin(settings.start);
  const end = toMin(settings.end);
  const lateMinutes = !isWork || checkIn === null || leaveType !== '' ? 0 : Math.max(0, checkIn - start);
  const earlyLeaveMinutes =
    !isWork || departure === null || leaveType !== '' ? 0 : Math.max(0, end - departure);

  const deficitHours = round2(Math.max(0, requiredHours - approvedHours));
  const overtimeHours = round2(Math.max(0, approvedHours - requiredHours));

  let status;
  if (!isWork) status = dayType;
  else if (leaveType !== '') status = leaveType;
  else if (checkIn === null) status = STATUS.ABSENT;
  else if (lateMinutes > settings.toleranceMinutes) status = STATUS.LATE;
  else status = STATUS.PRESENT;

  let alert = '';
  if (isWork && leaveType === '') {
    if (checkIn !== null && departure === null) alert = ALERT.NO_DEPARTURE;
    else if (checkIn === null && departure !== null) alert = ALERT.NO_CHECKIN;
    else if (outs.length !== rets.length) alert = ALERT.EXIT_NO_RETURN;
  }

  return {
    dayType,
    checkIn: toHHMM(checkIn),
    exitFirst: toHHMM(exitFirst),
    returnLast: toHHMM(returnLast),
    departure: toHHMM(departure),
    source,
    presenceHours,
    exitHours,
    netHours,
    requiredHours,
    approvedHours,
    lateMinutes,
    earlyLeaveMinutes,
    deficitHours,
    overtimeHours,
    status,
    alert,
  };
}
