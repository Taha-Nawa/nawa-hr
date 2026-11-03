// نموذج مزوّد الخدمة (إضافة وتعديل): البيانات + العقد + جدول الدوام. يُستعمل من قائمة المزوّدين ومن ملف المزوّد.
import { h, dialog, field, select, toast, icon, AR_DAYS, todayLocal, addDays } from '../dom.js';
import { post, patch } from '../api.js';
import { timeField } from '../time12.js';
import { WEEK_ORDER } from '../providers-lib.js';

let formSeq = 0;
const SERVICES = ['تدريس', 'تدريب', 'محاضرات', 'ورش فنية', 'خدمة أخرى'];

export function providerDialog({ p = null, schedule = [], centers = [], employees = [], onDone }) {
  const seq = ++formSeq;
  const today = todayLocal();
  const name = h('input', { type: 'text', maxlength: 120, required: true, value: p?.name || '', autocomplete: 'off' });
  const phone = h('input', { type: 'tel', maxlength: 40, value: p?.phone || '', dir: 'ltr' });
  const center = select([['', 'بلا مركز'], ...centers.filter((c) => c.active !== 0).map((c) => [String(c.id), c.name])], p?.centerId ?? '');
  const service = h('input', { type: 'text', maxlength: 80, value: p?.service || '', list: `svc-${seq}`, placeholder: 'مثال: تدريس' });
  const project = h('input', { type: 'text', maxlength: 120, value: p?.project || '', placeholder: 'اسم المشروع (اختياري)' });
  const people = employees.filter((e) => e.status === 'active' || e.id === p?.supervisorId);
  const supervisor = select([['', 'بلا مشرف محدّد'], ...people.map((e) => [String(e.id), `${e.name} (${e.code})`])], p?.supervisorId ?? '');
  const start = h('input', { type: 'date', required: true, value: p?.contractStart || today });
  const end = h('input', { type: 'date', required: true, value: p?.contractEnd || addDays(today, 90) });
  const notes = h('textarea', { rows: 2, maxlength: 500, placeholder: 'ملاحظات (اختياري)' }, p?.notes || '');
  const active = h('input', { type: 'checkbox', checked: p ? !!p.active : true });
  const err = h('div', { class: 'notice notice-err', role: 'alert', hidden: true });

  // ---- جدول الدوام
  const rows = [];
  const rowsBox = h('div', { class: 'sched-rows' });
  function addRow(init = {}) {
    const day = select(WEEK_ORDER.map((d) => [String(d), AR_DAYS[d]]), String(init.weekday ?? WEEK_ORDER[0]), { 'aria-label': 'اليوم' });
    const from = timeField({ value: init.start || '', label: 'من' });
    const to = timeField({ value: init.end || '', label: 'إلى' });
    const row = { day, from, to };
    const el = h('div', { class: 'sched-row' },
      field('اليوم', day), field('من', from), field('إلى', to),
      h('button', { type: 'button', class: 'icon-btn sched-del', 'aria-label': 'حذف هذه الحصة', onclick: () => { rows.splice(rows.indexOf(row), 1); el.remove(); } }, icon('trash')));
    row.el = el;
    rows.push(row);
    rowsBox.append(el);
    return row;
  }
  for (const s of schedule) addRow(s);
  if (!rows.length) addRow();
  const addBtn = h('button', { type: 'button', class: 'btn btn-sm', onclick: () => {
    const last = rows[rows.length - 1];
    const i = last ? WEEK_ORDER.indexOf(Number(last.day.value)) : -1;
    addRow({ weekday: WEEK_ORDER[(i + 1) % WEEK_ORDER.length], start: last?.from.value, end: last?.to.value });
  } }, icon('plus'), 'إضافة حصة');

  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, p ? 'حفظ' : 'إضافة المزوّد');
  const form = h('form', { class: 'form-grid', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    err.hidden = true;
    const fail = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView?.({ block: 'nearest' }); };
    if (!name.value.trim()) return fail('اكتب اسم المزوّد');
    if (!start.value || !end.value) return fail('حدّد بداية العقد ونهايته');
    if (end.value < start.value) return fail('نهاية العقد قبل بدايته');
    if (rows.some((r) => !r.from.value || !r.to.value)) return fail('أكمل وقت كل حصة (من وإلى)');
    submit.disabled = true;
    const body = {
      name: name.value, phone: phone.value, centerId: center.value === '' ? null : Number(center.value), service: service.value, project: project.value,
      supervisorId: supervisor.value === '' ? null : Number(supervisor.value), contractStart: start.value, contractEnd: end.value, notes: notes.value,
      schedule: rows.map((r) => ({ weekday: Number(r.day.value), start: r.from.value, end: r.to.value })),
      ...(p ? { active: active.checked } : {}),
    };
    try {
      const res = p ? await patch(`/api/providers/${p.id}`, body) : await post('/api/providers', body);
      dlg.close();
      toast(p ? 'تم الحفظ' : 'أُضيف المزوّد');
      onDone?.(p ? { id: p.id } : res);
    } catch (ex) {
      fail(ex.message);
      submit.disabled = false;
    }
  } },
  h('div', { class: 'span-all' }, field('الاسم', name)),
  field('الهاتف', phone), field('المركز', center),
  field('نوع الخدمة', service), field('المشروع', project),
  h('div', { class: 'span-all' }, field('المشرف المسؤول عن متابعته', supervisor, 'يصله تنبيه «لم يحضر» ويرى المزوّد في صفحته')),
  field('بداية العقد', start), field('نهاية العقد', end, 'بعدها تتوقف بطاقته عن العمل تلقائياً'),
  h('div', { class: 'span-all sched' },
    h('h3', null, 'جدول الدوام'),
    h('p', { class: 'field-hint' }, 'أيام الحصص وأوقاتها: عليها يُبنى التنبيه بالتأخر والغياب والساعات المحتسبة.'),
    rowsBox, addBtn),
  h('div', { class: 'span-all' }, field('ملاحظات', notes)),
  p ? h('label', { class: 'check-inline span-all' }, active, 'فعّال (يعمل على البوابة ويظهر في اللوحة)') : null,
  h('div', { class: 'span-all' }, err),
  h('div', { class: 'dlg-actions span-all' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'إلغاء'), submit),
  h('datalist', { id: `svc-${seq}` }, SERVICES.map((s) => h('option', { value: s }))));
  const dlg = dialog({ title: p ? `تعديل ${p.name}` : 'مزوّد خدمة جديد', content: form, wide: true });
  return dlg;
}
