// قراءة «ملف الإدارة 2026» بتخطيطه الحالي (قائمة موظفين بالإنجليزية، توزيع المشاريع، قاعدة بيانات الحركات اليومية، الإعدادات).
// دوال نقية على مصفوفات الأوراق التي يُرجعها readWorkbook، فتعمل في المتصفح وفي اختبارات Node بلا DOM.

const norm = (s) => String(s ?? '').replace(/[ً-ْـ]/g, '').replace(/\s+/g, ' ').trim();
// الهمزات تُوحَّد عند المقارنة فقط («الإثنين»/«الاثنين»)
const key = (s) => norm(s).replace(/[إأآ]/g, 'ا');
const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
const CODE_RE = /^[A-Za-z]{1,6}-\d{1,6}$/;
const DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export function table(rows, required) {
  const need = required.map(key);
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).map(key);
    if (need.every((n) => cells.includes(n))) {
      const col = Object.fromEntries(cells.map((c, j) => [c, j]).filter(([c]) => c));
      return { col, header: i, rows: rows.slice(i + 1).filter((r) => r.some((c) => c !== null && c !== '')) };
    }
  }
  return null;
}
const cell = (t, r, name) => (t.col[key(name)] === undefined ? null : r[t.col[key(name)]] ?? null);

export function timeOf(v) {
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const m = Math.round(v * 1440);
    return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  const m = str(v).match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}
const dateOf = (v) => (/^\d{4}-\d{2}-\d{2}/.test(str(v)) ? str(v).slice(0, 10) : null);

function findRow(rows, col, label, from = 0) {
  const want = key(label);
  for (let i = from; i < rows.length; i++) if (key(rows[i]?.[col]).startsWith(want)) return i;
  return -1;
}

/** الإعدادات: القيم في العمود C بجانب عناوينها في B، وأيام الأسبوع وأنواع الإجازات في E:F. */
export function extractSettings(rows) {
  if (!rows) return null;
  const val = (label) => {
    const i = findRow(rows, 1, label);
    return i < 0 ? null : rows[i][2] ?? null;
  };
  const start = timeOf(val('بداية الدوام الرسمي'));
  const end = timeOf(val('نهاية الدوام الرسمي'));
  const tol = Number(val('سماحية التأخير'));
  const cap = Number(val('الحد الأعلى للمغادرات'));
  const weekdays = DAYS.map((d) => {
    const i = findRow(rows, 4, d);
    return i < 0 ? null : str(rows[i][5]);
  });
  const typesAt = findRow(rows, 4, 'أنواع الإجازات');
  const leaveTypes = {};
  if (typesAt >= 0) {
    for (let i = typesAt + 1; i < rows.length; i++) {
      const name = str(rows[i]?.[4]);
      if (!name) {
        if (i > typesAt + 2) break;
        continue;
      }
      if (key(name) === key('نوع الإجازة')) continue; // سطر العناوين
      leaveTypes[name] = key(rows[i][5]) === key('نعم');
    }
  }
  if (!start || !end || !Number.isFinite(tol) || weekdays.some((w) => !w) || !Object.keys(leaveTypes).length) return null;
  return { start, end, toleranceMinutes: tol, weekdays, leaveTypes, ...(Number.isFinite(cap) && val('الحد الأعلى للمغادرات') !== null ? { monthlyExitCapHours: cap } : {}) };
}

export function extractEmployees(rows) {
  const t = rows && table(rows, ['الرقم الوظيفي', 'اسم الموظف']);
  if (!t) return null;
  return t.rows
    .filter((r) => CODE_RE.test(str(cell(t, r, 'الرقم الوظيفي'))))
    .map((r) => ({
      code: str(cell(t, r, 'الرقم الوظيفي')),
      nameEn: str(cell(t, r, 'اسم الموظف')) || null,
      jobTitleEn: str(cell(t, r, 'المسمى الوظيفي')) || null,
      departmentEn: str(cell(t, r, 'الدائرة')) || null,
      centerEn: str(cell(t, r, 'المركز')) || null,
      managerLabelEn: str(cell(t, r, 'المدير الإداري')) || null,
      startDate: dateOf(cell(t, r, 'تاريخ التعيين')),
    }));
}

/** ورقة «توزيع المشاريع»: A كود، C ممول، D نسبة، E من، F إلى. الصف بلا ممول يُمرَّر فارغاً ليرفضه الخادم ويُبلَّغ عنه. */
export function extractAllocations(rows) {
  if (!rows) return null;
  let head = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) if ((rows[i] || []).some((c) => norm(c).includes('الممول')) && (rows[i] || []).some((c) => norm(c).includes('تاريخ'))) head = i;
  if (head < 0) return null;
  const out = [];
  for (const r of rows.slice(head + 1)) {
    const code = str(r[0]);
    if (!CODE_RE.test(code)) continue;
    const share = typeof r[3] === 'number' ? r[3] : Number(str(r[3]));
    // كود متروك في الورقة بلا ممول ولا نسبة ولا تواريخ هو صف فارغ لا توزيع غير محدد
    if (!str(r[2]) && !str(r[3]) && !dateOf(r[4]) && !dateOf(r[5])) continue;
    out.push({ code, funder: str(r[2]) || null, share: Number.isFinite(share) ? share : null, from: dateOf(r[4]), to: dateOf(r[5]) });
  }
  return out;
}

/** دفعات لا تفصل صفوف موظف واحد (الخادم يستبدل توزيع الموظف كاملاً بما في الدفعة). */
export function batchByEmployee(rows, max = 100) {
  const batches = [];
  let cur = [];
  const groups = new Map();
  for (const r of rows) groups.set(r.code, [...(groups.get(r.code) || []), r]);
  for (const g of groups.values()) {
    if (cur.length + g.length > max) {
      batches.push(cur);
      cur = [];
    }
    cur.push(...g);
  }
  if (cur.length) batches.push(cur);
  return batches;
}

const SUFFIX = { حضور: '', خروج: '-O', عودة: '-R', انصراف: '-D' };
const COLS = [['حضور', 'الحضور'], ['خروج', 'الخروج (مغادرة)'], ['عودة', 'العودة'], ['انصراف', 'الانصراف']];

/**
 * «قاعدة بيانات الحركات»: صف لكل (موظف، يوم) وفيه أوقات الحضور/الخروج/العودة/الانصراف. نحوّله إلى حركات منفصلة بالصيغة نفسها
 * التي ترسلها البوابة. معرّف أول حركة هو «الحركة (مرجعي)» الأصلي إن طابق وقتها، والبقية معرّفات مشتقة ثابتة فتكرار الاستيراد آمن.
 */
export function extractDayMovements(rows) {
  const t = rows && table(rows, ['كود الموظف', 'التاريخ', 'الحضور', 'الانصراف']);
  if (!t) return null;
  const moves = [];
  const leaveDays = [];
  for (const r of t.rows) {
    const code = str(cell(t, r, 'كود الموظف'));
    if (!CODE_RE.test(code)) continue;
    // التاريخ من مفتاح «موظف|تاريخ» أولاً: عمود التاريخ قد يحمل إزاحة منطقة زمنية
    const k = str(cell(t, r, 'البحث (موظف+تاريخ)')).split('|')[1];
    const date = dateOf(k) || dateOf(cell(t, r, 'التاريخ'));
    if (!date) continue;
    const ref = str(cell(t, r, 'الحركة (مرجعي)'));
    const leave = str(cell(t, r, 'نوع الإجازة'));
    if (leave) leaveDays.push({ code, date, leaveType: leave });
    const stamp = date.replaceAll('-', '');
    for (const [type, header] of COLS) {
      const time = timeOf(cell(t, r, header));
      if (!time) continue;
      const hhmm = time.replace(':', '');
      const refMatches = ref.startsWith(`MV-${stamp}${hhmm}`) && ref.endsWith(`-${code}`);
      moves.push({
        id: refMatches && type === 'حضور' ? ref : `MV-${stamp}${hhmm}00-${code}${SUFFIX[type]}`,
        code, type, date, time, note: 'مستورد من ملف الإدارة',
      });
    }
  }
  return { moves, leaveDays };
}

export function extractCurrent(sheets) {
  const settings = extractSettings(sheets['الإعدادات']);
  const employees = extractEmployees(sheets['قائمة الموظفين']);
  const allocations = extractAllocations(sheets['توزيع المشاريع']);
  const day = extractDayMovements(sheets['قاعدة بيانات الحركات']);
  const found = !!(settings || employees || allocations || day);
  return { found, settings, employees, allocations, movements: day?.moves ?? null, leaveDays: day?.leaveDays ?? [] };
}
