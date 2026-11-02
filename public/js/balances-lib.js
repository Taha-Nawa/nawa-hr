// منطق نقي لصفحة «أرصدة الإجازات»: الحالة، التجميع (موظف / قسم / مركز)، وبناء مصنّف إكسل. بلا DOM فيُختبر في Node.
import { colName } from './xlsx-write.js';

export const PURPOSES = { annual: 'اعتيادية (سنوية)', sick: 'مرضية', emergency: 'طارئة', other: 'أخرى' };
export const PURPOSE_ORDER = ['annual', 'sick', 'emergency', 'other'];
const CORE = ['annual', 'sick'];

const r2 = (n) => Math.round(n * 100) / 100;
export const fmtDays = (n) => (n === null || n === undefined ? '' : String(r2(n)));

/** الأنواع المعروضة: الاعتيادية والمرضية دائماً، والباقي إن كان فيها رصيد أو استهلاك أو طُلب إظهارها. */
export function shownPurposes(employees, force = false) {
  return PURPOSE_ORDER.filter((p) => CORE.includes(p) || force || employees.some((e) => e.balances[p].total !== null || e.balances[p].used > 0 || e.balances[p].pending > 0));
}

/**
 * حالة موظف عبر الأنواع المعروضة:
 *  over = تجاوز رصيده في نوع، out = استنفده، ok = ضمن رصيده، none = بلا رصيد محدد.
 */
export function rowStatus(e, purposes) {
  const withTotal = purposes.map((p) => e.balances[p]).filter((b) => b.total !== null);
  if (!withTotal.length) return { key: 'none', label: 'بلا رصيد محدد' };
  if (withTotal.some((b) => b.remaining < 0)) return { key: 'over', label: 'متجاوز' };
  if (withTotal.some((b) => b.total > 0 && b.remaining === 0)) return { key: 'out', label: 'مستنفد' };
  return { key: 'ok', label: 'ضمن الرصيد' };
}

const emptyAgg = () => ({ total: 0, used: 0, pending: 0, remaining: 0, withBalance: 0, withoutBalance: 0, usedWithout: 0 });

/**
 * تجميع الموظفين. المستهلك والمتبقي يُجمعان على من له رصيد فقط كي يصحّ: الرصيد − المستهلك = المتبقي،
 * ومن بلا رصيد يُعدّ عدداً (وما استهلكه يُعرض منفصلاً) ولا يدخل الحساب.
 */
export function aggregate(employees, keyOf, purposes) {
  const groups = new Map();
  for (const e of employees) {
    const key = keyOf(e) || '—';
    if (!groups.has(key)) groups.set(key, { key, count: 0, balances: Object.fromEntries(purposes.map((p) => [p, emptyAgg()])), requests: { approved: 0, pending: 0, rejected: 0, cancelled: 0 }, statuses: { over: 0, out: 0, ok: 0, none: 0 } });
    const g = groups.get(key);
    g.count += 1;
    for (const p of purposes) {
      const b = e.balances[p];
      const a = g.balances[p];
      if (b.total === null) {
        a.withoutBalance += 1;
        a.usedWithout += b.used;
      } else {
        a.withBalance += 1;
        a.total += b.total;
        a.used += b.used;
        a.remaining += b.remaining;
      }
      a.pending += b.pending;
    }
    for (const k of Object.keys(g.requests)) g.requests[k] += e.requests[k] || 0;
    g.statuses[rowStatus(e, purposes).key] += 1;
  }
  const list = [...groups.values()].sort((a, b) => a.key.localeCompare(b.key, 'ar'));
  for (const g of list) for (const p of purposes) for (const k of ['total', 'used', 'pending', 'remaining', 'usedWithout']) g.balances[p][k] = r2(g.balances[p][k]);
  return list;
}

export const overall = (employees, purposes) => aggregate(employees, () => 'الكل', purposes)[0] || null;

// ---------------------------------------------------------------- مصنّف إكسل
/**
 * يبني ورقة جدول بعنوانين: صف مجموعات (يدمج أعمدة كل نوع) وصف عناوين فرعية.
 *  fixed   : أعمدة نصية ثابتة [{ label, width, get(row) }]
 *  blocks  : لكل نوع إجازة أعمدة [{ label, get(row, purpose), sum? }]
 *  tail    : أعمدة ختامية [{ group, label, width, get(row), num?, sum? }]
 */
function tableSheet({ name, title, sub, purposes, fixed, blocks, tail, rows }) {
  const cells = {};
  const merges = [];
  const cols = {};
  const put = (ref, v, s) => {
    cells[ref] = { v, s };
  };
  let c = 0;
  const lastCol = fixed.length + purposes.length * blocks.length + tail.length - 1;
  put('A1', title, 'titleAr');
  merges.push(`A1:${colName(lastCol)}1`);
  put('A2', sub, 'cellAr');
  merges.push(`A2:${colName(lastCol)}2`);
  const H1 = 4; // صف المجموعات
  const H2 = 5; // صف العناوين الفرعية
  const cellsOf = []; // لكل عمود: { get, num, sum }

  for (const f of fixed) {
    put(`${colName(c)}${H1}`, f.label, 'hdrAr');
    put(`${colName(c)}${H2}`, null, 'hdrAr');
    merges.push(`${colName(c)}${H1}:${colName(c)}${H2}`);
    cols[colName(c)] = f.width;
    cellsOf.push({ get: f.get, num: false, sum: false });
    c += 1;
  }
  for (const p of purposes) {
    const start = c;
    for (const b of blocks) {
      put(`${colName(c)}${H2}`, b.label, 'hdrAr');
      cols[colName(c)] = 10;
      cellsOf.push({ get: (row) => b.get(row, p), num: true, sum: b.sum !== false });
      c += 1;
    }
    put(`${colName(start)}${H1}`, PURPOSES[p], 'hdrAr');
    for (let k = start + 1; k < c; k++) put(`${colName(k)}${H1}`, null, 'hdrAr');
    merges.push(`${colName(start)}${H1}:${colName(c - 1)}${H1}`);
  }
  let i = 0;
  while (i < tail.length) {
    const group = tail[i].group;
    let j = i;
    while (j < tail.length && tail[j].group === group) j++;
    for (let k = i; k < j; k++) {
      const t = tail[k];
      const col = colName(c);
      if (group) {
        put(`${col}${H2}`, t.label, 'hdrAr');
        put(`${col}${H1}`, k === i ? group : null, 'hdrAr');
      } else {
        put(`${col}${H1}`, t.label, 'hdrAr');
        put(`${col}${H2}`, null, 'hdrAr');
        merges.push(`${col}${H1}:${col}${H2}`);
      }
      cols[col] = t.width || 11;
      cellsOf.push({ get: t.get, num: !!t.num, sum: !!t.sum });
      c += 1;
    }
    if (group && j - i > 1) merges.push(`${colName(c - (j - i))}${H1}:${colName(c - 1)}${H1}`);
    i = j;
  }

  let r = H2 + 1;
  for (const row of rows) {
    cellsOf.forEach((col, k) => {
      const v = col.get(row);
      put(`${colName(k)}${r}`, v === undefined ? null : v, typeof v === 'number' ? 'cellNum' : k < 2 ? 'cellAr' : 'cellCtr');
    });
    r += 1;
  }
  // صف المجاميع للأعمدة الرقمية القابلة للجمع
  if (rows.length) {
    put(`A${r}`, 'المجموع', 'sumTxt');
    cellsOf.forEach((col, k) => {
      if (k === 0) return;
      const letter = colName(k);
      if (col.sum) put(`${letter}${r}`, r2(rows.reduce((a, row) => a + (Number(col.get(row)) || 0), 0)), 'sumNum');
      else put(`${letter}${r}`, null, 'sumTxt');
    });
  }
  return { name, rtl: true, landscape: true, cols, cells, merges, rowHeights: { 1: 26 } };
}

/**
 * مصنّف تقرير الأرصدة: ورقة للموظفين وورقة للأقسام وورقة للمراكز.
 * @param {{year:number, generated:string, employees:object[], purposes:string[], scopeNote?:string}} o
 */
export function balanceWorkbook({ year, generated, employees, purposes, scopeNote = '' }) {
  const sub = `جمعية نوى للثقافة والفنون — صدر بتاريخ ${generated}${scopeNote ? ` — ${scopeNote}` : ''}`;
  const title = `أرصدة الإجازات لسنة ${year}`;
  const statusOf = (e) => rowStatus(e, purposes).label;

  const perEmployee = tableSheet({
    name: 'الموظفون', title, sub, purposes,
    fixed: [
      { label: 'الرمز', width: 11, get: (e) => e.code },
      { label: 'الاسم', width: 26, get: (e) => e.name },
      { label: 'المركز', width: 20, get: (e) => e.center || '' },
      { label: 'القسم', width: 18, get: (e) => e.department || '' },
    ],
    blocks: [
      { label: 'الرصيد', get: (e, p) => e.balances[p].total },
      { label: 'المستهلك', get: (e, p) => e.balances[p].used },
      { label: 'المعلّق', get: (e, p) => e.balances[p].pending },
      { label: 'المتبقي', get: (e, p) => e.balances[p].remaining },
    ],
    tail: [
      { group: 'عدد الطلبات', label: 'معتمدة', get: (e) => e.requests.approved, num: true, sum: true },
      { group: 'عدد الطلبات', label: 'معلّقة', get: (e) => e.requests.pending, num: true, sum: true },
      { group: 'عدد الطلبات', label: 'مرفوضة', get: (e) => e.requests.rejected, num: true, sum: true },
      { group: '', label: 'الحالة', width: 16, get: statusOf },
    ],
    rows: employees,
  });

  const groupSheet = (name, label, keyOf) => {
    const groups = aggregate(employees, keyOf, purposes);
    return tableSheet({
      name, title: `${title} — ${label}`, sub, purposes,
      fixed: [
        { label, width: 28, get: (g) => g.key },
        { label: 'عدد الموظفين', width: 12, get: (g) => g.count },
      ],
      blocks: [
        { label: 'الرصيد', get: (g, p) => g.balances[p].total },
        { label: 'المستهلك', get: (g, p) => g.balances[p].used },
        { label: 'المعلّق', get: (g, p) => g.balances[p].pending },
        { label: 'المتبقي', get: (g, p) => g.balances[p].remaining },
        { label: 'بلا رصيد (عدد)', get: (g, p) => g.balances[p].withoutBalance },
      ],
      tail: [
        { group: 'عدد الطلبات', label: 'معتمدة', get: (g) => g.requests.approved, num: true, sum: true },
        { group: 'عدد الطلبات', label: 'معلّقة', get: (g) => g.requests.pending, num: true, sum: true },
        { group: 'عدد الطلبات', label: 'مرفوضة', get: (g) => g.requests.rejected, num: true, sum: true },
        { group: 'عدد الموظفين حسب الحالة', label: 'ضمن الرصيد', get: (g) => g.statuses.ok, num: true, sum: true },
        { group: 'عدد الموظفين حسب الحالة', label: 'مستنفد', get: (g) => g.statuses.out, num: true, sum: true },
        { group: 'عدد الموظفين حسب الحالة', label: 'متجاوز', get: (g) => g.statuses.over, num: true, sum: true },
        { group: 'عدد الموظفين حسب الحالة', label: 'بلا رصيد', get: (g) => g.statuses.none, num: true, sum: true },
      ],
      rows: groups,
    });
  };

  return { sheets: [perEmployee, groupSheet('حسب القسم', 'القسم', (e) => e.department), groupSheet('حسب المركز', 'المركز', (e) => e.center)] };
}
