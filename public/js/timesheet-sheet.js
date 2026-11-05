// يحوّل ناتج buildTimesheet إلى ورقة إكسل تطابق شيت «October» في ملف الإدارة (أعمدة A..AH، الشعار فوق العنوان،
// صفوف الممولين بعددهم، أعمدة الجمعة والسبت مظلَّلة، ساعات بصيغة 0.0 ونسبة المركز 0%).
import { colName } from './xlsx-write.js';

const DAY_COL0 = 3; // D
const LAST_COL = DAY_COL0 + 31 - 1; // AH
const L = (i) => colName(i);
const FIRST_FUNDER_ROW = 10;
const ROW_H = 19.95;

/** رقم الموظف: الجزء الأخير من الكود («NW-006» ← 6) رقماً كما في الشيت الأصلي. */
export const employeeNumber = (code) => {
  const m = String(code || '').match(/([^-\s]+)\s*$/);
  if (!m) return '';
  return /^\d+$/.test(m[1]) ? Number(m[1]) : m[1];
};

/** نص التواقيع الثلاثة كما في الشيت الأصلي (تُستعمل في ورقة إكسل وفي المعاينة المطبوعة). */
export const SIGN_ROLES = ['Employee', 'Direct Supervisor', 'Administration and Finance Department Manager'];

/** عدد أسطر اسم الممول في عمود A (عرضه نحو 23 حرفاً) لضبط ارتفاع الصف. */
export const nameLines = (s) => Math.max(1, Math.ceil(String(s || '').length / 24));

/**
 * @param {object} ts      ناتج buildTimesheet
 * @param {{name:string,code:string,post:string,place:string,supervisor:string,approver:string}} info
 * @param {Uint8Array} [logoPng]
 * @param {string} [sheetName]  اسم التبويب (الافتراضي كود الموظف)
 */
export function timesheetSheet(ts, info, logoPng, sheetName) {
  const cells = {};
  const merges = [];
  const rowHeights = { 1: 110.25, 9: 26.4 };
  for (let r = 2; r <= 8; r++) rowHeights[r] = ROW_H;
  const put = (ref, v, s = 'default') => {
    cells[ref] = { v, s };
  };
  const box = (r, c1, c2, v, s) => {
    for (let c = c1; c <= c2; c++) put(`${L(c)}${r}`, c === c1 ? v : null, s);
    if (c2 > c1) merges.push(`${L(c1)}${r}:${L(c2)}${r}`);
  };
  const off = (i) => Boolean(ts.off?.[i]);

  merges.push(`A1:${L(LAST_COL)}1`);
  box(3, 6, 21, 'Monthly Timesheet', 'tsTitle');

  const header = (r, l1, v1, l2, v2) => {
    box(r, 0, 1, l1, 'tsLabel');
    box(r, 2, 11, v1, 'tsValue');
    box(r, 13, 17, l2, 'tsLabel');
    box(r, 18, 29, v2, 'tsValue');
  };
  header(5, 'Name:', info.name, 'Employee Number :', employeeNumber(info.code));
  header(6, 'Post:', info.post, 'Month : ', ts.monthName);
  header(7, 'Place of Work:', info.place, 'Year :', ts.year);

  put('A9', 'Item', 'tsHead');
  put('B9', 'Cost Center', 'tsHead');
  put('C9', 'Work Hours', 'tsHead');
  for (let d = 1; d <= 31; d++) put(`${L(DAY_COL0 + d - 1)}9`, d, off(d - 1) ? 'tsDayOff' : 'tsDay');

  const dayCells = (r, values) => {
    for (let i = 0; i < 31; i++) put(`${L(DAY_COL0 + i)}${r}`, i < ts.daysInMonth ? values[i] : null, off(i) ? 'tsHoursOff' : 'tsHours');
  };

  // صفوف الممولين بعددهم (صف واحد على الأقل) كما في الشيت الأصلي؛ ما تحتها يُزاح بالفرق عن اثنين
  const funderRows = Math.max(1, ts.funders.length);
  for (let k = 0; k < funderRows; k++) {
    const r = FIRST_FUNDER_ROW + k;
    const f = ts.funders[k];
    put(`A${r}`, f ? f.funder : '', 'tsItem');
    put(`B${r}`, f ? f.costCenter : null, 'tsPct');
    put(`C${r}`, f ? f.total : null, 'tsHoursFill');
    dayCells(r, f ? f.values : new Array(31).fill(null));
    rowHeights[r] = Math.max(ROW_H, 13.2 * nameLines(f?.funder));
  }
  const rest = [ts.official, ts.annual, ts.sick, ts.emergency, ts.others, ts.unpaid];
  const restRow0 = FIRST_FUNDER_ROW + funderRows;
  rest.forEach((row, i) => {
    const r = restRow0 + i;
    put(`A${r}`, row.label, 'tsItem');
    put(`B${r}`, null, 'tsPct');
    put(`C${r}`, row.total, 'tsHoursFill');
    dayCells(r, row.values);
    rowHeights[r] = ROW_H;
  });

  const totalRow = restRow0 + rest.length;
  box(totalRow, 0, 1, 'Total', 'tsTotalLbl');
  put(`C${totalRow}`, ts.total.total, 'tsHoursFill');
  dayCells(totalRow, ts.total.values);
  rowHeights[totalRow] = ROW_H;

  // التواقيع
  const signRow = totalRow + 2;
  box(signRow, 0, 3, null, 'tsBoxLbl');
  box(signRow, 4, 18, 'Name', 'tsBoxLbl');
  box(signRow, 19, LAST_COL, 'Date & Signature', 'tsBoxLbl');
  const names = [info.name, info.supervisor, info.approver];
  SIGN_ROLES.forEach((label, i) => {
    const r = signRow + 1 + i;
    box(r, 0, 3, label, 'tsBoxLbl');
    box(r, 4, 18, names[i] || '', 'tsBoxTxt');
    box(r, 19, 25, 'Date:', 'tsHint');
    box(r, 26, LAST_COL, 'Signature:', 'tsHint');
  });
  for (let r = totalRow + 1; r <= signRow + 3; r++) rowHeights[r] = ROW_H;
  rowHeights[signRow + 3] = 26.4; // «Administration and Finance Department Manager» يلتف على سطرين

  return {
    name: sheetName || info.code,
    cols: { A: 23.3, B: 7.1, C: 6.7, [`D:${L(LAST_COL)}`]: 4.3 },
    rowHeights,
    cells,
    merges,
    landscape: true,
    image: logoPng ? { png: logoPng, from: { col: 11, row: 0, colOffPx: 31 }, size: { w: 158, h: 140 } } : undefined,
  };
}
