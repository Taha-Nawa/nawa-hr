// تصدير التايم شيت (إكسل): مشترك بين صفحة «التقارير» وصفحة «التقرير الشهري» (حزمة الشهر).
import { h } from './dom.js';
import { get } from './api.js';
import { buildXlsx } from './xlsx-write.js';
import { timesheetSheet } from './timesheet-sheet.js';

export const CHUNK = 25; // الحد الأقصى للموظفين في طلب واحد (يطابق الخادم)

export async function fetchSheets(list, month) {
  const sheets = [];
  let approver = '';
  for (let i = 0; i < list.length; i += CHUNK) {
    const ids = list.slice(i, i + CHUNK).map((e) => e.id).join(',');
    const r = await get(`/api/reports/timesheet?month=${encodeURIComponent(month)}&employees=${ids}`);
    sheets.push(...r.sheets);
    approver = r.approver || approver;
  }
  return { sheets, approver };
}

export function saveBlob(bytes, type, filename) {
  const a = h('a', { href: URL.createObjectURL(new Blob([bytes], { type })), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 2000);
}

/** يجلب أوراق الموظفين ويبني ملف إكسل وينزّله. يُرجع { sheets } لعرض التنبيهات. */
export async function downloadTimesheet(list, month, label) {
  const [{ sheets, approver }, logo] = await Promise.all([
    fetchSheets(list, month),
    fetch('/logo.png').then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? new Uint8Array(b) : undefined)).catch(() => undefined),
  ]);
  const bytes = buildXlsx({ sheets: sheets.map((s) => timesheetSheet(s.timesheet, { ...s.employee, approver }, logo)) });
  saveBlob(bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `Timesheet_${month}_${label}.xlsx`);
  return { sheets };
}
