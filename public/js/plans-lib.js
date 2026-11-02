// منطق نقي لصفحة «الإجازات المتوقعة»: شبكة الشهر، تجميع الأيام في فترات، الرصيد بعد الخطة، وبناء ملف إكسل بشكل جدول الإجازات
// الذي تعتمده الإدارة (أخضر معتمد / أصفر متوقعة بانتظار القرار / أحمر مرفوض / رمادي عطلة). بلا DOM فيُختبر في Node.
import { colName } from './xlsx-write.js';
import { AR_DAYS, AR_MONTHS, addDays } from './dom.js';

export const PLAN_PURPOSE = { annual: 'اعتيادية (سنوية)', other: 'أخرى' };
export const PLAN_STATUS = {
  draft: ['مسودة', 'chip-leave'],
  submitted: ['بانتظار القرار', 'chip-late'],
  approved: ['معتمدة', 'chip-present'],
  rejected: ['مرفوضة', 'chip-absent'],
  cancelled: ['ملغاة', 'chip-off'],
};
// حالة اليوم في التقويم: النص الكامل (للقراءة بالشاشة والتلميح) والنص المختصر داخل الخلية وفئة اللون
export const DAY_STATE = {
  approved: { label: 'معتمد', short: 'معتمد', cls: 'cal-approved' },
  planned: { label: 'إجازة متوقعة بانتظار القرار', short: 'متوقعة', cls: 'cal-planned' },
  draft: { label: 'مسودة لم تُرسَل بعد', short: 'مسودة', cls: 'cal-draft' },
  rejected: { label: 'مرفوض', short: 'مرفوض', cls: 'cal-rejected' },
};

const pad = (n) => String(n).padStart(2, '0');
const r2 = (n) => Math.round(n * 100) / 100;

/** عدد أيام بصيغة عربية سليمة: يوم واحد / يومان / 5 أيام / 12 يوماً */
export const fmtN = (n) => {
  const v = r2(n);
  return v === 1 ? 'يوم واحد' : v === 2 ? 'يومان' : `${v} ${Number.isInteger(v) && v >= 3 && v <= 10 ? 'أيام' : 'يوماً'}`;
};

export const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${AR_MONTHS[m - 1]} ${y}`;
};

export function monthBounds(ym) {
  const [y, m] = ym.split('-').map(Number);
  return { from: `${ym}-01`, to: `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}` };
}

export function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** أسابيع الشهر (الأحد أولاً): كل أسبوع 7 خانات، تاريخ أو null للخانات خارج الشهر. */
export function monthWeeks(ym) {
  const { from, to } = monthBounds(ym);
  const lead = new Date(`${from}T00:00:00Z`).getUTCDay();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: Number(to.slice(8)) }, (_, i) => `${ym}-${pad(i + 1)}`)];
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** كل تواريخ مدى (شاملاً الطرفين). */
export function datesBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * يجمع تواريخ في فترات: يتّصل اليومان إن لم يفصل بينهما إلا أيام عطلة (isOff) كالجمعة والسبت.
 * @returns {{from:string,to:string,n:number}[]}
 */
export function compressDates(dates, isOff = () => false) {
  const runs = [];
  for (const d of [...new Set(dates)].sort()) {
    const last = runs[runs.length - 1];
    if (last) {
      let cur = addDays(last.to, 1);
      while (cur < d && isOff(cur)) cur = addDays(cur, 1);
      if (cur === d) {
        last.to = d;
        last.n += 1;
        continue;
      }
    }
    runs.push({ from: d, to: d, n: 1 });
  }
  return runs;
}

const dm = (d) => `${Number(d.slice(8))} ${AR_MONTHS[Number(d.slice(5, 7)) - 1]}`;
export const fmtShort = (d) => dm(d);
export const fmtLong = (d) => {
  const t = new Date(`${d}T00:00:00Z`);
  return `${AR_DAYS[t.getUTCDay()]} ${dm(d)} ${d.slice(0, 4)}`;
};

/** «8 → 10 نوفمبر (3 أيام)» أو «8 نوفمبر». */
export function fmtRun(r) {
  if (r.from === r.to) return dm(r.from);
  const sameMonth = r.from.slice(0, 7) === r.to.slice(0, 7);
  const span = sameMonth ? `${Number(r.from.slice(8))} → ${dm(r.to)}` : `${dm(r.from)} → ${dm(r.to)}`;
  return `${span} (${r.n} ${r.n <= 10 ? 'أيام' : 'يوماً'})`;
}

export const runsText = (dates, isOff) => compressDates(dates, isOff).map(fmtRun).join('، ') || '—';

/** عدد الأيام حسب السنة: { 2026: 3, 2027: 2 } */
export function countByYear(dates) {
  const out = {};
  for (const d of dates) out[d.slice(0, 4)] = (out[d.slice(0, 4)] || 0) + 1;
  return out;
}

/**
 * الرصيد في سنة بعد إضافة أيام جديدة: المتبقي الآن، والمعلّق (طلبات بانتظار القرار)، وما سيبقى إن اعتُمدت الأيام.
 * balances: [{year, items:[{purpose,total,used,pending,remaining}]}] كما يرجعها التقويم. null إن لم يُحدَّد رصيد لهذا الغرض.
 */
export function balanceAfter(balances, year, purpose, extra) {
  const b = balances?.find((x) => x.year === Number(year))?.items.find((i) => i.purpose === purpose);
  if (!b) return null;
  return { total: b.total, remaining: b.remaining, pending: b.pending, extra, after: r2(b.remaining - b.pending - extra) };
}

// ---------------------------------------------------------------- ملف إكسل (شكل جدول الإجازات المعتمد)
const CELL = {
  approved: ['معتمد', 'calApproved'],
  planned: ['إجازة', 'calPlanned'],
  rejected: ['مرفوض', 'calRejected'],
  draft: ['مسودة', 'calCell'],
};
const SHORT_DAYS = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];

/**
 * ورقة واحدة: صف لكل موظف وعمود لكل يوم، مع شريط الأشهر وأسماء الأيام، وتلوين الخلايا.
 * data: ناتج /api/plans/calendar لمدى from..to.
 */
export function calendarWorkbook({ from, to, generated, employees, off, scopeNote = '' }) {
  const days = datesBetween(from, to);
  const FIX = 4; // م، الاسم، الرقم الوظيفي، القسم
  const first = FIX;
  const last = first + days.length - 1;
  const tail = last + 1; // أيام معتمدة، أيام متوقعة
  const lastCol = tail + 1;
  const cells = {};
  const merges = [];
  const cols = { A: 5, B: 28, C: 13, D: 20 };
  const put = (c, r, v, s) => {
    cells[`${colName(c)}${r}`] = { v, s };
  };

  put(0, 1, `الإجازات المتوقعة والمعتمدة — ${monthLabel(from.slice(0, 7))}${from.slice(0, 7) === to.slice(0, 7) ? '' : ` إلى ${monthLabel(to.slice(0, 7))}`}`, 'titleAr');
  merges.push(`A1:${colName(lastCol)}1`);
  put(0, 2, `جمعية نوى للثقافة والفنون — صدر بتاريخ ${generated}${scopeNote ? ` — ${scopeNote}` : ''}`, 'cellAr');
  merges.push(`A2:${colName(lastCol)}2`);

  const H = 4; // شريط الأشهر، ثم أسماء الأيام، ثم أرقامها
  ['م', 'الاسم', 'الرقم الوظيفي', 'القسم'].forEach((t, c) => {
    put(c, H, t, 'hdrAr');
    put(c, H + 1, null, 'hdrAr');
    put(c, H + 2, null, 'hdrAr');
    merges.push(`${colName(c)}${H}:${colName(c)}${H + 2}`);
  });
  let bandStart = 0;
  days.forEach((d, i) => {
    const c = first + i;
    cols[colName(c)] = 6.4;
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    put(c, H + 1, SHORT_DAYS[dow], off[d] ? 'calOff' : 'calHead');
    put(c, H + 2, Number(d.slice(8)), off[d] ? 'calOff' : 'calHead');
    const endOfMonth = i === days.length - 1 || days[i + 1].slice(0, 7) !== d.slice(0, 7);
    if (endOfMonth) {
      const a = first + bandStart;
      put(a, H, monthLabel(d.slice(0, 7)), 'hdrAr');
      for (let k = a + 1; k <= c; k++) put(k, H, null, 'hdrAr');
      if (c > a) merges.push(`${colName(a)}${H}:${colName(c)}${H}`);
      bandStart = i + 1;
    }
  });
  [['أيام معتمدة', tail], ['أيام متوقعة', tail + 1]].forEach(([t, c]) => {
    put(c, H, t, 'hdrAr');
    put(c, H + 1, null, 'hdrAr');
    put(c, H + 2, null, 'hdrAr');
    merges.push(`${colName(c)}${H}:${colName(c)}${H + 2}`);
    cols[colName(c)] = 9;
  });

  employees.forEach((e, idx) => {
    const r = H + 3 + idx;
    put(0, r, idx + 1, 'cellNum');
    put(1, r, e.name, 'cellAr');
    put(2, r, e.code, 'cellCtr');
    put(3, r, e.department || '', 'cellAr');
    let ok = 0;
    let planned = 0;
    days.forEach((d, i) => {
      const c = first + i;
      const x = e.days?.[d];
      if (off[d]) return put(c, r, null, 'calOff');
      if (!x) return put(c, r, null, 'calCell');
      const [text, style] = CELL[x.s] || CELL.planned;
      if (x.s === 'approved') ok += 1;
      if (x.s === 'planned') planned += 1;
      put(c, r, text, style);
    });
    put(tail, r, ok, 'cellNum');
    put(tail + 1, r, planned, 'cellNum');
  });

  // مفتاح الألوان في آخر الجدول
  const lr = H + 3 + employees.length + 1;
  [['معتمد', 'calApproved'], ['إجازة متوقعة (بانتظار القرار)', 'calPlanned'], ['مرفوض', 'calRejected'], ['عطلة', 'calOff']].forEach(([t, s], i) => {
    const a = first + i * 6;
    put(a, lr, t, s);
    for (let k = a + 1; k < a + 6 && k <= last; k++) put(k, lr, null, s);
    if (a + 5 <= last) merges.push(`${colName(a)}${lr}:${colName(a + 5)}${lr}`);
  });
  put(0, lr, 'مفتاح الألوان', 'sumTxt');
  merges.push(`A${lr}:D${lr}`);
  for (let k = 1; k < 4; k++) put(k, lr, null, 'sumTxt');

  return { sheets: [{ name: 'الإجازات المتوقعة', rtl: true, landscape: true, cols, merges, cells }] };
}
