import { h, clear, field, select, toast, todayLocal } from '../dom.js';
import { get } from '../api.js';
import { buildXlsx } from '../xlsx-write.js';
import { timesheetSheet } from '../timesheet-sheet.js';
import { fetchTimesheets, loadLogo, NOTE } from '../timesheet-data.js';

const monthNow = () => todayLocal().slice(0, 7);

export default async function render({ user }) {
  const [{ employees }, { centers }] = await Promise.all([get('/api/employees'), get('/api/centers')]);
  const active = employees.filter((e) => e.status === 'active');
  const wanted = Number(new URLSearchParams(location.hash.split('?')[1] || '').get('employee')) || null;

  const centerCounts = new Map();
  for (const e of active) if (e.centerId) centerCounts.set(e.centerId, (centerCounts.get(e.centerId) || 0) + 1);
  const options = [];
  if (active.length > 1) {
    options.push(['all', `كل الموظفين الفعّالين (${active.length})`]);
    for (const c of centers) if (centerCounts.get(c.id)) options.push([`c${c.id}`, `مركز: ${c.name} (${centerCounts.get(c.id)})`]);
  }
  for (const e of active) options.push([`e${e.id}`, `${e.name} (${e.code})`]);

  const month = h('input', { type: 'month', value: monthNow(), required: true, max: monthNow() });
  const who = select(options, wanted && active.some((e) => e.id === wanted) ? `e${wanted}` : options[0]?.[0]);
  const out = h('div');
  const btnPrev = h('button', { type: 'button', class: 'btn btn-primary' }, 'معاينة وطباعة');
  const btnDown = h('button', { type: 'button', class: 'btn' }, 'تنزيل ملف إكسل');

  const selected = () => {
    const v = who.value;
    if (v === 'all') return active;
    if (v.startsWith('c')) return active.filter((e) => e.centerId === Number(v.slice(1)));
    return active.filter((e) => e.id === Number(v.slice(1)));
  };

  const fetchSheets = (list) => fetchTimesheets(month.value, list.map((e) => e.id));

  const busy = (on) => {
    btnPrev.disabled = on;
    btnDown.disabled = on;
  };

  btnPrev.onclick = () => {
    const list = selected();
    if (!month.value || !list.length) return toast('اختر الشهر والموظفين', 'err');
    location.hash = `#/timesheet-preview?month=${encodeURIComponent(month.value)}&employees=${list.map((e) => e.id).join(',')}`;
  };

  btnDown.onclick = async () => {
    const list = selected();
    if (!month.value || !list.length) return toast('اختر الشهر والموظفين', 'err');
    busy(true);
    try {
      const [{ sheets, approver }, logo] = await Promise.all([fetchSheets(list), loadLogo()]);
      const bytes = buildXlsx({ sheets: sheets.map((s) => timesheetSheet(s.timesheet, { ...s.employee, approver }, logo, sheets.length === 1 ? s.timesheet.monthName : undefined)) });
      const label = list.length === 1 ? list[0].code : who.value === 'all' ? 'All' : (centers.find((c) => `c${c.id}` === who.value)?.nameEn || 'Center').replace(/\W+/g, '-');
      const a = h('a', {
        href: URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })),
        download: `Timesheet_${month.value}_${label}.xlsx`,
      });
      document.body.append(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 2000);
      const withNotes = sheets.filter((s) => s.timesheet.notes.length);
      toast(`نُزّل ملف بـ ${sheets.length} ورقة`);
      if (withNotes.length) {
        clear(out).append(h('div', { class: 'notice notice-warn' },
          h('strong', null, 'تنبيهات على بعض الأوراق:'),
          h('ul', null, withNotes.map((s) => h('li', null, `${s.employee.name} (${s.employee.code}): ${s.timesheet.notes.map((n) => NOTE[n]).join(' ')}`)))));
      }
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      busy(false);
    }
  };

  return h('section', null,
    h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'التقارير'), h('p', { class: 'muted' }, 'التايم شيت الشهري بصيغة ملف الممولين، من ساعات الدوام المعتمدة وتوزيع الموظف على المشاريع.'))),
    h('div', { class: 'fieldset' },
      h('div', { class: 'inline-form' },
        field('الشهر', month),
        field(user.role === 'employee' ? 'الموظف' : 'الموظفون', who),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, ' '), h('div', { class: 'row-actions' }, btnPrev, btnDown))),
      h('p', { class: 'muted small' }, 'الأيام التي لم تُحسب بعد (لم يُقفل يومها) تظهر فارغة. كل موظف في ورقة مستقلة باسم كوده.')),
    out);
}
