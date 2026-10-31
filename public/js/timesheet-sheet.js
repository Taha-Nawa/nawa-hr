// يحوّل ناتج buildTimesheet إلى ورقة إكسل بتخطيط شيت «monthly timesheet» في ملف الإدارة (عمودا A..AH، صفوف 1..24).
import { colName } from './xlsx-write.js';

const DAY_COL0 = 3; // D
const LAST_COL = DAY_COL0 + 31 - 1; // AH
const L = (i) => colName(i);
const FIRST_FUNDER_ROW = 10;

const employeeNumber = (code) => {
  const m = String(code || '').match(/([^-\s]+)\s*$/);
  return m ? m[1] : '';
};

/**
 * @param {object} ts      ناتج buildTimesheet
 * @param {{name:string,code:string,post:string,place:string,supervisor:string,approver:string}} info
 * @param {Uint8Array} [logoPng]
 */
export function timesheetSheet(ts, info, logoPng) {
  const cells = {};
  const merges = [];
  const rowHeights = { 2: 98.25 };
  const put = (ref, v, s = 'default') => {
    cells[ref] = { v, s };
  };
  const box = (r, c1, c2, v, s) => {
    for (let c = c1; c <= c2; c++) put(`${L(c)}${r}`, c === c1 ? v : null, s);
    if (c2 > c1) merges.push(`${L(c1)}${r}:${L(c2)}${r}`);
  };

  merges.push(`A1:${L(LAST_COL)}1`, 'M2:P2');
  box(3, 6, 21, 'Monthly Timesheet', 'title');

  const header = (r, l1, v1, l2, v2) => {
    box(r, 0, 1, l1, 'labelC');
    box(r, 2, 11, v1, 'underlined');
    box(r, 13, 17, l2, 'center');
    box(r, 18, 29, v2, 'underlined');
  };
  header(5, 'Name:', info.name, 'Employee Number :', employeeNumber(info.code));
  header(6, 'Post:', info.post, 'Month :', ts.monthName);
  header(7, 'Place of Work:', info.place, 'Year :', ts.year);

  put('A9', 'Item', 'head');
  put('B9', 'Cost Center', 'head');
  put('C9', 'Work Hours', 'head');
  for (let d = 1; d <= 31; d++) put(`${L(DAY_COL0 + d - 1)}9`, d, 'headNum');

  const dayCells = (r, values, style) => {
    for (let i = 0; i < 31; i++) put(`${L(DAY_COL0 + i)}${r}`, i < ts.daysInMonth ? values[i] : null, style);
  };

  for (let k = 0; k < 3; k++) {
    const r = FIRST_FUNDER_ROW + k;
    const f = ts.funders[k];
    put(`A${r}`, f ? f.funder : '', 'label');
    put(`B${r}`, f ? f.costCenter : null, 'pct');
    put(`C${r}`, f ? f.total : null, 'hoursFill');
    dayCells(r, f ? f.values : new Array(31).fill(null), 'hours');
    const lines = f ? Math.ceil(f.funder.length / 34) : 1;
    rowHeights[r] = Math.max(18.75, 13.5 * lines + 4);
  }
  const rest = [ts.official, ts.annual, ts.sick, ts.emergency, ts.others, ts.unpaid];
  rest.forEach((row, i) => {
    const r = 13 + i;
    put(`A${r}`, row.label, 'label');
    put(`B${r}`, null, 'pct');
    put(`C${r}`, row.total, 'hoursFill');
    dayCells(r, row.values, 'hours');
    rowHeights[r] = 18.75;
  });

  box(19, 0, 1, 'Total', 'labelFill');
  put('C19', ts.total.total, 'hoursFill');
  dayCells(19, ts.total.values, 'hoursFill');
  rowHeights[19] = 23.25;

  // التواقيع
  box(21, 0, 3, null, 'boxFill');
  box(21, 4, 18, 'Name', 'boxFill');
  box(21, 19, LAST_COL, 'Date & Signature', 'boxFill');
  const sign = [
    ['Employee', info.name],
    ['Direct Supervisor', info.supervisor],
    ['Administration and Finance Manager', info.approver],
  ];
  sign.forEach(([label, name], i) => {
    const r = 22 + i;
    box(r, 0, 3, label, 'boxFill');
    box(r, 4, 18, name || '', 'boxText');
    box(r, 19, 25, 'Date:', 'boxLeft');
    box(r, 26, LAST_COL, 'Signature:', 'boxLeft');
  });
  for (const r of [21, 22, 23, 24]) rowHeights[r] = 22.5;

  return {
    name: info.code,
    cols: { A: 31.6, B: 9, C: 11, [`D:${L(LAST_COL)}`]: 5.1 },
    rowHeights,
    cells,
    merges,
    landscape: true,
    image: logoPng ? { png: logoPng, from: { col: 12, row: 1 }, size: { w: 92, h: 92 } } : undefined,
  };
}
