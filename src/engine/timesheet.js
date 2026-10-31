/**
 * التايم شيت الشهري للموظف (ملف الممولين) — يطابق صيغ شيت «monthly timesheet» في ملف الإدارة الحالي خلية بخلية.
 * دوال نقية بلا قاعدة بيانات ولا واجهة، فتُختبر منفردة وتُستعمل في الخادم وفي المتصفح.
 *
 * قواعد الشيت (كما هي في الصيغ، وليست اجتهاداً):
 *  - صفوف الممولين: التوزيعات التي تتقاطع فترتها مع الشهر، بترتيب إدخالها، وأول 3 فقط.
 *  - خلية (ممول، يوم) = الساعات المعتمدة لليوم × نسبة الممول ÷ مجموع نسب الممولين السارية في ذلك اليوم.
 *    تُترك فارغة إن لم يوجد حساب لليوم أو كان عطلة أسبوعية أو لم يسرِ أي توزيع فيه. الأيام الأخرى (بما فيها العطل الرسمية) تظهر 0 عند عدم وجود ساعات.
 *  - «العطل الرسمية»: 7.5 ساعة في يوم العطلة الرسمية.
 *  - «الإجازة السنوية»: في يوم عمل ليس إجازة مرضية: 7.5 إن كانت المعتمدة صفراً، وإلا الفرق بين ساعات الدوام اليومي والمعتمدة إن زاد عن 0.001.
 *  - «الإجازة المرضية»: 7.5 في أي يوم نوع إجازته يحتوي «مرض».
 *  - «الطارئة»: ساعة واحدة في كل يوم له ساعات معتمدة (تُكمِّل يوم الشيت إلى 7.5 مع ساعات الدوام 6.5).
 *  - «أخرى» و«بدون راتب»: صفّان يدويان بلا خلايا يومية.
 *  - عمود «Cost Center» = حصة الصف من إجمالي ساعات الممولين؛ وإن كان الإجمالي صفراً فنسبة التوزيع المدخلة.
 */

export const TIMESHEET_DAY_HOURS = 7.5;
export const MAX_FUNDER_ROWS = 3;
export const EMERGENCY_HOURS = 1;
export const SHORTFALL_EPS = 0.001;

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n) => String(n).padStart(2, '0');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
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
 */
export function buildTimesheet({ year, month, days, allocations, dayHours }) {
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

  dates.forEach((date, i) => {
    const row = days[date] || null;
    const wk = row ? num(row.approvedHours) : 0;
    const dt = row ? row.dayType : '';
    const leave = row?.leaveType || '';
    const isSick = leave.includes('مرض');

    // الممولون
    const weights = funders.map((a) => (a.from <= date && date <= a.to ? a.share : 0));
    const t = sum(weights);
    funders.forEach((_, k) => {
      if (!row || dt === 'عطلة أسبوعية' || t === 0) funderVals[k][i] = null;
      else funderVals[k][i] = (wk * weights[k]) / t;
    });

    if (dt === 'عطلة رسمية') official[i] = TIMESHEET_DAY_HOURS;
    if (row && dt === 'عمل' && !isSick) {
      if (wk > 0) {
        const short = dayHours - wk;
        annual[i] = short > SHORTFALL_EPS ? short : null;
      } else annual[i] = TIMESHEET_DAY_HOURS;
    }
    if (row && isSick) sick[i] = TIMESHEET_DAY_HOURS;
    if (row && wk > 0) emergency[i] = EMERGENCY_HOURS;
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
    others: { label: 'Others', values: blank(), total: null },
    unpaid: { label: 'Un-paid leave', values: blank(), total: null },
  };

  // المجموع اليومي: فارغ إن لم توجد أي خلية رقمية في العمود (صفر يُحسب رقماً)
  const stack = [...fRows.map((r) => r.values), rows.official.values, rows.annual.values, rows.sick.values, rows.emergency.values, rows.others.values, rows.unpaid.values];
  const totalVals = dates.map((_, i) => {
    const cells = stack.map((v) => v[i]).filter((v) => typeof v === 'number');
    return cells.length === 0 ? null : sum(cells);
  });
  const grand = sum(fRows.map((r) => r.total)) + sum([rows.official, rows.annual, rows.sick, rows.emergency].map((r) => r.total ?? 0));

  const notes = [];
  if (overlapping.length === 0) notes.push('no_allocation');
  if (overlapping.length > MAX_FUNDER_ROWS) notes.push('more_than_three');

  return { year, month, monthName: MONTH_NAMES[month - 1], daysInMonth: dim, dates, funders: fRows, ...rows, total: { label: 'Total', values: totalVals, total: grand }, notes };
}
