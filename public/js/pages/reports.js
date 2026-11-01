import { h, clear, field, select, toast, todayLocal } from '../dom.js';
import { get } from '../api.js';
import { fetchSheets, downloadTimesheet } from '../timesheet-export.js';

const NOTE = {
  no_allocation: 'لا يوجد توزيع على ممول في هذا الشهر — صفوف الممولين فارغة (أضف التوزيع من صفحة الموظف).',
  more_than_three: 'أكثر من 3 ممولين في هذا الشهر — يُعرض أول 3 فقط كما في الشيت.',
};
const fmt = (v) => (v === null || v === undefined ? '' : String(Math.round(v * 100) / 100));

const monthNow = () => todayLocal().slice(0, 7);

function previewTable(sheet) {
  const ts = sheet.timesheet;
  const rows = [
    ...ts.funders.map((f) => ({ label: f.funder, cc: `${Math.round(f.costCenter * 100)}%`, row: f })),
    ...[ts.official, ts.annual, ts.sick, ts.emergency].map((r) => ({ label: r.label, cc: '', row: r })),
    { label: 'Total', cc: '', row: ts.total, strong: true },
  ];
  return h('div', { class: 'table-wrap', dir: 'ltr' },
    h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, h('th', null, 'Item'), h('th', null, 'CC'), h('th', null, 'Hours'), ts.dates.map((d) => h('th', null, Number(d.slice(8)))))),
      h('tbody', null, rows.map(({ label, cc, row, strong }) => h('tr', null,
        h('td', { style: { minWidth: '220px', maxWidth: '320px' } }, strong ? h('strong', null, label) : label),
        h('td', null, cc),
        h('td', null, h('strong', null, fmt(row.total))),
        row.values.map((v) => h('td', null, fmt(v))))))));
}

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

  const wantedMonth = new URLSearchParams(location.hash.split('?')[1] || '').get('month');
  const month = h('input', { type: 'month', value: /^\d{4}-\d{2}$/.test(wantedMonth || '') ? wantedMonth : monthNow(), required: true, max: monthNow() });
  const who = select(options, wanted && active.some((e) => e.id === wanted) ? `e${wanted}` : options[0]?.[0]);
  const out = h('div');
  const btnPrev = h('button', { type: 'button', class: 'btn' }, 'معاينة');
  const btnDown = h('button', { type: 'button', class: 'btn btn-primary' }, 'تنزيل ملف إكسل');

  const selected = () => {
    const v = who.value;
    if (v === 'all') return active;
    if (v.startsWith('c')) return active.filter((e) => e.centerId === Number(v.slice(1)));
    return active.filter((e) => e.id === Number(v.slice(1)));
  };

  const busy = (on) => {
    btnPrev.disabled = on;
    btnDown.disabled = on;
  };

  btnPrev.onclick = async () => {
    const list = selected();
    if (!month.value || !list.length) return;
    busy(true);
    try {
      const { sheets } = await fetchSheets(list.slice(0, 1), month.value);
      const s = sheets[0];
      clear(out).append(h('div', null,
        h('h3', { class: 'section-title' }, `${s.employee.name} — ${s.timesheet.monthName} ${s.timesheet.year}`),
        previewTable(s),
        s.timesheet.notes.map((n) => h('div', { class: 'notice notice-warn' }, NOTE[n])),
        list.length > 1 ? h('p', { class: 'muted' }, `المعاينة للموظف الأول فقط (${list.length} موظفاً في الملف عند التنزيل).`) : null));
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      busy(false);
    }
  };

  btnDown.onclick = async () => {
    const list = selected();
    if (!month.value || !list.length) return toast('اختر الشهر والموظفين', 'err');
    busy(true);
    try {
      const label = list.length === 1 ? list[0].code : who.value === 'all' ? 'All' : (centers.find((c) => `c${c.id}` === who.value)?.nameEn || 'Center').replace(/\W+/g, '-');
      const { sheets } = await downloadTimesheet(list, month.value, label);
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
