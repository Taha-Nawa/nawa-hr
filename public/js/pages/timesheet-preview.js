// معاينة التايم شيت قبل الطباعة: ورقة لكل موظف تطابق شيت «October»، تُراجع على الشاشة ثم تُعتمد وتُطبع (أو تُنزَّل إكسل).
// المسار: #/timesheet-preview?month=YYYY-MM&employees=1,2,3
import { h, clear, icon, toast } from '../dom.js';
import { fetchTimesheets, loadLogo, NOTE } from '../timesheet-data.js';
import { timesheetPaper } from '../timesheet-paper.js';
import { timesheetSheet } from '../timesheet-sheet.js';
import { buildXlsx } from '../xlsx-write.js';
import { fitToScreen } from '../print-ui.js';

export default async function render() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const month = q.get('month') || '';
  const ids = (q.get('employees') || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const back = h('a', { class: 'btn', href: '#/reports' }, 'رجوع إلى التقارير');
  if (!/^\d{4}-\d{2}$/.test(month) || !ids.length) {
    return h('section', { class: 'page' }, h('div', { class: 'notice notice-err' }, 'اختر الشهر والموظفين من صفحة التقارير أولاً.'), back);
  }

  let data;
  try {
    data = await fetchTimesheets(month, ids);
  } catch (e) {
    return h('section', { class: 'page' }, h('div', { class: 'notice notice-err' }, e.message), back);
  }
  const { sheets, approver } = data;
  const infoOf = (s) => ({ ...s.employee, approver });

  const ok = h('input', { type: 'checkbox', id: 'tsOk', onchange: () => { printBtn.disabled = !ok.checked; } });
  const printBtn = h('button', { type: 'button', class: 'btn btn-primary', disabled: true, onclick: () => window.print() }, icon('printer'), 'اعتماد وطباعة');
  const dlBtn = h('button', { type: 'button', class: 'btn', onclick: async () => {
    dlBtn.disabled = true;
    try {
      const logo = await loadLogo();
      const one = sheets.length === 1;
      const bytes = buildXlsx({ sheets: sheets.map((s) => timesheetSheet(s.timesheet, infoOf(s), logo, one ? s.timesheet.monthName : undefined)) });
      const a = h('a', { href: URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })), download: `Timesheet_${month}_${one ? sheets[0].employee.code : 'All'}.xlsx` });
      document.body.append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      dlBtn.disabled = false;
    }
  } }, 'تنزيل إكسل');

  const notes = sheets.flatMap((s) => s.timesheet.notes.map((n) => `${s.employee.name}: ${NOTE[n]}`));
  const frame = h('div', { class: 'paper-frame land' }, h('div', { class: 'paper-sheet' }, sheets.map((s) => timesheetPaper(s.timesheet, infoOf(s)))));
  fitToScreen(frame, 297);

  return h('section', { class: 'page print-page' },
    h('header', { class: 'page-head no-print' }, h('div', null, h('h1', null, 'معاينة التايم شيت'), h('p', { class: 'sub' }, `${sheets[0].timesheet.monthName} ${sheets[0].timesheet.year} — ${sheets.length} ${sheets.length === 1 ? 'ورقة' : 'أوراق'}`))),
    h('div', { class: 'ts-bar no-print' },
      h('label', { class: 'ts-ok', for: 'tsOk' }, ok, 'راجعت الكشف وأعتمده للطباعة'),
      h('div', { class: 'row-actions' }, back, dlBtn, printBtn)),
    notes.map((n) => h('div', { class: 'notice notice-warn no-print' }, n)),
    h('div', { class: 'notice no-print' }, 'الورقة أدناه هي ما سيُطبع بالضبط. راجع الأرقام، ثم علّم «راجعت الكشف» ليُفعَّل زر الطباعة، واجعل اتجاه الورقة أفقياً A4.'),
    frame);
}
