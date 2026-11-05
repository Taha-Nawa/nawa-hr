/**
 * التايم شيت الشهري للموظف (ملف الممولين) — يطابق صيغ شيت «monthly timesheet» في ملف الإدارة الحالي خلية بخلية.
 * دوال نقية بلا قاعدة بيانات ولا واجهة، فتُختبر منفردة وتُستعمل في الخادم وفي المتصفح.
 *
 * قواعد الشيت (كما هي في الصيغ، وليست اجتهاداً):
 *  - صفوف الممولين: التوزيعات التي تتقاطع فترتها مع الشهر، بترتيب إدخالها (حتى MAX_FUNDER_ROWS صفوف؛ الشيت الأصلي ثلاثة وتتسع الأوراق لأكثر).
 *  - خلية (ممول، يوم) = الساعات المعتمدة لليوم × نسبة الممول ÷ مجموع نسب الممولين السارية في ذلك اليوم.
 *    تُترك فارغة إن لم يوجد حساب لليوم أو كان عطلة أسبوعية أو لم يسرِ أي توزيع فيه. الأيام الأخرى (بما فيها العطل الرسمية) تظهر 0 عند عدم وجود ساعات.
 *  - يوم الشيت الكامل F = ساعات الدوام الموزّعة D + الساعات الإضافية X. الافتراضي D = الدوام الرسمي (6.5) وX = 1 فتكون F = 7.5،
 *    ويغيّرها المسؤول لكل فترة (config.periods): D وX وصف الإضافي («طارئة» أو «أخرى»).
 *  - «العطل الرسمية»: F في يوم العطلة الرسمية.
 *  - «الإجازة السنوية»: في يوم عمل ليس إجازة مرضية: F إن كانت المعتمدة صفراً، وإلا الفرق بين D وساعات الدوام الموزّعة إن زاد عن 0.001.
 *  - «الإجازة المرضية»: F في أي يوم نوع إجازته يحتوي «مرض».
 *  - الإضافي X: في كل يوم له ساعات معتمدة، في صف «الطارئة» أو «أخرى» حسب الفترة (تُكمِّل يوم الشيت إلى F).
 *  - ساعات الدوام الموزّعة على الممولين = الساعات المعتمدة × (D ÷ الدوام الرسمي)؛ وعند D = الدوام الرسمي (الافتراضي) هي المعتمدة نفسها.
 *  - «بدون راتب»: صف يدوي بلا خلايا يومية. و«أخرى» يدوي إلا إن اختار المسؤول توجيه الساعات الإضافية إليه.
 *  - عمود «Cost Center» = حصة الصف من إجمالي ساعات الممولين؛ وإن كان الإجمالي صفراً فنسبة التوزيع المدخلة.
 */

import { isDate } from '../worker/util.js';

export const TIMESHEET_DAY_HOURS = 7.5; // F الافتراضي = 6.5 + 1
export const MAX_FUNDER_ROWS = 6;
export const EMERGENCY_HOURS = 1; // X الافتراضي
export const SHORTFALL_EPS = 0.001;

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n) => String(n).padStart(2, '0');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const roundH = (n) => Math.round(n * 100) / 100;

export const EXTRA_ROWS = { emergency: 'Emergency leave', other: 'Others' };
export const MAX_PERIODS = 24;

/**
 * يدمج إعداد المسؤول (إن وُجد) ويتجاهل كل قيمة غير صالحة. الشكل:
 *   { periods: [{ from: 'YYYY-MM-DD' | '', attendanceHours: رقم | null, extraHours: رقم, extraRow: 'emergency' | 'other' }] }
 * from فارغ = من البداية (فترة أساسية واحدة على الأكثر). الفترات مرتبة بتاريخ البداية. attendanceHours فارغ = الدوام الرسمي من الإعدادات.
 */
export function mergeTimesheetConfig(stored) {
  const hours = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 24 ? roundH(v) : undefined);
  const out = [];
  const seen = new Set();
  for (const p of Array.isArray(stored?.periods) ? stored.periods.slice(0, MAX_PERIODS) : []) {
    const from = p?.from === '' || p?.from === null || p?.from === undefined ? '' : isDate(p.from) ? p.from : undefined;
    const extra = hours(p?.extraHours);
    const att = p?.attendanceHours === null || p?.attendanceHours === undefined || p?.attendanceHours === '' ? null : hours(p.attendanceHours);
    if (from === undefined || extra === undefined || att === undefined || seen.has(from)) continue;
    if ((att ?? 0) + extra > 24) continue;
    seen.add(from);
    out.push({ from, attendanceHours: att, extraHours: extra, extraRow: p?.extraRow === 'other' ? 'other' : 'emergency' });
  }
  out.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  return { periods: out };
}

/** مثل mergeTimesheetConfig لكن يرفض بدل أن يتجاهل، برسالة تحدد الصف (للحفظ من الإعدادات). */
export function validateTimesheetConfig(input) {
  const list = Array.isArray(input?.periods) ? input.periods : null;
  if (!list) return { error: 'الفترات غير صالحة' };
  if (list.length > MAX_PERIODS) return { error: `الحد الأقصى ${MAX_PERIODS} فترة` };
  const hours = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 24;
  const seen = new Set();
  for (const [i, p] of list.entries()) {
    const n = i + 1;
    const from = p?.from === null || p?.from === undefined ? '' : p.from;
    if (from !== '' && !isDate(from)) return { error: `الفترة ${n}: تاريخ البداية غير صالح` };
    if (seen.has(from)) return { error: `الفترة ${n}: تاريخ بداية مكرر` };
    seen.add(from);
    const att = p?.attendanceHours === null || p?.attendanceHours === undefined || p?.attendanceHours === '' ? null : p.attendanceHours;
    if (att !== null && !hours(att)) return { error: `الفترة ${n}: ساعات الدوام يجب أن تكون بين 0 و24` };
    if (!hours(p?.extraHours)) return { error: `الفترة ${n}: الساعات الإضافية يجب أن تكون بين 0 و24 (0 = بلا ساعات إضافية)` };
    if (p.extraRow !== 'emergency' && p.extraRow !== 'other') return { error: `الفترة ${n}: اختر صف الساعات الإضافية (طارئة أو أخرى)` };
    if ((att ?? 0) + p.extraHours > 24) return { error: `الفترة ${n}: مجموع ساعات اليوم يتجاوز 24` };
  }
  return { config: mergeTimesheetConfig({ periods: list }) };
}

/** ساعات يوم الشيت لتاريخ: الفترة الأحدث التي بدأت في أو قبل التاريخ، وإلا الافتراضي. */
export function hoursFor(date, config, dayHours) {
  let hit = null;
  for (const p of config?.periods || []) if (p.from <= date) hit = p;
  const attendance = hit && hit.attendanceHours !== null ? hit.attendanceHours : dayHours;
  const extra = hit ? hit.extraHours : EMERGENCY_HOURS;
  return { attendance, extra, full: roundH(attendance + extra), extraRow: hit ? hit.extraRow : 'emergency', factor: dayHours > 0 ? attendance / dayHours : 1 };
}

const sum = (vals) => vals.reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);
const orNull = (total) => (total === 0 ? null : total);

/**
 * @param {object} p
 * @param {number} p.year
 * @param {number} p.month                      1..12
 * @param {Object<string,{dayType:string,approvedHours:number,leaveType?:string}>} p.days   مفتاحها YYYY-MM-DD؛ غياب المفتاح = لا حساب لذلك اليوم
 * @param {{funder:string,share:number,from:string,to:string}[]} p.allocations   بترتيب الإدخال
 * @param {number} p.dayHours                   ساعات الدوام اليومي الرسمي (6.5)
 * @param {object} [p.config]                   ناتج mergeTimesheetConfig (بلا إعداد = الافتراضي 6.5 + 1)
 */
export function buildTimesheet({ year, month, days, allocations, dayHours, config = null }) {
  const dim = daysInMonth(year, month);
  const first = `${year}-${pad(month)}-01`;
  const last = `${year}-${pad(month)}-${pad(dim)}`;
  const overlapping = allocations.filter((a) => a.from <= last && a.to >= first);
  const funders = overlapping.slice(0, MAX_FUNDER_ROWS);

  const dates = Array.from({ length: dim }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`);
  const blank = () => new Array(dim).fill(null);

  const funderVals = funders.map(() => blank());
  const official = blank();
  const annual = blank();
  const sick = blank();
  const emergency = blank();
  const others = blank();

  dates.forEach((date, i) => {
    const row = days[date] || null;
    const wk = row ? num(row.approvedHours) : 0;
    const dt = row ? row.dayType : '';
    const leave = row?.leaveType || '';
    const isSick = leave.includes('مرض');

    const hf = hoursFor(date, config, dayHours);
    const worked = wk * hf.factor; // الساعات الموزّعة على الممولين (= المعتمدة عند الافتراضي)

    // الممولون
    const weights = funders.map((a) => (a.from <= date && date <= a.to ? a.share : 0));
    const t = sum(weights);
    funders.forEach((_, k) => {
      if (!row || dt === 'عطلة أسبوعية' || t === 0) funderVals[k][i] = null;
      else funderVals[k][i] = (worked * weights[k]) / t;
    });

    if (dt === 'عطلة رسمية') official[i] = hf.full;
    if (row && dt === 'عمل' && !isSick) {
      if (wk > 0) {
        const short = hf.attendance - worked;
        annual[i] = short > SHORTFALL_EPS ? short : null;
      } else annual[i] = hf.full;
    }
    if (row && isSick) sick[i] = hf.full;
    if (row && wk > 0 && hf.extra > 0) (hf.extraRow === 'other' ? others : emergency)[i] = hf.extra;
  });

  const fRows = funders.map((a, k) => ({ funder: a.funder, allocationShare: a.share, values: funderVals[k], total: sum(funderVals[k]), costCenter: 0 }));
  const hoursTotal = sum(fRows.map((r) => r.total));
  for (const r of fRows) r.costCenter = hoursTotal === 0 ? r.allocationShare : r.total / hoursTotal;

  const mk = (label, values) => ({ label, values, total: orNull(sum(values)) });
  const rows = {
    official: mk('Official Holidays', official),
    annual: mk('Annual Holiday', annual),
    sick: mk('Sick Leaves', sick),
    emergency: mk('Emergency leave', emergency),
    others: mk('Others', others),
    unpaid: { label: 'Un-paid leave', values: blank(), total: null },
  };

  // المجموع اليومي: فارغ إن لم توجد أي خلية رقمية في العمود (صفر يُحسب رقماً)
  const stack = [...fRows.map((r) => r.values), rows.official.values, rows.annual.values, rows.sick.values, rows.emergency.values, rows.others.values, rows.unpaid.values];
  const totalVals = dates.map((_, i) => {
    const cells = stack.map((v) => v[i]).filter((v) => typeof v === 'number');
    return cells.length === 0 ? null : sum(cells);
  });
  const grand = sum(fRows.map((r) => r.total)) + sum([rows.official, rows.annual, rows.sick, rows.emergency, rows.others].map((r) => r.total ?? 0));

  // أيام العطلة الأسبوعية (تُظلَّل أعمدتها في الورقة): نوع اليوم في الحساب، وإن لم يوجد حساب فالجمعة والسبت
  const off = dates.map((date) => {
    const r = days[date];
    if (r) return r.dayType === 'عطلة أسبوعية';
    const w = new Date(`${date}T00:00:00Z`).getUTCDay();
    return w === 5 || w === 6;
  });

  const notes = [];
  if (overlapping.length === 0) notes.push('no_allocation');
  if (overlapping.length > MAX_FUNDER_ROWS) notes.push('too_many_funders');

  return { year, month, monthName: MONTH_NAMES[month - 1], daysInMonth: dim, dates, off, funders: fRows, ...rows, total: { label: 'Total', values: totalVals, total: grand }, notes };
}
